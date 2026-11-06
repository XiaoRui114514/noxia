import { compile } from "./engine";
import { AUDIO_LIMITS } from "./limits";
import { AudioStep, Plan, Resource, Template } from "./types";
import { ValidationError } from "./validation";

export interface SessionEntry {
  resource: Resource;
  template: Template;
  voiceId?: string;
  translationVoiceId?: string;
  selectedIds?: string[];
  /** Multiply the template's relative speech rates; resulting rates are clamped to 0.25–2. */
  rate?: number;
}

export interface SessionOptions {
  loop?: boolean;
  /** Repeat the entire playlist, not each individual item. */
  repeat?: number;
  shuffle?: boolean;
  random?: () => number;
}

/** Prepare all entries as a single native timeline, so crossing works needs no foreground JS. */
export function compileSession(
  entries: SessionEntry[],
  options: SessionOptions = {},
): Plan {
  if (
    !Array.isArray(entries) ||
    !entries.length ||
    entries.length > AUDIO_LIMITS.maxSteps
  ) {
    throw new ValidationError("播放列表须包含 1–1000 个条目");
  }
  const repeat = options.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    throw new ValidationError("播放列表重复次数须为 1–20 的整数");
  }
  if (options.loop !== undefined && typeof options.loop !== "boolean")
    throw new ValidationError("播放列表循环设置无效");
  if (options.shuffle !== undefined && typeof options.shuffle !== "boolean")
    throw new ValidationError("随机播放设置无效");
  if (options.random !== undefined && typeof options.random !== "function")
    throw new ValidationError("随机数生成器无效");

  // Copy before shuffling; neither library entries nor templates are mutated.
  const ordered = entries.slice();
  if (options.shuffle) {
    const random = options.random ?? Math.random;
    for (let i = ordered.length - 1; i > 0; i--) {
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
        throw new ValidationError("随机数须在 0（含）至 1（不含）之间");
      const j = Math.floor(draw * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }

  const warnings = new Set<string>();
  const prepared = ordered.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new ValidationError("播放列表条目无效");
    const multiplier = entry.rate ?? 1;
    if (!Number.isFinite(multiplier) || multiplier < 0.25 || multiplier > 2)
      throw new ValidationError("条目语速须在 0.25–2 之间");
    const plan = compile(entry.resource, entry.template, {
      voiceId: entry.voiceId,
      translationVoiceId: entry.translationVoiceId,
      selectedIds: entry.selectedIds,
    });
    for (const warning of plan.warnings)
      warnings.add(`${plan.title}：${warning}`);
    const steps = plan.steps.map((step): AudioStep => {
      const rawRate = step.rate * multiplier;
      const rate =
        step.kind === "speech" ? Math.min(2, Math.max(0.25, rawRate)) : 1;
      if (step.kind === "speech" && rate !== rawRate)
        warnings.add(
          `${plan.title}：条目与模板的叠加语速已调整至 0.25–2 范围。`,
        );
      return {
        ...step,
        rate,
        resourceId: entry.resource.id,
        title: plan.title,
        author: plan.author,
      };
    });
    return { plan, steps };
  });

  const steps: AudioStep[] = [];
  let characters = 0;
  let silenceMs = 0;
  for (let cycle = 0; cycle < repeat; cycle++) {
    for (let entryIndex = 0; entryIndex < prepared.length; entryIndex++) {
      for (const step of prepared[entryIndex].steps) {
        if (step.kind === "speech") characters += step.text?.length ?? 0;
        else silenceMs += step.durationMs ?? 0;
        if (
          steps.length >= AUDIO_LIMITS.maxSteps ||
          characters > AUDIO_LIMITS.maxSpeechCharacters ||
          silenceMs > AUDIO_LIMITS.maxTimelineMs
        ) {
          throw new ValidationError(
            "播放列表编排过长（最多 1000 步、15 万朗读字符或 8 小时留白），请减少篇目、重复或拆分列表",
          );
        }
        steps.push({
          ...step,
          id: `session:${cycle}:${entryIndex}:${step.id}`,
        });
      }
    }
  }
  const title =
    prepared.length === 1
      ? prepared[0].plan.title
      : `${prepared[0].plan.title.slice(0, 120)} 等 ${prepared.length} 篇`;
  const loop = options.loop ?? false;
  // A short, deterministic identity for resume state, not a security or audio-cache hash.
  const id = `session-${shortIdentity(JSON.stringify({ steps, loop }))}`;
  return {
    id,
    title,
    author: prepared.length === 1 ? prepared[0].plan.author : undefined,
    steps,
    loop,
    warnings: [...warnings],
  };
}

function shortIdentity(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
