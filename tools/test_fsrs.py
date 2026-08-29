"""验证 py-fsrs 数据脚本；设置 FSRS_TEST_DATABASE_URL 时同时验证空 PostgreSQL 数据库。

数据库测试另需安装 psycopg[binary]==3.3.4；生产脚本不依赖数据库驱动。
"""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
FSRS = ROOT / "skills" / "knowledge-base" / "fsrs"
sys.path.insert(0, str(FSRS / "scripts"))
import fsrs_data
from fsrs import Card, Rating, Scheduler, State


def command(name, data=None):
    result = subprocess.run(
        [sys.executable, "-B", str(FSRS / "scripts" / "fsrs_data.py"), name],
        input=None if data is None else json.dumps(data),
        text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def scheduler_config():
    return Scheduler(enable_fuzzing=False).to_dict()


def snapshot(card_id=1):
    return {
        "revision": 0,
        "scheduler": scheduler_config(),
        "card": Card(
            card_id=card_id, due=datetime(2026, 1, 1, tzinfo=timezone.utc)
        ).to_dict(),
    }


def review_input(current, rating=4, day=0):
    return {
        "snapshot": current,
        "rating": rating,
        "review_datetime": (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day)).isoformat(),
        "review_duration": 1500,
    }


class FsrsScriptTests(unittest.TestCase):
    def test_review_and_retrievability(self):
        original = snapshot()
        result = command("review", review_input(original))
        self.assertEqual(result["card"]["state"], int(State.Review))
        self.assertGreater(result["card"]["stability"], 0)
        self.assertEqual(result["review_log"]["rating"], 4)
        self.assertEqual(result["review_log"]["review_duration"], 1500)
        self.assertIsNone(original["card"]["stability"])
        current = {"revision": 1, "card": result["card"], "scheduler": result["scheduler"]}
        probability = command("retrievability", {
            "snapshot": current, "current_datetime": "2026-01-02T00:00:00+00:00",
        })["retrievability"]
        self.assertGreater(probability, 0)
        self.assertLess(probability, 1)

    def test_reschedule_uses_history(self):
        first = command("review", review_input(snapshot()))
        current = {"revision": 1, "card": first["card"], "scheduler": first["scheduler"]}
        result = command("reschedule", {
            "snapshot": current,
            "scheduler": current["scheduler"] | {"desired_retention": 0.95},
            "review_logs": [first["review_log"]],
        })
        self.assertEqual(result["card"]["last_review"], first["card"]["last_review"])
        self.assertLess(
            datetime.fromisoformat(result["card"]["due"]),
            datetime.fromisoformat(first["card"]["due"]),
        )

    def test_invalid_review_input(self):
        data = review_input(snapshot())
        data["review_datetime"] = "2026-01-01T00:00:00"
        with self.assertRaises(ValueError):
            fsrs_data.review(data)
        data["review_datetime"] += "+00:00"
        data["review_duration"] = -1
        with self.assertRaises(ValueError):
            fsrs_data.review(data)


class FsrsOptimizerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fsrs.optimizer import mini_batch_size, max_seq_len

        # 合成历史只验证真实优化器的调用；数量由上游训练阈值决定。
        cls.logs = []
        review_count = 0
        card_id = 0
        scheduler = Scheduler(enable_fuzzing=False)
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        while review_count < mini_batch_size:
            card_id += 1
            card = Card(card_id=card_id, due=start)
            for index in range(max_seq_len):
                if index == 0:
                    rating = Rating((card_id - 1) % 4 + 1)
                elif index % 9 == 0:
                    rating = Rating.Again
                elif index % 7 == 0:
                    rating = Rating.Hard
                elif index % 5 == 0:
                    rating = Rating.Easy
                else:
                    rating = Rating.Good
                if card.state == State.Review:
                    review_count += 1
                card, log = scheduler.review_card(
                    card, rating,
                    review_datetime=start + timedelta(days=index * (1 + card_id % 3)),
                    review_duration=1000 + int(rating) * 400,
                )
                cls.logs.append(log.to_dict())
                if review_count >= mini_batch_size:
                    break

    def test_parameter_optimization_runs_training(self):
        result = command("optimize-parameters", {
            "scheduler": scheduler_config(), "review_logs": self.logs,
        })["scheduler"]
        self.assertEqual(len(result["parameters"]), len(Scheduler().parameters))
        self.assertNotEqual(result["parameters"], list(Scheduler().parameters))
        Scheduler.from_dict(result)

    def test_retention_optimization(self):
        result = command("optimize-retention", {
            "scheduler": scheduler_config(), "review_logs": self.logs,
        })["scheduler"]
        self.assertGreater(result["desired_retention"], 0)
        self.assertLessEqual(result["desired_retention"], 1)
        self.assertEqual(result["parameters"], scheduler_config()["parameters"])


