import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlan, AudioStep } from "../../modules/noxia-audio/types";
import type { TTSConsent, TTSSettings } from "./tts";

const native = vi.hoisted(() => ({
  os: "ios",
  available: true,
  getExternalAudio: vi.fn(),
  cacheExternalAudio: vi.fn(),
  prepare: vi.fn(),
  play: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.os;
    },
  },
}));
vi.mock("expo-crypto", async () => {
  const { createHash } = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: vi.fn(async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("hex"),
    ),
  };
});
vi.mock("../../modules/noxia-audio", () => ({
  default: {
    getExternalAudio: native.getExternalAudio,
    cacheExternalAudio: native.cacheExternalAudio,
    prepare: native.prepare,
    play: native.play,
  },
  audioCapabilities: {
    get native() {
      return native.available;
    },
  },
}));
// Keep the real validation, canonical cache identity and HTTP protocol. Only the
// network and native filesystem are fake; the synthesis entry point remains observable.
vi.mock("./tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tts")>();
  return { ...actual, synthesizeSpeech: vi.fn(actual.synthesizeSpeech) };
});
import { prepareExternalAudio } from "./externalAudio";
import { synthesizeSpeech } from "./tts";

const settings: TTSSettings = {
  provider: "openai-compatible",
  base: "https://speech.example/v1",
  model: "synthetic-model",
  voice: "speaker-one",
  version: "synthetic-v1",
  key: "synthetic-test-tts-key",
};
const consent: TTSConsent = { base: settings.base, confirmed: true };
// Signature-only synthetic MP3 test bytes, never actual speech or private audio.
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const cachedFiles = new Map<string, { uri: string; base64: string }>();
let fetchMock: ReturnType<typeof vi.fn>;

