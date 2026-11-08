# Noxia

听读、背诵与复习。支持文稿、译文、重复、留白和知识讲稿。

![播放器](docs/screenshots/player-landscape.png)

截图来自浏览器预览。新增 [账号弹窗](docs/screenshots/account-dialog.png)、[自评复习](docs/screenshots/review-landscape.png)。另见 [首页](docs/screenshots/home-landscape.png)、[设置](docs/screenshots/settings-landscape.png)、[竖屏](docs/screenshots/player-portrait.png)、[窄屏深色](docs/screenshots/player-split-dark.png)。

## 0.4 更新

- 播放列表按已加入顺序展示和播放；加入、移除、上移、下移分开，连续点击加入不会反向移除。单篇设置先编辑后保存。
- 新增专辑：保存曲目顺序、原文与译文声音、各自遍数、语速、句间间隔、专辑轮数、随机和循环。支持整篇或逐句，可从列表建立副本。
- 专辑会话支持暂停和刷新恢复；修改正在播放的曲目或设置会停止旧会话，避免移除后继续读旧内容。备份与回收站恢复包含专辑关联。
- 资料许可改为首次打开学习项目时弹窗确认，本机记住选择；资源页移除常驻许可说明和按钮。

验证范围见 [0.4 验证记录](docs/review-0.4.md)。[专辑截图](docs/screenshots/albums-landscape.png) · [窄屏设置](docs/screenshots/album-settings-phone.png) · [许可弹窗](docs/screenshots/resource-license-phone.png)。

## 0.3 更新（历史）

- 统一资料保存与读取校验；异常条目单独隔离，保留原文，合法资料继续使用。设置中提供整库备份、恢复预览、恢复点、回收站和版本历史。
- 编辑保留句段 ID、解释、关键词、重点和段落；提供结构化编辑、人工拆分及合并。文稿草稿自动保存，资料支持全文搜索。
- 同会话直接续播；刷新后恢复完整时间线，按编排、资源及步骤校验进度。重点筛选为空时明确提示。
- 词典持久保存；生成任务去重、停止、归属检查、草稿和最近十次历史；固定截止与相对定时分开。
- 设置首区保留账号卡片，登录使用自适应弹窗；播放规则默认收起。原译文层级、阅读跟随、文稿保存状态及编排字段重新组织。
- 新增本机自评、薄弱句、到期复习及每日入口；先揭晓核对再提交，播放完成不计为掌握。

