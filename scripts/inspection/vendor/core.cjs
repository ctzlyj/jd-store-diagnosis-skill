const API_DEFINITIONS = Object.freeze({
  'GET.ads-billing.v0.ads-accounts.self': { skillId: 'jdo-ads-billing', path: '/rest/ads-billing/v0/ads-accounts/self' },
  'GET.ads-billing.v0.ads-accounts.self.ads-balances': { skillId: 'jdo-ads-billing', path: '/rest/ads-billing/v0/ads-accounts/self/ads-balances' },
  'GET.sp-marketing.v0.member-agg-statistics': { skillId: 'jdo-marketing-member', path: '/rest/sp-marketing/v0/member-agg-statistics' },
  'GET.sp-marketing.v0.member-systems': { skillId: 'jdo-marketing-member', path: '/rest/sp-marketing/v0/member-systems' },
  'GET.sp-seller.v0.venderinfo': { skillId: 'jdo-seller-info', path: '/rest/sp-seller/v0/venderinfo' },
  'GET.sp-product.v0.products': { skillId: 'jdo-product-status', path: '/rest/sp-product/v0/products' },
  'GET.sp-product.v0.products._productId': { skillId: 'jdo-product-status', path: '/rest/sp-product/v0/products/{productId}' },
  'GET.sp-product.v0.skus': { skillId: 'jdo-product-status', path: '/rest/sp-product/v0/skus' },
  'GET.sp-product.v0.sku-stocks': { skillId: 'jdo-product-status', path: '/rest/sp-product/v0/sku-stocks' },
  'GET.sp-product.v0.health-infos': { skillId: 'jdo-product-price', path: '/rest/sp-product/v0/health-infos' },
  'GET.sp-product.v0.health-infos._healthInfoId': { skillId: 'jdo-product-price', path: '/rest/sp-product/v0/health-infos/{healthInfoId}' },
  'GET.sp-product.v0.price-stars': { skillId: 'jdo-product-price', path: '/rest/sp-product/v0/price-stars' },
  'GET.sp-product.v0.suggested-prices': { skillId: 'jdo-product-price', path: '/rest/sp-product/v0/suggested-prices' },
  'GET.sp-product.v0.penalty-infos': { skillId: 'jdo-product-price', path: '/rest/sp-product/v0/penalty-infos' },
  'GET.sp-product.v0.violating-products': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/violating-products' },
  'GET.sp-product.v0.product-applies': { skillId: 'jdo-product-update', path: '/rest/sp-product/v0/product-applies' },
  'GET.sp-product.v0.sku-materials': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/sku-materials' },
  'GET.sp-product.v0.media-zones': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/media-zones' },
  'GET.sp-product.v0.media-zones._zoneId.video-sku-rels': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/media-zones/{zoneId}/video-sku-rels' },
  'GET.sp-product.v0.sku-material-tags': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/sku-material-tags' },
  'GET.sp-product.v0.material-experiments': { skillId: 'jdo-api-830', path: '/rest/sp-product/v0/material-experiments' },
  'GET.sp-order.v0.orders': { skillId: 'jdo-order-manage', path: '/rest/sp-order/v0/orders' },
  'GET.sp-order.v0.waybill-traces': { skillId: 'jdo-order-manage', path: '/rest/sp-order/v0/waybill-traces' },
  'GET.sp-support.v0.dongdong-waiters': { skillId: 'jdo-support-data', path: '/rest/sp-support/v0/dongdong-waiters' },
  'GET.sp-support.v0.dongdong-waiter-performance': { skillId: 'jdo-support-data', path: '/rest/sp-support/v0/dongdong-waiter-performance' },
  'GET.sp-support.v0.dongdong-waiter-evaluations': { skillId: 'jdo-support-data', path: '/rest/sp-support/v0/dongdong-waiter-evaluations' },
});

const ALLOWED_API_NAMES = new Set(Object.keys(API_DEFINITIONS));
const MAX_PRODUCTS = 5000;
const MAX_SKUS = 50000;
const MAX_PAGES = 1000;

function validateProfileName(value) {
  const profile = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profile)) throw new TypeError('JDO profile 名称无效');
  return profile;
}

function normalizeImageUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  return `https://img10.360buyimg.com/n1/${text.replace(/^\/+/, '')}`;
}

function normalizeDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number).toISOString();
}