function speech(
  id: string,
  text = "公开合成测试",
  overrides: Partial<AudioStep> = {},
): AudioStep {
  return {
    id,
    segmentId: "segment-one",
    resourceId: "resource-one",
    title: "虚构学习材料",
    kind: "speech",
    text,
    voiceId: "remote:speaker-one",
    rate: 0.8,
    volume: 0.6,
    ...overrides,
  };
}
function plan(steps: AudioStep[], id = "plan-one"): AudioPlan {
  return { id, title: "虚构测试播放计划", steps, loop: false };
}
function response() {
  return new Response(mp3, { headers: { "content-type": "audio/mpeg" } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.os = "ios";
  native.available = true;
  cachedFiles.clear();
  native.getExternalAudio.mockImplementation(async (key: string) => {
    const cached = cachedFiles.get(key);
    return cached ? { uri: cached.uri } : null;
  });
  native.cacheExternalAudio.mockImplementation(
    async (base64: string, key: string) => {
      const uri = `file:///synthetic-cache/${key}.mp3`;
      cachedFiles.set(key, { uri, base64 });
      return { uri };
    },
  );
  fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("external audio preparation", () => {
  it("makes one speech POST for repeated text and reuses its file while preserving step volume and alignment", async () => {
    const input = plan([
      speech("first", "同一句公开示例", { volume: 0.4 }),
      speech("repeat", "同一句公开示例", { volume: 0.9 }),
    ]);
    const { plan: rendered, warnings } = await prepareExternalAudio(
      input,
      settings,
      consent,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${settings.base}/audio/speech`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(native.cacheExternalAudio).toHaveBeenCalledTimes(1);
    expect(rendered.steps).toHaveLength(2);
    expect(rendered.steps.map((step) => step.kind)).toEqual(["file", "file"]);
    expect(rendered.steps[0].uri).toBe(rendered.steps[1].uri);
    expect(
      rendered.steps.map((step) => [
        step.segmentId,
        step.resourceId,
        step.volume,
        step.rate,
      ]),
    ).toEqual([
      ["segment-one", "resource-one", 0.4, 1],
      ["segment-one", "resource-one", 0.9, 1],
    ]);
    expect([...cachedFiles.values()][0].base64).toBe(
      Buffer.from(mp3).toString("base64"),
    );
    expect(input.steps[0].kind).toBe("speech");
    expect(warnings).toEqual([]);
  });

  it("falls back to the original text so pronunciation rules are applied only once", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    const original = plan([speech("pronunciation", "A")]);
    original.pronunciations = { A: "AA" };
    const result = await prepareExternalAudio(original, settings, consent);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.steps[0].text).toBe("A");
    expect(result.plan.pronunciations).toEqual({ A: "AA" });
    expect(result.plan.steps[0].kind).toBe("speech");
  });

  it("uses the native cache across plans and excludes the API key from its persistent identity", async () => {
    const first = await prepareExternalAudio(
      plan([speech("old-step")]),
      settings,
      consent,
    );
    const next = await prepareExternalAudio(
      plan([speech("new-step")], "different-plan"),
      { ...settings, key: "synthetic-rotated-key" },
      consent,
    );
    expect(next.plan.steps[0].uri).toBe(first.plan.steps[0].uri);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(native.cacheExternalAudio).toHaveBeenCalledTimes(1);
    expect(native.getExternalAudio).toHaveBeenCalledTimes(2);
    const cacheKey = native.getExternalAudio.mock.calls[0][0];
    expect(cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(native.getExternalAudio.mock.calls[1][0]).toBe(cacheKey);
  });

  it("invalidates saved audio for a changed synthesis model revision", async () => {
    await prepareExternalAudio(plan([speech("one")]), settings, consent);
    await prepareExternalAudio(
      plan([speech("two")]),
      { ...settings, version: "synthetic-v2" },
      consent,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedFiles.size).toBe(2);
  });

  it("falls back after the first failed API request and removes remote voice IDs without disturbing local steps", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("synthetic upstream error", { status: 503 }),
    );
    const local = speech("local", "本机示例", {
      voiceId: "installed-system-voice",
    });
    const silence: AudioStep = {
      id: "recall",
      segmentId: "segment-one",
      kind: "silence",
      durationMs: 5000,
      rate: 1,
      volume: 0,
    };
    const { plan: result, warnings } = await prepareExternalAudio(
      plan([
        speech("remote-one"),
        local,
        silence,
        speech("remote-two", "另一句"),
      ]),
      settings,
      consent,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.steps[0]).toMatchObject({
      kind: "speech",
      text: "公开合成测试",
      rate: 0.8,
      volume: 0.6,
    });
    for (const index of [0, 3]) {
      expect(result.steps[index].voiceId).toBeUndefined();
      expect(result.steps[index].uri).toBeUndefined();
    }
    expect(result.steps[1]).toBe(local);
    expect(result.steps[2]).toBe(silence);
    expect(native.cacheExternalAudio).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("synthetic upstream error");
  });

  it.each([
    null,
    { ...consent, confirmed: false } as unknown as TTSConsent,
    { ...consent, base: "https://other.example/v1" },
  ])(
    "does not POST or read cached cloud audio without consent for that service: %j",
    async (permission) => {
      const { plan: result, warnings } = await prepareExternalAudio(
        plan([speech("remote")]),
        settings,
        permission,
      );
      expect(result.steps[0]).toMatchObject({
        kind: "speech",
        text: "公开合成测试",
      });
      expect(result.steps[0].voiceId).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(native.getExternalAudio).not.toHaveBeenCalled();
      expect(native.cacheExternalAudio).not.toHaveBeenCalled();
      expect(warnings).toHaveLength(1);
    },
  );

  it("never returns a playable plan or writes a late HTTP result after cancellation", async () => {
    const pendingResponse = deferred<Response>();
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(() => pendingResponse.promise);
    const preparing = prepareExternalAudio(
      plan([speech("remote")]),
      settings,
      consent,
      controller.signal,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].signal).not.toBe(controller.signal);
    controller.abort();
    // Simulate a provider/native fetch implementation delivering a result despite abort.
    pendingResponse.resolve(response());
    await expect(preparing).rejects.toThrow("已停止准备");
    expect(native.cacheExternalAudio).not.toHaveBeenCalled();
    expect(cachedFiles.size).toBe(0);
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
  });

  it("does not send text when cancelled while native cache lookup is pending", async () => {
    const lookup = deferred<null>();
    const controller = new AbortController();
    native.getExternalAudio.mockImplementationOnce(() => lookup.promise);
    const preparing = prepareExternalAudio(
      plan([speech("remote")]),
      settings,
      consent,
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(native.getExternalAudio).toHaveBeenCalledTimes(1),
    );
    controller.abort();
    lookup.resolve(null);
    await expect(preparing).rejects.toThrow("已停止准备");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(native.cacheExternalAudio).not.toHaveBeenCalled();
    expect(native.prepare).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
  });

  it("splits more than 4096 characters into valid requests while preserving every segment/resource association", async () => {
    const longText = "甲".repeat(7200);
    const { plan: result, warnings } = await prepareExternalAudio(
      plan([
        speech("long", longText),
        speech("next", "另一段公开示例", {
          segmentId: "segment-two",
          resourceId: "resource-two",
        }),
      ]),
      settings,
      consent,
    );
    expect(warnings).toEqual([]);
    expect(result.steps).toHaveLength(4);
    expect(result.steps.length).toBeLessThan(1000);
    expect(
      result.steps.every((step) => step.kind === "file" && !!step.uri),
    ).toBe(true);
    const firstSegment = result.steps.filter(
      (step) => step.segmentId === "segment-one",
    );
    expect(firstSegment.map((step) => step.text).join("")).toBe(longText);
    expect(
      firstSegment.every((step) => step.resourceId === "resource-one"),
    ).toBe(true);
    expect(result.steps[3]).toMatchObject({
      segmentId: "segment-two",
      resourceId: "resource-two",
      text: "另一段公开示例",
    });
    for (const [, request] of fetchMock.mock.calls) {
      const body = JSON.parse(request.body);
      expect(body.input.length).toBeLessThanOrEqual(4096);
    }
  });

  it("splits astral Unicode text below the provider UTF-16 limit without losing characters or segment alignment", async () => {
    const longText = "🦉".repeat(2500);
    expect(longText.length).toBeGreaterThan(4096);
    const { plan: result, warnings } = await prepareExternalAudio(
      plan([speech("unicode", longText)]),
      settings,
      consent,
    );
    expect(warnings).toEqual([]);
    expect(result.steps.length).toBeGreaterThan(1);
    expect(result.steps.length).toBeLessThan(1000);
    expect(
      result.steps.every(
        (step) => step.kind === "file" && step.segmentId === "segment-one",
      ),
    ).toBe(true);
    expect(result.steps.map((step) => step.text).join("")).toBe(longText);
    for (const [, request] of fetchMock.mock.calls) {
      const { input } = JSON.parse(request.body);
      expect(input.length).toBeLessThanOrEqual(4096);
      expect(input.isWellFormed()).toBe(true);
    }
  });

  it("bounds expansion before any potentially billed request", async () => {
    const tooMany = plan(
      Array.from({ length: 1001 }, (_, index) => speech(`step-${index}`, "例")),
    );
    await expect(
      prepareExternalAudio(tooMany, settings, consent),
    ).rejects.toThrow("编排过长");
    await expect(
      prepareExternalAudio(
        plan([speech("large", "甲".repeat(150001))]),
        settings,
        consent,
      ),
    ).rejects.toThrow("编排过长");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(native.getExternalAudio).not.toHaveBeenCalled();
    expect(native.cacheExternalAudio).not.toHaveBeenCalled();
  });

  it("keeps a fully local plan unchanged without network or cache access", async () => {
    const original = plan([
      speech("local", "本机示例", { voiceId: "installed-system-voice" }),
    ]);
    const result = await prepareExternalAudio(original, settings, null);
    expect(result.plan).toBe(original);
    expect(result.warnings).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(native.getExternalAudio).not.toHaveBeenCalled();
  });
});
