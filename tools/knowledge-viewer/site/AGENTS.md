# 知识库网站约定

本目录同时维护于 Sites 源码仓库与 `JiaJunDeng5930/knowledge-base` 的 `tools/knowledge-viewer/site/`。修改时同步两处源码，复用 `.openai/hosting.json` 指定的网站并保持私有访问。

保留完整知识浏览能力和连续阅读体验。全站配色集中在顶层 `theme/`；阅读的字体、间距、图标、布局与交互呈现集中在 `components/reader-presentation/`。正文保持完整，操作按需出现，不添加逐条工具栏或冗余说明。

## 网站配色的程序实体

`theme/colors.css` 是全站配色的唯一入口，由 `app/globals.css` 加载。`--site-*` 声明正文、表面、链接、状态、图表与透明阴影的语义颜色，同时桥接组件库变量和既有 `--reader-*`、`--diff-*`、`--annotation-*` 变量。业务组件与功能样式引用这些变量，不另建色板或散落颜色字面量。第三方组件保留原实现，由顶层语义变量控制当前站点表面。字体、尺寸与动画参数仍由各自呈现模块维护。

## 统计的程序实体

`features/statistics/` 独立负责整个知识库的统计；公共入口为 `index.ts`。阅读器提供正式 `Snapshot`、当前时刻、导航回调与阅读视图会话；统计模块拥有筛选、计算、图表和明细。FSRS 与 bullet 按多对多关系去重；草稿与网站批注不混入正式知识统计。

| 程序实体 | 职责与源码入口 |
| --- | --- |
| `StatisticsPage`、`StatisticsViewState` | `statistics-page.tsx` 组合范围筛选、指标图表与共享明细；视图状态按阅读路径保存，明细链接继续现有阅读路径。全局统计入口只有一个。 |
| 统计计算 | `statistics-model.ts` 统一自然日、范围继承、多对多计数、逐日知识历史、复习日历、保留率、FSRS 分布和到期安排。页面不复制计算规则。 |
| 图表呈现 | `statistics-charts.tsx` 负责逐日折线、直方图、累计比例与 自然年热力图，包含指针和键盘选择；`statistics.css` 负责统计布局并引用全站配色。 |
| 历史传输 | `statistics-history.ts` 定义仅含统计元数据的历史载荷、校验与固定 Supabase GET；`app/api/statistics/history/route.ts` 校验网站登录并保留错误语义。 |
| 数据库历史投影 | `history.sql` 安装 `read_knowledge_statistics_history()`；先校验已有专用读取凭据，再把当前数据和审计记录投影成字符数、身份、父关系与标签。正文不通过此接口返回，不开放原始审计表。 |

时间序列逐日呈现，不添加 7 / 30 / 90 天切换。每日复习固定显示所选自然年的 1 月 1 日至 12 月 31 日（闰年 366 天）；历史展示实际评分，今天同时显示完成记录和待复习对象，未来展示当前下一次到期，今天以前到期的对象单独汇总；空样本保留率留空，读取失败不伪装成零。详细统计口径与部署依赖见 `DESIGN.md`，计算与权限边界的验证见 `tests/statistics.test.mjs`。

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
