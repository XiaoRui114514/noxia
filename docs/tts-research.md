# Noxia 语音方案核查

核查日期：2026-11-06。结论来自当前官方源代码、模型卡与文档；本环境未连接 iPad，**没有完成中文听感、iPad 内存、实时系数、锁屏持续播放的实测**。下载量、Star、作者基准不能替代这些验证。本文为技术与许可初筛，不构成权利保证。

## 当前选择

第一语音来源使用 Apple 已安装系统声音，不收取额外 TTS API 费用。通过 `AVSpeechSynthesizer.write(_:toBufferCallback:)` 生成设备内音频文件，缓存后交给 AVFoundation 播放。合成与播放分开：先在前台完成合成，再锁屏；不要把后台合成当作可靠保证。系统离线声音是否可用取决于该设备已安装的语言/音色，首次可能需用户去系统设置下载。

Apple 官方明确 `AVAudioSession.Category.playback` 支持静音开关及锁屏时播放；后台还需 `UIBackgroundModes: audio`。此为配置依据，**不是本项目真机验证结论**。系统可能终止 App，无法承诺强退后继续播放。静音停顿应为真实媒体时间的一部分，不能只在 JS 上 `setTimeout` 后启动下一句。锁屏信息与耳机控制使用 `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter`。

官方依据：

- [AVSpeechSynthesizer.write](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:))：返回可保存或处理的音频缓冲。
- [AVAudioSession playback](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)：锁屏及后台条件。
- [AVSpeechSynthesisVoice](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice)：枚举实际可用声音，不能假定每台 iPad 都有某个高级声音。

不打包或再分发 Apple 声音资产。App 内个人缓存与将系统合成音频作为商业音库再分发不同；后者应单独检查 Apple 适用条款。高级声音、个人声音、语言包与系统版本需分别测量，不能声称所有音色支持文件导出。若声音不可用，应明确报错并让用户选择本机可用声音。

## 开源方案对比

下表的磁盘大小来自官方模型文件元数据，**不是峰值运行内存**。推理还包含语言前端、tokenizer、声码器、工作缓冲；量化可能降低体积但可能改变质量。未下载模型权重到公开项目。

| 方案 | 中英与读音 | 体积/运行方式 | iPadOS 路径 | 许可结论与本期取舍 |
| --- | --- | --- | --- | --- |
| Apple 系统语音 | 普通话、英语按已安装音色枚举；中英混读宜按语言切片；古诗、多音字需听检和用户读音覆盖 | 系统提供，下载大小随音色变化；本地合成，无额外 API 费用 | AVSpeechSynthesizer + 原生播放器；无需服务端 | 首选；系统声音本体不再分发。质量、离线/锁屏真机待验 |
| Kokoro 82M | v1.0 多语言；另有官方 **v1.1-zh：中英 103 音色**，并非对所有旧音色的完全升级；前端用 misaki | v1.0 `.pth` 327,212,226 bytes；82M 参数；需要语言前端和voice文件 | 通过 sherpa-onnx / ONNX 原生桥接有可行路径，Python 包不能直接放入 Expo；量化、热量与内存待测 | 代码 Apache-2.0；官方两版模型卡标注 Apache-2.0；具体 voice、前端依赖及转换产物另审。下一阶段端侧候选，不默认捆绑 |
| sherpa-onnx | **推理运行时，不是单独音色模型**；支持 Kokoro、VITS、Matcha 等，语言/质量由模型决定 | 模型大小差异很大；CPU 离线推理，ONNX Runtime 及词典额外占空间 | 官方平台表支持 iOS，仓库有 iOS/Flutter TTS 示例；需写 Expo 原生适配并验证 ABI、线程和音频输出 | 运行时 Apache-2.0；不能把该许可证套到所有下载模型。优先评估 Kokoro 包，其次许可明确的小型中英模型 |
| MeloTTS | 官方说明 Chinese speaker 支持中英混读；中文多音字依赖语言前端 | Chinese `checkpoint.pth` 207,770,124 bytes，BERT/前端另计；作者称 CPU 可实时，尚非本项目实测 | 官方主路径 Python/PyTorch；ONNX 移植需验证分词、BERT和算子，集成成本高于原生运行时 | 代码 MIT，官方 Chinese 模型卡 MIT；仍需检查 BERT、词典等单独依赖。可自托管，不作为第一端侧方案 |
| CosyVoice | 当前官方 Fun-CosyVoice3-0.5B-2512，多语言、拼音/CMU 发音控制；声线克隆只能用有授权参考音频 | 0.5B；模型包包含约 988 MB safetensors、1.326 GB flow ONNX、约 969 MB tokenizer ONNX（不同变体非全部必需）；官方部署含 Python/CUDA/TensorRT/vLLM | 无已验证的 Noxia/iPad 端侧部署；优先自有服务器合成后下载缓存。算力、电费、服务器并非免费 | 代码 Apache-2.0，当前指定模型卡 Apache-2.0；ttsfrd 等额外资源逐项审查。不装入基础 App |
| Fish Speech | 当前 HEAD 是 **Drama 3 (35B-A3B)** / S2-Pro (4B)，不能依赖旧版教程；多语言、长对话，作者基准不等于古诗听感 | 服务器级推理；官方介绍 GPU/vLLM/SGLang。iPad mini 6 不宜作为默认离线方案 | 仅保留未来服务器 Provider 的可能，不宣称现有离线集成 | 当前代码/Drama 3 为 **Fish Audio Community License v1.0 (2026-10-13)**，S2-Pro 权重仍是独立 Research License。FACL 有营收门槛、署名、用途限制；**Hosted Service 需单独书面许可**。不分发、不默认接入，不能称无条件商用开源 |

### 已核查的上游快照

- [Kokoro](https://github.com/hexgrad/kokoro/tree/dfb907a02bba8152ca444717ca5d78747ccb4bec)，代码与 LICENSE；[v1.0 模型卡](https://huggingface.co/hexgrad/Kokoro-82M)、[v1.1-zh 模型卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/tree/01e7505bd6a7a2ac4975463114c3a7650a9f7218)。v1.1-zh 模型卡说明专业中文数据与众包合成英语数据来源；这是作者声明，不替代独立权利审查。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/tree/3e437b331fa273ae0819bc19659eb0f53efc03d3)、[官方 Kokoro 中英试听与模型说明](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html)、[运行时模型文档](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)。
- [MeloTTS](https://github.com/myshell-ai/MeloTTS/tree/209145371cff8fc3bd60d7be902ea69cbdb7965a)、[Chinese 模型卡](https://huggingface.co/myshell-ai/MeloTTS-Chinese)。
- [CosyVoice](https://github.com/FunAudioLLM/CosyVoice/tree/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc)、[Fun-CosyVoice3 模型卡](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)。
- [Fish Speech](https://github.com/fishaudio/fish-speech/tree/0f8a12e8a651062fdee9c33a894bdccd3a8513f1)、[当前 LICENSE](https://github.com/fishaudio/fish-speech/blob/0f8a12e8a651062fdee9c33a894bdccd3a8513f1/LICENSE)。许可证随版本变化，不能把当前许可套到历史权重。

## 免费云端与社区线索

进行了 GitHub、Hugging Face 与公开网页搜索，并尝试按 TikTok、抖音、YouTube、X 限站搜索。社交平台没有取得足以核实条款和稳定性的第一手资料，因此没有把短视频宣传、聚合网站“永久免费”当作已验证服务。公开讨论常推荐 Kokoro、自托管 MeloTTS、sherpa-onnx 以及 Edge/TikTok 包装接口；后两类存在私有接口、限流与授权不明问题，**本产品不使用 Cookie、私人接口、限额绕过或试用额度滥用**。

可进一步试听的社区线索有 [Kokoro-TTS-Local 中文说明](https://github.com/PierrunoYT/Kokoro-TTS-Local/blob/master/README_CHINESE_TTS.md)、[自托管中文经验](https://h89.cn/archives/528.html)。它们的运行速度和主观质量描述仅供选型线索，不是 Noxia iPad 测试结果。

Hugging Face Spaces 的公开演示不是生产服务承诺：可能休眠、排队、变更额度，上传的文本由第三方处理。用户私人讲义不得自动发送到社区 Space。不把某个免费网页抓取或非官方 TikTok/抖音/Edge 接口设为唯一语音源。

有文档依据的可选免费额度：

| 服务 | 核查结果 | 费用/操作边界 |
| --- | --- | --- |
| [Azure Speech](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/) | 页面列 F0 神经 TTS 每月 0.5 million 字符免费；并发与区域有限制 | 需用户自己的账户/资源；额度不是不限量；不自动开通收费 SKU。超额与 S0 价格以区域价格页为准 |
| [Google Cloud TTS](https://cloud.google.com/text-to-speech/pricing) | Legacy Standard/WaveNet 页面列每月 400 万字符免费，超出 $4/百万；Neural2 100 万免费，超出 $16/百万。新模型可能无免费额度 | 需项目、授权和可能的计费账户；按 voice/model 计费，不能一概称 Google TTS 免费 |
| [OpenAI](https://openai.com/api/pricing/) / [ElevenLabs](https://elevenlabs.io/pricing) | 当前环境访问价格页返回 403，未完成最新单价核验 | 只作为自带密钥可选 Provider；界面明确付费可能性，链接官方价格，不写未经核验的数字 |

DeepSeek 的对话接口可用于讲稿生成，**不由此推断其提供独立 TTS 服务**。LLM Provider 与 TTS Provider 是两个接口。任何模型/API变更都需重新确认费用；未开通付费服务或提交凭据。

## 合成与缓存约定

缓存标识至少包含精确文字、Provider、模型/版本、voice ID、语言、生成语速/音量/音高、发音覆盖版本、音频格式及系统语音的 OS 版本。重复次数不进入合成键：同一音频重复播放，不重复付费合成。播放倍速若仅通过播放器变速，不应重新合成。

每个结构单元单独合成。原文、译文、解释、用户文字保持可追溯边界，停顿与留白是时间单元。中英混读质量不足时使用显式语言片段；不要修改保存的原文来修音，保存独立的读音覆盖。公共仓库只放实现和示例配置，不包含用户缓存或下载权重。

离线准备应显示缺失音色、预计空间、生成进度和失败段落。失败时保留完成缓存；云端失败可让用户选择本地声音重新生成，**不悄悄向其他云服务转发私人文本**。

## 下一轮实机验证

在 iPad mini 6 与普通 iPad 上记录：系统/已安装声音、20句普通话、20句英语、中英混读、文言多音字、数字和标点；人工听检漏词/错音并保存公开测试文本。记录首次/缓存时延、峰值内存、连续30分钟发热与耗电。锁屏30分钟、耳机断开、来电/系统中断、切换输出、离线重启、睡眠到期分别验收。Kokoro/sherpa 只有在这些数据可接受后才进入默认下载方案。
