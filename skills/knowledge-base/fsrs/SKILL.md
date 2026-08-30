---
name: fsrs
description: 处理知识库中的 FSRS-6 数据时按需加载。解释记忆状态与算法参数，使用随附 py-fsrs 脚本完成计算，并指导 agent 在计算工具与数据库接口之间传递数据。
---

# FSRS 数据

FSRS（Free Spaced Repetition Scheduler）根据带时间的复习评分估计记忆状态，并据此计算下次到期时间。本模块使用随附的 [py-fsrs](third_party/py-fsrs/README.md) 实现。版本与来源见 [UPSTREAM.md](third_party/py-fsrs/UPSTREAM.md)。

稳定性 S 表示回忆概率下降到 90% 所需的天数。难度 D 表示模型估计的记忆难度，取值为 1 到 10。可提取性 R 是模型估计的当前回忆概率，随距上次复习的时间变化；R 由脚本按查询时间计算。

## 持久化数据

操作数据库前读取 [schema.sql](../schema.sql)。该文件是字段与约束的唯一权威定义。FSRS 数据由以下四个表共同保存：

| 表 | 保存的内容 |
| --- | --- |
| `scheduler_config` | 完整的原生 Scheduler 配置；一条配置可以供多个 FSRS 对象使用。 |
| `fsrs` | 每个对象的当前 Card 状态及其 `scheduler_config_id`。 |
| `fsrs_knowledge` | FSRS 对象与知识记录的多对多关联。每个对象至少关联一条知识记录。 |
| `fsrs_review` | 每次复习的原生 ReviewLog 数据。优化器从这些历史数据重建各对象的记忆变化。 |

对象的 `id` 对应 py-fsrs 的 `card_id`。对象的粒度由所需的记忆状态决定；一个对象可以关联多条知识记录，一条知识记录也可以供多个对象使用。多个对象可以通过同一个 `scheduler_config_id` 共用配置。

Card 的 `state` 使用上游的完整状态集合：

| 值 | 状态 | `step` 的含义 |
| --- | --- | --- |
| 1 | Learning | 当前学习步骤的索引，从 0 开始。 |
| 2 | Review | 使用复习间隔，`step` 为 `null`。 |
| 3 | Relearning | 当前重新学习步骤的索引，从 0 开始。 |

新对象从 Learning 的第 0 步开始。此时 S 和 D 尚未估计，最后复习时间也为空。复习后由 py-fsrs 生成完整的新状态。数据库中的 `stability_days` 对应原生 Card 的 `stability`；快照查询负责字段转换。

ReviewLog 的评分 `rating` 使用下方参数表中的 G 编码。`review_datetime` 保存事件发生时间；`review_duration` 保存耗时，单位为毫秒，未记录时为 `null`。输入时间必须带时区，脚本统一转换为 UTC。

## 调度配置

`scheduler_config.scheduler` 保存完整的原生 Scheduler 配置。下表覆盖该配置的全部字段；默认值通过 `settings` 命令取得。

| 字段 | 含义 |
| --- | --- |
| `parameters` | FSRS-6 的 21 个模型参数，依索引排列。 |
| `desired_retention` | 计算间隔时使用的期望保留率，取值大于 0 且不超过 1。 |
| `learning_steps` | Learning 的步骤间隔，单位为秒；空数组表示不使用这些步骤。 |
| `relearning_steps` | Relearning 的步骤间隔，单位为秒；空数组表示不使用这些步骤。 |
| `maximum_interval` | 调度允许的最大间隔，单位为天。 |
| `enable_fuzzing` | 是否按上游实现对到期间隔施加随机扰动。 |

## 模型参数

FSRS-6 使用 `w0` 到 `w20` 共 21 个参数。参数控制模型如何从观测估计记忆状态，同一适用范围内的对象使用同一组模型参数；每个对象分别保存自己的 S 和 D。

