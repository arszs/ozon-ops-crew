# Ozon Ops Crew · AIGC 商品表达与单品利润决策

**让中国卖家看懂每个商品为什么赚或亏，确认下一步，再核对结果。**

面向缺少俄语运营团队的中国卖家，Ozon 为首个核心市场。卖家界面默认简体中文；面向俄罗斯买家的文案与商品图使用俄语。采购、进口和采购汇率换算不属于本产品范围。

[打开中文交互演示](https://arszs.github.io/ozon-ops-crew/) · [当前源码](https://github.com/arszs/ozon-ops-crew/tree/feat/cross-border-workspace) · [Specs 与流程图](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/SPECS.md)

## 主场景：把经营判断变成可核对的行动

真实商品数据 → 缺失成本或经营问题 → 有依据的价格 / 广告假设 → 检查条件与风险边界 → 卖家确认具体差异 → API 执行 → 平台回读 → 两期日均贡献比较 → 下一步。

首页按店铺、商品与时间段展示需要处理的问题、原因及下一步。收入、平台费用、广告与卖家成本分别核算；未知成本不会当作零。计算由可检查的代码完成。价格与单 SKU CPO 开关已有独立确认、执行和状态核对流程；实现接口不等于已完成真实收益验证。

## AIGC 演示：评价 → 俄语图文 → 审核 → 经营验证

买家反映“图片尺寸不清” → 卖家核实尺寸 → AI 生成俄语文案和绘图指令 → 对比原图与新图 → 人工确认版本。质量或服务缺陷不能通过生成图片掩盖，未证实的承诺不能补写。

本地工作台支持真实订阅文案生成、持久化任务、评价搜索、图片上传、版本哈希和人工审核。已审核图文可以关联同一店铺 / SKU 的利润实验，实验保留当时的图文及确认版本。图片修改会使原确认失效；实际发布及平台展示仍需另外验证。

公开页面有四步中文交互：评价问题、生成前后对比、人工核对、可修改的两期利润示例。示例图片由 OpenAI 图像工具真实生成，商品与金额为合成数据，图片为预生成回放。提高成本后，即使订单增加，利润结论仍可变差；缺少信息时不给出正向结论。公开页面不连接商店、不在线生成、不执行价格或广告操作。

**xds.studio 当前是手动工作流，原生 API 尚未验证。** 可将绘图指令与原图交给 Studio，再上传生成结果审核；本演示不能作为已接通 Studio 的证明。

## Agent 与审计

经营流程分离数据读取、经济计算、假设、约束检查、确认、执行、回读及结果评价。每次行动绑定账号、SKU、来源版本和确切参数；新实验不会继承旧的执行许可。未知执行结果先核对，不盲目重试。

商品本地化仍保留独立流程：import → extract → translate → image_edit → map_attributes → validate → review_gate → publish → sync。统一商品模型、持久化阶段、内容版本、证据哈希和工具审计用于追溯。

预算、亏损边界与停止条件可以记录并依据读回数据检查，**不是保证自动停止平台支出**。当前是本地原型；生产身份验证、多租户隔离及分布式任务仍需完善。

## 实际证据与尚未完成的部分

- 已有真实 Ozon 只读数据；读取范围及失败来源需要明确展示，不能把局部样本当作完整店铺。
- 已实现价格 / CPO 审核与回读、确定性经济计算和合成端到端检查；完整的真实执行 → 回读 → 实验结果尚未展示。
- 已私下准备 10 个真实 SKU 的固定输入。人工 / 服务辅助的配对耗时、修正次数与成本尚未测量；不宣称节省时间或提高利润。
- 尚需卖家提供有来源的成本、完成同任务手工基线，并确认一个具体 Ozon 实验。真实数据与密钥不放入公开演示。
- Taobao 真实账号未配置；目前使用结构化输入和明确标注的样本。真实买家回复发送、更多广告工具等仍未完成。

## 10 SKU 验证方法

用同一份冻结输入完成同一决策任务，分别记录人工与辅助流程的活跃操作时间、总耗时、修正、决策质量及实际成本。交替任务顺序，披露学习效应；工具调用时间不冒充人工节省时间。缺失值保留为空，不把准备好的样本当作完成的试点。

商业效果须在经确认的实验完成两个可比期间、回读与成本核对后单独报告。日均贡献差异仍是观察结果，不直接证明广告或图片的因果效果。与现有流程 / Miaoshou ERP 的同输入对比尚未完成，不宣称已验证的优势。

## 后续扩展

Amazon / Shopify / Wildberries / TikTok Shop — 后续 API 适配器。现有 WB 预研及本地化能力保留；WB 无真实账号验证，先完成 Ozon 主场景，再按各平台实际授权扩展。

## 评委复现入口

1. [中文公开演示](https://arszs.github.io/ozon-ops-crew/)：无需密钥，检查合成示例的图文审核与利润计算。
2. [当前源码分支](https://github.com/arszs/ozon-ops-crew/tree/feat/cross-border-workspace)及 [PR #1](https://github.com/arszs/ozon-ops-crew/pull/1)。主分支保留历史模拟器；当前连接工作台在上述开发分支。
3. [Specs / 启动说明 / 流程图](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/SPECS.md)：Node ≥22.13，npm ci → npm test → npm start。本地真实读取须有获授权的连接。
4. [证据与未完成项](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/EVALUATION.md)、[10 SKU 协议](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/PILOT-PROTOCOL.md)、[6 分钟中文演示](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/DEMO-SCRIPT.zh.md)、[AIGC 证据](https://github.com/arszs/ozon-ops-crew/blob/feat/cross-border-workspace/docs/AIGC-DEMO.md)。

更新：2026-10-14。当前原型可评审，完整真实商业验证尚未完成。项目不隶属于上述平台。
