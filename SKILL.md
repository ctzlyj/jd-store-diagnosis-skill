---
name: jd-store-diagnosis
description: 京东POP店铺月度经营+广告全链路数据诊断。给定目标店铺（京麦店铺浏览器快捷方式、店铺名或广告账号），通过后台接口采集京东商智（jdsz.jd.com：交易/流量/商品/行业/搜索词）与京准通（jzt.jd.com：账户报表8维度/计划/分日/行业大盘/关键词榜单/流量解析）数据，输出结论先行、行动导向、可直接发给商家老板的JoySpace诊断报告+Excel数据表。当用户提到店铺诊断、经营诊断、广告诊断、京准通诊断、商智取数、店铺月度分析、诊断报告、帮商家看数据、店铺报告时使用。商家未开通京麦后台数据权限时，改走黄金眼（ge.jd.com）店铺看板 + 代理版旧商智取数。全程不抢占用户工作界面。
---

# 京麦店铺经营/广告数据诊断

给目标店铺做一次完整诊断，交付一份商家老板能直接看懂的 JoySpace 报告 + Excel 明细。

## 输入与前提

- 用户提供：店铺京麦快捷方式（.lnk）、店铺名、或广告账户号之一；诊断月份
- 模式 A 前提：本机已有该店铺的专用 Chrome profile（已登录商智/京准通）。没有则先创建 profile 并引导用户登录一次（说明：只需一次，后续复用）
- 权限范围：只在当前账号权限内取数，不绕过登录或权限

### 取数模式先判定

- **模式 A（默认）**：商家已开通京麦后台数据权限 → 本文六步流程，商智 jdsz.jd.com + 京准通 jzt.jd.com，细节见 `references/api-reference.md`；涉及「稳赚计划」诊断/投放建议时，机制与采集接口见 `references/surewin-mechanism.md`（`scripts/surewin-probe.js` 采集 ROI 建议档、参与上限与每轮消耗门槛；建议档、参与上限与每轮消耗门槛是三个不同的数，均为目标投产比口径，**不是点击出价**；cap 刷新节奏、rt=80 资格推荐池、cap/门槛变动归因流程（先查改价→实时订单→品退）、补单证据纪律均见该参考文档；**账面 ROI 按京东价口径（2026-09-30 确认），支付端优惠/焕新补贴报名前必须过盈亏线：cap ≥ 1/(实收毛利×(1−商家承担优惠深度)) 才可投**；机制结论区分【官方】/【已验证-本地】/【推断】，推断未实测前不得写给商家当结论）
- **模式 B**：商家**没有**京麦后台数据权限（拿不到店铺专用 profile、进不了 jdsz/jzt），但内部黄金眼 ge.jd.com 能查到这家店 → 按 `references/ge-shop-insight.md` 走「黄金眼店铺看板 → getAuthorityToSz 换代理旧商智」链路，用 `scripts/ge-sz-fetch.py` 采集（headless，不碰用户浏览器、不用 9224）。模式 B 下京准通计划/单元/关键词明细拿不到，广告只能给到商智口径的产品线与广告汇总，报告里必须坦诚写清看不到什么、为什么
- 两种模式的硬约束、分析要求（第 5 步）、报告与发布要求（第 6 步）完全一致，只是数据源不同；模式 B 不走第 1–4 步（无需店铺浏览器 / zguard）
- **采集工具优先级（2026-10-08 用户定规，长期遵守）**：京麦域任务**优先走京麦 CLI（jdo-cli）的官方接口**（约 189 个），官方 CLI 没有对应接口或当前账号无权调用时，才降级为浏览器页面接口（CDP 截获/页面内 fetch）。原因：浏览器高频页面接口会触发账号风控（shop.jd.com queryOrderPage 601 实例）；CLI 官方接口通道独立、风险低。降级时必须沿用各节的「风控降级路径」，禁止反复重试被风控的页面接口。各业务域对应的 jdo 能力见各节标注（如订单见 4b 的 `jdo-order-manage`）。
- **京喜渠道补充（2026-10-28 验证）**：店铺是京喜 C 店，或商智/黄金眼缺广告、CID、自然流量拆分时，用 EasyBI 京喜_通用数据集（1025136）补。它是**京喜渠道口径**，不等于全店，必须与商智/黄金眼对账后再下结论。指标 ID、查询命令、口径边界见 `references/easybi-jx-dataset.md`；指定店铺查询用 `scripts/easybi_shop_query.py`。
- **完整诊断矩阵（默认，2026-10-29 起生效）**：每次诊断按 `references/full-diagnosis-matrix.md` 覆盖全部板块——18 项概览、铺货节奏与货盘结构、经营与流量、商品、广告全链、货端质量（信息分/价格星级/店铺星级/好评率/售后率/稳赚分层）、行业对照、数据缺口、行动清单、数据说明。**板块不许删**：哪个源取不到，板块保留并写「数据不足 + 原因」。我们的独有能力（搜索词、京准通 8 维、实时订单、到手价、余额、稳赚、对投核验）全部保留，与 ODA 维度合并呈现。

