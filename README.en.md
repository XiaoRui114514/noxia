# Noxia

[简体中文](README.md) · English

A listening, recitation and review app built with React Native/Expo and an iOS audio module. Arrange original text, translations, repetition and silent gaps into a playback timeline. The current interface is Chinese.

## Versions and installation

The default `main` branch integrates the released **0.4.0** albums, ordered playlists, backup/recovery and self-assessed review code, with the SDK patch updates retained. [Published IPAs](https://github.com/XiaoRui114514/noxia/releases) remain tied to their own source/build commits; a historical package is not a build of the latest `main`. Read that source/build information when reporting a defect.

Download an IPA and its SHA-256 file from the chosen release. These device packages require your own legitimate signing/provisioning before installation; an unsigned IPA is not directly installable. Minimum iOS/iPadOS: 16.4. Simulator ZIPs cannot be installed on a physical device. Releases avoid the short retention period of Actions artifacts.

Native builds and browser previews do not establish physical-device, locked-screen or background-playback acceptance. See [audio implementation](docs/audio.md) and the [release checklist](docs/release-checklist.md) for the separate checks.

## Local use and optional services

- Import TXT/Markdown, align translations with tabs, edit playback plans and preserve local progress.
- System speech is the default. The native module compiles local PCM timelines for AVPlayer; the browser provides foreground previews.
- Optional model and external voice services use your own compatible endpoint. They receive relevant text, may incur costs and require the rights to use the selected voice. Keys are isolated by endpoint.
- Accounts require a separately configured and deployed mobile service. Hiding a service address does not make login available. Local work remains available without an account; see [account integration status](docs/account-integration-status.md).

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md) and [dependency notices](THIRD_PARTY_NOTICES.md). Do not include keys, private documents or audio in public reports.

## Develop `main`

Use Node.js 24:

```sh
npm ci
npm run web
# In a separate terminal:
npm run check
npm run export:web
npx playwright install chromium
npm run test:e2e
```

The native audio module needs a development build; Expo Go cannot validate it. Xcode/macOS is required for local iOS compilation. Backend tests run separately with `cd backend && npm ci && npm test`. Do not deploy or migrate production accounts as part of local testing.

MIT licensed; see [LICENSE](LICENSE). Contributions should preserve concise interface text, per-endpoint keys, local data and native/browser verification boundaries in [AGENTS.md](AGENTS.md).