function ensureSuccess(result, apiName) {
  if (!result || result.success !== true) {
    const errors = Array.isArray(result?.errorList) ? result.errorList : [];
    const message = errors.map((item) => item.message || item.details || item.code).filter(Boolean).join('；');
    throw new Error(`${apiName} 调用失败${message ? `：${message}` : ''}`);
  }
  return result;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, run));
  return results;
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

async function fetchPages(invoke, profile, apiName, params, pageSize, maxItems) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = ensureSuccess(await invoke(apiName, { ...params, page, pageSize }, profile), apiName);
    const data = Array.isArray(result.data) ? result.data : [];
    rows.push(...data);
    if (rows.length > maxItems) throw new RangeError(`${apiName} 返回数量超过安全上限`);
    const total = Number(result.paginationData?.totalItems);
    if (!data.length || (Number.isFinite(total) && rows.length >= total) || data.length < pageSize) break;
  }
  return rows;
}

function summarizeHealthRecords(records) {
  const issueMap = new Map();
  const affectedProducts = new Set();
  let scoreTotal = 0;
  let scoreCount = 0;
  let issueCount = 0;
  for (const record of records) {
    const score = Number(record.healthScore);
    if (Number.isFinite(score)) {
      scoreTotal += score;
      scoreCount += 1;
    }
    const improvements = Array.isArray(record.improvementList) ? record.improvementList : [];
    if (!improvements.length) continue;
    issueCount += 1;
    if (record.productId !== null && record.productId !== undefined) affectedProducts.add(String(record.productId));
    for (const item of improvements) {
      const detail = item?.improvementDetail || item || {};
      const code = String(detail.troubleCode || detail.code || 'unknown').trim() || 'unknown';
      const name = String(detail.troubleName || detail.name || '待优化项').trim() || '待优化项';
      const current = issueMap.get(code) || { code, name, count: 0 };
      current.count += 1;
      issueMap.set(code, current);
    }
  }
  return {
    total: records.length,
    issueCount,
    affectedProductCount: affectedProducts.size,
    averageScore: scoreCount ? Math.round((scoreTotal / scoreCount) * 100) / 100 : null,
    issues: [...issueMap.values()].sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
  };
}

function summarizePriceRecords(records) {
  const stars = {};
  const competitivePower = {};
  const affectedProducts = new Set();
  let lowCount = 0;
  for (const record of records) {
    const star = Number(record.priceStar);
    const power = String(record.competitivePower || '').trim();
    if (Number.isFinite(star)) stars[String(star)] = (stars[String(star)] || 0) + 1;
    if (power) competitivePower[power] = (competitivePower[power] || 0) + 1;
    if ((Number.isFinite(star) && star <= 3) || ['bad', 'avg'].includes(power)) {
      lowCount += 1;
      if (record.spuId !== null && record.spuId !== undefined) affectedProducts.add(String(record.spuId));
    }
  }
  return { total: records.length, lowCount, affectedProductCount: affectedProducts.size, stars, competitivePower };
}

function summarizePenaltyRecords(records) {
  const items = records.filter((record) => Number(record.effectStatus) !== 2).slice(0, 100).map((record) => ({
    penaltyId: String(record.penaltyId || ''),
    level: Number(record.illegalLevel) || 0,
    reason: String(record.illegalReason || '').slice(0, 300),
    status: Number(record.effectStatus) || 0,
    url: /^https:\/\/[^/]*\.jd\.com\//i.test(String(record.illegalDetailUrl || '')) ? String(record.illegalDetailUrl) : '',
    productIds: [...new Set((Array.isArray(record.evidenceInfo) ? record.evidenceInfo : [])
      .filter((item) => [2, 3].includes(Number(item.evidenceType)))
      .map((item) => String(item.evidence || '').trim())
      .filter((value) => /^\d{5,}$/.test(value)))].slice(0, 50),
  })).filter((item) => item.penaltyId);
  return { total: items.length, seriousCount: items.filter((item) => item.level === 1).length, items };
}

function summarizeViolatingProducts(records) {
  const items = (Array.isArray(records) ? records : []).filter((record) => String(record.rectificationStatus ?? '1') !== '0').slice(0, 200).map((record) => ({
    productId: String(record.productId || ''),
    reason: String(record.reason || '').slice(0, 300),
    level: (Array.isArray(record.badGradeNameList) ? record.badGradeNameList : []).map(String).join('、').slice(0, 80),
    rectificationStatus: String(record.rectificationStatusName || record.rectificationStatus || '').slice(0, 80),
    remainDate: normalizeDate(record.remainDate),
  })).filter((item) => item.productId);
  return { available: true, total: Array.isArray(records) ? records.length : 0, pendingCount: items.length, productIds: [...new Set(items.map((item) => item.productId))], items };
}

