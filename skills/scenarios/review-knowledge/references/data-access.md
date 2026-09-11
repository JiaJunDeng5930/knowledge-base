# 数据接入与保存

## 已配置的目标与共用模块

使用 Supabase 项目 `bfjvqvedxctfyeqnufke`，通过已授权的 `execute_sql` 工具读写。工具需要 `project_id` 和 `query`。用户已经指定其他知识库时，以其明确指定的目标为准；不要在已有目标时重复询问项目。

复习语义由本 skill 完整给出。数据定义和计算实现复用仓库中的唯一权威模块，由 agent 自动读取；用户只需调用 `review-knowledge`。

仓库为 [JiaJunDeng5930/knowledge-base](https://github.com/JiaJunDeng5930/knowledge-base)，默认分支为 `main`。以下路径相对仓库根目录：

| 何时读取 | 路径与用途 |
| --- | --- |
| 开始复习 | `skills/knowledge-base/SKILL.md`：知识的组织、上下文读取与维护规则。 |
| 开始复习 | `skills/knowledge-base/schema.sql`：表、字段和约束的唯一权威定义。 |
| 开始复习 | `skills/knowledge-base/fsrs/SKILL.md`：原生状态、计算脚本和 SQL 交换方式。 |
| 第一次保存新知识草稿 | `skills/knowledge-base/bullet-review/SKILL.md`：当前草稿的创建、补丁、预览及确认后提交。 |

优先读取当前仓库检出中的文件。在本 skill 被单独安装、共用模块未在相邻目录时，通过 GitHub 连接读取同一仓库的上述路径，例如 `https://github.com/JiaJunDeng5930/knowledge-base/blob/main/skills/knowledge-base/SKILL.md`。不要要求用户补交这些已知材料。

计算需要 Python 3 和仓库随附的 py-fsrs。优先使用已有检出；缺少本地副本时取得该仓库，将 `skills/knowledge-base/fsrs/scripts/fsrs_data.py` 与 `skills/knowledge-base/fsrs/third_party/py-fsrs/` 保持原目录关系。Git 克隆不可用时，可通过 GitHub 文件接口取得这些文件。基础复习计算使用 Python 标准库及随附源码，不需要安装优化器依赖，不另装一个未固定版本的 FSRS 实现。

读取本次实际使用的 SQL 模板后执行。支持参数绑定时直接绑定；接口只接收 SQL 文本时，把模板中 `$1` 替换为对应 SQL 字面量。JSON 先序列化，外层单引号包裹，内容中的单引号写成两个单引号。不要将知识正文当作 SQL 代码。

## 读取到期对象与关联知识

执行本 skill 的 [read-due-fsrs.sql](../queries/read-due-fsrs.sql)，`$1` 为配置 JSON，默认传 `{}`：

| 字段 | 默认值与用途 |
| --- | --- |
| `root_bullet_id` | `null`：全库。指定时筛选至少关联该 bullet 或其后代的 cue。 |
| `excluded_fsrs_ids` | `[]`：本次暂缓或用户跳过的 cue id；仅影响当前会话。 |
| `limit` | `20`：每批读取数量，不是一次复习的数量上限。 |

查询按数据库当前时刻判断是否到期，返回 id、cue 和 due_at，id 使用十进制字符串。用户指定的主题涉及多个子树时，可以分别查询并按 cue id 去重。标签或其他语义范围由 agent 依据正式知识定位，不能仅按 cue 文本是否包含关键词判断范围。

对当前对象执行 [read-review-material.sql](../queries/read-review-material.sql)，`$1` 为该对象 id。它返回 cue、直接关联的 bullet id 列表、这些 bullet 及全部祖先的正文与引用目标 id。`associated_bullet_ids` 区分关联知识与仅用于理解上下文的祖先。

根据语义继续读取必要子节点、引用目标和对应图片等材料。一个关联 bullet 是主题节点时，其所需知识可能位于后代。查询或工具返回被截断时，按 id 分批读取，不能把未返回的部分当作不存在。草稿内容尚未成为正式知识，不用于悄悄改变本次评分范围。

## 计算与保存一次复习

1. 取得足够评分证据后，读取 `skills/knowledge-base/fsrs/queries/read-fsrs-snapshot.sql`，以当前 cue 的 id 查询完整 `snapshot`。核对目标仍对应本次出题的 cue 与关联知识。
2. 构造输入 JSON：`snapshot` 原样使用查询结果，`rating` 为 1–4，`review_datetime` 为本次完成考察、给出纠正前确定的实际事件时间，必须带时区；普通对话的 `review_duration` 为 `null`。在同一事件的重试中保留原时间与输入，不重新创建事件。
3. 将 JSON 传给现有脚本，例如从仓库根目录执行：

   ```bash
   python3 skills/knowledge-base/fsrs/scripts/fsrs_data.py review review-input.json
   ```

4. 脚本返回 `card` 和 `review_log`。读取 `skills/knowledge-base/fsrs/queries/save-fsrs-review.sql`，把脚本完整输出作为 `$1`，通过数据库接口执行。该语句一起更新 Card 状态并追加 ReviewLog；返回目标 id 后才确认保存成功。
5. 保存前若发现其他会话已更新该 cue 的状态或内容，重新核对，不以旧快照覆盖新状态。超时或结果不确定时，查询 `fsrs_review` 中该 `fsrs_id`、`review_datetime` 对应的记录以及当前状态；已存在相同事件时不再次执行保存。无法排除重复时停止重试，保留待核对事件。

不得仅因展示题目、回答追问或保存知识草稿而追加复习日志。评分不确定、用户跳过或材料有问题时保留原状态。

## 保存追问知识与复习后的预览

按共用 bullet-review 模块读取当前草稿，执行其 `queries/start-draft.sql` 复用或创建唯一草稿，再用 `queries/save-draft.sql` 写入本次字段补丁。保留原始 `base` 和其他 `proposed` 内容，不覆盖整个草稿。新增 bullet 使用草稿内尚未使用的负数临时 id，并提供完整正文、父节点、深度、同级顺序、直接标签和引用。

草稿中同一知识已存在时更新合适节点；原知识仅需补充时对原 id 作字段补丁，不重复创建。新增知识使用已有主题与子弹笔记组织方式。普通追问不会处理网站批注，保存补丁时不要顺带确认无关批注。

正式知识和草稿均由 Supabase 保存。复习中的 FSRS 状态与日志直接保存，bullet 变更留在草稿。预览入口为 [知识库网站](https://atticus-knowledge-reader.atticusdeng.chatgpt.site)。复习结束后提供该链接；只在用户之后明确批准当前整体 diff 时，才依共用模块执行提交。不要在本场景中修改网站或部署数据库 schema。
