import { Resource, Segment } from "./types";
import { validateResource } from "./validation";

export const resourceBody = (r: Resource) =>
  r.segments
    .map((s) => s.original + (s.translation ? "\t" + s.translation : ""))
    .join("\n");
const fields = (line: string) => {
  const [original, ...rest] = line.split("\t");
  return {
    original: original.trim(),
    translation: rest.join("\t").trim() || undefined,
  };
};
const key = (s: Pick<Segment, "original" | "translation">) =>
  JSON.stringify([s.original, s.translation ?? ""]);

/** Match unchanged lines first (including moved lines); align edits only between anchors. */
export function editResource(
  existing: Resource | undefined,
  id: string,
  title: string,
  body: string,
  newId: () => string,
): Resource {
  if (!body.trim()) throw new Error("请填写文稿");
  if (existing && resourceBody(existing) === body)
    return validateResource({ ...existing, title: title.trim() });
  const lines = body
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map(fields);
  const previous = existing?.segments ?? [];
  const used = new Set<number>();
  const matches = lines.map((line) => {
    const at = previous.findIndex(
      (s, i) => !used.has(i) && key(s) === key(line),
    );
    if (at >= 0) used.add(at);
    return at;
  });
  const segments: Segment[] = [];
  for (let i = 0; i < lines.length;) {
    if (matches[i] >= 0) {
      segments.push({ ...previous[matches[i]], ...lines[i] });
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && matches[i] < 0) i++;
    const before = matches.slice(0, start).findLast((x) => x >= 0) ?? -1,
      after = matches[i] ?? previous.length;
    const sources = previous.filter(
      (_, j) => j > before && j < after && !used.has(j),
    );
    for (let j = start; j < i; j++) {
      const source = sources[j - start];
      const group =
        j === i - 1 && sources.length > i - start
          ? sources.slice(j - start)
          : source
            ? [source]
            : [];
      const inherited = group.length
        ? group.reduce((a, b) => ({
            ...a,
            explanation:
              [a.explanation, b.explanation].filter(Boolean).join("\n") ||
              undefined,
            keywords: [a.keywords, b.keywords].flatMap((x) =>
              Array.isArray(x) ? x : x ? [x] : [],
            ),
            important: a.important || b.important,
          }))
        : sources.length === 1
          ? { paragraph: sources[0].paragraph, important: sources[0].important }
          : {};
      segments.push({
        ...inherited,
        id: source?.id ?? `${id}:${newId()}`,
        ...lines[j],
      });
    }
  }
  return validateResource({
    ...existing,
    id,
    title: title.trim(),
    kind: existing?.kind ?? "custom",
    segments,
  });
}

/** Explicit split/merge preserves ownership; no automatic bilingual alignment. */
export function splitSegment(
  r: Resource,
  index: number,
  offset: number,
  newId: string,
): Resource {
  const s = r.segments[index];
  if (!s || offset <= 0 || offset >= s.original.length)
    throw new Error("请在原文中间选择拆分位置");
  if (s.translation) throw new Error("请先人工拆分译文，再拆分原文");
  const parts = [
    { ...s, original: s.original.slice(0, offset) },
    {
      ...s,
      id: newId,
      original: s.original.slice(offset),
      explanation: undefined,
      keywords: undefined,
    },
  ];
  return validateResource({
    ...r,
    segments: [
      ...r.segments.slice(0, index),
      ...parts,
      ...r.segments.slice(index + 1),
    ],
  });
}
export function mergeSegments(r: Resource, index: number): Resource {
  const a = r.segments[index],
    b = r.segments[index + 1];
  if (!a || !b) throw new Error("没有下一句");
  const joined = (x?: string, y?: string) =>
    [x, y].filter(Boolean).join("\n") || undefined;
  const keywords = [a.keywords, b.keywords].flatMap((x) =>
    Array.isArray(x) ? x : x ? [x] : [],
  );
  return validateResource({
    ...r,
    segments: [
      ...r.segments.slice(0, index),
      {
        ...a,
        original: a.original + "\n" + b.original,
        translation: joined(a.translation, b.translation),
        explanation: joined(a.explanation, b.explanation),
        keywords: keywords.length ? keywords : undefined,
        important: a.important || b.important,
      },
      ...r.segments.slice(index + 2),
    ],
  });
}
