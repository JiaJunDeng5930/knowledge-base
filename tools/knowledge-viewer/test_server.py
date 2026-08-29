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
    }


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
    def test_normalize_accepts_unreviewed_fsrs(self):
        snapshot = sample_snapshot()
        snapshot["fsrs"] = [{
            "id": "1", "stability_days": None, "difficulty": None,
            "last_review_at": None, "due_at": "2026-08-28T00:00:00+00:00",
        }]
        result = normalize_snapshot(snapshot)["fsrs"][0]
        self.assertIsNone(result["stability_days"])
        self.assertIsNone(result["difficulty"])
        self.assertIsNone(result["last_review_at"])

    def test_normalize_preserves_bigint_as_decimal_strings(self):
        result = normalize_snapshot(sample_snapshot())
        self.assertIsInstance(result["records"][0]["id"], str)
        self.assertEqual(result["records"][0]["id"], "9007199254740993")
        self.assertEqual(result["records"][0]["sibling_order"], "-2")

    def test_client_reads_until_empty_page(self):
        rows = {
            "knowledge_record": [
                {"id": "1", "body": "one", "parent_id": None, "depth": 0, "sibling_order": "0"},
                {"id": "2", "body": "two", "parent_id": None, "depth": 0, "sibling_order": "1"},
                {"id": "3", "body": "three", "parent_id": None, "depth": 0, "sibling_order": "2"},
            ],
            "knowledge_reference": [],
            "effective_record_tag": [],
            "fsrs": [],
            "fsrs_knowledge": [],
        }
        opener = PagedOpener(rows)
        client = SupabaseClient(SupabaseConfig("https://example.supabase.co", "anon-secret"), opener=opener, page_size=2)
        result = client.fetch_snapshot()
        self.assertEqual([row["id"] for row in result["records"]], ["1", "2", "3"])
        record_requests = [request for request in opener.requests if "/knowledge_record?" in request.full_url]
        offsets = [urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)["offset"][0] for request in record_requests]
        self.assertEqual(offsets, ["0", "2", "3"])
        self.assertEqual(record_requests[0].get_method(), "GET")
        self.assertEqual(record_requests[0].headers["Apikey"], "anon-secret")

    def test_configuration_does_not_accept_missing_values(self):
        with self.assertRaises(ConfigurationError):
            SupabaseConfig.from_environment({"SUPABASE_URL": "https://example.supabase.co"})
        with self.assertRaises(ConfigurationError):
            SupabaseConfig.from_environment({"SUPABASE_KEY": "anon-secret"})

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
            self.assertNotIn("anon-secret", body)
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
        secret = "anon-secret-value"

        def failing_loader():
            raise UpstreamError(f"upstream included {secret}")

        server = make_server("127.0.0.1", 0, snapshot_loader=failing_loader)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/api/snapshot")
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
