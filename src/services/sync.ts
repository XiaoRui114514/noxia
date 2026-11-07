import { apiBase } from "./ai";
import { getSecret, setSecret } from "./storage";

// SecureStore has no multi-key compare-and-delete. Serialize this service's
// session writes so login cannot interleave with a logout's check and removal.
let sessionWrites: Promise<void> = Promise.resolve();
function updateSession(action: () => Promise<void>): Promise<void> {
  const next = sessionWrites.then(action);
  sessionWrites = next.catch(() => {});
  return next;
}

export class SyncError extends Error {
  constructor(
    public status: number,
    isLogin = false,
  ) {
    super(
      status === 409
        ? "云端已有新版本；保留本机内容，请先处理冲突。"
        : status === 401
          ? isLogin
            ? "用户名或密码不正确，请检查后重试。"
            : "登录已过期，请重新登录。本机内容已保留。"
          : status === 429
            ? "操作过于频繁，请稍后重试。"
            : status >= 500
              ? "账号服务暂时不可用，请稍后重试。本机学习不受影响。"
              : "暂时无法完成账号操作，请稍后重试。本机内容已保留。",
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
    throw new Error("请先登录账号后再同步。本机内容仍保存在此设备。");
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
  const result = r.ok ? await r.json() : undefined;
  if (!isLogin) {
    // Fetch and JSON decoding both yield. A response belongs only to the exact
    // session that started it, even if the account changes while awaiting it.
    const [currentToken, currentAccount, currentOrigin] = await Promise.all([
      getSecret("sync-token"),
      getSecret("sync-account"),
      getSecret("sync-origin"),
    ]);
    if (
      currentToken !== token ||
      currentAccount !== accountId ||
      currentOrigin !== origin
    )
      throw new Error("账号已变更，本次同步结果已忽略。本机内容已保留。");
  }
  if (!r.ok) throw new SyncError(r.status, isLogin);
  return result;
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
    throw new Error("账号服务未返回有效移动会话，请稍后重试。");
  await updateSession(async () => {
    await setSecret("sync-origin", endpoint);
    await setSecret("sync-account", result.user.id);
    await setSecret("sync-token", result.accessToken);
  });
  return result;
}
export async function logout(base: string) {
  const original = await Promise.all([
    getSecret("sync-token"),
    getSecret("sync-account"),
    getSecret("sync-origin"),
  ]);
  try {
    if (base) await syncRequest(base, "/v1/auth/logout", {}, "POST");
  } finally {
    await updateSession(async () => {
      const current = await Promise.all([
        getSecret("sync-token"),
        getSecret("sync-account"),
        getSecret("sync-origin"),
      ]);
      // An old logout may finish after a new account signs in. Only remove the
      // session this logout began with, never the replacement account's secrets.
      if (current.every((value, index) => value === original[index])) {
        await setSecret("sync-token", "");
        await setSecret("sync-account", "");
        await setSecret("sync-origin", "");
      }
    });
  }
}
