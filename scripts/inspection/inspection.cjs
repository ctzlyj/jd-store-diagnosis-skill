const summaries = require('./vendor/core.cjs');
const rules = require('./vendor/merchant-sync.cjs');
const { ALLOWED, requireProfile, assertSuccess, responseRows, createOfficialInvoker, readIdentity, readPages } = require('./transport.cjs');

const SKILL_VERSION = '0.2.0';
const TITLES = ['在售商品供给', '商品信息健康', '价格竞争力', '近30天零动销', '动销商品零库存规格', '商品违规违约单', '待出库超过24小时', '客服未回复', '违规待整改商品', '商品审核异常', '官方素材待优化项', '客服低分评价'];
const MATERIAL_FACTORS = new Set(['hasMainVideo', 'isImgWhite', 'hasShortTitle', 'hasTransImg', 'hasSellPointImg', 'hasSceneImg', 'hasElectronicManual', 'sellPointNum', 'hasLongImage', 'squareMainImageQuality', 'longMainImageQuality']);
const ACTIONS = {
  R01: '货盘扩充：建议用 jd-jingmai-universal-mover 整理爆品资料与上架方案（先确认改图与定价策略）。',
  R02: '信息分/健康项维护：建议用 jd-material-pop 做素材审计与维护计划；属性/错挂类目核验用 jdo-product-update。',
  R03: '价格竞争力：建议用 jd-competitor-price-adjustment-skill 做比价与调价方案（不直接改价）。',
  R04: '零动销排查：建议用 jd-competitor-price-adjustment-skill 排查价格/同款，不自动下架。',
  R05: '动销商品零库存：建议用 jdo-product-status 准备库存处理方案，数量必须有业务依据。',
  R06: '违约单：建议用 jdo-product-price 获取官方详情，先确定整改原因。',
  R07: '待出库超24小时：建议用 jdo-order-ship 读取待处理订单与履约资料，尽快发货处理。',
  R08: '客服未回复：建议用 jdo-support-data 复核客服绩效，安排回复。',
  R09: '违规待整改：建议用 jdo-product-price 核验整改原因，按平台要求整改。',
  R10: '审核异常：建议用 jdo-product-update 查询申请单、确认修正方案后重新提交。',
  R11: '素材优化：短标题/卖点/白底/透图/场景图建议用 jd-material-pop；主图批量重制用 jd-jingmai-batch-image-refresh；主图视频/长图用 jdo-product-material；电子说明书用 jdo-product-manual。',
  R12: '低分评价：建议用 jdo-support-data 复核评价与客服记录，安排回访处理。',
};
const SAFE_ERRORS = new Set(['AUTH_REQUIRED', 'RATE_LIMIT', 'API_FAILED', 'CLI_EXECUTION_FAILED', 'INVALID_RESPONSE', 'TOTAL_CHANGED', 'DUPLICATE_ROW', 'INCOMPLETE_PAGE', 'ROW_ID_MISSING', 'ITEM_LIMIT', 'TOTAL_MISMATCH', 'PAGE_LIMIT', 'DATA_SCOPE_MISMATCH', 'REQUEST_BUDGET', 'FAILURE_LIMIT']);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function serviceWindow(timestamp) {
  const shifted = new Date(timestamp + 8 * 3600000);
  const end = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000;
  return { startTime: end - 7 * 86400000, endTime: end - 1 };
}