@unittest.skipUnless(os.getenv("FSRS_TEST_DATABASE_URL"), "需要独立的空 PostgreSQL 数据库")
class FsrsDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.types.json import Jsonb

        cls.Jsonb = Jsonb
        cls.connection = psycopg.connect(os.environ["FSRS_TEST_DATABASE_URL"], autocommit=True)
        existing = cls.connection.execute(
            "select count(*) from pg_tables where schemaname = 'public'"
        ).fetchone()[0]
        if existing:
            cls.connection.close()
            raise RuntimeError("FSRS 数据库测试只接受空数据库")
        cls.connection.execute((FSRS.parent / "schema.sql").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def query(self, sql, parameters=()):
        return self.connection.execute(sql, parameters).fetchone()[0]

    def query_file(self, name, value):
        sql = (FSRS / "queries" / name).read_text()
        return self.connection.execute(sql.replace("$1", "%s"), (value,)).fetchone()

    def read_snapshot(self, fsrs_id):
        return self.query_file("read-fsrs-snapshot.sql", fsrs_id)[0]

    def test_review_history_and_atomic_saves(self):
        record = self.query(
            "insert into public.knowledge_record (body, depth, sibling_order) "
            "values ('测试知识', 0, 0) returning id"
        )
        fsrs_id = self.query_file("create-fsrs.sql", self.Jsonb({
            "record_ids": [record],
            "scheduler": scheduler_config(),
            "due_at": "2026-01-01T00:00:00+00:00",
        }))[0]
        current = self.read_snapshot(fsrs_id)
        self.assertIsNone(current["card"]["stability"])
        first = command("review", review_input(current))
        self.assertEqual(
            self.query_file("save-fsrs-review.sql", self.Jsonb(first)),
            (fsrs_id, 1),
        )
        saved = self.read_snapshot(fsrs_id)
        logs = self.query_file("read-fsrs-review-logs.sql", [fsrs_id])[0]
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["review_duration"], first["review_log"]["review_duration"])

        self.assertIsNone(self.query_file("save-fsrs-review.sql", self.Jsonb(first)))
        self.assertEqual(self.read_snapshot(fsrs_id), saved)

        invalid = command("review", review_input(saved, rating=3, day=1))
        invalid["review_log"]["rating"] = 0
        with self.assertRaises(Exception) as rejected:
            self.query_file("save-fsrs-review.sql", self.Jsonb(invalid))
        self.assertEqual(rejected.exception.sqlstate, "23514")
        self.assertEqual(self.read_snapshot(fsrs_id), saved)
        self.assertEqual(self.query("select count(*) from public.fsrs_review"), 1)

        replacement = command("reschedule", {
            "snapshot": saved, "review_logs": logs,
            "scheduler": saved["scheduler"] | {"desired_retention": 0.95},
        })
        self.assertEqual(
            self.query_file("save-fsrs-reschedule.sql", self.Jsonb(replacement)),
            (fsrs_id, 2),
        )
        rescheduled = self.read_snapshot(fsrs_id)
        self.assertEqual(rescheduled["scheduler"]["desired_retention"], 0.95)
        self.assertEqual(self.query("select count(*) from public.fsrs_review"), 1)

        with self.assertRaises(Exception) as missing_record:
            self.query_file("create-fsrs.sql", self.Jsonb({
                "record_ids": [record + 1], "scheduler": scheduler_config(),
            }))
        self.assertEqual(missing_record.exception.sqlstate, "23503")
        self.assertIsNone(self.query_file("create-fsrs.sql", self.Jsonb({
            "record_ids": [], "scheduler": scheduler_config(),
        })))
        self.assertEqual(self.query("select count(*) from public.fsrs"), 1)


if __name__ == "__main__":
    unittest.main()
