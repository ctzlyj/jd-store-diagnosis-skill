const PRODUCT_COUNT_THRESHOLD = 20;
const {
  buildNextBestActions,
  normalizeAdvertisingSummary,
  normalizeBusinessSummary,
  normalizeFieldDiagnosticSummary,
  normalizeLogisticsSummary,
  normalizeMaterialOperationSummary,
  normalizeMemberSummary,
} = require('./growth-opportunities.cjs');
const MAX_PRODUCTS_PER_SYNC = 5000;
const MAX_SKUS_PER_PRODUCT = 500;
const PRODUCT_ACTIONS = Object.freeze([
  { id: 'supply-image', label: '一键补充商品（上传主图）', url: 'https://image.ctikki.com/', kind: 'primary' },
  { id: 'category-hot', label: '查看类目站内爆品', url: 'https://jdsz.jd.com/szweb/view/industry/industry-product-rank-temp.html?sz=%2Fszweb%2Fsz%2Fview%2FindustryMarket%2FproductRanks.html', kind: 'secondary' },
  { id: 'competitor-ai', label: '查看竞对热销品（AI）', url: 'https://ncz.jd.com/business-agent', kind: 'secondary' },
]);

function cleanString(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function cleanNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanNonNegativeNumber(value) {
  const number = cleanNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function cleanDate(value) {
  const text = cleanString(value, 40);
  return text || null;
}

function normalizeExperimentSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  if (summary.available !== true) {
    return { available: false, errorCode: cleanString(summary.errorCode, 100) || 'MATERIAL_EXPERIMENTS_UNAVAILABLE', items: [] };
  }
  const items = (Array.isArray(summary.items) ? summary.items : []).slice(0, 100).map((item) => ({
    id: cleanString(item?.id, 64),
    productId: cleanString(item?.productId, 64),
    skuId: cleanString(item?.skuId, 64),
    name: cleanString(item?.name, 100),
    status: Math.max(0, Number.parseInt(item?.status, 10) || 0),
    experimentType: Math.max(0, Number.parseInt(item?.experimentType, 10) || 0),
    expectedStartTime: cleanDate(item?.expectedStartTime),
    expectedEndTime: cleanDate(item?.expectedEndTime),
    reason: cleanString(item?.reason, 300),
  })).filter((item) => item.id);
  return {
    available: true,
    total: items.length,
    runningCount: items.filter((item) => item.status === 3).length,
    endedCount: items.filter((item) => item.status === 4).length,
    items,
  };
}

function evaluateProductCount(actualCount) {
  const actual = Math.max(0, Number.parseInt(actualCount, 10) || 0);
  const gap = Math.max(0, PRODUCT_COUNT_THRESHOLD - actual);
  const triggered = actual < PRODUCT_COUNT_THRESHOLD;
  const message = triggered
    ? `你的店铺当前只有 ${actual} 个售卖中 SPU，低于基础经营要求 ${PRODUCT_COUNT_THRESHOLD} 个 SPU。商品供给不足，会导致店铺能够获得曝光和成交的商品太少，后续活动、广告和自然流量都很难有效放大。建议至少再发布 ${gap} 个 SPU，先把基础商品供给补齐。`
    : `当前有 ${actual} 个售卖中 SPU，已达到基础经营要求。`;

  return {
    code: 'R01',
    actual,
    threshold: PRODUCT_COUNT_THRESHOLD,
    gap,
    triggered,
    message,
    task: triggered ? {
      title: '补充店铺商品供给',
      priority: 'P1',
      status: '待处理',
      cta: PRODUCT_ACTIONS[0].label,
      ctaUrl: PRODUCT_ACTIONS[0].url,
      secondaryCta: PRODUCT_ACTIONS[1].label,
      secondaryUrl: PRODUCT_ACTIONS[1].url,
      actions: PRODUCT_ACTIONS.map((action) => ({ ...action })),
    } : null,
  };
}

function evaluateHealthSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  const total = Math.max(0, Number.parseInt(summary.total, 10) || 0);
  const issueCount = Math.max(0, Number.parseInt(summary.issueCount, 10) || 0);
  const affectedProductCount = Math.max(0, Number.parseInt(summary.affectedProductCount, 10) || 0);
  const averageScore = cleanNonNegativeNumber(summary.averageScore);
  const issues = Array.isArray(summary.issues) ? summary.issues.slice(0, 20).map((issue) => ({
    code: cleanString(issue?.code, 100),
    name: cleanString(issue?.name, 200),
    count: Math.max(0, Number.parseInt(issue?.count, 10) || 0),
  })).filter((issue) => issue.code || issue.name) : [];
  const topIssue = issues[0];
  return {
    code: 'R02',
    actual: issueCount,
    threshold: 0,
    triggered: issueCount > 0,
    message: issueCount > 0
      ? `官方商品健康诊断发现 ${issueCount} 个 SKU 待优化，涉及 ${affectedProductCount} 个 SPU${topIssue?.name ? `，首要问题是“${topIssue.name}”` : ''}。`
      : `官方商品健康诊断覆盖 ${total} 个 SKU，当前未发现待优化项。`,
    summary: { total, issueCount, affectedProductCount, averageScore, issues },
    details: { affectedProductCount, averageScore, issues },
  };
}

