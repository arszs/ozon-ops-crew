# Ozon Ops Crew — 面向中国跨境卖家的利润运营智能体

## 1. 项目定位与目标用户
面向在中国注册、向俄罗斯销售的 Ozon Global 商家，覆盖 FBO 与从中国发货的 FBS 场景。项目把广告、价格、库存、采购批次与补货时间统一到一个决策流程，目标是在给定经营周期内提高扣除全部相关成本后的利润，而非只追求 GMV。

参赛方向：品牌出海场景赛道。当前报名项目名保持不变，能力重点收敛到经营优化。最相关子方向为 AI 流量分析；价格与库存控制作为广告决策的业务约束。最终子赛道以报名记录为准。

## 2. 真实问题
跨境商家面临人民币采购、卢布销售、履约差异、仓储费用及长补货周期。单独追求广告转化或降低售价，可能制造亏损、提前售罄或扩大积压。中国店铺只有少量销售时，不能假装已经掌握可靠的季节规律。

## 3. 解决方案
门户展示商品级利润和风险；商家配置亏损窗口、SKU 广告日预算、价格调整上限、最低单位利润、等待期限及资金成本。

决策链路：
1. Data Steward：读取目录、校验采购数据、区分已结算与未结算费用。
2. Economics：汇率折算，计算佣金、履约、包装、退货准备及广告后利润。
3. Inventory & Demand：比较库存天数、补货时间及季节假设可信度。
4. Strategy：对比小额测试、旺季持有、清仓、保护库存等方案。
5. Risk Sentinel：若最近已结算销售含广告费用的合计亏损超过商家上限，冻结价格并提出暂停对应 SKU 广告。
6. Execution & Audit：模拟记录或未来经验证的 API 执行；显示明确的执行回执。

当前引擎为可测试的确定性规则实现，以上是模块职责而非已经运行的大模型多智能体集群。下一阶段可接入大模型用于解释和需求分析，但价格、预算及风险控制仍由确定性规则检查。

## 4. 已完成的 Demo
- 中俄双语门户，适配桌面与手机。
- 四个合成商品场景，可交互修改仓储费用、库存、补货天数、季节系数。
- 店铺默认限额与单品覆盖设置；浏览器内通知和决策日志。
- CSV 导入导出与采购批次模板。
- 本地服务器可用提供的 Seller API 凭据只读访问真实商品目录；密钥不进入代码或浏览器。
- 自动化测试覆盖关键亏损及边界场景。

## 5. 业务闭环与指标
目标闭环：数据 → 单位经济 → 策略 → 风险检查 → API 回执 → 后续利润评估。
当前完成至模拟执行与审计；真实目录读取已验证。真实订单、结算、广告执行和自主学习尚未接入，不能宣传为实盘自动优化。

试点指标：广告后贡献利润/订单、总贡献利润、广告成本、缺货天数、库存持有成本、亏损检测延迟、暂停确认成功率和每次人工处理耗时。采用匹配 SKU 或分阶段对照，并控制价格、促销、缺货和归因延迟；展示样本量与区间，不把模拟收益当真实效果。

## 6. 创新与扩展性
广告预算与库存机会成本共同决策；中国采购及跨境履约成本独立核算；小样本下明确不确定性；亏损窗口触发可审计的防护流程。类别不写死，可逐步接入更多品类与市场，但每个市场需独立验证费率与权限。

## 7. 安全与实现边界
密钥仅服务端保存，仓库不含客户或订单数据。真实写入默认关闭。广告暂停必须读取平台成功回执，失败时告警重试，不能仅暂停本地进程。共享广告活动需处理 SKU 关联，避免停掉其他商品。真实亏损窗口必须涵盖无订单广告支出，防止“没有销量就没有亏损”的盲区。

## 8. 交付清单
代码、可运行交互演示、需求与架构、评测方案、测试记录、三分钟演示脚本、采购模板。当前不包含真实商家获利证明。

规则来源：https://www.synnovator.com/hackathon/hfhahkjfdhakfhf （核查日期 2026-10-11）。材料截至 10 月 12 日；线下决赛 10 月 24–25 日，具体时刻待主办方确认。

## 0.2 更新（2026-10-11）
新增全店预算分配上限、持久化建议冻结、无订单广告支出保护、自有商品表单、销售窗口 CSV 与商品 JSON 导入、日库存及补货预测、缺货需求与仓储费用估算、决策导出。18 项自动化检查通过。所有写入操作仍为本地模拟，尚未连接真实广告执行；固定需求预测不是自动学习模型。

## Version 0.3 — economics-driven advertising loop
The Autopilot screen runs a deterministic agent workflow every 30 seconds while the browser tab is open: data validation → unit economics → stock constraints → budget allocation → risk checks → local simulated campaign execution → receipts. Repeated unchanged decisions are idempotent. Data older than one hour pauses the simulated campaigns. Reload does not auto-resume the loop. 22 automated tests pass.

This is an executable competition demonstration, not live Ozon advertising automation. Real activation requires separately verified Performance API access, complete actual costs, campaign membership checks, a persistent server worker and merchant-approved operating limits. No live uplift is claimed.
