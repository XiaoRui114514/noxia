/** TTS has separate credentials and consent from text-generation providers. */
export type TTSSettings = {
  provider: "system" | "openai-compatible";
  base: string;
  key: string;
  model: string;
  voice: string;
  /** User-supplied model/voice revision, used to invalidate saved audio. */
  version: string;
};

export const DEFAULT_TTS_SETTINGS: TTSSettings = {
  provider: "system",
  base: "",
  key: "",
  model: "",
  voice: "",
  version: "",
};

export type VoiceGender = "female" | "male" | "unknown";
export type VoiceMetadata = {
  id: string;
  name: string;
  language: string;
  quality: string;
  gender?: string;
};
export type TTSVoice = VoiceMetadata;
export type VoiceFilter = {
  query?: string;
  language?: string;
  quality?: string;
  gender?: VoiceGender;
};
export type SpeechRequest = { text: string; voice?: string; rate?: number };
export type TTSConsent = { base: string; confirmed: true };
export type SynthesizedSpeech = {
  bytes: Uint8Array;
  mimeType: "audio/mpeg";
  extension: "mp3";
};

export const TTS_SERVICE_NOTICE =
  "系统声音免费。外部服务会接收文字，可能收费。";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_BYTES = 512 * 1024;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function field(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\r\n\0]/.test(value) ||
    (!allowEmpty && !value.trim())
  )
    throw new Error(`${label}无效`);
  return value.trim();
}

export function ttsBase(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    // Never echo the URL: it may contain an accidentally pasted credential.
    throw new Error("语音接口须为无凭据、无查询参数的 HTTPS 地址");
  }
}

/** Whitelist restored settings; no tokens, arbitrary fields or consent are imported. */
export function validateTTSSettings(value: unknown): TTSSettings {
  if (
    !isRecord(value) ||
    !["system", "openai-compatible"].includes(String(value.provider))
  )
    throw new Error("语音来源无效");
  if (value.provider === "system") return { ...DEFAULT_TTS_SETTINGS };
  return {
    provider: "openai-compatible",
    base: ttsBase(field(value.base, "语音接口地址", 2000)),
    key: field(value.key, "语音 API Key", 4096, true),
    model: field(value.model, "语音模型", 200),
    voice: field(value.voice, "声音 ID", 300),
    version: field(value.version ?? "", "声音版本", 200, true),
  };
}

export function normalizeVoiceGender(value: unknown): VoiceGender {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return text === "female" || text === "male" ? text : "unknown";
}

