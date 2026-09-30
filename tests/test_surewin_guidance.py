"""Regression guard for sure-win guidance.

Locks in: (1) suggested ROI is never presented as a click bid, (2) the three
different numbers stay distinguishable, (3) whitepaper-sourced rules stay
separated from local inference, (4) no shop/SPU identifier leaks into the repo,
(5) ad spend is split between red-packet (virtual credit) and cash calibers.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUIDE = (ROOT / "references" / "surewin-mechanism.md").read_text(encoding="utf-8")
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
COLDSTART = (ROOT / "references" / "ad-cold-start.md").read_text(encoding="utf-8")


class SureWinGuidanceTest(unittest.TestCase):
    def test_three_distinct_fields_have_distinct_meanings(self):
        self.assertIn("recommendBidList[].price", GUIDE)
        self.assertIn("目标投产比编辑器", GUIDE)
        self.assertIn("topPriceTroi", GUIDE)
        self.assertIn("costThreshold", GUIDE)
        self.assertIn("refundLimitPrice", GUIDE)
        self.assertIn("不是点击出价", SKILL)
        self.assertIn("建议档、参与上限与每轮消耗门槛", SKILL)

    def test_suggested_roi_is_not_called_a_click_bid(self):
        self.assertIn("不是 CPC 点击出价", GUIDE)
        self.assertNotIn("点击出价上限", GUIDE)

    def test_whitepaper_facts_are_sourced_and_separated_from_inference(self):
        self.assertIn("cms/content?contentId=19372", GUIDE)
        self.assertIn("保障金额 = 现金消耗", GUIDE)
        self.assertIn("有效广告费率 = 1 / 目标投产比", GUIDE)
        self.assertIn("28 天为一个投放周期", GUIDE)
        self.assertIn("每 7 天赔付一次", GUIDE)
        self.assertIn("【官方】", GUIDE)
        self.assertIn("【推断】", GUIDE)
        self.assertIn("待验证清单", GUIDE)

    def test_refund_limit_claim_stays_flagged_as_inference(self):
        idx = GUIDE.index("的推断链")
        self.assertIn("【推断】", GUIDE[idx : idx + 1200])
        self.assertNotIn("超过部分不赔", GUIDE)
        self.assertNotIn("已破解", GUIDE)
        # 「顶格」只允许出现在待验证清单的 2026-09-28 用户实测纠正
        # （填到 cap 顶格可正常创建）里；推断链本身不得使用「顶格/已破解」
        # 这类破解式措辞。
        self.assertNotIn("顶格", GUIDE[idx : idx + 1200])

    def test_keyword_mode_is_not_promised_as_available(self):
        self.assertIn("互斥", GUIDE)
        self.assertIn("即将上线", GUIDE)
        self.assertIn("无法自行加词来抬高稳赚 ROI", GUIDE)

    def test_guarantee_is_not_sold_as_risk_free_profit(self):
        self.assertIn("保的是「亏损上限」", GUIDE)
        self.assertIn("站内红包", GUIDE)
        # 2026-09-29 用户红线：指南不得出现「刷单」措辞，一律用「真实成交」表述。
        self.assertNotIn("刷单", GUIDE)
        self.assertIn("真实成交", GUIDE)

    def test_repo_contains_no_shop_specific_identifier(self):
        self.assertNotIn("100361", GUIDE)
        self.assertNotIn("云擎", GUIDE)

    def test_ad_cost_is_split_between_redpacket_and_cash_calibers(self):
        self.assertIn("红包/虚拟金", SKILL)
        self.assertIn("「是否亏钱」结论均按红包/现金分别表述", SKILL)
        self.assertIn("红包低效", COLDSTART)
        self.assertIn("现金亏损", COLDSTART)


if __name__ == "__main__":
    unittest.main()