## 硬约束（每次都必须遵守）

1. **绝不抢占用户工作界面**：所有页面操作用后台标签（createTab 第三参 background=true），标签用完关闭；启动 zguard 循环守卫把店铺浏览器窗口压到底层；绝不切换/导航用户正在用的浏览器
   - **例外=店铺浏览器窗口接管（仅限用户明确授权过的店铺 profile，2026-09-29 用户授权云擎四店+圣迪欧）**：定时采集或处理这些店铺的任务时，遇到店铺浏览器窗口开着，先**优雅关闭可见窗口**（WM_CLOSE，15 秒未退再强制）→ 拉起 headless 执行 → 任务结束**按原启动页重新打开**（多标签无法精确恢复，Ctrl+Shift+T 可找回）。只动已授权店铺 profile 的窗口；未授权店铺、用户个人浏览器仍然绝不触碰
2. **凭证不落盘**：Cookie/Token 不进源码、日志、报告、截图、Git；请求头在内存中生成/捕获使用（sz-fetch.js 已如此实现）
3. **报告零 AI 痕迹**：报告是运营顾问一对一写给商家老板的汇报，要让老板觉得是人认真写的、很重视他。核心要求：结论先行、行动清单紧跟结论放前面（老板没耐心看长文）、每个结论和动作挂数字依据、看不到的数据坦诚说明、不过度承诺；交付前自查一遍有没有 AI 腔，JoySpace 发布后评论数必须为 0。措辞、结构、口吻由你自由发挥，不套模板
4. **可回溯**：config、计划、原始数据留在任务 work/ 目录，报告中的每个数字都能回查
5. **投放产品线红线**：行动建议不推荐京准通「全站推广」产品线（即 fullMarketingScenarioTypeName = 「商品-全店商品推广」的托管计划）；全店/全站类托管统一要求走快车体系——快车-全店 优先积累访客、快车全站智能扩量。诊断中发现店铺存在京准通全站推广类计划（如「全店推广计划」）时，处置方向是收缩/迁移到快车，不是加该计划的预算或目标 ROI
6. **口径与交付闸门**：报告口径以 `references/metric-dictionary.md` 为准；派生指标一律脚本计算，不心算；交付前跑 `python -X utf8 scripts/validate_report.py --md <md> --xlsx <xlsx> --shop-id <id> --shop-name <name> --full`，0 FAIL 才发布，闸门输出随交付说明给出

## 流程（六步）

### 1. 环境准备

```powershell
powershell -File scripts/restart-shop-browser.ps1 -ShopProfile <店铺profile目录> -Port 9224
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/zguard-loop.ps1','-Port','9224','-Seconds','1800' -WindowStyle Hidden
powershell -File scripts/close-stale-tabs.ps1
```

zguard 循环约 30 分钟有效期，过期重启；防止店铺浏览器任何弹窗抢用户焦点。

### 2. 生成采集计划

复制 `scripts/diagnosis-config.example.json` 为任务目录下 `diagnosis-config.json`，填：诊断/对比日期、pin_id（京准通账户号）、cid2（商智行业类目）、cid3（京准通行业类目）、top_sku_ids（先跑第 4 步的 ind-kw-sku 再补填）。

```powershell
python scripts/make_plans.py --config diagnosis-config.json --out work/plans
```

