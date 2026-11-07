import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelConnectionManager,
  modelKeyStorageName,
  type ModelConnectionDependencies,
} from "./modelConnection";

const digest = async (value: string) =>
  createHash("sha256").update(value).digest("hex");
let serial = 0;
let managers: ModelConnectionManager[];
let secrets: Map<string, string>;
function setup(overrides: Partial<ModelConnectionDependencies> = {}) {
  const base = `https://test-${++serial}.example/v1`;
  const callbacks = {
    onBaseChange: vi.fn(),
    onModelChange: vi.fn(),
    onKeyChange: vi.fn(),
  };
  const listModels = vi.fn(
    async (
      _settings: { base: string; key?: string },
      _options?: { signal?: AbortSignal },
    ) => ["one", "two"],
  );
  const deps = {
    digest,
    getSecret: vi.fn(async (key: string) => secrets.get(key) ?? null),
    setSecret: vi.fn(async (key: string, value: string) => {
      if (value) secrets.set(key, value);
      else secrets.delete(key);
    }),
    listModels,
    now: () => Date.now(),
    ...overrides,
  };
  const manager = new ModelConnectionManager(callbacks, deps);
  managers.push(manager);
  return { manager, base, callbacks, deps, listModels };
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  managers = [];
  secrets = new Map();
});
afterEach(() => {
  managers.forEach((m) => m.dispose());
  vi.useRealTimers();
});

