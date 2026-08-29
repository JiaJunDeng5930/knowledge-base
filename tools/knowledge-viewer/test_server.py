import base64
import json
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import sys


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from server import (  # noqa: E402
    ConfigurationError,
    SupabaseClient,
    SupabaseConfig,
    UpstreamError,
    make_server,
    normalize_snapshot,
)


def sample_snapshot():
    return {
        "records": [
            {
                "id": "9007199254740993",
                "body": "large id",
                "parent_id": None,
                "depth": 0,
                "sibling_order": "-2",
            }
        ],
        "references": [],
        "effective_tags": [],
        "fsrs": [],
        "fsrs_knowledge": [],
        "fsrs_review": [],
    }


def sample_fsrs(**overrides):
    row = {
        "id": "1",
        "state": 1,
        "step": 0,
        "stability_days": None,
        "difficulty": None,
        "last_review_at": None,
        "due_at": "2026-08-28T00:00:00+00:00",
        "scheduler": {"desired_retention": 0.9},
        "revision": "0",
    }
    row.update(overrides)
    return row


def legacy_jwt(role):
    payload = base64.urlsafe_b64encode(
        json.dumps({"role": role}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"header.{payload}.signature"


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class PagedOpener:
    def __init__(self, rows_by_table):
        self.rows_by_table = rows_by_table
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        parsed = urllib.parse.urlsplit(request.full_url)
        table = parsed.path.rsplit("/", 1)[-1]
        query = urllib.parse.parse_qs(parsed.query)
        offset = int(query["offset"][0])
        limit = int(query["limit"][0])
        rows = self.rows_by_table[table]
        return FakeResponse(rows[offset : offset + limit])


class KnowledgeViewerServerTests(unittest.TestCase):
    def test_normalize_accepts_nullable_fsrs_fields_and_review_duration(self):
        snapshot = sample_snapshot()
        snapshot["fsrs"] = [
            sample_fsrs(),
            sample_fsrs(
                id="2",
                state=2,
                step=None,
                stability_days=2.5,
                difficulty=4.0,
                last_review_at="2026-08-28T01:00:00+00:00",
            ),
        ]
        snapshot["fsrs_review"] = [
            {
                "id": "2",
                "fsrs_id": "1",
                "rating": 3,
                "review_datetime": "2026-08-28T01:00:00+00:00",
                "review_duration": None,
            }
        ]

        result = normalize_snapshot(snapshot)

        self.assertIsNone(result["fsrs"][0]["stability_days"])
        self.assertIsNone(result["fsrs"][0]["difficulty"])
        self.assertIsNone(result["fsrs"][0]["last_review_at"])
        self.assertEqual(result["fsrs"][0]["scheduler"], {"desired_retention": 0.9})
        self.assertIsNone(result["fsrs"][1]["step"])
        self.assertIsNone(result["fsrs_review"][0]["review_duration"])

    def test_normalize_preserves_all_bigint_values_as_decimal_strings(self):
        snapshot = sample_snapshot()
        snapshot["fsrs"] = [sample_fsrs(id=3, revision=9007199254740994)]
        snapshot["fsrs_review"] = [
            {
                "id": 9007199254740995,
                "fsrs_id": 3,
                "rating": 4,
                "review_datetime": "2026-08-28T01:00:00+00:00",
                "review_duration": 9007199254740996,
            }
        ]

        result = normalize_snapshot(snapshot)

        self.assertEqual(result["records"][0]["id"], "9007199254740993")
        self.assertEqual(result["records"][0]["sibling_order"], "-2")
        self.assertEqual(result["fsrs"][0]["id"], "3")
        self.assertEqual(result["fsrs"][0]["revision"], "9007199254740994")
        self.assertEqual(result["fsrs_review"][0]["id"], "9007199254740995")
        self.assertEqual(result["fsrs_review"][0]["fsrs_id"], "3")
        self.assertEqual(
            result["fsrs_review"][0]["review_duration"], "9007199254740996"
        )

    def test_normalize_rejects_invalid_states_ratings_and_nullable_fields(self):
        invalid_rows = (
            (sample_fsrs(state=4), None),
            (sample_fsrs(state=2, step=0), None),
            (sample_fsrs(stability_days=1.0), None),
            (sample_fsrs(scheduler=[]), None),
            (
                None,
                {
                    "id": "2",
                    "fsrs_id": "1",
                    "rating": 5,
                    "review_datetime": "2026-08-28T01:00:00+00:00",
                    "review_duration": None,
                },
            ),
            (
                None,
                {
                    "id": "2",
                    "fsrs_id": "1",
                    "rating": 3,
                    "review_datetime": "2026-08-28T01:00:00+00:00",
                    "review_duration": -1,
                },
            ),
        )
        for fsrs_row, review_row in invalid_rows:
            with self.subTest(fsrs=fsrs_row, review=review_row):
                snapshot = sample_snapshot()
                snapshot["fsrs"] = [] if fsrs_row is None else [fsrs_row]
                snapshot["fsrs_review"] = [] if review_row is None else [review_row]
                with self.assertRaises(UpstreamError):
                    normalize_snapshot(snapshot)

    def test_client_runs_six_queries_and_reads_until_empty_page(self):
        rows = {
            "knowledge_record": [
                {
                    "id": str(index),
                    "body": str(index),
                    "parent_id": None,
                    "depth": 0,
                    "sibling_order": str(index - 1),
                }
                for index in range(1, 4)
            ],
            "knowledge_reference": [],
            "effective_record_tag": [],
            "fsrs": [],
            "fsrs_knowledge": [],
            "fsrs_review": [],
        }
        opener = PagedOpener(rows)
        config = SupabaseConfig.from_environment(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_KEY": "sb_publishable_viewer-test",
            }
        )
        client = SupabaseClient(config, opener=opener, page_size=2)

        result = client.fetch_snapshot()

        self.assertEqual([row["id"] for row in result["records"]], ["1", "2", "3"])
        requested_tables = {
            urllib.parse.urlsplit(request.full_url).path.rsplit("/", 1)[-1]
            for request in opener.requests
        }
        self.assertEqual(requested_tables, set(rows))
        requests_by_table = {
            urllib.parse.urlsplit(request.full_url).path.rsplit("/", 1)[-1]: request
            for request in opener.requests
        }
        fsrs_query = urllib.parse.parse_qs(
            urllib.parse.urlsplit(requests_by_table["fsrs"].full_url).query
        )
        review_query = urllib.parse.parse_qs(
            urllib.parse.urlsplit(requests_by_table["fsrs_review"].full_url).query
        )
        self.assertEqual(
            fsrs_query["select"][0],
            "id,state,step,stability_days,difficulty,last_review_at,due_at,scheduler,revision",
        )
        self.assertEqual(
            review_query["select"][0],
            "id,fsrs_id,rating,review_datetime,review_duration",
        )
        record_requests = [
            request
            for request in opener.requests
            if "/knowledge_record?" in request.full_url
        ]
        offsets = [
            urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)[
                "offset"
            ][0]
            for request in record_requests
        ]
        self.assertEqual(offsets, ["0", "2", "3"])
        self.assertEqual(record_requests[0].get_method(), "GET")
        self.assertEqual(
            record_requests[0].headers["Apikey"], "sb_publishable_viewer-test"
        )
        self.assertNotIn("Authorization", record_requests[0].headers)

    def test_legacy_anon_is_sent_as_apikey_and_bearer(self):
        key = legacy_jwt("anon")
        config = SupabaseConfig.from_environment(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_KEY": key,
            }
        )
        opener = PagedOpener({"fsrs_review": []})

        SupabaseClient(config, opener=opener)._fetch_all(
            "fsrs_review", "id", "id"
        )

        self.assertEqual(opener.requests[0].headers["Apikey"], key)
        self.assertEqual(opener.requests[0].headers["Authorization"], f"Bearer {key}")

    def test_configuration_accepts_only_publishable_environment(self):
        url = "https://example.supabase.co"
        invalid_environments = (
            {"SUPABASE_URL": url},
            {"SUPABASE_URL": url, "SUPABASE_KEY": "sb_secret_server"},
            {"SUPABASE_URL": url, "SUPABASE_SECRET_KEY": "sb_secret_server"},
            {"SUPABASE_URL": url, "SUPABASE_KEY": legacy_jwt("service_role")},
        )
        for environment in invalid_environments:
            with self.subTest(environment=environment):
                with self.assertRaises(ConfigurationError):
                    SupabaseConfig.from_environment(environment)

        publishable_config = SupabaseConfig.from_environment(
            {"SUPABASE_URL": url, "SUPABASE_KEY": "sb_publishable_viewer-test"}
        )
        legacy_anon_config = SupabaseConfig.from_environment(
            {
                "SUPABASE_URL": url,
                "SUPABASE_KEY": legacy_jwt("anon"),
            }
        )
        self.assertFalse(publishable_config.legacy_anon)
        self.assertTrue(legacy_anon_config.legacy_anon)

    def test_http_surface_is_get_only_and_does_not_leak_errors(self):
        server = make_server("127.0.0.1", 0, snapshot_loader=sample_snapshot)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urllib.request.urlopen(base + "/api/snapshot") as response:
                self.assertEqual(response.status, 200)
                body = response.read().decode("utf-8")
            self.assertIn("9007199254740993", body)
            self.assertNotIn("sb_secret", body)
            request = urllib.request.Request(base + "/api/snapshot", method="POST")
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request)
            self.assertEqual(caught.exception.code, 405)
            caught.exception.close()
            with urllib.request.urlopen(base + "/") as response:
                self.assertEqual(response.status, 200)
                self.assertIn("Knowledge Viewer", response.read().decode("utf-8"))
            with urllib.request.urlopen(base + "/record/-2") as response:
                self.assertEqual(response.status, 200)
            with urllib.request.urlopen(base + "/fsrs/-2") as response:
                self.assertEqual(response.status, 200)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_http_error_is_generic(self):
        secret = "sb_secret_value"

        def failing_loader():
            raise UpstreamError(f"upstream included {secret}")

        server = make_server("127.0.0.1", 0, snapshot_loader=failing_loader)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(
                    f"http://127.0.0.1:{server.server_port}/api/snapshot"
                )
            self.assertEqual(caught.exception.code, 502)
            self.assertNotIn(secret, caught.exception.read().decode("utf-8"))
            caught.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_server_rejects_non_loopback_binding(self):
        with self.assertRaises(ConfigurationError):
            make_server("0.0.0.0", 0, snapshot_loader=sample_snapshot)


if __name__ == "__main__":
    unittest.main()
