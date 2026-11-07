import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { secrets } = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("./storage", () => ({
  getSecret: vi.fn(async (key: string) => secrets.get(key) ?? null),
  setSecret: vi.fn(async (key: string, value: string) => {
    if (value) secrets.set(key, value);
    else secrets.delete(key);
  }),
}));

import { login, logout, syncRequest, SyncError } from "./sync";

const base = "https://sync.example";
const token = "fictional-mobile-session-for-test-only";
const account = "fictional-account";
let fetchMock: ReturnType<typeof vi.fn>;
const success = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
function session() {
  secrets.set("sync-token", token);
  secrets.set("sync-account", account);
  secrets.set("sync-origin", base);
}

beforeEach(() => {
  secrets.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("mobile session and origin binding", () => {
  it("logs in using accessToken and persists the normalized trusted endpoint", async () => {
    fetchMock.mockResolvedValue(
      success({ accessToken: token, user: { id: account } }),
    );
    await expect(
      login(`${base}/`, "example-user", "fictional-password"),
    ).resolves.toMatchObject({ accessToken: token });
    expect(secrets.get("sync-token")).toBe(token);
    expect(secrets.get("sync-account")).toBe(account);
    expect(secrets.get("sync-origin")).toBe(base);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${base}/v1/auth/login`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      username: "example-user",
      password: "fictional-password",
    });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("X-Account-ID");
  });

  it("does not forward an existing session when logging into a different gateway", async () => {
    session();
    fetchMock.mockResolvedValue(
      success({
        accessToken: "new-test-session",
        user: { id: "new-test-account" },
      }),
    );
    await login(
      "https://new-sync.example",
      "example-user",
      "fictional-password",
    );
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("X-Account-ID");
    expect(secrets.get("sync-origin")).toBe("https://new-sync.example");
  });

  it("requires valid username/password and a mobile accessToken response", async () => {
    await expect(login(base, "", "password")).rejects.toThrow("用户名");
    await expect(login(base, "user", "")).rejects.toThrow("密码");
    expect(fetchMock).not.toHaveBeenCalled();
    for (const payload of [
      { token, user: { id: account } },
      { accessToken: token },
      { accessToken: token, user: { id: 1 } },
    ]) {
      fetchMock.mockResolvedValueOnce(success(payload));
      await expect(
        login(base, "example-user", "fictional-password"),
      ).rejects.toThrow("有效移动会话");
    }
    expect(secrets.size).toBe(0);
  });

  it("sends both bearer token and account header to the bound gateway", async () => {
    session();
    fetchMock.mockResolvedValue(
      success({ version: 1, data: { example: true } }),
    );
    await expect(
      syncRequest(
        `${base}/`,
        "/v1/sync/library/current",
        { baseVersion: 0, data: { example: true } },
        "PUT",
      ),
    ).resolves.toMatchObject({ version: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/v1/sync/library/current`,
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          "X-Account-ID": account,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain(token);
  });

  it("blocks origin or API path changes before fetching or sending the old token", async () => {
    session();
    for (const changed of [
      "https://different.example",
      "https://sync.example:8443",
      "https://sync.example/new-path",
    ]) {
      await expect(
        syncRequest(changed, "/v1/sync/library/current"),
      ).rejects.toThrow("请先登录");
    }
    await expect(syncRequest(base, "/other")).rejects.toThrow("不受支持");
    await expect(syncRequest(base, "/v1/../private")).rejects.toThrow(
      "不受支持",
    );
    await expect(
      syncRequest(
        "https://user:password@sync.example",
        "/v1/sync/library/current",
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(secrets.get("sync-token")).toBe(token);
  });

  it("requires all session components, including endpoint binding", async () => {
    for (const key of ["sync-token", "sync-account", "sync-origin"]) {
      session();
      secrets.delete(key);
      await expect(
        syncRequest(base, "/v1/sync/library/current"),
      ).rejects.toThrow("请先登录");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["switch", "logout"])(
    "discards a pending response after %s without modifying the current session",
    async (change) => {
      session();
      let complete!: (response: Response) => void;
      fetchMock.mockReturnValue(
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
      );
      const pending = syncRequest(base, "/v1/sync/playlists/current");
      const rejected = expect(pending).rejects.toThrow("本次同步结果已忽略");
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      if (change === "switch") {
        secrets.set("sync-token", "synthetic-account-b-session");
        secrets.set("sync-account", "fictional-account-b");
      } else secrets.clear();
      const current = new Map(secrets);
      complete(success({ version: 1, data: { owner: account } }));
      await rejected;
      expect(secrets).toEqual(current);
    },
  );

  it("retains the current session after an ordinary network failure", async () => {
    session();
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(
      syncRequest(base, "/v1/sync/playlists/current"),
    ).rejects.toThrow("offline");
    expect(secrets.get("sync-token")).toBe(token);
    expect(secrets.get("sync-account")).toBe(account);
    expect(secrets.get("sync-origin")).toBe(base);
  });

  it("reports 409 conflicts while retaining local session and hiding server details", async () => {
    session();
    fetchMock.mockResolvedValue(
      new Response(`private upstream detail ${token}`, { status: 409 }),
    );
    const error = await syncRequest(
      base,
      "/v1/sync/library/current",
      { baseVersion: 0 },
      "PUT",
    ).catch((e) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect(error.status).toBe(409);
    expect(error.message).toContain("保留本机内容");
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain("private upstream");
    expect(secrets.get("sync-token")).toBe(token);
  });

  it("distinguishes wrong login credentials from an expired existing session", async () => {
    fetchMock.mockResolvedValue(
      new Response("private authentication detail", { status: 401 }),
    );
    await expect(
      login(base, "example-user", "fictional-password"),
    ).rejects.toThrow("用户名或密码不正确");
    session();
    await expect(syncRequest(base, "/v1/auth/me")).rejects.toThrow(
      "登录已过期",
    );
    expect(secrets.get("sync-token")).toBe(token);
  });

  it("revokes a session then clears all local session fields on logout", async () => {
    session();
    fetchMock.mockResolvedValue(success({ ok: true }));
    await logout(base);
    expect(fetchMock).toHaveBeenCalledWith(
      `${base}/v1/auth/logout`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(secrets.size).toBe(0);
  });

  it("does not clear a replacement session when an earlier logout finishes", async () => {
    session();
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    const pendingLogout = logout(base);
    const rejected =
      expect(pendingLogout).rejects.toThrow("本次同步结果已忽略");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    // Even on the same origin, a different token/account belongs to B.
    fetchMock.mockResolvedValueOnce(
      success({
        accessToken: "synthetic-account-b-session",
        user: { id: "fictional-account-b" },
      }),
    );
    await login(base, "account-b", "fictional-password-b");
    const replacement = new Map(secrets);
    complete(success({ ok: true }));
    await rejected;
    expect(secrets).toEqual(replacement);
  });

  it("clears local secrets even when logout is offline or the address was changed", async () => {
    session();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(logout(base)).rejects.toThrow("offline");
    expect(secrets.size).toBe(0);
    session();
    fetchMock.mockClear();
    await expect(logout("https://different.example")).rejects.toThrow(
      "请先登录",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(secrets.size).toBe(0);
  });
});
