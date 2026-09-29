// 京麦实时订单列表探测：打开订单页并截获页面自己的 queryOrderPage 等接口响应
// 用途：当日实时成交（商智/京准通报表是 T+1 或点击归因口径，不能当实时证据）
// 前提：店铺 profile 浏览器已登录京麦（shop.jd.com），CDP 端口可连
// usage: node probe-orders.js <port> <outdir> [orderUrl]
// 解析：找 *orderListBffService_queryOrderPage*.json，结构 {url,status,body:{body(base64 flag),base64Encoded}}
//       -> json.loads(body['body'])['data'] 含 totalItem/pageSize/results（默认 50 条/页，最新在前）
//       -> results[].orderCreateTime/paymentConfirmTime/orderCompleteTime(毫秒时间戳)、orderItems[].skuId/jdPrice/num、orderStatusInfo.orderStatusName
const fs = require('fs');
const path = require('path');
const { Cdp } = require(path.join('C:/Users/caotong.888/.joycode/skills/jd-store-diagnosis/scripts', 'cdp-lib.js'));

const PORT = process.argv[2];
const OUT = process.argv[3];
const URL = process.argv[4] || 'https://shop.jd.com/jdm/trade/orders/order-list?tabType=allOrders';
if (!PORT || !OUT) { console.error('usage: node _probe_orders.js <port> <outdir> [orderUrl]'); process.exit(1); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await Cdp.connect('http://127.0.0.1:' + PORT);
  const tid = await cdp.createTab('about:blank', false, true);
  const sid = await cdp.attach(tid);
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Network.enable', { maxResourceBufferSize: 50000000, maxTotalBufferSize: 100000000 }, sid);

  const seen = new Map();
  let seq = 0;
  cdp.on('Network.responseReceived|' + sid, async (p) => {
    const url = p.response.url || '';
    const rt = (p.type || '');
    if (!/api|order|trade/i.test(url) || !/XHR|Fetch/i.test(rt)) return;
    if (seen.has(p.requestId)) return;
    seen.set(p.requestId, url);
    try {
      const body = await cdp.send('Network.getResponseBody', { requestId: p.requestId }, sid, 20000);
      seq += 1;
      const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(-120);
      fs.writeFileSync(path.join(OUT, `${String(seq).padStart(3, '0')}-${safe}.json`),
        JSON.stringify({ url, status: p.response.status, body }, null, 1), 'utf8');
      console.log('captured', seq, p.response.status, url.slice(0, 120));
    } catch (e) { /* body not available yet */ }
  });

  await cdp.navigate(sid, URL);
  await cdp.waitReady(sid, 12000, 120000);
  // 给前端渲染和懒加载留时间
  await new Promise(r => setTimeout(r, 8000));
  const text = await cdp.pageText(sid);
  fs.writeFileSync(path.join(OUT, 'page-text.txt'), text, 'utf8');
  console.log('page text length', text.length);
  console.log(text.slice(0, 1500));
  await cdp.closeTarget(tid);
  cdp.close();
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
