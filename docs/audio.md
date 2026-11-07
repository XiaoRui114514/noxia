# 音频实现与验证边界

## 当前实现

`modules/noxia-audio` 是本地 Expo Module。iPad/iPhone 使用 Apple `AVSpeechSynthesizer.write` 将各个朗读步骤逐一生成为 Application Support/Noxia/Audio 下的 PCM CAF 文件，再用 `AVMutableComposition` 拼出精确的播放时间线，交给 `AVPlayer` 播放。留白是实际的 PCM 静音音频，因此留白和重复都在原生媒体时间线上，不靠页面的 JavaScript 定时器推进。每次准备上限为 1000 步、15 万字、8 小时；单次留白不超过 10 分钟。首个版本在完整计划准备完后才播放，长列表首次生成可能需要较长时间。

异步的计划准备与系统语音渲染方法显式标记 `@MainActor`；包括等待音轨/时长加载之后，状态与 composition 的后续修改仍回到主 actor。同步桥接入口及音频回调也统一在主线程执行，避免仅在外层 Task 标主 actor、内部未隔离的 async 方法却切换到其他 executor 所产生的状态竞争。音频缓冲分批写盘，不在内存中累积整段 PCM。

系统已安装声音无需购买 Noxia 的 TTS 套餐，不向 Noxia 后端上传文字。实际声音清晰度、中文多音字及中英混读效果需要用户试听；未宣称达到商业云声音质量。高质量系统声音可能需要用户先在 iPad「设置 → 辅助功能 → 朗读内容 → 声音」下载。声音列表和可用质量以设备为准；不附带或重新分发 Apple 声音文件。

声音列表也返回系统提供的 gender（male/female/unspecified），不依据声音名字猜测性别。浏览器 API 没有标准性别字段，统一返回 unspecified。

缓存键是 SHA-256，覆盖原文字、应用读音替换后的文字、系统语音实现版本、OS 版本、声音 identifier、有效合成语速、音量和完整读音字典。重复次数不进入键，同一句重复播放只引用同一份音频。CAF 是 Apple 支持的 PCM 容器，此处没有伪称输出 MP3 或 WAV。读音替换仅用于朗读，保留原文；它是文字替换，不是语言学级别的音素字典。

一个 plan 可以包含多篇材料：各步骤可附带 `resourceId/title/author`，原生时间线自然跨篇推进，状态报告当前 resourceId，并在步骤改变时刷新锁屏标题与作者；这些纯展示元数据不进入语音缓存键。锁屏时长与进度反映整个已准备的时间线。原生前后句比较 resourceId 与 segmentId，并按连续步骤查找，避免不同篇目的同名句子 ID 互相跳转。跨篇所有步骤仍受同一个 1000 步/15 万字/8 小时计划上限约束。

状态还提供 `resourcePosition/resourceDuration`，按当前连续 resourceId 区块的起止时间计算本篇相对进度；同一材料在列表中非连续出现时分别计算。缺少 resourceId 时返回整个计划的进度。应用层可据此保存本篇恢复点；完整播放列表会话恢复仍需单独保存列表和编排状态，不能仅凭本篇进度宣称已恢复整个会话。

缓存是本地私人文件，排除 iCloud 备份，使用 completeUntilFirstUserAuthentication 文件保护；设备首次解锁后可以继续锁屏读取。清理缓存会卸载当前准备好的音频计划，需重新准备。D1 不保存音频文件。PCM 缓存可能很大，暂未自动按大小淘汰，用户可在缓存管理页查看及清空；缓存生成期间不要锁定为“仅设备解锁时可访问”的外部文件提供器。

## 用户自带服务的音频文件

原生接口 `getExternalAudio(key)` 查询 `external-${key}.mp3`，父层必须在收费服务请求之前查询，避免已缓存内容再次合成。`cacheExternalAudio(base64,key)` 接收最多 10 MiB 的单段 MP3；key 只允许 64 位十六进制摘要，服务地址、文本、模型、音色、合成语速和其他影响结果的参数须由调用方纳入摘要。模型或声音费用属于用户配置的服务，缓存不是免费额度，也没有绕过付费或私人接口。

写入时先生成随机临时文件，检查 MP3/ID3 文件头以及 AVURLAsset 可读取的音轨和时长，设置文件保护，再原子移动为最终文件。同一摘要已存在时复用；缓存未写完时禁止清空缓存。合成响应或 API 密钥不会写入日志。外部 MP3 与系统 CAF 一同计入缓存统计和清理。

播放计划的 `file` 步骤只接受本 App 的 Application Support/Noxia/Audio 目录内实际存在的普通 `.mp3/.caf` 本地文件，拒绝网络地址、非本机 file host、路径前缀伪装、目录、临时文件及越界符号链接；规范化并解析符号链接后才校验带目录分隔符的根路径。仅完成源码审查，不能将此视为已执行 iPad 沙盒测试。

文件步骤的语速由服务合成时烘焙，原生不再次按 step.rate 变速；全局播放器倍速仍正常工作。文件音量使用 AVMutableAudioMix，在各步骤起点设置 gain；系统语音音量已经写入 PCM，其 mix gain 回到 1，避免重复乘音量。文件仍使用现有留白、逐句、跨篇、锁屏和睡眠时间线，metadata 不变。

