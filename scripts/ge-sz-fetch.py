# -*- coding: utf-8 -*-
"""GE shop insight + proxied legacy SZ collector, v2.

Mode B collector for jd-store-diagnosis: used when the merchant has NO Jingmai
data permission. See references/ge-shop-insight.md for the full endpoint map.

Usage:
  python -X utf8 scripts/ge-sz-fetch.py --shop <shop name> \
      --start 2026-09-01 --end 2026-09-23 \
      --cmp-start 2026-08-01 --cmp-end 2026-08-23 \
      --ad-account <sz ad account id> --out work/<shop>/raw
Acceptance: check=0 in <out>/_fetch-summary.json.

Key calibrations found by probing (2026-09-24):
  * ge.jd.com/sz/api trade/product endpoints accept ONE day only
    ("interval is exceed" otherwise) -> loop per day and aggregate.
  * szpaas core/trend/productTopList/flow-ad need dateType=custom for a range;
    dateType=day silently returns only `date`.
  * szpaas table endpoints (source/keyword/inShopRank) honor start/end with interval=DAY.
"""
import json, sys, argparse, datetime as dt
from pathlib import Path
from playwright.sync_api import sync_playwright

SSO_CACHE = Path.home()/".joyclaw"/"workspace"/"jd-sso-token.json"
GE = "http://ge.back.jd.com/hjy/ge/shopAnalysis"
SHOP_PAGE = "http://ge.jd.com/hjysjmh/gep/system-hjy/shop/shopInsight/shopDetail?version=ge-b-sales-version"
SZ = "http://ge.jd.com/sz/api"
PAAS = "http://szom.back.jd.com/szpaas/szajax"
ALLCH = "\u5168\u90e8\u6e20\u9053"

JS_FETCH = """
async ([url]) => { const r = await fetch(url, {credentials:'include'});
  const t = await r.text();
  try { return {ok:true, status:r.status, json:JSON.parse(t)}; }
  catch(e){ return {ok:false, status:r.status, text:t.slice(0,2000)}; } }
"""

def qs(d):
    from urllib.parse import urlencode
    return urlencode(d)

def sso_token():
    return json.loads(SSO_CACHE.read_text(encoding="utf-8"))["sso.jd.com"]

def ge_common(start, end, dept_ids, search=""):
    return {"deptLevl":"2","deptId2Str":dept_ids,"erpDeptSign":"cateDeptGlb","dateType":"day",
            "date":end,"startDate":start,"endDate":end,"channel":"0","shopType":"-999999",
            "placeChannelLevl":"0","corpTypeCd1":"","firstCategoryId":"","fourthCategoryId":"all",
            "groupType":"corpTypeCd1","type":"1","groupId":"-999999","searchStr":search,"shopStatus":""}

