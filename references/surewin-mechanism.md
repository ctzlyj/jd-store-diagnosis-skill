# 京东京准通「稳赚计划」机制与采集接口（2026-09-28 两店 30 SPU 实测）

来源：云擎云仓 / 云擎Ai供应链 两店 atoms-api 登录态实测（`scripts/surewin-probe.js`），30 个 SPU 数据点。凡标注「推断」处为相关性结论，非官方公式。

## 一、机制（服务端/前端已验证）

| 规则 | 值 | 出处 |
|---|---|---|
| 保障周期 | 28 天，每 7 天一轮赔付；未达消耗门槛自动延长本轮 | banner.umd.js + 弹窗 |
| 目标投产比硬上限 | 前端硬校验「投产比需≤topPriceTroi 可参与稳赚」 | banner.umd.js |
| 每轮赔付门槛 | 累计消耗 > costThreshold（SPU 级、服务端算） | /dspad/sure/win/spu/cost/threshold |
| 赔付出价上限 | refundLimitPrice = 出价阶梯顶档，超过部分不赔 | /dspad/bidding/suggest |
| 余额红线 | ≥50；不足 3 次退出，7 天后可再参与 | /dspad/sure/win/activity/popup |
| ROI 口径 | 广告直接+间接+**撬动自然订单**（新「全站营销」口径） | banner.umd.js |
| 新品保障期 | 14 天（newProductSureWinPeriod） | activity/popup |
| 计划类型 | 全站智能推广（campaignType 153，智能出价，无关键词出价环节） | 弹窗文案+创建流 |
| 资格门槛 | 近30天≥5单、≥3好评、价格力≥3星（用户口径） | — |

## 二、ROI 上限 / 门槛由什么决定（实测结论）

1. **与近期转化密度无关**：0 成交 SPU 照样有 2.1–4.0 的 topPriceTroi；同款商品跨店上限完全一致 → 按 **SPU 属性**算，与店铺经营无关。
2. **价格带主导**：指甲刀类内 topPriceTroi 与京东价相关系数 0.87（¥24.8→3.0 … ¥85.8→4.0）；修眉/美妆类整体压到 2.1。costThreshold 与价格相关系数 0.90，普通 SPU ≈1.1–1.5×京东价。
3. **真实成交数据抬「赔付出价上限」而非 ROI 上限**：唯一有 100+ 成交的资格 SPU 出价上限全店最高（2.1），ROI 上限反而全店最低（2.5/2.9 < 同价位无成交款 3.0–3.8）。传导（推断）：出价上限↑ → 可保投产比↓。
4. 资格 SPU 门槛上浮至 ≈2×到手价；有真实成交的 SPU 先核对 `sureWinCampaignCnt`（可能已建计划，勿重复新建）。

## 三、采集接口（atoms-api.jd.com，须店档浏览器登录态 + 三个自定义头）

**必带请求头**（缺一报 `-2011 loginMode is null`）：`loginMode: 0`、`siteId: 0`、`language: zh_CN`，`Content-Type: application/json`，credentials include。

| 用途 | 端点 | 关键请求体 |
|---|---|---|
| 全店 SPU 列表+skuIdList | POST /goodsInsight/sku/list | `{requestType:1, sureWinFlag:0, onlysureWinProduct:0, businessType:600000013, campaignType:153, page:1, pageSize:100, sxuType:1}`；requestType=80 只回稳赚资格品 |
| 每 SPU ROI上限/赔付出价上限/出价阶梯 | POST /dspad/bidding/suggest | `{businessType:600000013, campaignType:153, biddingTarget:16, automatedBiddingType:8192, suggestRouter:2, location:"jztwzHomePageBanner", swaBiddingQueryList:[{sxuType:1, sxuId, skuIds:null, sureWinFlag:1}]}` → `data.swaBiddingSuggestList[]`（topPriceTroi/refundLimitPrice/recommendBidList 三档 1.1/x/x） |
| 每 SPU 每轮消耗门槛 | POST /dspad/sure/win/spu/cost/threshold | `{spuIdList:[...], bidSuggestTraceId:"<同会话 bidding/suggest 的 ext.traceId>", campaignType:153}`。**traceId 必须是本次 suggest 返回的**，用过期 trace 只回资格品甚至空 |
| 日预算建议 | POST /dspad/common/suggest/campaign/budget | `{campaignBudgetSuggestList:[{campaignType:153, sxuType:1, uId:<spu>, sxuInfo:[{sxuId, skuInfos:[{skuId}...]}]}], requestType:1}` → recommendBudget/Min/Max |
| 活动/账户态 | POST /dspad/sure/win/activity/info、/activity/popup | `{businessSource:73}` → balance、sureWinCampaignCnt（是否已建计划）、rechargeAmount、balanceThreshold |

一键采集：`node scripts/surewin-probe.js <输出目录> [主SPU的skuIds逗号表]`（依赖 `scripts/cdp-lib.js`，端口 9224 店档浏览器，先 `restart-shop-browser.ps1` 切对店并核验 profile）。

## 四、投放设计要点（按机制推导）

- 目标投产比设上限值顶格拿赔付；日预算保证每轮(7天)累计消耗 > 门槛（建议门槛/7×1.5 以上）；出价不超 refundLimitPrice。
- 系统建议日预算（155/145 量级）偏进攻，冷启小店可减半保每轮过线。
- 想抬高某 SPU 的 ROI 上限：提高其成交客单价（主推高价变体）+ 维持好评/星级/价格力；快车刷密度不直接抬上限（推断，投放可验证）。
- 稳赚内无关键词出价；关键词走快车并行，只养已验证现金词，标题覆盖成交词供智能计划圈流量。
