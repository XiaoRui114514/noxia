# iPad 模拟器系统语音 UI 测试

`tests/ios/NoxiaUITests.swift` 是 XCTest UI 集成场景，实际启动 Release 应用、操作现有 React Native 控件，并等待 Apple 系统语音合成及 AVPlayer 播放。没有注入假音频、Web Speech、私人文稿、麦克风或付费接口。

测试从首页「写一段文字」进入编辑器，使用 `作品标题` 单行 `UITextField` 和 `输入或粘贴文字。可从 TXT / Markdown 导入。` 多行 `UITextView` 输入原创英文，保存后点击底部迷你播放器。随后读取 `播放进度，点击定位` 的辅助功能百分比，检查前台推进、按 Home 后后台三秒再返回的推进、暂停时静止与恢复后的继续推进。每个阶段及最终界面都以 `XCTAttachment` 保存截图；最终附件还包含辅助功能层级，因而必须只在全新的测试模拟器中执行。

这些检查只是模拟器原生集成证据。它们不验证真机锁屏、实际可听音质、后台长期稳定性、睡眠定时、耳机、系统中断、Apple 签名、TestFlight 或可安装的 iPad 发行包。跨 Home 区间的百分比比较也不能替代真机音频连续性观测。

## 添加测试目标

先完成项目正常依赖安装、Expo iOS prebuild 和 CocoaPods 安装。使用已经安装 CocoaPods 的同一个 Ruby 环境执行：

```sh
ruby scripts/add-ios-ui-tests.rb
xcodebuild -list -project ios/Noxia.xcodeproj
```

脚本通过 CocoaPods 已有的 `xcodeproj` gem 创建 `:ui_test_bundle` 目标、源码引用、应用依赖、`TestTargetID` / `TEST_TARGET_NAME`，以及独立共享 `NoxiaUITests` Scheme。目标仅支持 iPad 模拟器，测试配置为 Release，不修改应用目标、Podfile 或原有 Noxia Scheme，不安装额外 gem / Pod。重复执行不会重复添加目标、依赖或源码。`expo prebuild --clean` 会重建生成目录，因此需要重新运行脚本。

若 `require 'xcodeproj'` 失败，应选择提供现有 CocoaPods 的 Ruby；已有 Bundler 项目可以用 `bundle exec ruby scripts/add-ios-ui-tests.rb`。不要因为 macOS 存在另一个 Ruby 就额外修改项目 Pod 依赖。

## 执行

需要 macOS、兼容当前 React Native / Expo 的 Xcode、已安装的 iOS 模拟器运行时，以及全新 iPad 模拟器。这里的 UUID 必须是新建测试 iPad 的 UUID；可使用 `xcrun simctl list devices available` 查看设备和运行时。请勿指向包含个人资料的已有模拟器。

```sh
xcodebuild test \
  -workspace ios/Noxia.xcworkspace \
  -scheme NoxiaUITests \
  -configuration Release \
  -destination 'platform=iOS Simulator,id=REPLACE_WITH_NEW_IPAD_UUID' \
  -derivedDataPath build/ios-ui-tests \
  -resultBundlePath build/ios-ui-tests.xcresult \
  -only-testing:NoxiaUITests/NoxiaUITests/testOriginalTextSystemSpeechPlaybackAndBackgroundProgress \
  -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO
```

Release 构建须正常嵌入 JS bundle；测试不连接 Metro。不应设置 `SKIP_BUNDLING=1`，也不应通过启动 Debug Dev Client 替代本场景。模拟器 unsigned 测试不需要拥有 iPhone、Apple 开发者签名或付费 TTS。模拟器产物不能安装到真实 iPad。

用 Xcode 打开 `.xcresult` 查看断言、截图及失败层级。该命令应由 CI 保留退出状态并上传结果包；当前任务只添加测试与脚本，已纳入 `Build iPad simulator` 工作流；本轮结果以实际 Actions 为准。

## 跳过与失败边界

仅当应用明确显示以下原生声音资源错误之一，场景才抛出 `XCTSkip`，并保留截图和确切原因：

- `请先在 iPad 设置中安装中文或英语系统声音。`
- `所选音色未安装，请重新选择系统声音。`
- `This system voice produced no audio. Download a voice in iPad Settings.`

跳过表示该环境未验证系统语音，不等于通过。没有暂停按钮、语音准备超过 120 秒、原生模块缺失、应用崩溃、错误进度值、进度不推进、暂停仍推进等情况均失败，不能因猜测模拟器有局限而跳过。测试不自动联网下载声音，也不打开收费服务。

## 已核实的 API 与当前验证状态

脚本依据 [CocoaPods Xcodeproj 1.27.0 的 Project API](https://github.com/CocoaPods/Xcodeproj/blob/1.27.0/lib/xcodeproj/project.rb)、[目标 helper](https://github.com/CocoaPods/Xcodeproj/blob/1.27.0/lib/xcodeproj/project/project_helper.rb)、[target 依赖与源码 API](https://github.com/CocoaPods/Xcodeproj/blob/1.27.0/lib/xcodeproj/project/object/native_target.rb)、[UI test 产品类型](https://github.com/CocoaPods/Xcodeproj/blob/1.27.0/lib/xcodeproj/constants.rb) 和 [Scheme API](https://github.com/CocoaPods/Xcodeproj/blob/1.27.0/lib/xcodeproj/scheme.rb) 编写；使用公开的 `new_target`、`add_file_references`、`add_dependency`、`configure_with_targets`、`save_as`。

Swift 场景已核对 Apple 官方 [XCUIDevice.press](https://developer.apple.com/documentation/xcuiautomation/xcuidevice/press(_:))、[XCUIApplication.activate](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/activate())、[wait(for:timeout:)](https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/wait(for:timeout:))、[元素 value](https://developer.apple.com/documentation/xcuiautomation/xcuielementattributes/value)、[截图附件](https://developer.apple.com/documentation/xctest/xctattachment/init(screenshot:)) 与 [XCTSkip](https://developer.apple.com/documentation/xctest/xctskip-swift.struct) 声明。百分比解析也核对了当前仓库安装的 React Native Fabric `RCTViewComponentView.mm` 对 `accessibilityValue` 的实现。

编写环境为 Linux，没有 Ruby、Xcode 或 iPad 模拟器，因此尚未执行 Ruby 语法检查、生成后项目验证或 XCTest 编译运行。不能将本测试文件的存在视为模拟器或真机通过；macOS CI 的实际 `.xcresult` 才是后续状态依据。
