# Ops Crew · 中国卖家的 AIGC 商品图文工作台

**把俄语买家的疑问，变成更清楚的商品图，再验证单品利润。**

[体验中文 AIGC 演示](https://arszs.github.io/ozon-ops-crew/) · [统一源码](https://github.com/arszs/ozon-ops-crew/tree/main) · [参赛项目](https://www.synnovator.com/arszlx/ozon-ops-agents)

面向缺少俄语团队的中国卖家：从评价中发现尺寸、用法等表达问题，核对商品事实，生成俄语文案与图像编辑方案，对比新旧图片并由卖家确认。随后关联单品实验，验证内容、价格或广告方案的经营效果。

## 2026-10-24 本地工作台更新

当前开发分支包含 Taobao/Tmall URL/HTML → Qwen/Codex → 俄语图文 → Ozon 的 Product Studio，以及三语商品经营中心 `/strategy.html`。经营中心提供六种策略、成本预览、受限调价、独立CPC广告暂停/预算下调/明确授权后恢复、活动资格核对、评价回复与店主简报。支持最近7天FBS发货状态；未知利润不记为零。实际操作取决于API权限、商品身份和已保存限制。[策略与边界](docs/STRATEGY-AGENTS.md)。独立的 `/agent-demo.html` 提供醒目标注的练习店铺：使用同一策略引擎和真实Qwen/Codex分析合成评价，不调用真实店铺写入。[练习步骤](docs/AGENT-DEMO.ru.md) · [验证记录](docs/AGENT-VALIDATION.md)。

语言版检查点已单独保存为 `backup-after-i18n-20261023`。下方参赛材料与旧进度保留其原始时间范围；当前开发分支的功能不自动代表公开Pages演示已经连接真实店铺。

## 本次参赛材料

[2026-10-23 统一版本索引](docs/CONTEST-RELEASE.md) · [当前中文提案](docs/SUBMISSION.zh.md) · [三分钟讲稿](docs/PITCH-3MIN.zh.md) · [当前问答](docs/FINAL-QA.zh.md) · [内容测量协议](docs/CONTENT-PILOT.md)。版本标识：`contest-2026-10-23`；发布回执随交付包提供。旧视频和模拟器不是当前参赛演示。

## 一件商品的完整路径

**评价 → 事实核对 → AIGC 图文 → 版本确认 → 商品实验 → 贡献利润比较**

| 阶段 | 当前实现 | 验证边界 |
|---|---|---|
| 发现疑问 | 选择评价与商品，保留来源与已核实事实 | 不把评价当作产品事实；质量问题需单独处理 |
| 生成图文 | Codex 订阅生成俄语文案、中文说明与绘图指令；上传外部生成图片 | 图片生成不是应用内自动调用；公开图片由 OpenAI 工具实际生成 |
| 雪窦山 Studio | 准备原图和绘图指令，手动生成后回传 | xds.studio 原生 API 尚未验证，不声称已经接通 |
| 人工审核 | 前后对比、事实/外观/俄语/权利检查、版本哈希 | 确认不等于发布；换图使旧确认失效 |
| 经营验证 | 已确认图文关联同店同 SKU 实验；价格/CPO 操作有独立确认与核对 | 实际图片发布、展示与商业效果仍需验证 |

不靠图片掩盖商品缺陷，不虚构认证或质量提升，不承诺未经测量的退货下降或利润增长。

## 中文演示与参赛定位

[公开演示](https://arszs.github.io/ozon-ops-crew/) 支持中文、俄语和英语界面，沿用浏览器已保存的选择；俄语用于面向买家的内容。进入方案后，可下载合成商品原图与中文生成指令，在 xds.studio 手动尝试；没有自动发送数据或消耗平台积分。

演示展示**真实生成的前后图片 + 合成商品、评价和利润数据**。它回放已准备的内容，不连接店铺，不进行实时生成或发布。图片确认后可调整两期收入、全部成本和广告，观察订单增加但贡献利润下降的例子。

项目对应雪窦山 AIGC 品牌出海命题赛的 **AI产品资料子赛道**：生成俄语商品图文是创作任务，经营数据用于后续验证。当前采用手动 Studio 工作流，不虚构赞助方 API 集成。[官方赛道说明](https://www.synnovator.com/hackathon/hfhahkjfdhakfhf)

## 历史参赛进度（2026-10-15 检查）

**完整真实闭环尚未完成。** 已读取真实 Ozon 数据；价格/CPO 的确认、执行和读取核对已实现，但未证明真实写入和完成后的收益。10 个真实 SKU 已私下准备，人工/辅助耗时、确认成本及商业效果仍未测量。

截至 2026-10-15 的历史检查中，一个 CPO 来源返回 HTTP 404；另一次接口检查不支持该账号启用 CPO，评价/问答读取返回权限错误。全部 17 件有库存的已读商品均启用自动促销。不能据此把广告费记零或直接执行价格实验；本次材料整理没有刷新账号状态。预算与亏损上限不是保证自动停止的平台限额。

[证据与缺口](https://github.com/arszs/ozon-ops-crew/blob/main/docs/EVALUATION.md) · [Specs / Agent 流程](https://github.com/arszs/ozon-ops-crew/blob/main/docs/SPECS.md) · [10 SKU 试点协议](https://github.com/arszs/ozon-ops-crew/blob/main/docs/PILOT-PROTOCOL.md) · [6 分钟中文演示稿](https://github.com/arszs/ozon-ops-crew/blob/main/docs/DEMO-SCRIPT.zh.md)

## 已保存商品页导入

商品迁移支持上传 Taobao / Tmall 保存的 HTML：本地 Qwen 先提取，原文证据不足时交给 Codex；仍有疑问则导出核对包。店铺币种与物流、税费参数用于计算保留源商品净回款的售价。缺失成本不会记零，也不会直接发布。[配置与边界](docs/SAVED-PAGE-IMPORT.md)

## 界面语言 / Язык интерфейса / Interface language

所有页面共用中文、俄语、英语切换器，包括 Studio、详细工作台、历史界面和公开演示。选择保存在当前浏览器；切换不会清空已输入的链接或参数。Ozon 买家文案和图片仍使用俄语。翻译随应用本地加载，切换时不调用模型。

## 本地工作台

需要 Node.js >=22.13；main 提供完整工作台源码，GitHub Pages 只提供独立的合成演示。精确参赛版使用标签 `contest-2026-10-23`：

```sh
git clone --branch contest-2026-10-23 https://github.com/arszs/ozon-ops-crew.git
cd ozon-ops-crew
npm ci
npm test
npm start
```

打开 http://127.0.0.1:4173/ 。首页保留店铺经济总览、待决事项和 AIGC 入口。未知成本不记为零，不同店铺与币种分开。真实连接通过服务端配置，密钥文件放在仓库之外；不要把本地 API 暴露到公网。

[API 范围](https://github.com/arszs/ozon-ops-crew/blob/main/docs/LIVE-API.md) · [AIGC 实现与证据](docs/AIGC-DEMO.md) · [订阅生成与本地化](https://github.com/arszs/ozon-ops-crew/blob/main/docs/SUBSCRIPTION-PIPELINE.md)

## 范围与扩展

Ozon 是主要验证场景。Taobao 支持保存页面 HTML 与结构化导出；不伪装已接入淘宝 API。现有 WB 内容、价格、库存和财务适配代码保留，尚未用真实 WB 账户验证。Amazon / Shopify / Wildberries / TikTok Shop 为后续 API 适配方向。

不代办采购或进口。净回款定价只使用用户核定的物流、税费和汇率参数，不自动判断税制或生成承运商报价。生产认证、多租户隔离和分布式后台执行仍待完善。

[历史原型资料](docs/HISTORY.md) 与旧录像不代表当前界面或实际收益。项目与 Ozon/WB 并非官方关联；公开仓库不含店铺密钥和私有财务数据。未选择开源许可证前不授予开源许可。

### Проверка и исправление опубликованной карточки Ozon

В «商品迁移» откройте созданный товар и нажмите «检查买家内容与配送配置». Программа читает фактические описание, изображения, цену, остатки, склады и способы доставки. Ссылка покупателя строится только по marketplace SKU из ответа Ozon; внутренний Seller API product_id для неё не используется. Настройки доставки не гарантируют доступность по конкретному адресу: её нужно проверить на витрине.

Раздел «修改已创建卡片» позволяет отдельно сохранить описание и явно обозначенный артикул продавца, заменить главную фотографию с сохранением старых, изменить цену CNY и установить реальный остаток на существующем складе realFBS. Перед остатком программа повторно проверяет подтверждённую цену и цену продавца с учётом акций. Каждая отправка записывается до вызова API; при неопределённом результате автоматического повторения нет. После изменения снова считайте платформенный результат. Расчёт OGL не подключает перевозчика и не меняет договор доставки.

### Product Studio: URL / HTML → buyer-ready card

The server homepage and `/studio.html` open the new Russian Studio. Upload a saved Taobao HTML or paste a public item URL. Authenticated-only pages become an explicit HTML-import request; no browser cookies are read. Previously uploaded exact item/variant pages can be reused by URL. Background tasks persist progress and survive closing the tab; interrupted generation can be retried, while ambiguous publication is never resent automatically.

The pipeline uses local Qwen with bounded Codex fallback, separate web-search-only Codex research, source-quote verification, expanded Russian copy with claim/number checks, and three photo-preserving designed images. Vision proposes a bounded crop of the complete selected product; the program retains originals and renders Russian typography around actual photography. This is deterministic photo composition, not generative reconstruction of the product. Device context is distinguished from accessory specifications, and unverified research is excluded from content facts.

Every new landed-price calculation applies the configured demo policy **base after logistics × 3**, preserving the rounded base for inspection. Studio defaults (20×20×20 cm, 400 g, 15% commission, tax 0) are explicit editable estimates, not inferred package measurements or verified category fees. OGL calculation does not activate a delivery contract.

One publish action freezes the displayed copy, photo set and price, selects and verifies a live Ozon category and dictionary values, then uses the existing version-bound publication path. Unknown mandatory facts or brands absent from Ozon remain actionable blockers; the program does not silently substitute another brand. Stock is not automatically set. Downloaded sources, generated assets and task records remain in ignored runtime storage; credentials are not passed to AI child processes. User instructions are available in the Studio help dialog.