async function runInspection({ profile, shopId, shopName, scope = 'sample', limit = 10, maxRequests = 2000, invoke, now = () => new Date() }) {
  requireProfile(profile);
  if (!/^\d+$/.test(String(shopId || '')) || typeof shopName !== 'string' || !shopName.trim()) throw new Error('EXPECTED_SHOP_REQUIRED');
  if (!['sample', 'full'].includes(scope) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('INVALID_SCOPE');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10000) throw new Error('INVALID_REQUEST_BUDGET');
  const startedAt = now().toISOString();
  const timestamp = Date.parse(startedAt);
  const audit = [];
  const failures = [];
  const sources = {};
  let stopReason = null;
  let consecutiveFailures = 0;
  const request = async (api, params) => {
    if (!ALLOWED.has(api)) throw new Error('READ_ONLY_API_REQUIRED');
    if (stopReason) throw new Error(stopReason);
    if (audit.length >= maxRequests) { stopReason = 'REQUEST_BUDGET'; throw new Error(stopReason); }
    const entry = { api, startedAt: now().toISOString(), status: 'pending' };
    audit.push(entry);
    try {
      const response = assertSuccess(await invoke(api, params, profile));
      consecutiveFailures = 0;
      entry.status = 'ok';
      entry.rowCount = Array.isArray(response.data) ? response.data.length : null;
      return response;
    } catch (error) {
      consecutiveFailures += 1;
      const code = SAFE_ERRORS.has(error.message) ? error.message : 'API_FAILED';
      entry.status = 'failed';
      entry.errorCode = code;
      if (['AUTH_REQUIRED', 'RATE_LIMIT'].includes(code)) stopReason = code;
      else if (consecutiveFailures >= 3) stopReason = 'FAILURE_LIMIT';
      throw new Error(code);
    }
  };
  const shop = await readIdentity((api, params) => request(api, params), profile);
  if (shop.shopId !== String(shopId) || shop.shopName !== shopName) throw new Error('SHOP_IDENTITY_MISMATCH');
  const collect = async (key, action) => {
    try {
      const result = await action();
      sources[key] = { status: 'ok', rows: result.rows.length, complete: result.complete, reportedTotal: result.reportedTotal ?? null, checkedAt: now().toISOString() };
      return result;
    } catch (error) {
      const code = SAFE_ERRORS.has(error.message) ? error.message : 'INVALID_RESPONSE';
      const rows = error.partialRows || [];
      sources[key] = { status: 'failed', complete: false, rows: rows.length, errorCode: code, checkedAt: now().toISOString() };
      failures.push({ source: key, errorCode: code });
      return { rows, complete: false, reportedTotal: error.reportedTotal ?? null };
    }
  };
  const inventory = await collect('products', () => readPages(request, 'GET.sp-product.v0.products', {
    scopeSet: ['productId', 'productName', 'productStatus', 'salesVolume'], productStatusList: [103], sortBy: 'created', sortType: 'asc',
  }, { pageSize: scope === 'sample' ? limit : 50, limit: scope === 'sample' ? limit : null, maxItems: 5000, idKey: 'productId' }));
  const products = [];
  const skuIds = new Set();
  for (const row of inventory.rows) {
    if (stopReason) break;
    const productId = String(row.productId);
    const group = await collect(`skus:${productId}`, async () => {
      const result = await readPages(request, 'GET.sp-product.v0.skus', {
        scopeSet: ['skuId', 'productId', 'skuName', 'status', 'jdPrice'], productIdList: [Number(productId)], skuStatusList: [103], sortBy: 'created', sortType: 'asc',
      }, { pageSize: 50, maxItems: 5000, idKey: 'skuId' });
      if (result.rows.some(sku => String(sku.productId) !== productId || skuIds.has(String(sku.skuId)))) throw new Error('DATA_SCOPE_MISMATCH');
      if (skuIds.size + result.rows.length > 50000) throw new Error('ITEM_LIMIT');
      return result;
    });
    const skus = group.rows.map(sku => {
      skuIds.add(String(sku.skuId));
      return { skuId: String(sku.skuId), productId, title: String(sku.skuName || '').slice(0, 200), price: numberOrNull(sku.jdPrice), stock: null, priceStar: null, competitivePower: '' };
    });
    products.push({ productId, title: String(row.productName || '').slice(0, 200), sales30d: numberOrNull(row.salesVolume), skus });
  }
  const batchRead = async (api, paramsFor, size) => {
    const rows = [];
    for (const ids of chunks([...skuIds], size)) {
      const response = await request(api, paramsFor(ids.map(Number)));
      const batch = responseRows(response);
      const expected = new Set(ids);
      const seen = new Set();
      for (const row of batch) {
        const identifier = String(row.skuId);
        if (!expected.has(identifier) || seen.has(identifier)) throw new Error('DATA_SCOPE_MISMATCH');
        seen.add(identifier);
        rows.push(row);
      }
    }
    return { rows, complete: true };
  };
  const stocks = await collect('stocks', () => batchRead('GET.sp-product.v0.sku-stocks', ids => ({ skuIdList: ids, venderScene: 1 }), 20));
  const prices = await collect('prices', () => batchRead('GET.sp-product.v0.price-stars', ids => ({ skuIdList: ids, page: 1, pageSize: 200 }), 200));
  const stockMap = new Map(stocks.rows.map(row => [String(row.skuId), numberOrNull(row.stockNum)]));
  const priceMap = new Map(prices.rows.map(row => [String(row.skuId), row]));
  for (const product of products) for (const sku of product.skus) {
    sku.stock = stockMap.get(sku.skuId) ?? null;
    sku.priceStar = numberOrNull(priceMap.get(sku.skuId)?.priceStar);
    sku.competitivePower = String(priceMap.get(sku.skuId)?.competitivePower || '');
  }
  const health = await collect('health', async () => {
    if (scope === 'full') return readPages(request, 'GET.sp-product.v0.health-infos', {}, { pageSize: 100, idKey: 'skuId' });
    const rows = [];
    for (const product of products) {
      const result = await readPages(request, 'GET.sp-product.v0.health-infos', { productId: Number(product.productId) }, { pageSize: 100, idKey: 'skuId' });
      if (result.rows.some(row => String(row.productId) !== product.productId)) throw new Error('DATA_SCOPE_MISMATCH');
      rows.push(...result.rows);
    }
    return { rows, complete: true };
  });
  for (const row of health.rows) {
    if (Array.isArray(row.improvementList)) continue;
    if (Number(row.healthScore) === 100) { row.improvementList = []; continue; }
    if (numberOrNull(row.healthScore) === null || stopReason) continue;
    const detail = await collect(`healthDetail:${row.skuId}`, async () => {
      const response = await request('GET.sp-product.v0.health-infos._healthInfoId', { healthInfoId: Number(row.healthScoreId || row.skuId) });
      if (String(response.data?.skuId) !== String(row.skuId) || String(response.data?.productId) !== String(row.productId)) throw new Error('DATA_SCOPE_MISMATCH');
      if (!Array.isArray(response.data.improvementList)) throw new Error('INVALID_RESPONSE');
      return { rows: [response.data], complete: true };
    });
    if (detail.complete) row.improvementList = detail.rows[0].improvementList;
  }
  const datasets = {};
  const window = serviceWindow(timestamp);
  if (scope === 'full') {
    for (const [key, api, params, idKey] of [
      ['penalties', 'GET.sp-product.v0.penalty-infos', {}, 'penaltyId'],
      ['violations', 'GET.sp-product.v0.violating-products', {}, 'productId'],
      ['applies', 'GET.sp-product.v0.product-applies', { sortBy: 'created', sortType: 'asc', scopeSet: ['keeperStatus', 'productId'] }, null],
      ['orders', 'GET.sp-order.v0.orders', { orderStatus: 'WAIT_STOCK_OUT', startTime: timestamp - 30 * 86400000, endTime: timestamp, sortBy: 'createdTime', sortOrder: 'ASC', scopeSet: ['orderStatus', 'createdTime', 'paymentInfo'] }, 'orderId'],
      ['evaluations', 'GET.sp-support.v0.dongdong-waiter-evaluations', { ...window, sortOrder: 'ASC' }, null],
    ]) datasets[key] = await collect(key, () => readPages(request, api, params, { pageSize: key === 'evaluations' ? 20 : 50, maxItems: 30000, idKey }));
    datasets.appliesPending = await collect('appliesPending', () => readPages(request, 'GET.sp-product.v0.product-applies', {
      sortBy: 'created', sortType: 'asc', scopeSet: ['keeperStatus', 'productId'],
      statusList: [0, 100, 109], modifiedEndTime: timestamp - 24 * 3600000,
    }, { pageSize: 50, maxItems: 30000, idKey: null }));
    datasets.service = await collect('service', async () => {
      const waiters = await readPages(request, 'GET.sp-support.v0.dongdong-waiters', {}, { pageSize: 100, maxItems: 1000, idKey: 'waiter' });
      const waiterList = waiters.rows.filter(row => Number(row.yn) === 1 && row.waiter).map(row => String(row.waiter));
      if (!waiterList.length) return { rows: [], complete: true };
      const performanceRows = [];
      for (const batch of chunks(waiterList, 10)) {
        const response = await request('GET.sp-support.v0.dongdong-waiter-performance', { waiterList: batch, ...window });
        if (!Array.isArray(response.data)) throw new Error('INVALID_RESPONSE');
        performanceRows.push(...response.data);
      }
      return { rows: performanceRows, complete: true };
    });
  }
  const selectedComplete = sources.products.status === 'ok' && products.length === inventory.rows.length && products.every(product => sources[`skus:${product.productId}`]?.complete === true);
  const inventoryComplete = inventory.complete && selectedComplete;
  const metricCoverageComplete = selectedComplete && (scope === 'sample' || inventory.complete);
  const findings = TITLES.map((title, index) => ({ code: `R${String(index + 1).padStart(2, '0')}`, title, status: 'not_checked', triggered: null, actual: null, priority: [5, 8].includes(index) ? 'P0' : index === 3 ? 'P2' : 'P1', message: '抽样模式不检查此店铺级指标。', sources: [] }));
  const put = (code, result, available, sourceNames, complete = true) => {
    const finding = findings.find(item => item.code === code);
    finding.sources = sourceNames;
    if (!available || !result) {
      Object.assign(finding, { status: 'unavailable', message: '数据缺失或读取失败，不能判定正常。' });
      return;
    }
    Object.assign(finding, { status: complete ? (result.triggered ? 'issue' : 'clear') : 'partial', triggered: Boolean(result.triggered), actual: result.actual, threshold: result.threshold, message: result.message, evidence: result.details || result.summary || {} });
    if (!complete) finding.message = `仅已读取数据：${finding.message} 数据覆盖不完整，不能外推未读取部分。`;
  };
  if (scope === 'full') put('R01', rules.evaluateProductCount(inventory.rows.length), sources.products.status === 'ok', ['products'], inventory.complete);
  const healthIds = new Set(health.rows.map(row => String(row.skuId)));
  const healthEvidence = health.rows.filter(row => Array.isArray(row.improvementList) && numberOrNull(row.healthScore) !== null);
  const healthValid = sources.health.status === 'ok' && (healthEvidence.length > 0 || inventory.rows.length === 0);
  const healthComplete = metricCoverageComplete && healthEvidence.length === health.rows.length && [...skuIds].every(identifier => healthIds.has(identifier));
  const unhealthy = healthEvidence.filter(row => Number(row.healthScore) < 100 || row.improvementList.length > 0);
  const healthSummary = { ...summaries.summarizeHealthRecords(healthEvidence), issueCount: unhealthy.length, affectedProductCount: new Set(unhealthy.map(row => String(row.productId))).size };
  put('R02', rules.evaluateHealthSummary(healthSummary), healthValid, ['health'], healthComplete);
  if (healthValid) {
    const evidence = findings.find(item => item.code === 'R02').evidence;
    evidence.healthItemsComplete = healthComplete;
    evidence.healthItems = unhealthy.map(row => ({ skuId: String(row.skuId), productId: String(row.productId), healthScore: numberOrNull(row.healthScore), issues: row.improvementList.map(item => {
      const detail = item.improvementDetail || item;
      return { code: String(detail.troubleCode || detail.code || '').slice(0, 100), name: String(detail.troubleName || detail.name || '').slice(0, 200) };
    }) }));
  }
  const allSkus = products.flatMap(product => product.skus);
  const priceKnown = allSkus.filter(sku => sku.priceStar !== null || ['bad', 'avg', 'good', 'excellent'].includes(sku.competitivePower));
  put('R03', rules.evaluatePriceCompetitiveness(products, summaries.summarizePriceRecords(prices.rows)), sources.prices.status === 'ok' && (priceKnown.length > 0 || inventory.rows.length === 0), ['products', 'prices'], metricCoverageComplete && priceKnown.length === allSkus.length);
  const knownSales = products.filter(product => product.sales30d !== null);
  const zeroSales = knownSales.filter(product => product.sales30d === 0);
  put('R04', { ...rules.evaluateLowSales(products), actual: zeroSales.length, triggered: zeroSales.length > 0, message: `已读商品中，${zeroSales.length} 个在售商品近30天销量明确为0；${products.length - knownSales.length} 个销量未知。` }, knownSales.length > 0 || (inventory.complete && !inventory.rows.length), ['products'], metricCoverageComplete && knownSales.length === products.length);
  const stockRule = rules.evaluateOutOfStock(products);
  stockRule.message = `已读商品中，${stockRule.actual} 个零库存规格所属商品近30天有销量；商品动销不等于该规格有销量。`;
  put('R05', stockRule, sources.stocks.status === 'ok' && knownSales.length === products.length && (allSkus.some(sku => sku.stock !== null) || !inventory.rows.length), ['products', 'stocks'], metricCoverageComplete && allSkus.every(sku => sku.stock !== null));
  const materialRows = health.rows.filter(row => (row.improvementList || []).some(item => MATERIAL_FACTORS.has(String((item.improvementDetail || item).troubleCode || ''))));
  put('R11', { actual: materialRows.length, threshold: 0, triggered: materialRows.length > 0, message: `官方健康诊断中，${materialRows.length} 个SKU有素材待优化项；不代表素材绑定齐全或审核通过。`, details: { skuIds: materialRows.map(row => String(row.skuId)), factorScope: [...MATERIAL_FACTORS] } }, healthValid && (health.rows.length > 0 || inventory.rows.length === 0), ['health'], healthComplete && !healthEvidence.some(row => Number(row.healthScore) < 100 && row.improvementList.length === 0));
  if (scope === 'full') {
    const activePenalties = datasets.penalties.rows.filter(row => Number(row.effectStatus) !== 2);
    const penaltySummary = { ...summaries.summarizePenaltyRecords(datasets.penalties.rows), total: activePenalties.length, seriousCount: activePenalties.filter(row => Number(row.illegalLevel) === 1).length };
    put('R06', rules.evaluatePenalties(penaltySummary), sources.penalties.status === 'ok', ['penalties']);
    put('R07', rules.evaluateFulfillment(summaries.summarizeFulfillment(datasets.orders.rows, timestamp)), sources.orders.status === 'ok', ['orders'], datasets.orders.rows.every(row => numberOrNull(row.createdTime) > 0));
    put('R08', rules.evaluateService(summaries.summarizeService(datasets.service.rows, window)), sources.service.status === 'ok', ['service'], datasets.service.rows.every(row => numberOrNull(row.unReplyCount) !== null));
    const violationSummary = summaries.summarizeViolatingProducts(datasets.violations.rows);
    violationSummary.pendingCount = datasets.violations.rows.filter(row => String(row.rectificationStatus ?? '1') !== '0').length;
    put('R09', rules.evaluateViolatingProducts(violationSummary), sources.violations.status === 'ok', ['violations']);
    const appliesSummary = summaries.summarizeProductApplies(datasets.applies.rows, timestamp);
    const pendingStatusRows = datasets.applies.rows.filter(row => [0, 100, 109].includes(numberOrNull(row.pushStatus ?? row.status ?? row.keeperStatus)));
    const pendingCoverage = datasets.appliesPending.status === 'ok' && datasets.appliesPending.complete;
    if (pendingCoverage) {
      appliesSummary.pendingCount = datasets.appliesPending.reportedTotal ?? datasets.appliesPending.rows.length;
      appliesSummary.productIds = [...new Set([...(appliesSummary.productIds || []), ...datasets.appliesPending.rows.map(row => String(row.productId))])];
    }
    const auditCoverage = datasets.applies.rows.every(row => numberOrNull(row.pushStatus ?? row.status ?? row.keeperStatus) !== null) && (!pendingStatusRows.length || pendingCoverage);
    put('R10', rules.evaluateProductApplies(appliesSummary), sources.applies.status === 'ok', ['applies', 'appliesPending'], auditCoverage);
    const evaluationSummary = summaries.summarizeServiceEvaluations(datasets.evaluations.rows, window);
    if (!datasets.evaluations.rows.length) evaluationSummary.satisfactionRate = null;
    put('R12', rules.evaluateServiceEvaluations(evaluationSummary), sources.evaluations.status === 'ok', ['evaluations'], datasets.evaluations.rows.every(row => numberOrNull(row.degree) !== null));
  }
  const partial = Boolean(stopReason) || failures.length > 0 || findings.some(item => ['unavailable', 'partial'].includes(item.status));
  return { schemaVersion: 1, skillVersion: SKILL_VERSION, source: 'official-jdo-cli', readOnly: true, status: partial ? 'partial' : scope === 'sample' ? 'sampled' : 'complete', startedAt, finishedAt: now().toISOString(), shop, profile,
    scope: { kind: scope, wholeStore: scope === 'full' && inventoryComplete, requestedProductLimit: scope === 'sample' ? limit : null, inspectedProducts: products.length, inspectedSkus: skuIds.size, reportedOnSaleProducts: inventory.reportedTotal, inventoryComplete, pendingOrdersWindowDays: 30, customerServiceWindow: window },
    findings, products, sources, failures, stopReason, requestCount: audit.length, audit,
    limitations: ['只读诊断，不生成或派发任务，不执行整改。', '分页为本次采集时点，不是平台原子快照；数据变化时应重跑核对。', '未读取的字段和不完整结果不视为正常。', '素材诊断仅使用官方健康问题因子，不替代逐素材槽位审核。', '待出库诊断仅覆盖最近30天创建的待出库订单。'] };
}

