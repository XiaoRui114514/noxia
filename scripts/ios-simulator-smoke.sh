#!/usr/bin/env bash
# Run only on macOS after an unsigned Release simulator build.
# Creates a disposable iPad simulator, so screenshots cannot contain existing app data.
# Usage: bash scripts/ios-simulator-smoke.sh [Noxia.app] [artifact-directory]
# Simulator .app/.zip files CANNOT be installed on a physical iPad.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'This smoke test requires macOS, Xcode, and an installed iPad simulator runtime.' >&2
  exit 2
fi

APP_PATH="${1:-build/ios-simulator/Build/Products/Release-iphonesimulator/Noxia.app}"
ARTIFACT_DIR="${2:-build/ios-smoke}"
BUNDLE_ID='com.noxia.app'
SIMULATOR_UDID=''
RUN_STARTED="$(date +%s)"
mkdir -p "$ARTIFACT_DIR"
APP_PATH="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$APP_PATH")"
ARTIFACT_DIR="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$ARTIFACT_DIR")"

if [[ ! -d "$APP_PATH" || ! -f "$APP_PATH/Info.plist" ]]; then
  echo "Missing simulator application: $APP_PATH" >&2
  exit 1
fi
ACTUAL_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Info.plist")"
PLATFORM="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$APP_PATH/Info.plist")"
if [[ "$ACTUAL_BUNDLE_ID" != "$BUNDLE_ID" || "$PLATFORM" != 'iPhoneSimulator' ]]; then
  echo 'Expected com.noxia.app built for iPhoneSimulator; refusing a device or unrelated app.' >&2
  exit 1
fi

collect_diagnostics() {
  if [[ -z "$SIMULATOR_UDID" ]]; then return; fi
  # Log queries have their own timeout; diagnostics must not leave a failed job hanging.
  python3 - "$SIMULATOR_UDID" "$ARTIFACT_DIR" "$RUN_STARTED" <<'PY'
import pathlib, shutil, subprocess, sys
udid, output, started = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3])
predicate = 'process == "Noxia" OR (process == "SpringBoard" AND eventMessage CONTAINS[c] "com.noxia.app")'
with (output / 'simulator-runtime.log').open('w') as log:
    try:
        subprocess.run(['xcrun', 'simctl', 'spawn', udid, 'log', 'show', '--style', 'compact',
                        '--last', '3m', '--predicate', predicate], stdout=log, stderr=subprocess.STDOUT,
                       timeout=45, check=False)
    except subprocess.TimeoutExpired:
        log.write('\nDiagnostic log query timed out after 45 seconds.\n')
reports = pathlib.Path.home() / 'Library/Logs/DiagnosticReports'
for report in reports.glob('Noxia*'):
    if report.is_file() and report.suffix in ('.ips', '.crash') and report.stat().st_mtime >= started:
        destination = output / 'crash-reports'
        destination.mkdir(exist_ok=True)
        shutil.copy2(report, destination / report.name)
PY
}

finish() {
  local result=$?
  trap - EXIT
  collect_diagnostics || true
  if [[ -n "$SIMULATOR_UDID" ]]; then
    xcrun simctl shutdown "$SIMULATOR_UDID" >/dev/null 2>&1 || true
    xcrun simctl delete "$SIMULATOR_UDID" >/dev/null 2>&1 || true
  fi
  exit "$result"
}
trap finish EXIT

xcrun simctl list devices available --json > "$ARTIFACT_DIR/available-devices.json"
# Choose an available iPad from the newest installed iOS runtime, then clone its type
# into a NEW simulator. Existing simulators and any personal app data stay untouched.
python3 - "$ARTIFACT_DIR/available-devices.json" "$ARTIFACT_DIR/selected-device.json" <<'PY'
import json, pathlib, re, sys
source, target = map(pathlib.Path, sys.argv[1:])
candidates = []
for runtime, devices in json.loads(source.read_text())['devices'].items():
    version = re.search(r'\.iOS-(\d+)-(\d+)(?:-(\d+))?$', runtime)
    if not version:
        continue
    numbers = tuple(int(part or 0) for part in version.groups())
    if numbers < (16, 4, 0):
        continue
    for device in devices:
        if device.get('isAvailable', True) and 'ipad' in device.get('name', '').lower() and device.get('deviceTypeIdentifier'):
            candidates.append((numbers, device['name'], device['deviceTypeIdentifier'], runtime))
