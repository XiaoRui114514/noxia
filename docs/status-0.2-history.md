# 0.1 / 0.2 历史开发记录

以下保留当时结论，不代表当前 0.3 验收状态。

## 当前阶段

2026-11-07 继续：用户已创建私人仓库 `XiaoRui114514/noxia`，代码已推送并保持私有，远程常规 CI 与首次原生构建通过；不会修改可见性或付费设置。

0.1 开发版：实际代码、可运行 Web 版、原生系统语音模块、云端账号扩展与测试已完成第一轮集成。**尚未交付可安装的签名 iPad 应用，不满足整体验收。**

## 本地实际验证

- Linux / Node 24.22.1 / npm 11.9.0；GitHub 身份 XiaoRui114514 可用；无 Xcode、Swift、Apple 签名、Expo 或 Cloudflare 已配置凭据。
- Expo SDK 58.0.23 / RN 0.88.1 官方当前 blank-typescript 模板初始化，`expo install --check` 兼容检查通过。
- `tsc --noEmit`、核心／资源／Web 音频／客户端服务 Vitest 与独立后端测试。
- 编排及跨篇会话30项、资源7项、Web音频9项、AI与同步客户端17项；后端15项。实际最终计数以本仓库测试输出为准。
- Chromium E2E 10项：1194×834、744×1133、507×768、390×844；文稿与双语单元保存刷新、模板编辑保存、未接受许可不请求资源、深色持久化、前台语音控制，以及跨篇列表／单篇语速持久化、标题与正文切换、两篇自然完成记录及睡前模式默认30分钟／手动整晚切换。语音测试桩不证明声音或后台质量。
- `expo export --platform web` 完整 JS 导出通过；`expo prebuild --platform ios --no-install` 生成 iOS 项目通过；Apple autolinking 发现 NoxiaAudioModule。预生成原生目录按 Expo 流程忽略，不提交。
- 后端 15 项测试使用 Node 内存 SQLite，Wrangler dry-run 可打包；无真实账号、D1 或 Service Binding 访问。
- 依赖审计已修正 glob/minimatch 构建依赖，`npm audit` 根包和后端均 0 已知漏洞。静态凭据及私人文件扫描通过；不代表没有未知漏洞。
- Expo Doctor 的远程 schema / React Native Directory 检查因网络服务访问失败未完成。其发现的直接 expo-modules-core 依赖已移除，改用 expo 导出；不要把 Doctor 描述成全通过。
- 两个来源仓库只读副本未修改。实际来源检查：199篇、1797句显式译文对应；12语法专题214个知识卡朗读段；不分发内容和真实用户数据。

## 原生验证与发布门禁

