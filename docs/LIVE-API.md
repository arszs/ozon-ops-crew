# Реальные данные Ozon — 12 октября 2026

Локальный сервер подключён к существующим Seller API и Performance API через внешние файлы ключей. Пути находятся в `~/.config/ozon-ops-crew/connection.json`; переменные среды имеют приоритет. Содержимое ключей и токены не передаются клиенту. Этот кабинет не классифицируется как китайский только по названию проекта: юридическая страна продавца не установлена этими запросами.

Главная и страницы товаров/интеграций используют `/api/live`, без подстановки демо при ошибках. Сохранившиеся старые планы и данные браузера не удаляются и не смешиваются с текущими данными API.

## Проверенные на реальном кабинете методы

Seller API:
- `POST /v3/product/list` — общее число товаров.
- `POST /v3/product/info/list` — цены в валюте ответа, названия и остатки выбранных SKU.
- `POST /v1/analytics/data` — сумма и количество заказанных товаров за последние 7 полных дней МСК; первая тысяча строк, отсортированная по сумме. Суммы строк сверяются с общими итогами, усечение показывается явно.
- `POST /v1/finance/accrual/by-day` — начисления за каждый день периода, с последовательным чтением всех страниц. Операции дедуплицируются; валюты не суммируются между собой.
- `POST /v1/finance/accrual/types` — проверен при интеграции справочник начислений.

Performance API:
- `POST /api/client/token` — сервисная авторизация.
- `GET /api/client/campaign` — инструменты, состояния и стратегии кампаний.
- `POST /api/client/statistics/json` — асинхронные отчёты CPC.
- `POST /api/client/statistic/products/generate/json` — асинхронный отчёт CPO выбранных товаров.
- `GET /api/client/statistics/{UUID}` и `/api/client/statistics/report?UUID=...` — ожидание и чтение отчётов; ссылки из ответа не используются для передачи токена другим хостам.
- `GET /api/client/statistics/expense/json` — расход кампаний.
- `POST /api/client/campaign/search_promo/v2/products` — постраничный состав и статус CPO по SKU.
- `GET /api/client/campaign/{id}/v2/products` предусмотрен для текущих активных CPC-кампаний; на момент проверки активных CPC-кампаний нет.

Старый `/v3/finance/transaction/list` вернул HTTP 404; приложение использует новый метод начислений. `/api/client/statistics/all_sku_promo/products/generate/json` также вернул HTTP 404, поэтому расходы продвижения всего ассортимента не объявляются нулевыми. Отчёты CPC/CPO не называются полным итогом всех видов рекламы.

## Смысл показателей

«Заказано на сумму» не равно выручке от завершённых продаж. Начисления учитываются по дате финансовой операции и включают удержания; расходы из Performance API не вычитаются из них повторно. По товару распределяются только явные SKU-начисления. Нераспределённая часть сохраняется отдельно и сверяется с итогом магазина. Исторический эффект стратегии нельзя вывести из её текущего состояния.

Чистая прибыль не вычисляется без себестоимости, налогов и внешних расходов. Закупочная конвертация и ввоз не вводятся. Цены выводятся в валюте ответа API.

## Запуск и хранение

`npm start`, затем http://127.0.0.1:4173 . При первом запросе `/api/live` запускается фоновая синхронизация; клиент видит прогресс. Кнопка обновления не создаёт параллельных дублей. Последний снимок сохраняется в исключённом из Git `runtime/live-cache.json` с правами 0600, привязан к конфигурации подключения. При сбое старый снимок помечен явно. После 15 минут данные считаются устаревшими.

GitHub Pages не поддерживает этот сервер и не получает ключи или приватные данные. Сервер слушает только localhost. Публикация сервера с ключами требует отдельной авторизации пользователей; в рамках этой задачи не выполнялась.

Рекламные изменения не включены в адаптер чтения. Отдельный адаптер цены допускает только человечески подтверждённый RUB-план с повторной проверкой перед отправкой; реальная запись цены ещё не проверена. Чтение рекламных и финансовых отчётов не меняет магазин.


## Финансовая расшифровка товара и периодов эксперимента

Из карточки SKU можно выбрать 1–90 завершённых дней (начиная с 2022 года) и прочитать начисления. В плане эксперимента есть отдельные кнопки для базового и тестового периодов; незавершённый период не запрашивается. `POST /api/workspace/stores/:id/finance` принимает `{sku, from, to, refresh?}` и возвращает фоновое задание. Результаты доступны как `financeReadings` в `/api/workspace`. Повтор незавершённого запроса не создаёт параллельное чтение; после ошибки продолжается следующий несохранённый день. `refresh: true` создаёт новую версию завершённого отчёта.

Работник последовательно читает все страницы `/v1/finance/accrual/by-day`, фиксирует только полностью проверенные дни в `runtime/finance.json` и сохраняет хеши запросов/ответов с временем. После перезапуска незавершённые задания требуют явного продолжения. Смена API-клиента скрывает чужие результаты и останавливает фиксацию новых данных. Исходные номера отправлений, договоров и данные покупателей не сохраняются. Файл содержит отдельную проверяемую цепочку аудита. Это один локальный процесс, без распределённых гарантий и автоматической очистки истории.

Слагаемые по SKU: реализованная сумма, итоговая комиссия, итог доставки и явно привязанные к SKU сборы. Детальные услуги доставки, комиссия по прайс-листу, бонусы и софинансирование не складываются повторно с итоговыми полями. Остаток относительно общего начисления сохраняется как нераспределённая сумма всего магазина; он не приписывается выбранному SKU. Валюты не конвертируются и не складываются между собой. Справочник `/v1/finance/accrual/types` добавляет названия расходов; его сбой не скрывает корректные суммы.

Это учёт по дате начисления, не когортный результат заказов и не закрытая прибыль. Дневной метод не даёт количества реализованных единиц; себестоимость не выводится из количества заказанных товаров. Нужны сверка возвратов, себестоимость, налоги, внешние расходы и решение о распределении общих удержаний. Загрузка не завершает эксперимент автоматически.

