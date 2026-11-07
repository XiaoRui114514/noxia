#!/usr/bin/env bash
# Package an iphoneos archive for the owner's own signing tool; never uses credentials.
set -euo pipefail
if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'Packaging requires macOS with Xcode tools.' >&2
  exit 2
fi
APP_PATH="${1:-build/Noxia.xcarchive/Products/Applications/Noxia.app}"
OUTPUT_DIR="${2:-build/ipa-artifacts}"
[[ -d "$APP_PATH" ]] || { echo 'Missing archived Noxia.app' >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
python3 - "$APP_PATH" "$OUTPUT_DIR" <<'PY'
import json, pathlib, plistlib, subprocess, sys
app, output = map(pathlib.Path, sys.argv[1:])
info = plistlib.loads((app / 'Info.plist').read_bytes())
assert info.get('CFBundleSupportedPlatforms') == ['iPhoneOS'], 'Refusing simulator app: IPA must target iPhoneOS.'
assert 2 in info.get('UIDeviceFamily', []), 'This build must support iPad.'
assert info.get('CFBundleIdentifier') == 'com.noxia.app', 'Refusing unrelated application.'
executable = app / info['CFBundleExecutable']
architectures = subprocess.check_output(['xcrun','lipo','-archs',str(executable)],text=True).strip().split()
assert architectures == ['arm64'], f'Expected real-device arm64, got {architectures}'
build_version = subprocess.check_output(['xcrun','vtool','-show-build',str(executable)],text=True)
assert 'platform IOS' in build_version and 'IOSSIMULATOR' not in build_version, 'Mach-O does not target physical iOS.'
(output / 'BUILD-INFO.json').write_text(json.dumps({
    'app':'Noxia','version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],
    'bundleIdentifier':info['CFBundleIdentifier'],'minimumOSVersion':info['MinimumOSVersion'],
    'platform':'iPhoneOS','architectures':architectures,'supportsIPad':True,'requiresOwnerSigning':True,
},ensure_ascii=False,indent=2)+'\n')
(output / 'MACH-O-BUILD.txt').write_text(build_version)
PY
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/noxia-ipa.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/Payload"
ditto "$APP_PATH" "$STAGE/Payload/Noxia.app"
ditto -c -k --keepParent "$STAGE/Payload" "$OUTPUT_DIR/Noxia-unsigned.ipa"
python3 - "$OUTPUT_DIR/Noxia-unsigned.ipa" <<'PY'
import hashlib, pathlib, plistlib, sys, zipfile
ipa=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(ipa) as archive:
    assert archive.testzip() is None, 'Corrupt IPA archive.'
    info=plistlib.loads(archive.read('Payload/Noxia.app/Info.plist'))
    assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS']
    assert 'Payload/Noxia.app/'+info['CFBundleExecutable'] in archive.namelist()
    assert 'Payload/Noxia.app/main.jsbundle' in archive.namelist(), 'Release JS bundle missing.'
checksum=hashlib.sha256(ipa.read_bytes()).hexdigest()
ipa.with_suffix('.ipa.sha256').write_text(f'{checksum}  {ipa.name}\n')
print(f'Validated physical-device IPA: {ipa.name}, {ipa.stat().st_size} bytes, SHA256 {checksum}')
PY
cat > "$OUTPUT_DIR/请先签名-README.txt" <<'NOTE'
Noxia-unsigned.ipa is an ARM64 iPhoneOS Release package with iPad support.
Sign it with your own legitimate signing certificate/provisioning method before installation.
No Apple account, certificate, password or signing service was used in this build.
This is NOT a simulator ZIP, NOT a signed TestFlight build, and NOT an App Store submission.
Bundle ID: com.noxia.app. Minimum iPadOS version and exact build details are in BUILD-INFO.json.
After signing, verify launch, Apple voices, lock-screen audio, interruptions and sleep timer on your iPad.
NOTE
