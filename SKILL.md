---
name: jd-store-diagnosis
description: 京东POP店铺月度经营+广告全链路数据诊断。给定目标店铺（京麦店铺浏览器快捷方式、店铺名或广告账号），通过后台接口采集京东商智（jdsz.jd.com：交易/流量/商品/行业/搜索词）与京准通（jzt.jd.com：账户报表8维度/计划/分日/行业大盘/关键词榜单/流量解析）数据，输出结论先行、行动导向、可直接发给商家老板的JoySpace诊断报告+Excel数据表。当用户提到店铺诊断、经营诊断、广告诊断、京准通诊断、商智取数、店铺月度分析、诊断报告、帮商家看数据、店铺报告时使用。全程不抢占用户工作界面。
---

# 京麦店铺经营/广告数据诊断

给目标店铺做一次完整诊断，交付一份商家老板能直接看懂的 JoySpace 报告 + Excel 明细。

## 输入与前提

- 用户提供：店铺京麦快捷方式（.lnk）、店铺名、或广告账户号之一；诊断月份
- 前提：本机已有该店铺的专用 Chrome profile（已登录商智/京准通）。没有则先创建 profile 并引导用户登录一次（说明：只需一次，后续复用）
- 权限范围：只在当前账号权限内取数，不绕过登录或权限

## 硬约束（每次都必须遵守）

1. **绝不抢占用户工作界面**：所有页面操作用后台标签（createTab 第三参 background=true），标签用完关闭；启动 zguard 循环守卫把店铺浏览器窗口压到底层；绝不切换/导航用户正在用的浏览器
2. **凭证不落盘**：Cookie/Token 不进源码、日志、报告、截图、Git；请求头在内存中捕获使用（sz-fetch.js 已如此实现）
3. **报告零 AI 痕迹**：按 references/humanize-rules.md 的人工口吻写，交付前自查
4. **可回溯**：config、计划、原始数据留在任务 work/ 目录，报告中的每个数字都能回查

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

产出 4 个计划：plan-sz.json（商智 13 项）、plan-jzt-report.json（账户/计划/分日）、plan-jzt-dims.json（报表 8 维度×9/8月）、plan-jzt-industry.json（行业大盘/榜单/推荐词）。

### 3. 采集商智（sz-fetch.js）

商智页面请求走 Web Worker，Network 层抓不到请求体；用 XHR 重放：先导航到商智首页，从页面请求捕获 User-mnp/User-mup/uuid 等头（仅内存），再逐条重放计划。

```powershell
node scripts/sz-fetch.js --plan work/plans/plan-sz.json --out work/sz --page https://jdsz.jd.com/szweb/view/index/home.html
```

校验：gateway `header.code == 0`。响应在 `body.data`；size=0 表示无权限或参数错，对照 references/api-reference.md 修。

### 4. 采集京准通（jzt-run.js）

```powershell
node scripts/jzt-run.js --plan work/plans/plan-jzt-report.json --out work/jzt --nav https://jzt.jd.com/report/index.html#/rtb/basic
node scripts/jzt-run.js --plan work/plans/plan-jzt-dims.json --out work/jzt-dims --nav https://jzt.jd.com/report/index.html#/rtb/basic
node scripts/jzt-run.js --plan work/plans/plan-jzt-industry.json --out work/jzt-ind --nav https://jzt.jd.com/custom-report/#/industry/market
```

校验：`code == 1` 即成功。注意脚本日志的 rows=0 有误导：行业接口数据在 `data.rows` 而脚本读 `data.datas`，先看 code 再解析 body 确认。

### 5. 分析（固定框架）

按 references/report-template.md 的九部分结构组织，核心动作：

- 算环比 + 同行同级对比，每个异常归因到「能动手的杠杆」
- 计划处置四类：加投（ROI≥2 且花费≥100）/ 保持微调 / 降价收缩（ROI<1 且花费≥300）/ 关停（零订单且花费≥20）
- 报表 8 维度 0 行 = 全智能托管黑盒 → 必给「开手动快车」行动项；词单 = 商智搜索词高转化词 × 京准通行业榜单/推荐词，出价用行业参考价上下浮 10%
- 行业对照双口径：商智（成交）+ 京准通（广告），分两小节

### 6. 产出报告并发布

- 结构严格按 references/report-template.md：一结论（含三条核心）→ 二行动清单（A立即/B本周/C本月，放最前，老板没耐心看长文）→ 三核心数据 → 四广告 → 五商品 → 六行业 → 七流量来源与搜索词 → 八风险 → 九数据说明
- 分层压缩：正文只留结论/动作/判断/小表证据，大表（分日全量、16 项全指标、TOP30+）放 Excel 并注明去向
- Excel 同步生成：Sheet 与正文章节对应，命名「N-主题」
- 口吻按 references/humanize-rules.md：人工措辞、老板您好开场、随时找我收尾
- 发布 JoySpace（用 joyspace-access Skill 或等价 CLI）：整篇替换正文 → 插入 Excel 附件（必须 --no-summary，避免 AI 评论）→ 读回验证内容命中 + 评论数=0 → 给用户链接

## 常见坑

- PowerShell 写 JSON 计划必须无 BOM：用 `[IO.File]::WriteAllText` 配 `UTF8Encoding($false)`；make_plans.py 已处理
- 商智/京准通口径不同（新快车 vs 广告点击 30 天累计），报告第九部分必须写口径说明
- 行业接口缺 `clickOrOrderCaliber/clickOrOrderDay/giftFlag/orderStatusCategory` 会 400「跟单口径缺失」
- 京准通 cid3 与商智 cid2 不是同一 ID 体系，分别从各自页面查
- 首页「今日快照」是 15 天口径，与月报 30 天口径不可比，只作观察

## 迭代

本 Skill 源自 2026-09 淡雅装饰画甄选店全链路诊断实践。发现新端点、新坑、更好的分析角度，先在任务里验证通过，再更新本仓库（GitHub 公开仓库，欢迎 PR/Issue）。
