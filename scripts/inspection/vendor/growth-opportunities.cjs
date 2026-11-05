const MAX_SKU_METRICS = 500;
const MAX_DIAGNOSTIC_ITEMS = 200;
function text(value, maxLength = 300) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLength);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function rate(current, previous) {
  const before = number(previous);
  if (before === 0) return number(current) === 0 ? 0 : null;
  return round(((number(current) - before) / before) * 100, 1);
}

function normalizeMetricWindow(source) {
  return {
    orderCount: Math.floor(number(source?.orderCount)),
    unitCount: Math.floor(number(source?.unitCount)),
    gmv: round(number(source?.gmv)),
    activeSkuCount: Math.floor(number(source?.activeSkuCount)),
  };
}

function normalizeBusinessSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'BUSINESS_SUMMARY_UNAVAILABLE');
  const current = normalizeMetricWindow(summary.current);
  const previous = normalizeMetricWindow(summary.previous);
  const skuMetrics = (Array.isArray(summary.skuMetrics) ? summary.skuMetrics : []).slice(0, MAX_SKU_METRICS).map((item) => ({
    skuId: text(item?.skuId, 64),
    productId: text(item?.productId, 64),
    orderCount: Math.floor(number(item?.orderCount)),
    unitCount: Math.floor(number(item?.unitCount)),
    gmv: round(number(item?.gmv)),
  })).filter((item) => item.skuId);
  return {
    available: true,
    startTime: text(summary.startTime, 40) || null,
    endTime: text(summary.endTime, 40) || null,
    previousStartTime: text(summary.previousStartTime, 40) || null,
    previousEndTime: text(summary.previousEndTime, 40) || null,
    current,
    previous,
    change: {
      orderRate: rate(current.orderCount, previous.orderCount),
      unitRate: rate(current.unitCount, previous.unitCount),
      gmvRate: rate(current.gmv, previous.gmv),
      activeSkuRate: rate(current.activeSkuCount, previous.activeSkuCount),
    },
    skuMetrics,
  };
}

function normalizeCapabilitySummary(summary, fallbackErrorCode) {
  if (!summary || summary.available !== true) {
    return { available: false, errorCode: text(summary?.errorCode, 100) || fallbackErrorCode };
  }
  return { available: true };
}

function normalizeFieldDiagnosticSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'FIELD_DIAGNOSTICS_UNAVAILABLE');
  const items = (Array.isArray(summary.items) ? summary.items : []).slice(0, MAX_DIAGNOSTIC_ITEMS).map((item) => ({
    productId: text(item?.productId, 64),
    skuId: text(item?.skuId, 64),
    healthScore: nullableNumber(item?.healthScore),
    fields: (Array.isArray(item?.fields) ? item.fields : []).slice(0, 20).map((field) => ({
      code: text(field?.code, 100),
      name: text(field?.name, 160),
      suggestion: text(field?.suggestion, 300),
      severity: text(field?.severity, 20),
    })).filter((field) => field.code || field.name),
  })).filter((item) => item.productId || item.skuId);
  return { available: true, issueCount: items.reduce((total, item) => total + item.fields.length, 0), affectedProductCount: new Set(items.map((item) => item.productId).filter(Boolean)).size, items };
}

function normalizeMaterialOperationSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'MATERIAL_OPERATIONS_UNAVAILABLE');
  const missingCounts = {};
  for (const [key, value] of Object.entries(summary.missingCounts || {})) {
    if (/^[A-Za-z0-9_-]{1,64}$/.test(key)) missingCounts[key] = Math.floor(number(value));
  }
  return {
    available: true,
    totalSkuCount: Math.floor(number(summary.totalSkuCount)),
    incompleteSkuCount: Math.floor(number(summary.incompleteSkuCount)),
    videoBoundSkuCount: Math.floor(number(summary.videoBoundSkuCount)),
    taggedSkuCount: Math.floor(number(summary.taggedSkuCount)),
    runningExperimentCount: Math.floor(number(summary.runningExperimentCount)),
    skuIds: (Array.isArray(summary.skuIds) ? summary.skuIds : []).slice(0, MAX_SKU_METRICS).map((item) => text(item, 64)).filter(Boolean),
    productIds: (Array.isArray(summary.productIds) ? summary.productIds : []).slice(0, MAX_DIAGNOSTIC_ITEMS).map((item) => text(item, 64)).filter(Boolean),
    missingCounts,
  };
}

function normalizeLogisticsSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'LOGISTICS_UNAVAILABLE');
  return {
    available: true,
    pendingShipmentCount: Math.floor(number(summary.pendingShipmentCount)),
    over24HourCount: Math.floor(number(summary.over24HourCount)),
    over48HourCount: Math.floor(number(summary.over48HourCount)),
    awaitingPickupCount: Math.floor(number(summary.awaitingPickupCount)),
    stalledCount: Math.floor(number(summary.stalledCount)),
    rejectedCount: Math.floor(number(summary.rejectedCount)),
  };
}

function normalizeAdvertisingSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'ADVERTISING_UNAVAILABLE');
  return {
    available: true,
    configured: summary.configured === true,
    accountCount: Math.floor(number(summary.accountCount)),
    balance: nullableNumber(summary.balance),
    cashBalance: nullableNumber(summary.cashBalance),
    awardBalance: nullableNumber(summary.awardBalance),
    commissionBalance: nullableNumber(summary.commissionBalance),
    balanceStatus: text(summary.balanceStatus, 30) || 'unknown',
  };
}

function normalizeMemberSummary(summary) {
  if (!summary || summary.available !== true) return normalizeCapabilitySummary(summary, 'MEMBERS_UNAVAILABLE');
  return {
    available: true,
    systemConfigured: summary.systemConfigured === true,
    memberCount: Math.floor(number(summary.memberCount)),
    transactingMemberCount: Math.floor(number(summary.transactingMemberCount)),
    repeatMemberCount: Math.floor(number(summary.repeatMemberCount)),
    dormantMemberCount: Math.floor(number(summary.dormantMemberCount)),
    totalOrderCount: Math.floor(number(summary.totalOrderCount)),
    totalOrderAmount: round(number(summary.totalOrderAmount)),
  };
}

function opportunity({ code, title, reason, priority, score, evidence, acceptance, productIds = [], skuIds = [], actionType }) {
  return {
    code,
    title,
    reason,
    priority,
    score: Math.min(100, Math.max(0, Math.round(score))),
    evidence: Array.isArray(evidence) ? evidence.map((item) => text(item, 160)).filter(Boolean).slice(0, 5) : [],
    acceptance,
    productIds: [...new Set(productIds.map((item) => text(item, 64)).filter(Boolean))].slice(0, 100),
    skuIds: [...new Set(skuIds.map((item) => text(item, 64)).filter(Boolean))].slice(0, MAX_SKU_METRICS),
    actionType,
    source: 'jdo-cli',
    available: true,
  };
}

