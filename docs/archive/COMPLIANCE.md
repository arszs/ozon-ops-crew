# 安全与合规 / Safety and compliance

对应评审规则「安全与合规性（5%）」。本页汇总现状与设计承诺；生产化前的合规结论以法律顾问意见为准。

## 数据隐私

- 原型所有数据保存在操作者自己的浏览器 localStorage，不上传任何服务器；公开演示站只含合成数据。
- 仓库不含任何客户、订单或个人数据；演示截图与视频均为合成数据。
- 生产设计：卖家数据按租户行级隔离（RLS），密钥按卖家 KMS 加密，应用不持久化明文（见 SCALING.md）。
- 跨境数据：中国卖家主体、俄罗斯平台数据；传输与存储遵循中国《个人信息保护法》(PIPL) 与俄罗斯 152-FZ 的适用要求，最小化收集运营必需字段。

## 平台规则

- 当前仅使用 Ozon Seller API 的**只读**商品目录接口，单请求串行、带超时与分页上限，遵守平台速率限制。
- 价格与广告**写入默认关闭**；启用前需逐项验证平台权限范围、活动成员关系与回执，遵守 Ozon 平台条款。
- 广告暂停必须读取平台成功回执；超时按未知处理并人工复核，绝不假定成功。

## 广告与内容规范

- 本工具不向消费者投放任何广告内容，不生成违反广告法的宣传文案；它只调整商家自有广告活动的预算参数。
- 不宣传未经证实的收益数字：所有演示数字标注为合成数据，价值模型标注为模型化假设（见 VALUE-MODEL.md）。

## 知识产权

- 代码与文档为本团队原创，无第三方闭源组件；运行零 npm 依赖。
- Ozon、Wildberries 等名称仅为说明目标平台，相关商标归其权利人；参赛作品知识产权归团队所有（按赛事规则）。

## English summary

Privacy: browser-local storage only, synthetic data in the public demo, no customer data in the repo; production design uses row-level tenant isolation and per-seller KMS-encrypted credentials, honoring PIPL and Russian 152-FZ data-minimization requirements. Platform: read-only Ozon Seller API with serial requests and timeouts; writes disabled by default and gated on verified receipts. Advertising: the tool adjusts the merchant's own campaign budgets only and publishes no unverified uplift claims. IP: original code, zero npm runtime dependencies; trademarks belong to their owners.
