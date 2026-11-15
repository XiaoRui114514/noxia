import { describe, it, expect } from "vitest";
import {
  editResource,
  mergeSegments,
  splitSegment,
  resourceBody,
} from "./editor";
import { validateResource } from "./validation";
import { compileSession } from "./session";
import { presets } from "./presets";
import { fingerprint, resumePosition } from "./resume";
import { assessReview } from "./review";
const r = {
  id: "r",
  title: "t",
  kind: "custom" as const,
  segments: [
    {
      id: "stable",
      original: "原文甲",
      translation: "translation",
      explanation: "解释",
      keywords: ["one", "two"],
      important: true,
      paragraph: 12,
    },
    { id: "b", original: "原文乙", explanation: "解释乙", paragraph: 13 },
  ],
};
describe("resource editing and playback identity", () => {
  it("keeps IDs and all metadata on title-only edits, changed lines and moved lines", () => {
    expect(
      editResource(r, r.id, "新标题", resourceBody(r), () => "new").segments,
    ).toEqual(r.segments);
    expect(
      editResource(r, r.id, r.title, "修改甲\ttranslation\n原文乙", () => "new")
        .segments[0],
    ).toEqual({ ...r.segments[0], original: "修改甲" });
    expect(
      editResource(
        r,
        r.id,
        r.title,
        "原文乙\n原文甲\ttranslation",
        () => "new",
      ).segments.map((s) => s.id),
    ).toEqual(["b", "stable"]);
  });
  it("merges metadata and splits without guessing bilingual alignment", () => {
    const merged = mergeSegments(r, 0);
    expect(merged.segments[0]).toMatchObject({
      id: "stable",
      paragraph: 12,
      explanation: "解释\n解释乙",
      important: true,
    });
    expect(() => splitSegment(r, 0, 1, "new")).toThrow("人工");
    const split = splitSegment(
      { ...r, segments: [{ ...r.segments[0], translation: undefined }] },
      0,
      1,
      "new",
    );
    expect(split.segments.map((s) => s.id)).toEqual(["stable", "new"]);
    expect(split.segments[1]).toMatchObject({ paragraph: 12, important: true });
    const textMerge = editResource(
      r,
      r.id,
      r.title,
      "原文甲原文乙",
      () => "new",
    );
    expect(textMerge.segments[0].explanation).toBe("解释\n解释乙");
    const many=editResource({...r,segments:[...r.segments,{id:'c',original:'丙',explanation:'第三句解释',important:true}]},r.id,r.title,'改写第一句\n合并后两句',()=> 'new');
    expect(many.segments[1]).toMatchObject({id:'b',explanation:'解释乙\n第三句解释',important:true});
  });
  it.each([
    ["title", () => ({ ...r, title: "x".repeat(501) })],
    [
      "line",
      () => ({ ...r, segments: [{ id: "s", original: "x".repeat(10001) }] }),
    ],
    [
      "lines",
      () => ({
        ...r,
        segments: Array.from({ length: 2001 }, (_, i) => ({
          id: String(i),
          original: "x",
        })),
      }),
    ],
    [
      "keywords",
      () => ({
        ...r,
        segments: [
          { id: "s", original: "x", keywords: Array(5).fill("x".repeat(1000)) },
        ],
      }),
    ],
  ])("rejects invalid %s before it reaches storage", (_, value) =>
    expect(() => validateResource((value as () => unknown)())).toThrow(),
  );
  it("accepts exact boundaries and never treats an empty selection as full text", () => {
    expect(
      validateResource({
        ...r,
        title: "x".repeat(500),
        segments: [
          {
            id: "s",
            original: "x".repeat(10000),
            keywords: [
              "a".repeat(1000),
              "b".repeat(1000),
              "c".repeat(1000),
              "d".repeat(1000),
            ],
          },
        ],
      }),
    ).toBeDefined();
    expect(() =>
      compileSession([
        { resource: r, template: presets.simple, selectedIds: [] },
      ]),
    ).toThrow();
  });
  it("binds resume to the session, resource, step and current context", () => {
    const p = compileSession([
      { resource: r, template: Object.values(presets)[0] },
    ]);
    const resume = {
      resourceId: "r",
      templateId: "t",
      position: 3,
      planId: p.id,
      stepId: p.steps[1].id,
      stepIndex: 1,
      context: "ctx",
    };
    expect(resumePosition(resume, p, 20, "ctx")).toBe(3);
    const identicalOtherTemplate=compileSession([{resource:r,template:{...Object.values(presets)[0],id:'other-template'}}]);
    expect(identicalOtherTemplate.id).not.toBe(p.id);
    const explicitSelection=compileSession([{resource:r,template:Object.values(presets)[0],selectedIds:r.segments.map(s=>s.id)}]);
    expect(explicitSelection.id).not.toBe(p.id);
    for (const patch of [
      { resourceId: "other" },
      { planId: "old" },
      { stepId: "old" },
      { stepIndex: 99 },
      { position: 21 },
    ])
      expect(
        resumePosition({ ...resume, ...patch }, p, 20, "ctx"),
      ).toBeUndefined();
    expect(resumePosition(resume, p, 20, "changed")).toBeUndefined();
    expect(fingerprint(r)).not.toBe(fingerprint({ ...r, title: "changed" }));
  });
  it("schedules only explicit self assessments", () => {
    const now = Date.parse("2026-11-07T00:00:00Z");
    expect(assessReview(undefined, "r", "s", 0, now).due).toBe(
      "2026-11-07T00:10:00.000Z",
    );
    expect(assessReview(undefined, "r", "s", 2, now).score).toBe(2);
  });
});

it('restores playlist order and only the deleted item options',async()=>{
 const {restorePlaylistLink}=await import('./libraryOperations');
 expect(restorePlaylistLink({id:'p',name:'p',resourceIds:['a','c','new'],options:{a:{rate:1.5}}},{id:'p',name:'p',resourceIds:['a','b','c'],options:{a:{rate:1},b:{rate:1.25}}},'b')).toEqual({id:'p',name:'p',resourceIds:['a','b','c','new'],options:{a:{rate:1.5},b:{rate:1.25}}});
});

it('counts keyword array characters toward the full resource limit',()=>{
 const segments=Array.from({length:100},(_,i)=>({id:String(i),original:'x'.repeat(9995),...(i===0?{keywords:['k'.repeat(1000)]}:{})}));
 expect(()=>validateResource({...r,segments})).toThrow('100 万字符');
});
