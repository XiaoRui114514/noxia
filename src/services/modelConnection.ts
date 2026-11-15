import { listModels, modelApiBase, type AISettings } from "./ai";

export type ModelConnectionStatus =
  "idle" | "hydrating" | "debouncing" | "loading" | "ready" | "error";
export type ModelConnectionSnapshot = {
  base: string | null;
  apiKey: string;
  selectedModel: string;
  models: string[];
  status: ModelConnectionStatus;
  error: string;
  hydrated: boolean;
  keySaveState: "idle" | "saving" | "saved" | "error";
};
export type ModelConnectionCallbacks = {
  onBaseChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onKeyChange: (value: string) => void;
};
export type ModelConnectionDependencies = {
  getSecret: (key: string) => Promise<string | null>;
  setSecret: (key: string, value: string) => Promise<void>;
  digest: (value: string) => Promise<string>;
  listModels: typeof listModels;
  now: () => number;
};
const defaults: ModelConnectionDependencies = {
  getSecret: async (key) => (await import("./storage")).getSecret(key),
  setSecret: async (key, value) =>
    (await import("./storage")).setSecret(key, value),
  digest: async (value) => {
    const crypto = await import("expo-crypto");
    return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value);
  },
  listModels,
  now: Date.now,
};
const catalogCache = new Map<string, { models: string[]; expires: number }>();
const initial = (): ModelConnectionSnapshot => ({
  base: null,
  apiKey: "",
  selectedModel: "",
  models: [],
  status: "idle",
  error: "",
  hydrated: false,
  keySaveState: "idle",
});
export function canonicalModelBase(value: string): string | null {
  try {
    return modelApiBase(value);
  } catch {
    return null;
  }
}
export async function modelKeyStorageName(
  base: string,
  digest = defaults.digest,
) {
  return `ai-endpoint-${await digest(modelApiBase(base))}`;
}

