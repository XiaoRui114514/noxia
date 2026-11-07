#!/usr/bin/env python3
"""Run real XCTest UI integration in a new disposable iPad simulator (macOS only)."""
import json
import pathlib
import platform
import subprocess
import sys

if platform.system() != 'Darwin':
    raise SystemExit('This integration test requires macOS and Xcode.')

selected = json.loads(pathlib.Path('build/ios-smoke/selected-device.json').read_text())
udid = subprocess.check_output([
    'xcrun', 'simctl', 'create', 'Noxia disposable UI test',
    selected['deviceType'], selected['runtime'],
], text=True, timeout=30).strip()
output = pathlib.Path('build/ios-ui-test')
output.mkdir(parents=True, exist_ok=True)
(output / 'simulator-udid.txt').write_text(udid + '\n')
status = 1
try:
    subprocess.run(['xcrun', 'simctl', 'boot', udid], check=True, timeout=30)
    subprocess.run(['xcrun', 'simctl', 'bootstatus', udid, '-b'], check=True, timeout=180)
    result = subprocess.run([
        'xcodebuild', '-workspace', 'ios/Noxia.xcworkspace', '-scheme', 'NoxiaUITests',
        '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', f'id={udid}',
        '-derivedDataPath', 'build/ios-simulator', '-resultBundlePath', 'build/Noxia-UITests.xcresult',
        '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
        f'ARCHS={platform.machine()}', 'ONLY_ACTIVE_ARCH=YES',
        'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'test',
    ], check=False, timeout=900)
    status = result.returncode
except subprocess.TimeoutExpired:
    print('Simulator UI integration exceeded its bounded timeout.', file=sys.stderr)
finally:
    with (output / 'simulator-runtime.log').open('w') as stream:
        try:
            subprocess.run(['xcrun', 'simctl', 'spawn', udid, 'log', 'show', '--style', 'compact',
                            '--last', '10m', '--predicate', 'process == "Noxia"'],
                           stdout=stream, stderr=subprocess.STDOUT, timeout=45, check=False)
        except subprocess.TimeoutExpired:
            stream.write('\nDiagnostic log query timed out.\n')
    for action in ['shutdown', 'delete']:
        try:
            subprocess.run(['xcrun', 'simctl', action, udid], timeout=30, check=False)
        except subprocess.TimeoutExpired:
            print(f'Temporary simulator {action} timed out.', file=sys.stderr)
raise SystemExit(status)