function summarizeProductApplies(records, nowMs = Date.now()) {
  const rows = Array.isArray(records) ? records : [];
  const rejected = rows.filter((row) => [300, 309].includes(Number(row.pushStatus)) || [300, 309].includes(Number(row.keeperStatus)) || Number(row.status) === 300);
  const pending = rows.filter((row) => {
    const status = Number(row.pushStatus || row.status || row.keeperStatus);
    const modifiedTime = Number(row.modifiedTime || row.createTime);
    return [0, 100, 109].includes(status) && Number.isFinite(modifiedTime) && nowMs - modifiedTime >= 24 * 60 * 60 * 1000;
  });
  const abnormal = [...rejected, ...pending];
  return {
    available: true,
    total: rows.length,
    rejectedCount: rejected.length,
    pendingCount: pending.length,
    productIds: [...new Set(abnormal.map((row) => String(row.productId || '')).filter(Boolean))].slice(0, 200),
  };
}

function summarizeMaterialCoverage(skuIds, records) {
  const rows = Array.isArray(records) ? records : [];
  const bySku = new Map(rows.map((row) => [String(row.skuId || ''), row]));
  const incompleteSkuIds = [];
  const productIds = new Set();
  const typeCounts = {};
  for (const skuId of skuIds || []) {
    const row = bySku.get(String(skuId));
    const approved = (Array.isArray(row?.materials) ? row.materials : []).filter((material) => Number(material.status) === 4);
    for (const material of approved) {
      const key = String(material.materialType || 'unknown');
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    }
    if (approved.length) continue;
    incompleteSkuIds.push(String(skuId));
    if (row?.productId !== null && row?.productId !== undefined) productIds.add(String(row.productId));
  }
  return {
    available: true,
    totalSkuCount: (skuIds || []).length,
    incompleteSkuCount: incompleteSkuIds.length,
    affectedProductCount: productIds.size,
    skuIds: incompleteSkuIds.slice(0, 500),
    productIds: [...productIds].slice(0, 200),
    missingCounts: { noApprovedMaterial: incompleteSkuIds.length },
    typeCounts,
  };
}

function summarizeServiceEvaluations(records, window) {
  const rows = Array.isArray(records) ? records : [];
  const lowScoreCount = rows.filter((row) => Number(row.degree) <= 50).length;
  const satisfiedCount = rows.filter((row) => Number(row.degree) >= 75).length;
  const labelCounts = new Map();
  for (const row of rows) {
    let labels = [];
    if (Array.isArray(row.evaluationLabel)) labels = row.evaluationLabel;
    else if (typeof row.evaluationLabel === 'string') {
      try { labels = JSON.parse(row.evaluationLabel); } catch { labels = row.evaluationLabel.split(/[,，]/); }
    }
    for (const value of labels) {
      const label = String(value || '').trim().slice(0, 100);
      if (label) labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
  }
  return {
    available: true,
    startTime: formatShanghaiTime(window.startTime),
    endTime: formatShanghaiTime(window.endTime),
    evaluationCount: rows.length,
    lowScoreCount,
    satisfactionRate: rows.length ? round((satisfiedCount / rows.length) * 100, 1) : 0,
    labels: [...labelCounts.entries()].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, 20),
  };
}

function summarizeExperiments(records) {
  const items = (Array.isArray(records) ? records : []).slice(0, 100).map((record) => ({
    id: String(record.id || ''),
    productId: String(record.productId || ''),
    skuId: String(record.skuId || ''),
    name: String(record.name || '').slice(0, 100),
    status: Number(record.status) || 0,
    experimentType: Number(record.experimentType) || 0,
    expectedStartTime: normalizeDate(record.expectedStartTime),
    expectedEndTime: normalizeDate(record.expectedEndTime),
    reason: String(record.reason || '').slice(0, 300),
  })).filter((item) => item.id);
  return { available: true, total: items.length, runningCount: items.filter((item) => item.status === 3).length, endedCount: items.filter((item) => item.status === 4).length, items };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function unavailable(errorCode) {
  return { available: false, errorCode };
}

function summarizeSuggestedPrices(eligibleSkuIds, records) {
  const targetStars = {};
  const benefitPointCounts = new Map();
  let coveredCount = 0;
  for (const record of records) {
    const suggestions = Array.isArray(record?.starSuggestedPriceList) ? record.starSuggestedPriceList : [];
    if (!suggestions.length) continue;
    coveredCount += 1;
    const readStar = (suggestion) => {
      const text = String(suggestion?.code || suggestion?.name || '');
      return Number(text.match(/(\d)/)?.[1]) || ({ three: 3, four: 4, five: 5 }[text.match(/^(three|four|five)_star_price$/)?.[1]] || 0);
    };
    const preferred = [...suggestions].sort((left, right) => {
      const leftStar = readStar(left);
      const rightStar = readStar(right);
      return rightStar - leftStar;
    })[0];
    const targetStar = readStar(preferred);
    if (targetStar) targetStars[targetStar] = (targetStars[targetStar] || 0) + 1;
    const benefitPoint = String(preferred?.benefitPoint || '').trim().slice(0, 100);
    if (benefitPoint) benefitPointCounts.set(benefitPoint, (benefitPointCounts.get(benefitPoint) || 0) + 1);
  }
  return {
    available: true,
    eligibleCount: eligibleSkuIds.length,
    coveredCount,
    targetStars,
    benefitPoints: [...benefitPointCounts.entries()]
      .map(([text, count]) => ({ text, count }))
      .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))
      .slice(0, 10),
  };
}