参数集保存在 `scheduler_config.scheduler.parameters` 中。新配置的默认参数由随附实现提供；根据历史拟合得到的参数也使用这一字段。

下表按参数索引解释完整的参数集。G 是观测评分的编码：其取值在初始化稳定性对应的四行中给出。

| 参数 | 在 FSRS-6 中的作用 |
| --- | --- |
| `w0` | G = 1（Again）对应的初始稳定性，单位为天。 |
| `w1` | G = 2（Hard）对应的初始稳定性，单位为天。 |
| `w2` | G = 3（Good）对应的初始稳定性，单位为天。 |
| `w3` | G = 4（Easy）对应的初始稳定性，单位为天。 |
| `w4` | 初始难度的基准，对应 G = 1 时未经范围裁剪的初始难度。 |
| `w5` | 初始难度随 G 变化的幅度。 |
| `w6` | 后续难度随 G 变化的幅度。 |
| `w7` | 难度向初始 Easy 难度回归的权重。 |
| `w8` | 成功回忆后稳定性增长的整体尺度。 |
| `w9` | 成功回忆后的增长对原稳定性的依赖强度。 |
| `w10` | 成功回忆后的增长对原可提取性的依赖强度。 |
| `w11` | 遗忘后稳定性的整体尺度。 |
| `w12` | 遗忘后稳定性对难度的依赖强度。 |
| `w13` | 遗忘后稳定性对原稳定性的依赖强度。 |
| `w14` | 遗忘后稳定性对原可提取性的依赖强度。 |
| `w15` | G = 2（Hard）对成功回忆后稳定性增长的乘数。 |
| `w16` | G = 4（Easy）对成功回忆后稳定性增长的乘数。 |
| `w17` | 短期稳定性更新中，评分影响的尺度。 |
| `w18` | 短期稳定性更新中，评分项的偏移量。 |
| `w19` | 短期稳定性更新对原稳定性的衰减指数。 |
| `w20` | 遗忘曲线的正衰减参数，决定曲线形状。 |

