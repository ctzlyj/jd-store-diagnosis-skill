# 京东商智 + 京准通 采集接口参考

全部端点均在 2026-09 淡雅装饰画甄选店诊断中实盘验证。采集方式：专用 Chrome profile（CDP 9224）后台标签内 XHR 重放，凭证走浏览器登录态，请求头仅内存捕获、不落盘。

## 一、京东商智（jdsz.jd.com / szgateway.jd.com）

### 通用要求

- **网关**：`https://szgateway.jd.com`
- **关键请求头**：`User-mnp`、`User-mup`、`uuid`、`X-Requested-With`——由 sz-fetch.js 先导航商智首页时从真实请求中捕获（内存持有），自己写采集器时不能省
- **响应结构**：`{"header": {"code": 0, ...}, "body": {"data": ..., "size": ...}}`；code=0 成功，size=0 多为无权限或参数错误
- **月度口径基础体**（所有 lowcode 端点共用）：

```json
{"realtime": false, "interval": "DAY", "dateType": "custom",
 "startDate": "...", "endDate": "...",
 "compareStartDate": "...", "compareEndDate": "...",
 "compareType": "hb"}
```

### 核心端点

| 用途 | 端点 | 关键差异参数 |
| --- | --- | --- |
| 交易概览汇总 | POST /api/lowcode/tradeSummary/summary/getSummary.ajax | 基础体 |
| 交易分日趋势 | POST /api/lowcode/tradeSummary/summary/getTrend.ajax | 基础体 |
| 首页核心指标 | POST /api/lowcode/indexSummary/summary.ajax | 基础体 |
| 首页趋势 | POST /api/lowcode/indexSummary/trend.ajax | 基础体 |
| 商品 TOP | POST /api/lowcode/indexSummary/productTop.ajax | 基础体 + `proType: "spu"/"sku"` |
| 商品明细表 | POST /api/lowcode/productDetail/table/productTable.ajax | `proType/indicators/onlyAttention` |
| 流量核心 | POST /api/lowcode/flowSummary/getCoreSummary.ajax | `channel: "all", peerSwitch: true`（同行对比） |
| 流量来源表 | POST /api/lowcode/flowSource/sourceTable/table.ajax | `channel: "app"`（末次归因）+ indicators 列表 |
| 搜索词榜 | POST /api/squidajax/paasf/v1/searchKeywordAnalysis/offlineKeywordRank/table.ajax | filters 结构完全不同，见下 |
| 行业大盘 | POST /api/lowcode/industrySummary/core/summaryv2.ajax | `saleOrdCate2/popBusiness: "pop"` |
| 行业子类目 | POST /api/lowcode/industrySummary/rank/subIndv2.ajax | `groups: ["saleOrdCate3"]` |
| 广告概况 | POST /api/lowcode/flowSummary/ad/getAdSummaryAndTrend.ajax | 基础体（新快车口径） |
| 店铺层级 | POST /api/lowcode/indexSummary/shopLevel.ajax | 基础体 |

### 搜索词榜特殊 filters 结构

```json
{"filters": {
  "originalStartDate": {"value": "2026-09", "operator": "eq"},
  "originalEndDate":   {"value": "2026-09", "operator": "eq"},
  "comparisonStartDate": {"value": "2026-08", "operator": "eq"},
  "comparisonEndDate":   {"value": "2026-08", "operator": "eq"},
  "statisticsType": {"value": "defined", "operator": "eq"},
  "dateType": {"value": "month", "operator": "eq"},
  "validStartDay": {"value": "2025-08-22", "operator": "eq"},
  "validEndDay":   {"value": "<endDate>", "operator": "eq"},
  "searchScene":  {"value": 1, "operator": "eq"},
  "keywordType":  {"value": [-1,1,3,5,7,9,11,13,15], "operator": "in"}},
 "metrics": ["uv","skuExpoNum","expoUv","clickPv","clickUv","dealOrdAmt",
             "subOrderNumCj","dealOrdSkuNum","dealOrdUv","ctr","cvrCj","pctCj"],
 "outputDimensions": ["keyword"],
 "orderBy": [{"desc": true, "name": "skuExpoNum"}],
 "pageNum": 1, "pageSize": 500}
```

注意：搜索词的日期是 `2026-09` 月格式，不是 `2026-09-01` 日格式。

### 流量来源 indicators（核心字段名）

访客/浏览/占比/UV价值/成交/转化率各有本体、`##compare`（环比值）、`##compareValue`（环比结果）三件套；占比为复合指标拼 `##customProportion`。核心：

- 访客：`jdr_sch_traffic_brow_sku_cnt_jd_unified_attribution_sz`
- 浏览：`jdr_sch_traffic_brow_sku__page_cnt_traffic_plat_item_di_sz_bsg`
- UV价值：`fo_jdr_sch_traffic_uv_value_jd_unified_attribution_sz`
- 成交客户：`jdr_sch_traffic_intr_ord_ord_cnt_jd_unified_attribution_trade_deal_snapshot_sz`
- 成交金额：`jdr_sch_traffic_intr_ord_ord_amt_jd_unified_attribution_trade_deal_snapshot_sz`
- 转化率：`fo_jdr_sch_fo_jdr_sch_traffic_intr_ord_cvr_deal_sz`

完整 42 项列表见 scripts/make_plans.py 的 `src_ind`。

