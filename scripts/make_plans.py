# -*- coding: utf-8 -*-
"""按店铺参数生成本次诊断的全部采集计划（商智 + 京准通报表 + 京准通行业）。

用法：
  1. 复制 diagnosis-config.example.json 为 diagnosis-config.json，填好参数
  2. python make_plans.py --config diagnosis-config.json --out plans
  3. 得到 plans/plan-sz.json、plan-jzt-report.json、plan-jzt-dims.json、plan-jzt-industry.json

注意：config 含 pin_id（京准通账户号），属于任务本地信息，不要提交到仓库。
"""
import argparse, json, os, sys

SZ = "https://szgateway.jd.com"
JZT = "https://jzt-api.jd.com"

def month_range(c):
    return dict(startDate=c["start_date"], endDate=c["end_date"],
                compareStartDate=c["compare_start"], compareEndDate=c["compare_end"])

def build_sz_plan(c):
    mr = month_range(c)
    base = dict(realtime=False, interval="DAY", dateType="custom", **mr)
    calls = []
    # 交易概览
    calls.append(dict(name="sz-trade-summary", url=SZ + "/api/lowcode/tradeSummary/summary/getSummary.ajax", body=base))
    calls.append(dict(name="sz-trade-trend", url=SZ + "/api/lowcode/tradeSummary/summary/getTrend.ajax", body=base))
    # 首页核心指标
    calls.append(dict(name="sz-index-summary", url=SZ + "/api/lowcode/indexSummary/summary.ajax", body=base))
    calls.append(dict(name="sz-index-trend", url=SZ + "/api/lowcode/indexSummary/trend.ajax", body=base))
    # 商品 TOP（SPU/SKU）
    for pro, name in (("spu", "sz-producttop-spu"), ("sku", "sz-producttop-sku")):
        calls.append(dict(name=name, url=SZ + "/api/lowcode/indexSummary/productTop.ajax",
                          body=dict(base, proType=pro)))
    # 商品明细表
    calls.append(dict(name="sz-product-table",
        url=SZ + "/api/lowcode/productDetail/table/productTable.ajax",
        body=dict(base, proType="spu", channel="all", onlyAttention=False, indicators=[
            "jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot",
            "jdr_sch_trade_deal_ord_sku_qtty_sz_trade_deal_snapshot",
            "fo_jdr_sch_industry_deal_rate",
            "jdr_sch_traffic_brow_sku__page_qtty_traffic_plat_item_di_sz_bsg",
            "jdr_sch_traffic_brow_sku__page_cnt_traffic_plat_item_di_sz_bsg"])))
    # 流量核心 + 流量来源（APP 渠道，末次归因）
    calls.append(dict(name="sz-flow-core", url=SZ + "/api/lowcode/flowSummary/getCoreSummary.ajax",
                      body=dict(base, channel="all", peerSwitch=True)))
    src_ind = ["jdr_sch_traffic_brow_sku_cnt_jd_unified_attribution_sz",
               "jdr_sch_traffic_brow_sku_cnt_jd_unified_attribution_sz##compare",
               "jdr_sch_traffic_brow_sku_cnt_jd_unified_attribution_sz##compareValue",
               "jdr_sch_traffic_brow_sku_cnt_jd_unified_attribution_sz/jdr_sch_traffic_brow_sku__page_cnt_traffic_plat_item_di_sz_bsg##customProportion",
               "jdr_sch_traffic_brow_sku_qtty_jd_unified_attribution_sz",
               "jdr_sch_traffic_brow_sku_qtty_jd_unified_attribution_sz##compare",
               "fo_jdr_sch_traffic_uv_value_jd_unified_attribution_sz",
               "fo_jdr_sch_traffic_uv_value_jd_unified_attribution_sz##compare",
               "jdr_sch_traffic_intr_ord_ord_cnt_jd_unified_attribution_trade_deal_snapshot_sz",
               "jdr_sch_traffic_intr_ord_ord_cnt_jd_unified_attribution_trade_deal_snapshot_sz##compare",
               "jdr_sch_traffic_intr_ord_ord_amt_jd_unified_attribution_trade_deal_snapshot_sz",
               "jdr_sch_traffic_intr_ord_ord_amt_jd_unified_attribution_trade_deal_snapshot_sz##compare",
               "fo_jdr_sch_fo_jdr_sch_traffic_intr_ord_cvr_deal_sz",
               "fo_jdr_sch_fo_jdr_sch_traffic_intr_ord_cvr_deal_sz##compare"]
    calls.append(dict(name="sz-flow-source", url=SZ + "/api/lowcode/flowSource/sourceTable/table.ajax",
                      body=dict(base, channel="app", spuIds=[], indicators=src_ind)))
    # 搜索词（月度，曝光降序 TOP500）
    sm, cm = c["start_date"][:7], c["compare_start"][:7]
    calls.append(dict(name="sz-search-kw",
        url=SZ + "/api/squidajax/paasf/v1/searchKeywordAnalysis/offlineKeywordRank/table.ajax",
        body=dict(filters={
            "originalStartDate": {"value": sm, "operator": "eq"},
            "originalEndDate": {"value": sm, "operator": "eq"},
            "comparisonStartDate": {"value": cm, "operator": "eq"},
            "comparisonEndDate": {"value": cm, "operator": "eq"},
            "statisticsType": {"value": "defined", "operator": "eq"},
            "dateType": {"value": "month", "operator": "eq"},
            "validStartDay": {"value": "2025-08-22", "operator": "eq"},
            "validEndDay": {"value": c["end_date"], "operator": "eq"},
            "searchScene": {"value": 1, "operator": "eq"},
            "keywordType": {"value": [-1, 1, 3, 5, 7, 9, 11, 13, 15], "operator": "in"}},
            metrics=["uv", "skuExpoNum", "expoUv", "clickPv", "clickUv", "dealOrdAmt",
                     "subOrderNumCj", "dealOrdSkuNum", "dealOrdUv", "ctr", "cvrCj", "pctCj"],
            outputDimensions=["keyword"],
            orderBy=[{"desc": True, "name": "skuExpoNum"}], pageNum=1, pageSize=500)))
    # 行业大盘（cid2 传店铺主营二级类目）
    ind_base = dict(base, saleOrdCate2=c["cid2"], popBusiness="pop", channel="all")
    calls.append(dict(name="sz-industry-summary", url=SZ + "/api/lowcode/industrySummary/core/summaryv2.ajax",
        body=dict(ind_base, indicators=[
            "jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot",
            "jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot##compare",
            "jdr_sch_trade_deal_ord_ord_qtty_sz_trade_deal_snapshot",
            "jdr_sch_trade_deal_ord_ord_qtty_sz_trade_deal_snapshot##compare",
            "jdr_sch_traffic_brow_sku__page_cnt_traffic_plat_item_di_sz_bsg",
            "jdr_sch_traffic_brow_sku__page_cnt_traffic_plat_item_di_sz_bsg##compare",
            "jdr_sch_traffic_brow_sku__page_qtty_traffic_plat_item_di_sz_bsg",
            "jdr_sch_traffic_brow_sku__page_qtty_traffic_plat_item_di_sz_bsg##compare"])))
    calls.append(dict(name="sz-industry-subrank", url=SZ + "/api/lowcode/industrySummary/rank/subIndv2.ajax",
        body=dict(ind_base, indicators=[
            "jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot##compare",
            "jdr_sch_trade_deal_ord_ord_amt_sz_trade_deal_snapshot##proportion"],
            groups=["saleOrdCate3"])))
    # 广告概况（新快车口径）
    calls.append(dict(name="sz-advert-summary",
        url=SZ + "/api/lowcode/flowSummary/ad/getAdSummaryAndTrend.ajax", body=base))
    return calls