if not candidates:
    raise SystemExit('No available iPad simulator with iOS >= 16.4; install a runtime in Xcode.')
version, name, device_type, runtime = sorted(candidates, reverse=True)[0]
target.write_text(json.dumps({'name': name, 'deviceType': device_type, 'runtime': runtime}, indent=2) + '\n')
print(f'Selected iPad type: {name}, runtime: {runtime}')
PY
SIMULATOR_UDID="$(python3 - "$ARTIFACT_DIR/selected-device.json" <<'PY'
import json, subprocess, sys
selected = json.load(open(sys.argv[1]))
result = subprocess.run(['xcrun', 'simctl', 'create', 'Noxia disposable smoke test',
                         selected['deviceType'], selected['runtime']],
                        capture_output=True, text=True, check=True, timeout=30)
print(result.stdout.strip())
PY
)"
printf '%s\n' "$SIMULATOR_UDID" > "$ARTIFACT_DIR/simulator-udid.txt"
xcrun simctl boot "$SIMULATOR_UDID"
python3 - "$SIMULATOR_UDID" "$ARTIFACT_DIR/boot.log" <<'PY'
import subprocess, sys
with open(sys.argv[2], 'w') as output:
    subprocess.run(['xcrun', 'simctl', 'bootstatus', sys.argv[1], '-b'],
                   stdout=output, stderr=subprocess.STDOUT, check=True, timeout=180)
PY

xcrun simctl install "$SIMULATOR_UDID" "$APP_PATH"
xcrun simctl launch --terminate-running-process "$SIMULATOR_UDID" "$BUNDLE_ID" > "$ARTIFACT_DIR/launch.log" 2>&1
APP_PID="$(python3 - "$ARTIFACT_DIR/launch.log" "$BUNDLE_ID" <<'PY'
import pathlib, re, sys
match = re.search(re.escape(sys.argv[2]) + r':\s*(\d+)\s*$', pathlib.Path(sys.argv[1]).read_text(), re.MULTILINE)
if not match:
    raise SystemExit('simctl launch did not report an application PID; inspect launch.log.')
print(match.group(1))
PY
)"

assert_running() {
  # Simulator app PIDs are host macOS processes. Verify both PID liveness and the
  # executable name, rather than treating a successful launch request as success.
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "Noxia exited during startup (PID $APP_PID); inspect simulator-runtime.log/crash-reports." >&2
    return 1
  fi
  local process_path
  process_path="$(ps -p "$APP_PID" -o comm=)"
  if [[ "${process_path##*/}" != "$EXECUTABLE" ]]; then
    echo 'The launched PID no longer belongs to the Noxia executable.' >&2
    return 1
  fi
}

assert_running
# Bounded first-render interval: five checks, 3 seconds apart, at most 15 seconds.
# A live process plus screenshot is startup evidence, not an audio or visual-quality assertion.
for attempt in 1 2 3 4 5; do
  sleep 3
  assert_running
  printf 'Startup liveness check %s/5 passed.\n' "$attempt"
done
xcrun simctl io "$SIMULATOR_UDID" screenshot --type=png "$ARTIFACT_DIR/ipad-startup.png"
assert_running
ps -p "$APP_PID" -o pid=,comm= > "$ARTIFACT_DIR/application-process.txt"
cat > "$ARTIFACT_DIR/README.txt" <<'NOTE'
This smoke test installed an unsigned Release simulator app in a NEW disposable iPad simulator.
It asserted the Noxia process stayed alive for 15 seconds and captured the actual startup screen.
Inspect ipad-startup.png manually for rendered app content and unexpected error screens.
It does not prove physical-iPad installation, background audio, lock-screen controls, interruptions,
speech quality, Apple signing, or TestFlight readiness. Simulator binaries cannot run on real iPad.
NOTE
printf 'PASS: Noxia remained running for 15 seconds; actual screenshot: %s/ipad-startup.png\n' "$ARTIFACT_DIR"
