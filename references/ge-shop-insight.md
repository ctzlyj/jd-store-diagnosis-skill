# 模式 B：无京麦权限店铺 —— 黄金眼(ge.jd.com) + 代理版旧商智

适用场景：商家**没有开通京麦后台数据查询权限**（拿不到店铺专用 Chrome profile、进不了 jdsz/jzt 后台），
但店铺在我方招商/运营口径内、内部黄金眼（ge.jd.com）能查到。此时改走本文件链路取数，
其余分析、报告、发布要求与模式 A 完全一致（硬约束不变）。

模式 A（有京麦权限，走 jdsz.jd.com + jzt.jd.com）见 SKILL.md 正文与 `api-reference.md`，本文件不覆盖它。

## 1. 认证（不碰用户浏览器）

- 复用本机 SSO 缓存里的 `sso.jd.com` 值，同时把同一值写进 `ssa.ticket`，domain 一律 `.jd.com`、path `/`
- playwright **headless** chromium 新建 context 注入上述 cookie；所有取数都在页面上下文里
  `fetch(url, {credentials:'include'})` 发出（内部网关认 cookie，不认裸 HTTP 客户端）
- **不要再尝试读取 Chrome 本地 cookie**：Windows 上是 app-bound 加密，读不出来，白费时间
- **CDP 9224 是用户自己的店铺浏览器，模式 B 全程不要连它、不要开可见窗口**
- 凭证只在内存和本机既有 SSO 缓存文件里，不进 work/、不进日志、不进报告、不进 Git

## 2. 会话链路（三步，顺序不能换）

1. **落地黄金眼店铺明细页**
   `GET http://ge.jd.com/hjysjmh/gep/system-hjy/shop/shopInsight/shopDetail?version=ge-b-sales-version`
   （goto + 等待 ~5s，建立 ge 域会话）
2. **按店铺名查 shopId**
   `GET http://ge.back.jd.com/hjy/ge/shopAnalysis/shopDetail/getGridDetailIds?<公共参数>`
   → `body.data[].ShopId`；再用 `shopIds=` 拉 `getGridDetailData` 取店铺画像（等级/行业排名/开店日期/商家名）
   公共参数必须带全：
   `deptLevl=2&deptId2Str=17603,16336&erpDeptSign=cateDeptGlb&dateType=day&date=<end>&startDate=<start>&endDate=<end>`
   `&channel=0&shopType=-999999&placeChannelLevl=0&groupType=corpTypeCd1&type=1&groupId=-999999&searchStr=<店铺名>`
   （`getGridDetailData` 要去掉 `groupId`/`shopStatus`，加 `firstPlaceCdPro`/`secondPlaceCdPro`/`thirdPlaceCdPro` 空值）
3. **换取商智会话**
   `GET http://ge.back.jd.com/hjy/ge/shopAnalysis/shopDetail/getAuthorityToSz?shopId=<shopId>`
   → 取 `body.szUrl`，`goto("http://" + szUrl)` 并等待 ~8s。落地到
   `ge.jd.com/szweb/sz/view/index/home.html` 即表示**当前会话已绑定该店铺**，之后所有商智接口都返回这家店的数据。
   换店铺必须重新走第 3 步。

## 3. 数据端点（两个网关）

- `SZ  = http://ge.jd.com/sz/api`
- `PAAS = http://szom.back.jd.com/szpaas/szajax`
- 维度映射：`http://szom.back.jd.com/szajax/sz/dimensionManage/channelDimension/getChannelSourceExplainTreeData.ajax`