function evaluatePriceCompetitiveness(products, summary, opportunitySummary) {
  const affected = [];
  for (const product of products || []) {
    const skuIds = (product.skus || []).filter((sku) => (sku.priceStar !== null && sku.priceStar <= 3) || ['bad', 'avg'].includes(sku.competitivePower)).map((sku) => sku.skuId);
    if (skuIds.length) affected.push({ productId: product.productId, sales30d: product.sales30d, skuIds });
  }
  affected.sort((left, right) => (right.sales30d ?? -1) - (left.sales30d ?? -1) || left.productId.localeCompare(right.productId));
  const affectedSkuIds = affected.flatMap((item) => item.skuIds).slice(0, 500);
  const actual = Math.max(affectedSkuIds.length, Number.parseInt(summary?.lowCount, 10) || 0);
  const officialSuggestionAvailable = opportunitySummary?.available === true;
  const suggestedPriceEligibleCount = Math.max(0, Number.parseInt(opportunitySummary?.eligibleCount, 10) || 0);
  const suggestedPriceCoveredCount = Math.max(0, Number.parseInt(opportunitySummary?.coveredCount, 10) || 0);
  const targetStars = officialSuggestionAvailable && opportunitySummary?.targetStars && typeof opportunitySummary.targetStars === 'object'
    ? Object.fromEntries(Object.entries(opportunitySummary.targetStars).filter(([star]) => /^[1-5]$/.test(star)).map(([star, count]) => [star, Math.max(0, Number.parseInt(count, 10) || 0)]))
    : {};
  const benefitPoints = officialSuggestionAvailable && Array.isArray(opportunitySummary?.benefitPoints)
    ? opportunitySummary.benefitPoints.slice(0, 10).map((item) => ({ text: cleanString(item?.text, 100), count: Math.max(0, Number.parseInt(item?.count, 10) || 0) })).filter((item) => item.text)
    : [];
  const targetStarText = Object.keys(targetStars).sort((left, right) => Number(right) - Number(left)).map((star) => `${star} 星`).join('、');
  const suggestionText = officialSuggestionAvailable
    ? ` 官方建议价已覆盖 ${suggestedPriceCoveredCount}/${suggestedPriceEligibleCount} 个待优化 SKU${targetStarText ? `，目标 ${targetStarText}` : ''}${benefitPoints[0]?.text ? `，${benefitPoints[0].text}` : ''}。`
    : '';
  return {
    code: 'R03', actual, threshold: 0, triggered: actual > 0, priority: 'P1',
    message: actual ? `官方价格竞争力诊断发现 ${actual} 个 1-3 星或竞争力偏低 SKU，建议优先处理有销量商品。${suggestionText}` : '官方价格竞争力诊断未发现待优化 SKU。',
    details: {
      affectedProductIds: affected.map((item) => item.productId).slice(0, 100),
      skuIds: affectedSkuIds,
      prioritizedProductId: affected[0]?.productId || '',
      total: Math.max(0, Number.parseInt(summary?.total, 10) || 0),
      officialSuggestionAvailable,
      suggestedPriceEligibleCount,
      suggestedPriceCoveredCount,
      targetStars,
      benefitPoints,
      ...(opportunitySummary?.available === false ? { suggestionErrorCode: cleanString(opportunitySummary.errorCode, 80) } : {}),
    },
  };
}

