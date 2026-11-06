# 第三方许可与资源边界

Noxia 自主编写代码采用 [MIT](LICENSE)。该许可不授予第三方教材、学习资源、模型、音色、字体或商标的再分发权。

## 学习资源

- [XiaoRui114514/poetry-recite](https://github.com/XiaoRui114514/poetry-recite) 与 [XiaoRui114514/english-grammar-lab](https://github.com/XiaoRui114514/english-grammar-lab)：当前仓库为 Hison 个人非商业、保留权利许可，并非 MIT。Noxia 不随源代码分发这些仓库的数据、教材或个人记录，只提供独立适配代码。用户显式同意相应许可后自行下载；须保留来源、作者和原仓库许可链接。个人使用授权不等同于商业使用或再次公开分发授权。详见 [资源说明](docs/resources.md)。
- 自主编写的示例学习文本可以随 Noxia 分发；来源不明、第三方译注和私人讲义不得当作示例提交。

## 语音与模型

Apple 系统音色由 iPadOS 授权和管理，Noxia 不打包音色或系统资产。开源 TTS 研究不等于分发模型：本仓库不包含 Kokoro、sherpa-onnx、MeloTTS、CosyVoice 或 Fish Speech 权重。代码许可与权重许可应分别核对，商用和托管服务可能有额外限制。详见 [TTS 调研](docs/tts-research.md)。

## 设计参考

视觉参考 Apple 平台的导航、留白和易用性原则，不使用 Apple Music/Books 的品牌资产、截图或专有图标。Apple、iPadOS、iPad 和 Apple Music 为其权利人的商标。

设计审查参考 [heydamir/unslop](https://github.com/heydamir/unslop)，作者 Hey Damir，CC BY 4.0。仅参考设计检查思路，未安装或运行其远程脚本；具体版本与审查记录见 [设计 Skill 审查](docs/design-skill-review.md)。

## 软件依赖与字体

实际直依赖许可证清单见 [docs/dependency-licenses.json](docs/dependency-licenses.json)。每个依赖包中所附 LICENSE/NOTICE 仍是权威来源，分发应用时应保留要求的声明。间接依赖随锁文件解析，升级后须重新审查，直依赖清单不覆盖全部传递依赖。

界面使用系统字体。`@expo/vector-icons` 的代码许可证与各图标字体许可不同；应用使用的 Ionicons 归 Ionic 团队所有并以 MIT 授权。若日后切换到其他图标集，须检查该字体单独的许可。Expo 初始工程的占位资源仅用于开发，正式商店发布前须替换并核实自主设计资产。

锁文件中包含的其他许可需要保留其原始声明：

- `caniuse-lite` 浏览器兼容性数据（CC BY 4.0，Browserslist/caniuse-lite）：[源代码与许可](https://github.com/browserslist/caniuse-lite)，用于构建兼容性分析，不是 Noxia 自主素材。
- `lightningcss` 及其平台二进制（MPL 2.0，Parcel）：[源代码与许可](https://github.com/parcel-bundler/lightningcss)，构建依赖，不修改其受 MPL 保护的文件。若未来分发修改版，须遵守文件级源码公开义务；Noxia 的 MIT 不覆盖它。
- `argparse`（Python 2.0 许可，nodeca）：[源代码与许可](https://github.com/nodeca/argparse)。

使用 `node scripts/license-inventory.mjs` 可从锁文件和已安装包重新生成清单，不执行安装或访问凭据。软件包的许可证文本随 `npm ci` 下载；制作二进制发布包时还须将实际打包依赖所要求的版权与许可证文本纳入 About/法律声明或随附文件。