function compareWithBaseline(report, baseline) {
  if (!baseline?.shop?.shopId || String(baseline.shop.shopId) !== String(report.shop.shopId)) throw new Error('BASELINE_SHOP_MISMATCH');
  const baselineFindings = new Map(baseline.findings.map(item => [item.code, item]));
  const changes = report.findings.map(finding => {
    const previous = baselineFindings.get(finding.code);
    const wasIssue = previous?.status === 'issue';
    const isIssue = finding.status === 'issue';
    const isUnread = ['unavailable', 'partial', 'not_checked'].includes(finding.status);
    let change = 'unchanged';
    if (isIssue && wasIssue) change = 'continued';
    else if (isIssue && !wasIssue) change = 'new';
    else if (!isIssue && wasIssue) change = isUnread ? 'inconclusive' : 'resolved';
    return { code: finding.code, title: finding.title, from: previous?.status ?? 'missing', to: finding.status, change };
  });
  const summary = {
    new: changes.filter(item => item.change === 'new').length,
    continued: changes.filter(item => item.change === 'continued').length,
    resolved: changes.filter(item => item.change === 'resolved').length,
    inconclusive: changes.filter(item => item.change === 'inconclusive').length,
  };
  return { baselineStartedAt: baseline.startedAt, baselineScope: baseline.scope?.kind ?? null, changes, summary };
}

