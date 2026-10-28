# -*- coding: utf-8 -*-
"""Query EasyBI 京喜 metric dataset for specific shops.

The native `webcli easybi native` command cannot include a shop filter, so this
script reuses the page's login session and posts the same query body with
`shop in [...]`. Read-only; cookies stay in the browser.

Example:
  python -X utf8 scripts/easybi_shop_query.py \
    --shops 204560127,13490204 --department 17603 \
    --start 2026-10-01 --end 2026-10-22 \
    --metrics 18902197,19832758,18900607,20833907,21988164 \
    --session easybi13560 --out work/easybi-shops.json
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import uuid

DATASOURCE_URL = "https://easybi.jd.com/beta/#/datasource/13560?tab=27"
DEFAULT_WEBclI = r"D:\CodexTools\npm-global\node_modules\@jd\webcli\dist\src\main.js"
DEFAULT_DIM_GROUP = "7a43b98aa558f13279c5add3c0367bc3"


def decode(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8", errors="replace")


def run_node(main_js, args, timeout=180):
    proc = subprocess.run(
        ["node", main_js, *args],
        capture_output=True,
        timeout=timeout,
    )
    out = decode(proc.stdout)
    err = decode(proc.stderr)
    if proc.returncode != 0:
        raise RuntimeError(f"webcli failed ({proc.returncode}): {err.strip()[:800]}")
    return out


def load_meta(main_js, dataset, cache_path):
    if cache_path and os.path.exists(cache_path):
        raw = open(cache_path, "rb").read()
        return json.loads(decode(raw))
    text = run_node(main_js, ["easybi", "native", "--operation", "metadata",
                              "--dataset", str(dataset), "-f", "json"])
    data = json.loads(text)
    if not data.get("ok"):
        raise RuntimeError(f"metadata failed: {data}")
    if cache_path:
        os.makedirs(os.path.dirname(os.path.abspath(cache_path)), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
    return data


def field(fields, code):
    matches = [x for x in fields if x.get("code") == code and x.get("sort") == "dim"]
    if len(matches) != 1:
        raise RuntimeError(f"dimension {code} matched {len(matches)} fields")
    return matches[0]


def metric(fields, mid):
    matches = [x for x in fields if x.get("id") == mid
               and x.get("sort") == "metric" and x.get("type") == "original"]
    if len(matches) != 1:
        raise RuntimeError(f"metric {mid} matched {len(matches)} fields")
    return matches[0]


def build_request(meta, shops, department, start, end, metric_ids, dim_group):
    fields = meta["fields"]

    def filt(code, op, values):
        item = field(fields, code)
        key = item.get("baseCode") or item["code"]
        return {**item, "key": key, "field": key, "op": op, "values": values, "feature": "common"}

    children = [
        filt("dt", ">=", [start]),
        filt("dt", "<=", [end]),
        filt("saler_dept_id_2", "in", [department]),
        filt("jdr_jx_sku_jx_sale_mode_type", "in", ["c"]),
        filt("shop", "in", shops),
    ]
    shop = field(fields, "shop")
    dims = [{**shop, "key": "shop", "field": shop.get("baseCode") or "shop", "aggConf": {}}]
    measures = []
    for mid in metric_ids:
        item = metric(fields, mid)
        measures.append({
            **item,
            "key": item["code"],
            "field": item.get("baseCode") or item["code"],
            "dataSetId": meta["datasetId"],
            "aggType": "AUTO",
        })
    return {
        "requestId": str(uuid.uuid4()),
        "dataSet": {
            "id": meta["datasetId"],
            "type": "metric_dataset",
            "option": {
                "dimGroupCode": dim_group,
                "resAppKey": meta.get("resAppKey") or f"analysis_{meta['datasetId']}",
                "authVersion": "v3",
                "measureType": "offline",
                "interval": "day",
            },
        },
        "queryParam": {
            "groupList": dims,
            "sortList": [],
            "filter": {"op": "AND", "children": children},
            "pageInfo": {"pageSize": max(10, len(shops) + 5), "pageNum": 1, "isPage": True},
            "calculation": {},
        },
        "resultParam": {"dimensionList": dims, "measureList": measures},
        "queryType": "NORMAL",
        "refresh": False,
        "cacheConfig": {},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shops", required=True, help="comma separated shop ids")
    ap.add_argument("--department", required=True, help="saler_dept_id_2")
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--metrics", required=True, help="comma separated original metric ids")
    ap.add_argument("--dataset", default="1025136")
    ap.add_argument("--dimension-group", default=DEFAULT_DIM_GROUP)
    ap.add_argument("--session", default="easybi13560")
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", default="")
    ap.add_argument("--webcli-main", default=DEFAULT_WEBclI)
    ap.add_argument("--no-open", action="store_true", help="skip opening the datasource tab")
    args = ap.parse_args()

    shops = [x.strip() for x in args.shops.split(",") if x.strip()]
    metric_ids = [int(x.strip()) for x in args.metrics.split(",") if x.strip()]
    if not shops or not metric_ids:
        raise SystemExit("shops and metrics are required")

    if not args.no_open:
        run_node(args.webcli_main, ["browser", args.session, "--window", "background",
                                    "open", DATASOURCE_URL], timeout=120)

    meta = load_meta(args.webcli_main, args.dataset, args.meta)
    if meta.get("datasetId") != int(args.dataset):
        raise SystemExit(f"metadata dataset mismatch: {meta.get('datasetId')}")

    request = build_request(meta, shops, args.department, args.start, args.end,
                            metric_ids, args.dimension_group)
    raw = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    encoded = base64.b64encode(raw.encode("utf-8")).decode("ascii")
    js = (
        "(async()=>{const body=JSON.parse(new TextDecoder().decode("
        "Uint8Array.from(atob('%s'),c=>c.charCodeAt(0))));"
        "const r=await fetch('https://easybi.jd.com/api/data-hub/data/query',"
        "{method:'POST',headers:{'Content-Type':'application/json'},"
        "body:JSON.stringify(body),credentials:'include'});"
        "const t=await r.text();return {status:r.status,body:t.slice(0,200000)};})()" % encoded
    )
    out = run_node(args.webcli_main, ["browser", args.session, "eval", js], timeout=180)
    outer = json.loads(out)
    inner = json.loads(outer["body"])
    if str(inner.get("header", {}).get("code")) != "0":
        raise SystemExit(f"EasyBI error: {inner.get('header')}")
    body = inner.get("body") or {}
    rows = body.get("data") or []
    total = body.get("total")
    if total != len(rows):
        raise SystemExit(f"incomplete result: total={total} rows={len(rows)}")

    names = {m["id"]: m["name"] for m in meta["fields"] if m.get("sort") == "metric"}
    result = {
        "dataset": int(args.dataset),
        "datasetName": meta.get("name"),
        "period": [args.start, args.end],
        "department": args.department,
        "shops": shops,
        "metrics": {str(mid): names.get(mid, "") for mid in metric_ids},
        "rows": rows,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)

    print(f"ok dataset={args.dataset} rows={len(rows)} -> {args.out}")
    for row in rows:
        print(f"  {row.get('shop$value')} ({row.get('shop')})")
        for mid in metric_ids:
            code = next((m["code"] for m in meta["fields"]
                         if m.get("id") == mid and m.get("sort") == "metric"), None)
            if code and code in row:
                print(f"    {names.get(mid, mid)}: {row[code]}")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
