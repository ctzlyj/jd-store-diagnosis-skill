/**
 * 稳赚计划全店 SPU 参数采集（须 9224 店档浏览器已登录京准通）
 * 用法: node surewin-probe.js <输出目录> [主SPU的skuIds,逗号分隔]
 * 输出: <目录>/surewin-skulist.json, surewin-multispu.json
 */
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join(__dirname, 'cdp-lib.js'));

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node surewin-probe.js <outdir> [mainSkuIds]'); process.exit(1); }
const MAIN_SKU_IDS = process.argv[3] ? process.argv[3].split(',').map(Number) : [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await Cdp.connect('http://127.0.0.1:9224');
  const tid = await cdp.createTab('https://jzt.jd.com/sureWin/#/landingPage', false, true);
  const sid = await cdp.attach(tid);
  await cdp.send('Page.enable', {}, sid);
  await cdp.waitReady(sid, 10000, 90000);
  await new Promise(r => setTimeout(r, 6000));

  const result = await cdp.evalRaw(sid, `(async () => {
    const H = { 'Content-Type': 'application/json', 'loginMode': '0', 'siteId': '0', 'language': 'zh_CN' };
    const post = (url, body) => fetch(url, {
      method: 'POST', credentials: 'include', headers: H, body: JSON.stringify(body)
    }).then(r => r.text()).catch(e => 'ERR:' + e.message);
    const out = {};
    out.skulist = await post('https://atoms-api.jd.com/goodsInsight/sku/list?requestFrom=0', {
      requestType: 1, sureWinFlag: 0, onlysureWinProduct: 0, activityType: '',
      businessType: 600000013, campaignType: 153, jointActivityId: '',
      page: 1, pageSize: 100, recommendSkuType: '', requestFrom: 0, sxuType: 1
    });
    const listJ = JSON.parse(out.skulist);
    const items = listJ?.data?.productInsightSkuList?.data || [];
    const spus = items.map(x => String(x.spuId)).filter(Boolean);
    const mainSkuIds = ${JSON.stringify(MAIN_SKU_IDS)};
    const first = spus[0];
    const firstSkus = (items.find(x => String(x.spuId) === String(first))?.skuIdList) || [];
    const sugJ = JSON.parse(await post('https://atoms-api.jd.com/dspad/bidding/suggest?requestFrom=0', {
      businessType: 600000013, campaignType: 153, biddingTarget: 16, automatedBiddingType: 8192,
      suggestRouter: 2, location: 'jztwzHomePageBanner', requestFrom: 0,
      swaBiddingQueryList: spus.map(s => ({ adGroupId: null, sxuType: 1, sxuId: s, skuIds: null, sureWinFlag: 1 }))
    }));
    out.suggest = JSON.stringify(sugJ);
    out.threshold = await post('https://atoms-api.jd.com/dspad/sure/win/spu/cost/threshold?requestFrom=0', {
      spuIdList: spus, bidSuggestTraceId: (sugJ?.ext?.traceId || ''), campaignType: 153
    });
    out.budget = await post('https://atoms-api.jd.com/dspad/common/suggest/campaign/budget?requestFrom=0', {
      businessType: 600000013, location: 'jztwzHomePageBanner', requestType: 1, requestFrom: 0,
      campaignBudgetSuggestList: [{ campaignId: null, campaignType: 153, sxuType: 1, uId: first,
        sxuInfo: [{ sxuId: first, skuInfos: (mainSkuIds.length ? mainSkuIds : firstSkus).map(k => ({ skuId: k })) }],
        speedUpSetting: null }]
    });
    out.activityInfo = await post('https://atoms-api.jd.com/dspad/sure/win/activity/info?requestFrom=0', { businessSource: 73 });
    out.traceId = sugJ?.ext?.traceId || '';
    out.spuCount = spus.length;
    return JSON.stringify(out);
  })()`, 120000);

  const parsed = JSON.parse(String(result));
  fs.writeFileSync(path.join(OUT, 'surewin-skulist.json'), String(parsed.skulist), 'utf8');
  fs.writeFileSync(path.join(OUT, 'surewin-multispu.json'), JSON.stringify({
    threshold: parsed.threshold, suggest: parsed.suggest, budget: parsed.budget,
    activityInfo: parsed.activityInfo, traceId: parsed.traceId
  }, null, 1), 'utf8');
  console.log('spus:', parsed.spuCount, 'traceId:', parsed.traceId);
  console.log('threshold:', String(parsed.threshold).slice(0, 600));
  console.log('saved to', OUT);
  await cdp.closeTarget(tid);
  cdp.close();
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