产出 4 个计划：plan-sz.json（商智）、plan-jzt-report.json（账户/计划/分日）、plan-jzt-dims.json（报表 8 维度×当月+对比月）、plan-jzt-industry.json（行业大盘/榜单/推荐词）。

### 3. 采集商智（sz-fetch.js）

```powershell
node scripts/sz-fetch.js --plan work/plans/plan-sz.json --out work/sz --page https://jdsz.jd.com/szweb/view/index/home.html
```

- **签名（2026-09-15 起 szweb 强制）**：每请求算 `User-mnp = md5(pathname + uuid + 毫秒时间戳 + 固定盐)`，sz-fetch.js 已内置自动计算，直接用即可；若平台再改签名，回到页面里抓真实请求头对照排查
- 校验：gateway `header.code == 0`。响应在 `body.data`；size=0 表示无权限或参数错，对照 references/api-reference.md 修
- **响应 shape 差异**：多数端点 `body.data` 是 list；搜索词榜 `body` 本身就是 list；商品明细表（productTable）首行是 `$summary: true` 的合计行，统计明细前先过滤
- 建议加采三块（端点见 api-reference.md）：首页「商品诊断/流量诊断」（getProductAnalysisData / getFlowAnalysisData，官方预警口径）、「今日快照」（indexSummary/summary，实时口径仅看方向）
- 流量来源（flowSource）只有 APP 渠道口径，没有站外/PC 合并行，报告数据说明要写清这个限制

### 4. 采集京准通（jzt-run.js）

```powershell
node scripts/jzt-run.js --plan work/plans/plan-jzt-report.json --out work/jzt --nav https://jzt.jd.com/report/index.html#/rtb/basic
node scripts/jzt-run.js --plan work/plans/plan-jzt-dims.json --out work/jzt-dims --nav https://jzt.jd.com/report/index.html#/rtb/basic
node scripts/jzt-run.js --plan work/plans/plan-jzt-industry.json --out work/jzt-ind --nav https://jzt.jd.com/custom-report/#/industry/market
```

- 校验：`code == 1` 即成功。**响应 shape 有三种**：账户报表数据在 `data.datas`；行业 whole/billboard/area 数据在 `data.rows`（月度汇总在 `data.summariesMap.TOTAL_SUMMARY`）；热搜词榜/品牌榜 `data` 本身是 list。脚本日志 rows=0 有误导，先看 code 再解析 body
- **账户余额必查（断投风险）**：`POST https://atoms-api.jd.com/financecore/subaccount/allbalance/get`（body `{}`，页面上下文内 XHR）。cashBalance 为 0 或接近 0 → 广告可能已断投，必须进「立即做」行动项——断投不只是丢当天订单，智能计划的模型学习也会被打断

### 4b. 实时订单查询（当日数据，归因/核验专用）

商智是 T+1/快照口径、京准通报表是点击归因延迟口径——回答「**今天/刚才发生了什么**」（当日成交归因、稳赚 cap 当日变动归因、活动实时效果核验、商家口头反馈对不上报表）时，必须用京麦订单列表的实时接口，禁止拿商智快照当实时证据下结论。

**第一优先：京麦 CLI 官方接口 `jdo-order-manage`（订单管理，读+写，2026-10-08 用户提供）**：

| 场景 | API |
| --- | --- |
| 订单列表查询（按状态/时间分页，返回字段可自选） | `GET.sp-order.v0.orders` |
| 修改商家备注及旗标颜色 | `PUT.sp-order.v0.orders._orderId.vender-remarks` |
| 修改收货人/电话/地址（仅 SOP 等待出库状态） | `PUT.sp-order.v0.orders._orderId.consignees` |
| 按 SKU 分组拆成子单 | `POST.sp-order.v0.orders._orderId.child-orders` |

列表查询返回很全：订单状态、SKU 明细、支付信息（含 `actualPayAmount`=实付、`shouldPayAmount`）、收货人、配送方式、发票、买家/商家备注、售后单等。诊断/归因场景只用读接口（GET.sp-order.v0.orders），写接口不在本 Skill 范围。

