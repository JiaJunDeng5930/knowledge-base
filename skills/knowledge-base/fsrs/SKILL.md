---
name: fsrs
description: 解释知识库中的 FSRS-6 数据与模型参数，并根据已有记忆状态计算派生值。在处理 FSRS 对象或理解其数值时按需加载。
---

# FSRS 数据

FSRS（Free Spaced Repetition Scheduler）是一种根据历史观测估计记忆状态、预测记忆保持概率的算法。当前知识库采用 FSRS-6。每个 FSRS 对象拥有独立的记忆状态，其粒度由需要表达的记忆对象决定。

## 持久化数据

字段和数据库约束以 [schema.sql](../schema.sql) 为准。下表解释 `public.fsrs` 的全部字段。

| 字段 | 含义 |
| --- | --- |
| `id` | FSRS 对象的稳定身份。 |
| `stability_days` | 稳定性 S，单位为天。S 表示模型预测的记忆保持概率从 100% 降到 90% 所需的时间。 |
| `difficulty` | 难度 D，取值为 1 到 10。D 表示提高该对象记忆稳定性的难易程度，数值越大，提高稳定性越困难。 |
| `last_review_at` | 当前记忆状态对应的最后复习时间，也是计算经过时间的基准。 |
| `due_at` | 已保存的下次到期时间。 |

S 和 D 共同表示记忆状态。S 的 90% 定义来自 FSRS 模型；调用方选择其他目标保持率时，S 的含义仍保持不变。[记忆状态定义](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)

`fsrs_knowledge` 保存对象与知识记录的多对多关联。一个对象至少关联一条知识记录，同一条知识记录也可以关联多个对象。创建对象及其关联应在同一事务中完成；移除关联后仍保留对象时，至少保留一条关联。当前 schema 将这一跨表存在条件交给写入方维护。

当前 schema 保存具有完整记忆状态的对象。写入前需要取得有效的状态值及相应时间；字段含义由实际数据决定。

## 派生量与计算输入

以下数值不作为 `public.fsrs` 的独立字段保存。

| 数值 | 含义 |
| --- | --- |
| 经过时间 t | 计算时点与 `last_review_at` 的时间差，以非负的天数表示。时间差计算使用明确的时区。 |
| 可提取性 R | 指定计算时点能够成功回忆的预测概率。R 由 S、t 和所用模型的遗忘曲线决定。 |
| 目标保持率 r | 调用方希望在目标时间达到的记忆保持概率。r 是计算输入。 |
| 间隔 I | 遗忘曲线下降到 r 所需的天数。I 是时长，`due_at` 是时间点。 |

在 FSRS-6 中，遗忘曲线的形状由模型参数 `w20` 决定。经过 S 天时，R 为 0.9；目标保持率为 0.9 时，对应间隔为 S 天。[FSRS-6 遗忘曲线](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm#fsrs-6)

## 模型参数

FSRS-6 使用 `w0` 到 `w20` 共 21 个参数。参数控制模型如何从观测估计记忆状态，同一适用范围内的对象使用同一组模型参数；每个对象分别保存自己的 S 和 D。

当前 schema 没有模型参数字段。计算时使用调用方提供的参数集。参数可以来自该版本实现的默认值，也可以来自针对相应历史数据的拟合结果。

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

## 离线计算脚本

[scripts/fsrs6.py](scripts/fsrs6.py) 使用 Python 标准库计算派生值，结果以 JSON 输出。命令中的路径相对于本子 skill 目录。

按计算目标选择命令：

| 命令 | 输入 | 输出 |
| --- | --- | --- |
| `retrievability` | S、t、`w20` | `retrievability`，给定时点的预测概率。 |
| `interval` | S、r、`w20` | `interval_days`，达到目标保持率的连续天数。 |

S 与 `w20` 必须是正的有限数，t 必须是非负的有限数。这些条件来自遗忘曲线的定义域。反求有限间隔时，r 大于 0 且不超过 1；r = 1 对应零天。

下面的 `0.1542` 是所引用 py-fsrs 版本的默认 `w20`，用于展示调用。实际计算传入所用模型的参数。

```bash
python3 scripts/fsrs6.py retrievability --stability-days 10 --elapsed-days 10 --w20 0.1542
```

```json
{"retrievability": 0.9}
```

```bash
python3 scripts/fsrs6.py interval --stability-days 10 --desired-retention 0.9 --w20 0.1542
```

```json
{"interval_days": 10.0}
```

脚本在本地完成计算，间隔保留小数天。修改本模块时，先读取 [DECISIONS.md](../DECISIONS.md)。