def days(s, e):
    a = dt.date.fromisoformat(s); b = dt.date.fromisoformat(e); out=[]
    while a <= b:
        out.append(a.isoformat()); a += dt.timedelta(days=1)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shop", required=True)
    ap.add_argument("--start", required=True); ap.add_argument("--end", required=True)
    ap.add_argument("--cmp-start", required=True); ap.add_argument("--cmp-end", required=True)
    ap.add_argument("--dept-ids", default="17603,16336")
    ap.add_argument("--ad-account", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--skip-daily", action="store_true")
    a = ap.parse_args()

    out = Path(a.out)
    for sub in ("ge","sz","sz/daily"):
        (out/sub).mkdir(parents=True, exist_ok=True)
    saved = {}

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width":1600,"height":900})
        tok = sso_token()
        ctx.add_cookies([{"name":"sso.jd.com","value":tok,"domain":".jd.com","path":"/"},
                         {"name":"ssa.ticket","value":tok,"domain":".jd.com","path":"/"}])
        page = ctx.new_page()
        page.goto(SHOP_PAGE, wait_until="domcontentloaded", timeout=90000); page.wait_for_timeout(5000)

        def get(u): return page.evaluate(JS_FETCH, [u])

        def save(folder, name, url, quiet=False):
            r = get(url)
            (out/folder/(name+".json")).write_text(
                json.dumps({"url":url,"resp":r}, ensure_ascii=False, indent=1), encoding="utf-8")
            j = r.get("json") or {}
            ok = bool(r.get("ok")) and (str(j.get("status","")) in ("0","200")
                 or str(((j.get("header") or {}).get("code","")) ) == "0")
            saved[folder+"/"+name] = "ok" if ok else "check:%s:%s" % (r.get("status"), str(j.get("message",""))[:40])
            if not quiet:
                print("  [%s/%s] %s" % (folder, name, "OK" if ok else "CHECK"))
            return r

        # ---- 1. GE shop grid ----
        shop_ids = None
        for tag,(s,e) in (("cur",(a.start,a.end)),("cmp",(a.cmp_start,a.cmp_end))):
            base = ge_common(s,e,a.dept_ids,a.shop)
            q = dict(base); q.update({"orderByType":"descend","orderBy":"ShopDealAmt"})
            r = save("ge","grid-ids-"+tag, GE+"/shopDetail/getGridDetailIds?"+qs(q))
            try: ids=[x["ShopId"] for x in r["json"]["body"]["data"]]
            except Exception: ids=[]
            if tag=="cur": shop_ids=ids
            use = ids or shop_ids or []
            if use:
                dq=dict(base); dq.pop("groupId",None); dq.pop("shopStatus",None)
                dq.update({"shopIds":",".join(use),"firstPlaceCdPro":"","secondPlaceCdPro":"","thirdPlaceCdPro":""})
                save("ge","grid-data-"+tag, GE+"/shopDetail/getGridDetailData?"+qs(dq))
        if not shop_ids:
            print("!! shop not found in GE"); b.close(); sys.exit(2)
        shop_id = shop_ids[0]; print("shopId =", shop_id)

        # ---- 2. exchange SZ session ----
        auth = get(GE+"/shopDetail/getAuthorityToSz?shopId="+shop_id)
        page.goto("http://"+auth["json"]["body"]["szUrl"], wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(8000)
        home = page.evaluate("() => document.body.innerText.slice(0,4000)")
        (out/"sz"/"_home.txt").write_text(page.url+"\n\n"+home, encoding="utf-8")
        print("sz session:", page.url)

        save("sz","dim-channel-tree","http://szom.back.jd.com/szajax/sz/dimensionManage/channelDimension/getChannelSourceExplainTreeData.ajax")
        save("sz","advert-account", SZ+"/marketing/advertSummary/getAdvertAccount.ajax")

        def period(tag, s, e):
            rng = {"date":e,"startDate":s,"endDate":e}
            # --- range via dateType=custom ---
            c = dict(rng); c.update({"dateType":"custom","channel":"99","channelName":ALLCH,"compareType":"hb"})
            save("sz","flow-core-"+tag, PAAS+"/flow/summary/core/offline.ajax?"+qs(c))
            t = dict(c); t["type"]="day"
            save("sz","flow-trend-"+tag, PAAS+"/flow/summary/trend/offline.ajax?"+qs(t))
            for lt in ("deal","uv"):
                pt = dict(c); pt.update({"productType":"sku","topListType":lt})
                save("sz","product-top-%s-%s"%(lt,tag), PAAS+"/flow/summary/productTopList/offline.ajax?"+qs(pt))
            fa = dict(rng); fa.update({"dateType":"custom","compareType":"hb","realtime":"false"})
            save("sz","flow-ad-"+tag, PAAS+"/flow/ad/getAdSummaryAndTrend.ajax?"+qs(fa))
            save("sz","flow-ad-highpotential-"+tag, PAAS+"/flow/ad/getHighPotentialCount.ajax?"+qs(fa))
            # --- range via interval=DAY tables ---
            UVF = "jdr_sch_traffic_enter_shop__browse_page_cnt_shop_last_src"
            for lvl in ("1","3"):
                src = dict(rng); src.update({"platformCate1":"","compareType":"hb",
                    "groupType":"lastSrcChannelId"+lvl,"attributes":"lastSrcChannelId"+lvl,
                    "interval":"DAY","dateType":"day","sortField":UVF,"sortType":"desc"})
                save("sz","flow-source-l%s-%s"%(lvl,tag), PAAS+"/shop/source/offlineFlowSource/getTable.ajax?"+qs(src))
            rk = dict(rng); rk.update({"interval":"DAY","dateType":"day","platformCate1":""})
            save("sz","inshop-rank-"+tag, PAAS+"/shop/source/getInShopRank.ajax?"+qs(rk))
            kw = dict(rng); kw.update({"platformCate1":"","groupType":"lastSrcPageSearchKeyword",
                "attributes":"lastSrcPageSearchKeyword","limit":"300","sortField":UVF,
                "sortType":"desc","interval":"DAY","dateType":"day"})
            save("sz","keywords-"+tag, PAAS+"/keyword/analysis/shopOut/getTable.ajax?"+qs(kw))
            # --- ad product line (sz api) ---
            accounts = [x for x in [a.ad_account, "-999999"] if x]
            for acc in accounts:
                ad = dict(rng); ad.update({"dateType":"custom","channel":"99","adAccount":acc,
                    "clickOrOrderDay":"15","clickOrOrderCaliber":"0","isGift":"0",
                    "orderStatusCategory":"","BusinessType":"-999999","compareType":"hb"})
                save("sz","advert-line-%s-%s"%(acc,tag), SZ+"/marketing/advertSummary/getProductLineData.ajax?"+qs(ad))
            # --- per-day (single-day-only endpoints) ---
            if a.skip_daily: return
            dd = days(s,e); print("  daily x%d ..." % len(dd))
            for d in dd:
                one = {"date":d,"startDate":d,"endDate":d}
                save("sz/daily","trade-%s"%d, SZ+"/trade/getSummaryData.ajax?channel=99&cmpType=0&"+qs(one), quiet=True)
                pr = dict(one); pr.update({"type":"0","compareType":"hb","channel":"99",
                    "categoryType":"0","second":"999999","third":""})
                save("sz/daily","product-%s"%d, SZ+"/productDetail/getProductList.ajax?"+qs(pr), quiet=True)

        print("--- cur", a.start, a.end); period("cur", a.start, a.end)
        print("--- cmp", a.cmp_start, a.cmp_end); period("cmp", a.cmp_start, a.cmp_end)
        b.close()

    (out/"_fetch-summary.json").write_text(json.dumps({"shop":a.shop,"shopId":shop_id,
        "cur":[a.start,a.end],"cmp":[a.cmp_start,a.cmp_end],"results":saved},
        ensure_ascii=False, indent=1), encoding="utf-8")
    bad = {k:v for k,v in saved.items() if v!="ok"}
    print("\nDONE ok=%d check=%d" % (len(saved)-len(bad), len(bad)))
    for k,v in list(bad.items())[:20]: print("  ", k, v)

if __name__ == "__main__":
    main()