def jzt_base(c, s=None, e=None, caliber_day=30):
    return dict(isDaily=False, startDay=s or c["start_date"], endDay=e or c["end_date"],
                clickOrOrderCaliber=0, clickOrOrderDay=caliber_day, giftFlag=0,
                orderStatusCategory=1, filters=[], pinIds=[c["pin_id"]],
                columns=["impressions", "clicks", "CTR", "cost", "CPM", "CPC",
                         "directOrderCnt", "directOrderSum", "indirectOrderCnt", "indirectOrderSum",
                         "totalOrderCnt", "totalOrderSum", "directCartCnt", "indirectCartCnt",
                         "totalCartCnt", "totalCartRate", "totalCartCost", "totalOrderCVS",
                         "CPA", "totalOrderROI", "visitorCnt", "dealUserCnt"],
                obys="impressions|desc", page=1, pageSize=200)

def build_jzt_report_plan(c):
    calls = []
    for tag, s, e in (("sep", c["start_date"], c["end_date"]), ("aug", c["compare_start"], c["compare_end"])):
        calls.append(dict(name="jzt-account-%s" % tag, url=JZT + "/reweb/msa/base/account/list",
                          body=dict(jzt_base(c, s, e), obys="cost|desc")))
    # 分日趋势（isDaily=True）
    calls.append(dict(name="jzt-account-daily", url=JZT + "/reweb/msa/base/account/list",
                      body=dict(jzt_base(c), isDaily=True, obys="day|asc", pageSize=100)))
    # 计划明细
    for tag, s, e in (("sep", c["start_date"], c["end_date"]), ("aug", c["compare_start"], c["compare_end"])):
        calls.append(dict(name="jzt-campaign-%s" % tag, url=JZT + "/reweb/msa/base/campaign/list",
                          body=dict(jzt_base(c, s, e), obys="cost|desc", pageSize=200)))
    return calls

