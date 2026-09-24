# jd-store-diagnosis · 京麦店铺经营/广告数据诊断 Skill

一个 JoyCode/Codex Skill：给京东 POP 店铺做月度经营+广告全链路诊断，输出结论先行、行动导向、可直接发给商家老板的 JoySpace 报告 + Excel 数据表。

## 它能做什么

给定目标店铺（京麦快捷方式 / 店铺名 / 广告账号）+ 诊断月份，自动完成：

1. **商智取数**（jdsz.jd.com）：交易、流量、商品、行业大盘、搜索词、广告概况
2. **京准通取数**（jzt.jd.com）：账户/计划/单元/创意/关键词/商品定向/人群/流量包 **全部 8 个报表维度**，加行业大盘、关键词榜单（含参考出价）、流量解析推荐词
3. **无京麦权限店铺（模式 B）**：走内部黄金眼 ge.jd.com 店铺看板 → `getAuthorityToSz` 换代理版旧商智会话取数（headless，不碰工作浏览器）
4. **诊断分析**：环比 + 同行对比 + 归因，每个异常落到「能动手的杠杆」
5. **报告产出**：结论先行、行动清单前置（A 立即 / B 本周 / C 本月），老板 3 分钟能消化，零 AI 痕迹
6. **发布验证**：JoySpace 文档 + Excel 附件，读回验证 + 零 AI 评论

## 核心特性

- **不抢占工作界面**：专用店铺浏览器 profile + 后台标签 + 焦点守卫，诊断期间你可以正常用电脑
- **凭证不落盘**：登录态留在店铺浏览器里，采集脚本只在内存中捕获请求头，Cookie/Token 不进任何文件
- **每一步可回溯**：config、采集计划、原始响应都留在任务 work/ 目录，报告中每个数字都能回查
- **接口级采集**：不模拟点击翻页，直接重放页面接口（商智 Worker 请求、京准通行业接口都有解决方案），快且稳
- **报告措辞自由发挥**：只约束结果要求（零 AI 痕迹、结论先行、数字可回查），不套固定模板和替换表，不同 agent 可以有自己的写法

## 安装

```powershell
# JoyCode / Codex 本地安装（skill-installer 方式）
git clone https://github.com/ctzlyj/jd-store-diagnosis-skill.git
# 将仓库放到 $CODEX_HOME/skills/jd-store-diagnosis（即本仓库根目录含 SKILL.md）
```

## 使用

对 JoyCode 说：

> 用 jd-store-diagnosis 诊断这家店铺的九月情况："D:\...\京麦-某某店.lnk"

或更简单：

> 帮我给「某某旗舰店」做一次经营诊断，出一份能直接发老板的 JoySpace 报告

前提：商家已开通京麦数据权限时，本机需要该店铺的专用 Chrome profile（首次使用引导登录一次，之后复用）；未开通权限的店铺自动转模式 B，只需本机已有内网 SSO 登录态。

## 仓库结构

```
├── SKILL.md                      # Skill 入口：完整六步流程
├── scripts/
│   ├── make_plans.py             # 按店铺参数生成全部采集计划
│   ├── diagnosis-config.example.json  # 配置模板
│   ├── restart-shop-browser.ps1  # 专用浏览器启动（CDP 9224）
│   ├── zguard.ps1 / zguard-loop.ps1   # 焦点守卫（不抢用户界面）
│   ├── sz-fetch.js               # 商智 XHR 重放采集（模式 A）
│   ├── ge-sz-fetch.py            # 黄金眼 + 代理旧商智采集（模式 B，headless）
│   ├── jzt-run.js                # 京准通 XHR 重放采集
│   ├── close-stale-tabs.ps1      # 标签清理
│   └── cdp-lib.js / guard.js      # CDP 底层库
└── references/
    ├── api-reference.md          # 模式 A 已验证端点 + 载荷 + 坑
    ├── ge-shop-insight.md        # 模式 B 链路/端点/三类区间口径/口径差异
    └── ad-cold-start.md          # 广告冷启策略（广告部门口径）
```

## 迭代

源自 2026-09 淡雅装饰画甄选店、墨派风画舍、京韵丹青装饰画店、冬月、全球锦宏优选五次全链路诊断实战（均实际交付商家）：

- 商智 szweb 新版每请求签名自动计算、京准通三种响应 shape、账户余额断投核查
- 模式 B（黄金眼 + 代理旧商智）与其三类区间口径差异
- 广告冷启四象限与投放优先级（全店/全站托管统一走快车体系）
- JoySpace 发布链与已交付报告的修改姿势

发现新端点、新坑、更好的分析角度，欢迎提 Issue/PR——先在真实任务里验证通过，再合入。

## 免责

仅用于账号权限内的数据取数与分析；不绕过登录或权限，不采集凭证，不做自动化写入操作。报告口径以平台当日展示为准。
