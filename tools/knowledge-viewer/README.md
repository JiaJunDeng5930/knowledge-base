# Knowledge Viewer

Knowledge Viewer 是一个本地运行的只读知识库查看器。服务端从 Supabase Data REST API 读取知识库当前快照，浏览器只连接本地服务，不直接取得 Supabase URL 或 key。

## 启动

当前开发机器已经在 Git 忽略的 `.env` 中配置 Supabase 连接。直接运行：

```sh
tools/knowledge-viewer/run
```

然后打开 <http://127.0.0.1:8765/root>。服务默认只绑定 loopback 地址；可以用 `--port` 选择其他本地端口，`--host` 只能使用 loopback 地址。

在其他机器上运行时，先复制 `.env.example` 为 `.env` 并填入 Supabase URL 与 anon 或 publishable key。`run` 会加载该文件。`SUPABASE_KEY` 不得使用 secret 或 service-role key；真实 key 不进入 Git。

## 固定读取边界

服务只提供 `GET /api/snapshot`，由五个固定查询组成：`knowledge_record`、`knowledge_reference`、`effective_record_tag`、`fsrs` 和 `fsrs_knowledge`。每次查询持续使用分页读取至空页，返回 bigint 时保持十进制字符串。其他表、列、SQL 和写入方法没有对应端点；所有非 GET 方法返回 405。

页面提供有序森林、记录级 zoom、面包屑、折叠、直接引用、反向链接、FSRS 关联、搜索和 Shift-click 右栏。正文使用文本节点显示，不解析 Markdown，也没有编辑、删除或调度修改能力。

远端 Supabase 项目的 RLS、角色权限和 key 权限不由本 viewer 修改。当前远端配置若允许匿名读取，意味着 Supabase 项目本身仍可能提供其他访问路径；本工具的只读边界只约束本地 viewer 的 HTTP 接口。

## 验证

```sh
python3 -m unittest discover -s tools/knowledge-viewer -p 'test_*.py' -v
node tools/knowledge-viewer/test_model.mjs
```

自动化测试覆盖 bigint 字符串化、分页至空页、树与路径排序、搜索、直接引用/反向链接、FSRS 关联、loopback 绑定、GET-only HTTP 表面和错误信息脱敏。使用有效环境变量启动服务后，再检查 `/api/snapshot` 的真实连接状态；空表远端会显示空态，这是有效的连接证据。
