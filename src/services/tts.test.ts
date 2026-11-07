import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TTS_SETTINGS,
  filterSystemVoices,
  listTTSVoices,
  normalizeVoiceGender,
  synthesizeSpeech,
  ttsBase,
  ttsCacheIdentity,
  validateTTSSettings,
  type TTSSettings,
} from "./tts";

const settings: TTSSettings = {
  provider: "openai-compatible",
  base: "https://speech.example/v1/",
  model: "fictional-voice-model",
  voice: "speaker-one",
  version: "2026-11",
  key: "fictional-tts-key-for-test-only",
};
const consent = { base: "https://speech.example/v1", confirmed: true as const };
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("explicit TTS provider boundary", () => {
  it("defaults to system voices and discards external settings when disabled", () => {
    expect(validateTTSSettings({ ...settings, provider: "system" })).toEqual(
      DEFAULT_TTS_SETTINGS,
    );
    expect(DEFAULT_TTS_SETTINGS.provider).toBe("system");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts HTTPS custom paths without exposing pasted URL credentials", () => {
    expect(ttsBase(settings.base)).toBe(consent.base);
    expect(validateTTSSettings(settings).base).toBe(consent.base);
    expect(validateTTSSettings({ ...settings, key: "" }).key).toBe("");
    for (const base of [
      "http://speech.example/v1",
      "https://user:secret@speech.example",
      "https://speech.example?key=secret",
      "https://speech.example#secret",
      "invalid-secret",
    ])
      expect(() => ttsBase(base)).toThrow("HTTPS");
    try {
      ttsBase("invalid-secret");
    } catch (error) {
      expect(String(error)).not.toContain("invalid-secret");
    }
    for (const change of [
      { model: "" },
      { voice: " " },
      { key: "bad\nheader" },
      { version: "x".repeat(201) },
    ])
      expect(() => validateTTSSettings({ ...settings, ...change })).toThrow();
  });

  it("refuses text upload without consent for the exact selected service", async () => {
    for (const invalid of [
      undefined,
      { confirmed: false, base: consent.base },
      { confirmed: true, base: "https://other.example/v1" },
    ])
      await expect(
        synthesizeSpeech(settings, { text: "虚构试听文字" }, invalid as never),
      ).rejects.toThrow("确认");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the documented speech request and returns binary MP3 for local caching", async () => {
    fetchMock.mockResolvedValue(
      new Response(mp3, { headers: { "content-type": "audio/mpeg" } }),
    );
    await expect(
      synthesizeSpeech(settings, { text: "公开示例", rate: 0.8 }, consent),
    ).resolves.toEqual({
      bytes: mp3,
      mimeType: "audio/mpeg",
      extension: "mp3",
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://speech.example/v1/audio/speech");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.headers.Authorization).toBe(`Bearer ${settings.key}`);
    expect(url).not.toContain(settings.key);
    expect(JSON.parse(request.body)).toEqual({
      model: settings.model,
      input: "公开示例",
      voice: settings.voice,
      response_format: "mp3",
      speed: 0.8,
    });
  });

  it("passes an external abort signal through without changing cache identity", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(mp3, { headers: { "content-type": "audio/mpeg" } }),
    );
    await synthesizeSpeech(
      settings,
      { text: "试听" },
      consent,
      controller.signal,
    );
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("permits an explicitly configured keyless self-hosted service without an empty auth header", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64])),
    );
    await synthesizeSpeech(
      { ...settings, key: "" },
      { text: "Example", voice: "custom-speaker" },
      consent,
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Authorization",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice).toBe(
      "custom-speaker",
    );
  });

  it("validates text, model and rate before making any potentially billed request", async () => {
    for (const request of [
      { text: "" },
      { text: "甲".repeat(4097) },
      { text: "a", rate: 0 },
      { text: "a", rate: 5 },
      { text: "a", rate: NaN },
      { text: "a", voice: "\n" },
    ])
      await expect(
        synthesizeSpeech(settings, request, consent),
      ).rejects.toThrow();
    await expect(
      synthesizeSpeech(DEFAULT_TTS_SETTINGS, { text: "a" }, consent),
    ).rejects.toThrow("原生");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never includes upstream error bodies, keys, text, or raw network exceptions in user-facing errors", async () => {
    const secret = `private text ${settings.key}`;
    for (const status of [401, 429, 500]) {
      fetchMock.mockResolvedValueOnce(new Response(secret, { status }));
      const error = await synthesizeSpeech(
        settings,
        { text: secret },
        consent,
      ).catch((error) => error);
      expect(error.message).toContain(String(status));
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain(settings.key);
    }
    fetchMock.mockRejectedValue(new Error(secret));
    await expect(
      synthesizeSpeech(settings, { text: "a" }, consent),
    ).rejects.toThrow("连接失败");
    const error = await listTTSVoices(settings).catch((error) => error);
    expect(error.message).not.toContain(settings.key);
  });

  it("rejects disguised HTML/JSON, wrong media types, empty files and excessive payloads", async () => {
    for (const response of [
      new Response("<html>not audio</html>", {
        headers: { "content-type": "audio/mpeg" },
      }),
      new Response(JSON.stringify({ error: "upstream private detail" }), {
        headers: { "content-type": "application/octet-stream" },
      }),
      new Response(mp3, { headers: { "content-type": "audio/wav" } }),
      new Response(new Uint8Array()),
      new Response(mp3, {
        headers: { "content-length": String(41 * 1024 * 1024) },
      }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(
        synthesizeSpeech(settings, { text: "a" }, consent),
      ).rejects.toThrow();
    }
  });

  it("probes optional voice-list extensions then preserves manual voice entry", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 405 }));
    await expect(
      listTTSVoices({ ...settings, model: "", voice: "" }),
    ).resolves.toEqual({ voices: [], supported: false });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://speech.example/v1/audio/voices",
      "https://speech.example/v1/voices",
    ]);
  });

  it("accepts Kokoro-style voice metadata without guessing gender or language from IDs", async () => {
    fetchMock.mockResolvedValue(
      json({
        voices: [
          {
            id: "one",
            name: "First",
            language: "zh-CN",
            gender: "female",
            quality: "studio",
          },
          { voice_id: "two", languages: ["en-US"], gender: "unknown" },
          "af_speaker",
          { id: "one", name: "Duplicate" },
          { id: 42 },
          null,
        ],
      }),
    );
    const result = await listTTSVoices(settings);
    expect(result.supported).toBe(true);
    expect(result.voices).toEqual([
      {
        id: "one",
        name: "First",
        language: "zh-CN",
        quality: "studio",
        gender: "female",
      },
      {
        id: "two",
        name: "two",
        language: "en-US",
        quality: "service",
        gender: "unknown",
      },
      {
        id: "af_speaker",
        name: "af_speaker",
        language: "",
        quality: "service",
        gender: "unknown",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat authorization failures as unsupported voice-list endpoints", async () => {
    fetchMock.mockResolvedValue(new Response(settings.key, { status: 401 }));
    await expect(listTTSVoices(settings)).rejects.toThrow("401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(json({ unexpected: [] }));
    await expect(listTTSVoices(settings)).rejects.toThrow("格式");
  });

  it("includes all synthesis-affecting fields in cache identity while excluding key and repeat count", () => {
    const request = { text: "原始文字", rate: 0.8 };
    const baseKey = ttsCacheIdentity(settings, request);
    expect(baseKey).not.toContain(settings.key);
    expect(
      ttsCacheIdentity({ ...settings, key: "another-fictional-key" }, request),
    ).toBe(baseKey);
    expect(ttsCacheIdentity({ ...settings, base: consent.base }, request)).toBe(
      baseKey,
    );
    for (const change of [
      { base: "https://another.example/v1" },
      { model: "other-model" },
      { voice: "two" },
      { version: "next" },
    ])
      expect(ttsCacheIdentity({ ...settings, ...change }, request)).not.toBe(
        baseKey,
      );
    for (const change of [
      { text: "新文字" },
      { rate: 1 },
      { voice: "override" },
    ])
      expect(ttsCacheIdentity(settings, { ...request, ...change })).not.toBe(
        baseKey,
      );
    expect(JSON.parse(baseKey).format).toBe("mp3");
  });
});

describe("system voice metadata", () => {
  const voices = [
    {
      id: "zh-f",
      name: "中文女声",
      language: "zh-CN",
      quality: "premium",
      gender: "female",
    },
    {
      id: "zh-m",
      name: "中文男声",
      language: "zh-TW",
      quality: "enhanced",
      gender: "male",
    },
    { id: "en", name: "English", language: "en-US", quality: "default" },
  ];
  it("filters by locale prefix, quality, gender and searchable name without changing the source", () => {
    expect(filterSystemVoices(voices, { language: "zh" })).toHaveLength(2);
    expect(
      filterSystemVoices(voices, { language: "en", gender: "unknown" })[0].id,
    ).toBe("en");
    expect(
      filterSystemVoices(voices, {
        language: "zh",
        quality: "premium",
        gender: "female",
        query: "女声",
      })[0].id,
    ).toBe("zh-f");
    expect(filterSystemVoices(voices, { query: "ENGLISH" })[0].id).toBe("en");
    expect(voices).toHaveLength(3);
    expect(normalizeVoiceGender("FEMALE")).toBe("female");
    expect(normalizeVoiceGender("guessed")).toBe("unknown");
  });
});
