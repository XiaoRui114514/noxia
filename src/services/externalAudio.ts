import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import Audio, {
  audioCapabilities,
  type AudioPlan,
  type AudioStep,
} from "../../modules/noxia-audio";
import {
  synthesizeSpeech,
  ttsCacheIdentity,
  ttsBase,
  type TTSSettings,
  type TTSConsent,
} from "./tts";

function chunks(text: string, max = 3000): string[] {
  const values = Array.from(text),
    result: string[] = [];
  for (let start = 0; start < values.length;) {
    let end = start,
      units = 0;
    while (end < values.length && units + values[end].length <= max) {
      units += values[end].length;
      end++;
    }
    if (end < values.length) {
      for (let i = end; i > start + (end - start) / 2; i--) {
        if (/[\s。！？.!?；;]/u.test(values[i - 1])) {
          end = i;
          break;
        }
      }
    }
    result.push(values.slice(start, end).join(""));
    start = end;
  }
  return result;
}

function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已停止准备");
}
function localFallback(step: AudioStep): AudioStep {
  return { ...step, kind: "speech", voiceId: undefined, uri: undefined };
}
function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Render only explicitly selected external voices. All requests precede native playback. */
export async function prepareExternalAudio(
  plan: AudioPlan,
  settings: TTSSettings,
  consent: TTSConsent | null,
  signal?: AbortSignal,
): Promise<{ plan: AudioPlan; warnings: string[] }> {
  const isExternal = (s: AudioStep) =>
    s.kind === "speech" && s.voiceId?.startsWith("remote:");
  if (!plan.steps.some(isExternal)) return { plan, warnings: [] };
  if (Platform.OS !== "ios" || !audioCapabilities.native)
    return {
      plan: {
        ...plan,
        steps: plan.steps.map((s) => (isExternal(s) ? localFallback(s) : s)),
      },
      warnings: ["外部声音请在应用内使用，此次使用系统声音。"],
    };
  let allowed = false;
  try {
    allowed =
      settings.provider === "openai-compatible" &&
      !!consent?.confirmed &&
      ttsBase(consent.base) === ttsBase(settings.base);
  } catch {}
  if (!allowed)
    return {
      plan: {
        ...plan,
        steps: plan.steps.map((s) => (isExternal(s) ? localFallback(s) : s)),
      },
      warnings: ["外部声音尚未授权，此次使用系统声音。"],
    };
  const groups = plan.steps.map((original) => {
    if (!isExternal(original)) return { original, parts: [original] };
    let text = original.text ?? "";
    for (const [word, replacement] of Object.entries(
      plan.pronunciations ?? {},
    ).sort((a, b) => b[0].length - a[0].length))
      if (word) text = text.split(word).join(replacement);
    return {
      original,
      parts: chunks(text).map((text, i) => ({
        ...original,
        id: `${original.id}:tts:${i}`,
        text,
      })),
    };
  });
  const expanded = groups.flatMap((group) => group.parts);
  if (
    expanded.length > 1000 ||
    expanded.reduce((n, s) => n + (s.text?.length ?? 0), 0) > 150000
  )
    throw new Error("语音编排过长，请分成多个列表");
  const steps: AudioStep[] = [],
    assets = new Map<string, string>();
  let failed = false;
  for (const { original, parts } of groups) {
    check(signal);
    if (!isExternal(original)) {
      steps.push(original);
      continue;
    }
    if (failed) {
      steps.push(localFallback(original));
      continue;
    }
    try {
      const rendered: AudioStep[] = [];
      for (const step of parts) {
        check(signal);
        const voice = step.voiceId!.slice("remote:".length),
          request = { text: step.text ?? "", voice, rate: step.rate };
        const key = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          JSON.stringify({
            identity: ttsCacheIdentity({ ...settings, voice }, request),
            pronunciations: plan.pronunciations ?? {},
          }),
        );
        check(signal);
        let uri = assets.get(key);
        if (!uri) {
          const cached = await Audio.getExternalAudio(key);
          check(signal);
          uri = cached?.uri;
        }
        if (!uri) {
          const audio = await synthesizeSpeech(
            { ...settings, voice },
            request,
            consent!,
            signal,
          );
          check(signal);
          uri = (await Audio.cacheExternalAudio(toBase64(audio.bytes), key))
            .uri;
        }
        check(signal);
        assets.set(key, uri);
        rendered.push({ ...step, kind: "file", uri, rate: 1 });
      }
      steps.push(...rendered);
    } catch (e) {
      check(signal);
      failed = true;
      steps.push(localFallback(original));
    }
  }
  return {
    plan: { ...plan, steps },
    warnings: failed ? ["语音服务暂不可用，未生成的部分已改用系统声音。"] : [],
  };
}
