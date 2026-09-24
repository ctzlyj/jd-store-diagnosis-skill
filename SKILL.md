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

- **模式 A（默认）**：商家已开通京麦后台数据权限 → 本文六步流程，商智 jdsz.jd.com + 京准通 jzt.jd.com，细节见 `references/api-reference.md`
- **模式 B**：商家**没有**京麦后台数据权限（拿不到店铺专用 profile、进不了 jdsz/jzt），但内部黄金眼 ge.jd.com 能查到这家店 → 按 `references/ge-shop-insight.md` 走「黄金眼店铺看板 → getAuthorityToSz 换代理旧商智」链路，用 `scripts/ge-sz-fetch.py` 采集（headless，不碰用户浏览器、不用 9224）。模式 B 下京准通计划/单元/关键词明细拿不到，广告只能给到商智口径的产品线与广告汇总，报告里必须坦诚写清看不到什么、为什么
- 两种模式的硬约束、分析要求（第 5 步）、报告与发布要求（第 6 步）完全一致，只是数据源不同；模式 B 不走第 1–4 步（无需店铺浏览器 / zguard）

## 硬约束（每次都必须遵守）

1. **绝不抢占用户工作界面**：所有页面操作用后台标签（createTab 第三参 background=true），标签用完关闭；启动 zguard 循环守卫把店铺浏览器窗口压到底层；绝不切换/导航用户正在用的浏览器
2. **凭证不落盘**：Cookie/Token 不进源码、日志、报告、截图、Git；请求头在内存中生成/捕获使用（sz-fetch.js 已如此实现）
3. **报告零 AI 痕迹**：报告是运营顾问一对一写给商家老板的汇报，要让老板觉得是人认真写的、很重视他。核心要求：结论先行、行动清单紧跟结论放前面（老板没耐心看长文）、每个结论和动作挂数字依据、看不到的数据坦诚说明、不过度承诺；交付前自查一遍有没有 AI 腔，JoySpace 发布后评论数必须为 0。措辞、结构、口吻由你自由发挥，不套模板
4. **可回溯**：config、计划、原始数据留在任务 work/ 目录，报告中的每个数字都能回查
5. **投放产品线红线**：行动建议不推荐京准通「全站推广」产品线（即 fullMarketingScenarioTypeName = 「商品-全店商品推广」的托管计划）；全店/全站类托管统一要求走快车体系——快车-全店 优先积累访客、快车全站智能扩量。诊断中发现店铺存在京准通全站推广类计划（如「全店推广计划」）时，处置方向是收缩/迁移到快车，不是加该计划的预算或目标 ROI

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

### 5. 分析（结论导向）

怎么组织、怎么措辞由你自由发挥，但产出必须满足：

- **结论先行 + 行动清单紧跟其后**：老板 3 分钟内能消化「发生了什么、要做什么」；动作按 A 立即（24小时内）/ B 本周 / C 本月编号，具体到可执行（给计划编号、给词、给出价、给金额），禁止「建议优化」这类空话；每条动作在后面明细里有数字依据可查
- 每个结论有数字证据（环比/对比期/同行/行业），归因到「能动手的杠杆」
- 计划处置四类：加投（ROI≥2 且花费≥100）/ 保持微调 / 降价收缩（ROI<1 且花费≥300）/ 关停（零订单且花费≥20）
- 报表 8 维度 0 行 = 全智能托管黑盒 → 必给「开手动快车」行动项；词单 = 商智搜索词高转化词 × 京准通行业榜单/推荐词，出价用行业参考价上下浮 10%
- 冷启阶段店铺（新店或全店访客 <300）的广告行动项按 `references/ad-cold-start.md` 执行：快车-全店 优先走「积累访客 → 全站智能扩量 → 稳赚计划」优先级、访客<300 不强行加量、按 CTR×CVR 四象限处置；判断前先确认店铺所处阶段，不套成熟店加量逻辑
- 行业对照双口径：商智（成交）+ 京准通（广告），分两小节
- 商智/京准通广告数据交叉核对（如全店推广计划花费两边应一致；ROI 差异是归因窗口不同，要在数据说明里解释）
- 异常数据（单日异常、断投日、高基数失真）坦诚说明，不假装没看见