参数作用依据 [FSRS 算法定义](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)及 [py-fsrs 6.3.2 实现](https://github.com/open-spaced-repetition/py-fsrs/blob/9446cb06605c597a063aeee49f7d188d42e34dc2/fsrs/scheduler.py)。FSRS-6 的遗忘曲线使用 `w20`；读取其他版本的参数时，需要先确认对应模型版本。

## 计算脚本

脚本入口为 [scripts/fsrs_data.py](scripts/fsrs_data.py)。以下命令均在本子 skill 目录执行。完整依赖组合需要 Python 3.12 或更新版本：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

py-fsrs 本身已保存在 `third_party/py-fsrs/`，脚本直接加载该副本。`requirements.txt` 固定优化器使用的第三方依赖；基础状态计算只使用 Python 标准库和随附源码。

调用格式为：

```bash
.venv/bin/python scripts/fsrs_data.py review review-input.json
```

命令后的路径是输入 JSON 文件。省略路径或使用 `-` 时从标准输入读取；单独调用 `settings` 则直接输出默认配置。标准输出是一份 JSON，运行信息与错误写入标准错误。

脚本公开的全部命令如下。表中的 `snapshot` 是数据库查询返回的完整快照；`scheduler` 是原生配置对象；`review_logs` 是原生 ReviewLog 数组。

| 命令 | 输入 JSON | 输出 JSON |
| --- | --- | --- |
| `settings` | 可选的配置字段；未提供的字段采用上游默认值。 | 完整 Scheduler 配置。 |
| `review` | `snapshot` 加本次事件的 `rating`。可选 `review_datetime` 和 `review_duration`；时间省略时使用当前 UTC 时间。 | 用于保存的 `card` 和 `review_log`。 |
| `retrievability` | `snapshot`；可选 `current_datetime`，省略时使用当前 UTC 时间。 | `retrievability`。 |
| `optimize-parameters` | `scheduler` 与 `review_logs`。 | 含新参数集的 `scheduler`。 |
| `optimize-retention` | `scheduler` 与 `review_logs`。 | 含新期望保留率的 `scheduler`。 |
| `reschedule` | `snapshot`、要采用的 `scheduler` 和该对象的完整 `review_logs`。 | 用于保存的 `card`。 |

### 与数据库交换数据

agent 通过当前任务已配置且已授权的数据库接口读取数据，并把读取结果作为 Python 脚本的输入。Python 返回计算结果后，agent 再通过数据库接口保存结果。两个执行环境之间由 agent 传递 JSON 数据。

以下查询资料供支持 SQL 的数据库接口使用。每个文件中的 `$1` 表示一个调用参数；接口支持参数绑定时直接绑定，接口只接收 SQL 文本时将其替换为对应的 SQL 字面量。JSON 字面量用单引号包裹，其中的单引号写成两个单引号。

| 查询资料 | 参数 | 返回值 |
| --- | --- | --- |
| [create-scheduler-config.sql](queries/create-scheduler-config.sql) | 完整 Scheduler 配置 JSON；配置可用 `settings` 取得。 | 新配置的 `id`。 |
| [create-fsrs.sql](queries/create-fsrs.sql) | 包含 `record_ids` 与 `scheduler_config_id` 的 JSON；可选 `due_at`。 | 新对象的 `id`；对象与知识关联在同一语句中建立。 |
| [read-fsrs-snapshot.sql](queries/read-fsrs-snapshot.sql) | 对象 id。 | Python 所需的 `snapshot`。 |
| [read-fsrs-review-logs.sql](queries/read-fsrs-review-logs.sql) | 对象 id 数组。 | 按事件时间排序的 `review_logs`。 |
| [save-fsrs-review.sql](queries/save-fsrs-review.sql) | `review` 命令的完整输出 JSON。 | 已保存对象的 `id`。 |
| [save-fsrs-reschedule.sql](queries/save-fsrs-reschedule.sql) | 包含 `reschedule` 输出的 `card` 与目标 `scheduler_config_id` 的 JSON。 | 已保存对象的 `id`。 |

例如，将数据库查询返回的 `snapshot` 保存为 `snapshot.json` 后，可以构造一次评分为 3、耗时为 2400 毫秒的计算输入：

```bash
jq '{snapshot: ., rating: 3, review_duration: 2400}' snapshot.json |
  .venv/bin/python scripts/fsrs_data.py review -
```

agent 将输出 JSON 作为 `save-fsrs-review.sql` 的参数，交给数据库接口执行。该语句在同一事务中保存状态与对应历史。数据库接口返回已修改的记录后，本次结果才完成持久化。

### 使用历史进行优化

`optimize-parameters` 调用上游 `Optimizer.compute_optimal_parameters`。输入历史应来自准备共用这组参数的对象，每条日志保留原来的 `card_id`。当前上游对每个对象只使用最早 64 条日志，并统计其中处于 Review 状态的记录。可训练记录不足 512 条时，上游返回默认参数，没有执行参数训练。这些取值来自随附版本的 [optimizer.py](third_party/py-fsrs/fsrs/optimizer.py)。

`optimize-retention` 调用上游 `Optimizer.compute_optimal_retention`，根据复习耗时估计期望保留率。该接口要求至少 512 条日志，并且每条日志的 `review_duration` 都有值。这里的门槛同样由上游实现规定。

优化命令返回新的配置。采用新配置时，agent 先执行 `create-scheduler-config.sql` 创建一条共享配置，再读取每个目标对象的当前快照与完整历史并交给 `reschedule` 重算。agent 将输出的 `card` 与新配置的 `scheduler_config_id` 交给 `save-fsrs-reschedule.sql`，使所有目标对象改用同一条配置。历史中的最新事件应与快照的最后复习时间一致；重算本身不产生一次新的复习事件。

修改本模块时，先读取 [DECISIONS.md](../DECISIONS.md)。