function evaluateFulfillment(summary) {
  const available = summary?.available === true;
  if (!available) {
    return {
      code: 'R07', actual: 0, threshold: 0, triggered: false, priority: 'P1',
      message: '官方履约数据暂未获取。',
      details: { available: false, errorCode: cleanString(summary?.errorCode, 80) || 'FULFILLMENT_UNAVAILABLE' },
    };
  }
  const details = {
    available: true,
    totalOrders: Math.max(0, Number.parseInt(summary.totalOrders, 10) || 0),
    totalAmount: cleanNonNegativeNumber(summary.totalAmount) || 0,
    over24HourOrders: Math.max(0, Number.parseInt(summary.over24HourOrders, 10) || 0),
    over24HourAmount: cleanNonNegativeNumber(summary.over24HourAmount) || 0,
    over48HourOrders: Math.max(0, Number.parseInt(summary.over48HourOrders, 10) || 0),
    over48HourAmount: cleanNonNegativeNumber(summary.over48HourAmount) || 0,
    longestWaitHours: cleanNonNegativeNumber(summary.longestWaitHours) || 0,
  };
  return {
    code: 'R07', actual: details.over24HourOrders, threshold: 0, triggered: details.over24HourOrders > 0, priority: 'P1',
    message: details.over24HourOrders
      ? `发现 ${details.over24HourOrders} 笔待出库订单已超过 24 小时，其中 ${details.over48HourOrders} 笔超过 48 小时，最长等待 ${details.longestWaitHours} 小时。`
      : `当前 ${details.totalOrders} 笔待出库订单均未超过 24 小时。`,
    details,
  };
}

function evaluateService(summary) {
  const available = summary?.available === true;
  if (!available) {
    return {
      code: 'R08', actual: 0, threshold: 0, triggered: false, priority: 'P1',
      message: '官方客服数据暂未获取。',
      details: { available: false, errorCode: cleanString(summary?.errorCode, 80) || 'SERVICE_UNAVAILABLE' },
    };
  }
  const details = {
    available: true,
    startTime: cleanDate(summary.startTime),
    endTime: cleanDate(summary.endTime),
    consultCount: Math.max(0, Number.parseInt(summary.consultCount, 10) || 0),
    replyCount: Math.max(0, Number.parseInt(summary.replyCount, 10) || 0),
    unReplyCount: Math.max(0, Number.parseInt(summary.unReplyCount, 10) || 0),
    replyRate: cleanNonNegativeNumber(summary.replyRate) || 0,
    avgWaitTime: cleanNonNegativeNumber(summary.avgWaitTime) || 0,
    evaluationCount: Math.max(0, Number.parseInt(summary.evaluationCount, 10) || 0),
  };
  return {
    code: 'R08', actual: details.unReplyCount, threshold: 0, triggered: details.unReplyCount > 0, priority: 'P1',
    message: details.unReplyCount
      ? `近 7 个完整自然日有 ${details.unReplyCount} 次咨询未回复，回复率 ${details.replyRate}%，平均等待 ${details.avgWaitTime} 秒。`
      : `近 7 个完整自然日咨询回复率 ${details.replyRate}%，未发现漏接。`,
    details,
  };
}

function unavailableRule(code, priority, message, errorCode) {
  return { code, actual: 0, threshold: 0, triggered: false, priority, message, details: { available: false, errorCode: cleanString(errorCode, 100) } };
}

function evaluateViolatingProducts(summary) {
  if (!summary || summary.available !== true) return unavailableRule('R09', 'P0', '官方违规商品数据暂未获取。', summary?.errorCode || 'VIOLATIONS_UNAVAILABLE');
  const pendingCount = Math.max(0, Number.parseInt(summary.pendingCount ?? summary.total, 10) || 0);
  const productIds = Array.isArray(summary.productIds) ? [...new Set(summary.productIds.map((value) => cleanString(value, 64)).filter(Boolean))].slice(0, 200) : [];
  const items = Array.isArray(summary.items) ? summary.items.slice(0, 100).map((item) => ({
    productId: cleanString(item?.productId, 64),
    reason: cleanString(item?.reason, 300),
    level: cleanString(item?.level, 80),
    rectificationStatus: cleanString(item?.rectificationStatus, 80),
    remainDate: cleanDate(item?.remainDate),
  })).filter((item) => item.productId) : [];
  return {
    code: 'R09', actual: pendingCount, threshold: 0, triggered: pendingCount > 0, priority: 'P0',
    message: pendingCount ? `官方发现 ${pendingCount} 个违规或待整改商品，请优先处理以避免持续下架或扣分。` : '官方未发现待整改违规商品。',
    details: { available: true, total: Math.max(0, Number.parseInt(summary.total, 10) || 0), pendingCount, productIds, items },
  };
}

function evaluateProductApplies(summary) {
  if (!summary || summary.available !== true) return unavailableRule('R10', 'P1', '商品审核状态暂未获取。', summary?.errorCode || 'PRODUCT_APPLIES_UNAVAILABLE');
  const rejectedCount = Math.max(0, Number.parseInt(summary.rejectedCount, 10) || 0);
  const pendingCount = Math.max(0, Number.parseInt(summary.pendingCount, 10) || 0);
  const actual = rejectedCount + pendingCount;
  const productIds = Array.isArray(summary.productIds) ? [...new Set(summary.productIds.map((value) => cleanString(value, 64)).filter(Boolean))].slice(0, 200) : [];
  return {
    code: 'R10', actual, threshold: 0, triggered: actual > 0, priority: rejectedCount ? 'P0' : 'P1',
    message: actual ? `商品申请中有 ${rejectedCount} 个审核驳回、${pendingCount} 个长时间待审核，需要跟进。` : '商品新增与修改申请状态正常。',
    details: { available: true, total: Math.max(0, Number.parseInt(summary.total, 10) || 0), rejectedCount, pendingCount, productIds },
  };
}

function evaluateMaterialCoverage(summary) {
  if (!summary || summary.available !== true) return unavailableRule('R11', 'P1', 'SKU 素材覆盖数据暂未获取。', summary?.errorCode || 'MATERIALS_UNAVAILABLE');
  const incompleteSkuCount = Math.max(0, Number.parseInt(summary.incompleteSkuCount, 10) || 0);
  const skuIds = Array.isArray(summary.skuIds) ? [...new Set(summary.skuIds.map((value) => cleanString(value, 64)).filter(Boolean))].slice(0, 500) : [];
  const productIds = Array.isArray(summary.productIds) ? [...new Set(summary.productIds.map((value) => cleanString(value, 64)).filter(Boolean))].slice(0, 200) : [];
  const missingCounts = summary.missingCounts && typeof summary.missingCounts === 'object'
    ? Object.fromEntries(Object.entries(summary.missingCounts).slice(0, 20).map(([key, value]) => [cleanString(key, 60), Math.max(0, Number.parseInt(value, 10) || 0)])) : {};
  return {
    code: 'R11', actual: incompleteSkuCount, threshold: 0, triggered: incompleteSkuCount > 0, priority: 'P1',
    message: incompleteSkuCount ? `有 ${incompleteSkuCount} 个 SKU 缺少关键商品素材，涉及 ${Math.max(0, Number.parseInt(summary.affectedProductCount, 10) || 0)} 个 SPU。` : '重点 SKU 关键素材已覆盖。',
    details: { available: true, totalSkuCount: Math.max(0, Number.parseInt(summary.totalSkuCount, 10) || 0), incompleteSkuCount, affectedProductCount: Math.max(0, Number.parseInt(summary.affectedProductCount, 10) || 0), skuIds, productIds, missingCounts },
  };
}

function evaluateServiceEvaluations(summary) {
  if (!summary || summary.available !== true) return unavailableRule('R12', 'P1', '客服满意度数据暂未获取。', summary?.errorCode || 'SERVICE_EVALUATIONS_UNAVAILABLE');
  const evaluationCount = Math.max(0, Number.parseInt(summary.evaluationCount, 10) || 0);
  const lowScoreCount = Math.max(0, Number.parseInt(summary.lowScoreCount, 10) || 0);
  const satisfactionRate = cleanNonNegativeNumber(summary.satisfactionRate);
  const labels = Array.isArray(summary.labels) ? summary.labels.slice(0, 20).map((item) => ({ label: cleanString(item?.label, 100), count: Math.max(0, Number.parseInt(item?.count, 10) || 0) })).filter((item) => item.label) : [];
  return {
    code: 'R12', actual: lowScoreCount, threshold: 0, triggered: lowScoreCount > 0, priority: 'P1',
    message: lowScoreCount ? `最近完整 7 天有 ${lowScoreCount} 次低分客服评价${satisfactionRate === null ? '' : `，满意率 ${satisfactionRate}%`}。` : `最近完整 7 天客服评价无低分${satisfactionRate === null ? '' : `，满意率 ${satisfactionRate}%`}。`,
    details: { available: true, evaluationCount, lowScoreCount, satisfactionRate, labels },
  };
}

function evaluateLowSales(products) {
  const productIds = (products || []).filter((product) => product.sales30d === 0).map((product) => product.productId).slice(0, 100);
  const unavailableCount = (products || []).filter((product) => product.sales30d === null).length;
  return {
    code: 'R04', actual: productIds.length, threshold: 0, triggered: productIds.length > 0, priority: 'P2',
    message: productIds.length ? `发现 ${productIds.length} 个在售 SPU 近 30 天销量明确为 0，建议结合价格和商品质量逐一诊断；另有 ${unavailableCount} 个 SPU 销量数据未返回，不计入零动销。` : `未发现官方明确返回 30 天零销量的在售 SPU；${unavailableCount} 个 SPU 数据未返回。`,
    details: { productIds, unavailableCount },
  };
}

function evaluateOutOfStock(products) {
  const rows = [];
  for (const product of products || []) {
    if (!(product.sales30d > 0)) continue;
    for (const sku of product.skus || []) if (sku.stock === 0) rows.push({ productId: product.productId, skuId: sku.skuId, sales30d: product.sales30d });
  }
  rows.sort((left, right) => right.sales30d - left.sales30d || left.skuId.localeCompare(right.skuId));
  return {
    code: 'R05', actual: rows.length, threshold: 0, triggered: rows.length > 0, priority: 'P1',
    message: rows.length ? `发现 ${rows.length} 个有近 30 天销量的在售 SKU 库存为 0，可能损失成交机会。` : '未发现有销量商品的明确零库存 SKU。',
    details: { skuIds: rows.map((row) => row.skuId).slice(0, 500), productIds: [...new Set(rows.map((row) => row.productId))].slice(0, 100) },
  };
}

function evaluatePenalties(summary) {
  const items = Array.isArray(summary?.items) ? summary.items.slice(0, 100).map((item) => ({
    penaltyId: cleanString(item?.penaltyId, 64), level: Math.max(0, Number.parseInt(item?.level, 10) || 0), reason: cleanString(item?.reason, 300),
    url: /^https:\/\/[^/]*\.jd\.com\//i.test(cleanString(item?.url, 1000)) ? cleanString(item.url, 1000) : '',
    productIds: Array.isArray(item?.productIds) ? item.productIds.map((id) => cleanString(id, 64)).filter(Boolean).slice(0, 50) : [],
  })).filter((item) => item.penaltyId) : [];
  const actual = Math.max(items.length, Number.parseInt(summary?.total, 10) || 0);
  const seriousCount = Math.max(items.filter((item) => item.level === 1).length, Number.parseInt(summary?.seriousCount, 10) || 0);
  return {
    code: 'R06', actual, threshold: 0, triggered: actual > 0, priority: 'P0',
    message: actual ? `发现 ${actual} 个有效商品违规违约单，其中严重违规 ${seriousCount} 个，请优先处理。` : '当前未发现有效商品违规违约单。',
    details: { seriousCount, items },
  };
}

