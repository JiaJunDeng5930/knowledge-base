# 知识库查看器约定

本文件适用于 `tools/knowledge-viewer/` 及其子目录，与仓库根目录的 `AGENTS.md` 一起使用。当前网站源码在 `site/`；`run`、`server.py` 和 `public/` 是保留的旧本地查看器。

## 产品目标与用户要求

- 网站用于方便、完整地浏览数据库中的整个知识库。保留有序目录、全文检索、上下文定位、引用关系和独立的记忆对象入口，不能缩减成精选内容或演示页面。
- 从实际阅读过程判断完成度：找到内容、连续阅读、沿关联探索、回到前文都应自然。UI、UX、信息展示是持续打磨的方向；修完已列出的问题并不自动等于完成了体验优化。
- 整体风格与连续阅读交互参考 [Andy Matuschak 的笔记网站](https://notes.andymatuschak.org/)。页内 bullet list、links（引用与内部链接）、backlinks（反向引用）的呈现和交互提示参考 [Roam Research 公共帮助图谱](https://roamresearch.com/#/app/help)。
- 同一位置避免放置功能和效果相同的多个按钮。动作优先通过图形、位置与状态表达，减少解释按钮用途的可见文字；仍须保留清楚的可访问名称、键盘焦点和必要的悬停提示。
- 文字排版应紧凑、自然，统一设计行间距及段落、列表、标题之间的节奏。保留原文、代码和来源上下文，不以截断或重复摘要替代正文阅读。
- 删除并避免重新加入“xx 条笔记”“xx 个记忆对象”“x 字符”等冗余统计。搜索匹配数量、当前阅读路径位置等直接帮助完成操作的信息可以保留。

## 必须独立维护的架构部分

所有影响阅读视觉体验的选择统一放在 `site/components/reader-presentation/`，包括字体、字号、行高、配色、布局、间距、缩进、图标、交互热区、焦点和响应式行为。公共主题变量集中声明；业务组件提供内容和状态，不在各处重复写视觉参数。JavaScript 需要实际字号或布局尺度时，从这套定义读取。

页内 bullet list、links、backlinks 进一步集中在 `reader-presentation/page-content/`，同时统一呈现模型、渲染组件和样式。正文与两个方向的引用共用内容块；引用边仍保持方向，不混入父子层级。圆点独立打开块，三角只折叠下级，折叠状态由圆环提示。引用保留完整原文和可定位的来源路径；正文与不同引用实例的展开状态分别保存，引用中的重复原文不干扰正文搜索与定位。

当用户要求把某个功能、概念或呈现方式作为源码中的专门部分实现时，必须在同一次修改中主动补充或更新本文件的索引，写明该部分的职责和实际源码入口，无须用户再次提醒。后续移动、重命名、重构或职责变化时，同步维护对应索引。

下表路径均相对于本文件所在目录。

| 需求或职责 | 源码入口 |
| --- | --- |
| 阅读呈现的公共主题、字体、字号、行高、颜色、布局及响应式规则 | [reader.css](site/components/reader-presentation/reader.css) |
| 从 CSS 读取字号设置、书脊尺度与滚动定位参数 | [metrics.ts](site/components/reader-presentation/metrics.ts) |
| 本设备字号偏好及正文、浮层之间的同步 | [use-reading-font.ts](site/components/reader-presentation/use-reading-font.ts) |
| 图标动作按钮的统一语义、名称与提示 | [icon-button.tsx](site/components/reader-presentation/icon-button.tsx) |
| 页内内容块、引用方向及来源分组模型：`PageBlock`、`ReferenceSection`、`ReferenceGroup` | [page-content/model.ts](site/components/reader-presentation/page-content/model.ts) |
| 正文与引用共用的列表、圆点、折叠和层级：`PageBlockList`、`PageBulletList` | [page-content/block-list.tsx](site/components/reader-presentation/page-content/block-list.tsx) |
| Markdown 正文、内部链接与外部链接提示：`BulletBody`、`PageLink` | [page-content/content.tsx](site/components/reader-presentation/page-content/content.tsx) |
| 引用与反向引用的来源路径和原文分组：`PageReferences` | [page-content/reference-list.tsx](site/components/reader-presentation/page-content/reference-list.tsx) |
| 页内列表、链接、引用的局部尺度、缩进、排版和交互状态 | [page-content/page-content.css](site/components/reader-presentation/page-content/page-content.css) |
| 按阅读路径保存滚动、折叠、搜索与详情状态：`ReadingViewProvider` | [reading-view.tsx](site/components/reading-view.tsx) |
| 页面、目录、搜索、记忆对象与上述模块的组合 | [knowledge-reader.tsx](site/components/knowledge-reader.tsx) |
| 样式引入与框架主题映射 | [globals.css](site/app/globals.css) |

设计背景见 [DESIGN.md](site/DESIGN.md)，开发与验证入口见 [网站 README](site/README.md)。第三方 `site/components/ui/` 保持组件库职责，阅读界面的视觉要求由上述呈现模块统一实现。

## 数据边界

沿用现有 Supabase 只读快照，遵守根目录对 bullet、引用和 FSRS 多对多关系的定义。数据入口为 [snapshot API](site/app/api/snapshot/route.ts)，读取实现为 [supabase-snapshot.ts](site/lib/supabase-snapshot.ts)。浏览不修改知识、调度状态或复习历史。连接不可用时如实显示空态或错误，仍可继续完善阅读界面。

## ChatGPT Sites 部署

| 项目 | 信息或入口 |
| --- | --- |
| 已部署网站 | [私有知识库](https://atticus-knowledge-reader.atticusdeng.chatgpt.site) |
| 访问范围 | 仅所有者可访问；继续保持私有 |
| Sites `project_id` | `appgprj_6a9da1e4a36481918905bb9619525593` |
| 项目标识的配置来源 | [site/.openai/hosting.json](site/.openai/hosting.json)；复用该项目 |
| 本仓库的网站源码 | `tools/knowledge-viewer/site/` |
| 运行与构建 | React / Vinext；Cloudflare Worker 与静态资源；见 [package.json](site/package.json)、[vite.config.ts](site/vite.config.ts) 和 [构建脚本](site/scripts/build-verified.sh) |
| 数据连接配置 | 服务端运行时环境变量 `SUPABASE_URL`、`SUPABASE_KEY`；空模板见 [site/.env.example](site/.env.example) |

Sites 使用绑定的独立源码仓库发布，本 GitHub 仓库的 `site/` 保存同一份完整源码。GitHub 同步与 Sites 发布是两项独立操作；更新网站时保持二者的源码一致。

发布沿用 Sites 技能的流程：构建并验证，将对应源码推送到该 Site 绑定的源码分支；推送成功后读取完整提交 SHA，用同一源码的构建产物保存版本，再执行私有发布并确认部署成功。版本、部署状态和临时源码凭据以 Sites 当前返回的信息为准。Supabase 密钥只放在服务端环境中，源码仓库不保存凭据、私有数据快照或构建产物。