验证范围与未完成事项见 [0.3 验证记录](docs/review-0.3.md)。0.3.0 已完成 ARM64 真机目标构建并发布 [未签名 IPA](https://github.com/XiaoRui114514/noxia/releases/download/v0.3.0-build3/Noxia-0.3.0.ipa)；不包含本次 0.4 改动。

## 0.2 更新（历史）

- 黑白主题；导航和浮动播放器采用玻璃材质。iOS 26 使用原生 Liquid Glass，旧版 iOS 使用模糊材质；减少透明度时使用实底。
- 侧栏按可用空间收起，可手动开关；窄屏导航有遮罩，切换页面、旋转、调整窗口或按 Escape 后关闭。
- 缩短标题、按钮和提示；设置首区为「账号登录」，普通设置中没有账号服务地址。
- 模型采用 **OpenAI 兼容协议**，不是绑定某家供应商。填写接口地址后自动请求模型目录，可搜索选择模型，没有手填模型 ID。
- 密钥按接口隔离；换地址、切号、退出后的旧请求不会覆盖新状态。
- 声音可按语言、音质和性别筛选。可连接自己的兼容语音服务，选择声音、试听、生成 MP3 并缓存；失败时改用系统声音。

## 功能

- 输入、编辑、导入 TXT / Markdown，按换行建立朗读单元，用 Tab 明确对应译文。
- 逐句、逐段、全文编排：原文、译文、解释、关键词、自定义文字、重复和留白；支持保存及导入导出模板。
- 有序播放列表、独立专辑、选句、重点句、随机顺序、有限次数、循环、倍速、睡眠截止和渐弱。
- Apple 系统语音生成本地 PCM，再由原生 AVPlayer 播放完整时间线；跨篇和静音不依赖前台 JavaScript。
- 古诗文和英语资源适配，按固定来源版本读取，不执行远程 JavaScript，不猜测原文与译文对应。
- 可编辑的模型讲稿、本机记录和恢复进度。

## 安装包

当前版本：[下载 Noxia 0.4.0 IPA](https://github.com/XiaoRui114514/noxia/releases/download/v0.4.0-build4/Noxia-0.4.0.ipa) · [SHA256](https://github.com/XiaoRui114514/noxia/releases/download/v0.4.0-build4/Noxia-0.4.0.ipa.sha256)。ARM64 iPhoneOS、build 4，最低 iOS / iPadOS 16.4；未签名，需用自己的签名方式安装。包已实际下载复核，与 [构建记录](https://github.com/XiaoRui114514/noxia/actions/runs/42499501352) 一致；尚未完成实体设备验收。

使用 Actions 中的 **Build iPad IPA for personal signing**，在成功运行的 Artifacts 下载 **Noxia-iPad-IPA-to-sign**。解压得到：

- `Noxia-unsigned.ipa`：实体设备 ARM64 Release 包。
- `.ipa.sha256`：完整性校验码。
- `BUILD-INFO.json`：版本、最低系统和构建信息。

请用自己的签名方式签名后安装。构建不使用 Apple ID、证书或签名服务凭据。产物默认保留 7 天，过期可手动 Run workflow 重新生成。

最低 iOS / iPadOS 16.4。模拟器 ZIP 的 SDK 平台不同，不能给实体设备安装。历史 0.2 已通过 [真机目标构建](https://github.com/XiaoRui114514/noxia/actions/runs/42369539176)，[下载产物](https://github.com/XiaoRui114514/noxia/actions/runs/42369539176/artifacts/13572728313)（保留 7 天）。构建成功不等于实体设备播放验收完成。

可选的 EAS 签名分发通常需要 Apple Developer Program；TestFlight 还需要 App Store Connect。用户已有签名方式时直接使用上述 IPA，无需先配置 EAS。

## 开发

Node.js 24、Git：

```sh
git clone https://github.com/XiaoRui114514/noxia.git
cd noxia
npm ci
npm run web
```

```sh
npm run typecheck
npm test
npm run security:scan
npm run export:web
npx playwright install chromium
npm run test:e2e
```

浏览器使用前台系统朗读预览，不验证锁屏和持久音频缓存。自定义原生模块需要 Development Build，不能用 Expo Go 验收。兼容当前 Xcode 的 Mac 可运行 `npx expo run:ios --device`；Windows 可使用 GitHub macOS 工作流。旧 Mac 不保证能运行所需 Xcode。

提交前检查：`git config core.hooksPath .githooks`。

## 模型

在「设置 → 模型」填写可信的 HTTPS 接口地址，例如服务提供的 `/v1` 地址。应用自动读取 `/models`，再选择模型；无需鉴权的服务可不填密钥。服务未提供模型目录时会报错，不伪造模型列表。

这里的 OpenAI 指兼容协议。可接 DeepSeek、自托管或其他兼容服务，不预填某家服务。密钥按完整接口地址分开保存：原生版使用设备安全存储，浏览器仅保存在当前会话内存。没有明确来源的旧版全局密钥不会自动发给新接口。

生成会将所选资料发到你配置的服务，可能按其价格收费。文本模型和语音服务的配置、密钥、费用分开管理。

## 声音

系统声音为默认选项，无额外 TTS API 费。可在系统辅助功能的语音设置下载更多声音，再回 Noxia 刷新。音质、男女声和语言以已安装元数据为准，不凭名称猜测。

「声音 → 接口」可配置有权使用的 OpenAI 兼容语音服务，包括自己的 Kokoro 服务。目录优先读取 `/audio/voices`，再尝试 `/voices`；协议没有统一声音目录，服务不提供时可填声音 ID。只有选用外部声音并确认发送后才调用 `/audio/speech`。

合成先查询本地缓存；重复次数和播放音量不会导致重复合成。缓存身份包含服务、模型、版本、音色、文本、读音替换及合成语速。长文本分块保留句段关联；服务失败时回退到系统声音。缓存音频不进入 D1。

本仓库不分发模型权重、盗版音色、私人接口或绕过收费的方法。服务部署和算力未必免费，许可证及费用由所选服务决定。[语音调研](docs/tts-research.md)

## 账号与 Cloudflare

账号复用语文、英语项目的学习身份，不能使用 Cloudflare 管理控制台密码代替。客户端从构建配置读取 `EXPO_PUBLIC_ACCOUNT_API`，设置页不显示或要求用户填写服务地址。地址是公开配置，不是密钥。

**移动账号服务尚未部署。** 未配置时显示不可用，文稿和播放仍在本机使用。隐藏地址不代表已完成认证接入。详见 [当前状态](docs/account-integration-status.md)。

后端本地检查：

```sh
cd backend
npm ci
npm test
npm run check
```

`check` 是 Wrangler dry-run，不部署。正式接入需备份原 D1、演练恢复、验证旧站兼容，再批准具体生产变更。[部署步骤](docs/cloudflare.md) · [安全审查](docs/security.md)

## 架构

```text
App.tsx / src/ui       页面组合；独立播放、编排、账号、备份、句段和复习组件
src/core              严格模型验证、编排、专辑和跨篇时间线
src/resources         固定版本资源适配
src/services          本机保存、接口目录、认证、TTS 与缓存编排
modules/noxia-audio    Swift 系统语音、文件缓存、AVPlayer、媒体控制
backend               移动网关、私有身份扩展、SQL 与测试
```

版本锁定于 `package-lock.json`：Expo SDK 58 / React Native 0.88.1 / TypeScript 6。[编排](docs/engine.md) · [音频](docs/audio.md) · [本轮复查](docs/review-0.4.md) · [验证记录](docs/status.md)

## 限制

- 新版实体设备的锁屏、长时间播放、耳机、中断、多输出、大字体及玻璃效果仍需实机验收。
- 外部 TTS 已有实现和协议测试，未实连用户的服务；模型和声音质量不作未经试听的保证。
- 完整时间线恢复已在浏览器语音替身下验证；原生准备、锁屏跨篇和长时间恢复仍待实体设备验收。
- PDF / OCR、录音 / ASR、端侧模型、真正的多窗口 scene、Android 原生音频尚未实现。
- 本地采用 AsyncStorage，已加入版本迁移、迁移前备份和合并保存；大量资料的数据库选型、音频缓存配额和逐篇清理仍待实现。卸载前请将备份导出到应用以外。
- 云端目前只提供模板的显式手动同步入口；协议转换、分页和批次会话绑定已有测试。按账号隔离资料/缓存、离线待传和多设备删除仍未实现，账号服务继续关闭。

## 许可

自主代码采用 [MIT](LICENSE)。来源学习资料保留各自的个人非商业许可，不随代码分发；系统声音和模型权重不受本仓库 MIT 覆盖。[第三方声明](THIRD_PARTY_NOTICES.md) · [隐私](PRIVACY.md) · [安全](SECURITY.md)

设计审阅参考 Damir Sokolovsky 的 [unslop](https://github.com/heydamir/unslop)（CC BY 4.0）。未执行第三方安装脚本。
