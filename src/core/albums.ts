import { collectionIdentity } from "./collections";
import { compileSession, SessionEntry } from "./session";
import { Plan, Resource, Step, Template } from "./types";
import { AUDIO_LIMITS } from "./limits";
import { ValidationError } from "./validation";

export type AlbumSettings = {
  mode: "article" | "sentence";
  originalRepeat: number;
  translationRepeat: number;
  voiceId: string;
  translationVoiceId: string;
  rate: number;
  gapMs: number;
  repeat: number;
  shuffle: boolean;
  loop: boolean;
};
export type Album = {
  id: string;
  name: string;
  resourceIds: string[];
  settings: AlbumSettings;
};
export const albumDefaults: AlbumSettings = {
  mode: "article",
  originalRepeat: 2,
  translationRepeat: 1,
  voiceId: "",
  translationVoiceId: "",
  rate: 1,
  gapMs: 1500,
  repeat: 1,
  shuffle: false,
  loop: false,
};
export function validateAlbum(raw: unknown): Album {
  const base = collectionIdentity(raw),
    settings = (raw as Album).settings;
  if (
    !settings ||
    typeof settings !== "object" ||
    !["article", "sentence"].includes(settings.mode)
  )
    throw new ValidationError("请选择整篇或逐句朗读");
  const bound = (
    v: number,
    label: string,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      throw new ValidationError(
        `${label}须为 ${min}–${max}${integer ? " 的整数" : ""}`,
      );
    return v;
  };
  const originalRepeat = bound(
      settings.originalRepeat,
      "原文遍数",
      0,
      20,
      true,
    ),
    translationRepeat = bound(
      settings.translationRepeat,
      "译文遍数",
      0,
      20,
      true,
    );
  if (originalRepeat + translationRepeat === 0)
    throw new ValidationError("原文与译文至少朗读一项");
  for (const v of [settings.voiceId, settings.translationVoiceId])
    if (typeof v !== "string" || v.length > 300)
      throw new ValidationError("声音设置无效");
  if (
    typeof settings.shuffle !== "boolean" ||
    typeof settings.loop !== "boolean"
  )
    throw new ValidationError("专辑播放规则无效");
  if (settings.gapMs > 0 && settings.gapMs < AUDIO_LIMITS.minSilenceMs)
    throw new ValidationError("间隔须为 0 或至少 50 毫秒");
  return {
    ...base,
    settings: {
      mode: settings.mode,
      originalRepeat,
      translationRepeat,
      voiceId: settings.voiceId,
      translationVoiceId: settings.translationVoiceId,
      rate: bound(settings.rate, "语速", 0.25, 2),
      gapMs: bound(settings.gapMs, "间隔毫秒", 0, 600000, true),
      repeat: bound(settings.repeat, "专辑轮数", 1, 20, true),
      shuffle: settings.shuffle,
      loop: settings.loop,
    },
  };
}
export function albumSummary(s: AlbumSettings): string {
  return `${s.mode === "article" ? "整篇" : "逐句"} · 原文 ${s.originalRepeat} 遍 · 译文 ${s.translationRepeat} 遍 · ${s.shuffle ? "随机" : "顺序"}${s.loop ? " · 循环" : ` · ${s.repeat} 轮`}`;
}
/** Each whole-article pass keeps independent segment utterances; long lessons never become one giant speech request. */
export function compileAlbum(
  input: Album,
  resources: Resource[],
  random = Math.random,
): Plan {
  const album = validateAlbum(input),
    s = album.settings,
    warnings = new Set<string>();
  const ordered = album.resourceIds.slice();
  if (s.shuffle)
    for (let i = ordered.length - 1; i > 0; i--) {
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
        throw new ValidationError("随机数无效");
      const j = Math.floor(draw * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  const entries: SessionEntry[] = [];
  const template = (kind: "original" | "translation" | "both"): Template => {
    const step = (name: Step["kind"], repeat: number): Step => ({
      id: `album-${name}`,
      kind: name,
      repeat,
      rate: s.rate,
      volume: 1,
      durationMs: name === "pause" ? s.gapMs : 0,
      enabled: true,
    });
    return {
      id: `album:${album.id}:${kind}`,
      name: album.name,
      scope: "sentence",
      steps: [
        ...(kind !== "translation" && s.originalRepeat
          ? [step("original", kind === "both" ? s.originalRepeat : 1)]
          : []),
        ...(kind !== "original" && s.translationRepeat
          ? [step("translation", kind === "both" ? s.translationRepeat : 1)]
          : []),
        ...(s.gapMs ? [step("pause", 1)] : []),
      ],
    };
  };
  for (const id of ordered) {
    const resource = resources.find((r) => r.id === id);
    if (!resource)
      throw new ValidationError("专辑包含已删除资料，请先移除缺失曲目");
    const hasOriginal = resource.segments.some((x) => x.original.trim()),
      translated = resource.segments.filter((x) =>
        x.translation?.trim(),
      ).length,
      hasTranslation = translated > 0;
    if (s.translationRepeat && !hasTranslation)
      warnings.add(`${resource.title}：暂无译文，已跳过译文`);
    else if (s.translationRepeat && translated < resource.segments.length)
      warnings.add(
        `${resource.title}：${resource.segments.length - translated} 句缺少译文，已跳过这些译文`,
      );
    const append = (kind: "original" | "translation" | "both") => {
      const segments = resource.segments.filter(
        (x) =>
          (kind !== "translation" && s.originalRepeat && x.original.trim()) ||
          (kind !== "original" && s.translationRepeat && x.translation?.trim()),
      );
      if (!segments.length) return;
      entries.push({
        resource: { ...resource, segments },
        template: template(kind),
        voiceId: s.voiceId || undefined,
        translationVoiceId: s.translationVoiceId,
      });
    };
    if (s.mode === "sentence") append("both");
    else {
      if (hasOriginal)
        for (let n = 0; n < s.originalRepeat; n++) append("original");
      if (hasTranslation)
        for (let n = 0; n < s.translationRepeat; n++) append("translation");
    }
  }
  if (!entries.length)
    throw new ValidationError("专辑没有可朗读内容，请加入资料并检查所选文字");
  const plan = compileSession(entries, { repeat: s.repeat, loop: s.loop });
  return {
    ...plan,
    id: `album:${album.id}:${plan.id}`,
    title: album.name,
    warnings: [...new Set([...warnings, ...plan.warnings])],
  };
}
