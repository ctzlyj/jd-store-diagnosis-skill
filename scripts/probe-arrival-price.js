// probe real-time 普惠到手价 (arrival price) via 京麦 营销价格管理 page's own API
// usage: node probe-arrival-price.js <cdp端口> <输出目录>
// 背景：ROI/出价/点击成本必须按「普惠到手价」定价（禁止用京东价）。到手价随促销变动，投放/调价前实时查询。
// 原理：后台标签打开 shop.jd.com/jdm/mkt/market/market-risk，页面上下文内 fetch
//      dsm.market.tool.common.api.PriceQueryOuterService.queryPriceInfoList（无需 h5st，2026-09-29 实测）。
// 输出：all-skus.json（skuId/wareId/skuName/jdPrice/perfectArrivalPrice/arrivalPrice/minPrice/alias/stockNum）// full-page fetch of queryPriceInfoList for a store; dumps all SKUs' arrival prices
const fs = require('fs'); const path = require('path');
const { Cdp } = require(path.join('C:/Users/caotong.888/.joycode/skills/jd-store-diagnosis/scripts', 'cdp-lib.js'));
const PORT = process.argv[2]; const OUT = process.argv[3];
if (!PORT || !OUT) { console.error('usage: node _probe_price_all.js <port> <outdir>'); process.exit(1); }
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await Cdp.connect('http://127.0.0.1:' + PORT);
  const tid = await cdp.createTab('about:blank', false, true);
  const sid = await cdp.attach(tid);
  await cdp.send('Page.enable', {}, sid);
  await cdp.navigate(sid, 'https://shop.jd.com/jdm/mkt/market/market-risk');
  await cdp.waitReady(sid, 12000, 120000);
  await new Promise(r => setTimeout(r, 6000));
  const all = []; let pageIndex = 1; let total = 1;
  while (all.length < total && pageIndex <= 10) {
    const expr = `(async () => {
      const r = await fetch('https://sff.jd.com/api?v=1.0&appId=MLW9UKKYEOINFLCFOVVL&api=dsm.market.tool.common.api.PriceQueryOuterService.queryPriceInfoList', {
        method: 'POST', credentials: 'include',
        headers: {'content-type': 'application/json;charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', 'x-rp-client': 'h5_2.4.0', 'dsm-platform': 'pc'},
        body: JSON.stringify({clientInfo: {appName: 'pc'}, params: {pageIndex: ${pageIndex}, pageSize: 50, categoryIds: [], spuIds: [], skuIds: [], status: 1}})
      });
      return {status: r.status, text: await r.text()};
    })()`;
    const res = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid, 60000);
    const v = res.result && res.result.value || {};
    if (v.status !== 200) { console.error('page', pageIndex, 'status', v.status, (v.text||'').slice(0,200)); break; }
    const j = JSON.parse(v.text);
    if (j.code !== 200) { console.error('page', pageIndex, 'code', j.code, j.msg); break; }
    total = parseInt(j.data.total, 10) || 0;
    const rows = (j.data.dataList || []).map(x => ({
      skuId: x.skuId, wareId: x.wareId, skuName: x.skuName, jdPrice: x.jdPrice,
      perfectArrivalPrice: x.perfectArrivalPrice, arrivalPrice: x.arrivalPrice,
      unitArrivalPrice: x.unitArrivalPrice, minPrice: x.minPrice, benchPrice: x.benchPrice,
      alias: (x.attrValueAlias || []).map(a => (a||[]).join('/')).join(' | '), stockNum: x.stockNum
    }));
    all.push(...rows);
    console.log('page', pageIndex, 'got', rows.length, 'total', total);
    pageIndex += 1;
    await new Promise(r => setTimeout(r, 800));
  }
  fs.writeFileSync(path.join(OUT, 'all-skus.json'), JSON.stringify(all, null, 1), 'utf8');
  console.log('saved', all.length, 'skus ->', path.join(OUT, 'all-skus.json'));
  await cdp.closeTarget(tid); cdp.close();
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });