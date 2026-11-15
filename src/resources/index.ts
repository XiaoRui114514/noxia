import JSON5 from "json5";

/** Adapter contract. Only adapter code is MIT; downloaded source material retains its licence. */
export interface Resource {
  id: string;
  title: string;
  author?: string;
  kind: "poetry" | "grammar" | "custom";
  source?: { repo: string; path: string; version: string; url: string };
  segments: Array<{
    id: string;
    original: string;
    translation?: string;
    explanation?: string;
    keywords?: string;
    important?: boolean;
    paragraph?: number;
  }>;
  generated?: boolean;
  warnings?: string[];
  attribution?: string;
  licenseUrl?: string;
  reviewUrl?: string;
}

/** Increment when the acknowledgement terms change. */
export const RESOURCE_LICENSE_VERSION=1;
export type RemoteKind = "poetry" | "grammar";
export interface ResourceEntry {
  id: string;
  title: string;
  author?: string;
  kind: RemoteKind;
  repo: string;
  path: string;
  version: string;
  licenseUrl: string;
}
export interface DownloadOptions {
  /** Must follow a user action acknowledging the source's personal noncommercial licence. */
  acceptPersonalUseLicense: boolean;
  fetcher?: typeof fetch;
}

export const resourceSources = {
  poetry: {
    repo: "XiaoRui114514/poetry-recite",
    version: "47dee16aea10c547a61adfbffcef52385d08995f",
    attribution:
      "上海初高古诗文背诵 · Hison 制作 · 抖音 XRuiiiiii · 小红书 xiaoruiaaa520",
  },
  grammar: {
    repo: "XiaoRui114514/english-grammar-lab",
    version: "b7bf67996c7862664a346053c4d801ba83bf9fcf",
    attribution:
      "上海初高语法填空 · Hison · 抖音 XRuiiiiii · 小红书 xiaoruiaaa520",
  },
} as const;

const grammarTitles = [
  "一般现在时",
  "一般过去时",
  "一般将来时",
  "现在进行时",
  "过去进行时",
  "现在完成时",
  "过去完成时",
  "现在时 vs 过去时",
  "一般时 vs 进行时",
  "一般过去时 vs 现在完成时",
  "将来表达方式",
  "七大时态综合大复习",
];
type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("资源对象格式不受支持");
  return value as RecordValue;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`资源缺少${name}`);
  return value;
}
function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    return [];
  return value as string[];
}
function rawUrl(
  entry: Pick<ResourceEntry, "repo" | "path" | "version">,
): string {
  return `https://raw.githubusercontent.com/${entry.repo}/${entry.version}/${entry.path}`;
}
function source(entry: ResourceEntry): NonNullable<Resource["source"]> {
  return {
    repo: entry.repo,
    path: entry.path,
    version: entry.version,
    url: `https://github.com/${entry.repo}/blob/${entry.version}/${entry.path}`,
  };
}
function checkConsent(options: DownloadOptions): void {
  if (!options.acceptPersonalUseLicense)
    throw new Error(
      "请先阅读来源许可；这些资源只允许个人非商业学习，不能随 MIT 代码重新分发。",
    );
}
async function fetchText(
  entry: Pick<ResourceEntry, "repo" | "path" | "version">,
  options: DownloadOptions,
): Promise<string> {
  checkConsent(options);
  const response = await (options.fetcher ?? fetch)(rawUrl(entry), {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `资源下载失败（HTTP ${response.status}）；本地资料仍可使用。`,
    );
  const data = await response.text();
  if (data.length > 3_000_000) throw new Error("资源超过安全大小限制");
  return data;
}

/** No remote JavaScript execution. Only a balanced JSON5 object literal is accepted. */
export function parseGrammarSource(script: string, topicId: string): unknown {
  if (!/^tense(?:0[1-9]|1[0-2])$/.test(topicId))
    throw new Error("不支持的语法专题");
  const marker = new RegExp(`window\\.__GRAMMAR_LAB__\\.${topicId}\\s*=\\s*`);
  const found = marker.exec(script);
  if (!found) throw new Error("上游资源格式改变：找不到专题注册对象");
  const start = found.index + found[0].length;
  if (script[start] !== "{") throw new Error("专题必须是数据对象");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = start; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON5.parse(script.slice(start, i + 1));
    }
  }
  throw new Error("专题数据对象不完整");
}

export function adaptPoetry(
  metaValue: unknown,
  translationValue: unknown,
  entry: ResourceEntry,
): Resource {
  const meta = object(metaValue);
  const id = requiredString(meta.id, "篇目 ID");
  const originals = stringList(meta.sentences);
  if (!originals.length || originals.some((item) => !item.trim()))
    throw new Error("资源缺少显式原文句子，无法安全对应译文");
  const translation = translationValue ? object(translationValue) : undefined;
  const translations =
    translation?.id === id ? stringList(translation.translations) : [];
  const aligned = translations.length === originals.length;
  const focus = Array.isArray(meta.examFocus) ? meta.examFocus : [];
  const focusByIndex = new Map<number, string>();
  for (const item of focus) {
    const mark = object(item);
    if (
      Number.isInteger(mark.index) &&
      Number(mark.index) >= 0 &&
      Number(mark.index) < originals.length
    ) {
      focusByIndex.set(
        Number(mark.index),
        typeof mark.reason === "string" ? mark.reason : "来源标注的考试重点",
      );
    }
  }
  return {
    id: `poetry:${id}`,
    title: requiredString(meta.title, "标题"),
    author: typeof meta.author === "string" ? meta.author : undefined,
    kind: "poetry",
    source: source(entry),
    generated: false,
    attribution: resourceSources.poetry.attribution,
    licenseUrl: entry.licenseUrl,
    reviewUrl: `https://github.com/${entry.repo}`,
    warnings: aligned
      ? [
          "译文为来源作者整理，使用前请核对教材；句子对应已按来源 ID 和显式句序检查。",
        ]
      : ["译文缺失或句数不一致，已停止逐句配对，绝不移位拼接。"],
    segments: originals.map((original, index) => ({
      id: `${id}:${index}`,
      original,
      translation: aligned ? translations[index] : undefined,
      important: focusByIndex.has(index),
      explanation: focusByIndex.get(index),
      paragraph: index,
    })),
  };
}