function buildNextBestActions(input = {}) {
  const products = Array.isArray(input.products) ? input.products : [];
  const business = input.businessSummary?.available === true ? input.businessSummary : null;
  const skuBusiness = new Map((business?.skuMetrics || []).map((item) => [String(item.skuId), item]));
  const lowStock = [];
  const lowPrice = [];
  for (const product of products) {
    for (const sku of product.skus || []) {
      const sales = number(product.sales30d);
      const metric = skuBusiness.get(String(sku.skuId));
      if ((sales > 0 || number(metric?.unitCount) > 0) && nullableNumber(sku.stock) !== null && number(sku.stock) <= 2) lowStock.push({ product, sku, metric });
      if ((nullableNumber(sku.priceStar) !== null && number(sku.priceStar) <= 3) || ['bad', 'avg'].includes(String(sku.competitivePower || ''))) lowPrice.push({ product, sku, metric });
    }
  }
  const actions = [];
  if (lowStock.length) {
    const gmv = lowStock.reduce((total, item) => total + number(item.metric?.gmv), 0);
    const zeroCount = lowStock.filter((item) => number(item.sku.stock) === 0).length;
    actions.push(opportunity({ code: 'O01', title: '先补畅销 SKU 库存', reason: `${lowStock.length} 个有成交或销量的 SKU 库存不足，其中 ${zeroCount} 个已售罄。`, priority: zeroCount ? 'P0' : 'P1', score: (zeroCount ? 40 : 25) + Math.min(35, 15 + Math.log10(gmv + 1) * 8) + 15 + 10, evidence: [`近 7 日关联 GMV ¥${round(gmv)}`, `${lowStock.length} 个 SKU 库存不高于 2`], acceptance: '相关 SKU 库存恢复到可持续销售水平', productIds: lowStock.map((item) => item.product.productId), skuIds: lowStock.map((item) => item.sku.skuId), actionType: 'stock_set' }));
  }
  if (lowPrice.length) {
    const gmv = lowPrice.reduce((total, item) => total + number(item.metric?.gmv), 0);
    actions.push(opportunity({ code: 'O02', title: '处理高价值价格机会', reason: `${lowPrice.length} 个 SKU 价格竞争力偏低，优先处理已有成交的商品。`, priority: 'P1', score: 25 + Math.min(35, 10 + Math.log10(gmv + 1) * 8) + (input.priceOpportunitySummary?.available === true ? 15 : 8) + 4, evidence: [gmv ? `近 7 日关联 GMV ¥${round(gmv)}` : '尚未形成收益证据', input.priceOpportunitySummary?.available === true ? `官方建议价覆盖 ${Math.floor(number(input.priceOpportunitySummary.coveredCount))} 个 SKU` : '官方建议价暂不可用'], acceptance: '相关 SKU 价格竞争力恢复到良好水平', productIds: lowPrice.map((item) => item.product.productId), skuIds: lowPrice.map((item) => item.sku.skuId), actionType: 'compare' }));
  }
  const fields = input.fieldDiagnosticSummary;
  if (fields?.available === true && number(fields.issueCount) > 0) actions.push(opportunity({ code: 'O03', title: '按字段修复商品信息', reason: `${Math.floor(number(fields.issueCount))} 个字段问题已定位到具体商品，可按影响逐项整改。`, priority: 'P1', score: 25 + Math.min(30, number(fields.issueCount) * 3) + 15 + 10, evidence: [`影响 ${Math.floor(number(fields.affectedProductCount))} 个 SPU`, '官方健康字段可回读复检'], acceptance: '字段问题数降至 0，提交前官方体检通过', productIds: (fields.items || []).map((item) => item.productId), skuIds: (fields.items || []).map((item) => item.skuId), actionType: 'product_patch' }));
  const materials = input.materialOperationSummary;
  if (materials?.available === true && number(materials.incompleteSkuCount) > 0) actions.push(opportunity({ code: 'O04', title: '补齐素材并建立实验', reason: `${Math.floor(number(materials.incompleteSkuCount))} 个 SKU 关键素材不完整。`, priority: 'P1', score: 25 + Math.min(30, number(materials.incompleteSkuCount) * 2) + 15 + 10, evidence: [`进行中实验 ${Math.floor(number(materials.runningExperimentCount))} 个`, `视频已绑定 ${Math.floor(number(materials.videoBoundSkuCount))} 个 SKU`], acceptance: '关键素材完整，并对重点商品启动至少一个可复检实验', productIds: materials.productIds || [], skuIds: materials.skuIds || [], actionType: 'material_experiment' }));
  const advertising = input.advertisingSummary;
  if (advertising?.available === true && (advertising.configured !== true || advertising.balance === 0)) actions.push(opportunity({ code: 'O05', title: advertising.configured ? '补充广告账户余额' : '完成京准通经营准备', reason: advertising.configured ? '广告账户余额为 0，当前无法承接付费流量测试。' : '当前店铺尚未完成京准通账户配置。', priority: 'P2', score: 10 + 12 + 15 + 4, evidence: [advertising.configured ? '账户已开通' : '账户未开通', advertising.balance === null ? '余额暂不可用' : `可用余额 ¥${round(advertising.balance)}`], acceptance: '广告账户可用且具备小额测试条件', actionType: 'advertising_setup' }));
  const members = input.memberSummary;
  if (members?.available === true && members.systemConfigured === true && number(members.dormantMemberCount) > 0) actions.push(opportunity({ code: 'O06', title: '激活沉默会员复购', reason: `${Math.floor(number(members.dormantMemberCount))} 名会员进入沉默窗口，可先制定分层唤醒方案。`, priority: 'P2', score: 10 + Math.min(25, number(members.dormantMemberCount)) + 15 + 4, evidence: [`会员 ${Math.floor(number(members.memberCount))} 名`, `复购会员 ${Math.floor(number(members.repeatMemberCount))} 名`], acceptance: '完成匿名人群策略配置并观察复购人数变化', actionType: 'member_strategy' }));
  return actions.sort((left, right) => right.score - left.score || left.code.localeCompare(right.code));
}

module.exports = {
  buildNextBestActions,
  normalizeAdvertisingSummary,
  normalizeBusinessSummary,
  normalizeCapabilitySummary,
  normalizeFieldDiagnosticSummary,
  normalizeLogisticsSummary,
  normalizeMaterialOperationSummary,
  normalizeMemberSummary,
};
