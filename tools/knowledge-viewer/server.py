#!/usr/bin/env python3
"""知识库 Supabase schema 的本地只读查看器服务。

浏览器只连接此进程。本模块将 Supabase 读取边界固定为五个 REST GET
查询，并由 HTTP handler 只暴露快照和静态资源。
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import socket
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Mapping


ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = ROOT / "public"
DEFAULT_PORT = 8765
PAGE_SIZE = 1000
DECIMAL_ID = re.compile(r"-?(?:0|[1-9][0-9]*)\Z")


class ViewerError(Exception):
    """可以转换为通用 API 响应的预期错误。"""


class ConfigurationError(ViewerError):
    pass


class UpstreamError(ViewerError):
    pass


def _decimal_string(value: Any, *, field: str) -> str:
    """将 PostgreSQL bigint 转为十进制字符串，不经过 JavaScript Number。"""

    if isinstance(value, bool):
        raise UpstreamError(f"invalid {field}")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and DECIMAL_ID.fullmatch(value):
        return value
    raise UpstreamError(f"invalid {field}")


def _optional_decimal_string(value: Any, *, field: str) -> str | None:
    if value is None:
        return None
    return _decimal_string(value, field=field)


def _finite_number(value: Any, *, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise UpstreamError(f"invalid {field}")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise UpstreamError(f"invalid {field}")
    return number


def _integer(value: Any, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise UpstreamError(f"invalid {field}")
    return value


def _text(value: Any, *, field: str) -> str:
    if not isinstance(value, str):
        raise UpstreamError(f"invalid {field}")
    return value


def normalize_snapshot(raw: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """校验并规范化固定快照契约。

    Supabase 可能把 bigint 列序列化为 JSON 数字或字符串。规范化结果始终
    对这些列使用字符串，使浏览器可以无精度损失地将其作为 Map key。
    """

    expected = (
        "records",
        "references",
        "effective_tags",
        "fsrs",
        "fsrs_knowledge",
    )
    if not isinstance(raw, Mapping) or any(key not in raw for key in expected):
        raise UpstreamError("invalid snapshot")

    records: list[dict[str, Any]] = []
    for row in _rows(raw["records"], "records"):
        records.append(
            {
                "id": _decimal_string(row.get("id"), field="record id"),
                "body": _text(row.get("body"), field="record body"),
                "parent_id": _optional_decimal_string(
                    row.get("parent_id"), field="record parent_id"
                ),
                "depth": _integer(row.get("depth"), field="record depth"),
                "sibling_order": _decimal_string(
                    row.get("sibling_order"), field="record sibling_order"
                ),
            }
        )

    references: list[dict[str, str]] = []
    for row in _rows(raw["references"], "references"):
        references.append(
            {
                "source_record_id": _decimal_string(
                    row.get("source_record_id"), field="reference source_record_id"
                ),
                "target_record_id": _decimal_string(
                    row.get("target_record_id"), field="reference target_record_id"
                ),
            }
        )

    effective_tags: list[dict[str, str]] = []
    for row in _rows(raw["effective_tags"], "effective_tags"):
        effective_tags.append(
            {
                "record_id": _decimal_string(
                    row.get("record_id"), field="tag record_id"
                ),
                "tag": _text(row.get("tag"), field="tag"),
            }
        )

    fsrs: list[dict[str, Any]] = []
    for row in _rows(raw["fsrs"], "fsrs"):
        fsrs.append(
            {
                "id": _decimal_string(row.get("id"), field="fsrs id"),
                "stability_days": _finite_number(
                    row.get("stability_days"), field="fsrs stability_days"
                ),
                "difficulty": _finite_number(
                    row.get("difficulty"), field="fsrs difficulty"
                ),
                "last_review_at": _text(
                    row.get("last_review_at"), field="fsrs last_review_at"
                ),
                "due_at": _text(row.get("due_at"), field="fsrs due_at"),
            }
        )

    fsrs_knowledge: list[dict[str, str]] = []
    for row in _rows(raw["fsrs_knowledge"], "fsrs_knowledge"):
        fsrs_knowledge.append(
            {
                "fsrs_id": _decimal_string(
                    row.get("fsrs_id"), field="fsrs_knowledge fsrs_id"
                ),
                "record_id": _decimal_string(
                    row.get("record_id"), field="fsrs_knowledge record_id"
                ),
            }
        )

    return {
        "records": records,
        "references": references,
        "effective_tags": effective_tags,
        "fsrs": fsrs,
        "fsrs_knowledge": fsrs_knowledge,
    }


def _rows(value: Any, field: str) -> list[Mapping[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(row, Mapping) for row in value):
        raise UpstreamError(f"invalid {field}")
    return value


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    key: str

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None) -> "SupabaseConfig":
        env = os.environ if environ is None else environ
        url = env.get("SUPABASE_URL", "").strip().rstrip("/")
        key = env.get("SUPABASE_KEY", "")
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or not key:
            raise ConfigurationError("Supabase configuration is unavailable")
        return cls(url=url, key=key)


TABLES: tuple[tuple[str, str, str], ...] = (
    (
        "knowledge_record",
        "id,body,parent_id,depth,sibling_order",
        "id",
    ),
    (
        "knowledge_reference",
        "source_record_id,target_record_id",
        "source_record_id,target_record_id",
    ),
    (
        "effective_record_tag",
        "record_id,tag",
        "record_id,tag",
    ),
    (
        "fsrs",
        "id,stability_days,difficulty,last_review_at,due_at",
        "id",
    ),
    (
        "fsrs_knowledge",
        "fsrs_id,record_id",
        "fsrs_id,record_id",
    ),
)


class SupabaseClient:
    """Supabase Data REST API 的固定查询客户端。"""

    def __init__(
        self,
        config: SupabaseConfig,
        *,
        opener: Callable[..., Any] = urllib.request.urlopen,
        page_size: int = PAGE_SIZE,
    ) -> None:
        self.config = config
        self.opener = opener
        self.page_size = page_size

    def fetch_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        raw: dict[str, list[Mapping[str, Any]]] = {}
        for table, select, order in TABLES:
            raw_key = {
                "knowledge_record": "records",
                "knowledge_reference": "references",
                "effective_record_tag": "effective_tags",
                "fsrs": "fsrs",
                "fsrs_knowledge": "fsrs_knowledge",
            }[table]
            raw[raw_key] = self._fetch_all(table, select, order)
        return normalize_snapshot(raw)

    def _fetch_all(self, table: str, select: str, order: str) -> list[Mapping[str, Any]]:
        rows: list[Mapping[str, Any]] = []
        offset = 0
        while True:
            params = urllib.parse.urlencode(
                {
                    "select": select,
                    "order": order,
                    "limit": str(self.page_size),
                    "offset": str(offset),
                }
            )
            endpoint = f"{self.config.url}/rest/v1/{table}?{params}"
            request = urllib.request.Request(
                endpoint,
                headers={
                    "Accept": "application/json",
                    "apikey": self.config.key,
                    "Authorization": f"Bearer {self.config.key}",
                },
                method="GET",
            )
            try:
                with self.opener(request, timeout=30) as response:
                    status = getattr(response, "status", None)
                    if status is None:
                        status = response.getcode()
                    if status < 200 or status >= 300:
                        raise UpstreamError("Supabase request failed")
                    payload = json.loads(response.read().decode("utf-8"))
            except UpstreamError:
                raise
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
                raise UpstreamError("Supabase request failed") from exc
            if not isinstance(payload, list) or any(not isinstance(row, Mapping) for row in payload):
                raise UpstreamError("Supabase response was invalid")
            rows.extend(payload)
            if not payload:
                break
            offset += len(payload)
        return rows


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host.lower() == "localhost"


def _generic_error(handler: BaseHTTPRequestHandler, status: HTTPStatus, message: str) -> None:
    body = _json_bytes({"error": message})
    handler.send_response(status.value)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


class KnowledgeViewerHandler(BaseHTTPRequestHandler):
    """查看器 HTTP 边界；工厂函数注入类属性。"""

    snapshot_loader: Callable[[], dict[str, list[dict[str, Any]]]] | None = None
    public_root = PUBLIC_ROOT
    server_version = "KnowledgeViewer/1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # 日志不回显查询字符串或上游细节，避免凭据进入可复制的诊断文本。
        sys.stderr.write(f"knowledge-viewer: {self.command} {self.path.split('?', 1)[0]}\n")

    def _method_not_allowed(self) -> None:
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED.value)
        self.send_header("Allow", "GET")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        # BaseHTTPRequestHandler 对未知方法使用 501；查看器统一按 405 拒绝非 GET。
        if self.command != "GET" and code == HTTPStatus.NOT_IMPLEMENTED:
            self._method_not_allowed()
            return
        super().send_error(code, message, explain)

    def do_POST(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_PUT(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_PATCH(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_DELETE(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_HEAD(self) -> None:  # noqa: N802
        self._method_not_allowed()

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/snapshot":
            self._snapshot()
            return
        if path in {"/", "/root"} or re.fullmatch(r"/record/[0-9]+", path) or re.fullmatch(r"/fsrs/[0-9]+", path):
            self._static("index.html", "text/html; charset=utf-8")
            return
        if path == "/app.js":
            self._static("app.js", "text/javascript; charset=utf-8")
            return
        if path == "/model.js":
            self._static("model.js", "text/javascript; charset=utf-8")
            return
        if path == "/styles.css":
            self._static("styles.css", "text/css; charset=utf-8")
            return
        if path == "/favicon.svg":
            self._static("favicon.svg", "image/svg+xml")
            return
        _generic_error(self, HTTPStatus.NOT_FOUND, "Not found")

    def _snapshot(self) -> None:
        if self.snapshot_loader is None:
            _generic_error(self, HTTPStatus.SERVICE_UNAVAILABLE, "Viewer is not configured")
            return
        try:
            payload = self.snapshot_loader()
        except ConfigurationError:
            _generic_error(self, HTTPStatus.SERVICE_UNAVAILABLE, "Supabase configuration is unavailable")
            return
        except (UpstreamError, ViewerError):
            _generic_error(self, HTTPStatus.BAD_GATEWAY, "Knowledge data is unavailable")
            return
        except Exception:
            _generic_error(self, HTTPStatus.BAD_GATEWAY, "Knowledge data is unavailable")
            return
        body = _json_bytes(payload)
        self.send_response(HTTPStatus.OK.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _static(self, filename: str, content_type: str) -> None:
        path = self.public_root / filename
        try:
            body = path.read_bytes()
        except OSError:
            _generic_error(self, HTTPStatus.NOT_FOUND, "Not found")
            return
        self.send_response(HTTPStatus.OK.value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


class LocalHTTPServer(ThreadingHTTPServer):
    """绑定时不执行反向 DNS 查询的 HTTPServer。"""

    def __init__(self, server_address: tuple[str, int], request_handler: type[BaseHTTPRequestHandler]):
        if ":" in server_address[0]:
            self.address_family = socket.AF_INET6
        super().__init__(server_address, request_handler)

    def server_bind(self) -> None:
        # HTTPServer.server_bind 会调用 socket.getfqdn()，无解析器时可能阻塞。
        # 查看器只绑定 loopback，不需要基于 DNS 的 server name。
        if self.allow_reuse_address and hasattr(self.socket, "setsockopt"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        socketserver.TCPServer.server_bind(self)
        self.server_name = self.server_address[0]
        self.server_port = self.server_address[1]


def make_server(
    host: str = "127.0.0.1",
    port: int = DEFAULT_PORT,
    *,
    snapshot_loader: Callable[[], dict[str, list[dict[str, Any]]]] | None = None,
) -> LocalHTTPServer:
    if not _loopback(host):
        raise ConfigurationError("查看器只能绑定 loopback 地址")

    class Handler(KnowledgeViewerHandler):
        pass

    # 普通函数放到 handler 类后，从请求实例访问会隐式绑定 self。
    # 保持注入的无参 loader 为 static，使测试 loader 与生产客户端方法使用同一契约。
    Handler.snapshot_loader = staticmethod(snapshot_loader) if snapshot_loader else None
    return LocalHTTPServer((host, port), Handler)


def _serve(args: argparse.Namespace) -> int:
    if not _loopback(args.host):
        print("knowledge-viewer: host must be a loopback address", file=sys.stderr)
        return 2
    try:
        client = SupabaseClient(SupabaseConfig.from_environment())
        server = make_server(args.host, args.port, snapshot_loader=client.fetch_snapshot)
    except ConfigurationError as exc:
        print(f"knowledge-viewer: {exc}", file=sys.stderr)
        return 2
    display_host = f"[{args.host}]" if ":" in args.host else args.host
    print(f"knowledge-viewer 正在监听 http://{display_host}:{server.server_port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local read-only knowledge viewer")
    parser.add_argument("--host", default="127.0.0.1", help="loopback address to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"port (default: {DEFAULT_PORT})")
    return _serve(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