**已实测可用（2026-10-08，云擎云仓/Ai/生活三店）**，调用模板与踩坑：
```powershell
jdo-cli invoke --url /rest/sp-order/v0/orders --method GET --profile <profile名> --params '<JSON>'
# params 必填项缺一不可（逐个报错提示）：page、pageSize(≤100)、sortBy(createdTime|modifiedTime)、sortOrder(ASC|DESC)、orderStatus(ALL)
# 可选：startTime/endTime(毫秒，按 sortBy 字段检索，窗口≤1个月)、scopeSet=["paymentInfo","skuItemInfoList","orderFlag"]
# 返回：orderId/createdTime/orderStatusDesc/paymentInfo.actualPayAmount(实付)/skuItemInfoList(含SKU名、促销明细)/orderFlag
# 焕新补贴订单在 orderExt.govSubsidyInfo 带「下单立减」标记，可识别补贴单
```
- profile 对应店铺（本机 `~/.jdo-cli/profiles/`）；若报 10201001005「页码小于1或者太大」，是调用方漏传了 `page` 必填参数，**不是权限问题**，补上 `page` 后重试即可（2026-10-08 吖嘟咪实测：漏传 page 报此错，补传后正常返回）。若真返回 403「无权限调用」，先核对是不是用了子账号 profile，主账号 profile 通常有全店权限
- actualPayAmount 可用于真实盈亏核算（实付/消耗），与报表京东价口径互为补充

```powershell
node scripts/probe-orders.js <cdp端口> <输出目录>   # 默认订单列表页 allOrders
```

- 原理：后台标签打开 `shop.jd.com/jdm/trade/orders/order-list?tabType=allOrders`，截获页面自己的 `dsm.order.bff.orderListBffService.queryOrderPage` 响应（结构化、50 条/页、最新在前）
- 解析要点：`body.body`（JSON 字符串）→ `data.results[]`：`orderCreateTime/paymentConfirmTime/orderCompleteTime`（毫秒时间戳）、`orderItems[].skuId/jdPrice/num`、`orderStatusInfo.orderStatusName`（已完成/已取消/已出库）
- 已验证场景（2026-09-28，稳赚 cap 归因）：商智显示「09-23 以来仅 1 件 41.82」，实时订单页实为「当日 21 笔 51.8–70.8 元」——T+1 快照把归因引向完全错误的方向
- 只读探测；订单含买家个人信息，原始响应仅留在任务 work/ 目录，不进报告/Git/日志
- **风控降级路径（2026-10-03 验证；2026-10-08 更新层级）**：shop.jd.com queryOrderPage 若返回 code=601 风控（提示「明天尝试正常浏览」），**不要反复重试刷接口**——降级顺序：①京麦 CLI `jdo-order-manage` `GET.sp-order.v0.orders`（首选，先做小样本实测）；②商智订单明细页 `jdsz.jd.com/szweb/view/tradeAnalysis/orderDetails.html`：页面自有接口 `szgateway.jd.com/api/lowcode/orderDetails/getDealOrders.ajax` **不受该风控影响**，页面内点「近7天/近30天」即可截获结构化成交明细（字段：`ItmId`=SPU、`OrdAmt`=订单金额、`SkuJdPrc`=京东价、`Time`=日期、`PayTm`=支付时间；成交/取消/售后三个页签）——T+1 口径，回溯近几日成交、终判类问题直接够用，当日归因以 CLI 为准。参考实现：`京麦广告诊断` 工作区 `work/_probe_sz_orders3.js`（页面点击+截获响应）。

### 4c. 普惠到手价查询（广告定价口径，投放/调价前必查）

**ROI、广告出价、点击成本的定价依据一律用「普惠到手价」，禁止用京东价。** 京东价只是展示价（例：云仓主投 SKU 京东价 60.8、到手 43.86，按京东价定价会把承受力高估 1.4 倍）；系统建议出价/推荐 ROI 是平台口径，不能直接抄。到手价随促销活动变动，每次开计划、调价、做投放方案前实时查询。

```powershell
node scripts/probe-arrival-price.js <cdp端口> <输出目录>   # 输出 all-skus.json（全店分页拉全）
```