## 二、京准通（jzt.jd.com / jzt-api.jd.com）

### 通用要求

- **响应结构**：`{"code": 1, "data": ...}`；code=1 成功
- **坑**：账户报表数据在 `data.datas`，行业接口数据在 `data.rows`——用统一读 `datas` 的脚本重放行业接口时，日志会显示 rows=0 但实际成功，以 code 为准

### 账户报表（reweb/msa）——基础体

```json
{"isDaily": false, "startDay": "...", "endDay": "...",
 "clickOrOrderCaliber": 0, "clickOrOrderDay": 30, "giftFlag": 0,
 "orderStatusCategory": 1, "filters": [], "pinIds": [<账户号>],
 "columns": ["impressions","clicks","CTR","cost","CPM","CPC",
             "directOrderCnt","directOrderSum","indirectOrderCnt","indirectOrderSum",
             "totalOrderCnt","totalOrderSum","directCartCnt","indirectCartCnt",
             "totalCartCnt","totalCartRate","totalCartCost","totalOrderCVS",
             "CPA","totalOrderROI","visitorCnt","dealUserCnt"],
 "obys": "cost|desc", "page": 1, "pageSize": 200}
```

| 维度 | 端点 |
| --- | --- |
| 账户 | POST https://jzt-api.jd.com/reweb/msa/base/account/list |
| 计划 | POST https://jzt-api.jd.com/reweb/msa/base/campaign/list |
| 单元 | POST https://jzt-api.jd.com/reweb/msa/base/group/list |
| 创意 | POST https://jzt-api.jd.com/reweb/msa/base/ad/list |
| 关键词 | POST https://jzt-api.jd.com/reweb/msa/orientation/keyword/list |
| 商品定向 | POST https://jzt-api.jd.com/reweb/msa/orientation/commodity/list |
| 人群 | POST https://jzt-api.jd.com/reweb/msa/orientation/crowd/list |
| 流量包 | POST https://jzt-api.jd.com/reweb/msa/orientation/package/list |

页面入口：`https://jzt.jd.com/report/index.html#/rtb/basic`。8 维度×（当月+对比月）共 16 次调用；全智能托管账户的单元/创意/关键词/商品定向/人群/流量包 6 个维度返回 0 行，这是真实状态不是采集失败。

### 行业接口（dataCenter/industry/v2）——自定义报表

URL 统一追加 `?requestFrom=0&businessFrom=1`。**基础体缺一不可，缺跟单口径参数直接 400**：

```json
{"startDate": "...", "endDate": "...", "cid3": [35381],
 "clickOrOrderCaliber": 0, "clickOrOrderDay": 15, "giftFlag": 0,
 "orderStatusCategory": 1}
```

| 用途 | 端点 | 附加参数 |
| --- | --- | --- |
| 行业分日趋势（展现/点击/CTR/CVR/加购） | POST /dataCenter/industry/v2/industry/whole | 基础体 |
| 关键词榜单 TOP50（含 kwImpressionBid 参考出价） | POST /dataCenter/industry/v2/keyword/billboard | `pageNum/pageSize` |
| 热搜词榜（搜索指数+竞争度） | POST /dataCenter/industry/v2/industry/searchWord/hotWords | 基础体 |
| 品牌榜（selfBrandFlag=1 是自己） | POST /dataCenter/industry/v2/industry/brands | `pageNum/pageSize` |
| 地域分析（展现/CTR/CVR/排名） | POST /dataCenter/industry/v2/industry/user/area | 基础体 |
| 店铺 SKU 词推荐列表（按成交单数） | POST /dataCenter/industry/v2/keyword/analysis/sku | 基础体 + `type: 0` |
| 单 SKU 关键词推荐（两组：type 4 / 64） | POST /dataCenter/industry/v2/keyword/analysis/chart | 只需 `{"skuId": ...}` |

页面入口：`https://jzt.jd.com/custom-report/#/industry/market`。页面请求走 Web Worker（blob），Network.requestWillBeSent 页面层抓不到，必须用 XHR 重放。

### 行业数据字段

- whole：`impressionExponent/clickExponent/ctr/cvs/totalCartCntExp/cartCVS`（均为字符串，cvs/ctr 是百分数字符串如 "1.40"）
- billboard：`keyWord/impressionExponent/ctr/cvs/kwImpressionBid`（kwImpressionBid 参考出价，单位元）
- hotWords：`keyWordRank/keyWord/searchExponent/kwCompetitiveness/hotWordCmpRate`（竞争度越低越好抢）
- brands：`no/name/ctr/cvs/selfBrandFlag`
- user/area：`mappedAreaName/impressionsExPercentage/ctr/cvs/orderPercentage`
- chart：`name/type/value`，type 4 与 64 是平台两组推荐，页面标签映射未完全确认，报告表述为「平台推荐两组」

## 三、口径对照（报告第九部分必写）

| 口径 | 说明 |
| --- | --- |
| 商智「广告概况」 | 新快车口径 |
| 京准通账户报表 | 广告点击 30 天内累计成交 |
| 京准通首页今日快照 | 广告点击 15 天内累计成交，仅当日观察 |
| 行业接口 | clickOrOrderDay=15 |

金额单位元；环比 = 与对比期同日数对比（如 9.1–9.21 vs 8.1–8.21）。