function summarizeFulfillment(records, nowMs) {
  let totalAmount = 0;
  let over24HourOrders = 0;
  let over24HourAmount = 0;
  let over48HourOrders = 0;
  let over48HourAmount = 0;
  let longestWaitHours = 0;
  for (const record of records) {
    const createdTime = Number(record?.createdTime);
    const amount = Number(record?.paymentInfo?.actualPayAmount ?? record?.paymentInfo?.shouldPayAmount);
    const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
    totalAmount += safeAmount;
    if (!Number.isFinite(createdTime) || createdTime <= 0) continue;
    const waitHours = Math.max(0, (nowMs - createdTime) / 3600000);
    longestWaitHours = Math.max(longestWaitHours, waitHours);
    if (waitHours > 24) {
      over24HourOrders += 1;
      over24HourAmount += safeAmount;
    }
    if (waitHours > 48) {
      over48HourOrders += 1;
      over48HourAmount += safeAmount;
    }
  }
  return {
    available: true,
    totalOrders: records.length,
    totalAmount: round(totalAmount),
    over24HourOrders,
    over24HourAmount: round(over24HourAmount),
    over48HourOrders,
    over48HourAmount: round(over48HourAmount),
    longestWaitHours: round(longestWaitHours, 1),
  };
}

function formatShanghaiTime(timestamp) {
  return `${new Date(timestamp + 8 * 3600000).toISOString().slice(0, -1)}+08:00`;
}

function getServiceWindow(nowMs) {
  const shanghaiNow = new Date(nowMs + 8 * 3600000);
  const todayStart = Date.UTC(shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), shanghaiNow.getUTCDate()) - 8 * 3600000;
  return { startTime: todayStart - 7 * 86400000, endTime: todayStart - 1 };
}

function getBusinessWindows(nowMs) {
  const shanghaiNow = new Date(nowMs + 8 * 3600000);
  const todayStart = Date.UTC(shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), shanghaiNow.getUTCDate()) - 8 * 3600000;
  return {
    currentStart: todayStart - 7 * 86400000,
    currentEnd: todayStart - 1,
    previousStart: todayStart - 14 * 86400000,
    previousEnd: todayStart - 7 * 86400000 - 1,
  };
}

function orderLines(order) {
  for (const key of ['orderSkuList', 'skuList', 'itemList', 'orderProductList', 'orderItemList']) {
    if (Array.isArray(order?.[key])) return order[key];
  }
  return [];
}

function orderCreatedTime(order) {
  return Number(order?.createdTime || order?.orderCreateTime || order?.payTime || order?.modifiedTime) || 0;
}

function orderAmount(order) {
  const payment = order?.paymentInfo || {};
  return Math.max(0, Number(payment.actualPayAmount ?? payment.payAmount ?? order?.actualPayAmount ?? order?.payAmount ?? order?.orderAmount) || 0);
}

