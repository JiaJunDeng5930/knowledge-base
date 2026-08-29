#!/usr/bin/env python3
"""使用随 skill 保存的 py-fsrs 计算知识库中的 FSRS 数据。"""

import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "third_party" / "py-fsrs"))
from fsrs import Card, Rating, ReviewLog, Scheduler


def utc_datetime(value):
    if value is None:
        return None
    timestamp = datetime.fromisoformat(value)
    if timestamp.tzinfo is None:
        raise ValueError("FSRS 时间必须包含时区")
    return timestamp.astimezone(timezone.utc)


def scheduler_from_data(data):
    if not isinstance(data, dict):
        raise ValueError("FSRS 调度配置必须是 JSON 对象")
    defaults = Scheduler().to_dict()
    unknown = data.keys() - defaults.keys()
    if unknown:
        raise ValueError(f"未知 FSRS 调度参数：{', '.join(sorted(unknown))}")
    return Scheduler.from_dict(defaults | data)


def snapshot_from_data(data):
    snapshot = data["snapshot"]
    revision = snapshot["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
        raise ValueError("FSRS revision 必须是非负整数")
    card = Card.from_dict(snapshot["card"])
    card.due = utc_datetime(card.due.isoformat())
    if card.last_review is not None:
        card.last_review = utc_datetime(card.last_review.isoformat())
    return card, Scheduler.from_dict(snapshot["scheduler"]), revision


def review_logs_from_data(data):
    logs = []
    for raw in data["review_logs"]:
        log = ReviewLog.from_dict(raw)
        log.review_datetime = utc_datetime(log.review_datetime.isoformat())
        duration = log.review_duration
        if duration is not None and (
            isinstance(duration, bool) or not isinstance(duration, int) or duration < 0
        ):
            raise ValueError("FSRS review_duration 必须是非负整数毫秒或 null")
        logs.append(log)
    return logs


def review(data):
    card, scheduler, revision = snapshot_from_data(data)
    timestamp = utc_datetime(data.get("review_datetime"))
    if timestamp is not None and card.last_review is not None and timestamp < card.last_review:
        raise ValueError("FSRS 复习时间不能早于当前记忆状态的最后复习时间")
    duration = data.get("review_duration")
    if duration is not None and (
        isinstance(duration, bool) or not isinstance(duration, int) or duration < 0
    ):
        raise ValueError("FSRS review_duration 必须是非负整数毫秒或 null")
    if isinstance(data["rating"], bool) or not isinstance(data["rating"], int):
        raise ValueError("FSRS rating 必须是整数评分")
    updated, log = scheduler.review_card(
        card,
        Rating(data["rating"]),
        review_datetime=timestamp,
        review_duration=duration,
    )
    return {
        "expected_revision": revision,
        "card": updated.to_dict(),
        "scheduler": scheduler.to_dict(),
        "review_log": log.to_dict(),
    }


def retrievability(data):
    card, scheduler, _ = snapshot_from_data(data)
    return {
        "retrievability": scheduler.get_card_retrievability(
            card, current_datetime=utc_datetime(data.get("current_datetime"))
        )
    }


def optimize_parameters(data):
    from fsrs import Optimizer

    scheduler = scheduler_from_data(data["scheduler"])
    parameters = Optimizer(review_logs_from_data(data)).compute_optimal_parameters()
    return {"scheduler": Scheduler.from_dict(scheduler.to_dict() | {"parameters": parameters}).to_dict()}


def optimize_retention(data):
    from fsrs import Optimizer

    scheduler = scheduler_from_data(data["scheduler"])
    retention = Optimizer(review_logs_from_data(data)).compute_optimal_retention(
        scheduler.parameters
    )
    return {
        "scheduler": Scheduler.from_dict(
            scheduler.to_dict() | {"desired_retention": retention}
        ).to_dict()
    }


def reschedule(data):
    card, _, revision = snapshot_from_data(data)
    scheduler = scheduler_from_data(data["scheduler"])
    logs = review_logs_from_data(data)
    if card.last_review is not None and (
        not logs or max(log.review_datetime for log in logs) != card.last_review
    ):
        raise ValueError("FSRS 重算需要目标对象的完整复习历史")
    updated = scheduler.reschedule_card(card, logs)
    return {
        "expected_revision": revision,
        "card": updated.to_dict(),
        "scheduler": scheduler.to_dict(),
    }


COMMANDS = {
    "settings": lambda data: scheduler_from_data(data).to_dict(),
    "review": review,
    "retrievability": retrievability,
    "optimize-parameters": optimize_parameters,
    "optimize-retention": optimize_retention,
    "reschedule": reschedule,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("input", nargs="?", help="输入 JSON 文件；省略或 - 从标准输入读取")
    args = parser.parse_args()
    try:
        if args.command == "settings" and args.input is None:
            data = {}
        elif args.input is None or args.input == "-":
            data = json.load(sys.stdin)
        else:
            with Path(args.input).open(encoding="utf-8") as source:
                data = json.load(source)
        if not isinstance(data, dict):
            raise ValueError("FSRS 输入必须是 JSON 对象")
        # 上游优化器的进度信息保留在 stderr，stdout 始终输出可供 SQL 使用的 JSON。
        with redirect_stdout(sys.stderr):
            result = COMMANDS[args.command](data)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
    except (OSError, ValueError, TypeError, KeyError, ImportError) as error:
        parser.exit(1, f"FSRS 数据操作失败：{error}\n")


if __name__ == "__main__":
    main()
