const HEADERS_TIMEOUT = 30000;

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }

  static async connect(endpoint) {
    const ver = await (await fetch(endpoint.replace(/\/$/, '') + '/json/version')).json();
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    const client = new Cdp(ws);
    ws.addEventListener('message', (ev) => client._onMessage(ev.data));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || 'unknown'))), { once: true });
    });
    client.version = ver;
    return client;
  }

  _onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(msg.error)}`));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const key = msg.method + (msg.sessionId ? '|' + msg.sessionId : '');
      for (const fn of (this.handlers.get(msg.method) || [])) fn(msg.params, msg.sessionId);
      for (const fn of (this.handlers.get(key) || [])) fn(msg.params, msg.sessionId);
    }
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
    return () => {
      const arr = this.handlers.get(method) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  send(method, params = {}, sessionId, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const mid = ++this.id;
      const payload = { id: mid, method, params };
      if (sessionId) payload.sessionId = sessionId;
      const timer = setTimeout(() => {
        this.pending.delete(mid);
        reject(new Error('cdp timeout: ' + method));
      }, timeoutMs);
      this.pending.set(mid, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async listTargets() { return (await this.send('Target.getTargets')).targetInfos; }

  async createTab(url, newWindow = false, background = true, timeoutMs = 60000) {
    const r = await this.send('Target.createTarget', { url, newWindow, background }, undefined, timeoutMs);
    return r.targetId;
  }

  async attach(targetId) {
    const r = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return r.sessionId;
  }

  async detach(sessionId) { await this.send('Target.detachFromTarget', { sessionId }).catch(() => {}); }

  async closeTarget(targetId) { await this.send('Target.closeTarget', { targetId }).catch(() => {}); }

  async evaluate(sessionId, expression, timeoutMs = 120000) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { return (${expression}); })()`,
      awaitPromise: true, returnByValue: true, userGesture: false,
    }, sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }

  async evalRaw(sessionId, expression, timeoutMs = 120000) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }

  async navigate(sessionId, url, timeoutMs = 90000) {
    this._navDone = false;
    await this.send('Page.navigate', { url }, sessionId, timeoutMs);
  }

  async waitReady(sessionId, extraMs = 3000, timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const s = await this.evalRaw(sessionId, 'document.readyState').catch(() => null);
      if (s === 'complete') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, extraMs));
  }

  async pageText(sessionId) {
    return await this.evalRaw(sessionId, 'document.body ? document.body.innerText : ""');
  }

  async screenshot(sessionId, filePath) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId, 60000);
    require('fs').writeFileSync(filePath, Buffer.from(r.data, 'base64'));
  }

  close() { try { this.ws.close(); } catch (e) {} }
}

module.exports = { Cdp };