function summarizeBusinessOrders(records, nowMs = Date.now()) {
  const windows = getBusinessWindows(nowMs);
  const current = { orderCount: 0, unitCount: 0, gmv: 0, activeSkuCount: 0 };
  const previous = { orderCount: 0, unitCount: 0, gmv: 0, activeSkuCount: 0 };
  const currentSkus = new Set();
  const previousSkus = new Set();
  const skuMetrics = new Map();
  for (const order of Array.isArray(records) ? records : []) {
    const createdTime = orderCreatedTime(order);
    const target = createdTime >= windows.currentStart && createdTime <= windows.currentEnd
      ? current
      : createdTime >= windows.previousStart && createdTime <= windows.previousEnd ? previous : null;
    if (!target) continue;
    const lines = orderLines(order);
    const totalUnits = lines.reduce((sum, line) => sum + Math.max(0, Number(line?.quantity ?? line?.num ?? line?.skuNum ?? line?.itemNum) || 0), 0);
    const amount = orderAmount(order);
    target.orderCount += 1;
    target.unitCount += totalUnits;
    target.gmv += amount;
    const targetSkus = target === current ? currentSkus : previousSkus;
    for (const line of lines) {
      const skuId = String(line?.skuId || line?.wareId || '').trim();
      const productId = String(line?.productId || line?.spuId || line?.wareId || '').trim();
      if (!skuId) continue;
      targetSkus.add(skuId);
      if (target !== current) continue;
      const units = Math.max(0, Number(line?.quantity ?? line?.num ?? line?.skuNum ?? line?.itemNum) || 0);
      const explicitAmount = Number(line?.actualPayAmount ?? line?.payAmount ?? line?.amount ?? line?.totalPrice);
      const lineAmount = Number.isFinite(explicitAmount) && explicitAmount >= 0 ? explicitAmount : totalUnits ? amount * units / totalUnits : 0;
      const metric = skuMetrics.get(skuId) || { productId, skuId, orderCount: 0, unitCount: 0, gmv: 0 };
      metric.orderCount += 1;
      metric.unitCount += units;
      metric.gmv += lineAmount;
      skuMetrics.set(skuId, metric);
    }
  }
  current.activeSkuCount = currentSkus.size;
  previous.activeSkuCount = previousSkus.size;
  current.gmv = round(current.gmv);
  previous.gmv = round(previous.gmv);
  return {
    available: true,
    startTime: formatShanghaiTime(windows.currentStart),
    endTime: formatShanghaiTime(windows.currentEnd),
    previousStartTime: formatShanghaiTime(windows.previousStart),
    previousEndTime: formatShanghaiTime(windows.previousEnd),
    current,
    previous,
    skuMetrics: [...skuMetrics.values()].map((item) => ({ ...item, gmv: round(item.gmv) })).sort((left, right) => right.gmv - left.gmv).slice(0, 500),
  };
}

function summarizeFieldDiagnostics(records) {
  const items = [];
  for (const record of Array.isArray(records) ? records : []) {
    const fields = (Array.isArray(record?.improvementList) ? record.improvementList : []).map((entry) => {
      const detail = entry?.improvementDetail || entry || {};
      return {
        code: String(detail.troubleCode || detail.code || '').slice(0, 100),
        name: String(detail.troubleName || detail.name || '').slice(0, 160),
        suggestion: String(detail.improvementSuggestion || detail.suggestion || detail.advice || '').slice(0, 300),
        severity: String(detail.severity || detail.level || '').slice(0, 20),
      };
    }).filter((field) => field.code || field.name);
    if (!fields.length) continue;
    items.push({
      productId: String(record?.productId || '').slice(0, 64),
      skuId: String(record?.skuId || '').slice(0, 64),
      healthScore: Number.isFinite(Number(record?.healthScore)) ? Number(record.healthScore) : null,
      fields: fields.slice(0, 20),
    });
  }
  return { available: true, issueCount: items.reduce((sum, item) => sum + item.fields.length, 0), affectedProductCount: new Set(items.map((item) => item.productId).filter(Boolean)).size, items: items.slice(0, 200) };
}

function summarizeLogistics(records, nowMs = Date.now(), fulfillment = {}) {
  let uncollectedCount = 0;
  let transitStalledCount = 0;
  let rejectedCount = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const state = String(record?.state || record?.status || record?.waybillState || record?.statusName || '').toUpperCase();
    const lastTraceTime = Number(record?.lastTraceTime || record?.traceTime || record?.modifiedTime || record?.operateTime) || 0;
    const age = lastTraceTime ? nowMs - lastTraceTime : 0;
    if (/NOT.?COLLECT|WAIT.?COLLECT|未揽收/.test(state)) uncollectedCount += 1;
    if (/IN.?TRANSIT|运输|配送/.test(state) && age >= 48 * 3600000) transitStalledCount += 1;
    if (/REJECT|REFUSE|拒收/.test(state)) rejectedCount += 1;
  }
  return {
    available: true,
    pendingShipmentCount: Math.max(0, Number(fulfillment.totalOrders ?? fulfillment.pendingCount) || 0),
    over24HourCount: Math.max(0, Number(fulfillment.over24HourOrders ?? fulfillment.over24HourCount) || 0),
    over48HourCount: Math.max(0, Number(fulfillment.over48HourOrders ?? fulfillment.over48HourCount) || 0),
    awaitingPickupCount: uncollectedCount,
    stalledCount: transitStalledCount,
    rejectedCount,
  };
}

