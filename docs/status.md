# 开发记录 · 2026-11-06

## 当前阶段

2026-11-07 继续：用户已创建私人仓库 `XiaoRui114514/noxia`，保持私有并准备推送、运行现有 GitHub Actions；不会修改可见性或付费设置。

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

GitHub 的 `Build iPad simulator` 工作流将进行真实 macOS 无签名 Release 编译。**编译结果必须看 Actions 运行，本文不预先声称通过。** 无签名模拟器构建不能安装到真机。

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
