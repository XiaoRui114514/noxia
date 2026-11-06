import { describe, expect, it } from "vitest";
import {
  compileSession,
  makeStep,
  Resource,
  SessionEntry,
  Template,
} from "./index";

const template: Template = {
  id: "t",
  name: "逐句",
  scope: "sentence",
  steps: [makeStep("original", { id: "original" })],
};
const resource = (id: string, text = id): Resource => ({
  id,
  title: `${id}标题`,
  author: `${id}作者`,
  kind: "custom",
  segments: [
    { id: "same-segment-id", original: text, translation: `${text}译文` },
  ],
});
const entry = (id: string, text?: string): SessionEntry => ({
  resource: resource(id, text),
  template,
});

describe("cross-resource native session compiler", () => {
  it("combines works with native metadata and preserves original segment IDs", () => {
    const plan = compileSession([entry("a"), entry("b")]);
    expect(plan.steps.map((s) => s.text)).toEqual(["a", "b"]);
    expect(plan.steps.map((s) => s.segmentId)).toEqual([
      "same-segment-id",
      "same-segment-id",
    ]);
    expect(plan.steps.map((s) => s.resourceId)).toEqual(["a", "b"]);
    expect(plan.steps[1]).toMatchObject({ title: "b标题", author: "b作者" });
    expect(plan.loop).toBe(false);
  });

  it("repeats the entire playlist and assigns every step a unique ID", () => {
    const a = entry("a");
    const plan = compileSession([a, entry("b"), a], { repeat: 2, loop: true });
    expect(plan.steps.map((s) => s.text)).toEqual([
      "a",
      "b",
      "a",
      "a",
      "b",
      "a",
    ]);
    expect(new Set(plan.steps.map((s) => s.id)).size).toBe(6);
    expect(plan.loop).toBe(true);
  });

  it("preserves per-entry sentence selections across full-session repetitions", () => {
    const custom = entry("a");
    custom.resource.segments.push({ id: "second", original: "只听这一句" });
    const plan = compileSession([{ ...custom, selectedIds: ["second"] }], {
      repeat: 2,
    });
    expect(plan.steps.map((step) => step.text)).toEqual([
      "只听这一句",
      "只听这一句",
    ]);
    expect(plan.steps.every((step) => step.segmentId === "second")).toBe(true);
    expect(() =>
      compileSession([{ ...custom, selectedIds: ["removed"] }]),
    ).toThrow("已不存在");
  });

  it("uses deterministic Fisher–Yates once then repeats that order without input mutation", () => {
    const input = [entry("a"), entry("b"), entry("c")];
    const before = structuredClone(input);
    const plan = compileSession(input, {
      shuffle: true,
      random: () => 0,
      repeat: 2,
    });
    expect(plan.steps.map((s) => s.text)).toEqual([
      "b",
      "c",
      "a",
      "b",
      "c",
      "a",
    ]);
    expect(input).toEqual(before);
    expect(
      compileSession(input, { shuffle: true, random: () => 0, repeat: 2 }).id,
    ).toBe(plan.id);
    expect(() =>
      compileSession(input, { shuffle: true, random: () => 1 }),
    ).toThrow("随机数");
    expect(() =>
      compileSession(input, { shuffle: true, random: () => NaN }),
    ).toThrow("随机数");
  });

  it("keeps per-entry voices, multiplies speech rates, and leaves silence timing unchanged", () => {
    const mixed: Template = {
      ...template,
      steps: [
        makeStep("original", { rate: 0.8 }),
        makeStep("translation"),
        makeStep("recall", { durationMs: 5000 }),
      ],
    };
    const plan = compileSession([
      {
        ...entry("a"),
        template: mixed,
        voiceId: "zh",
        translationVoiceId: "en",
        rate: 1.5,
      },
    ]);
    expect(plan.steps[0].rate).toBeCloseTo(1.2);
    expect(plan.steps[0].voiceId).toBe("zh");
    expect(plan.steps[1]).toMatchObject({ rate: 1.5, voiceId: "en" });
    expect(plan.steps[2]).toMatchObject({
      rate: 1,
      durationMs: 5000,
      kind: "silence",
    });
  });

  it("clamps multiplied rates to legal native range with a visible warning", () => {
    const plan = compileSession([
      {
        ...entry("a"),
        template: { ...template, steps: [makeStep("original", { rate: 2 })] },
        rate: 2,
      },
      {
        ...entry("b"),
        template: {
          ...template,
          steps: [makeStep("original", { rate: 0.25 })],
        },
        rate: 0.25,
      },
    ]);
    expect(plan.steps.map((s) => s.rate)).toEqual([2, 0.25]);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toContain("叠加语速");
  });

  it("aggregates resource-specific warnings without fabricating missing content", () => {
    const noTranslation = resource("a");
    delete noTranslation.segments[0].translation;
    const plan = compileSession(
      [
        {
          resource: noTranslation,
          template: {
            ...template,
            steps: [makeStep("translation"), makeStep("original")],
          },
        },
      ],
      { repeat: 2 },
    );
    expect(plan.steps.map((s) => s.text)).toEqual(["a", "a"]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("a标题");
    expect(plan.warnings[0]).toContain("缺失");
  });

  it("uses a short stable identity that changes with actual content and playback order", () => {
    const first = compileSession([entry("a"), entry("b")]);
    expect(first.id).toBe(compileSession([entry("a"), entry("b")]).id);
    expect(first.id.length).toBeLessThan(100);
    expect(first.id).not.toBe(compileSession([entry("b"), entry("a")]).id);
    expect(first.id).not.toBe(
      compileSession([entry("a", "新文字"), entry("b")]).id,
    );
    expect(first.id).not.toBe(
      compileSession([entry("a"), entry("b")], { repeat: 2 }).id,
    );
  });

  it("applies the native step limit across resources and playlist repetitions", () => {
    const many = Array.from({ length: 500 }, (_, i) => entry(String(i)));
    expect(compileSession(many, { repeat: 2 }).steps).toHaveLength(1000);
    expect(() =>
      compileSession([...many, entry("last")], { repeat: 2 }),
    ).toThrow("1000 步");
  });

  it("applies total character and silence limits across individually valid plans", () => {
    const long = entry("a", "甲".repeat(10000));
    long.resource.segments[0].translation = "";
    expect(compileSession([long], { repeat: 15 }).steps).toHaveLength(15);
    expect(() => compileSession([long], { repeat: 16 })).toThrow("15 万");
    const pauses: Template = {
      ...template,
      steps: [makeStep("pause", { durationMs: 600000, repeat: 16 })],
    };
    expect(
      compileSession([{ ...entry("a"), template: pauses }], { repeat: 3 })
        .steps,
    ).toHaveLength(48);
    expect(() =>
      compileSession([{ ...entry("a"), template: pauses }], { repeat: 4 }),
    ).toThrow("8 小时");
  });

  it("rejects empty playlists and invalid repeat, rate, or option values", () => {
    expect(() => compileSession([])).toThrow("1–1000");
    for (const repeat of [0, -1, 1.5, 21, Infinity, NaN])
      expect(() => compileSession([entry("a")], { repeat })).toThrow(
        "重复次数",
      );
    for (const rate of [0.2, 2.1, Infinity, NaN])
      expect(() => compileSession([{ ...entry("a"), rate }])).toThrow(
        "条目语速",
      );
    expect(() =>
      compileSession([entry("a")], { loop: "yes" as unknown as boolean }),
    ).toThrow("循环设置");
    expect(() =>
      compileSession([entry("a")], { shuffle: 1 as unknown as boolean }),
    ).toThrow("随机播放设置");
  });
});