function summarizeAdvertising(accountData, balanceData) {
  const accounts = Array.isArray(accountData) ? accountData : accountData && typeof accountData === 'object' ? [accountData] : [];
  const balances = Array.isArray(balanceData) ? balanceData : balanceData && typeof balanceData === 'object' ? [balanceData] : [];
  const cashBalance = balances.reduce((sum, item) => sum + Math.max(0, Number(item?.cashBalanceAmount ?? item?.cashBalance) || 0), 0);
  const awardBalance = balances.reduce((sum, item) => sum + Math.max(0, Number(item?.awardBalanceAmount ?? item?.awardBalance) || 0), 0);
  const commissionBalance = balances.reduce((sum, item) => sum + Math.max(0, Number(item?.commissionBalanceAmount ?? item?.commissionBalance) || 0), 0);
  const fallbackBalance = balances.reduce((sum, item) => sum + Math.max(0, Number(item?.availableBalance ?? item?.balance ?? item?.amount) || 0), 0);
  const balance = cashBalance + awardBalance + commissionBalance || fallbackBalance;
  return {
    available: true,
    configured: accounts.length > 0,
    accountCount: accounts.length,
    balance: round(balance),
    cashBalance: round(cashBalance),
    awardBalance: round(awardBalance),
    commissionBalance: round(commissionBalance),
    balanceStatus: balance > 0 ? 'ready' : 'empty',
  };
}

function summarizeMemberStatistics(systemData, statisticsData) {
  const systems = Array.isArray(systemData) ? systemData : systemData && typeof systemData === 'object' ? [systemData] : [];
  const stats = Array.isArray(statisticsData) ? statisticsData[0] || {} : statisticsData || {};
  const system = systems[0] || {};
  return {
    available: true,
    systemConfigured: systems.length > 0,
    memberCount: Math.max(0, Number(stats.memberCount ?? system.memberCount) || 0),
    transactingMemberCount: Math.max(0, Number(stats.transactingMemberCount ?? stats.dealMemberCount ?? stats.transactionMemberCount) || 0),
    repeatMemberCount: Math.max(0, Number(stats.repeatMemberCount ?? stats.repurchaseMemberCount) || 0),
    dormantMemberCount: Math.max(0, Number(stats.dormantMemberCount ?? stats.silentMemberCount) || 0),
    totalOrderCount: Math.max(0, Number(stats.totalOrderCount ?? stats.orderCount) || 0),
    totalOrderAmount: round(Math.max(0, Number(stats.dealAmount ?? stats.transactionAmount ?? stats.totalOrderAmount) || 0)),
  };
}

function summarizeService(records, window) {
  let consultCount = 0;
  let replyCount = 0;
  let unReplyCount = 0;
  let evaluationCount = 0;
  let weightedWaitTime = 0;
  let waitWeight = 0;
  for (const record of records) {
    const consult = Math.max(0, Number(record?.consultCount) || 0);
    const avgWaitTime = Math.max(0, Number(record?.avgWaitTime) || 0);
    consultCount += consult;
    replyCount += Math.max(0, Number(record?.replyCount) || 0);
    unReplyCount += Math.max(0, Number(record?.unReplyCount) || 0);
    evaluationCount += Math.max(0, Number(record?.evaluationCount) || 0);
    weightedWaitTime += avgWaitTime * consult;
    waitWeight += consult;
  }
  return {
    available: true,
    startTime: formatShanghaiTime(window.startTime),
    endTime: formatShanghaiTime(window.endTime),
    consultCount,
    replyCount,
    unReplyCount,
    replyRate: consultCount ? round((replyCount / consultCount) * 100, 1) : 0,
    avgWaitTime: waitWeight ? round(weightedWaitTime / waitWeight, 1) : 0,
    evaluationCount,
  };
}

module.exports = { API_DEFINITIONS, summarizeHealthRecords, summarizePriceRecords, summarizePenaltyRecords, summarizeViolatingProducts, summarizeProductApplies, summarizeFulfillment, summarizeService, summarizeServiceEvaluations };