| 用途 | 端点 | 区间方式 |
| --- | --- | --- |
| 交易汇总 | `SZ /trade/getSummaryData.ajax`（`channel=99&cmpType=0`） | **单日** |
| 商品明细 | `SZ /productDetail/getProductList.ajax`（`type=0&categoryType=0&second=999999`） | **单日** |
| 广告产品线 | `SZ /marketing/advertSummary/getProductLineData.ajax`（`adAccount=<账户>`/`-999999`，`clickOrOrderDay=15&clickOrOrderCaliber=0&isGift=0`） | `dateType=custom` |
| 广告账户列表 | `SZ /marketing/advertSummary/getAdvertAccount.ajax` | — |
| 流量核心指标 | `PAAS /flow/summary/core/offline.ajax`（`channel=99&channelName=全部渠道&compareType=hb`） | `dateType=custom` |
| 流量分日趋势 | `PAAS /flow/summary/trend/offline.ajax`（加 `type=day`） | `dateType=custom` |
| 商品 TOP（成交/UV） | `PAAS /flow/summary/productTopList/offline.ajax`（`productType=sku&topListType=deal|uv`） | `dateType=custom` |
| 广告汇总趋势 | `PAAS /flow/ad/getAdSummaryAndTrend.ajax`（`realtime=false`） | `dateType=custom` |
| 高潜商品数 | `PAAS /flow/ad/getHighPotentialCount.ajax` | `dateType=custom` |
| 店外流量来源 | `PAAS /shop/source/offlineFlowSource/getTable.ajax`（`groupType=attributes=lastSrcChannelId1|3`） | `interval=DAY` + start/end |
| 店内承接排行 | `PAAS /shop/source/getInShopRank.ajax` | `interval=DAY` + start/end |
| 店外搜索词 | `PAAS /keyword/analysis/shopOut/getTable.ajax`（`groupType=attributes=lastSrcPageSearchKeyword&limit=300`） | `interval=DAY` + start/end |

表格类端点排序字段统一用
`jdr_sch_traffic_enter_shop__browse_page_cnt_shop_last_src`（`sortType=desc`）。

## 4. 三类区间口径（本模式最容易踩的坑）

1. **`ge.jd.com/sz/api` 的 trade / productDetail 只支持单日**
   多给一天就返回 `status:-1`、message 含 `interval is exceed`。
   → 必须**逐日循环请求再自行累加**，不要指望它算区间。
2. **`szpaas` 的 core / trend / productTopList / flow-ad 必须 `dateType=custom`**
   用 `dateType=day` 时接口**不报错，静默只返回 `date` 那一天**——这是最危险的一种失败，
   数据看着正常但其实是单日数。凡是这四个端点，检查参数里有没有 `dateType=custom`。
3. **`szpaas` 的 source / keyword / inShopRank 用 `interval=DAY` + `startDate`/`endDate`** 即区间口径。
   来源名取行内的 `lastSrcChannelName1` / `lastSrcChannelName3`（**不是 `id`**）；
   `getInShopRank` 返回的 `id` 需要用 `getChannelSourceExplainTreeData.ajax` 的树做映射才能变成人看得懂的名字。

## 5. 口径差异（必须写进报告的数据说明）

- **黄金眼 `channel=0` 是平台口径**（例：某店 9/1–23 = ¥3,425 / 69 单），
  **代理商智「全部渠道」口径更大**（同店同期 = ¥6,485.59 / 128 成交客）。两者不可混用、不可互相校验对错，
  报告里明确说明用的是哪个口径。
- **商智区间访客是按日累加、非区间去重**，所以区间访客数天然高于真实去重 UV；
  算转化率/UV 价值时前后必须用同一套累加口径，并在数据说明里写清。
- 模式 B 下**京准通计划/单元/关键词明细拿不到**（无京麦权限），广告只能给到商智口径的产品线与广告汇总。
  报告里要坦诚写「这次看不到哪些数据、为什么」，不要用估算冒充明细。

## 6. 采集脚本

```powershell
python -X utf8 scripts/ge-sz-fetch.py --shop <店铺名> `
  --start 2026-09-01 --end 2026-09-23 `
  --cmp-start 2026-08-01 --cmp-end 2026-08-23 `
  --ad-account <商智广告账户号> --out work/<店铺代号>/raw
```

- 自动完成：GE 画像 → 换商智会话 → 本期/对比期两轮全端点 + 逐日循环，落 `work/.../raw/{ge,sz,sz/daily}`，
  并写 `_fetch-summary.json`（每个响应 ok/check 状态）
- `--skip-daily` 只跑区间端点（先验证链路时用）；`--dept-ids` 默认 `17603,16336`，换事业部时改
- 验收：`_fetch-summary.json` 里 `check=0`。实战基线：某 C 店 23 天双期采集 = **122/122 ok**
- 每个报告数字都要能回指到 `work/.../raw/` 下某个 json，写报告时先把事实抽成 facts 清单再动笔

## 7. 来源

2026-09 全球锦宏优选（C 店，无京麦权限）实战标定并交付。后续平台改版以真实探测为准。