function formatMarkdown(report, baselineSummary = null) {
  const escape = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
  const statuses = { issue: '发现问题', clear: '已读范围未发现问题', partial: '覆盖不完整', unavailable: '未完成', not_checked: '本次未检查' };
  const actions = report.findings.filter(item => item.status === 'issue' || (item.status === 'partial' && item.triggered));
  const actionLines = actions.length ? [
    '', '## 行动清单（建议承接 Skill）', '',
    ...actions.map(item => `- **${item.code} ${item.title}**：${ACTIONS[item.code]}`),
    '', '- 跨 Skill 的统一调度由「黑灯运营智能体」总调度 Skill 安排；本清单只是建议，不等于已派发或已授权平台写入。',
  ] : ['', '## 行动清单', '', '- 本次已读范围未触发需要整改的问题。'];
  const recheckLines = baselineSummary ? [
    '', `## 复检对比（基线：${baselineSummary.baselineStartedAt}，${baselineSummary.baselineScope === 'full' ? '全店' : '抽样'}）`, '',
    ...baselineSummary.changes.filter(item => item.change !== 'unchanged').map(item => `- ${item.code} ${item.title}：${
      { new: '新增问题', continued: '持续存在', resolved: '本次已读范围未再触发（已恢复）', inconclusive: '本次数据覆盖不完整，无法判定' }[item.change]
    }（${item.from} → ${item.to}）`),
    '', `- 汇总：新增 ${baselineSummary.summary.new}、持续 ${baselineSummary.summary.continued}、已恢复 ${baselineSummary.summary.resolved}、无法判定 ${baselineSummary.summary.inconclusive}。`,
    '', '- 「已恢复」只表示本次已读数据不再触发该规则，不是对整改与销量恢复的因果归因。',
  ] : [];
  return [`# POP店铺官方巡检诊断（R01-R12）`, '', `店铺：${escape(report.shop.shopName)}（${report.shop.shopId}，venderId ${escape(report.shop.venderId)}）`, `采集时间：${report.startedAt} → ${report.finishedAt}`, `范围：${report.scope.kind === 'sample' ? '抽样，不能代表全店' : report.scope.wholeStore ? '全店在售商品已遍历；各诊断域覆盖见明细' : '全店巡检未完成'}`, `已读：${report.scope.inspectedProducts} 个商品 / ${report.scope.inspectedSkus} 个规格；请求 ${report.requestCount} 次。`, '', '| 诊断项 | 状态 | 数量 | 结论 |', '|---|---|---:|---|', ...report.findings.map(item => `| ${item.code} ${item.title} | ${statuses[item.status]} | ${item.actual ?? '未知'} | ${escape(item.message)} |`), ...actionLines, ...recheckLines, '', '## 失败清单', ...report.failures.map(item => `- ${item.source}: ${item.errorCode}`), ...(report.failures.length ? [] : ['- 无请求或分页失败。']), '', '## 边界与说明', ...report.limitations.map(item => `- ${item}`), ''].join('\n');
}

module.exports = { runInspection, formatMarkdown, compareWithBaseline, readPages, createOfficialInvoker, readIdentity, ACTIONS, SKILL_VERSION };