- 原理：后台标签打开 `shop.jd.com/jdm/mkt/market/market-risk`（京麦 → 营销 → 促销工具 → 营销价格管理），页面上下文内 fetch `dsm.market.tool.common.api.PriceQueryOuterService.queryPriceInfoList`（`params` 支持 `pageIndex/pageSize/spuIds/skuIds` 过滤；无需 h5st，2026-09-29 实测 status 200）
- 关键字段：`perfectArrivalPrice`=普惠到手价（真实回款口径）、`jdPrice`=京东价、`minPrice`=理论最低价、`skuName/attrValueAlias`=规格；`wareId`=SPU
- 出价公式（用户确认）：**出价 ≤ 到手价 × 20% × 该词CVR**（单均广告成本 = 出价÷CVR ≤ 到手价×20%）；20% 低于已确认毛利 34.5%（云仓），留安全垫。低于 0.8 元起投下限的词删，不硬投；**京准通关键词计划系统最低日预算 50，不要再给低于 50 的预算建议**（2026-09-29 用户红线，原低于 50 的计划已全部提到 50）
- 关键词计划配套纪律（2026-09-29 四店实战定型）：控点击成本(CPC) + 切词匹配 + 否定词兜底；单均成本超线不加价；礼物类高价词全删；方案与报告中的关键词预算一律 ≥50，勿自相矛盾
- 只读探测，不创建/修改任何促销

### 4d. 采销协同投放（C+A 对投）后台核验（归因排干扰专用）

店铺所在采销账号可能用协同投放系统给商家对投（比例对投 / 稳赚联投）：采销在商家出价基础上协同加价共同竞价，消耗走采销账户。做广告归因、稳赚 cap 归因、消耗/ROI 口径核验前，先确认该店是否在对投范围内，避免把协同成交错归给商家计划动作。

- 入口（用户默认浏览器已登录采销账号，复用登录态的后台页签，不打扰工作页签）：`https://cxjzt.jd.com/msa/#/list/tab/plan?objective=overview`
- 访问方式（WebCLI 后台页签，任务结束必须 close 释放）：
  ```powershell
  webcli browser <session> --window background open "https://cxjzt.jd.com/msa/#/list/tab/plan?objective=overview"
  webcli browser <session> --window background state     # 计划列表表格在 state 快照里
  webcli browser <session> --window background close
  ```
- 读数要点（2026-09-30 实测）：该 SPA 用 network 抓不到数据条目（重载后 entries 为空），用 `state` 快照直接读表格；右上角先核对采销 pin/ERP/账户 ID 视角。表格列：计划名/ID（协同计划与店铺一一对应）、营销目标（商品-协同投放）、状态（有效/暂停中）、预算（不限/金额）、起止日期、花费、展现数、点击数、点击率、千次展现成本、平均点击成本、总订单行、总订单金额、投产比；列序用 CPM=花费/展现×1000、ROI=订单金额/花费 数学自洽校验后再读。
- **查采销设置的完整参数用编辑页**：列表/详情页的 SKU 表是「商家正在推广且命中圈选、实际触发协同的商品明细」，不是圈选配置；真实配置在编辑页 `https://cxjzt.jd.com/msa/#/operations/unit-edit/item/joint-bidding?campaignId=<计划ID>`（2026-09-30 实测可读：投放场景（比例对投/稳赚联投）的选择态、出价比例 input 值（官方公式：每次竞价时采销的出价 = 商家的出价 × 出价比例）、已选商品范围（圈选配置，如「所有的商品。1 个 店铺」/自定义SKU）、预算模式（不限/自定义）、推广时间起止）。只读查看，不点保存不改任何值。
- 归因影响：协同成交是真实成交（可能触发稳赚 cap 刷新，待验证），须从「商家动作→成交」因果链中剥离；协同消耗由采销账户承担、不计入商家自有消耗口径，商家口径 ROI 会被动变好；**「稳赚联投」会直接抬高指定稳赚品 ROI 上限，实验期间视为污染源**——比例对投不动 cap 与 ROI 上限，只放大竞价。
- 约束：只读核验；不创建/修改/启停对投计划（操作由采销执行）；页面是采销账户视角，不要当商家后台数据引用。

### 5. 分析（结论导向）

