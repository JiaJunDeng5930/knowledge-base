# 知识库网站约定

本目录同时维护于 Sites 源码仓库与 `JiaJunDeng5930/knowledge-base` 的 `tools/knowledge-viewer/site/`。修改时同步两处源码，复用 `.openai/hosting.json` 指定的网站并保持私有访问。

保留完整知识浏览能力和连续阅读体验。视觉参数与交互呈现集中在 `components/reader-presentation/`；使用同一套字体、间距和图标规则。正文保持完整，操作按需出现，不添加逐条工具栏或冗余说明。

## 阅读动画的程序实体

`components/reader-presentation/reading-motion/` 是阅读动画的独立模块，公共入口为 [index.ts](components/reader-presentation/reading-motion/index.ts)。页面负责阅读路径、当前页与展开状态，动画模块负责把这些变化连续呈现。页面不得自行实现逐帧动画、缓动、滚动取消或动画完成后的清理。公共时长、缓动和位移参数仍统一声明在 [reader.css](components/reader-presentation/reader.css)。

| 程序实体 | 职责与源码入口 |
| --- | --- |
| `useReadingStackMotion` | [use-reading-stack-motion.ts](components/reader-presentation/reading-motion/use-reading-stack-motion.ts) 管理书页引用、可见书脊、激活页对齐、布局变化前的位置捕获、书页位移和生命周期；页面通过 `preparePathChange`、`prepareLayoutChange`、`activate` 与 `onStackScroll` 调用。 |
| `scrollReadingTo`、`cancelReadingScroll`、`scrollReadingTarget` | [scroll.ts](components/reader-presentation/reading-motion/scroll.ts) 负责单一滚动目标、重复导航接续、手动接管、目标边界、展开完成后的原文定位，以及减少动态效果设置；`scrollReadingTo` 供模块内部使用。 |
| `ReadingCollapse`、`ReadingCollapseTrigger`、`ReadingCollapseContent` | [reading-collapse.tsx](components/reader-presentation/reading-motion/reading-collapse.tsx) 统一目录和正文的展开组件；使用已有 Radix Collapsible，关闭期间立即禁用交互，退出结束后卸载内容。 |
| CSS 过渡与关键帧 | [reading-motion.css](components/reader-presentation/reading-motion/reading-motion.css) 统一书页、书脊、展开、图标、浮层、侧栏与减少动态效果规则；支持原生 `details` 高度插值的浏览器同时使用详情展开动画。 |

首次恢复阅读位置直接对齐；用户主动导航使用动画。每个滚动容器同时只有一个目标，新导航替换旧目标，滚轮、触摸、按下指针和键盘操作取消自动滚动。动画期间的可见面积变化不能抢走指定的当前页。模块只管理呈现，不读取知识或修改数据库。

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
