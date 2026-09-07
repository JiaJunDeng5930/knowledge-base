# 知识库网站约定

本目录同时维护于 Sites 源码仓库与 `JiaJunDeng5930/knowledge-base` 的 `tools/knowledge-viewer/site/`。修改时同步两处源码，复用 `.openai/hosting.json` 指定的网站并保持私有访问。

保留完整知识浏览能力和连续阅读体验。视觉参数与交互呈现集中在 `components/reader-presentation/`；使用同一套字体、间距和图标规则。正文保持完整，操作按需出现，不添加逐条工具栏或冗余说明。

## 批注与 diff 的程序实体

批注和 diff 分别作为独立模块维护。修改一个概念的显示或交互规则时，首先进入下表指定的模块；页面和目录只组合模块提供的组件。新增调用位置不应产生另一份规则。移动、重命名或改变职责时，同次更新本索引。

| 概念与程序实体 | 职责与源码入口 |
| --- | --- |
| 差异模型：`BulletChange`、`bulletChanges`、`bulletChangedAncestors` | [lib/bullet-diff.ts](lib/bullet-diff.ts) 比较固定原文与最新草稿，计算直接差异与包含变化的上级；移动同时影响原分支和目标分支。 |
| diff 呈现模块：`BulletDiffContent`、`BulletDiffNavigationLabel`、`BulletDiffMark`、`BulletDiffMenu` | [bullet-diff.tsx](components/reader-presentation/bullet-diff.tsx) 与 [bullet-diff.css](components/reader-presentation/bullet-diff.css) 统一负责正文、位置、标签、引用和目录状态的呈现。状态图标与名称集中定义，不分散到目录或页面组件。 |
| 批注交互模块：`useBulletAnnotation`、`BulletAnnotationControl`、`BulletCommentPin`、`BulletCommentPopover` | [bullet-annotations.tsx](components/reader-presentation/bullet-annotations.tsx) 与 [bullet-annotations.css](components/reader-presentation/bullet-annotations.css) 负责选择热区、多选、圆点反馈、入口、浮层及批注输入。 |
| 共享预览会话：`BulletReviewProvider` | [bullet-review-context.tsx](components/bullet-review-context.tsx) 连接草稿与批注数据，维护刷新、选择及保存状态；差异派生计算调用差异模型，页面不自行比较内容。 |
| 草稿与批注传输契约：`BulletDraft`、`ReviewComment`、`BulletReview` | [lib/bullet-review.ts](lib/bullet-review.ts) 负责数据契约、草稿校验与预览快照。 |
| 批注持久化：`readBulletReview`、`saveReviewComment` | [bullet-review-store.ts](lib/bullet-review-store.ts) 负责 D1 保存、重试去重和按已处理 ID 清理批注；[批注 API](app/api/bullet-review/comments/route.ts) 负责登录和同源检查。 |

Supabase 保存固定 `base` 与最新 `proposed`，网站只读取；D1 保存网站批注。正式知识只在用户于对话中明确确认后由 agent 提交。UI 修改和网站发布不等于确认知识变更；网站不提供正式提交按钮。详细行为与既有阅读架构见 [DESIGN.md](DESIGN.md)。
