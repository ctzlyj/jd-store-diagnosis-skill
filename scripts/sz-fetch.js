const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Cdp } = require('./cdp-lib.js');
const CDP = process.env.SHOP_CDP || 'http://127.0.0.1:9224';
const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PLAN = getArg('--plan');
const OUT = getArg('--out');
const PAGE = getArg('--page', 'https://jdsz.jd.com/szweb/view/index/home.html');

(async () => {
  const cdp = await Cdp.connect(CDP);
  const targetId = await cdp.createTab('about:blank', false, true);   // background: no focus steal
  const sessionId = await cdp.attach(targetId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);


  await cdp.navigate(sessionId, PAGE);
  await cdp.waitReady(sessionId, 12000, 150000);
  // szweb >=20260915 enforces per-request signature:
  // User-mnp = md5(pathname + uuid + mup + secret)
  const SZ_SIGN_SECRET = '372ad2c2b6';
  const signedHeaders = (url) => {
    const p = new URL(url).pathname;
    const uuid = crypto.randomUUID();
    const mup = String(Date.now());
    const mnp = crypto.createHash('md5').update(p + uuid + mup + SZ_SIGN_SECRET).digest('hex');
    return { uuid, 'User-mup': mup, 'User-mnp': mnp, 'X-Requested-With': 'XMLHttpRequest' };
  };
  console.log('signature mode: per-request md5 (szweb 20260915+)');

  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const results = [];
  for (const call of plan) {
    const expr = `(async () => {
      const r = await fetch(${JSON.stringify(call.url)}, {
        method: ${JSON.stringify(call.method || 'POST')},
        credentials: 'include',
        headers: Object.assign({}, ${JSON.stringify(signedHeaders(call.url))}, { 'Content-Type': 'application/json;charset=UTF-8' }),
        body: ${call.body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(call.body))},
      });
      const t = await r.text();
      return { status: r.status, text: t };
    })()`;
    let res;
    try { res = await cdp.evalRaw(sessionId, expr, 120000); } catch (e) { res = { error: e.message }; }
    let parsed = null;
    try { parsed = JSON.parse(res.text); } catch (e) {}
    const code = parsed && parsed.header ? parsed.header.code : (res.error ? 'ERR' : '?');
    const size = parsed && parsed.body && parsed.body.size !== undefined ? parsed.body.size : '';
    console.log('  ', call.name, 'gateway-code=' + code, 'size=' + size, 'len=' + (res.text ? res.text.length : 0));
    results.push({ name: call.name, url: call.url, code, len: res.text ? res.text.length : 0, error: res.error || null });
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, call.name + '.json'), res.text || JSON.stringify(res), 'utf8'); }
  }
  if (OUT) fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify({ calls: results, headerNames: ['uuid', 'User-mup', 'User-mnp', 'X-Requested-With'] }, null, 2), 'utf8');
  await cdp.closeTarget(targetId);
  cdp.close();
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
