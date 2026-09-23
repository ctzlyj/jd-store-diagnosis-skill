const fs = require('fs');
const path = require('path');
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

  // capture a real szgateway request's headers (kept in memory only)
  const holder = { hdr: null };
  cdp.on('Network.requestWillBeSent', (p, sid) => {
    if (sid !== sessionId) return;
    const u = p.request.url || '';
    if (holder.hdr || !u.includes('szgateway')) return;
    const h = p.request.headers || {};
    const keep = {};
    for (const k of ['User-mnp', 'User-mup', 'uuid', 'X-Requested-With', 'Accept']) {
      const hit = Object.keys(h).find(x => x.toLowerCase() === k.toLowerCase());
      if (hit) keep[k] = h[hit];
    }
    holder.hdr = keep;
  }, sessionId);

  await cdp.navigate(sessionId, PAGE);
  await cdp.waitReady(sessionId, 12000, 150000);
  if (!holder.hdr) { console.error('no szgateway headers captured'); await cdp.closeTarget(targetId); process.exit(2); }
  console.log('captured header set:', Object.keys(holder.hdr).join(', '));

  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const results = [];
  for (const call of plan) {
    const expr = `(async () => {
      const r = await fetch(${JSON.stringify(call.url)}, {
        method: ${JSON.stringify(call.method || 'POST')},
        credentials: 'include',
        headers: Object.assign({}, ${JSON.stringify(holder.hdr)}, { 'Content-Type': 'application/json;charset=UTF-8' }),
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
  if (OUT) fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify({ calls: results, headerNames: Object.keys(holder.hdr) }, null, 2), 'utf8');
  await cdp.closeTarget(targetId);
  cdp.close();
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
