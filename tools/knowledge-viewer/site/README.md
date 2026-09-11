# 知识库阅读器

JiaJunDeng5930/knowledge-base 的阅读与变更预览网站，部署在仅所有者可访问的 ChatGPT Site。参考 Andy Matuschak 的 working notes，用连续的并排笔记保留探索路径。

## 浏览方式

- 知识索引和可展开目录保留数据库的有序森林；全部笔记和标签索引提供完整入口。
- 全文搜索支持多个关键词、精确编号和上下文预览。按 Command/Ctrl + K 打开。
- 点击笔记、引用或记忆关联，在当前笔记右侧打开；浏览器地址保存完整阅读路径，后退和前进恢复对应路径，已读位置在本次会话内保留。
- 笔记正文支持 Markdown、代码块和表格，也能查看原文。下级笔记可展开阅读或单独打开。
- FSRS 对象独立于 bullet 展示，包含当前 schema 的 cue、状态、共享 Scheduler 配置、全部知识关联和复习历史。
- 窄屏使用单篇阅读，上方路径选择与方向键用于切换；桌面直接通过书页和书脊导航。字号是本设备偏好。
- 桌面上已越过的页面留下窄书脊，来源链接显示后文标记；专注阅读仅隐藏其他页面，不清空路径。
- 点击父级路径展开上下文并标出原文，目录图标在当前页跳转。搜索进入长笔记后高亮原文，可在各个命中间切换。
- 滚动位置、展开状态、筛选、显示数量与详情展开保存在会话内，按阅读路径前缀隔离；刷新数据不重置阅读状态。浏览器原生后退快捷键不被占用。

## 数据边界

核心知识的权威定义仍是原仓库的 skills/knowledge-base/schema.sql。正式快照使用七个固定 Data API 查询；草稿另外读取 bullet_draft。配置保存在服务端，Supabase key 只需要 SELECT 权限。网站不向 Supabase 写入，不接受任意表名、SQL 或过滤表达式。

PostgreSQL bigint 在查询时转为 text。每张表持续分页至空页；刷新失败保留先前内容并提示重试。多个 REST 请求不构成同一数据库事务快照。

## 变更预览与批注

agent 使用原仓库 skills/knowledge-base/bullet-review/ 的 SQL 查询创建和修改 Supabase 草稿。网站在完整知识浏览界面中，以红色与减号保留原文、绿色与加号显示拟提交内容；移动保留原位置和新位置，直接标签与引用也参与 diff。草稿每次修改始终与首次正式快照比较，只有一个当前值。左侧目录用颜色与状态图标标示新增、修改、删除和移动，折叠的上级保留变更提示。

右上角的批注图标开启直接选择；单击正文写批注，Ctrl / Command 点击增减选择。批注在邻近浮层保存，已有意见通过正文旁的小图标查看。Esc 关闭浮层，再次按下退出批注模式；Ctrl / Command + Enter 保存。批注经登录与同源校验后写入 D1 的 bullet_review_comment；agent 通过 Sites 数据库工具读取，并根据用户在对话中的要求处理。agent 将完成的批注 ID 与新草稿一同保存，网站再删除对应 D1 行。页面可见时每 8 秒刷新，失败保留已显示内容与尚未保存的输入。正式提交在用户于对话中确认后由 agent 执行。

部署前需在 Supabase 安装一次预览模块的 schema.sql，并保留原正式表只读策略。草稿另用服务端 secret SUPABASE_DRAFT_READ_KEY：schema 中配置其 SHA-256 摘要，RLS 必须验证对应请求头才允许读取，凭据错误会报权限错误。原始凭据不进 Git 或浏览器；具体安装方法见预览子 skill。网站发布时会根据 .openai/hosting.json 创建 DB binding，并应用 drizzle/0000_bullet_review_comment.sql。日常修改草稿和处理批注不需要再部署。

## 开发与验证

使用 Node 24。将 .env.example 复制为被 Git 忽略的 .env，填入 SUPABASE_URL 和 SUPABASE_KEY。开发命令沿用项目脚本。

- npm run build：构建 Cloudflare Worker 与静态资源。
- npx tsc --noEmit：检查 TypeScript。
- node --test tests/knowledge-reader.test.mjs：检查阅读路径、搜索、模型关系、bigint、分页及失败语义。
- node --test tests/rendered-html.test.mjs：执行构建后的 Worker，验证中文页面、深层地址和只读 HTTP 接口。
- node --test tests/reading-content.test.mjs：渲染实际组件，验证完整正文、深层结构、缓存视图、搜索高亮与记忆关联；这不是浏览器交互测试。
- node --test tests/reading-motion.test.mjs：使用可控帧时钟验证重复导航、手动接管、边界、卸载、减少动态效果和展开后定位；这是程序测试，不能代替浏览器动画验收。
- node --test tests/bullet-review.test.mjs：验证累积 diff、移动原位置、多选批注、D1 实际 SQL 与清理重试语义。
- node --test tests/*.test.mjs：构建后执行完整测试，包括生产 Worker 的批注登录与同源边界。
- 原仓库 tools/test_bullet_review.py 生成独立 PostgreSQL schema 内的事务测试，使用 SQL 工具执行后回滚，覆盖草稿保存、提交冲突、临时 ID、结构、引用、标签与 FSRS 保护。

关键代码位于 components/knowledge-reader.tsx、components/reading-view.tsx、components/reader-presentation/、lib/reading-path.ts、lib/reading-highlight.ts、lib/knowledge-model.js 和 lib/supabase-snapshot.ts。原查看器的模型算法保留在 knowledge-model.js，部署适配在 app/api/snapshot/route.ts。

网站通过 Sites 独立源码仓库发布，完整源码同步到 JiaJunDeng5930/knowledge-base 的 tools/knowledge-viewer/site/。正式知识与 FSRS 保持原有 schema；预览存储独立维护。

## 阅读呈现模块

所有影响阅读视觉的选择集中在 components/reader-presentation/。reader.css 顶部的 :root 定义字体、字号层次、四种行高（正文、标题、界面、代码）、配色、间距、页宽、缩进、书脊、图标、热区和表面效果；页内 bullet、链接与反向引用进一步集中在 page-content/：model.ts 定义块及来源分组，block-list.tsx 与 reference-list.tsx 共用块呈现，content.tsx 处理 Markdown 和链接，page-content.css 定义局部尺度、缩进和交互状态。正文与引用共享字体和行高，引用的展开状态单独保存。其余样式与响应式规则保留在 reader.css。app/globals.css 只负责引入和框架映射。

metrics.ts 读取 CSS 的实际布局值，避免 JS 与 CSS 维护两套书脊尺寸或断点。use-reading-font.ts 管理本设备字号偏好，并使正文与浮层同步。icon-button.tsx 统一动作按钮的语义、名称和提示。业务组件只传递内容层级和页序；不再写字号、颜色、行高、间距或图标大小。第三方 components/ui 保持原样。

批注与 diff 的程序实体、模块职责及源码入口见 [AGENTS.md](AGENTS.md)。

阅读动画作为独立模块维护在 `components/reader-presentation/reading-motion/`，统一承载滚动、书页过渡、书脊反馈、正文与目录展开、浮层过渡和减少动态效果支持。业务组件通过 `index.ts` 的接口传递阅读状态并发起导航，时长与缓动沿用 `reader.css` 的公共参数。各程序实体与调用约定见 [阅读动画索引](AGENTS.md#阅读动画的程序实体)。
