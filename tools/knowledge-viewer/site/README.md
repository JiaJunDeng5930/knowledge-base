# 知识库阅读器

为 JiaJunDeng5930/knowledge-base 重写的只读网站，部署在仅所有者可访问的 ChatGPT Site。参考 Andy Matuschak 的 working notes，用连续的并排笔记保留探索路径。

## 浏览方式

- 知识索引和可展开目录保留数据库的有序森林；全部笔记和标签索引提供完整入口。
- 全文搜索支持多个关键词、精确编号和上下文预览。按 Command/Ctrl + K 打开。
- 点击笔记、引用或记忆关联，在当前笔记右侧打开；浏览器地址保存完整阅读路径，后退和前进恢复对应路径，已读位置在本次会话内保留。
- 笔记正文支持 Markdown、代码块和表格，也能查看原文。下级笔记可展开阅读或单独打开。
- FSRS 对象独立于 bullet 展示，包含当前 schema 的 cue、状态、共享 Scheduler 配置、全部知识关联和复习历史。
- 窄屏使用单篇阅读，顶部路径和底部前后按钮用于切换；字号是本设备偏好。
- 桌面上已越过的页面留下窄书脊，来源链接显示后文标记；专注阅读仅隐藏其他页面，不清空路径。
- 「在上下文中看」展开父级并标出原文，「本篇目录」在当前页跳转。搜索进入长笔记后高亮原文，可在各个命中间切换。
- 滚动位置、展开状态、筛选、显示数量与详情展开保存在会话内，按阅读路径前缀隔离；刷新数据不重置阅读状态。浏览器原生后退快捷键不被占用。

## 数据边界

权威定义仍是原仓库的 skills/knowledge-base/schema.sql。这里只读取七个固定 Data API 查询，不接受任意表名、SQL、过滤表达式或写入请求。配置保存在服务端，客户端只访问 GET /api/snapshot。使用现有的 Supabase publishable key 及 anon 只读策略，不修改数据库权限。

PostgreSQL bigint 在查询时转为 text。每张表持续分页至空页；刷新失败保留先前内容并提示重试。多个 REST 请求不构成同一数据库事务快照。

## 开发与验证

使用 Node 24。将 .env.example 复制为被 Git 忽略的 .env，填入 SUPABASE_URL 和 SUPABASE_KEY。开发命令沿用项目脚本。

- npm run build：构建 Cloudflare Worker 与静态资源。
- npx tsc --noEmit：检查 TypeScript。
- node --test tests/knowledge-reader.test.mjs：检查阅读路径、搜索、模型关系、bigint、分页及失败语义。
- node --test tests/rendered-html.test.mjs：执行构建后的 Worker，验证中文页面、深层地址和只读 HTTP 接口。
- node --test tests/reading-content.test.mjs：渲染实际组件，验证完整正文、深层结构、缓存视图、搜索高亮与记忆关联；这不是浏览器交互测试。

关键代码位于 components/knowledge-reader.tsx、components/reading-view.tsx、app/globals.css、lib/reading-path.ts、lib/reading-highlight.ts、lib/knowledge-model.js 和 lib/supabase-snapshot.ts。原查看器的模型算法保留在 knowledge-model.js，部署适配在 app/api/snapshot/route.ts。

本目录保存已部署网站的源码，来源为 Sites 源码提交 `7225b1a76906ece151c46da06cae0369065450ad`；网站实现、依赖锁文件与该发布一致。`.openai/hosting.json` 标识现有私有 Site，运行时凭据保存在 Sites 环境中。向 GitHub 提交源码不会重新部署网站。本网站不修改核心 schema 或知识数据。