怎么组织、怎么措辞由你自由发挥，但产出必须满足：

- **结论先行 + 行动清单紧跟其后**：老板 3 分钟内能消化「发生了什么、要做什么」；动作按 A 立即（24小时内）/ B 本周 / C 本月编号，具体到可执行（给计划编号、给词、给出价、给金额），禁止「建议优化」这类空话；每条动作在后面明细里有数字依据可查
- 每个结论有数字证据（环比/对比期/同行/行业），归因到「能动手的杠杆」
- 计划处置四类：加投（ROI≥2 且花费≥100）/ 保持微调 / 降价收缩（ROI<1 且花费≥300）/ 关停（零订单且花费≥20）
- 报表 8 维度 0 行 = 全智能托管黑盒 → 必给「开手动快车」行动项；词单 = 商智搜索词高转化词 × 京准通行业榜单/推荐词，出价用行业参考价上下浮 10%
- 冷启阶段店铺（新店或全店访客 <300）的广告行动项按 `references/ad-cold-start.md` 执行：快车-全店 优先走「积累访客 → 全站智能扩量 → 稳赚计划」优先级、访客<300 不强行加量、按 CTR×CVR 四象限处置；判断前先确认店铺所处阶段，不套成熟店加量逻辑
- 行业对照双口径：商智（成交）+ 京准通（广告），分两小节
- 商智/京准通广告数据交叉核对（如全店推广计划花费两边应一致；ROI 差异是归因窗口不同，要在数据说明里解释）
- **广告消耗区分「红包/虚拟金」与「现金」两种口径**：新店红包、稳赚赔付红包都是虚拟金且限指定推广场景（30 天有效期）；报表消耗数字常把两者混在一起，把红包消耗当现金会把「红包低效」误判成「现金亏损」（2026-09 四店横评：总消耗 808 元里约 800 元是新店红包、现金仅约 8 元，带回 527 元成交——正确结论是红包低效，不是现金亏损）。写报告前先核对京准通财务账户-红包明细，消耗、ROI 与「是否亏钱」结论均按红包/现金分别表述
- 异常数据（单日异常、断投日、高基数失真）坦诚说明，不假装没看见
- **派生指标零手算**：环比、占比、ROI、CPA、客单价、UV价值、月化一律脚本计算；报告与 Excel 同源，同一指标只有一个数
- **行动项带量化目标和时限**：每条动作写清「做到什么数、什么时候验收」（如「11月客单价≥¥155」「两周后快车ROI≥4.4」），证据与动作一一对应
- **数据缺口逐项声明**：缺哪个维度、为什么缺、影响哪个结论；不删板块、不编数，取不到的板块保留并写「数据不足」
- **不完全月/大促脉冲**：部分月统一同期天数或日均，不与整月直接比；大促日、异常日单列，不混进日均结论
- **货端质量（数据可得时补）**：信息分、价格星级、店铺星级、好评率（剔除AI评）、售后率；取不到写数据不足，不套别的店阈值
- **对照锚点（可选）**：有老店教训、标杆店或前后阶段时，加一张「维度/锚点/本店/判断」表，比空泛的行业对比更有用

### 6. 产出报告并发布