### 6. 产出报告并发布

- 骨架参考（可按店铺实际情况增删调整）：结论（含三条核心）→ 行动清单 → 核心经营数据 → 广告诊断 → 商品诊断 → 行业对照 → 流量与搜索词 → 风险提示 → 数据说明
- **分层压缩**：正文只留结论/动作/判断/小表证据，大表（分日全量、全指标、TOP30+）放 Excel 并注明去向；商家会逐行看的表（计划明细、商品 TOP）不压缩
- **Excel 用 openpyxl 生成**：Sheet 与正文章节对应，命名「N-主题」；数字格式按指标类型设置（金额/计数/百分比分开），区间统一用「—」不用「~」（JoySpace 会把单个 ~ 渲染成删除线）
- **发布链（joyspace-access Skill）**：create 新文档（`--no-ai-mark`）→ `replace_doc.py <pageId> <md>` 整篇替换（自动备份+读回验证）→ `edit_body.py <pageId> insert-attachment --near "<结尾句>" --file <xlsx> --no-summary`（必须 `--no-summary`，否则生成 AI 摘要评论=失败）→ 读回验证内容命中 + 评论数 0 → 给用户链接
- Windows 上若 `D:/Miniconda3/python.exe` 不存在，joyspace_cli.py 会找不到提取器：先 `$env:JOYSPACE_PYTHON=(Get-Command python).Source` 再跑

## 常见坑

- PowerShell 写 JSON 计划必须无 BOM：用 `[IO.File]::WriteAllText` 配 `UTF8Encoding($false)`；make_plans.py 已处理
- PowerShell 下 python 内联脚本读中文路径会 GBK 乱码报错（路径变 `??`）：改用相对路径，或设 `PYTHONUTF8=1`
- 商智/京准通口径不同（新快车 vs 广告点击 30 天累计），报告数据说明必须写口径说明
- 行业接口缺 `clickOrOrderCaliber/clickOrOrderDay/giftFlag/orderStatusCategory` 会 400「跟单口径缺失」
- 京准通 cid3 与商智 cid2 不是同一 ID 体系，分别从各自页面查
- 首页「今日快照」是 15 天口径，与月报 30 天口径不可比，只作观察
- zguard 循环约 30 分钟有效期，长任务中途过期就重启一次
- **已发布报告要修改时，不要拿 JoySpace `read`/`export` 导出的 md 回灌**：导出会把 Slate 表格变成 HTML，`replace_doc.py` 回灌后表格就废了。正确做法：改本地原始 md 源稿 → 整篇 `replace_doc.py` 重新覆盖 → 因为整篇替换会干掉文末附件块，最后重新 `edit_body.py insert-attachment --no-summary` 补回 Excel；另外 `replace_doc.py` 不改外部显示标题，必要时用 `rename` 恢复
- **PowerShell 下 `replace_doc.py` / `edit_body.py` 退出码 1 是假阳性**（stderr 有输出就被当失败）：别看 exit code，看输出里的 `[ok]`、`verified: true`、`summaryCommentId: null` 和读回字符数判定成败

## 迭代

本 Skill 源自 2026-09 淡雅装饰画甄选店、墨派风画舍、京韵丹青装饰画店、冬月、全球锦宏优选（首例模式 B：无京麦权限，黄金眼 + 代理旧商智）五次全链路实战（含 szweb 新版签名破解、京准通三种响应 shape、账户余额断投核查、行业大盘/品牌榜/热词榜、Excel 十表、JoySpace 发布链）。发现新端点、新坑、更好的分析角度，先在任务里验证通过，再更新本仓库（GitHub 公开仓库，欢迎 PR/Issue）。
