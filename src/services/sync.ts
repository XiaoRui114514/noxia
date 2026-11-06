import { apiBase } from "./ai";
import { getSecret, setSecret } from "./storage";
export class SyncError extends Error {
  constructor(public status: number) {
    super(
      status === 409
        ? "云端已有新版本；保留本机内容，请先处理冲突。"
        : `同步服务返回 ${status}`,
    );
  }
}
export async function syncRequest(
  base: string,
  path: string,
  body?: unknown,
  method?: string,
) {
  const endpoint = apiBase(base);
  if (!path.startsWith("/v1/") || path.includes(".."))
    throw new Error("不受支持的同步路径");
  const isLogin = path === "/v1/auth/login";
  const [token, accountId, origin] = await Promise.all([
    getSecret("sync-token"),
    getSecret("sync-account"),
    getSecret("sync-origin"),
  ]);
  if (!isLogin && (!token || !accountId || origin !== endpoint))
    throw new Error("请先登录此网关。更改地址不会将原会话发往新服务。");
  const r = await fetch(`${endpoint}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(!isLogin
        ? { Authorization: `Bearer ${token}`, "X-Account-ID": accountId! }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new SyncError(r.status);
  return r.json();
}
export async function login(base: string, username: string, password: string) {
  const endpoint = apiBase(base);
  if (!username.trim() || !password) throw new Error("请填写用户名与密码");
  const result = await syncRequest(endpoint, "/v1/auth/login", {
    username,
    password,
  });
  if (
    typeof result.accessToken !== "string" ||
    typeof result.user?.id !== "string"
  )
    throw new Error("网关未返回有效移动会话");
  await setSecret("sync-origin", endpoint);
  await setSecret("sync-account", result.user.id);
  await setSecret("sync-token", result.accessToken);
  return result;
}
export async function logout(base: string) {
  try {
    if (base) await syncRequest(base, "/v1/auth/logout", {}, "POST");
  } finally {
    await setSecret("sync-token", "");
    await setSecret("sync-account", "");
    await setSecret("sync-origin", "");
  }
}
