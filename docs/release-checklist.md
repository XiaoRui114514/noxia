# 公开发布与真机验收

本清单记录验收方法，不把“有代码”视为“已通过”。最终执行结果见 README 与测试记录；未填写的项目均未验证。

## 开源前

- [x] `npm ci` 能用锁文件重现安装，`npx expo install --check` 通过。
- [x] 类型检查、应用单测、后端单测、Web 导出通过。
- [x] 安全扫描通过，人工复核暂存区及提交历史中没有凭据、个人数据、导入文件或音频。
- [x] 审查依赖、图标、示例资源及资源适配许可；不上传第三方权重和非商业学习资料。
- [x] README 将已实现、未部署、未编译和未真机验证明确区分。
- [ ] GitHub 仓库使用新项目地址；不修改、重写或强推两个现有学习仓库。

## 无签名 iOS 编译检查

[Build iPad simulator](../.github/workflows/ios-simulator.yml) 可在 `main` 推送或手动运行，在 GitHub 标准 `macos-latest` 主机生成 iOS 工程、安装 Pods，并以 Release 配置构建 `generic/platform=iOS Simulator`。无需 EAS、Apple Developer 签名或生产密钥；编译日志和 xcresult 保留 7 天。此流程首次远程执行完成前仍标为未验证。

已从实际安装包核对：React Native 0.88.1 的 `scripts/cocoapods/helpers.rb` 声明 Xcode 最低 16.1；Expo SDK 58 的 `ExpoModulesCore.podspec` 要求 iOS 16.4、Swift 6.0。实际 CocoaPods 解析和 CI 编译结果才可证明当前依赖链兼容，不能仅凭最低版本声明认定旧 Mac 可构建。

- [x] GitHub macOS job 实际执行并产生成功结果：[首次构建](https://github.com/XiaoRui114514/noxia/actions/runs/42341080976)。
- [x] 检查 NoxiaAudio Swift 编译日志及依赖目标；首次编译成功，后续主线程修复继续复验。

## iPad 开发构建

需要 Apple Developer Program 的有效成员资格、签名权限及 EAS 账号，或兼容 Xcode 的 Mac 本地构建。EAS 云构建不会免除 Apple 签名和安装限制。Ad Hoc 内部分发需要先登记目标 iPad UDID；TestFlight 构建需上传 App Store Connect，外部测试可能需要 Apple 审核。Expo Go 不能验证自定义原生模块。

- [ ] EAS iOS development/preview 构建真正编译成功并保留构建链接。
- [ ] 在 iPad mini 6 或其他真实 iPad 安装并启动。
- [ ] 横屏、竖屏、分屏、系统支持的多任务模式、大字体、VoiceOver、减少动态效果。
- [ ] 免费系统语音生成，离线缓存复播，音色缺失和存储不足恢复。
- [ ] 锁屏连续播放至少 30 分钟，逐句高亮与恢复进度正确。
- [ ] 耳机播放/暂停/前后跳转、耳机拔出、蓝牙输出切换、电话或系统音频中断。
- [ ] 锁屏留白自背与睡眠定时、音量渐弱、有限及无限循环均按配置停止。
- [ ] 长篇内容的前台合成时间、缓存命中、内存峰值及队列上限。
- [ ] 在断网、AI API 错误、无效资料、损坏模板等情况下可恢复。

## Cloudflare 上线前

- [ ] 取得生产变更授权，备份原 D1，并在独立数据库演练迁移与回滚。
- [ ] 私有身份扩展与网关 service binding 配置完成，默认关闭公开身份 Worker。
- [ ] 旧网页登录/退出/同步兼容；旧账号哈希渐进升级策略已演练。
- [ ] 移动会话过期、退出、密码变更撤销、限流、越权、并发更新冲突及离线保留通过。
- [ ] 实际部署 URL、绑定及 secrets 配置完成，日志无敏感正文。

不得为了完成清单而模拟签名成功、真机通过、生产部署或账号同步成功。
