const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runInspection, formatMarkdown, compareWithBaseline, createOfficialInvoker, readIdentity } = require('./inspection.cjs');
const { requireProfile } = require('./transport.cjs');

const STATE_ROOT = path.join(os.homedir(), '.jd-store-diagnosis');

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') return { command: 'help' };
  if (!['identity', 'scan'].includes(command)) throw new Error('READ_ONLY_COMMAND_REQUIRED');
  const values = {};
  const accepted = new Set(['profile', 'shop-id', 'shop-name', 'scope', 'limit', 'max-requests', 'output', 'baseline']);
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === '--dry-run' && command === 'scan') { values.dryRun = true; continue; }
    const key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!accepted.has(key) || !rest[index + 1] || rest[index + 1].startsWith('--') || Object.hasOwn(values, key)) throw new Error('INVALID_ARGUMENT');
    values[key] = rest[index + 1];
    index += 1;
  }
  requireProfile(values.profile);
  if (command === 'identity' && Object.keys(values).some(key => key !== 'profile')) throw new Error('INVALID_ARGUMENT');
  const options = { command, profile: values.profile, shopId: values['shop-id'], shopName: values['shop-name'], scope: values.scope || 'sample', limit: Number(values.limit || 10), maxRequests: Number(values['max-requests'] || 2000), output: values.output, baseline: values.baseline, dryRun: values.dryRun === true };
  if (command === 'scan') {
    if (!/^\d+$/.test(options.shopId || '') || !options.shopName?.trim()) throw new Error('EXPECTED_SHOP_REQUIRED');
    if (!['sample', 'full'].includes(options.scope) || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new Error('INVALID_SCOPE');
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 10000) throw new Error('INVALID_REQUEST_BUDGET');
    if (options.scope === 'full' && values.limit) throw new Error('FULL_SCOPE_HAS_NO_SAMPLE_LIMIT');
  }
  return options;
}

async function main(args) {
  const options = parseArguments(args);
  if (options.command === 'help') {
    console.log('POP店铺诊断：官方京麦CLI只读巡检（R01-R12）\nidentity --profile NAME\nscan --profile NAME --shop-id ID --shop-name NAME [--scope sample --limit 1|10] [--scope full] [--baseline 前次report.json] [--max-requests 2000] [--output DIRECTORY] [--dry-run]\n只读诊断：固定官方GET白名单，无任务队列、无平台写入、无自动登录。报告默认保存到用户目录 .jd-store-diagnosis/runs/<运行目录>/。');
    return;
  }
  if (options.dryRun) {
    console.log(JSON.stringify({ readOnly: true, planOnly: true, ...options }, null, 2));
    return;
  }
  const cliPath = process.env.JDO_CLI_PATH || path.join(os.homedir(), '.jdo-cli', 'bin', process.platform === 'win32' ? 'jdo-cli.exe' : 'jdo-cli');
  if (!fs.existsSync(cliPath)) throw new Error('JDO_CLI_NOT_FOUND');
  const invoke = createOfficialInvoker({ cliPath });
  if (options.command === 'identity') {
    console.log(JSON.stringify({ profile: options.profile, ...await readIdentity(invoke, options.profile) }, null, 2));
    return;
  }
  if (options.baseline && !fs.existsSync(path.resolve(options.baseline))) throw new Error('BASELINE_NOT_FOUND');
  const base = path.resolve(options.output || path.join(STATE_ROOT, 'runs'));
  const runDirectory = path.join(base, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(runDirectory, { recursive: true });
  const lockDirectory = path.join(STATE_ROOT, 'locks');
  fs.mkdirSync(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, `${options.shopId}.lock`);
  let lock;
  try { lock = fs.openSync(lockPath, 'wx', 0o600); }
  catch { throw new Error('SHOP_SCAN_LOCKED'); }
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const report = await runInspection({ ...options, invoke });
    let baselineSummary = null;
    if (options.baseline) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(options.baseline), 'utf8'));
      baselineSummary = compareWithBaseline(report, baseline);
    }
    const jsonPath = path.join(runDirectory, 'report.json');
    const markdownPath = path.join(runDirectory, 'report.md');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(markdownPath, formatMarkdown(report, baselineSummary), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, shop: report.shop, scope: report.scope, requestCount: report.requestCount, failures: report.failures, stopReason: report.stopReason, recheck: baselineSummary, jsonPath, markdownPath }, null, 2));
    if (report.status === 'partial') process.exitCode = 2;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message || '') ? error.message : 'LOCAL_OPERATION_FAILED';
  console.error(JSON.stringify({ status: 'failed', errorCode: code }));
  process.exitCode = 1;
});

module.exports = { parseArguments, main };