/** Scope is a SHA-256 of the complete canonical endpoint, including its path. */
export class ModelConnectionManager {
  private state = initial();
  private listeners = new Set<() => void>();
  private rawBase: string | null = null;
  private enabled = false;
  private epoch = 0;
  private keyEpoch = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private expectedKeyEcho: string | null = null;
  private writes: Promise<void> = Promise.resolve();
  private deps: ModelConnectionDependencies;
  constructor(
    private callbacks: ModelConnectionCallbacks,
    deps: Partial<ModelConnectionDependencies> = {},
  ) {
    this.deps = { ...defaults, ...deps };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(next: Partial<ModelConnectionSnapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  private cancel() {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
  }
  dispose = () => {
    this.cancel();
    this.keyEpoch++;
    this.rawBase = null;
    this.state = initial();
  };
  setEnabled(value: boolean) {
    if (this.enabled === value) return;
    this.enabled = value;
    if (value) this.schedule();
    else {
      this.cancel();
      if (["debouncing", "loading"].includes(this.state.status))
        this.publish({ status: this.state.models.length ? "ready" : "idle" });
    }
  }
  changeBase = (value: string) => {
    this.updateBase(value, "", true);
    this.callbacks.onBaseChange(value);
  };
  updateBase(value: string, initialModel = "", userChange = false) {
    if (this.rawBase === value) return;
    const base = canonicalModelBase(value);
    this.rawBase = value;
    // A trailing slash/host case edit still denotes the same trusted endpoint.
    if (base && base === this.state.base) return;
    this.cancel();
    const keyEpoch = ++this.keyEpoch;
    this.expectedKeyEcho = "";
    this.publish({
      ...initial(),
      base,
      status: value.trim() ? "hydrating" : "idle",
      selectedModel: !userChange ? initialModel : "",
    });
    this.callbacks.onKeyChange("");
    if (userChange) this.callbacks.onModelChange("");
    if (!base) {
      if (value.trim()) {
        let error = "请填写有效的 HTTPS /v1 地址";
        try {
          modelApiBase(value);
        } catch (e) {
          if (e instanceof Error) error = e.message;
        }
        this.publish({ status: "error", error });
      }
      return;
    }
    void (async () => {
      try {
        const storageName = await modelKeyStorageName(base, this.deps.digest);
        let key = await this.deps.getSecret(storageName);
        // Unbound legacy ai-key is never guessed or forwarded. Migration needs stored origin evidence.
        if (!key) {
          const origin = await this.deps.getSecret("ai-key-origin");
          if (origin && canonicalModelBase(origin) === base) {
            const legacy = await this.deps.getSecret("ai-key");
            if (legacy) {
              await this.deps.setSecret(storageName, legacy);
              key = legacy;
            }
          }
        }
        if (keyEpoch !== this.keyEpoch || this.state.base !== base) return;
        this.expectedKeyEcho = key ?? "";
        this.publish({
          apiKey: key ?? "",
          hydrated: true,
          status: "idle",
          error: "",
        });
        this.callbacks.onKeyChange(key ?? "");
        this.schedule();
      } catch {
        if (keyEpoch === this.keyEpoch)
          this.publish({
            status: "error",
            error: "无法读取此接口的安全密钥，请检查设备安全存储。",
          });
      }
    })();
  }
  // Controlled prop echoes are acknowledged only after this endpoint's hydration.
  // This prevents a render carrying the previous endpoint's key from becoming current.
  syncExternalKey(value: string) {
    if (!this.state.hydrated) return;
    if (this.expectedKeyEcho !== null) {
      if (value === this.expectedKeyEcho) this.expectedKeyEcho = null;
      return;
    }
    if (value !== this.state.apiKey) this.setKey(value);
  }
  setKey = (value: string) => {
    if (!this.state.base || !this.state.hydrated) return;
    this.cancel();
    this.expectedKeyEcho = value;
    this.publish({
      apiKey: value,
      models: [],
      status: "idle",
      error: "",
      keySaveState: "idle",
    });
    this.callbacks.onKeyChange(value);
    this.schedule();
  };
  syncSelectedModel(value: string) {
    if (value === this.state.selectedModel) return;
    if (this.state.status === "ready") {
      if (this.state.models.includes(value))
        this.publish({ selectedModel: value });
      else {
        this.publish({ selectedModel: "" });
        if (value) this.callbacks.onModelChange("");
      }
    } else if (this.state.base) this.publish({ selectedModel: value });
  }
  selectModel = (value: string) => {
    if (this.state.status !== "ready" || !this.state.models.includes(value))
      return;
    this.publish({ selectedModel: value });
    this.callbacks.onModelChange(value);
  };
  saveKey = async () => {
    const { base, apiKey, hydrated } = this.state;
    if (!base || !hydrated) return;
    const keyEpoch = this.keyEpoch;
    this.publish({ keySaveState: "saving" });
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        await this.deps.setSecret(
          await modelKeyStorageName(base, this.deps.digest),
          apiKey.trim(),
        );
      });
    this.writes = operation;
    try {
      await operation;
      if (keyEpoch === this.keyEpoch && apiKey === this.state.apiKey)
        this.publish({ keySaveState: "saved" });
    } catch {
      if (keyEpoch === this.keyEpoch) this.publish({ keySaveState: "error" });
    }
  };
  retry = () => this.schedule(true, true);
  private schedule(force = false, manual = false) {
    if (!this.state.base || !this.state.hydrated || (!manual && !this.enabled))
      return;
    this.cancel();
    const epoch = this.epoch;
    this.publish({ status: "debouncing", error: "" });
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.fetchCatalog(epoch, force);
      },
      manual ? 0 : 700,
    );
  }
  private async fetchCatalog(epoch: number, force: boolean) {
    const { base, apiKey } = this.state;
    if (!base || epoch !== this.epoch) return;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({ status: "loading", error: "" });
    try {
      const identity = await this.deps.digest(
        JSON.stringify([base, apiKey.trim()]),
      );
      if (epoch !== this.epoch || controller.signal.aborted) return;
      const cached = catalogCache.get(identity);
      const models =
        !force && cached && cached.expires > this.deps.now()
          ? cached.models.slice()
          : await this.deps.listModels(
              { base, key: apiKey },
              { signal: controller.signal },
            );
      if (
        epoch !== this.epoch ||
        controller.signal.aborted ||
        this.state.base !== base
      )
        return;
      if (force || !cached || cached.expires <= this.deps.now()) {
        if (catalogCache.size >= 20)
          catalogCache.delete(catalogCache.keys().next().value!);
        catalogCache.set(identity, {
          models: models.slice(),
          expires: this.deps.now() + 5 * 60 * 1000,
        });
      }
      const selectedModel = models.includes(this.state.selectedModel)
        ? this.state.selectedModel
        : "";
      this.publish({ models, status: "ready", error: "", selectedModel });
      if (!selectedModel) this.callbacks.onModelChange("");
    } catch (error) {
      if (epoch !== this.epoch || controller.signal.aborted) return;
      this.publish({
        models: [],
        status: "error",
        error:
          error instanceof Error ? error.message : "无法读取模型目录，请重试。",
      });
    }
  }
  get settings(): AISettings | null {
    const { base, apiKey, selectedModel, status, hydrated, models } =
      this.state;
    return base &&
      hydrated &&
      status === "ready" &&
      models.includes(selectedModel)
      ? { base, key: apiKey, model: selectedModel }
      : null;
  }
}
