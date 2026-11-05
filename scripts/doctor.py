# -*- coding: utf-8 -*-
"""环境自检：检查本 Skill 依赖的运行环境，缺什么给出采销能照做的下一步。

用法：python -X utf8 scripts/doctor.py
退出码：0=全部就绪；1=有缺项。
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def check_node():
    try:
        out = subprocess.run(['node', '-v'], capture_output=True, text=True, timeout=15)
        version = (out.stdout or '').strip().lstrip('v')
        if not version:
            return 'FAIL', f'node -v 无输出（退出码 {out.returncode}）', '安装 Node.js 18 或以上：https://nodejs.org/zh-cn（LTS 版），装完重开终端再跑一次自检。'
        major = int(version.split('.')[0])
        if major < 18:
            return 'FAIL', f'Node.js {version}，需要 18+', '到 https://nodejs.org/zh-cn 下载 LTS 版本安装后重试。'
        return 'PASS', f'Node.js {version}', ''
    except FileNotFoundError:
        return 'FAIL', '未找到 node 命令', '安装 Node.js 18+（https://nodejs.org/zh-cn，LTS 版），或联系IT助手安装后重试。'
    except Exception as exc:
        return 'WARN', f'检测失败：{exc}', '手工执行 node -v 核对。'


def check_python():
    version = f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'
    if sys.version_info < (3, 10):
        return 'FAIL', f'Python {version}，需要 3.10+', '安装 Python 3.10+（https://www.python.org/downloads/，勾选 Add to PATH）。'
    return 'PASS', f'Python {version}', ''


def check_module(name):
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def check_python_modules():
    missing = [name for name in ('playwright', 'openpyxl') if not check_module(name)]
    if missing:
        return 'FAIL', f'缺少 Python 包：{", ".join(missing)}', f'执行：python -m pip install {" ".join(missing)}（公司内网加 --index-url https://mirrors.jd.com/pypi/simple）。'
    return 'PASS', 'playwright、openpyxl 已安装', ''


def check_jdo_cli():
    path = os.environ.get('JDO_CLI_PATH') or str(Path.home() / '.jdo-cli' / 'bin' / ('jdo-cli.exe' if os.name == 'nt' else 'jdo-cli'))
    if Path(path).exists():
        return 'PASS', f'jdo-cli：{path}', ''
    return 'FAIL', '未找到京麦 CLI（jdo-cli）', '先用京麦 CLI 店铺连接完成店铺授权（JoyCode 里找 jingmai-cli-linker 技能，按引导连接一次店铺）；授权完成后 jdo-cli 会装到用户目录 .jdo-cli。若已装在别处，设置环境变量 JDO_CLI_PATH 指向 jdo-cli 可执行文件。'


def check_webcli():
    env_main = os.environ.get('WEBCli_MAIN') or os.environ.get('WEBCLI_MAIN')
    if env_main and Path(env_main).exists():
        return 'PASS', f'WebCLI：{env_main}', ''
    for name in ('webcli', 'webcli.cmd', 'webcli.exe'):
        found = shutil.which(name)
        if found:
            return 'PASS', f'WebCLI：{found}', ''
    return 'WARN', '未找到 WebCLI（仅影响 EasyBI 京喜渠道补充取数，不影响巡检和商智/京准通诊断）', '执行 o2 install webcli 安装；装完重跑自检。'


def check_chrome():
    if os.name != 'nt':
        for name in ('google-chrome', 'chromium'):
            if shutil.which(name):
                return 'PASS', f'浏览器：{shutil.which(name)}', ''
        return 'FAIL', '未找到 Chrome/Chromium', '安装 Google Chrome。'
    candidates = [
        Path(os.environ.get('PROGRAMFILES', r'C:\Program Files')) / 'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('LOCALAPPDATA', '')) / 'Google/Chrome/Application/chrome.exe',
    ]
    for candidate in candidates:
        if candidate.exists():
            return 'PASS', f'Chrome：{candidate}', ''
    return 'FAIL', '未找到 Google Chrome（第2层商智/京准通诊断需要）', '安装 Google Chrome（https://www.google.cn/chrome）。只用第1层官方巡检的话可暂时没有。'


def main():
    checks = [
        ('Node.js（巡检CLI/商智采集）', check_node),
        ('Python（计划生成/Excel/验收）', check_python),
        ('Python 依赖包', check_python_modules),
        ('京麦 CLI jdo-cli（第1层巡检）', check_jdo_cli),
        ('WebCLI（EasyBI 补充，可选）', check_webcli),
        ('Chrome 浏览器（第2层诊断）', check_chrome),
    ]
    rows = []
    failed = 0
    for name, fn in checks:
        status, detail, next_step = fn()
        if status == 'FAIL':
            failed += 1
        rows.append({'item': name, 'status': status, 'detail': detail, 'next': next_step})
    print('== POP店铺诊断 环境自检 ==')
    for row in rows:
        mark = {'PASS': '[就绪]', 'FAIL': '[缺失]', 'WARN': '[可选]'}[row['status']]
        print(f"{mark} {row['item']}：{row['detail']}")
        if row['next']:
            print(f"       下一步：{row['next']}")
    if failed:
        print(f'\n结论：{failed} 项缺失。按上面「下一步」处理后重跑自检；缺第1层依赖时官方巡检跑不了，缺第2层依赖时只能先跑第1层巡检。')
    else:
        print('\n结论：环境就绪。三层诊断都可运行（第2层还需店铺浏览器完成过一次登录）。')
    print(json.dumps({'ok': failed == 0, 'checks': rows}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
