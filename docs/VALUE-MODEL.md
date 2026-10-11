# 业务价值模型 / Business value model

评审规则要求「效益数据具有可信依据」。本文件给出一个**可复现**的价值模型：用真实的决策引擎跑一个固定随机种子的合成卖家组合，聚合引擎决策所处理的价值敞口。

**复现方式**（确定性输出，任何人可验证）：

```sh
node scripts/value-model.mjs
```

## 方法与假设

- 组合规模：200 个卖家 × 50 个 SKU = 10,000 个 SKU（目标服务规模的缩影）。
- 每个 SKU 的价格、成本、日需求、库存、广告消耗在文档化区间内随机生成（种子固定为 `20261011`）。
- 约 12% 的 SKU 处于「广告费蚕食利润」状态；约 8% 的观测行未结算；约 6% 的 SKU 存在未分摊广告支出。
- 决策与预测全部调用仓库内的真实模块 `web/engine.mjs` 与 `web/planning.mjs`，不是另行编写的演示数字。
- 人力假设：人工每周逐项复核 12 分钟/SKU，使用控制台后 1.5 分钟/SKU。

## 模型输出（种子 20261011）

| 指标 | 全组合（10,000 SKU） | 折算每卖家/月 |
|---|---:|---:|
| 滚动亏损止损（含广告费） | 136,579,770 ₽ | 682,899 ₽ |
| 无订单广告空烧拦截 | 1,043,555 ₽ | 5,218 ₽ |
| 清仓决策覆盖的 30 天仓储敞口 | 8,793,931 ₽ | 43,970 ₽ |
| 断货保护覆盖的收入风险 | 250,099,380 ₽ | 1,250,497 ₽ |
| 运营人力节省 | 7,525 小时/月 | 37.6 小时/月 |
| 决策吞吐 | ≈353,000 SKU/秒（单核） | 全组合一轮 28 ms |

决策分布：止损 30.8% · 断货保护 23.3% · 旺季持有 20.6% · 小额测试 14.1% · 清仓 4.0% · 等待结算 7.2%。

## 解读与边界（重要）

- 以上是**模型化敞口**，证明引擎能在大规模下稳定识别并处置这些风险；**不是**真实商家的已实现收益。
- 「断货保护覆盖的收入风险」是被标记的风险收入，不等于可全部挽回的利润。
- 真实效益必须以 EVALUATION.md 的试点方案度量：影子模式 → 小流量对照 → 公布样本量与区间。在未完成试点前，我们不宣传任何实盘提升数字。
- 性能数字说明规则引擎本身不是规模化瓶颈；生产瓶颈在数据摄取与平台 API 配额，见 SCALING.md。

## English summary

Reproducible value model: the real deterministic engine evaluates a seeded synthetic portfolio of 200 sellers × 50 SKUs in ~28 ms single-core. Aggregated monthly exposure addressed by engine decisions: ≈683k ₽ rolling-loss protection, ≈44k ₽ storage exposure, ≈1.25M ₽ stockout revenue-at-risk flagged per seller, plus ≈37.6 operator hours saved per seller per month under stated assumptions. All figures are modeled exposures under documented assumptions — credible basis for a pilot, not claimed live uplift.
