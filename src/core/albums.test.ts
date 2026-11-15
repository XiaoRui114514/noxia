import { describe, it, expect } from "vitest";
import { albumDefaults, compileAlbum, validateAlbum, Album } from "./albums";
import {
  addResource,
  moveResource,
  removeResource,
  restoreResourceLink,
  validatePlaylist,
  validatePlaylistOptions,
} from "./collections";
import { Resource } from "./types";
const resources: Resource[] = ["a", "b"].map((id) => ({
  id,
  title: id,
  kind: "custom",
  segments: [
    { id: id + "1", original: id + "1", translation: id + "T1" },
    { id: id + "2", original: id + "2", translation: id + "T2" },
  ],
}));
const album = (p: Partial<Album["settings"]> = {}): Album => ({
  id: "album",
  name: "课文专辑",
  resourceIds: ["b", "a"],
  settings: { ...albumDefaults, gapMs: 0, ...p },
});
describe("albums and ordered lists", () => {
  it("uses the saved track order, repeats whole original then whole translation, with separate voices", () => {
    const p = compileAlbum(
      album({ voiceId: "zh", translationVoiceId: "en", rate: 0.75 }),
      resources,
    );
    expect(p.steps.map((s) => s.text)).toEqual([
      "b1",
      "b2",
      "b1",
      "b2",
      "bT1",
      "bT2",
      "a1",
      "a2",
      "a1",
      "a2",
      "aT1",
      "aT2",
    ]);
    expect(p.steps.every((s) => s.rate === 0.75)).toBe(true);
    expect(
      p.steps
        .filter((s) => s.text?.includes("T"))
        .every((s) => s.voiceId === "en"),
    ).toBe(true);
    expect(
      p.steps
        .filter((s) => !s.text?.includes("T"))
        .every((s) => s.voiceId === "zh"),
    ).toBe(true);
    expect(p.title).toBe("课文专辑");
  });
  it("keeps automatic translation voice independent from an explicitly chosen original voice", () => {
    const p = compileAlbum(
      album({ voiceId: "zh", translationVoiceId: "" }),
      resources,
    );
    expect(p.steps.find((s) => s.text === "bT1")?.voiceId).toBe("");
  });
  it("supports sentence mode, disabled fields, full album repeat and native loop", () => {
    const p = compileAlbum(
      album({
        mode: "sentence",
        originalRepeat: 2,
        translationRepeat: 1,
        repeat: 2,
        loop: true,
      }),
      resources,
    );
    const once = [
      "b1",
      "b1",
      "bT1",
      "b2",
      "b2",
      "bT2",
      "a1",
      "a1",
      "aT1",
      "a2",
      "a2",
      "aT2",
    ];
    expect(p.steps.map((s) => s.text)).toEqual([...once, ...once]);
    expect(p.loop).toBe(true);
    expect(new Set(p.steps.map((s) => s.id)).size).toBe(p.steps.length);
    expect(
      compileAlbum(
        album({ originalRepeat: 0, translationRepeat: 1 }),
        resources,
      ).steps.map((s) => s.text),
    ).toEqual(["bT1", "bT2", "aT1", "aT2"]);
  });
  it("shuffles tracks as units without shuffling their language passes", () => {
    const p = compileAlbum(album({ shuffle: true }), resources, () => 0);
    expect(p.steps.slice(0, 6).every((s) => s.resourceId === "a")).toBe(true);
    expect(p.steps.slice(6).every((s) => s.resourceId === "b")).toBe(true);
  });
  it("does not join long articles into an over-limit utterance and keeps sentence identity", () => {
    const r: Resource = {
      id: "long",
      title: "long",
      kind: "custom",
      segments: Array.from({ length: 4 }, (_, i) => ({
        id: String(i),
        original: "x".repeat(3000),
      })),
    };
    const p = compileAlbum(
      {
        ...album({ originalRepeat: 1, translationRepeat: 0 }),
        resourceIds: ["long"],
      },
      [r],
    );
    expect(p.steps).toHaveLength(4);
    expect(p.steps.map((s) => s.segmentId)).toEqual(["0", "1", "2", "3"]);
  });
  it("reports missing translation, refuses missing resources and enforces preparation limits", () => {
    const noTranslation = resources.map((r) => ({
      ...r,
      segments: r.segments.map((s) => ({ ...s, translation: undefined })),
    }));
    expect(compileAlbum(album(), noTranslation).warnings.join()).toContain(
      "暂无译文",
    );
    const partial = resources.map((r) => ({
      ...r,
      segments: r.segments.map((s, i) =>
        i ? { ...s, translation: undefined } : s,
      ),
    }));
    expect(compileAlbum(album(), partial).warnings).toContain(
      "b：1 句缺少译文，已跳过这些译文",
    );
    expect(
      compileAlbum(album(), partial).steps.filter((s) => s.text?.includes("T")),
    ).toHaveLength(2);
    expect(() =>
      compileAlbum(album({ originalRepeat: 0 }), noTranslation),
    ).toThrow("没有可朗读内容");
    expect(() =>
      compileAlbum({ ...album(), resourceIds: ["gone"] }, resources),
    ).toThrow("已删除");
    expect(() =>
      compileAlbum(
        album({ originalRepeat: 20, translationRepeat: 20, repeat: 20 }),
        resources,
      ),
    ).toThrow("编排过长");
  });
  it.each([
    { originalRepeat: 0, translationRepeat: 0 },
    { originalRepeat: 1.5 },
    { translationRepeat: -1 },
    { rate: 0 },
    { gapMs: 1 },
    { repeat: 21 },
    { voiceId: 123 },
  ])("rejects invalid persisted settings %o", (patch) =>
    expect(() => validateAlbum(album(patch as any))).toThrow(),
  );
  it("adds idempotently, moves the intended resource and does not mutate a prior snapshot", () => {
    const p = {
      id: "p",
      name: "p",
      resourceIds: ["b"],
      options: { b: { rate: 1.25 } },
    };
    const a = addResource(p, "a");
    expect(addResource(a, "a").resourceIds).toEqual(["b", "a"]);
    const moved = moveResource(a, 1, -1);
    expect(moved.resourceIds).toEqual(["a", "b"]);
    expect(p.resourceIds).toEqual(["b"]);
    expect(removeResource(moved, "a").resourceIds).toEqual(["b"]);
    expect(addResource(removeResource(moved, "a"), "a").resourceIds).toEqual([
      "b",
      "a",
    ]);
    expect(moveResource(moved, 0, -1)).toBe(moved);
  });
  it("restores deleted album associations without reverting later album settings", () => {
    const before = album(),
      current = {
        ...before,
        resourceIds: ["a"],
        settings: { ...before.settings, rate: 1.5 },
      };
    expect(restoreResourceLink(current, before, "b")).toEqual({
      ...current,
      resourceIds: ["b", "a"],
    });
  });
  it("validates playlist options without requiring them to be rewritten by a new client", () => {
    expect(
      validatePlaylist({
        id: "p",
        name: "旧列表",
        resourceIds: ["b", "a"],
        options: {
          b: {
            templateId: "old",
            voiceId: "v",
            translationVoiceId: "t",
            rate: 1.25,
          },
        },
      }).options?.b,
    ).toEqual({
      templateId: "old",
      voiceId: "v",
      translationVoiceId: "t",
      rate: 1.25,
    });
    expect(() => validatePlaylistOptions({ rate: 0 })).toThrow();
  });
});
