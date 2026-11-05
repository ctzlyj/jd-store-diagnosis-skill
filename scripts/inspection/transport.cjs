const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { API_DEFINITIONS } = require('./vendor/core.cjs');

const ALLOWED = new Set([
  'GET.sp-seller.v0.venderinfo', 'GET.sp-product.v0.products', 'GET.sp-product.v0.skus',
  'GET.sp-product.v0.sku-stocks', 'GET.sp-product.v0.price-stars', 'GET.sp-product.v0.health-infos',
  'GET.sp-product.v0.health-infos._healthInfoId',
  'GET.sp-product.v0.penalty-infos', 'GET.sp-product.v0.violating-products',
  'GET.sp-product.v0.product-applies', 'GET.sp-order.v0.orders',
  'GET.sp-support.v0.dongdong-waiters', 'GET.sp-support.v0.dongdong-waiter-performance',
  'GET.sp-support.v0.dongdong-waiter-evaluations',
]);

function requireProfile(profile) {
  if (typeof profile !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(profile)) throw new Error('PROFILE_REQUIRED');
  return profile;
}

function assertSuccess(result) {
  if (result?.success === true) return result;
  const text = JSON.stringify(result?.errorList || result?.error || '');
  if (/401|403|token.*expir|unauthor|授权|权限不足|登录失效|credential/i.test(text)) throw new Error('AUTH_REQUIRED');
  if (/429|限流|频繁|rate.?limit|throttl/i.test(text)) throw new Error('RATE_LIMIT');
  throw new Error('API_FAILED');
}

function responseRows(response) {
  if (Array.isArray(response.data)) return response.data;
  if ((response.data === null || response.data === undefined) && [0, '0'].includes(response.paginationData?.totalItems)) return [];
  throw new Error('INVALID_RESPONSE');
}

function createOfficialInvoker({ cliPath, run = promisify(execFile), intervalMs = 300 } = {}) {
  let lastStart = 0;
  return async (api, params, profile) => {
    if (!ALLOWED.has(api)) throw new Error('READ_ONLY_API_REQUIRED');
    requireProfile(profile);
    const definition = API_DEFINITIONS[api];
    const wait = intervalMs - (Date.now() - lastStart);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastStart = Date.now();
    const args = ['invoke', '--skill-id', definition.skillId, '--url', definition.path,
      '--method', 'GET', '--params', JSON.stringify(params), '--profile', profile,
      '--request-identity', 'vender', '--timeout', '25'];
    let stdout;
    try {
      ({ stdout } = await run(cliPath, args, { windowsHide: true, shell: false, timeout: 35000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }));
    } catch {
      throw new Error('CLI_EXECUTION_FAILED');
    }
    try { return JSON.parse(stdout); }
    catch { throw new Error('INVALID_RESPONSE'); }
  };
}

async function readIdentity(invoke, profile) {
  requireProfile(profile);
  const response = assertSuccess(await invoke('GET.sp-seller.v0.venderinfo', { scopeSet: 'baseInfo' }, profile));
  const source = response.data?.shopBaseInfo;
  if (!source || !/^\d+$/.test(String(source.shopId || '')) || !source.shopName || !response.data?.venderId) throw new Error('IDENTITY_INCOMPLETE');
  if (source.type !== 0 && source.type !== '0') throw new Error('POP_ONLY');
  return { shopId: String(source.shopId), shopName: String(source.shopName), venderId: String(response.data.venderId), type: 0 };
}

async function readPages(invoke, api, params, { pageSize = 50, maxItems = 50000, limit = null, idKey = null } = {}) {
  const rows = [];
  const identifiers = new Set();
  let reportedTotal = null;
  try {
    for (let page = 1; page <= 1000; page += 1) {
      const response = assertSuccess(await invoke(api, { ...params, page, pageSize }));
      const batch = responseRows(response);
      const totalValue = response.paginationData?.totalItems;
      const total = totalValue === undefined || totalValue === null || totalValue === '' ? null : Number(totalValue);
      if (total !== null && (!Number.isSafeInteger(total) || total < 0)) throw new Error('INVALID_RESPONSE');
      if (reportedTotal !== null && total !== reportedTotal) throw new Error('TOTAL_CHANGED');
      if (total !== null) reportedTotal = total;
      for (const row of batch) {
        if (!row || typeof row !== 'object') throw new Error('INVALID_RESPONSE');
        const identifier = idKey ? String(row[idKey] ?? '') : createHash('sha256').update(JSON.stringify(row)).digest('hex');
        if (!identifier) throw new Error('ROW_ID_MISSING');
        if (identifiers.has(identifier)) throw new Error('DUPLICATE_ROW');
        identifiers.add(identifier);
        rows.push(row);
        if (rows.length > maxItems) throw new Error('ITEM_LIMIT');
      }
      if (reportedTotal !== null && rows.length > reportedTotal) throw new Error('TOTAL_MISMATCH');
      const complete = reportedTotal === rows.length || (reportedTotal === null && batch.length < pageSize);
      if (complete) return { rows: limit ? rows.slice(0, limit) : rows, complete: !limit || rows.length <= limit, reportedTotal };
      if (limit && rows.length >= limit) return { rows: rows.slice(0, limit), complete: false, reportedTotal };
      if (batch.length < pageSize) throw new Error('INCOMPLETE_PAGE');
    }
    throw new Error('PAGE_LIMIT');
  } catch (error) {
    error.partialRows = rows.slice(0, maxItems);
    error.reportedTotal = reportedTotal;
    throw error;
  }
}

module.exports = { ALLOWED, requireProfile, assertSuccess, responseRows, createOfficialInvoker, readIdentity, readPages };
