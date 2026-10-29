# -*- coding: utf-8 -*-
"""Query the EasyBI 京喜 metric dataset (1025136) from the page session.

The native `webcli easybi native` command only supports whole-department
queries grouped by shop. This script reuses the page's login session and posts
the same query body with explicit shop/field filters, any group-by dimension
(spu_id, sku_id, price star, first-on-shelf date...) and complete paging.
Read-only; cookies stay in the browser.

Examples:
  # shop-level summary (same as v1)
  python -X utf8 scripts/easybi_shop_query.py \
    --shops 204560127,13490204 --department 17603 \
    --start 2026-10-01 --end 2026-10-22 \
    --metrics 18902197,18900607,20833907,21988164 \
    --session easybi13560 --out work/easybi-shops.json

  # SPU-level top list (paged, complete)
  python -X utf8 scripts/easybi_shop_query.py \
    --shops 13490204 --department 17603 \
    --start 2026-10-01 --end 2026-10-22 \
    --metrics 18902197,15804345 --group-by spu_id \
    --session easybi13560 --out work/easybi-spus.json

  # price-star distribution of sold SKUs
  python -X utf8 scripts/easybi_shop_query.py \
    --shops 13490204 --department 17603 \
    --start 2026-10-01 --end 2026-10-22 \
    --metrics 15804348 --group-by jdr_sch_sku_price_star_d \
    --session easybi13560 --out work/easybi-stars.json
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
PAGE_SIZE = 1000


def decode(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8", errors="replace")


def run_node(main_js, args, timeout=180):
    proc = subprocess.run(["node", main_js, *args], capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"webcli failed ({proc.returncode}): {decode(proc.stderr)[:800]}")
    return decode(proc.stdout)


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


def pick(fields, *, code=None, mid=None, sort=None, kind=None):
    matches = [x for x in fields
               if (code is None or x.get("code") == code)
               and (mid is None or x.get("id") == mid)
               and (sort is None or x.get("sort") == sort)
               and (kind is None or x.get("type") == kind)]
    if len(matches) != 1:
        raise RuntimeError(f"field code={code} id={mid} matched {len(matches)} entries")
    return matches[0]


def parse_extra_filters(fields, spec):
    """spec: {"dim_code": ["v1", "v2"], ...} -> in-filters."""
    out = []
    for code, values in (spec or {}).items():
        item = pick(fields, code=code, sort="dim")
        key = item.get("baseCode") or item["code"]
        out.append({**item, "key": key, "field": key, "op": "in",
                    "values": [str(v) for v in values], "feature": "common"})
    return out


def build_page(meta, options, page_num):
    fields = meta["fields"]

    def filt(code, op, values):
        item = pick(fields, code=code, sort="dim")
        key = item.get("baseCode") or item["code"]
        return {**item, "key": key, "field": key, "op": op, "values": values, "feature": "common"}

    children = [
        filt("dt", ">=", [options.start]),
        filt("dt", "<=", [options.end]),
        filt("saler_dept_id_2", "in", [options.department]),
        filt("jdr_jx_sku_jx_sale_mode_type", "in", ["c"]),
    ]
    if options.shops:
        children.append(filt("shop", "in", options.shops))
    children.extend(parse_extra_filters(fields, options.extra_filters))

    dims = []
    for code in options.group_by:
        item = pick(fields, code=code, sort="dim")
        dims.append({**item, "key": item["code"],
                     "field": item.get("baseCode") or item["code"], "aggConf": {}})
    measures = []
    for mid in options.metric_ids:
        item = pick(fields, mid=mid, sort="metric", kind="original")
        measures.append({**item, "key": item["code"],
                         "field": item.get("baseCode") or item["code"],
                         "dataSetId": meta["datasetId"], "aggType": "AUTO"})
    return {
        "requestId": str(uuid.uuid4()),
        "dataSet": {
            "id": meta["datasetId"],
            "type": "metric_dataset",
            "option": {
                "dimGroupCode": options.dim_group,
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
            "pageInfo": {"pageSize": PAGE_SIZE, "pageNum": page_num, "isPage": True},
            "calculation": {},
        },
        "resultParam": {"dimensionList": dims, "measureList": measures},
        "queryType": "NORMAL",
        "refresh": False,
        "cacheConfig": {},
    }


def eval_js(main_js, session, js):
    out = run_node(main_js, ["browser", session, "eval", js], timeout=180)
    outer = json.loads(out)
    if not isinstance(outer.get("body"), str):
        raise RuntimeError("unexpected eval output")
    inner = json.loads(outer["body"])
    if str(inner.get("header", {}).get("code")) != "0":
        raise RuntimeError(f"EasyBI error: {inner.get('header')}")
    body = inner.get("body") or {}
    rows = body.get("data") or []
    total = body.get("total")
    if not isinstance(total, int) or not isinstance(rows, list):
        raise RuntimeError("incomplete result shape")
    return total, rows


def query_all(main_js, session, meta, options):
    def encode_js(request):
        raw = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
        b64 = base64.b64encode(raw.encode("utf-8")).decode("ascii")
        return (
            "(async()=>{const body=JSON.parse(new TextDecoder().decode("
            "Uint8Array.from(atob('%s'),c=>c.charCodeAt(0))));"
            "const r=await fetch('https://easybi.jd.com/api/data-hub/data/query',"
            "{method:'POST',headers:{'Content-Type':'application/json'},"
            "body:JSON.stringify(body),credentials:'include'});"
            "const t=await r.text();return {status:r.status,body:t.slice(0,200000)};})()" % b64
        )

    collected, seen = [], set()
    total = None
    for page in range(1, options.max_pages + 1):
        request = build_page(meta, options, page)
        page_total, rows = eval_js(main_js, session, encode_js(request))
        if total is None:
            total = page_total
        if page_total != total:
            raise RuntimeError(f"total drifted between pages: {total} -> {page_total}")
        keys = [d["key"] for d in request["resultParam"]["dimensionList"]]
        for row in rows:
            identity = tuple(str(row.get(k)) for k in keys)
            if identity in seen:
                raise RuntimeError(f"duplicate group row: {identity}")
            seen.add(identity)
            collected.append(row)
        if len(collected) >= total:
            return total, collected
        if not rows:
            raise RuntimeError("empty page before total reached")
    raise RuntimeError(f"max pages ({options.max_pages}) reached: {len(collected)}/{total}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shops", default="", help="comma separated shop ids (optional with --filter)")
    ap.add_argument("--department", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--metrics", required=True)
    ap.add_argument("--group-by", default="shop", help="1-2 dim codes, comma separated")
    ap.add_argument("--filter", default="", help='JSON {"dim_code":["v"]}, in-filters')
    ap.add_argument("--dataset", default="1025136")
    ap.add_argument("--dimension-group", default=DEFAULT_DIM_GROUP)
    ap.add_argument("--session", default="easybi13560")
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", default="")
    ap.add_argument("--webcli-main", default=DEFAULT_WEBclI)
    ap.add_argument("--max-pages", type=int, default=20)
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    shops = [x.strip() for x in args.shops.split(",") if x.strip()]
    metric_ids = [int(x) for x in args.metrics.split(",") if x.strip()]
    group_by = [x.strip() for x in args.group_by.split(",") if x.strip()]
    extra_filters = json.loads(args.filter) if args.filter else {}
    if not metric_ids:
        raise SystemExit("metrics are required")
    if not (shops or extra_filters):
        raise SystemExit("either --shops or --filter is required")
    if not (1 <= len(group_by) <= 2):
        raise SystemExit("--group-by takes 1 or 2 dim codes")

    if not args.no_open:
        run_node(args.webcli_main, ["browser", args.session, "--window", "background",
                                    "open", DATASOURCE_URL], timeout=120)

    meta = load_meta(args.webcli_main, args.dataset, args.meta)
    if meta.get("datasetId") != int(args.dataset):
        raise SystemExit(f"metadata dataset mismatch: {meta.get('datasetId')}")
    if meta.get("businessScene") != "metric_dataset":
        raise SystemExit(f"dataset {args.dataset} is not a metric_dataset")

    options = argparse.Namespace(
        shops=shops, department=args.department, start=args.start, end=args.end,
        metric_ids=metric_ids, group_by=group_by, extra_filters=extra_filters,
        dim_group=args.dimension_group, max_pages=args.max_pages,
    )
    total, rows = query_all(args.webcli_main, args.session, meta, options)

    names = {m["id"]: m["name"] for m in meta["fields"] if m.get("sort") == "metric"}
    result = {
        "dataset": int(args.dataset),
        "datasetName": meta.get("name"),
        "period": [args.start, args.end],
        "department": args.department,
        "shops": shops,
        "groupBy": group_by,
        "extraFilters": extra_filters,
        "metrics": {str(mid): names.get(mid, "") for mid in metric_ids},
        "total": total,
        "rows": rows,
    }
    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=1)
    print(f"ok dataset={args.dataset} groups={total} -> {args.out}")
    for row in rows[:20]:
        label = " | ".join(f"{k}={row.get(k)}" for k in
                           ([g for g in group_by] or ["shop"]))
        values = " ".join(f"{names.get(m, m)}={row.get(next(
            (f['code'] for f in meta['fields'] if f.get('id') == m), ''))}"
            for m in metric_ids)
        print(f"  {label} {values}")
    if total > 20:
        print(f"  ... and {total - 20} more rows in {args.out}")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