/** Preserve identifiers and original metadata; never infer gender from a voice name. */
export function filterSystemVoices<T extends VoiceMetadata>(
  voices: readonly T[],
  filter: VoiceFilter,
): T[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  const language = filter.language?.trim().toLocaleLowerCase() ?? "";
  return voices.filter((voice) => {
    const locale = voice.language.toLocaleLowerCase().replace(/_/g, "-");
    return (
      (!query ||
        `${voice.name} ${voice.id} ${voice.language}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (!language ||
        language === "all" ||
        locale === language ||
        locale.startsWith(`${language}-`)) &&
      (!filter.quality ||
        filter.quality === "all" ||
        voice.quality === filter.quality) &&
      (!filter.gender || normalizeVoiceGender(voice.gender) === filter.gender)
    );
  });
}

function cloudSettings(settings: TTSSettings) {
  const valid = validateTTSSettings(settings);
  if (valid.provider === "system")
    throw new Error("请使用设备原生模块播放系统声音");
  return valid;
}

function validatedRequest(settings: TTSSettings, request: SpeechRequest) {
  if (
    typeof request.text !== "string" ||
    !request.text.trim() ||
    request.text.length > 4096
  )
    throw new Error("每个语音片段须为 1—4096 字符，请拆成较短段落");
  const rate = request.rate ?? 1;
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4)
    throw new Error("合成语速须在 0.25—4 之间");
  return {
    text: request.text,
    voice: field(request.voice ?? settings.voice, "声音 ID", 300),
    rate,
  };
}

/** Hash this canonical identity before using it as a filename; API keys are excluded. */
export function ttsCacheIdentity(
  settings: TTSSettings,
  request: SpeechRequest,
): string {
  const valid = cloudSettings(settings);
  const input = validatedRequest(valid, request);
  return JSON.stringify({
    schema: "noxia-tts-v1",
    provider: valid.provider,
    base: valid.base,
    model: valid.model,
    voice: input.voice,
    version: valid.version,
    text: input.text,
    rate: input.rate,
    format: "mp3",
  });
}

async function serviceFetch(
  settings: TTSSettings,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(`${settings.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(settings.key ? { Authorization: `Bearer ${settings.key}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Accept: body === undefined ? "application/json" : "audio/mpeg",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error("语音服务连接失败或超时，请检查地址和网络");
  }
}

async function boundedBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > limit) throw new Error("语音服务返回内容过大");
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > limit) {
          await reader.cancel();
          throw new Error("语音服务返回内容过大");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  // React Native implementations may expose arrayBuffer but no ReadableStream.
  const result = new Uint8Array(await response.arrayBuffer());
  if (result.length > limit) throw new Error("语音服务返回内容过大");
  return result;
}

function voiceMetadata(value: unknown): TTSVoice | undefined {
  if (typeof value === "string") {
    if (!value.trim() || value.length > 300) return undefined;
    return {
      id: value,
      name: value,
      language: "",
      quality: "service",
      gender: "unknown",
    };
  }
  if (!isRecord(value)) return undefined;
  const id = value.id ?? value.voice_id;
  if (typeof id !== "string" || !id.trim() || id.length > 300) return undefined;
  const languages = value.languages;
  const language =
    value.language ??
    value.locale ??
    (Array.isArray(languages) ? languages[0] : "");
  return {
    id,
    name: typeof value.name === "string" ? value.name.slice(0, 300) : id,
    language: typeof language === "string" ? language.slice(0, 80) : "",
    quality:
      typeof value.quality === "string"
        ? value.quality.slice(0, 80)
        : "service",
    gender: normalizeVoiceGender(value.gender),
  };
}

/** Optional extension, not part of the OpenAI speech protocol; manual IDs remain supported. */
export async function listTTSVoices(
  settings: TTSSettings,
): Promise<{ voices: TTSVoice[]; supported: boolean }> {
  // Listing does not need a model or a chosen voice yet. Validate those with placeholders.
  const valid = cloudSettings({
    ...settings,
    model: settings.model || "list-only",
    voice: settings.voice || "list-only",
  });
  for (const path of ["/audio/voices", "/voices"]) {
    const response = await serviceFetch(valid, path);
    if (response.status === 404 || response.status === 405) continue;
    if (!response.ok)
      throw new Error(`声音列表返回 ${response.status}，请检查权限或服务文档`);
    let data: unknown;
    try {
      const bytes = await boundedBytes(response, MAX_VOICE_BYTES);
      // Response JSON decoding works in native runtimes without a global TextDecoder.
      data = await new Response(bytes.buffer as ArrayBuffer).json();
    } catch {
      throw new Error("声音列表格式无效或过大，请手动填写声音 ID");
    }
    const source = Array.isArray(data)
      ? data
      : isRecord(data)
        ? (data.voices ?? data.data)
        : undefined;
    if (!Array.isArray(source))
      throw new Error("声音列表格式无效，请手动填写声音 ID");
    const seen = new Set<string>();
    const voices: TTSVoice[] = [];
    for (const item of source.slice(0, 1000)) {
      const voice = voiceMetadata(item);
      if (voice && !seen.has(voice.id)) {
        voices.push(voice);
        seen.add(voice.id);
      }
    }
    return { voices, supported: true };
  }
  return { voices: [], supported: false };
}

/** Caller checks saved cache first. One explicit consent is required per service base. */
export async function synthesizeSpeech(
  settings: TTSSettings,
  request: SpeechRequest,
  consent: TTSConsent,
  signal?: AbortSignal,
): Promise<SynthesizedSpeech> {
  const valid = cloudSettings(settings);
  const input = validatedRequest(valid, request);
  if (
    !consent ||
    consent.confirmed !== true ||
    ttsBase(consent.base) !== valid.base
  )
    throw new Error("请先确认将文字发送到所选语音服务及其可能的费用");
  const response = await serviceFetch(
    valid,
    "/audio/speech",
    {
      model: valid.model,
      input: input.text,
      voice: input.voice,
      response_format: "mp3",
      speed: input.rate,
    },
    signal,
  );
  if (!response.ok)
    throw new Error(
      `语音服务返回 ${response.status}，请检查权限、额度、模型与声音 ID`,
    );
  let bytes: Uint8Array;
  try {
    bytes = await boundedBytes(response, MAX_AUDIO_BYTES);
  } catch {
    throw new Error("音频下载失败或超过大小限制，请重试较短文字");
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (
    contentType &&
    !["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(
      contentType,
    )
  )
    throw new Error("语音服务未返回 MP3 音频，请检查接口兼容性");
  // Reject JSON/HTML/error text even when a provider labels it as binary audio.
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (bytes.length < 4 || (!id3 && !frame))
    throw new Error("语音服务返回的音频无效或格式不受支持");
  return { bytes, mimeType: "audio/mpeg", extension: "mp3" };
}
