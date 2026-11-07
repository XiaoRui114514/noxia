# 统一账号接入状态

核查时间：2026-11-07。

## 产品约定

Noxia 的登录账号指现有语文背诵与英语语法网站共用的**学习账号**。用户填写同一用户名和密码；不要求注册一套 Noxia 专属账号，也不使用 Cloudflare 控制台的邮箱、密码或 API Token 登录。

账号入口应放在设置最上方。普通用户只看见登录、登录状态和退出，不填写服务地址，不接触 API 网关、Service Binding、D1 或部署参数。服务未上线时显示“账号服务暂未开放，你可以继续使用本机学习。”；本机资源、播放和模板照常使用。

## 已核查的事实

- 原身份 Worker 配置将 `https://ywbs.pages.dev`、`https://ruii.pages.dev` 列入站点来源白名单，两个 Pages 代理使用原有 `LEARNING_SYNC` 私有绑定。
- 本次仅以**匿名、无 Cookie、无密码** GET 检查两个站点 `/api/auth/me`，均返回 HTTP 200、`user:null`。这只能证明匿名网页账号接口可达，不证明真实账号登录、原生 App 会话或同步已验收。
- Noxia 移动服务代码与身份增量包装模块已经存在；`backend/wrangler.jsonc` 的 `MOBILE_RELEASE_VERIFIED` 仍为 `false`，数据库 ID 是示例占位值，未发现可用的已部署移动服务地址。
- 当前云环境状态没有配置 Cloudflare 秘密或身份连接。没有执行部署、生产迁移、修改原 Worker 或调用真实用户数据库。
- 两个现有项目工作副本无本次改动。原有站点的 Cookie 登录和私有 Worker 边界继续保留。

**因此当前不能声称 Noxia 已接入真实统一账号。** 网页接口不转换成原生登录地址；不能把 `ywbs.pages.dev/api` 或 `ruii.pages.dev/api` 直接填入移动服务配置。

## 构建时固定配置

`src/services/accountConfig.ts` 提供：

```ts
import {
  ACCOUNT_API,
  isAccountConfigured,
  ACCOUNT_UNAVAILABLE_MESSAGE,
} from "./src/services/accountConfig";
```

优先读取 `Constants.expoConfig.extra.services.accountApi`，未指定时读取 `EXPO_PUBLIC_ACCOUNT_API`。两者都是发布者的构建配置，不在设置中提供编辑框，也不从用户本机 `syncBase` 读取。无配置或配置不合法时，`ACCOUNT_API === ""`，`isAccountConfigured() === false`。配置存在只表示地址已设置，不代表线上发布与登录已验证。

配置要求 HTTPS、不含 URL 用户凭据、查询参数或 fragment。这里配置移动服务的基础地址，由客户端追加 `/v1/auth/login` 等路径。地址本身不是秘密，环境变量会被打包进应用；禁止将任何 Cloudflare Token、pepper、服务秘密或用户密码放入 `EXPO_PUBLIC_*` 或 `extra`。

登录仍使用已有的 `login(ACCOUNT_API, username, password)`。服务返回的独立移动 bearer 按 endpoint 绑定保存在安全存储中；换服务地址不会向新服务发送旧令牌。HTTP 401 登录失败显示用户名/密码提示；已登录请求的 401 显示会话过期。本机内容始终保留，不回显服务端原始错误。

## 可继续推进的上线步骤

1. 在受控 Cloudflare 权限下读取现有配置、导出并验证身份数据库备份，在隔离环境恢复测试。无需用户在聊天中提供任何密码或密钥。
2. 审查身份包装入口、加移动会话表的增量 SQL、私有绑定和回滚 diff；完成原双站兼容测试与 staging 的移动登录/撤销/冲突测试。
3. 在用户确认具体生产迁移与认证变更后，再部署增量包装和独立移动网关；原身份 Worker 继续私有，不新建账号数据库，不自动升级付费套餐。
4. 用合成账号完成真实 Service Binding、CPU 配额、会话撤销和账号隔离验收后开放移动门禁，将实际移动服务地址固定进发布构建。

备份、批准与部署细节见 [Cloudflare 接入说明](cloudflare.md) 和 [安全审查](security.md)。当前这些生产步骤尚未执行，不能以设置中出现登录表单替代接入验收。
