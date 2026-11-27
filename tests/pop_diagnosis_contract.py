"""Offline R01–R12 scan and report validation through either product's command line."""
import argparse
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
from zipfile import ZipFile


def fixture_cli():
    args = sys.argv[1:]
    def arg(name):
        return args[args.index(name) + 1]
    assert args[0] == 'invoke' and arg('--method') == 'GET' and arg('--profile') == 'fixture-pop'
    kind = arg('--url').rsplit('/', 1)[-1]
    rows = []
    if kind == 'venderinfo':
        print(json.dumps({'success': True, 'data': {'venderId': '200002', 'shopBaseInfo': {
            'shopId': '200001', 'shopName': 'sample', 'type': 0}}}))
        return
    if kind == 'products':
        rows = [{'productId': '300001', 'productName': 'Sample', 'salesVolume': 1, 'productStatus': 103}]
    elif kind == 'skus':
        rows = [{'skuId': str(sku), 'productId': '300001', 'skuName': 'sample', 'jdPrice': 12}
                for sku in (400001, 400002)]
    elif kind == 'price-stars':
        rows = [{'skuId': '400001', 'priceStar': 2, 'competitivePower': 'bad'}]
    elif kind == 'sku-stocks':
        rows = [{'skuId': str(sku), 'stockNum': 3} for sku in (400001, 400002)]
    elif kind == 'health-infos':
        rows = [{'skuId': str(sku), 'productId': '300001', 'healthScore': 100, 'improvementList': []}
                for sku in (400001, 400002)]
    elif kind == 'penalty-infos':
        rows = [{'penaltyId': 'A', 'effectStatus': 1, 'illegalLevel': 1,
                 'evidenceInfo': [{'evidenceType': 2, 'evidence': '300001'},
                                  {'evidenceType': 3, 'evidence': '400001'}]}]
    elif kind not in {'violating-products','product-applies','orders','dongdong-waiters',
                      'dongdong-waiter-performance','dongdong-waiter-evaluations'}:
        raise AssertionError(kind)
    print(json.dumps({'success': True, 'data': rows, 'paginationData': {'totalItems': len(rows)}}))


def install_fixture(state):
    tools = state/'tools'
    tools.mkdir()
    if os.name == 'nt':
        import platform
        from pip._vendor.distlib import scripts
        arch = '64-arm' if platform.machine().lower() == 'arm64' else ('64' if sys.maxsize > 2**32 else '32')
        launcher = Path(scripts.__file__).with_name('t'+arch+'.exe').read_bytes()
        package = BytesIO()
        with ZipFile(package, 'w') as archive:
            archive.writestr('__main__.py', Path(__file__).read_bytes())
        cli = tools/'fixture.exe'
        cli.write_bytes(launcher + ('#!"' + sys.executable + '"\n').encode() + package.getvalue())
    else:
        cli = tools/'fixture'
        cli.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' +
                       shlex.quote(str(Path(__file__).resolve())) + ' "$@"\n')
        cli.chmod(0o755)
    (tools/'official.json').write_text(json.dumps({'root':'tools','executable':cli.name,
        'executableSha256':sha256(cli.read_bytes()).hexdigest()}), encoding='utf-8')
    return cli


def run_contract(state, *, merchant=None, inspection=None, validator=None):
    cli = install_fixture(state)
    env = dict(os.environ, JDO_CLI_PATH=str(cli), HEIDENG_MERCHANT_HOME=str(state), HOME=str(state),
               USERPROFILE=str(state), PYTHONUTF8='1')
    def call(command, codes=(0,)):
        proc = subprocess.run(command, env=env, capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=120)
        if proc.returncode not in codes:
            raise AssertionError((proc.returncode, proc.stderr[-800:], proc.stdout[-800:]))
        return proc.stdout
    root = Path(__file__).resolve().parents[1]
    if merchant:
        skills = state/'skills'
        call([sys.executable, str(merchant/'install.py'), '--state', str(state),
              '--offline', '--no-auto-update', '--skills-dir', str(skills)])
        prefix = [sys.executable, str(skills/'heideng-ops-agent-merchant/scripts/merchant.py'),
                  '--state', str(state), 'run']
        inspection = prefix + ['diagnosis', '--']
        validator = prefix + ['--entry', 'scripts/validate_report.py', 'diagnosis', '--']
    else:
        inspection = inspection or ['node', str(root/'scripts/inspection/cli.cjs')]
        validator = validator or [sys.executable, str(root/'scripts/validate_report.py')]
    scan = json.loads(call(inspection + ['scan','--scope','full','--profile','fixture-pop',
                       '--shop-id','200001','--shop-name','sample','--output',str(state/'output')], (0, 2)))
    report = json.loads(Path(scan['jsonPath']).read_text(encoding='utf-8'))
    findings = {item['code']: item for item in report['findings']}
    assert set(findings) == {f'R{i:02}' for i in range(1,13)} and report['readOnly'] is True
    assert findings['R03']['evidence']['starCoverage'] == {
        'inspectedSkus':2, 'ratedSkus':1, 'lowStars':1, 'unknownStars':1}
    assert findings['R06']['evidence']['firstProductToReview'] == {'spuId':'300001','penaltyCount':1}
    from openpyxl import Workbook
    md, data = state/'report.md', state/'data.xlsx'
    workbook = Workbook()
    workbook.active.append(['店铺ID','200001'])
    workbook.active.append(['sample','成交金额','访客','客单价'])
    workbook.create_sheet('明细')
    workbook.create_sheet('数据说明')
    workbook.save(data)
    body = '# sample\n店铺ID：200001\n一句话结论\n行动清单：立即、本周、本月\n核心经营数据\n货盘、价格带、信息分、同行、数据缺口\n数据说明：数据来源、期间、口径\n店铺ID：200001\n'
    md.write_text(body, encoding='utf-8')
    args = validator + ['--md', str(md), '--xlsx', str(data), '--full',
                        '--shop-name','sample','--shop-id','200001','--min-chars','1']
    assert '结构自检全部通过' in call(args)
    md.write_text(body.replace('200001','200002',1), encoding='utf-8')
    assert 'FAIL | 店铺ID 与参数一致' in call(args, (1,))
    print(json.dumps({'rules':12,'ratedSkus':1,'unknownStars':1,'penaltyCount':1,
                      'validReport':'passed','wrongShopReport':'rejected','writes':0}))


if __name__ == '__main__':
    if sys.argv[1:2] == ['invoke']:
        fixture_cli()
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--inspection-entry-json', type=json.loads)
        parser.add_argument('--report-entry-json', type=json.loads)
        parser.add_argument('--merchant-root', type=Path)
        args = parser.parse_args()
        with tempfile.TemporaryDirectory() as out:
            def prefix(argv):
                return [item.replace('{state}', out) for item in argv] if argv else None
            run_contract(Path(out), merchant=args.merchant_root, inspection=prefix(args.inspection_entry_json),
                         validator=prefix(args.report_entry_json))
