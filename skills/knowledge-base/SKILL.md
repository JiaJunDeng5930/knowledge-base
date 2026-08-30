---
name: knowledge-base
description: 在需要读取或维护个人知识库时使用。指导模型按共同约定操作 PostgreSQL / Supabase 中的知识数据，可由认知活动的场景 skill 调用。
---

# 知识库

本 skill 规定知识数据的共同使用方式。知识库使用子弹笔记组织正文，数据库结构帮助模型定位和维护内容。

## 数据定义与按需资料

当前知识模型的唯一权威定义是本目录的 [schema.sql](schema.sql)。需要确认字段或约束，以及编写 SQL 时，读取该文件。知识模型的数据库结构变更以该文件为维护入口。

[change-history.sql](change-history.sql) 定义独立于当前知识模型的行级变更历史。该文件在 `schema.sql` 之后安装，覆盖全部持久化业务表。

涉及 FSRS 数据或计算时，读取 [FSRS 子 skill](fsrs/SKILL.md)。该模块解释完整的 FSRS 数据与参数，并说明 agent 如何在计算脚本与数据库接口之间传递数据。

## 子弹笔记

数据库使用 `bullet` 表以及 `parent_id`、`depth` 和 `sibling_order` 保存子弹笔记的有序森林。

### 引用与标签

| 结构 | 用途 |
| --- | --- |
| bullet 引用 | 从一个 bullet 取得另一个 bullet 提供的相关上下文。具体相关部分由正文表达，读取后再判断。 |
| 标签 | 标记一个 bullet 及其后代的共同用途。只写直接标签，通过 `effective_bullet_tag` 读取继承后的有效标签。 |

## 内容归置

采用以下根 bullet 用途约定。表中的名称用作根 bullet 的正文。

| 根 bullet 正文 | 内容的组织目的 |
| --- | --- |
| `source` | 按来源材料自身的结构保存内容。一本教材可以作为该根 bullet 的子 bullet，其下保留教材的章节层级。 |
| `knowledge` | 围绕主题组织和维护知识内容。整理得到的理解与用户形成的私知识都可以进入相应主题。 |

两处内容使用同一种 bullet。需要从主题内容回溯来源时，可以建立指向来源 bullet 的 bullet 引用。

材料本身附有来源信息时，可以将该信息放在材料 bullet 的正文中。正在整理的内容可以在所在子树上附加 `working` 标签；后代通过继承取得这一用途标记。

根 bullet 名称用于定位，后续操作使用查询得到的 `id`。已有数据库采用不同组织方式时，先依据实际内容确认位置。只有当前写入任务需要的根 bullet 尚不存在时，才创建对应 bullet。

## 读取与维护

通过当前任务已配置且已授权的 SQL 执行工具访问目标数据库，例如 Supabase MCP 的 `execute_sql`。目标数据库尚未确定时，先确认目标。操作正文使用数据查询与写入语句；`schema.sql` 保存数据库对象的定义。

可以从根 bullet 取得数据库的组织入口：

```sql
select id, body, sibling_order
from public.bullet
where parent_id is null
order by sibling_order;
```

检索命中 bullet 后，根据子弹笔记、bullet 引用和当前问题补充上下文。

更新既有 bullet 时，保留其 `id`，使已有关系继续指向同一 bullet。需要新增内容时，创建新的 bullet。

移动子树时，依据新位置调整整棵子树的深度。将节点的父关系变更与必要的深度调整放在同一事务中，使提交后的结构满足 schema。调整同级顺序时，同样利用事务完成整体修改；顺序值只表示先后，不要求连续。

删除 bullet 前，读取相关的结构依赖，并按当前任务明确的删除范围处理。涉及 FSRS 关联时，按需读取 FSRS 子 skill，保持对应的数据约束。

### 变更历史与恢复

安装 `change-history.sql` 后，业务表中已经提交的 `INSERT`、`UPDATE` 和 `DELETE` 会自动写入 `audit.row_change`。同一事务产生的记录拥有相同的 `transaction_id`；`id` 表示事务内的变更顺序。`old_row` 与 `new_row` 保存对应行在变更前后的完整 JSONB 快照。

发现误操作时，先按 `transaction_id` 读取全部相关记录，并依据当前 schema 在一个事务中生成逆向数据操作。恢复操作本身继续形成新的变更历史；不要修改或删除原历史记录。

Supabase 插件通过 `postgres` 访问数据库，因此 `audit` schema 只隔离数据用途，不限制插件。行级历史处理普通数据误操作；项目外数据库导出处理 `TRUNCATE`、DDL、trigger 或历史表本身被错误修改的情况。

修改本 skill 时，先读取 [DECISIONS.md](DECISIONS.md) 中的用户决策。