- 骨架（完整诊断，板块不许删，指标到数据源的映射见 `references/full-diagnosis-matrix.md`）：结论（含三条核心）→ 行动清单 → 概览核心指标（18 项，含对比期与基准备注）→ 铺货节奏与货盘结构（上架节奏/品类/价格带/动销/集中度）→ 经营与流量（来源/搜索词/店内流转）→ 商品诊断 → 广告诊断（日度/漏斗+三级类目基准/产品线/活动依赖/余额/稳赚/红包现金/对照锚点）→ 货端质量（信息分/价格星级/店铺星级/真实好评率/售后率/稳赚分层/SKU点名）→ 行业对照 → 风险与数据缺口 → 数据说明
- **分层压缩**：正文只留结论/动作/判断/小表证据，大表（分日全量、全指标、TOP30+）放 Excel 并注明去向；商家会逐行看的表（计划明细、商品 TOP）不压缩
- **Excel 用 openpyxl 生成**：Sheet 与正文章节对应，命名「N-主题」；数字格式按指标类型设置（金额/计数/百分比分开），区间统一用「—」不用「~」（JoySpace 会把单个 ~ 渲染成删除线）
- **发布前跑结构闸门**：`python -X utf8 scripts/validate_report.py --md <md> --xlsx <xlsx> --shop-id <id> --shop-name <name> --full`，必须 0 FAIL。闸门查店铺ID（开头+数据说明两处）、标题带店名、章节齐全、A/B/C 行动、数据说明三要素、铺货/货盘/价格带/货端质量/行业对照/数据缺口板块、无 `~` 区间、无占位符、Excel 表数与店铺ID行
- **发布链（joyspace-access Skill）**：create 新文档（`--no-ai-mark`）→ `replace_doc.py <pageId> <md>` 整篇替换（自动备份+读回验证）→ `edit_body.py <pageId> insert-attachment --near "<结尾句>" --file <xlsx> --no-summary`（必须 `--no-summary`，否则生成 AI 摘要评论=失败）→ 读回验证内容命中 + 评论数 0 → 给用户链接
- **最终回复固定三要素**：报告链接、Excel 文件、一句话结论；发布失败必须明示原因，不允许只交本地文件不解释
- Windows 上若 `D:/Miniconda3/python.exe` 不存在，joyspace_cli.py 会找不到提取器：先 `$env:JOYSPACE_PYTHON=(Get-Command python).Source` 再跑

## 常见坑