外部缓存和 file 步骤属于后续新增代码，文末首次原生构建成功记录不覆盖这些新接口；当前新增验证是编码/大小/摘要边界及 Web 明确拒绝播放的单元测试，仍等待新一轮原生编译与运行验收。

## 后台与媒体控制

生产配置必须含 `UIBackgroundModes: ["audio"]`。模块激活 `.playback / .spokenAudio` 的 `AVAudioSession`，设置 `MPNowPlayingInfoCenter` 的标题、作者、总时长、当前进度及速率，并连接播放、暂停、停止、前后句、前后 15 秒与锁屏进度控制。首个版本没有锁屏封面图。

系统中断开始时暂停，只有系统标记 `shouldResume` 且用户原本仍想播放时恢复。拔掉耳机/旧输出设备断开时暂停，避免自动转为外放。媒体服务重置时提示重新准备，不保证无缝恢复。AirPlay、蓝牙、控制中心及耳机按钮均尚待真机验收。

播放进度由原生播放器每 2 秒存储轻量恢复标记，重新准备相同 plan id 时恢复。App 完全退出后不会自动在后台重新启动播放；用户重开 App 并选择内容后恢复。突然终止可能丢失最后约 2 秒进度。现阶段只持久化最后一个原生 plan 的恢复点；应用层历史可以另外保存多篇记录。

到达音轨末尾后再次播放，会先等待原生 seek 回到起点完成，再启动播放。回调核对用户仍要求播放、当前音轨与计划 generation 未变、未在重新准备且睡眠期限未到；中途暂停、停止或换内容时不自动重启。此路径直接启动播放器，不递归调用 play，避免极短音轨反复进入末尾判断。该顺序修复仍需模拟器或真机运行验证。

## 睡眠定时

截止时间和渐弱在原生层：原生 run-loop timer、`AVPlayer` 周期观察及媒体时间边界观察共同检查绝对截止时间。UI 被卸载或 JavaScript 暂停不参与计时。到期暂停并停用会话，留白也属于媒体播放时间。更改速率、seek 会重设边界观察；若用户暂停直到超过截止时间，再次播放会直接到期停止。

这不是系统级闹钟，不保证在 App 被杀死、设备关机、iPadOS 挂起应用且没有活跃音频时按墙钟精确唤醒执行淡出。正在播放时的锁屏停止及渐弱必须用真实 iPad 长时验证。不要把本实现或 Expo Go 前台成功当成已完成后台验收。

## 浏览器与其他平台

Web 预览使用 `speechSynthesis`，语音时长为估算，seek 回到句首，语速变更作用于下一句，不支持可靠后台、音频导出或持久音频缓存，浏览器 tab 休眠会影响计时。浏览器可能提供需网络的声音，标为 browser-network，不能保证离线。它只服务于开发界面预览。

当前 Web 的外部音频缓存接口仅返回经过大小及编码校验的内存 data URI，查询持久缓存返回 null；`prepare` 遇到 file 步骤会明确报错要求 iOS 原生构建，不能假装成功或用文字估算进度代替音频播放。外部文件 Web 播放尚未实现。原有系统语音预览不受此限制。

Expo Go 不含此原生模块，不可用来验收 iOS。Android 原生引擎未实现；接口保留，当前不会声称支持 Android 后台能力。应使用 Development Build、EAS 云端 iOS build 或本机合适 Xcode 构建。

## 原生验证状态

开发环境为 Linux，没有 Swift 编译器、Xcode、Apple 签名身份、连接的 iPad 或 iOS Simulator。2026-11-07 已通过 [GitHub macOS 原生 Release 构建](https://github.com/XiaoRui114514/noxia/actions/runs/42341080976)（Xcode 26.6 / Swift 6.3.3），但**尚未完成实体 iPad 安装或音频真机测试**。必须完成以下验收后才可称为稳定后台版本：

已在当前安装的 Expo SDK 58 依赖下执行 `expo-modules-autolinking resolve --platform apple --json`，确认发现本地 NoxiaAudio pod 和 NoxiaAudioModule。Web 预览的完成事件推进、留白时长、取消后的陈旧回调、step seek、sleep 截止、读音替换及引擎不可用行为有 Vitest 测试；这些测试不覆盖 AVFoundation。SDK 58 的 ExpoModulesCore 要求 iPadOS/iOS 16.4+ 与新的 Swift/Xcode 构建工具链，不应承诺旧 Mac 本机可构建。

- 安装声音后断网准备/播放、中文/英语/混读、长文、相同步骤缓存命中、损坏缓存恢复。
- 屏幕锁定 30–120 分钟、长留白、无限循环、sleep 到期、淡出、seek 后 timer、倍速后 timer。
- 耳机断开、蓝牙/AirPlay 切换、Siri/闹钟/其他音频中断、控制中心与耳机命令。
- 启动后首次解锁前文件保护行为、强制退出后恢复、缓存清理与磁盘空间不足。
- iPad mini 6 的内存和合成速度；1000 步 composition 的准备时间与内存。

参考：[Apple write(_:toBufferCallback:)](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:))、[后台音频](https://developer.apple.com/documentation/avfaudio/configuring-your-app-for-media-playback)、[MPRemoteCommandCenter](https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter)。