export function adaptGrammar(value: unknown, entry: ResourceEntry): Resource {
  const topic = object(value);
  const id = requiredString(topic.id, "专题 ID");
  if (`grammar:${id}` !== entry.id) throw new Error("语法专题 ID 与目录不一致");
  const card = object(topic.knowledgeCard);
  const segments: Resource["segments"] = [];
  const add = (text: unknown, key: string, important = false) => {
    if (typeof text === "string" && text.trim())
      segments.push({
        id: `${id}:${key}`,
        original: text,
        important,
        paragraph: segments.length,
      });
  };
  add(card.oneLine, "concept", true);
  add(card.structure, "structure", true);
  stringList(card.scenes).forEach((text, index) => add(text, `scene:${index}`));
  stringList(card.examples).forEach((text, index) =>
    add(text, `example:${index}`),
  );
  add(card.commonMistake, "mistake", true);
  add(card.judgment, "judgment");
  stringList(topic.review5).forEach((text, index) =>
    add(text, `review:${index}`, true),
  );
  if (!segments.length) throw new Error("专题没有可听读的知识卡内容");
  return {
    id: `grammar:${id}`,
    title: requiredString(topic.title, "标题"),
    kind: "grammar",
    source: source(entry),
    generated: false,
    segments,
    attribution: resourceSources.grammar.attribution,
    licenseUrl: entry.licenseUrl,
    reviewUrl: `https://github.com/${entry.repo}`,
    warnings: [
      "原始知识卡来自个人整理资料，未将其视为权威教材；例句中的中文括注保持完整，不自动猜测双语对应。",
    ],
  };
}

export async function listRemoteResources(
  kind: RemoteKind,
  options: DownloadOptions,
): Promise<ResourceEntry[]> {
  checkConsent(options);
  const config = resourceSources[kind];
  const licenseUrl = `https://github.com/${config.repo}/blob/${config.version}/LICENSE`;
  if (kind === "grammar")
    return grammarTitles.map((title, index) => {
      const no = String(index + 1).padStart(2, "0");
      return {
        id: `grammar:tense${no}`,
        title,
        kind,
        repo: config.repo,
        version: config.version,
        path: `data/bank-tense-${no}.js`,
        licenseUrl,
      };
    });
  const path = "meta/poems.json";
  const data: unknown = JSON.parse(
    await fetchText({ ...config, path }, options),
  );
  if (!Array.isArray(data)) throw new Error("古诗文目录格式不受支持");
  return data.map((value) => {
    const meta = object(value);
    return {
      id: `poetry:${requiredString(meta.id, "篇目 ID")}`,
      title: requiredString(meta.title, "标题"),
      author: typeof meta.author === "string" ? meta.author : undefined,
      kind,
      repo: config.repo,
      version: config.version,
      path,
      licenseUrl,
    };
  });
}

export async function loadRemoteResource(
  entry: ResourceEntry,
  options: DownloadOptions,
): Promise<Resource> {
  const config = resourceSources[entry.kind];
  // Keep downloads pinned to audited upstream commits and known paths; entry is not a URL escape hatch.
  if (!config || entry.repo !== config.repo || entry.version !== config.version)
    throw new Error("资源来源或版本未被审查");
  if (entry.kind === "grammar") {
    const match = /^grammar:tense(0[1-9]|1[0-2])$/.exec(entry.id);
    if (!match || entry.path !== `data/bank-tense-${match[1]}.js`)
      throw new Error("语法资源路径不受支持");
    const script = await fetchText(entry, options);
    return adaptGrammar(
      parseGrammarSource(script, entry.id.slice("grammar:".length)),
      entry,
    );
  }
  if (entry.path !== "meta/poems.json")
    throw new Error("古诗文资源路径不受支持");
  const metaData: unknown = JSON.parse(await fetchText(entry, options));
  if (!Array.isArray(metaData)) throw new Error("古诗文目录格式不受支持");
  const meta = metaData
    .map(object)
    .find((item) => `poetry:${item.id}` === entry.id);
  if (!meta) throw new Error("篇目已不存在于固定版本目录");
  // Upstream publishes explicit sentence arrays and translated arrays in matching numbered batches.
  // Find by ID, then require exact array lengths. Never split classical Chinese on punctuation here.
  for (let batch = 1; batch <= 11; batch += 1) {
    const path = `data/translations/poems/batch-${String(batch).padStart(2, "0")}.json`;
    const data = object(
      JSON.parse(await fetchText({ ...entry, path }, options)),
    );
    if (!Array.isArray(data.poems)) throw new Error("译文批次格式不受支持");
    const translation = data.poems
      .map(object)
      .find((item) => item.id === meta.id);
    if (translation) return adaptPoetry(meta, translation, entry);
  }
  return adaptPoetry(meta, undefined, entry);
}