- **切店必须换干净浏览器**：`restart-shop-browser.ps1` 旧版只清理同名 profile 的旧进程；换下一家店时，上一家店的 Chrome 仍占着 9224 端口，新实例绑定失败、就绪检查命中旧实例，后续所有采集会**打到上一家店**（2026-09 云擎四店实战踩中，靠 logininfo pin 对不上才发现）。现行脚本已自动清理端口占用者并在就绪后核验 profile 归属；多店批量任务仍应在每店开跑前用 `common/logininfo` 回读 pin 核对一次身份。
- **含中文的 .ps1 必须存 UTF-8 with BOM**：PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 解析，中文注释的乱码会**静默破坏后续语句的执行**（2026-09 实测：同一段过滤逻辑，无 BOM 版 `$mine` 判空、加 BOM 后正常；去掉中文注释也正常）。用 apply_patch 等编辑器改完 .ps1 后必须补 BOM（`[IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($true)))`）
- PowerShell 写 JSON 计划必须无 BOM：用 `[IO.File]::WriteAllText` 配 `UTF8Encoding($false)`；make_plans.py 已处理
- PowerShell 下 python 内联脚本读中文路径会 GBK 乱码报错（路径变 `??`）：改用相对路径，或设 `PYTHONUTF8=1`
- **PowerShell 命令行传中文会被安全层间歇性吃成 `?`，且 `?` 在 `-like` 里是单字符通配符**（2026-09-29 实测：中文 profile 名损坏后，任意店窗口开着都误判 profile 占用）：中文参数/路径不要经命令行传递——从配置文件读取或用 glob；PowerShell spawn 与 stdin 管道传中文同样会损坏。详见 skill `o2-windows-runtime` 的完整沉淀
- **任务/采集结束必须释放 headless 占用的店铺 profile**：headless Chrome 实例锁住 profile 后，商家/用户打不开该店铺浏览器窗口会被卡住。长采集脚本结束时显式关闭自己拉起的 headless 实例；接管的可见窗口按授权规则重新打开
- **给「尚未进采集配置」的店铺做一次性探测时，`release_store_browsers()` 帮不上忙**：它只遍历配置内的店铺（2026-09-30 紫气企业店接入实测：jzt 未激活探测失败后，配置外的 9235 headless 实例残留锁 profile，用户打不开店铺窗口）。任务局部脚本必须在自己的 `finally` 里按 profile 路径 + `--headless` 显式清理自己拉起的实例，不能依赖按配置遍历的释放函数
- **全新店铺的商智接口按「新账号态」返回**（2026-09 云擎四店验证）：tradeSummary 不传 `indicators` 返回 `size=0/data=null`（易误判为无成交）、indexSummary 直接报「indicators不能为空」——两者都必须显式传 `indicators` 数组；flowSource 对这类店一律 10001 参数校验不通过（未解，报告写明渠道拆分缺失）；行业大盘 20001 无权限（店级权限，行业对照改用京准通行业接口）。探测顺序：先用 productTable 拿真实成交与类目，再用 7/8 月单查确认是否新店，再补显式 indicators
- **新账号态 indexSummary 补充验证**（2026-10-23 圣迪欧实测）：indexSummary summary 端点显式传 4 指标 indicators（ord_amt/ord_qtty/uv/page_cnt）后可用，但 trend 端点同参数仍 10001——分日序列拿不到时用京准通广告分日（isDaily=True）替代呈现，报告写明全店分日成交缺失
- **T+1 出数日历月会漂移，取数前先探最新可用日**（2026-10-19 四店实测）：9 月批次 T-1（9/29）当天可查，10 月批次 10/18 当天 GE 与商智两侧均无返回（次日 10/23 确认 10/18 有数）——不要假设 T-1 恒可查，先用单日 query 探测，本期统一截至最后一个有数日
- **京准通分日报表 `obys` 不支持 `day`**：make_plans 旧版生成 `day|asc` 会 400「入参obys排序错误」，已改 `cost|desc`（isDaily=True 已按日分行）；跨店复用计划文件时注意 `pinIds` 是生成时的店铺账户号，换店必须重新生成，否则 400
- 商智/京准通口径不同（新快车 vs 广告点击 30 天累计），报告数据说明必须写口径说明
- 行业接口缺 `clickOrOrderCaliber/clickOrOrderDay/giftFlag/orderStatusCategory` 会 400「跟单口径缺失」
- 京准通 cid3 与商智 cid2 不是同一 ID 体系，分别从各自页面查
- 首页「今日快照」是 15 天口径，与月报 30 天口径不可比，只作观察
- zguard 循环约 30 分钟有效期，长任务中途过期就重启一次
- **账户余额 XHR 重放不可用**（`financecore/*/allbalance/get` 返回 -2011 loginMode is null）：可靠做法是后台标签导航 `jzt.jd.com/home` 读 DOM 文本里的「投放账户总余额/可用余额」（dongyue/home-balance.js、tools/jzt-balance.js 模式）
- **已发布报告要修改时，不要拿 JoySpace `read`/`export` 导出的 md 回灌**：导出会把 Slate 表格变成 HTML，`replace_doc.py` 回灌后表格就废了。正确做法：改本地原始 md 源稿 → 整篇 `replace_doc.py` 重新覆盖 → 因为整篇替换会干掉文末附件块，最后重新 `edit_body.py insert-attachment --no-summary` 补回 Excel；另外 `replace_doc.py` 不改外部显示标题，必要时用 `rename` 恢复
- **PowerShell 下 `replace_doc.py` / `edit_body.py` 退出码 1 是假阳性**（stderr 有输出就被当失败）：别看 exit code，看输出里的 `[ok]`、`verified: true`、`summaryCommentId: null` 和读回字符数判定成败

## 迭代

本 Skill 源自 2026-09 淡雅装饰画甄选店、墨派风画舍、京韵丹青装饰画店、冬月、全球锦宏优选（首例模式 B：无京麦权限，黄金眼 + 代理旧商智）、惠民日用供应链经营部（模式 B 第二例，部门类目构成因店而异的坑）、云擎Ai供应链/云擎生活/云擎云仓/吖嘟咪（同一商家四店批量横评：新店商智接口态、切店端口串店、京准通分日 obys、ps1 无 BOM 静默失效）、稳赚计划机制专项探索（五店 69 SPU：cap 决定因子与门槛公式、rt=80 资格推荐池、日内刷新与模型侧重算归因、补单证据纪律）十次全链路实战（含 szweb 新版签名破解、京准通三种响应 shape、账户余额断投核查、行业大盘/品牌榜/热词榜、Excel 十表、JoySpace 发布链、cxjzt 采销协同对投后台只读核验）。发现新端点、新坑、更好的分析角度，先在任务里验证通过，再更新本仓库（GitHub 公开仓库，欢迎 PR/Issue）。
