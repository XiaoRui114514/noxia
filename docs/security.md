# 安全审查与已知边界

审查日期：2026-11-06。审查对象为 GitHub 当前公开源码，不是线上渗透测试。源版本见 `cloudflare.md`。没有下载生产数据库、真实 API Key 或私人学习数据。

## 现有统一身份

现有 Worker 仅由 Pages Service Binding 访问，依赖受信任代理覆盖 `X-Learning-Origin`，对比浏览器 `Origin`，拒绝跨站写入。**不得通过打开 workers.dev 来给 App 提供登录**，否则原有代理信任边界失效。

已见合理措施：HttpOnly/Secure/SameSite=Strict/`__Host-` Cookie；256 位随机会话、D1 存摘要；密码独立盐和 Worker pepper；恢复码摘要与 CAS 单次使用；`credential_version` 撤销；跨实例 D1 限流；按会话账号访问学习记录；原子 revision CAS、白名单、64 KiB 与递归复杂度限制；客户端账号分区、冲突前备份。英语云投影明确排除 AI Key、AI 缓存和草稿。

主要风险与处理：

| 项目 | 发现 | 本次处理/后续要求 |
|---|---|---|
| 密码计算成本 | PBKDF2-HMAC-SHA256 10,000 次后做独立 pepper HMAC，显著低于 OWASP 推荐的 600,000 次 | 兼容验证，不把旧哈希称为强度达标；没有擅改用户先前接受的免费 CPU 折中 |
| 密码规则 | 新密码只允许字母数字、最短 6 位 | 建议独立迁移改为至少 12 位、允许长口令/符号；继续原样校验旧密码，不能批量使账号失效 |
| 旧 scheme | `generated-v1` 以 SHA-256 兼容早期合成账号 | 移动端拒绝此 scheme；如存在合法旧账号，先通过现有恢复流程升级，不能猜测并删除任何账号 |
| 免费 CPU | 原仓库 README 报告认证有限样本达到 11–13ms，超过免费标称 10ms | 本次未复核线上；增加高成本哈希前必须 staging CPU 测量，不自动升级套餐 |
| API 秘密 | 原站私有 AI Key 不属于同步字段 | Noxia 同样独立设备安全存储，网关递归拒绝凭据键，不接收 API 配置 |
| 同步冲突 | 文档内文本无法安全自动合并 | Noxia 409 返回当前副本；客户端保留双方后选择，墓碑防离线复活 |
| 网页代理 | Header 信任只在私有 Worker + 受控 Pages 组合下成立 | 独立网关与服务秘密，旧 Worker 维持私有；现有 Pages 不能作为移动代理 |

## 密码加固迁移设计（未执行）

优先使用版本化 scheme 与逐次登录升级，旧账号 ID、学习数据、恢复机制保持。先为原 Worker 加**明确按 scheme 分支**的 verifier；未知 scheme 一律拒绝，不能像当前 fallback 一样按 10k 猜测。对 10k 旧密码正确验证后，生成新盐并以 CAS（原摘要与 scheme 条件）更新为经基准测试可承受的新 scheme。新注册/恢复也使用新 scheme。更新密码或恢复需提升 `credential_version` 并撤销相应会话；纯哈希重算是否撤销需在兼容测试确定。

推荐基准候选是 OWASP 建议的 PBKDF2-SHA256 600k 或适当 Argon2id 参数，但 Workers WebCrypto/CPU 能力必须实际验证；不声称 Workers 免费版能承受。若预算不能支持，保留当前风险说明，或由用户选择独立安全身份服务/Passkey 等后续方案，不未经同意启用付费。

必须先备份恢复验证、修改旧浏览器和移动 verifier 的兼容代码、用相同合成账号验证双站注册/登录/恢复/版本撤销，再获得生产变更确认。移动扩展现在仅接受已知 `pbkdf2-sha256-10000-hmac-v1`，故新 scheme 发布时必须同步升级，不能只改一端。pepper 不能随意轮换：旧摘要不可凭 D1 单独重算，轮换需 key version 和旧 key 过渡或密码恢复。

参考：[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)。参数需以部署当日文档和实测为准。

## Noxia 新边界

- App 的个人模型/TTS Key 与移动令牌仅存在设备安全存储；服务器服务秘密和 pepper 只在 Worker Secrets。禁止上传全部本地状态或 localStorage。
- 移动 token 7 天，服务器存摘要，每次访问联查原账户凭据版本。无 Cookie 登录复用、无任意上游代理、无客户端服务秘密、无日志请求体。
- 内部身份端点使用独立 256 位服务秘密，并且 Worker 仍只有私有 Service Binding。公开网关覆盖客户端 IP 上下文，忽略伪造的转发头。
- 每个同步语句由身份返回的 owner 限定，客户端账号头只能用于检查，不能决定查询 owner。原子版本 CAS 保留并发冲突。单条 64 KiB，音频只在本机。
- 网关默认不开放浏览器 CORS。Web 预览不能登录移动网关，这是当前协议的明确限制。
- 字段拒绝器是最后一道防误传措施，无法识别正文中的密码、教材版权或私人资料。上传私人内容必须由用户在 App 显式选择；默认本地。
- 当前没有端到端加密云同步；开启后内容对该 Cloudflare 账户管理员及平台基础设施可见。不要把它写成零知识存储。
- 未部署、未使用真实账号验证、未做线上攻击测试、未验证 Free 套餐 CPU，也未配置生产备份/监控。所有发布门禁保持关闭。

## 报告漏洞

不要在公开 issue 粘贴 API Key、token、原始私人学习资料或备份。维护者应通过私有安全报告渠道接收最小复现、影响版本与合成样例。密钥泄露需先撤销，再审查历史；不得以删除当前文件代替撤销。
