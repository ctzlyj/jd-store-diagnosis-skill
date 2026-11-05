const test = require('node:test');
const assert = require('node:assert/strict');
const { runInspection, readPages, createOfficialInvoker, formatMarkdown, compareWithBaseline, ACTIONS, SKILL_VERSION } = require('../scripts/inspection/inspection.cjs');
const { parseArguments } = require('../scripts/inspection/cli.cjs');
const options = { profile: 'test-shop', shopId: '12345', shopName: '测试店铺', scope: 'sample', limit: 1 };

function fixture({ count = 1, missing = false, healthError = false } = {}) {
  const calls = [];
  const invoke = async (api, params, profile) => {
    calls.push({ api, params, profile });
    if (api.endsWith('venderinfo')) return { success: true, data: { venderId: '67890', shopBaseInfo: { shopId: '12345', shopName: '测试店铺', type: 0 } } };
    if (api.endsWith('.products')) {
      const rows = Array.from({ length: count }, (_, index) => ({ productId: String(10000 + index), productName: '商品', productStatus: 103, salesVolume: missing ? null : 2 }));
      const start = (params.page - 1) * params.pageSize;
      return { success: true, data: rows.slice(start, start + params.pageSize), paginationData: { totalItems: count } };
    }
    if (api.endsWith('.skus')) return { success: true, data: [{ productId: String(params.productIdList[0]), skuId: String(Number(params.productIdList[0]) + 100000), skuName: '规格', jdPrice: 20 }], paginationData: { totalItems: 1 } };
    if (api.endsWith('.sku-stocks')) return { success: true, data: missing ? [] : params.skuIdList.map(skuId => ({ skuId, stockNum: 0 })) };
    if (api.endsWith('.price-stars')) return { success: true, data: params.skuIdList.map(skuId => ({ skuId, priceStar: 2, competitivePower: 'bad' })) };
    if (api.endsWith('.health-infos')) {
      if (healthError) return { success: false, errorList: [{ code: 'TEST_FAILURE', message: 'secret should never be printed' }] };
      return { success: true, data: [{ productId: String(params.productId || 10000), skuId: String(Number(params.productId || 10000) + 100000), healthScore: 80, improvementList: [{ improvementDetail: { troubleCode: 'hasSceneImg', troubleName: '场景图待补充' } }] }], paginationData: { totalItems: 1 } };
    }
    return { success: true, data: [], paginationData: { totalItems: 0 } };
  };
  return { invoke, calls };
}

test('sample emits 12 diagnoses, no tasks or writes, and no all-store conclusion', async () => {
  const transport = fixture();
  const report = await runInspection({ ...options, invoke: transport.invoke });
  assert.equal(report.findings.length, 12);
  assert.equal(report.scope.wholeStore, false);
  assert.equal(report.findings.find(item => item.code === 'R01').status, 'not_checked');
  assert.equal(report.findings.find(item => item.code === 'R05').actual, 1);
  assert.equal(report.findings.find(item => item.code === 'R11').actual, 1);
  assert.equal(report.findings.find(item => item.code === 'R02').evidence.healthItems[0].skuId, '110000');
  assert.equal(report.findings.find(item => item.code === 'R02').evidence.healthItems[0].issues[0].code, 'hasSceneImg');
  assert.equal(report.shop.venderId, '67890');
  assert.ok(transport.calls.every(call => call.api.startsWith('GET.') && call.profile === 'test-shop'));
  assert.ok(!JSON.stringify(report).includes('ctaUrl'));
  assert.ok(!Object.hasOwn(report, 'tasks'));
  assert.match(formatMarkdown(report), /抽样/);
});

test('ten-product sample is bounded without store-wide customer queries', async () => {
  const transport = fixture({ count: 80 });
  const report = await runInspection({ ...options, limit: 10, invoke: transport.invoke });
  assert.equal(report.products.length, 10);
  assert.equal(report.scope.reportedOnSaleProducts, 80);
  assert.equal(report.status, 'sampled');
  assert.equal(report.findings.find(item => item.code === 'R03').status, 'issue');
  assert.equal(transport.calls.filter(call => call.api.endsWith('.products')).length, 1);
  assert.ok(!transport.calls.some(call => /sp-order|sp-support/.test(call.api)));
});

test('identity mismatch, missing shopId, and self-operated stores stop before inventory', async () => {
  for (const overrides of [{ shopId: '99999' }, { shopName: '另一个店' }]) {
    const transport = fixture();
    await assert.rejects(runInspection({ ...options, ...overrides, invoke: transport.invoke }), /SHOP_IDENTITY_MISMATCH/);
    assert.equal(transport.calls.length, 1);
  }
  const identity = extra => async () => ({ success: true, data: { venderId: '12345', shopBaseInfo: { shopName: '测试店铺', ...extra } } });
  await assert.rejects(runInspection({ ...options, invoke: identity({ shopId: '12345', type: 1 }) }), /POP_ONLY/);
  await assert.rejects(runInspection({ ...options, invoke: identity({ type: 0 }) }), /IDENTITY_INCOMPLETE/);
});