def build_jzt_dims_plan(c):
    """京准通报表 8 维度：账户/计划/单元/创意/关键词/商品定向/人群/流量包。"""
    dims = [("account", JZT + "/reweb/msa/base/account/list"),
            ("campaign", JZT + "/reweb/msa/base/campaign/list"),
            ("group", JZT + "/reweb/msa/base/group/list"),
            ("ad", JZT + "/reweb/msa/base/ad/list"),
            ("keyword", JZT + "/reweb/msa/orientation/keyword/list"),
            ("commodity", JZT + "/reweb/msa/orientation/commodity/list"),
            ("crowd", JZT + "/reweb/msa/orientation/crowd/list"),
            ("package", JZT + "/reweb/msa/orientation/package/list")]
    calls = []
    for i, (name, url) in enumerate(dims, 1):
        for tag, s, e in (("sep", c["start_date"], c["end_date"]), ("aug", c["compare_start"], c["compare_end"])):
            calls.append(dict(name="dim%d-%s-%s" % (i, name, tag), url=url,
                              body=dict(jzt_base(c, s, e), obys="cost|desc", pageSize=200)))
    return calls

def build_jzt_industry_plan(c):
    """京准通自定义报表-行业：大盘/关键词榜单/热搜词/品牌/地域 + 流量解析推荐词。
    cid3 用店铺主营三级类目；缺 clickOrOrder 口径参数会 400。"""
    q = "?requestFrom=0&businessFrom=1"
    calls = []
    ind = dict(startDate=c["start_date"], endDate=c["end_date"], cid3=c["cid3"],
               clickOrOrderCaliber=0, clickOrOrderDay=15, giftFlag=0, orderStatusCategory=1)
    ind_aug = dict(ind, startDate=c["compare_start"], endDate=c["compare_end"])
    calls.append(dict(name="ind-whole-sep", url=JZT + "/dataCenter/industry/v2/industry/whole" + q, body=ind))
    calls.append(dict(name="ind-whole-aug", url=JZT + "/dataCenter/industry/v2/industry/whole" + q, body=ind_aug))
    calls.append(dict(name="ind-billboard-sep", url=JZT + "/dataCenter/industry/v2/keyword/billboard" + q,
                      body=dict(ind, pageNum=1, pageSize=50)))
    calls.append(dict(name="ind-hotwords-sep", url=JZT + "/dataCenter/industry/v2/industry/searchWord/hotWords" + q, body=ind))
    calls.append(dict(name="ind-brands-sep", url=JZT + "/dataCenter/industry/v2/industry/brands" + q,
                      body=dict(ind, pageNum=1, pageSize=100)))
    calls.append(dict(name="ind-area-sep", url=JZT + "/dataCenter/industry/v2/industry/user/area" + q, body=ind))
    # 流量解析：店铺 SKU 列表（按成交单数）+ 每个 TOP SKU 的关键词推荐
    calls.append(dict(name="ind-kw-sku", url=JZT + "/dataCenter/industry/v2/keyword/analysis/sku" + q,
                      body=dict(ind, type=0)))
    for i, sku in enumerate(c.get("top_sku_ids") or []):
        calls.append(dict(name="ind-kw-chart-%d" % (i + 1),
                          url=JZT + "/dataCenter/industry/v2/keyword/analysis/chart" + q,
                          body=dict(skuId=sku)))
    return calls

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", default="plans")
    a = ap.parse_args()
    c = json.load(open(a.config, encoding="utf-8"))
    os.makedirs(a.out, exist_ok=True)
    plans = {"plan-sz.json": build_sz_plan(c),
             "plan-jzt-report.json": build_jzt_report_plan(c),
             "plan-jzt-dims.json": build_jzt_dims_plan(c),
             "plan-jzt-industry.json": build_jzt_industry_plan(c)}
    for fn, calls in plans.items():
        p = os.path.join(a.out, fn)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump(calls, f, ensure_ascii=False, indent=1)
        print("%s: %d calls" % (fn, len(calls)))
    print("done ->", a.out)

if __name__ == "__main__":
    main()
