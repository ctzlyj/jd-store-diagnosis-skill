"""Regression guard for ROI guidance: avoid treating suggested ROI as click bids."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUIDE = (ROOT / "references" / "surewin-mechanism.md").read_text(encoding="utf-8")
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")


class SureWinGuidanceTest(unittest.TestCase):
    def test_three_distinct_fields_have_distinct_meanings(self):
        self.assertIn("recommendBidList[].price", GUIDE)
        self.assertIn("目标投产比编辑器", GUIDE)
        self.assertIn("topPriceTroi", GUIDE)
        self.assertIn("costThreshold", GUIDE)
        self.assertIn("refundLimitPrice", GUIDE)
        self.assertIn("业务含义未核实", GUIDE)
        self.assertIn("建议档、参与上限与每轮消耗门槛", SKILL)

    def test_no_prescriptive_claim_from_unknown_field(self):
        self.assertNotIn("赔付出价上限/每轮门槛", SKILL)
        self.assertNotIn("出价不超 refundLimitPrice", GUIDE)
        self.assertNotIn("目标投产比设上限值顶格拿赔付", GUIDE)

    def test_skill_contains_no_shop_specific_identifier(self):
        self.assertNotIn("100361", GUIDE)
        self.assertNotIn("云擎", GUIDE)


if __name__ == "__main__":
    unittest.main()