[首次原生工作流](https://github.com/XiaoRui114514/noxia/actions/runs/42341080976) 已实际通过 macOS 无签名 Release 编译；Xcode 26.6、Swift 6.3.3，含 NoxiaAudio Swift 模块。 无签名模拟器构建不能安装到真机。

iPad 安装及后台播放的最终门禁：Apple 团队／签名、EAS 项目、iPad 注册；在 iPad 真机检查锁屏1小时、静音留白期间后台、睡眠停止和渐弱、暂停恢复、耳机断开、来电／其他媒体中断、AirPlay／蓝牙、重启恢复、断网、内存及系统多任务。没有执行这些测试。

Cloudflare 门禁：备份可恢复、staging 兼容旧站点、用户审批具体迁移、秘密与绑定配置、真实限流／免费CPU验证。两个后端发布开关默认 false，未改线上认证。

## 继续开发

1. 建立目标空仓库后运行原生云编译，修复发现的问题，再由真实 iPad 完成音频验收。
2. 已将多篇列表、独立模板／音色／语速、随机与有限重复编译成完整原生时间线；继续验证后台跨篇，并补完整会话恢复与后台历史日志。
3. 本地数据库迁移、备份导出、缓存配额；更完整的AI生成历史与持久去重缓存、更多TTS provider。
4. 按已审查流程部署移动账号扩展，完成按账号分区的同步状态、全类型双向同步、冲突界面和自动重试。
5. PDF文本提取、真正多窗口scene、iPad外接键盘快捷键、可选端侧TTS、Android原生播放器。

## GitHub 实际阻碍

本地 Git 已提交自主代码，使用 GitHub noreply 作者地址。当前 GitHub App 有 contents/actions/workflows write，但不具备创建仓库权限。GraphQL createRepository 与 REST POST /user/repos 均返回 Resource not accessible by integration（403）。上轮未创建仓库、未推送或执行 GitHub Actions。2026-11-07 用户已创建私有空仓库，该创建权限阻碍已解除；本轮继续推送。没有对其他仓库推送或改动。

最终本地检查：`npm ci` 可重现、63项应用单测和15项后端单测通过，完整9项原有E2E通过，新增睡前默认定时另项检查；iOS Hermes JS 导出成功（不是Swift编译）。GitHub创建两种API均被权限拒绝，无远程Actions结果。

## 2026-11-07 远程验证

- 私有仓库已推送： https://github.com/XiaoRui114514/noxia ，main 初次远程 SHA `2a10fdf`。未改为 Public。
- [常规 CI 42341081073](https://github.com/XiaoRui114514/noxia/actions/runs/42341081073)：app 与 backend 全通过，63 项应用单测、15 项后端单测、10 项 E2E、静态检查、凭据扫描、Web 导出和依赖兼容检查成功。
- [原生构建 42341080976](https://github.com/XiaoRui114514/noxia/actions/runs/42341080976)：Release iOS Simulator 构建成功。尚未签名，不能安装实体 iPad。后续增加临时 iPad 模拟器启动／截图验证，结果不预先标为成功。
- 仅使用现有标准 GitHub runner，不启用 EAS 付费构建，不调整 GitHub 套餐／预算。当前连接无读取账单权限，实际私有仓库额度与使用量需账号持有人在 GitHub 查看。

## 真机 IPA 交付路径

用户说明拥有普通 Apple ID，且已有签名方式，当前只需 IPA。因此新增 `Build iPad IPA for personal signing`：iphoneos SDK / ARM64 / Release / 不使用签名凭据；校验 iPad 支持、Mach-O 平台、Payload 与内置 main.jsbundle，并输出 SHA-256。模拟器 UI 工作流转为手动，当前扩展模拟器运行已主动取消以优先完成真机包；不将未执行的启动或语音场景记为通过。真机包构建结果待实际 Actions，不预先标通过。

## 2026-11-07 IPA 实际交付结果

- [设备构建 42342289923](https://github.com/XiaoRui114514/noxia/actions/runs/42342289923) 全通过；来源提交 `ab6f56c`，iphoneos SDK、ARM64、Release archive，未使用 Apple ID、签名身份或私有服务密钥。
- `Noxia-unsigned.ipa`：8,438,488 bytes；版本0.1.0（build1）、bundle ID `com.noxia.app`、最低 iPadOS16.4。
- SHA-256：`7270aecec97c1ae2d7d98513d32ccecc2adc3368f739216cc569613f80909a7e`。
- 构建脚本与交付工作区独立复核 ZIP CRC、Payload、Info.plist、iPad设备族、ARM64 Mach-O及物理iOS LC_BUILD_VERSION平台2、audio后台声明、内置NoxiaAudioModule及main.jsbundle。不是模拟器包。
- Actions产物 `Noxia-iPad-IPA-to-sign` 已生成；提取IPA与校验码到交付工作区。仓库保持 PRIVATE，没有生产部署或账号迁移。
- 用户已有签名方式；只需由用户自行签名安装。本次没有实体设备连接，因此不把“真机目标构建成功”当作“已安装或锁屏播放通过”。
- `42342053155` 扩展模拟器流程按用户“只需IPA”的指示主动取消；取消前Ruby语法检查与UITest目标生成已通过，启动和系统语音UITest未执行。不能将该取消记为音频测试成功或应用构建失败。
- 常规CI `42342289911` 已通过（63应用单测、15后端单测、10浏览器E2E）。

## 0.2 改进与公开

用户已于 2026-11-07 将仓库设为 Public，已通过 GitHub API 核实。当前工作包括黑白主题、原生玻璃与降级材质、自适应导航、短文案、账号入口置顶及隐藏构建配置、模型目录自动读取和外部 TTS 缓存播放。文案偏好记录于 AGENTS.md。

本地验证：类型检查、129 项应用单测、12 项 Chromium 交互测试、安全扫描和依赖兼容检查通过；依赖审计 0 已知漏洞。新增声音服务只使用模拟响应测试，未实连第三方账号；移动账号网关仍未部署。0.2 的新 Swift 缓存接口、玻璃依赖与更新 IPA 等待本轮真实 macOS 构建结果，不复用旧版成功状态。

### 0.2 构建结果

- [常规CI 42369539146](https://github.com/XiaoRui114514/noxia/actions/runs/42369539146) 成功，129项应用单测、15项后端单测、12项浏览器测试及静态/导出检查通过。
- [真机目标构建 42369539176](https://github.com/XiaoRui114514/noxia/actions/runs/42369539176) 成功，来源 `d32351c`。版本0.2.0 / build2 / ARM64 / iphoneos / 最低iPadOS16.4。
- IPA 9,633,795 bytes；SHA-256 `df34055190488b7878b52813d253d466b2ef745e40ead6fe34c524bc746d68ee`。已独立复核ZIP完整性、iPad设备族、物理iOS平台、后台audio声明、NoxiaAudio与GlassView原生代码以及Release脚本。
- 新版IPA已提取为交付文件 `Noxia-0.2.0.ipa`，由用户自己的签名方式处理。没有代签、真机安装、锁屏或真实外部TTS服务验证。
- 仓库已公开；账号服务没有部署，当前界面明确不可用，不能将隐藏地址当作接入成功。
