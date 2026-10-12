# Product focus after Miaoshou comparison

## Positioning hypothesis

A Chinese seller needs to decide which SKU, price and advertising setup deserves further investment on Ozon/WB. Generic translation, listing, ERP dashboards and an AI analyst already overlap with Miaoshou. Our proposed focus is a transparent experimental workflow tied to SKU contribution profit. Differentiation is a hypothesis, not a verified exclusive capability.

Official competitor evidence reviewed: [Ozon listing](https://erp.91miaoshou.com/ozon.html), [advertising](https://erp.91miaoshou.com/help_center/article_9092.html), [profit accounting](https://erp.91miaoshou.com/help_center/article_9412.html), [AI analyst](https://erp.91miaoshou.com/help_center/article_14740.html). No authenticated competitor usability test performed.

## Delivered in this iteration

Chinese portal has 商品利润实验. Users choose a store and SKU and record two dated, non-overlapping periods, including all product revenue (organic included), non-ad costs and separate ad costs. Daily contribution is normalized by calendar days. Records persist in the workspace with an audit hash. Manual observations are explicitly distinguished from API verification and isolated by store/mode.

Positive difference is only a repeat-test candidate. Unsettled costs/revenue, fewer than 30 orders in either period, or unconfirmed comparability block the directional verdict. Thirty orders is a screening heuristic, not statistical significance. Sequential observations do not establish causality. No external operations are triggered.

## Remaining work toward the original product

- Join actual SKU financial transactions and advertising expenses with seller-supplied product costs; reconcile fees, refunds and date attribution before labelling profit complete.
- Define prospective plans and API capability checks per account, human-approved execution, budget enforcement, stop conditions and reconciliation.
- Account for attribution delays, promotions, stockouts and seasonality; provide uncertainty with sufficient daily observations, not aggregate-only invented confidence.
- Connect Taobao or genuine exports, validate WB access and complete gated operations from the MVP specification.
- Assess shop entry only with explicit cost assumptions and demand evidence, followed by a small pilot.
- Run the competition benchmark on 10 genuine SKUs against both manual work and Miaoshou: human editing time, total elapsed time, field correction rate, moderation outcome and actual compute cost. No improvement claim until measured.

For a short demo: show store overview, a clearly labelled synthetic migration, the approval gates, and a saved manual profit observation with its evidence blockers. Do not present simulated publishing or observational profit differences as real commercial outcomes.

The Chinese 商品与广告 page now reads the existing live Ozon snapshot, supports SKU/name/offer search and opens the observation form with the correct primary store and SKU. Ordered units are not labelled order count. Accruals retain their currency and are not converted into profit. Partial sources, stale snapshots and unallocated charges remain visible. No automatic financial prefill: these inputs have incompatible accounting bases until reconciliation is implemented. Browser verification against the current snapshot showed zero SKU rows; this is an empty/partial-data state, not a claim of no sales.

Snapshot reliability fix: a products enrichment loop with zero SKU inputs used to report success even when all four primary API sources failed. It now reports skipped; the cache accepts only snapshots with at least one successful primary source. Failed refreshes preserve the prior usable snapshot on disk and in memory. Previously saved enrichment-only snapshots are rejected on startup. Regression tests cover failure on first load and failure after a successful refresh.

## Prospective plans

商品利润实验 now supports persisted plans: store/SKU, one lever, baseline/variant, hypothesis, control conditions, non-overlapping dated periods, test-period ad budget and maximum total loss. Only one unfinished plan per store/SKU is allowed. Plans may be cancelled; cancellation is idempotent and has an audit event. Linked observations must match the original store, SKU, lever, variants and dates. A completed plan cannot accept another result. Budget/loss breaches are flagged and block a positive recommendation. Plan timestamps are shown so a retrospectively entered plan is not mistaken for preregistration. These are manual monitoring limits, not automated marketplace enforcement.

Validation: 79 automated tests pass, including persistence, cross-store rejection, mismatched observations, duplicate completion and cancellation. Chinese plan form inspected in Chrome on the local server. No real advertising or price write was performed.

## Home decision queue

Home now combines actual Ozon headline metrics with a decision queue derived from loaded experiment plans and each store/SKU's latest observation. It separates DEMO decisions, links directly to the record, prioritizes missing evidence and negative profit, and distinguishes expired planned dates from actual execution. A positive change with still-negative daily contribution is shown as a loss review, not a scale recommendation. Overlapping observations are never summed into store profit. The fourth headline metric is now available advertising spend with coverage disclosure; benchmark claims remain in project documentation instead of occupying store economics. Stale/error snapshots are labelled on home as well as the product page.

## Catalogue coverage

Live synchronization now reads product catalogue pages (100 per page, bounded to 100 pages), rejects looping cursors/changing totals/incomplete pages, deduplicates product IDs and loads product details by product ID before enriching report-only SKU rows. This makes zero-history catalogue products eligible for the product dashboard instead of relying only on sales/advertising membership. Products without a valid SKU are counted separately. Missing stock data remains unknown; skipped enrichment is not shown as an API failure.

Validation: 87 tests pass, including catalogue-only products when analytics/finance/ads fail. The live verification request failed with `UND_ERR_CONNECT_TIMEOUT`; full catalogue traversal is therefore not yet verified against the current account. The official Seller API documentation fetch also failed (redirect loop). Existing endpoint contracts are reused; no claim of a fresh official schema validation is made.

## Assortment-level entry assessment

Structured samples may now supply independent economics in each item's `targets.ozon` and `targets.wb`. The assessment counts conditional economic candidates, revise-cost/price items and missing inputs per marketplace, and displays every SKU separately. Store-level scenario fields never fill missing SKU costs. The per-order advertising allowance is calculated at a stated 15% contribution margin; it is not a bid or a forecast of achievable acquisition cost. A format example is explicitly synthetic and will not overwrite existing input. Evidence retains the per-SKU assumptions for auditing.

Validation: 90 tests passed, including platform-specific mixed assortments, missing costs, duplicate SKU rejection and the advertising allowance equation. No demand research, Taobao fetch or real pilot outcome is implied by this calculator.

## Form continuity

Failed actions preserve editable form values when the page and SKU job context remain the same. Background live refresh preserves home form inputs and product search. Values are held only temporarily in page memory; passwords/files are excluded, and successful actions retain normal reset behavior. Linked experiment plan IDs and their explanatory label survive validation failures. Chrome verification: submitting intentionally malformed import JSON displayed the error while retaining the exact draft and keeping the migration queue unchanged. Cross-page navigation and browser reload are not persistent draft storage.

## SKU cost profiles

Product economics now has persistent, store-scoped RUB cost profiles, with evidence/source text, immutable versions and optimistic revision checks. The seller supplies price, product cost, commission, fulfilment, allocated advertising per unit, taxes and returns reserve. Results are unit contribution and break-even price under these assumptions; they are not actual settled profit. API product rows open the matching cost profile (only an explicit RUB price is prefilled). Missing amounts are rejected, not coerced to zero, and saving never creates a marketplace operation. This is a foundation for experiment margin guards; API financial reconciliation and additional expense categories remain required before claiming complete store profit. Validation: 104 tests passed.

## Cost guard for price experiments

New price plans require the latest saved cost profile for the same store/SKU. The selected baseline must match that profile's assumed RUB price; target prices are numeric with at most two decimals. The seller selects minimum contribution margin (default 15%). Plans below the calculated cent-rounded-up minimum price are rejected, and the complete cost basis/version/source plus baseline and variant economics are frozen into the plan. Later cost edits do not rewrite historical plans. This neither verifies the current marketplace price nor executes it. Existing older plans are retained without retroactively claiming a cost check. Advertising plans remain manual hypotheses and do not yet receive an equivalent model-based guard. Validation: 106 tests pass.

## Multiple-store product workspace

The product page now switches between configured stores and keeps cost editing and observation shortcuts scoped to the selected store/SKU. The cost table also filters by the selected store. The primary Ozon account retains its detailed sales/finance/advertising view; WB and secondary Ozon accounts display their existing partial catalogue snapshots with explicit missing-data notices. They do not inherit primary-account sales or ad metrics. DEMO snapshots remain labelled. Secondary Ozon's existing product/list response contains product_id, not SKU: legacy snapshots are displayed with that identifier and cannot prefill a SKU experiment until SKU enrichment is implemented. No new API coverage or marketplace write is implied.

Repeated live polling no longer rebuilds the page when status, timestamp, staleness and error have not changed. This reduces disruption while using forms and selectors. Validation: 109 tests pass, including cross-store isolation and legacy identifier handling. Chrome verified WB DEMO selection and correct store/SKU prefill in both cost and observation forms; no data was submitted. Real WB credentials remain unavailable for account verification.

## Ozon catalogue enrichment for additional stores

Additional Ozon stores now use paginated product/list plus batches of product/info/list, through the existing throttled read-only caller. The snapshot distinguishes product_id, merchant offer_id and actual marketplace SKU, retains SKU aliases, currencies and per-SKU reported present stock, and marks products without SKU. An incomplete detail response, conflicting SKU owner, duplicate/unexpected product or pagination failure rejects the replacement snapshot; the previous snapshot remains available. Unknown amounts remain null. This supplies catalogue information, not sales/advertising or settled profit for additional stores.

Each configured secondary store now reads credentials only from its own envFile; missing values cannot silently inherit the primary account's process environment. The primary Ozon profile retains its existing credential configuration. Existing legacy snapshots remain visible with product_id labels until refreshed. Automated checks cover 101-product pagination, detail completeness, identity separation, unknown stock, store-specific credentials and preservation after failure. Full suite: 114 tests pass. The official documentation page again returned a redirect loop; the implementation reuses endpoint contracts already used by the primary-account integration.

Live verification reached Ozon successfully but the connected catalogue exceeded the existing 10,000-product traversal capacity. No complete live catalogue was verified or persisted. Oversized catalogues now fail on the first page with an explicit capacity message instead of consuming 100 requests before a generic page-limit error. Resumable synchronization for larger accounts is still required; this is a measured blocker for the current account, not an empty catalogue. Final suite: 115 tests pass.

## Resumable large Ozon catalogue

The product page now has a separate background catalogue worker, removing the 10,000-item ceiling for this workflow. Each 1,000-product list/detail batch commits rows, unique product count, cursor and evidence hashes together in a private SQLite file. Partial rows are searchable immediately; browser results are paginated (50 rows) and labelled as incomplete. Store ID plus a local hash of the API client ID scope every run. Secondary account credentials cannot read another account's cached rows. A changed total, conflicting SKU, missing detail or looping cursor stops the run without advancing its checkpoint. Resume retries the uncommitted page; a server restart marks running records interrupted. Resumption is explicit from the Chinese interface. A completed refresh creates a separate run; prior runs remain stored. One server process owns the worker; this is not a distributed job queue.

`GET /api/workspace/stores/:id/catalogue?q=&offset=` returns bounded rows and progress. POST to the same endpoint starts/resumes; `{restart:true}` creates a fresh run. Only live Ozon stores are supported. No marketplace writes occur. Prices and stocks are observed at different batch times, not a simultaneous inventory snapshot. Sales/financial reconciliation still uses the existing separate service; this cache does not prove profit or moderation.

Requires Node 22.13+ with built-in SQLite. The database lives under ignored `runtime/` with private permissions. Search/pagination, atomic failure recovery, restart recovery, duplicate start suppression, identity conflicts and cross-account isolation are covered by tests. Chrome verification used actual API rows and a merchant-article search; loading progressed beyond the previous ceiling. Full current-account completion remains to be verified. Retention cleanup and automatic recovery scheduling are not implemented.

## Human-gated Ozon price experiments

A saved RUB price plan can now read the SKU's current product and price context, recheck the latest seller cost version, and prepare an exact price operation. The approval shows the Ozon price ceiling (not final buyer price), existing crossed-out price, VAT, unchanged automatic-strategy flags and assumed margin floor. A separate human confirmation and execution are required within the test period; confirmation expires after 15 minutes. Execution rereads the context, blocks changes, and locally caps submissions at ten per product/hour. API acceptance and a subsequent observed target price are separate states. Ambiguous writes cannot be repeated; read-only reconciliation can observe the target without claiming an uncertain write caused it. Cancellation does not roll back prices.

Initial scope: live Ozon, RUB plans, matching current baseline/cost profile, known VAT, no automatic promotion enrollment/application, and no differing seller-promotion price. Existing platform minimum/crossed-out limits must permit the target. The operation preserves other strategy settings and does not automate ad budgets, rollback, monitoring or profit measurement. Stock, buyer replies and WB writes remain disabled. Cost edits and plan cancellation cannot invalidate an in-flight price submission.

The official [price write contract](https://docs.ozon.ru/api/seller/#operation/ProductAPI_ImportProductsPrices) and [price read contract](https://docs.ozon.ru/api/seller/#operation/ProductAPI_GetProductInfoPrices) were inspected in Chrome on 2026-10-12. Live read-only verification succeeded; the sampled product had automatic promotion enrollment enabled and is therefore blocked from this initial single-variable workflow. No actual price was submitted. Controlled tests cover exact gates, identity/currency, stale inputs, expiry, test dates, rate bounds, concurrency, definite rejection, ambiguous outcomes and later observation. Full suite: 132 tests pass.

Price approval UI was inspected in Chrome using an isolated synthetic fixture whose server rejects all mutations; the target/previous ceiling, assumed contribution margin, preserved crossed-out price/VAT, expiry and exact payload were visible before confirmation. No production cost assumptions or price plans were fabricated for this check. During the backend upgrade, the real catalogue worker recovered the same run and checkpoint after restart and was resumed without discarding committed products.

## SKU decision view and full-catalogue verification

The selected product now has one decision view combining its store-scoped API report row, seller cost scenario, active plan and latest manual observation. It explicitly separates observed orders/accruals/ads from assumed unit contribution and highlights a scenario price that differs from the observed RUB price. Missing costs disable the new-plan shortcut; a saved profile prefills the exact store/SKU/cost version and baseline. Report rows default to products with ordered units or advertising spend, sort by observed ad spending then order revenue, and provide an honest empty-filter message. This is a report-scoped ordering, not a full-market ranking or a recommendation to stop/scale advertising. The complete catalogue remains independently searchable.

Home store cards now read lightweight catalogue progress and link directly to the selected store's product workspace. Real catalogue synchronization completed successfully after checkpoint recovery. Independent SQLite checks confirmed that distinct product IDs, hydrated product IDs and the API-declared total agree, with every batch checkpoint present and quick_check passing. No real prices, replies or publications were sent. Chrome verified a live product detail, absent-cost gating, and empty ad filter handling. Full suite: 135 tests pass.

## Independent advertising cost coverage

CPC and selected-product CPO reports are now validated independently. A failed campaign-list/CPC request no longer prevents the independent CPO read; one failed or malformed report does not erase the other instrument's observed costs. CPC responses must contain exactly the requested campaigns. Missing report amounts remain null, and CPO's repeated CPC cost column is still excluded to avoid double counting.

Campaign totals not attributable to SKU remain an explicit store-level difference; CPO expense rows without valid SKU are retained in that difference. Missing SKU values are not filled with zero when a report has an allocation difference. Home, product table and SKU detail show separate instrument amounts and unknown all-assortment costs. These reporting amounts are not subtracted again from Seller API accruals or presented as profit.

Official Performance API documentation checked in Chrome on 2026-10-12: [all-assortment report](https://docs.ozon.ru/api/performance/#operation/GenerateAllSkuPromoProductsReport), [campaign statistics](https://docs.ozon.ru/api/performance/#operation/SubmitRequest), [selected-product CPO](https://docs.ozon.ru/api/performance/#operation/SearchPromoProductsReportSubmitRequest). The configured live account still returns HTTP 404 for the documented all-assortment JSON report; its cost remains unknown. A fresh live sync successfully returned CPC and selected-product CPO; Chinese home/product/SKU views verified in Chrome. No marketplace writes. 142 local tests pass, including independent failure, missing campaigns, malformed amounts, unattributed costs and exclusion of all-assortment GET mutation endpoints.


## API accounting evidence for SKU experiments

The Chinese SKU view now reads actual Ozon accounting for a chosen 1–90-day completed period. Each experiment exposes its original baseline and variant dates for independent read-only requests. Sales, final commission, delivery and SKU-specific fees are shown separately, with official fee names where available. Store-level unallocated balances remain separate, currencies retain their API denomination, and Performance spend is not deducted again. These are accrual-date balances, not profit or order-cohort outcomes. The plan remains open until its existing result workflow is completed.

A serialized background worker persists complete days, response hashes and audit events in a private, ignored finance repository. Overlapping identical requests share a job; errors resume from the next uncommitted day. Fresh versions preserve old reports; restart recovery requires explicit continuation. Store/account ownership is checked before and after reads and filters report visibility. This is a local single-process worker. Quantity/COGS, tax, external costs, late returns and shared-fee allocation remain unresolved for automatic profit evaluation.

Verified against the configured live account: a seven-day SKU report completed, component sum matched the earlier direct-SKU accounting total, the expense dictionary supplied Acquiring and StarsMembership, and both versions persisted. Chinese UI verified in Chrome. 153 tests pass, including cent precision, multiple currencies, corrections, incomplete pagination, conflicting duplicates, checkpoint recovery, concurrent request deduplication and account isolation. No marketplace writes occurred.


## Ledger-backed contribution comparisons

Completed Ozon finance readings now accept append-only seller reconciliation versions: net COGS, unrecorded tax/external costs, signed shared-account allocation, manually verified order count and ad spend used only for the budget check. API balances cannot be overwritten. Unknowns stay blank; cost reversals retain sign. A report currency, including CNY when observed, is retained without automatic conversion. Completeness, allocation and cross-period review remain seller assertions.

A plan can compare two exact report/reconciliation versions. The backend validates store, SKU, dates and currency, freezes all evidence, records a versioned observation and supersedes unused price approvals. An unresolved external price operation prevents closing the plan. Positive results require reviewed inputs, comparable/executed conditions, the order-count heuristic, pre-test plan registration and budget/loss checks; they remain repeat candidates, never causal evidence. Non-RUB comparisons cannot verify the existing RUB plan limits and remain inconclusive.

Refreshing reports or correcting costs marks prior results superseded/unavailable and creates a dashboard task to recalculate. Earlier amounts and supporting versions remain preserved. This supplies accounting-date contribution with explicit manual costs, not fully automated SKU profitability or order-cohort advertising attribution. There is still no verified live strategy uplift or genuine migration benchmark.

Validation: 165 passing tests and isolated Chinese-browser end-to-end coverage of initial comparison, cost correction, stale recommendation removal and versioned recomparison. A fresh seven-day actual API read completed; real cost inputs remained empty and no live experiment outcome was fabricated. The worker also detects repeated accrual identities across days. No marketplace writes occurred.


### Эксперимент CPO on → off

Первый подключённый рекламный рычаг — отключение CPO отдельного SKU по явному подтверждению продавца. Это позволяет проверить гипотезу о сохранении органических продаж при снижении рекламных расходов. Интерфейс показывает начальное состояние, область изменения и следующий шаг на главной. Результат сравнивается по всем продажам SKU и начислениям с подтверждёнными затратами, а не только по атрибуции рекламного кабинета.

Фиксированную ставку берём из актуального API; произвольная настройка через устаревший метод не предлагается. Включение CPO, управление CPC, автоматический контроль расходов и повторные циклы эксперимента остаются необходимой следующей работой. Гейт проверен на синтетическом сценарии; реальный аккаунт использован только для чтения. Это не подтверждённое конкурентное преимущество над Miaoshou и не измеренное улучшение прибыли.


### Рабочая главная вместо презентационного экрана

Главная начинает с выбранного реального магазина, периода и времени получения данных. Четыре показателя: ещё не рассчитанная прибыль, заказанная сумма, платформенный баланс начислений в отдельных валютах и прочитанные рекламные расходы. Выручка, баланс и реклама не превращаются в выдуманную прибыль. Другие магазины и DEMO не заполняют отсутствующие показатели.

Далее — до трёх ближайших решений и до пяти товаров: активные эксперименты, последние результаты по SKU, затем товары с прочитанной рекламной или заказной активностью. Положительная разница помечается кандидатом на повторный тест; устаревшее финансовое доказательство ведёт к пересчёту, а не к масштабированию. Каждый товар открывает свою экономику в правильном магазине. Это список для работы, не полный рейтинг прибыльности магазина.

Подключения, магазины, словари и ручной дайджест перенесены в «店铺管理»; демонстрационная форма цены/остатков свёрнута и допускает выбор только DEMO-магазинов. Подробная полнота данных остаётся раскрываемой на главной. Проверены реальный переход от главной к SKU, изоляция WB на синтетическом сценарии и мобильная вёрстка 390 px без горизонтального сдвига страницы. 185 тестов проходят. Удобство пока проверено технически; измерения на китайских продавцах ещё не проводились.


### Свежесть экономических решений

Обзор магазина больше не зависит от повторного чтения полного каталога. Короткий запрос количества и отдельные финансовые/рекламные отчёты обновляются независимо от фонового каталога. На главной видны время снимка, итог последней попытки и причины отсутствующих источников. Старый снимок при полном сбое сохраняется; 429 приостанавливает последующие запросы и показывает продавцу время повтора. Это позволяет отличать нулевой расход от недоступного отчёта, прежде чем менять стратегию. Свежие данные не доказывают причинный эффект или полноту прибыли.


### Понятный маршрут эксперимента

Главная и карточка плана используют одну модель следующего действия. Продавец видит три состояния: базовый период, выполнение на площадке, тестовый период. Маршрут ведёт к точной операции подтверждения, нужному отчёту, форме затрат или сравнению; раскрывает вложенные разделы без отправки операций. Полные условия и ручной ввод наблюдений свёрнуты.

Учитываются магазин, SKU, точные даты, последняя версия отчёта и затрат, общая валюта, сроки теста и неподтверждённые операции. Новая неудачная загрузка или исправленные затраты снимают готовность к сравнению. Это навигация по доказательствам, не автоматический мониторинг рекламы и не подтверждение причинного роста прибыли. Повторное чтение отличающейся цены переводит план в состояние «цена изменилась», вместо сохранения прежнего статуса проверки.

Проверка Chrome на изолированных синтетических данных: переход с главной прямо в затраты базового периода, сохранение черновика и открытых вложенных разделов после ошибки, компактный план и мобильная ширина 390 px без горизонтального скролла. Проверки с китайскими продавцами и сравнительное измерение скорости с Miaoshou ещё необходимы.


### Расходы рекламы в границах эксперимента

К плану добавлены отдельные чтения CPC/CPO за базовый и тестовый периоды. В текущем тесте доступны только завершённые московские дни. Сохраняются версии, покрытие дат и неизвестные источники; при прочитанном превышении бюджета главная ведёт к точному отчёту. Это помогает продавцу сверять стратегию с расходами на товар, сохраняя различие между рекламной атрибуцией и вкладом всех продаж в прибыль.

Реальное чтение одного SKU за семь дней проверено на подключённом Ozon. Синтетический сценарий Chrome проверил фоновую загрузку, предупреждение при CPC выше лимита и неизвестном CPO, переход с главной и сохранение открытого раздела. Никаких рекламных изменений; автоматические проверки по расписанию и остановка по лимитам остаются следующими задачами.


### Ежедневный контроль без ручного обновления

Продавец может отдельно включить ежедневное чтение расходов тестового SKU. Главная показывает превышение прочитанного бюджета и сбой проверки, а карточка — последнюю попытку, следующее время и выключатель. Это сокращает необходимость помнить о кнопке обновления; измеренного выигрыша времени пока нет. Локальный сервер должен работать, и проверка охватывает завершённые дни, а не текущий расход в реальном времени. Стратегия и остановка рекламы остаются за человеком.

Демонстрация проверена на синтетическом плане с настоящими локальными сервисами расписания и хранения и подменённым адаптером API. Реальные рекламные операции и расписания не запускались. Сохранение прежнего сигнала перерасхода при новом частичном отчёте предотвращает ложное впечатление, что бюджет снова свободен.

### Результат эксперимента связан с рекламными доказательствами

Для основного Ozon-магазина сравнение теперь замораживает версии рекламных отчётов за оба исходных периода вместе с финансовыми отчётами и затратами. Неполные CPC/CPO, введённый рекламный итог ниже прочитанной суммы или превышенный бюджет не дают положительной рекомендации, даже при выросшем дневном вкладе. Это сверка охвата и лимитов: реклама повторно не вычитается из финансового результата. Другие инструменты и поздние корректировки по-прежнему требуют ручной сверки.

Новая загрузка рекламы, включая неудачную или частичную, делает прежний вывод устаревшим. Пересчёт создаёт новую версию; исходные цифры и доказательства сохраняются. Старые сравнения без рекламного доказательства помечаются непроверенными. При отсутствующем подключении Performance можно сохранить только неполное наблюдение. Дополнительные Ozon-магазины пока требуют ручной проверки рекламы.

Проверено в Chrome на отдельном синтетическом магазине: положительное наблюдение → новый частичный отчёт 250 RUB при лимите 200 RUB → снятие рекомендации на главной → новая версия с тремя причинами недостаточности данных. Дневной вклад остался 50 → 70 RUB: автоматического двойного вычитания нет. Проверены переход к рекламным отчётам и ширина 390 px без горизонтального скролла. 232 локальных теста проходят; реальные расходы и результаты экспериментов в этой проверке не создавались.

### Повторный тест без повторного заполнения всех полей

Из последнего положительного результата завершённого плана можно подготовить следующий тест того же SKU и тех же двух стратегий. Сохраняются длительности периодов, исходные лимиты и гипотеза; предлагаются новые полные будущие даты. Продавец проверяет даты и подтверждает сохранение. Для цены нужно заново выбрать актуальные затраты, с сохранением исходного минимального процента маржи. Перед базовым периодом нужно вручную восстановить базовую стратегию: восстановление цены остаётся ручным; для CPO теперь есть отдельная операция базового периода с подтверждением (см. ниже).

Сервер проверяет последнюю версию исходного результата, его положительный вклад и актуальность финансовых/рекламных доказательств. Новый план хранит ссылку и хеш исходного результата; операции, одобрения, расписания и результаты не копируются. Это подготовка повторной проверки, а не автоматическое масштабирование или доказательство причинности. Ручные наблюдения сохраняют ручное происхождение.

На странице сначала видны незавершённые планы и последние результаты. Завершённые/отменённые планы и предыдущие расчёты свёрнуты, но точные ссылки раскрывают нужную запись. Пересчёты одного периода не изображаются независимыми тестами и не суммируются. После сохранения нового плана главная показывает его следующий шаг вместо старого предложения повторить тест. В рекламном плане скрыты поля ценовых затрат.

Chrome на синтетическом магазине проверил подготовку, ошибку при изменении стратегии, сохранение черновика и связи с исходным результатом, успешное создание, переходы к исходному сравнению и вложенным отчётам. Сохранены 2 версии исходного расчёта, создан 1 повторный план, операций и расписаний — 0. Финальный экран без ошибок JavaScript; проверена ширина 390 px. Удобство для реальных китайских продавцов и влияние на прибыль ещё не измерены.

### Подготовка исходной рекламы перед повторным тестом

Для CPO продавец теперь может подготовить как базовое состояние, так и тестовое прямо из плана. Это закрывает практический разрыв: новый тест начинается с явно проверенной исходной рекламы, а не с предположения, что состояние восстановилось само. Действия подтверждаются отдельно, стоимость видна до отправки. Включение API не позволяет зафиксировать ставку или бюджет; изменение котировки и позднее восстановление исключают положительный вывод по прежним условиям.

Проверка интерфейса синтетическая. Полный эксперимент с реальной прибылью, китайским аккаунтом и повторным подтверждением результата ещё не проведён. Для конкурса это демонстрация проверяемой цепочки действий, а не доказательство роста прибыли или превосходства над Miaoshou.

### WB: каталог по масштабу целевого продавца

Первые 100 карточек WB не покрывали целевые 500–5000 SKU. Китайское и российское подключения теперь имеют отдельные адреса Content API, а каталог загружается в фоне с сохранением каждой страницы. Продавец может искать по названию, nmID, артикулу, размерному ID и штрихкоду, открыть конкретный товар и связать его с собственными затратами и наблюдением. Число размеров не превращается в число карточек или остатки.

На синтетических данных проверены 5000 карточек и восстановление после сбоя. Реальный китайский WB-аккаунт пока не подключён; продажи, финансы, рекламные расходы, цены и остатки WB остаются следующим функциональным разрывом. Конкурсное демо должно показывать синтетическую проверку как техническое доказательство работы, а не подтверждённый бизнес-результат.

### WB size-price visibility

A seller can now open a WB card and explicitly read native-currency prices per size, including the seller and WB Club discounts. This reduces a concrete source of bad margin assumptions: collapsing multiple size prices or treating the displayed price as seller revenue. Failed updates keep visibly dated evidence. The next missing WB economic inputs are actual sales/returns, stock and settlement fees; price visibility alone does not establish profit or enable a safe automated price experiment. Real WB credential validation is still outstanding.