Проверено 12 октября 2026: семь полных дней по реальному SKU, итог совпал с текущей сводкой начислений; на странице показаны продажи, итоговая комиссия, доставка, эквайринг и «Звёздные товары». Повторное чтение сохранило прежнюю версию. Документация проверена в браузере: [дневные начисления](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualByDay), [типы начислений](https://docs.ozon.ru/api/seller/#operation/GetFinanceAccrualTypes). 153 локальных теста проходят.


## Сверка затрат и результат эксперимента

Для завершённой финансовой выборки добавлена форма сверки в валюте отчёта. Сумма API неизменяема; продавец вводит нетто-себестоимость, ещё не удержанные налоги и внешние расходы, знаковую долю общих начислений, подтверждённое число заказов и рекламный расход для проверки лимита. Затраты и их возвратные корректировки допускают разные знаки. Формула: **начисления SKU + доля общих начислений − себестоимость − налоги − внешние расходы**. Рекламный расход отдельно не вычитается: удержания Ozon уже в начислениях, внешняя реклама должна войти во внешние расходы. Неизвестные суммы оставляются пустыми; нули не подставляются. CNY и другие валюты API сохраняются без конвертации.

`POST /api/workspace/stores/:id/finance-reconcile` сохраняет новую версию для `runId`, `reportHash`, `currency`, `revision`. Изменения оптимистично блокируются при устаревшем номере версии; отчёт и аккаунт проверяются сервером. Продавец отдельно подтверждает полноту затрат, распределение общих удержаний и межпериодную сверку. Частичную сверку можно сохранить, но она не даёт положительного вывода о стратегии.

`POST /api/workspace/trial-plans/:id/ledger-result` принимает идентификаторы двух отчётов и их сохранённых сверок, описание доказательств, подтверждения исполнения и сопоставимости. Сервер сам извлекает суммы и сверяет магазин, SKU, даты и валюту с исходным планом. Результат замораживает источники и историю затрат. Неоднозначные операции цены блокируют завершение; неиспользованные согласования цены теряют силу. Повтор того же запроса идемпотентен. Исправленный результат сохраняется новой записью с указанием предыдущей.

Положительное изменение остаётся кандидатом на повторный тест, не доказательством причинности. Неполная сверка, неподтверждённое исполнение, несопоставимость, менее 30 заявленных заказов в периоде, поздно созданный план и превышение лимитов блокируют этот вывод. Порог 30 — эвристика, не тест значимости. Для сравнения не в RUB лимиты текущего плана в рублях не подтверждаются, поэтому итог остаётся недостаточно обоснованным. Разные валюты не суммируются.

Новая финансовая выгрузка или новая версия затрат делают старую оценку неактуальной. Главная направляет к пересчёту, старые цифры остаются в истории и не используются как актуальная рекомендация. Это вклад в результат по дате начисления с ручной сверкой, а не автоматически проверенная чистая прибыль или когортный рекламный эффект.

Проверка: 165 тестов. В изолированном браузерном сценарии (полностью синтетические данные) пройдены ввод затрат двух периодов, запись положительного сравнения, исправление затрат, отзыв старого вывода на главной и сохранение нового отрицательного результата с историей. На реальном аккаунте повторно прочитаны семь дней; затрат и результатов эксперимента от имени продавца не вводили. Дополнительно контролируется повтор финансового идентификатора между днями; при конфликте нужен полный новый отчёт.


## Подтверждаемое отключение CPO одного SKU

В «商品利润实验» доступен структурированный план «指定商品 CPO 开启 → 指定商品 CPO 关闭». Проверка читает весь текущий список CPO, сверяет платформенный SKU и артикул продавца с Seller API, сохраняет статус и текущую ставку. Отдельно запрашивается фиксированная ставка через `POST /api/client/search_promo/get_cpo_min_bids`. Недоступная ставка не подменяется нулём и не мешает остановить продвижение. Отсутствие SKU в списке не доказывает отключение.

Подготовка → подтверждение точного снимка → исполнение в даты теста → отдельная сверка статуса. `POST /api/client/search_promo/product/disable` передаёт ровно один SKU. Подтверждение действует 15 минут; перед отправкой повторно проверяются состояние, Seller/Performance аккаунты и артикул. Токен Performance привязан к версии учётных данных. Тайм-аут, неожиданный ответ и перезапуск во время отправки оставляют результат неопределённым; повторная отправка запрещена. Наблюдение `searchPromoStatus=false` подтверждает только текущее состояние, а не причинность изменения. Незавершённая операция блокирует завершение или отмену плана; отмена/завершение отзывают оставшиеся согласования.

Локальные маршруты: `POST /api/workspace/trial-plans/:id/cpo-check`, `/cpo-operation`; стандартные `/operations/:id/approve`, `/execute`; отдельный `/operations/:id/cpo-status`. Доступно только для основного подключённого Ozon-аккаунта. Общий адаптер чтения по-прежнему запрещает изменяющие методы.

**Граница первоначальной версии:** отключение CPO выбранного товара. Включение добавлено ниже, в разделе «CPO: включение и подготовка базового периода». Изменение ставки, CPC и продвижение всего ассортимента не поддерживаются. Общий расход не становится автоматически нулевым: остаются другие инструменты и поздние начисления. Автоматическое восстановление рекламы, контроль бюджетов и остановка по расходу ещё не реализованы. Ставка не оптимизируется произвольно: прежний метод установки CPO ставки в официальной документации помечен Deprecated.

Проверено на реальном аккаунте: чтение списка, совпадение SKU/артикула в Seller и Performance, получение фиксированной ставки. Проверенный товар уже выключен и недоступен для CPO; реальное отключение не отправлялось. В изолированном браузерном сценарии с синтетическими данными пройден весь гейт, отдельная сверка и переход главной к наблюдению прибыли. 178 тестов проходят, включая смену ключей, неполную пагинацию, неверную идентичность, устаревшее подтверждение, неоднозначную отправку и восстановление после перезапуска.

Источники: [состав CPO](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_ListSearchPromoProductsV2), [фиксированные ставки](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_GetCPOMinBids), [отключение CPO](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_BatchDisableProducts), [устаревшая установка ставки](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_SetSearchPromoBidsV2). Схемы проверены в браузере 12 октября 2026.


## Обновление дашборда и ограничения запросов

Дашборд читает число товаров одним запросом `/v3/product/list` с `limit:1`; цены и остатки дополняются только для SKU с активностью из отчётов. Полный каталог остаётся отдельным SQLite-процессом. Поэтому большой ассортимент не вызывает ошибку старого лимита синхронной выгрузки и не требует повторного обхода каталога для каждого обновления экономики.

Открытый интерфейс проверяет свежесть снимка; спустя 15 минут сервис запускает одно совместное обновление для параллельных запросов. При полном отказе экономических источников прежний снимок сохраняется, а отдельная запись последней попытки содержит безопасные коды ошибок и время следующей попытки. Успешное чтение только каталога/списка кампаний не заменяет прежние экономические данные пустой витриной. Частично успешный снимок оставляет непрочитанные суммы неизвестными. Источники показываются на китайском в раскрываемом блоке; сохранённый результат после перезапуска помечается отдельно от новой попытки.

Read-адаптер Seller API и транспорт Performance API учитывают `Retry-After` при 429: следующая попытка для того же Client ID останавливается до указанного срока (по умолчанию 60 секунд при отсутствии корректного заголовка). Сами транспорты не повторяют запросы. Сервер ограничивает повтор неудачной синхронизации с увеличением паузы; кнопка обновления показывает время доступного повтора. Эти ограничения локальны одному процессу; распределённый лимитер и сохранение пауз между рестартами ещё не реализованы. Другие Seller-адаптеры фоновых задач сохраняют собственную остановку/возобновление при ошибке.

Кэш версии 2 привязан к Seller-ключам и фактической версии Performance-ключей, а не только пути к файлу. Соответствие проверяется перед и после чтения; смена аккаунта очищает отображаемый снимок и не допускает сохранения смешанного результата. Старые файлы кэша не принимаются как подтверждённые данные нового подключения.

Проверка: 194 теста. Реальное обновление завершилось: продажи, начисления, CPC/CPO выбранных товаров, состав рекламы и цены прочитаны; количество каталога получено отдельным коротким запросом. Недоступность отчёта CPO всего ассортимента (404) остаётся явно отмеченной. Реальный 429 наблюдался до изменения; поведение паузы и отсутствия повторных запросов проверено контролируемыми ответами. В браузере проверены новые реальные статусы и синтетический сбой: старые суммы сохранены, причины раскрываются, обновление отключено до срока. Внешних записей на площадку не выполнялось.

Семантика заголовка: [HTTP Retry-After, RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3).


## Рекламные отчёты по периодам эксперимента

`POST /api/workspace/trial-plans/:id/ad-read` принимает только период `a`/`b` и явный `refresh`. SKU и даты выводятся сервером из сохранённого плана; текущий период обрезается до вчерашнего дня по Москве. Поддерживается основной live Ozon. Worker сохраняет раздельные CPC/CPO результаты частями не более 31 дня, для исходных планов до 90 дней. Кампании запрашиваются пачками по 10, включая неработающие кампании текущего списка. Повторный старт разделяет существующее задание; завершённые части сохраняются и возобновляются после прерывания. Явное обновление создаёт новую версию.

Учётная запись Seller + Performance проверяется до/после запросов, в том числе при опросе асинхронного отчёта. В приватном `runtime/advertising.json` сохраняются хеши запросов/ответов, состояния инструментов и суммы SKU; исходные полные отчёты не сохраняются. Реальное чтение одного SKU за семь дней успешно: оба расхода совпали с отдельными CPC/CPO значениями снимка за тот же период. Рекламу не изменяли.

Отсутствующий источник или нераспределённые расходы не становятся нулём. Столбец CPC из CPO-отчёта не добавляется второй раз. Сумма доступных расходов может вызвать предупреждение о превышении бюджета; меньшая сумма не доказывает соблюдение бюджета. Сегодняшний день, удалённые/не возвращённые исторические кампании, продвижение всего ассортимента и другие инструменты не гарантированы. Затраты не вычитаются повторно из финансовых начислений и не заполняют автоматически поле подтверждённого полного рекламного расхода.

Последнее известное превышение сохраняется как предупреждение о прошлом чтении, если новое чтение не дало суммы. Пауза 429 сохраняется в записи задания. Это локальный worker с ручным запуском; нет расписания проверок, автоматического останова рекламы и распределённой блокировки.

Официальная документация просмотрена в Chrome 2026-10-12: [отчёт кампаний](https://docs.ozon.ru/api/performance/#operation/SubmitRequest) — максимум 62 дня, JSON-вариант и RFC3339 даты; [CPO выбранных товаров](https://docs.ozon.ru/api/performance/#operation/SearchPromoProductsReportSubmitRequest) — состав расходов и JSON-вариант. HTTP-чтение документации вне браузера вернуло redirect loop.


## Ежедневная проверка рекламного бюджета

`POST /api/workspace/trial-plans/:id/ad-monitor` с булевым `enabled` включает/выключает локальный планировщик только для выбранного незавершённого плана основного Ozon. По умолчанию он выключен. Начало — после первого полного дня теста; ежедневная проверка в 09:00 Москвы, не позднее седьмого дня после окончания теста. Включение после дневного времени допускает один ближайший запуск. Worker читает только тестовый период до вчера, никогда не меняет рекламу и не отправляет сообщения. Базовый период читается отдельно вручную.

Приватный `runtime/ad-monitoring.json` хранит следующее время, версию настройки, контекст плана, хеш подключения и аудит. Следующий день резервируется до сетевого вызова, поэтому сбой/перезапуск не создаёт частых повторов. За один проход запускается максимум пять проверок, последовательно; большие очереди могут отставать от 09:00. Ошибка ждёт следующего дня, ручное чтение доступно отдельно. Смена подключения отключает расписание; отмена/завершение плана или истечение окна также прекращают новые чтения. Отключение не отменяет уже отправленный запрос отчёта и не удаляет данные.

Сервер должен работать; распределённого планировщика и гарантии круглосуточной доставки нет. Прерывание незавершённого чтения обозначается явно; продолжить его можно вручную. В открытом интерфейсе включённые расписания проверяются раз в минуту, активные чтения — раз в три секунды. Ошибки ежедневной проверки становятся отдельным следующим действием на главной.

Неполный свежий отчёт или отчёт с более коротким периодом не снимает ранее прочитанное превышение бюджета. Старое предупреждение отмечается как относящееся к предыдущему чтению, суммы разных версий не складываются. Полное обновление CPC/выбранного CPO может заменить прежние суммы, но всё равно не доказывает полноту всех рекламных расходов.

Проверка: тесты с управляемыми часами на суточное расписание, повторные вызовы, перезапуск, смену подключения, отмену плана и отключение во время чтения. Chrome: включение на изолированном синтетическом плане запустило один отчёт и показало следующее время; отключение сохранило отчёт. Ноль операций изменения магазина в тестовом сценарии. Для реального аккаунта расписания не включались.

### Advertising evidence in experiment comparisons

`POST /api/workspace/trial-plans/:id/ledger-result` derives primary-Ozon advertising proof on the server from the latest account-bound report matching each original SKU/date period. Client-supplied advertising proof is not trusted. Both CPC and selected-product CPO must cover the complete period with consistent RUB totals before the financial comparison can produce a substantive verdict. Missing coverage, seller ad totals below observed spend, and API-observed budget overruns yield `insufficient`; observed ads are never deducted again from accrual-based contribution.

Comparisons freeze report IDs, hashes, dates, coverage, state and amounts. Advertising-only refreshes invalidate old recommendations and enter the revision fingerprint. Credential rotation hides old evidence; an account change during proof collection rejects the operation. Missing Seller/Performance configuration yields missing proof instead of a fabricated zero. Historical comparisons without advertising proof return `unverified_advertising`. Other Ozon stores still rely on manual ad reconciliation. No new marketplace write scope is introduced.

### Repeat plans from reviewed results

`POST /api/workspace/trial-plans` optionally accepts `repeatSourceId`. A repeat must use the latest observation for that store/SKU, linked to the current result of a completed plan, with `repeat_candidate` and positive contribution. Store/SKU, both strategies, execution mode and each period's duration must match. The baseline must start after today in Moscow and after the original test period. Dates, budgets and the acknowledgement remain explicit inputs; price tests still require the latest matching cost profile and margin checks.

API-based sources are rechecked through FinanceService and AdReadingService at submission; missing or superseded evidence rejects the repeat. The saved `repeatOf` is built on the server (trial/plan IDs, source hash, evidence type, delta and currency); a client-supplied object cannot forge that lineage. Manual source observations stay manual. Creation makes no marketplace calls that mutate state and copies no previous approval or monitoring schedule. Restoring a baseline before the new comparison remains manual.

## CPO: включение и подготовка базового периода — 2026-10-13

Планы основного Ozon-магазина поддерживают оба направления: CPO включён → выключен и выключен → включён. `/cpo-operation` принимает `phase: baseline | test`: базовая операция восстанавливает исходную стратегию, тестовая применяет вторую. Каждая требует собственного подтверждения версии и отдельного исполнения. Базовая операция разрешена с дня перед началом базового периода до его конца по Москве; тестовая — в тестовый период. Восстановление после начала базового периода не делает эти даты полным наблюдением и блокирует содержательный вывод.

Включение отправляет только один SKU через `POST /api/client/search_promo/product/enable`. Перед подтверждением и отправкой проверяются принадлежность товара обоим аккаунтам, выключенное состояние, доступность продвижения, текущие процент/стоимость заказа RUB и фиксированная котировка. Котировка из `get_cpo_min_bids` показана как числовое значение API: единица в этой схеме не указана. Подтверждение действует 15 минут. Повторное получение токена проверяет, что локальная конфигурация аккаунта не изменилась.

Этот метод не принимает ставку или бюджет: конечную котировку выбирает Ozon. Экран явно показывает, что включение создаёт расходы, а базовый период не ограничен бюджетом тестового. Нет автоматического возврата, остановки или повторной отправки. Ответ `update: false` блокирует операцию и позволяет отдельную проверку состояния; таймаут, неизвестная схема или противоречие `update: true` с ошибкой оставляют неопределённый исход без повторной отправки. Успешный ответ ещё требует отдельного чтения состояния.

Изменённая котировка и позднее восстановление сохраняются в доказательствах сравнения. Новые сведения делают прежний вывод неактуальным, создают новую неизменяемую версию результата и запрещают использовать устаревший результат как основание повторного теста. Историческая проверка базовой операции не перезаписывает более позднюю тестовую операцию.

Схемы: [включение](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_BatchEnableProducts), [фиксированная котировка](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_GetCPOMinBids), [текущие ставки и состояния](https://docs.ozon.ru/api/performance/#operation/ExternalCampaign_ListSearchPromoProductsV2). Проверено в официальной документации в Chrome 2026-10-12. Не используем устаревший метод произвольного изменения CPO ставки.

Проверки: 258 тестов; отдельный синтетический сценарий Chrome прошёл подготовку базового CPO, подтверждение, единственную отправку и чтение целевого состояния. Тестовая стратегия осталась невыполненной, аудит валиден. Реальных рекламных записей не выполняли; промышленное включение и возможность для китайского юридического лица не подтверждены этим сценарием.

Повторное реальное чтение 2026-10-13: SKU из сохранённого рекламного отчёта отсутствует в текущем списке CPO. Адаптер остановил подготовку вместо предположения «выключено»; доступность включения для этого товара не подтверждена. Реальная отправка не выполнялась.

## WB: китайский регион и фоновый каталог — 2026-10-13

Подключение WB задаёт `wbRegion: "cn"` для китайского кабинета или `"ru"` для российского. Для существующих записей без региона сохранён российский адрес; автоматического переключения или перебора доменов нет. Токен хранится только в отдельном env-файле магазина. Регион и хеш токена связывают каталог с подключением; смена региона/токена скрывает прежний кэш. Публичный ответ не содержит токен или путь к файлу.

```json
{"stores":[{"id":"wb-cn-shop","name":"我的 WB 店铺","marketplace":"wb","mode":"live","wbRegion":"cn","envFile":"/absolute/private/wb.env"}]}
```

Env-файл содержит `WB_API_TOKEN=...` с доступом к категории Content. Пример относится к локальному `~/.config/ozon-ops-crew/connection.json`, не к публичному репозиторию. Реальных WB-подключений сейчас нет.

Каталог: `POST /content/v2/get/cards/list?locale=zh`, `settings.sort.ascending=true`, `cursor.limit=100`, `filter.withPhoto=-1`. Следующий запрос использует точные `updatedAt` и `nmID` ответа. `cursor.total` — размер страницы, а не размер магазина; окончание только при значении меньше 100. До последней страницы общий размер неизвестен. Первая страница не выдаётся за полный каталог.

Существующий SQLite worker теперь принимает WB: атомарно сохраняет карточки, хеш ответа и курсор каждой страницы, продолжает после сбоя/перезапуска, позволяет поиск и просмотр частичного результата. `/stores/:id/catalogue` и WB `/stores/:id/sync` запускают фоновое чтение. Полный refresh создаёт отдельный проход; предыдущие записи не удаляются. Встречавшиеся повторно карточки обновляются без повторного подсчёта; отсутствие прогресса, повторный курсор и неверная схема прерывают проход. Не более 10000 страниц за проход.

Content-чтения карточек, предметов и обязательных характеристик используют общий последовательный транспорт по региону + токену, не чаще одного запроса за 650 мс. Транспорт запрещает изменяющие методы, не следует HTTP redirect и не возвращает исходные тексты ошибок платформы. 429 учитывает `Retry-After` / `X-Ratelimit-Retry` без автоматического повторения. Пауза каталога сохраняется в SQLite и действует после перезапуска, включая запрос нового прохода. Другие внешние клиенты и несколько токенов одного продавца не координируются этим локальным worker.

WB `nmID` хранится как идентификатор карточки; отдельно сохраняются размерные `chrtID` и штрихкоды. По ним доступен поиск. Цены, валюта и остатки из Content API не выдумываются; это не продажи, складской отчёт, результат модерации или подтверждение доступности карточки покупателям. Корзина и ошибки создания не входят в этот список. Китайские отзывы/вопросы пока явно недоступны вместо отправки китайского токена на российский домен.

Источники: [официальная китайская документация](https://dev.wildberries.cn/docs/openapi/item-management), [российская документация](https://dev.wildberries.ru/docs/openapi/item-management). Схема списка и лимит 100/минуту проверены 2026-10-13. Проверки: 270 тестов, включая 5000 карточек за 51 запрос, неизвестный общий размер, атомарное продолжение, идентичность, регион, паузу 429. Chrome: синтетический сбой второй страницы → продолжение → 123 карточки → поиск по штрихкоду → конкретная карточка. Реальный WB-токен, сетевой ответ аккаунта и производительность на настоящем магазине не проверены.

### WB prices by size (2026-10-13)

The product detail now explicitly reads `GET /api/v2/list/goods/filter?limit=1&offset=0&filterNmID=…` from `discounts-prices-api.wildberries.cn` or `.ru`, using the configured `wbRegion`. It requires the same store token to have Prices and Discounts access. `sizeID` is Content `chrtID`; the returned size set and vendor code must match the account-bound catalogue. Native `currencyIsoCode4217`, original price, seller-discounted price and Club-discounted price remain distinct. No exchange rate, buyer payment or settlement amount is inferred. Cost-form auto-prefill remains disabled. A separate, later human-gated native-currency price workflow is documented below.

Official contract inspected in the browser: https://dev.wildberries.cn/docs/openapi/item-management#tag/pricesAndDiscounts/operation/getV2ListGoodsFilter . The published category interval is 600 ms for Personal, Service and Base with secret tokens, and 15 minutes for Base tokens. Optional private connection field `wbPriceTokenType` accepts `personal`, `service`, `base-with-secret`, or `base`; absent information defaults conservatively to `base`. Set this only from the actual WB token type. The app adds a small interval margin, keeps category queues separate, shares deadlines across aliases of one token/region, persists attempts/deadlines and honors 429 retry headers without automatically retrying. These local limits cannot coordinate other software using the same account.

`runtime/wb-prices.sqlite` retains successful raw price responses, request-context/response hashes and failed attempts, bound to store and token/region hash. Cached reads never call WB. Only the explicit refresh button makes an external read. A failed refresh preserves the previous matching snapshot as stale; account rotation hides old data, catalogue size changes invalidate it, and snapshots older than 15 minutes are labelled old. Missing products, currencies, malformed sizes or partial responses are not zeros.

Validation: 280 automated tests pass. Chrome checked explicit price loading for two synthetic CNY sizes, then a simulated HTTP 403 retaining the old values. No live WB account is configured; this is a real API adapter verified against documentation and synthetic responses, not a claim of a successful production WB call.

### WB seller-warehouse inventory (2026-10-13)

The WB product detail now reads the seller's warehouses with `GET /api/v3/warehouses`, then size inventory with read-only `POST /api/v3/stocks/{warehouseId}` and `{chrtIds:[…]}`. The regional host is `marketplace-api.wildberries.cn` or `.ru`; the connected token needs Marketplace access. The request contains size identifiers from that account's saved catalogue, not nmID or barcodes. Warehouse deletion status excludes a warehouse from reads; `isProcessing` remains visible and does not imply a failed inventory read.

Official CN documentation inspected in the browser: https://dev.wildberries.cn/docs/openapi/item-management#tag/sellerWarehouses/operation/getV3Warehouses and https://dev.wildberries.cn/docs/openapi/item-management#tag/sellerWarehousesInventory/operation/postV3StocksWarehouseId . Both groups document 300 requests/minute, 200 ms intervals and 4xx consuming ten requests. The shared read transport uses separate warehouse/inventory queues, a 210 ms margin, ten-request debt for 4xx, regional/account binding and no redirects. Stock mutation bodies and methods are not exposed.

`runtime/wb-inventory.sqlite` persists a background run, the warehouse list, successful and failed tool attempts, raw successful responses and input/output hashes. Each warehouse checkpoints independently. Failure stops the worker, preserves prior values and offers explicit continuation; rate deadlines persist across restart and token aliases. Full refresh re-reads the warehouse list; continuation uses the saved list and skips already committed warehouses. Account/region or catalogue size changes cannot silently reuse another inventory identity. Cached GET/status polling never calls WB. Closing the browser does not stop the local worker; stopping the server requires explicit continuation afterward.

The Chinese UI shows each warehouse and size separately. Explicit `amount:0` is zero; a missing requested size is unknown. Old warehouse values remain dated and flagged after a failed refresh, and values older than 15 minutes are stale. There is no cross-warehouse total and no claim that this includes WB platform-warehouse inventory or guarantees purchase availability. Warehouse snapshots may differ in time. WB daily financial-report reads are described below; platform-warehouse inventory and advertising sources remain unfinished.

Validation: 292 automated tests pass. Chrome checked warehouse 1 success → warehouse 2 failure → continue warehouse 2 only, including reported zero versus a missing size. All WB responses were synthetic, with no live token configured or stock writes performed.

### WB financial reports (2026-10-13)

The Chinese store dashboard explicitly starts a persistent read of daily reports from the region-specific `finance-api.wildberries.cn` / `.ru` host: `POST /api/finance/v1/sales-reports/list`, then `POST /api/finance/v1/sales-reports/detailed`. These POST methods read data; they do not mutate the marketplace. The list requires Finance access with a Personal or Service token. Select 1–31 complete Moscow days, defaulting to the last seven. Source: [official WB Finance documentation](https://dev.wildberries.cn/docs/openapi/documents-and-accounting), checked 2026-10-13. Operational sales estimates are not used as settled monetary evidence.

`runtime/wb-finance.sqlite` stores account/region-bound runs, normalized reports and detail rows, tool request/output hashes, append-only attempts and rate deadlines. Requests are separated by at least 60.1 seconds across local token aliases; Retry-After / X-Ratelimit-Retry deadlines persist. The worker waits in the background, saves each page atomically and stops on failure. Explicit continuation resumes the last committed offset/rrdId, including after a server restart. GET/polling never contacts WB. This single-process queue cannot coordinate other applications using the account.

List pagination ends on empty/204; detail pagination requires 204, never an empty 200. The reader rejects nonadvancing or unordered cursors, conflicting duplicate IDs, duplicate same-day/type/currency reports, mismatched report identities/currencies and reports without detail rows. Report IDs and rrdId use lossless JSON source parsing and decimal string cursors; money uses exact millionth-unit integers, preserving WB thousandths. Only selected financial/product fields are requested and retained. Seller financial names, buyer tax identifiers and order identifiers are not stored. Unknown fields are discarded.

The dashboard shows `retailAmountSum` and `bankPaymentSum` separately per native currency, plus explicit report-day coverage. Missing days and absent reports do not mean zero sales. A failed same-period refresh retains the completed snapshot with an old-data label; different periods and changed credentials never inherit it. SKU detail groups money by the original document/operation and currency; sales and returns stay separate. Unallocated nmID=0 rows remain identified at store level. No inferred SKU net payout, actual bank receipt, profit or advertising uplift is claimed. Headline totals are not rebuilt by subtracting overlapping detail fees.

Validation: 308 automated tests and a Chrome synthetic fixture, including failure → resume → completed report → product financial detail. The UI labels the fixture as synthetic; no live WB token or production financial response is available. WB fee sign conventions, adjustments and coverage still require a real account before enabling profit comparisons or write operations.

### WB store contribution after seller cost reconciliation (2026-10-13)

Completed, fresh WB report reads now allow a local store-level cost reconciliation through `POST /api/workspace/stores/:id/wb-finance-reconcile`. This endpoint does not call WB or mutate a marketplace. Required amounts are net cost of goods sold (including returns), taxes not already deducted by WB, and external expenses not already deducted by WB. Values are in the selected report currency, with positive costs and negative reversals. No procurement-payment total or exchange conversion is inferred. Exact arithmetic preserves up to six decimal places.

Calculation: `sum(bankPaymentSum) − cogs − tax − external`. It uses the report's published total, without separately subtracting delivery, commissions, storage or advertising already included in that total. External advertising not yet deducted belongs in external expenses. This is a seller-reconciled contribution based on daily report periods, not WB-confirmed net profit, a bank receipt or a tax filing calculation. The seller must check period alignment, returns and double-counting; this does not establish causal advertising uplift.

A frozen calculation stores source run/hash, native-currency report total, selected coverage, seller inputs, masked evidence, confirmation flags, revision and linked evidence hashes in `wb_finance_costs`. Optimistic revisions reject simultaneous stale edits. Old versions remain available; a refreshed source requires a new explicit reconciliation even if its headline total did not change. A failed/unfinished refresh, aged snapshot, partial currency/date coverage or incomplete seller checks cannot supply the headline contribution. Partial-date calculations are retained as calculations for the returned reports only. Currency groups remain separate and unreviewed currencies remain visibly pending.

Verification: 319 automated tests pass. Chrome exercised synthetic cost entry → CNY contribution → changed report → pending headline → explicit revision → new contribution, retaining both versions. WB production data and seller-account eligibility remain unverified; no real marketplace writes or claims of measured profit improvement.

### WB advertising statistics (2026-10-13)

The Chinese dashboard and SKU detail now explicitly read Promotion data from `advert-api.wildberries.cn` or `.ru`: campaign inventory `GET /adv/v1/promotion/count`, current configuration `GET /api/advert/v2/adverts?ids=…`, and period statistics `GET /adv/v3/fullstats?ids=…&beginDate=…&endDate=…`. Only these read paths are allowed; WB advertising start/stop/delete/bid/budget methods are excluded, including mutation methods that WB exposes as GET. Source: [official Chinese Promotion documentation](https://dev.wildberries.cn/docs/openapi/promotion), checked 2026-10-13.

The reader saves the complete returned campaign inventory, selects statuses 7/9/11 for statistics, and batches configuration/statistics by at most 50 IDs. Other statuses, missing configurations, missing campaign statistics and absent dates remain explicit. Missing data does not become zero spending. Campaign payment model, bid mode and placements describe the configuration when read, not proof of historical execution. Attributed orders and amounts are not completed sales, actual payment or causal advertising uplift.

`runtime/wb-advertising.sqlite` persists account/region-bound runs, campaign/configuration/statistics records, request/result hashes, attempt history and phase-specific rate deadlines. Explicit continuation resumes the failed batch; a local pause interrupts waiting/network reading without pausing marketplace campaigns. Service restart requires explicit continuation. Same-period failed refreshes preserve old snapshots; accounts and periods never inherit unrelated data. Oldest component age over 15 minutes marks a snapshot old. Cached GET and UI polling never contact WB.

Optional private store setting `wbPromotionTokenType` accepts `personal`, `service`, `base-with-secret`, or `base`; set it only from the actual token type. Missing information defaults to Base: inventory interval 15 minutes, configuration/statistics 1 hour. Other documented token types use 210 ms for inventory/configuration and 20.1 seconds for statistics. Deadlines and 429 retry headers persist across aliases/restarts. Local limits cannot coordinate other applications using the same account.

Money is parsed from original JSON number source into decimal strings and summed exactly; IDs retain int64 precision. SKU expenses are summed only from day/app/nm rows, without adding parent totals again. Campaign-vs-day-vs-app-vs-SKU discrepancies are preserved and labelled, rather than silently allocated to products. Different currencies stay separate. Dashboard expense only shares the financial headline when periods match; other periods remain in the advertising panel. Advertising is not automatically deducted from financial contribution again. The API's current campaign list cannot establish complete historical spending coverage, especially for deleted campaigns.

Verification: 336 automated tests pass, including 51-campaign batching, failed-batch resume, missing versus zero, old snapshots, currency/ID checks, alias deadlines, credential rotation and local pause. Chrome verified synthetic 50/51 failure → continue → 51/51 → correct product advertising detail. No real WB token, paid advertising action or measured commercial outcome is available.

### WB field reconciliation and SKU goods amounts (2026-10-13)

Financial snapshots now reconcile individual detail fields against each daily report, before combining periods. `forPay` and `retailAmount` use document direction (`Продажа` positive, `Возврат` negative) while preserving signed source corrections. An unknown document with a nonzero signed field remains unknown. Other compared fee fields retain their raw signs; they are **not** composed into a guessed payout formula. Matching errors in two different reports cannot cancel. Native currencies and account-bound snapshots stay separate.

The SKU view shows the observed goods-amount field after return documents, plus separate raw fee amounts. Store rows with `nmId=0` stay unallocated; they are not distributed by sales share. Neither this amount nor a successful field reconciliation is SKU contribution profit, cash received, full cost coverage or causal ad lift. Existing store-level contribution continues to use the returned `bankPaymentSum` and explicitly reviewed seller costs; the field reconciliation is a prerequisite for future SKU allocation, not a replacement for those header totals.

The detail request now also selects `paymentSchedule`. Older snapshots missing that field are retained and marked unknown rather than migrated to zero. A bounded local cache avoids rescanning all detail rows on each polling request; a new page/run invalidates it. Public differences are limited to 30 per currency with an explicit total count; all rows and reports contribute to checks. Calculation rule version: `wb-report-fields-v1`.

Sources verified: [regional Finance API](https://dev.wildberries.cn/docs/openapi/documents-and-accounting), [WB explanation of report columns and sale/return direction](https://seller.wildberries.ru/instructions/material/A-13), [unassigned deductions including promotion](https://seller.wildberries.ru/instructions/en/ru/material/A-70), [payment-schedule fee announcement](https://dev.wildberries.ru/news/161). Chinese account eligibility and production sample reconciliation remain unverified without a token.

Validation: 344 tests pass. Added checks cover signed returns, int64-scale decimal precision, opposite daily differences, unknown document types, missing legacy fields, multiple currencies, unassigned rows, page-cache invalidation, stale-source retention and account isolation. Chrome synthetic flow: home product amount → two opposite daily differences → refreshed reports reconcile → correct SKU detail, with shared deductions displayed separately. No real WB API call or write was performed.


### WB card creation through explicit review (2026-10-13)

Manual, non-synthetic WB products can select a subject and validate Russian characteristics against `/content/v2/object/charcs/{subjectId}` plus supported value dictionaries. The Chinese form collects integer package dimensions in cm, kg weight, real seller-provided size barcodes, marking status and documents. WB localization uses 60-character titles and a conservative 1,000-character description budget (a tool budget, not a universal platform limit). Schema validation does not prove product facts, category suitability, IP rights or legal compliance.

The gate displays Russian text, named characteristics, packaging, sizes, barcodes and documents in readable form. It freezes the exact body for regional `POST /content/v2/cards/upload`. Private connection configuration must declare `wbContentTokenType` as `personal`, `service` or `base-with-secret`; ordinary Base is unsupported. Preparation and execution recheck the token/account, schema, existing active and trashed vendorCode and positive free card quota. Paid-only quota is blocked. Approval and preflight expire after 15 minutes; local account aliases share a persistent 6.1-second creation spacing and an executing-operation reservation. This does not coordinate other applications using the token.

Exactly one write is attempted. Before-send failures reopen review; HTTP/network/ambiguous responses after sending remain unknown and cannot be replayed. Restart preserves this uncertainty. A separate read matches vendorCode, subject, title, description, brand, dimensions, characteristics and sizes/barcodes. It does not verify document verdicts, marking acceptance, moderation or sale availability. A later missing/mismatching read removes the current successful status without permitting another creation. Credentials and raw platform error bodies are excluded from error evidence.

This increment sends no media, prices or inventory; it never copies a Taobao CNY price into the creation API's RUB size price. Images, prices/stocks, creation-error diagnosis and moderation remain required for the complete publication workflow. The source pipeline still requires structured exports; no Taobao account is available.

Source contract: [official regional WB item management](https://dev.wildberries.cn/docs/openapi/item-management), checked 2026-10-13. Validation: 362 automated tests and Chrome fixture save → revalidate → category approval → readable publication gate → one synthetic submission → matching readback, with audit integrity and no browser errors. All WB responses were controlled fixtures; no real WB token or marketplace write was used.


### WB Russian image upload and visual readback (2026-10-13)

After card metadata is observed, the Chinese migration view can prepare a separate image gate. The adapter uses regional `POST /content/v3/media/file` with multipart `uploadfile`, `X-Nm-Id` and ordered `X-Photo-Number` headers. It uploads local processed PNG bytes directly; no public asset hosting is needed. PNGs must have confirmed rights, matching SHA-256 content IDs, static format, at least 700×900 resolution, at most 32 MB and the tool's 30-megapixel decode limit. These checks do not prove adequate visual quality, absence of logos or legal permission.

The initial batch requires a freshly matched card created in this workflow with no existing media. The gate freezes account, nmID, source revision, files, positions and any visually confirmed prefix. Preparation and execution use current card content; source changes, account changes, existing-image changes and expired 15-minute approvals block sending. Each file has a durable attempt and receipt. A token/region reservation prevents overlapping local media batches; a 650-ms file spacing and persisted 429 deadlines survive restart. Other applications and different tokens for the same seller are not coordinated.

A failure stops the batch. Accepted files are not resent. An ambiguous file remains unknown, including after restart. The seller reads WB photos, opens each full-size preview and explicitly confirms content/order against approved local images. Counts/URLs alone do not establish image identity, and an absent ambiguous file cannot be cleared automatically. Fresh readback at confirmation binds the decision to the same media snapshot. Only visually confirmed progress permits a new gate for the remaining, unsent positions. Later changed observations remove current completion; older operations cannot overwrite newer progress.

No media list replacement/deletion, prices, stock or moderation approval is performed. Platform CDN URLs are restricted to WB image domains; unknown hosts fail closed. Source file hashes and WB media-list hashes are different evidence: platform recompression means there is no byte-level identity claim. The app remains a single-process local prototype.

Source: [official WB Media Files contract](https://dev.wildberries.cn/docs/openapi/item-management), checked 2026-10-13. Validation: 374 tests pass, including multipart bytes/order, partial resume, ambiguity/restart, missing media, credential/asset changes, deadlines, concurrent clicks and human confirmation. Chrome synthetic flow verified two-image gate → two uploads → side-by-side readback → saved visual confirmation; exactly two fixture writes and valid audit. No real WB account was used, and no files were sent to WB.


### WB native-currency price changes (2026-10-13)

Product detail and verified imported-card pages now offer a Chinese price form. The server reads Content identity/sizes and current Prices data again before preparing a plan. The currency must exactly match `currencyIsoCode4217`; no CNY/RUB conversion is performed. Uniform mode sends one item to `POST /api/v2/upload/task` with integer base price and seller discount. Size mode requires `editableSizePrice`, sends every size to `POST /api/v2/upload/task/size`, and preserves the seller discount. Club discount is preserved in both modes. This is separate from Ozon trial price execution and does not claim that a WB price experiment has already improved profit.

All sizes need explicit fixed per-unit costs, proportional fees, a minimum scenario margin and seller acknowledgement of costs/promotions. The guard evaluates the Club-discounted scenario with integer decimal arithmetic and conservative rounding, showing a per-size minimum base price. Costs may include fulfilment, advertising and returns; proportional fees must not repeat those amounts. These seller assumptions are neither settlement profit nor a guarantee about final buyer prices, platform subsidies or promotions. Blank costs never become zero. Submitted plans freeze the cost values with the exact request and price/context hashes.

Confirmation and execution remain separate. Both the fresh snapshot and human approval expire after 15 minutes; expiry is checked again after API queue waiting. Changes in token/region, product, sizes, current price, currency or discounts require a new plan. Only Personal, Service or Base with secret token profiles are supported for this write workflow; both private `wbContentTokenType` and `wbPriceTokenType` must be explicitly configured, with the corresponding Content and Prices permissions. Basic tokens remain read-only here. The narrow price-write capability shares the read queue and persistent retry deadlines in `runtime/wb-price-api-limits.json` per token/region. No automatic price write retry is performed.

API acceptance stores the task ID, not success. Explicit verification reads the current item price, `GET /api/v2/history/tasks?uploadID=…` and processed item details at `/api/v2/history/goods/task`. Completion with task attribution requires successful matching rows for the exact item/sizes/currency/price/discount plus matching current prices. Pending history is not completion; cancelled, partial or wholly failed tasks stop the workflow. Quarantine requires checking the WB account. An ambiguous submission without a task ID can only be marked as a subsequently observed matching price, explicitly without attributing that change to this operation. Restarted in-flight writes become unknown and cannot be replayed. A newer plan prevents an old operation from re-establishing itself as pending.

Source: [official WB Prices and Discounts methods](https://dev.wildberries.cn/docs/openapi/item-management), contract inspected 2026-10-13. Validation: 386 automated tests pass. Twelve new tests cover native currency and discount arithmetic, minimal margin floors, field/size identity, expired and superseded approvals, concurrency, ambiguous writes/restart, partial task failures, exact task details and shared persistent rate limits. Chrome exercised price 80 CNY rejected → input costs retained → 150 CNY reviewed → exactly one fixture submission → successful task/current-price readback, with valid audit and no browser errors. The screenshot and all WB pricing responses are synthetic. No real WB token or marketplace mutation was used. At that price-workflow checkpoint, WB inventory writes were unfinished; the subsequently added stock flow is documented below. Moderation tracking, buyer reply writes and measured business uplift remain unfinished.


### WB selected warehouse and size inventory changes (2026-10-13)

The Chinese SKU detail now offers an opt-in form for each fresh, active seller warehouse. Verified imported WB cards also expose a warehouse reader and the same form, so a new product does not require a full catalogue traversal before stock setup. Fresh Content identity, warehouses and selected warehouse stock are read at preparation and again before execution. There is no warehouse creation, platform-warehouse modification, stock deletion endpoint or cross-store sum.

The reviewed request uses `PUT /api/v3/stocks/{warehouseId}` on the configured regional Marketplace host, with `{stocks:[{chrtId,amount}]}`. Each chosen size receives an absolute available quantity, 0–100,000; unselected sizes and all other warehouses are absent from the request. Zero explicitly sets available stock to zero rather than cancelling existing orders. The seller must confirm physical available quantities after reservations. An API omission remains unknown and requires separate acknowledgement before setting that size; it is never silently treated as zero.

Exact-version human approval and the source snapshot expire after 15 minutes, including time spent queued. A changed account, warehouse, product/size identity or selected quantity stops execution before sending; changes in unselected quantities do not cause an overwrite or unnecessarily block the selected size. This preflight is not atomic with the WB update: another order can arrive between reading and writing. The app cannot provide compare-and-swap semantics absent from the API, so the seller must use a reliable inventory source and check the result.

The dedicated stock-write capability validates exact field names and shares the account/region inventory read queue, including aliases. WB's documented 200 ms inventory interval has a small local margin; 4XX responses count as ten requests. Shared deadlines persist in `runtime/wb-inventory-api-limits.json`; warehouse-list and inventory quotas are distinct. The same configured WB token requires Content reading and Marketplace access. No extra marketplace token-type field is inferred. API permission or warehouse/delivery restrictions still require a real-account check.

Only HTTP 204 records acceptance, without attempting to parse a JSON body. The official contract warns that incorrectly named fields can produce 204 without changing stock, so acceptance never becomes verified inventory on its own. Independent readback shows target versus current quantities and explicitly does not establish causation or on-sale status. Unknown submissions and restarted in-flight operations cannot be resent. If orders or external edits create a difference, the seller may acknowledge the observed current stock: it is reread before closing the old operation as `reviewed`, without replaying its old target. A new modification needs a new plan and approval. Missing current quantities cannot be closed as a verified difference. Older operations cannot displace a newer plan. Cached warehouse quantities read before a write are visibly stale and cannot start another form until refreshed.

Source: [official WB item management contract](https://dev.wildberries.cn/docs/openapi/item-management#tag/sellerWarehousesInventory/operation/putV3StocksWarehouseId) and [official API call map](https://dev.wildberries.cn/cases/135/the-wb-api-call-map), checked 2026-10-13. Validation: 398 tests pass, including twelve new stock workflow tests. Chrome ran 8 → 12, a synthetic sale reducing current quantity to 11, explicit difference review without resend, then a newly approved 11 → 20 and matching readback. Exactly two fixture writes occurred; the unselected size stayed 4 and the other warehouse stayed 3. Audit integrity holds and the browser reports no errors. All WB responses were synthetic; no real WB account or external mutation was used. Moderation/on-sale verification, Ozon stock writes, live buyer replies and the real SKU/business benchmark remain unfinished.


### WB launch progress and listing-error diagnostics (2026-10-13)

Manual WB migration jobs now start with a Chinese launch-progress panel, before the detailed draft. It separately shows the saved card observation, human image review, latest account/SKU price operation and latest operation per seller warehouse. Stock observations describe only the sizes covered by that operation. These saved results are not a simultaneous current snapshot. Moderation and actual on-sale status remain unverified; no all-green launch claim is inferred from setup steps.

An explicit action starts a background read of `POST /content/v2/cards/error/list?locale=zh` with `{cursor:{limit:100},order:{ascending:true}}`. The reader continues using both `updatedAt` and `batchUUID` until `cursor.next === false`. Each committed page, cursor and request/response hash persists in `runtime/wb-listing-errors.json`. Errors, pause and server restart retain the last committed page; an uncommitted page can be retried explicitly. Duplicate batches, repeated cursors, malformed per-vendor reasons and account changes cannot advance progress. One worker owns each token/region, including aliases. A refresh starts a new run and preserves prior evidence, clearly stale when shown after an early refresh failure.

The interface matches `vendorCodes` and the `errors` map by exact seller article. A batch mentioning an article without reasons for it is not labelled that article's rejection. Earlier batch dates are marked against the publication time; even a later matching batch cannot establish which submission caused the error. Chinese keyword hints help locate title, description or required-attribute problems but are explicitly not complete translations or platform decisions. Original messages have email/phone data masked; unrelated subject/brand fields and raw message bodies are not persisted, only reduced errors and source hashes. No error scan reopens a publication gate or resends a card. The seller can open the regional WB draft-error page to inspect/fix it; in-app correction/resubmission remains unfinished.

The official error-method table specifies 6 seconds per request and shares limits with listing-limit reads; another nearby table gives token-dependent values. This implementation uses the conservative 6.1-second shared interval for explicitly configured Personal, Service or Base-with-secret Content tokens, and 30 minutes for Base/unknown profiles. `runtime/wb-content-api-limits.json` retains that shared deadline across process restarts; API Retry-After takes precedence. Ordinary Content card reads have their own queue. Rate-limited or failed requests are not automatically retried; subsequent new pages in an active successful scan are paced in the background. A local cache GET never calls WB.

Source: [official failed-listing API](https://dev.wildberries.cn/docs/openapi/item-management#tag/listings/operation/postV2CardsErrorList) and [official call map](https://dev.wildberries.cn/cases/135/the-wb-api-call-map), checked 2026-10-13. These methods report creation/edit errors, not a full moderation or on-sale lifecycle. The published creation contract allows up to 30 minutes for card synchronization and longer document validation; the product therefore keeps its 5–10 minute SKU goal separate from platform waiting time.

Validation: 408 tests pass, including ten new diagnostics checks for schema, exact vendor/cursor matching, masking, interrupted/restarted pages, stale evidence, token rotation, aliases, shared persistent limits and honest launch labels. Chrome verified first-page success → second-page failure → reload → resume from saved cursor → two pages completed with the correct article's Russian title/description errors and masked email. The synthetic publication stayed submitted and no new publication/mutation occurred. No real WB token was used. Authoritative moderation/on-sale confirmation, in-app corrected resubmission and the real 10-SKU/business benchmark remain unfinished.


## Store-specific home tasks (2026-10-13)

Both marketplace homes now show saved operational tasks directly below economics: uncertain/submitted/partial writes, stopped operations, pending approvals and unfinished manual SKU workflows. Every operation opens its exact gate; every SKU opens its saved job and WB launch panel when applicable. WB price/stock gates now have stable operation anchors. Opening a job waits for the new view to render before scrolling, including the existing migration queue.

The queue is scoped to the selected live store, excludes mock/sample/synthetic jobs and their operations, and suppresses replaced historical blocks and outdated draft-revision approvals. Older unresolved submissions remain visible even if newer records exist. Stock identity includes account and warehouse; price and stock progress cannot hide each other. Publication/media tasks replace the corresponding duplicate job task, while a verified partial image upload returns the seller to launch continuation. A WB imported card remains a launch-verification task, never proof of moderation or being on sale. The compact list shows four tasks with an expandable remainder. Local task refresh only reloads saved workspace state; it does not re-read or mutate marketplace products. This is not a live store health monitor.

Validation: 415 tests pass. Seven new tests cover store/synthetic separation, operation history, warehouse/account identity, edited draft revisions, uncertain submissions, partial media continuation, escaped/accessible overflow and a persisted stock workflow with independent result readback. Chrome verified 7 tasks → exact submitted-stock gate → synthetic readback → 6 tasks, launch-job navigation, local refresh and store switching. The fixture retained exactly one stock write from setup; navigation caused no writes. No real marketplace writes were performed.
