# 学习资源适配与许可

检查日期：2026-11-06。只读检查两个仓库，没有修改其源码、历史、部署或私人学习记录。

| 来源 | 审查版本 | 实际结构 | 许可 |
| --- | --- | --- | --- |
| [poetry-recite](https://github.com/XiaoRui114514/poetry-recite) | `47dee16aea10c547a61adfbffcef52385d08995f` | `data/junior.js` / `senior.js` 是 IIFE；`meta/poems.json` 有显式原文句子、主旨、考试重点；`data/translations/poems/batch-01..11.json` 为译文数组 | Hison 保留所有权利，允许个人非商业自学；不是 MIT |
| [english-grammar-lab](https://github.com/XiaoRui114514/english-grammar-lab) | `b7bf67996c7862664a346053c4d801ba83bf9fcf` | `data/bank-tense-01..12.js` 向 `window.__GRAMMAR_LAB__` 注册知识卡、例句、题目和解析；`curriculum.js` 是分类，不代表全部分类已有题库 | Hison 个人非商业许可，完整分享有署名与完整性要求；不是 MIT |

来源最新提交时间均为 2026-11-01。这里记录的是本次实际检查版本，不把 README 中的旧功能描述作为接口依据。

## 开源边界

Noxia 仅公开独立编写的适配器及虚构测试数据，不打包这两个仓库的文章整理、译文、题库、讲义、品牌代码或个人学习记录。MIT 仅覆盖 Noxia 自有代码。源资料不会因通过 Noxia 下载而转成 MIT，也不能自动用于商业产品。

来源署名保留为：Hison，抖音 XRuiiiiii，小红书 xiaoruiaaa520。运行时下载前须展示来源许可与个人非商业使用说明，由用户主动选择。完整许可链接随条目及导入的资源保存。若计划商业分发来源内容或改变来源署名，需另行取得适用授权。

## 对应关系

诗文不做任何标点切句。优先读取上游已提供的 `meta/poems.json.sentences`，按篇目 `id` 查找译文，再要求原文数组与译文数组严格等长；任一不符，所有逐句译文停止配对并显示警告，不将后续译文向前挪动。

原文索引也是 `examFocus[].index` 的对应索引，越界重点被忽略。原文的字词、引号和标点保持来源原样。源库的翻译重建工具表明该显式句序来自上游数据库的句序，不是 Noxia 重新推断。数组相等只能证明结构对应，不代表译文含义已经逐句通过人工教材核验。

英语仅提取知识卡中的概念、结构、情景、例句、常见错误、判断方法及复习总结。例句内中文括注整体保留，不推断独立双语映射，不把学生真实作答导入。题目和解析未来可按原始题目 ID 扩展；当前音频资源不把题库、错题或练习记录标为已接入。

## 接口

```ts
import { listRemoteResources, loadRemoteResource } from '../src/resources';

// 在用户阅读许可并主动选择下载后调用。
const options = { acceptPersonalUseLicense: true };
const entries = await listRemoteResources('poetry', options);
const resource = await loadRemoteResource(entries[0], options);
// resource 存入本地文档库后，不依赖网络即可使用已下载文字。
```

`Resource` 包含稳定 ID、类型、标题、作者、逐句原文与可选译文、重点、版本、来源链接、署名、许可链接、警告。`source.repo/path/version/url` 供历史及复习来源关联。`reviewUrl` 当前指向原仓库入口；没有假设部署域名或虚构可直接跳入练习的 URL。

下载地址固定在审查过的 repo、commit 和路径。目录不能注入任意 URL。单文件限制 3 百万个字符；网络失败明确报错，调用方应保留原有本地数据。目录与资源下载当前依赖 GitHub 网络可用，已保存的本地资料不应随刷新被删除。未来可加入资源版本检查，但更新必须重新验证结构、许可和对应关系，当前不会静默跟随 main。

英语文件为 JavaScript，但从未使用 `eval`、`Function` 或 WebView 执行远程代码。适配器扫描专题注册位置之后的平衡对象，正确处理字符串、转义和注释，再用 JSON5 解析数据；函数调用、动态表达式和未知格式会被拒绝。

## 验证

2026-11-06 已在取得的当前源码上运行真实数据适配：

- 199 篇诗文、1,797 个原文句子；全部能找到同 ID、等长译文数组。
- 12 个实际英语专题、214 个可听读知识卡段落。
- 7 项 Vitest 测试通过：明确句序/考试重点、缺译文与错 ID 不误配、拒绝自行切句、许可确认、固定来源与路径、注释/字符串中的括号、拒绝执行表达式。

这些是结构和解析验证，不是对全部教材文本、译文质量、读音或真机语音的逐项确认。不得把来源内容或上述测试通过解释为 Noxia 已核准教材准确性。