describe("endpoint-scoped model connection", () => {
  it("hydrates even with automatic requests disabled, and debounces GET by 700ms", async () => {
    const { manager, base, listModels } = setup();
    secrets.set(await modelKeyStorageName(base, digest), "test-key-a");
    manager.updateBase(base);
    await flush();
    expect(manager.getSnapshot()).toMatchObject({
      apiKey: "test-key-a",
      hydrated: true,
      status: "idle",
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(listModels).not.toHaveBeenCalled();
    manager.setEnabled(true);
    await vi.advanceTimersByTimeAsync(699);
    expect(listModels).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(listModels).toHaveBeenCalledWith(
      { base, key: "test-key-a" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(manager.getSnapshot().status).toBe("ready");
    expect(manager.settings).toBeNull();
    manager.selectModel("one");
    expect(manager.settings).toEqual({ base, key: "test-key-a", model: "one" });
  });

  it("never forwards the previous endpoint key while a new scope hydrates", async () => {
    const { manager, base, listModels, callbacks } = setup();
    const next = base.replace(".example", "-next.example");
    secrets.set(await modelKeyStorageName(base, digest), "key-for-first");
    secrets.set(await modelKeyStorageName(next, digest), "key-for-next");
    manager.setEnabled(true);
    manager.updateBase(base);
    await flush();
    manager.syncExternalKey("key-for-first");
    await vi.advanceTimersByTimeAsync(700);
    manager.selectModel("one");
    manager.changeBase(next);
    expect(manager.getSnapshot().apiKey).toBe("");
    expect(manager.settings).toBeNull();
    manager.syncExternalKey("key-for-first");
    await flush();
    manager.syncExternalKey("key-for-first");
    await vi.advanceTimersByTimeAsync(700);
    expect(listModels.mock.calls.map((call) => call[0])).toEqual([
      { base, key: "key-for-first" },
      { base: next, key: "key-for-next" },
    ]);
    expect(callbacks.onBaseChange).toHaveBeenCalledWith(next);
    expect(manager.getSnapshot().apiKey).toBe("key-for-next");
  });

  it("ignores late key hydration from an abandoned endpoint", async () => {
    const late = deferred<string | null>();
    const { manager, base, deps } = setup();
    const next = base.replace(".example", "-next.example");
    const firstScope = await modelKeyStorageName(base, digest);
    vi.mocked(deps.getSecret).mockImplementation(async (key: string) =>
      key === firstScope ? late.promise : (secrets.get(key) ?? null),
    );
    secrets.set(await modelKeyStorageName(next, digest), "new-key");
    manager.updateBase(base);
    await flush();
    manager.updateBase(next);
    await flush();
    expect(manager.getSnapshot().apiKey).toBe("new-key");
    late.resolve("old-key");
    await flush();
    expect(manager.getSnapshot()).toMatchObject({
      base: next,
      apiKey: "new-key",
    });
  });

  it("aborts obsolete requests and ignores a provider resolving after abort", async () => {
    const first = deferred<string[]>(),
      second = deferred<string[]>();
    const list = vi.fn();
    list
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { manager, base } = setup({ listModels: list });
    const next = base.replace(".example", "-next.example");
    manager.setEnabled(true);
    manager.updateBase(base);
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    const signal = list.mock.calls[0][1].signal as AbortSignal;
    manager.updateBase(next);
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(signal.aborted).toBe(true);
    first.resolve(["obsolete"]);
    await flush();
    expect(manager.getSnapshot().models).toEqual([]);
    second.resolve(["current"]);
    await flush();
    expect(manager.getSnapshot()).toMatchObject({
      base: next,
      models: ["current"],
      status: "ready",
    });
  });

  it("stores keys under SHA-256 endpoint scope and restores the right key after switching back", async () => {
    const { manager, base, deps } = setup();
    const next = base.replace("/v1", "/other/v1");
    manager.updateBase(base);
    await flush();
    manager.setKey("first-secret");
    await manager.saveKey();
    const firstScope = await modelKeyStorageName(base, digest);
    expect(firstScope).toMatch(/^ai-endpoint-[a-f0-9]{64}$/);
    expect(secrets.get(firstScope)).toBe("first-secret");
    manager.updateBase(next);
    await flush();
    expect(manager.getSnapshot().apiKey).toBe("");
    manager.setKey("second-secret");
    await manager.saveKey();
    expect(secrets.get(await modelKeyStorageName(next, digest))).toBe(
      "second-secret",
    );
    manager.updateBase(base + "/");
    await flush();
    expect(manager.getSnapshot().apiKey).toBe("first-secret");
    expect(
      vi.mocked(deps.setSecret).mock.calls.some(([name]) => name === "ai-key"),
    ).toBe(false);
  });

  it("does not guess an unbound legacy key, and migrates only explicit matching origin evidence", async () => {
    secrets.set("ai-key", "unbound-legacy");
    const first = setup();
    first.manager.updateBase(first.base);
    await flush();
    expect(first.manager.getSnapshot().apiKey).toBe("");
    expect(first.deps.getSecret).not.toHaveBeenCalledWith("ai-key");
    const second = setup();
    secrets.set("ai-key-origin", second.base);
    second.manager.updateBase(second.base);
    await flush();
    expect(second.manager.getSnapshot().apiKey).toBe("unbound-legacy");
    expect(secrets.get(await modelKeyStorageName(second.base, digest))).toBe(
      "unbound-legacy",
    );
    const third = setup();
    third.manager.updateBase(third.base);
    await flush();
    expect(third.manager.getSnapshot().apiKey).toBe("");
  });

  it("caches catalogs for five minutes per endpoint and key, while retry bypasses cache", async () => {
    const { manager, base, listModels } = setup();
    manager.setEnabled(true);
    manager.updateBase(base);
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(listModels).toHaveBeenCalledTimes(1);
    const second = setup({ listModels });
    second.manager.setEnabled(true);
    second.manager.updateBase(base);
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(listModels).toHaveBeenCalledTimes(1);
    second.manager.retry();
    await flush();
    expect(listModels).toHaveBeenCalledTimes(2);
    second.manager.setKey("other-key");
    await vi.advanceTimersByTimeAsync(700);
    expect(listModels).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300001);
    const third = setup({ listModels });
    third.manager.setEnabled(true);
    third.manager.updateBase(base);
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(listModels).toHaveBeenCalledTimes(4);
  });

  it("allows only a returned model selection and clears a stale selected model", async () => {
    const { manager, base, callbacks } = setup();
    manager.setEnabled(true);
    manager.updateBase(base, "missing-model");
    await flush();
    await vi.advanceTimersByTimeAsync(700);
    expect(manager.getSnapshot().selectedModel).toBe("");
    manager.selectModel("manually-invented");
    expect(manager.settings).toBeNull();
    manager.selectModel("two");
    expect(manager.settings?.model).toBe("two");
    manager.syncSelectedModel("not-in-catalog");
    expect(manager.settings).toBeNull();
    expect(callbacks.onModelChange).toHaveBeenLastCalledWith("");
  });

  it("keeps errors explicit, can retry manually with automatic fetching disabled, and rejects invalid bases", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("此服务未提供兼容的 GET /models，无法选择模型。"),
      )
      .mockResolvedValueOnce(["recovered"]);
    const { manager, base } = setup({ listModels: list });
    manager.updateBase(base);
    await flush();
    manager.retry();
    await flush();
    expect(manager.getSnapshot()).toMatchObject({
      status: "error",
      models: [],
    });
    expect(manager.settings).toBeNull();
    manager.retry();
    await flush();
    expect(manager.getSnapshot().models).toEqual(["recovered"]);
    manager.updateBase("https://name:password@bad.example/v1");
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getSnapshot()).toMatchObject({
      status: "error",
      hydrated: false,
      apiKey: "",
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("resets a pending debounce after key edits, keeps no stale ready settings, and does not mutate the callback contract", async () => {
    const { manager, base, listModels } = setup();
    manager.setEnabled(true);
    manager.updateBase(base);
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    manager.setKey("new-key");
    await vi.advanceTimersByTimeAsync(699);
    expect(listModels).not.toHaveBeenCalled();
    expect(manager.settings).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(listModels).toHaveBeenCalledWith(
      { base, key: "new-key" },
      expect.anything(),
    );
    manager.selectModel("one");
    manager.setKey("changed-again");
    expect(manager.settings).toBeNull();
    manager.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});

it("preserves a saved model when asynchronous storage hydration follows an empty initial render", async () => {
  const { manager, base, callbacks } = setup();
  manager.updateBase("");
  manager.updateBase(base, "two");
  manager.setEnabled(true);
  await flush();
  await vi.advanceTimersByTimeAsync(700);
  expect(manager.settings?.model).toBe("two");
  expect(callbacks.onModelChange).not.toHaveBeenCalledWith("");
  manager.changeBase("https://changed.example/v1");
  expect(callbacks.onModelChange).toHaveBeenLastCalledWith("");
});
