"""Regression guard for the delivery gate.

Locks in the two failures that matter most: a missing second shopId in the
data-notes section, and a deliverable that otherwise passes. Run with:
  python -X utf8 -m unittest tests.test_validate_report
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "validate_report.py"


def make_md(with_second_id=True, full=False):
    filler = "这是一段用于满足最小长度的正文。" * 80
    notes_id = "\n- **店铺信息**：测试店，店铺ID：123456789。" if with_second_id else ""
    base = f"""# 测试店 · 2026年10月经营诊断报告

**店铺ID：123456789**

老板您好：

{filler}

## 一、一句话结论

本期成交增长。

## 二、行动清单

### A. 立即做

| # | 动作 |
| --- | --- |
| A1 | 备货 |

### B. 本周做

| # | 动作 |
| --- | --- |
| B1 | 调价 |

### C. 本月做

| # | 动作 |
| --- | --- |
| C1 | 复盘 |

## 三、核心经营数据

| 指标 | 本期 |
| --- | ---: |
| 成交金额 | 100 |

## 四、数据说明

- **数据来源**：测试。
- **期间**：2026-10-01—10-22。
- **口径**：有效成交。
{notes_id}
"""

    if full:
        return base + """
## 五、铺货节奏与货盘结构

上架节奏、品类结构、价格带。

## 六、货端质量

信息分、价格星级、好评率、售后率。

## 七、行业对照

与同行对比。

## 八、数据缺口

流量来源数据不足。
"""
    return base


def make_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = "1-核心指标"
    ws["A1"] = "店铺ID"
    ws["B1"] = "123456789"
    ws["A3"] = "成交金额"
    ws["A4"] = "访客"
    ws["A5"] = "客单价"
    ws2 = wb.create_sheet("2-明细")
    ws2["A1"] = "测试店"
    ws3 = wb.create_sheet("3-数据说明")
    ws3["A1"] = "测试店"
    wb.save(path)


class ValidateReportTest(unittest.TestCase):
    def run_gate(self, md_text, extra_args=()):
        with tempfile.TemporaryDirectory() as tmp:
            md = Path(tmp) / "report.md"
            xlsx = Path(tmp) / "data.xlsx"
            md.write_text(md_text, encoding="utf-8")
            make_xlsx(xlsx)
            proc = subprocess.run(
                [sys.executable, "-X", "utf8", str(SCRIPT), *extra_args,
                 "--md", str(md), "--xlsx", str(xlsx),
                 "--shop-id", "123456789", "--shop-name", "测试店"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            return proc.returncode, proc.stdout

    def test_complete_report_passes(self):
        code, out = self.run_gate(make_md(with_second_id=True))
        self.assertEqual(code, 0, out)
        self.assertIn("结构自检全部通过", out)

    def test_missing_second_shop_id_fails(self):
        code, out = self.run_gate(make_md(with_second_id=False))
        self.assertEqual(code, 1, out)
        self.assertIn("店铺ID 至少出现两次", out)

    def test_full_report_passes_full_gate(self):
        code, out = self.run_gate(make_md(with_second_id=True, full=True), ("--full",))
        self.assertEqual(code, 0, out)
        self.assertIn("结构自检全部通过", out)

    def test_base_report_fails_full_gate(self):
        code, out = self.run_gate(make_md(with_second_id=True, full=False), ("--full",))
        self.assertEqual(code, 1, out)
        self.assertIn("full·", out)


if __name__ == "__main__":
    unittest.main()