test('missing metrics are unknown rather than zero or healthy', async () => {
  const report = await runInspection({ ...options, invoke: fixture({ missing: true }).invoke });
  assert.equal(report.findings.find(item => item.code === 'R04').status, 'unavailable');
  assert.equal(report.findings.find(item => item.code === 'R05').status, 'unavailable');
  assert.equal(report.products[0].sales30d, null);
  assert.equal(report.products[0].skus[0].stock, null);
});

test('source failure preserves other findings and strips upstream messages', async () => {
  const report = await runInspection({ ...options, invoke: fixture({ healthError: true }).invoke });
  assert.equal(report.findings.find(item => item.code === 'R02').status, 'unavailable');
  assert.equal(report.findings.find(item => item.code === 'R03').status, 'issue');
  assert.equal(report.status, 'partial');
  assert.ok(report.failures.length > 0);
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('auth failure stops requests and request budget is enforced', async () => {
  const transport = fixture();
  let count = 0;
  const report = await runInspection({ ...options, invoke: async (...args) => {
    count += 1;
    if (count > 2) return { success: false, errorList: [{ code: '401', message: 'access token expired' }] };
    return transport.invoke(...args);
  } });
  assert.equal(count, 3);
  assert.equal(report.stopReason, 'AUTH_REQUIRED');
  const limited = fixture();
  const budgetReport = await runInspection({ ...options, maxRequests: 2, invoke: limited.invoke });
  assert.equal(limited.calls.length, 2);
  assert.equal(budgetReport.stopReason, 'REQUEST_BUDGET');
});

test('pagination rejects duplicates, incomplete pages and changing totals', async () => {
  const response = rows => ({ success: true, data: rows, paginationData: { totalItems: 3 } });
  await assert.rejects(readPages(async () => response([{ id: '1' }, { id: '1' }]), 'GET.test', {}, { pageSize: 2, idKey: 'id' }), /DUPLICATE_ROW/);
  await assert.rejects(readPages(async () => response([{ id: '1' }]), 'GET.test', {}, { pageSize: 2, idKey: 'id' }), /INCOMPLETE_PAGE/);
  await assert.rejects(readPages(async (api, params) => ({ success: true, data: params.page === 1 ? [{ id: '1' }, { id: '2' }] : [{ id: '3' }], paginationData: { totalItems: params.page === 1 ? 3 : 4 } }), 'GET.test', {}, { pageSize: 2, idKey: 'id' }), /TOTAL_CHANGED/);
});

test('pagination exhausts all pages and rejects malformed data', async () => {
  const seen = [];
  const result = await readPages(async (api, params) => {
    seen.push(params.page);
    return { success: true, data: params.page === 1 ? [{ id: '1' }, { id: '2' }] : [{ id: '3' }], paginationData: { totalItems: 3 } };
  }, 'GET.test', {}, { pageSize: 2, idKey: 'id' });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.complete, true);
  await assert.rejects(readPages(async () => ({ success: true, data: {} }), 'GET.test', {}), /INVALID_RESPONSE/);
});

test('full inventory does not truncate counts at the old 100-item display limit', async () => {
  const transport = fixture({ count: 101 });
  const report = await runInspection({ ...options, scope: 'full', maxRequests: 1000, invoke: async (...args) => {
    const result = await transport.invoke(...args);
    if (args[0].endsWith('.products')) result.data.forEach(row => { row.salesVolume = 0; });
    return result;
  } });
  assert.equal(report.products.length, 101);
  assert.equal(report.findings.find(item => item.code === 'R04').actual, 101);
  assert.equal(report.scope.wholeStore, true);
  assert.equal(report.findings.find(item => item.code === 'R01').status, 'clear');
});

test('official invoker is fixed GET only, hidden, shell-free and secret-safe', async () => {
  let observed;
  const invoke = createOfficialInvoker({ cliPath: '/test/jdo-cli', run: async (file, args, execOptions) => {
    observed = { file, args, execOptions };
    return { stdout: JSON.stringify({ success: true, data: [] }) };
  } });
  await invoke('GET.sp-product.v0.products', { page: 1 }, 'test-shop');
  assert.equal(observed.args[observed.args.indexOf('--method') + 1], 'GET');
  assert.equal(observed.execOptions.windowsHide, true);
  assert.equal(observed.execOptions.shell, false);
  await assert.rejects(invoke('PUT.sp-product.v0.sku-stocks.batch', {}, 'test-shop'), /READ_ONLY/);
  await assert.rejects(invoke('GET.sp-product.v0.products', {}, 'bad;profile'), /PROFILE_REQUIRED/);
  const broken = createOfficialInvoker({ cliPath: '/test/jdo-cli', run: async () => { throw new Error('access_token=secret'); } });
  await assert.rejects(broken('GET.sp-product.v0.products', {}, 'test-shop'), error => error.message === 'CLI_EXECUTION_FAILED');
});

test('three ordinary failures stop transport and empty datasets never invent metrics', async () => {
  const transport = fixture({ count: 10 });
  let failed = 0;
  const report = await runInspection({ ...options, limit: 10, invoke: async (...args) => {
    if (args[0].endsWith('.skus')) { failed += 1; return { success: false }; }
    return transport.invoke(...args);
  } });
  assert.equal(failed, 3);
  assert.equal(report.stopReason, 'FAILURE_LIMIT');
  assert.equal(report.scope.wholeStore, false);
});

test('official null data with explicit zero total is empty, not a protocol failure', async () => {
  const transport = fixture();
  const report = await runInspection({ ...options, invoke: async (...args) => {
    if (args[0].endsWith('.price-stars')) return { success: true, data: null, paginationData: { totalItems: 0 } };
    return transport.invoke(...args);
  } });
  assert.equal(report.failures.length, 0);
  assert.equal(report.findings.find(item => item.code === 'R03').status, 'unavailable');
  const empty = await readPages(async () => ({ success: true, data: null, paginationData: { totalItems: 0 } }), 'GET.test', {});
  assert.equal(empty.rows.length, 0);
  const omitted = await readPages(async () => ({ success: true, paginationData: { totalItems: 0 } }), 'GET.test', {});
  assert.equal(omitted.rows.length, 0);
  await assert.rejects(readPages(async () => ({ success: true, data: null }), 'GET.test', {}), /INVALID_RESPONSE/);
});

test('official score 100 may omit improvements; lower scores require detail evidence', async () => {
  for (const score of [100, 80]) {
    const transport = fixture();
    let details = 0;
    const report = await runInspection({ ...options, invoke: async (...args) => {
      if (args[0].endsWith('._healthInfoId')) {
        details += 1;
        return { success: true, data: { skuId: '110000', productId: '10000', healthScore: 80, improvementList: [{ improvementDetail: { troubleCode: 'hasSceneImg' } }] } };
      }
      const result = await transport.invoke(...args);
      if (args[0].endsWith('.health-infos')) result.data.forEach(row => { row.healthScore = score; row.healthScoreId = row.skuId; delete row.improvementList; });
      return result;
    } });
    assert.equal(details, score === 100 ? 0 : 1);
    assert.equal(report.findings.find(item => item.code === 'R02').status, score === 100 ? 'clear' : 'issue');
    assert.equal(report.findings.find(item => item.code === 'R11').actual, score === 100 ? 0 : 1);
  }
});

test('a low health score with no listed factors must not produce a healthy diagnosis', async () => {
  const transport = fixture();
  const report = await runInspection({ ...options, invoke: async (...args) => {
    const result = await transport.invoke(...args);
    if (args[0].endsWith('.health-infos')) result.data.forEach(row => { row.improvementList = []; });
    return result;
  } });
  assert.equal(report.findings.find(item => item.code === 'R02').actual, 1);
  assert.equal(report.findings.find(item => item.code === 'R02').status, 'issue');
  assert.equal(report.findings.find(item => item.code === 'R11').status, 'partial');
});

test('missing audit status is not a clear review result', async () => {
  const transport = fixture();
  const report = await runInspection({ ...options, scope: 'full', invoke: async (...args) => {
    if (args[0].endsWith('.product-applies')) return { success: true, data: [{ applyId: '101', productId: '10000' }], paginationData: { totalItems: 1 } };
    return transport.invoke(...args);
  } });
  assert.equal(report.findings.find(item => item.code === 'R10').status, 'partial');
});

test('report carries skill version and every triggered finding gets a routed action', async () => {
  const report = await runInspection({ ...options, invoke: fixture().invoke });
  assert.equal(report.skillVersion, SKILL_VERSION);
  const markdown = formatMarkdown(report);
  assert.match(markdown, /## 行动清单（建议承接 Skill）/);
  assert.match(markdown, /黑灯运营智能体/);
  const triggered = report.findings.filter(item => item.status === 'issue');
  for (const finding of triggered) {
    assert.ok(ACTIONS[finding.code], `missing action for ${finding.code}`);
    assert.ok(markdown.includes(ACTIONS[finding.code].split('；')[0].slice(0, 12)), `action text missing for ${finding.code}`);
  }
});

test('baseline recheck marks new, continued and resolved findings per rule', async () => {
  const makeFinding = (code, status) => ({ code, title: code, status, triggered: status === 'issue' });
  const report = { shop: { shopId: '12345', shopName: '测试店铺', venderId: '67890' }, startedAt: '2026-11-05T00:00:00.000Z', finishedAt: '2026-11-05T00:01:00.000Z', requestCount: 3, failures: [], limitations: [], scope: { kind: 'sample', inspectedProducts: 1, inspectedSkus: 1 }, findings: [makeFinding('R01', 'clear'), makeFinding('R02', 'issue'), makeFinding('R03', 'issue'), makeFinding('R04', 'unavailable')] };
  const baseline = { shop: { shopId: '12345' }, startedAt: '2026-11-04T00:00:00.000Z', scope: { kind: 'full' }, findings: [makeFinding('R01', 'issue'), makeFinding('R02', 'issue'), makeFinding('R03', 'clear'), makeFinding('R04', 'issue')] };
  const summary = compareWithBaseline(report, baseline);
  assert.equal(summary.summary.new, 1);
  assert.equal(summary.summary.continued, 1);
  assert.equal(summary.summary.resolved, 1);
  assert.equal(summary.summary.inconclusive, 1);
  assert.equal(summary.changes.find(item => item.code === 'R02').change, 'continued');
  assert.equal(summary.changes.find(item => item.code === 'R03').change, 'new');
  assert.equal(summary.changes.find(item => item.code === 'R01').change, 'resolved');
  assert.equal(summary.changes.find(item => item.code === 'R04').change, 'inconclusive');
  const markdown = formatMarkdown(report, summary);
  assert.match(markdown, /## 复检对比/);
  assert.match(markdown, /新增 1、持续 1、已恢复 1、无法判定 1/);
  assert.throws(() => compareWithBaseline(report, { shop: { shopId: '999' }, findings: [] }), /BASELINE_SHOP_MISMATCH/);
});

test('cli accepts baseline path for scan and keeps identity strict', () => {
  const parsed = parseArguments(['scan', '--profile', 'test-shop', '--shop-id', '12345', '--shop-name', '测试店铺', '--scope', 'sample', '--limit', '1', '--baseline', 'C:/tmp/report.json']);
  assert.equal(parsed.baseline, 'C:/tmp/report.json');
  assert.throws(() => parseArguments(['identity', '--profile', 'test-shop', '--shop-id', '12345']), /INVALID_ARGUMENT/);
  assert.throws(() => parseArguments(['scan', '--profile', 'test-shop', '--shop-id', '12345', '--shop-name', '测试店铺', '--scope', 'full', '--limit', '10']), /FULL_SCOPE_HAS_NO_SAMPLE_LIMIT/);
});

test('full scan uses official param contracts: applies scopeSet fields, evaluations pageSize 20, waiter batches of 10', async () => {
  const transport = fixture();
  const observed = [];
  const report = await runInspection({ ...options, shopId: '12345', shopName: '测试店铺', scope: 'full', maxRequests: 1000, invoke: async (api, params, profile) => {
    observed.push({ api, params });
    if (api.endsWith('.product-applies')) {
      if (params.statusList) {
        assert.deepEqual(params.statusList, [0, 100, 109], 'pending query filters pending statuses');
        assert.ok(params.modifiedEndTime > 0, 'pending query bounds by 24h cutoff');
      } else {
        assert.ok(params.scopeSet.includes('keeperStatus') && params.scopeSet.includes('productId'), 'applies scopeSet must unlock status fields');
      }
      return { success: true, data: [], paginationData: { totalItems: 0 } };
    }
    if (api.endsWith('.dongdong-waiter-evaluations')) {
      assert.ok(params.pageSize <= 20, 'evaluations pageSize must not exceed 20');
      return { success: true, data: [], paginationData: { totalItems: 0 } };
    }
    if (api.endsWith('.dongdong-waiters')) {
      return { success: true, data: Array.from({ length: 16 }, (_, index) => ({ waiter: `w${index}`, yn: 1 })), paginationData: { totalItems: 16 } };
    }
    if (api.endsWith('.dongdong-waiter-performance')) {
      assert.ok(params.waiterList.length <= 10, 'waiterList batch must not exceed 10');
      return { success: true, data: params.waiterList.map(waiter => ({ waiter, unReplyCount: 1 })) };
    }
    return transport.invoke(api, params, profile);
  } });
  const performanceCalls = observed.filter(item => item.api.endsWith('.dongdong-waiter-performance'));
  assert.equal(performanceCalls.length, 2);
  assert.equal(performanceCalls[0].params.waiterList.length + performanceCalls[1].params.waiterList.length, 16);
  assert.equal(report.findings.find(item => item.code === 'R08').evidence.unReplyCount, 16);
});