function normalizeSku(input, productId) {
  const skuId = cleanString(input?.skuId || input?.id || input?.skuCode, 64);
  if (!skuId) return null;
  return {
    skuId,
    skuCode: cleanString(input.skuCode, 100),
    productId,
    title: cleanString(input.title || input.skuName),
    imageUrl: cleanString(input.imageUrl || input.image, 1000),
    status: cleanString(input.status, 40) || 'ON_SALE',
    stock: cleanNumber(input.stock),
    price: cleanNumber(input.price),
    realPrice: cleanNonNegativeNumber(input.realPrice),
    priceStar: cleanNonNegativeNumber(input.priceStar),
    competitivePower: cleanString(input.competitivePower, 30),
    healthScore: cleanNonNegativeNumber(input.healthScore),
    healthIssues: Array.isArray(input.healthIssues) ? input.healthIssues.slice(0, 20).map((issue) => ({ code: cleanString(issue?.code, 100), name: cleanString(issue?.name, 200) })).filter((issue) => issue.code || issue.name) : [],
  };
}

function normalizeProduct(input) {
  const productId = cleanString(input?.productId || input?.wareId || input?.spuId, 64);
  if (!productId) return null;
  const skuMap = new Map();
  const sourceSkus = Array.isArray(input.skus) ? input.skus.slice(0, MAX_SKUS_PER_PRODUCT) : [];
  for (const sourceSku of sourceSkus) {
    const sku = normalizeSku(sourceSku, productId);
    if (sku && !skuMap.has(sku.skuId)) skuMap.set(sku.skuId, sku);
  }
  return {
    productId,
    wareId: cleanString(input.wareId || productId, 64),
    title: cleanString(input.title || input.productName),
    imageUrl: cleanString(input.imageUrl || input.image, 1000),
    categoryId: cleanString(input.categoryId, 64),
    categoryName: cleanString(input.categoryName, 200),
    status: cleanString(input.status, 40) || 'ON_SALE',
    totalStock: cleanNumber(input.totalStock ?? input.stock),
    minPrice: cleanNumber(input.minPrice ?? input.price),
    maxPrice: cleanNumber(input.maxPrice ?? input.price),
    onSaleAt: cleanDate(input.onSaleAt),
    createdAt: cleanDate(input.createdAt),
    modifiedAt: cleanDate(input.modifiedAt),
    sales30d: cleanNumber(input.sales30d),
    skus: [...skuMap.values()],
  };
}

function normalizeSyncPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('同步数据格式无效');
  const sourceShop = payload.shop || {};
  const shopId = cleanString(sourceShop.shopId || sourceShop.venderId, 64);
  if (!shopId) throw new TypeError('缺少京麦店铺 ID');
  const sourceProducts = Array.isArray(payload.products) ? payload.products : [];
  if (sourceProducts.length > MAX_PRODUCTS_PER_SYNC) {
    throw new RangeError(`单次最多同步 ${MAX_PRODUCTS_PER_SYNC} 个 SPU`);
  }

  const productMap = new Map();
  for (const sourceProduct of sourceProducts) {
    const product = normalizeProduct(sourceProduct);
    if (product && !productMap.has(product.productId)) productMap.set(product.productId, product);
  }
  const products = [...productMap.values()];

  const rule = evaluateProductCount(products.length);
  const healthRule = evaluateHealthSummary(payload.healthSummary);
  const priceRule = evaluatePriceCompetitiveness(products, payload.priceSummary, payload.officialPriceOpportunitySummary);
  const lowSalesRule = evaluateLowSales(products);
  const outOfStockRule = evaluateOutOfStock(products);
  const penaltyRule = evaluatePenalties(payload.penaltySummary);
  const fulfillmentRule = payload.fulfillmentSummary && typeof payload.fulfillmentSummary === 'object' ? evaluateFulfillment(payload.fulfillmentSummary) : null;
  const serviceRule = payload.serviceSummary && typeof payload.serviceSummary === 'object' ? evaluateService(payload.serviceSummary) : null;
  const violatingRule = payload.violatingSummary && typeof payload.violatingSummary === 'object' ? evaluateViolatingProducts(payload.violatingSummary) : null;
  const productApplyRule = payload.productApplySummary && typeof payload.productApplySummary === 'object' ? evaluateProductApplies(payload.productApplySummary) : null;
  const materialRule = payload.materialSummary && typeof payload.materialSummary === 'object' ? evaluateMaterialCoverage(payload.materialSummary) : null;
  const serviceEvaluationRule = payload.serviceEvaluationSummary && typeof payload.serviceEvaluationSummary === 'object' ? evaluateServiceEvaluations(payload.serviceEvaluationSummary) : null;
  const rules = [rule, ...(healthRule ? [healthRule] : []), priceRule, lowSalesRule, outOfStockRule, penaltyRule, ...(fulfillmentRule ? [fulfillmentRule] : []), ...(serviceRule ? [serviceRule] : []), ...(violatingRule ? [violatingRule] : []), ...(productApplyRule ? [productApplyRule] : []), ...(materialRule ? [materialRule] : []), ...(serviceEvaluationRule ? [serviceEvaluationRule] : [])];
  const businessSummary = normalizeBusinessSummary(payload.businessSummary);
  const fieldDiagnosticSummary = normalizeFieldDiagnosticSummary(payload.fieldDiagnosticSummary);
  const logisticsSummary = normalizeLogisticsSummary(payload.logisticsSummary);
  const materialOperationSummary = normalizeMaterialOperationSummary(payload.materialOperationSummary || (payload.materialSummary?.available === true ? { ...payload.materialSummary, runningExperimentCount: payload.experimentSummary?.runningCount } : payload.materialSummary));
  const advertisingSummary = normalizeAdvertisingSummary(payload.advertisingSummary);
  const memberSummary = normalizeMemberSummary(payload.memberSummary);
  const nextBestActions = buildNextBestActions({ products, businessSummary, fieldDiagnosticSummary, logisticsSummary, materialOperationSummary, advertisingSummary, memberSummary, priceOpportunitySummary: payload.officialPriceOpportunitySummary });
  return {
    source: cleanString(payload.source, 40),
    shop: {
      shopId,
      venderId: cleanString(sourceShop.venderId || shopId, 64),
      shopName: cleanString(sourceShop.shopName, 200) || `京麦店铺 ${shopId}`,
      account: cleanString(sourceShop.account, 200),
      logoUrl: cleanString(sourceShop.logoUrl, 1000),
    },
    products,
    healthSummary: healthRule?.summary || null,
    priceSummary: payload.priceSummary && typeof payload.priceSummary === 'object' ? { total: Math.max(0, Number.parseInt(payload.priceSummary.total, 10) || 0), lowCount: priceRule.actual } : null,
    penaltySummary: penaltyRule.details,
    experimentSummary: normalizeExperimentSummary(payload.experimentSummary),
    businessSummary,
    fieldDiagnosticSummary,
    logisticsSummary,
    materialOperationSummary,
    advertisingSummary,
    memberSummary,
    nextBestActions,
    rule,
    rules,
  };
}

module.exports = {
  MAX_PRODUCTS_PER_SYNC,
  PRODUCT_ACTIONS,
  PRODUCT_COUNT_THRESHOLD,
  evaluateHealthSummary,
  evaluateFulfillment,
  evaluateLowSales,
  evaluateOutOfStock,
  evaluatePenalties,
  evaluatePriceCompetitiveness,
  evaluateProductCount,
  evaluateService,
  evaluateServiceEvaluations,
  evaluateMaterialCoverage,
  evaluateProductApplies,
  evaluateViolatingProducts,
  normalizeProduct,
  normalizeExperimentSummary,
  normalizeSku,
  normalizeSyncPayload,
};
