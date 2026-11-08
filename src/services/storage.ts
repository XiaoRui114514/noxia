import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  validateResource,
  validateTemplate,
  type Resource,
  type Template,
} from "../core";
import { validatePlaylist, type Playlist } from "../core/collections";
import { validateAlbum, type Album } from "../core/albums";
export type { Playlist } from "../core/collections";
export type PlaybackCollection = { kind: "playlist" | "album"; id: string };
export type History = {
  resourceId: string;
  title: string;
  position: number;
  date: string;
  completed: boolean;
};
export type Settings = {
  aiBase: string;
  aiModel: string;
  voiceId: string;
  translationVoiceId: string;
  dark: "system" | "light" | "dark";
};
export type Resume = {
  collection?: PlaybackCollection;
  resourceId: string;
  templateId: string;
  position: number;
  context?: string;
  planId?: string;
  stepId?: string;
  stepIndex?: number;
  sourcePlan?: import("../../modules/noxia-audio/types").AudioPlan;
  selectedIds?: string[];
  rate?: number;
};
export type Quarantine = {
  id: string;
  collection: string;
  raw: unknown;
  reason: string;
};
export type TrashEntry = {
  resource: Resource;
  deletedAt: string;
  playlists: Playlist[];
  albums?: Album[];
};
export type Review = {
  resourceId: string;
  segmentId: string;
  score: 0 | 1 | 2;
  date: string;
  due: string;
  attempts: number;
};
export type Library = {
  albums?: Album[];
  consents?: { learningResources?: { version: number; acceptedAt: string } };
  resources: Resource[];
  templates: Template[];
  playlists: Playlist[];
  history: History[];
  settings: Settings;
  resume?: Resume;
  quarantine?: Quarantine[];
  trash?: TrashEntry[];
  versions?: { resource: Resource; date: string }[];
  pronunciations?: {
    global: Record<string, string>;
    resources: Record<string, Record<string, string>>;
  };
  reviews?: Review[];
  reviewSession?: {
    resourceId: string;
    segmentId: string;
    revealed: boolean;
    answer?: string;
    score?: 0 | 1 | 2;
    submitted?: boolean;
  };
  scriptHistory?: { id: string; text: string; date: string; model: string }[];
  scriptDraft?: string;
  editorDraft?: { id: string; title: string; body: string };
  offline?: Record<string, { steps: number; date: string }>;
  timer?:
    { mode: "relative"; minutes: number } | { mode: "absolute"; at: number };
};
export const defaults: Settings = {
  aiBase: "",
  aiModel: "",
  voiceId: "",
  translationVoiceId: "",
  dark: "system",
};
export const emptyLibrary: Library = {
  resources: [],
  templates: [],
  playlists: [],
  history: [],
  settings: defaults,
};
const memorySecrets = new Map<string, string>();
export async function getSecret(key: string) {
  return Platform.OS === "web"
    ? (memorySecrets.get(key) ?? null)
    : SecureStore.getItemAsync(key);
}
export async function setSecret(key: string, value: string) {
  if (Platform.OS === "web") {
    if (value) memorySecrets.set(key, value);
    else memorySecrets.delete(key);
    return;
  }
  if (value)
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  else await SecureStore.deleteItemAsync(key);
}
export const LIBRARY_KEY = "noxia.library.v1";
export const LIBRARY_SCHEMA = 3;
export const V2_BACKUP_KEY = "noxia.library.before-migration.v2";
export const BACKUP_KEY = "noxia.library.before-migration";
export const RECOVERY_KEY = "noxia.library.before-restore";
export function freshLibrary(): Library {
  return {
    ...emptyLibrary,
    resources: [],
    templates: [],
    playlists: [],
    history: [],
    settings: { ...defaults },
  };
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function parseLibrary(raw: string): Library {
  const v: unknown = JSON.parse(raw);
  if (
    !object(v) ||
    ![1, 2, 3].includes(v.schema) ||
    !["resources", "templates", "playlists", "history"].every((k) =>
      Array.isArray(v[k]),
    )
  )
    throw new Error("本地数据格式异常，原文已保留；可在设置中导出和恢复。");
  const quarantine: Quarantine[] = Array.isArray(v.quarantine)
    ? (v.quarantine.filter(object) as Quarantine[])
    : [];
  function collect<T>(collection: string, validate: (x: unknown) => T): T[] {
    const seen = new Set<string>();
    return ((v as Record<string, any>)[collection] ?? []).flatMap(
      (raw: unknown, index: number) => {
        try {
          const value = validate(raw);
          const id = (value as any).id;
          if (id && seen.has(id)) throw new Error("ID 重复");
          if (id) seen.add(id);
          return [value];
        } catch (e) {
          quarantine.push({
            id: `${collection}:${index}:${uid()}`,
            collection,
            raw,
            reason: e instanceof Error ? e.message : "格式异常",
          });
          return [];
        }
      },
    );
  }
  const settings = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (typeof v.settings?.[key] === "string")
      (settings as Record<string, string>)[key] = v.settings[key];
  }
  if (!["system", "light", "dark"].includes(settings.dark))
    settings.dark = "system";
  const result: Library = {
    resources: collect("resources", validateResource),
    templates: collect("templates", validateTemplate),
    playlists: collect("playlists", validatePlaylist),
    albums: Array.isArray(v.albums) ? collect("albums", validateAlbum) : [],
    history: collect("history", (x) => {
      if (
        !object(x) ||
        typeof x.resourceId !== "string" ||
        typeof x.title !== "string" ||
        typeof x.date !== "string" ||
        !Number.isFinite(x.position) ||
        x.position < 0 ||
        typeof x.completed !== "boolean"
      )
        throw new Error("记录格式异常");
      return x as History;
    }),
    settings,
    quarantine,
  };
  if (v.albums !== undefined && !Array.isArray(v.albums))
    quarantine.push({
      id: uid(),
      collection: "albums",
      raw: v.albums,
      reason: "专辑格式异常",
    });
  if (
    object(v.consents) &&
    object(v.consents.learningResources) &&
    v.consents.learningResources.version === 1 &&
    typeof v.consents.learningResources.acceptedAt === "string" &&
    Number.isFinite(Date.parse(v.consents.learningResources.acceptedAt))
  )
    result.consents = {
      learningResources: {
        version: 1,
        acceptedAt: v.consents.learningResources.acceptedAt,
      },
    };
  if (
    object(v.resume) &&
    typeof v.resume.resourceId === "string" &&
    typeof v.resume.templateId === "string" &&
    Number.isFinite(v.resume.position) &&
    v.resume.position >= 0
  )
    result.resume = v.resume as Resume;
  result.trash = (Array.isArray(v.trash) ? v.trash : []).flatMap((x: any) => {
    try {
      return [
        {
          resource: validateResource(x.resource),
          deletedAt: String(x.deletedAt),
          playlists: Array.isArray(x.playlists) ? x.playlists : [],
          albums: Array.isArray(x.albums) ? x.albums.map(validateAlbum) : [],
        },
      ];
    } catch {
      quarantine.push({
        id: uid(),
        collection: "trash",
        raw: x,
        reason: "回收站资料异常",
      });
      return [];
    }
  });
  result.versions = (Array.isArray(v.versions) ? v.versions : []).flatMap(
    (x: any) => {
      try {
        return [
          { resource: validateResource(x.resource), date: String(x.date) },
        ];
      } catch {
        quarantine.push({
          id: uid(),
          collection: "versions",
          raw: x,
          reason: "历史版本异常",
        });
        return [];
      }
    },
  );
  if (object(v.pronunciations)) {
    const clean = (map: unknown) => {
      if (!object(map)) return {};
      return validatePronunciations(
        Object.entries(map)
          .map(([a, b]) => `${a}=${b}`)
          .join("\n"),
      );
    };
    try {
      result.pronunciations = {
        global: clean(v.pronunciations.global),
        resources: Object.fromEntries(
          Object.entries(v.pronunciations.resources ?? {}).map(([id, map]) => [
            id,
            clean(map),
          ]),
        ),
      };
    } catch (e) {
      quarantine.push({
        id: uid(),
        collection: "pronunciations",
        raw: v.pronunciations,
        reason: String(e),
      });
    }
  }
  result.reviews = (Array.isArray(v.reviews) ? v.reviews : []).filter(
    (x: any) =>
      object(x) &&
      typeof x.resourceId === "string" &&
      typeof x.segmentId === "string" &&
      [0, 1, 2].includes(x.score) &&
      Number.isFinite(Date.parse(x.due)) &&
      Number.isInteger(x.attempts),
  );
  if (
    object(v.reviewSession) &&
    typeof v.reviewSession.resourceId === "string" &&
    typeof v.reviewSession.segmentId === "string"
  )
    result.reviewSession = v.reviewSession as Library["reviewSession"];
  result.scriptHistory = (Array.isArray(v.scriptHistory) ? v.scriptHistory : [])
    .filter(
      (x: any) =>
        object(x) &&
        typeof x.text === "string" &&
        x.text.length <= 100000 &&
        typeof x.id === "string" &&
        typeof x.model === "string",
    )
    .slice(0, 10);
  if (
    object(v.editorDraft) &&
    typeof v.editorDraft.id === "string" &&
    typeof v.editorDraft.title === "string" &&
    typeof v.editorDraft.body === "string" &&
    v.editorDraft.body.length <= 1000000
  )
    result.editorDraft = v.editorDraft as Library["editorDraft"];
  if (typeof v.scriptDraft === "string" && v.scriptDraft.length <= 100000)
    result.scriptDraft = v.scriptDraft;
  if (object(v.offline))
    result.offline = Object.fromEntries(
      Object.entries(v.offline).filter(
        ([, x]) =>
          object(x) &&
          Number.isInteger(x.steps) &&
          x.steps > 0 &&
          typeof x.date === "string",
      ),
    ) as Library["offline"];
  if (
    object(v.timer) &&
    ((v.timer.mode === "absolute" && Number.isFinite(v.timer.at)) ||
      (v.timer.mode === "relative" &&
        Number.isFinite(v.timer.minutes) &&
        v.timer.minutes >= 0))
  )
    result.timer = v.timer as Library["timer"];
  return result;
}
export function validatePronunciations(text: string): Record<string, string> {
  if (text.length > 20000) throw new Error("词典最多 20000 字符");
  const entries = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (entries.length > 200) throw new Error("词典最多 200 条");
  const result: Record<string, string> = Object.create(null);
  for (const line of entries) {
    const at = line.indexOf("=");
    const word = line.slice(0, at).trim(),
      replacement = line.slice(at + 1).trim();
    if (
      at <= 0 ||
      !word ||
      !replacement ||
      word.length > 100 ||
      replacement.length > 200 ||
      /[\u0000-\u001f]/.test(line)
    )
      throw new Error("每行使用 原词=读音，原词最多100字，读音最多200字");
    if (Object.hasOwn(result, word)) throw new Error(`词条重复：${word}`);
    result[word] = replacement;
  }
  return result;
}
export async function loadLibrary(): Promise<Library> {
  const raw = await AsyncStorage.getItem(LIBRARY_KEY);
  if (!raw) return freshLibrary();
  const data = parseLibrary(raw);
  if (JSON.parse(raw).schema < LIBRARY_SCHEMA) {
    const key = JSON.parse(raw).schema === 2 ? V2_BACKUP_KEY : BACKUP_KEY;
    // Back up the exact bytes before any migration or automatic save.
    if (!(await AsyncStorage.getItem(key)))
      await AsyncStorage.setItem(key, raw);
  }
  return data;
}
export const exportLibrary = (value: Library) =>
  JSON.stringify({ ...value, schema: LIBRARY_SCHEMA }, null, 2);
export async function readRawLibrary() {
  return (await AsyncStorage.getItem(LIBRARY_KEY)) ?? "";
}
export async function readRecoveryBackup() {
  return (
    (await AsyncStorage.getItem(RECOVERY_KEY)) ??
    (await AsyncStorage.getItem(V2_BACKUP_KEY)) ??
    (await AsyncStorage.getItem(BACKUP_KEY)) ??
    ""
  );
}
export async function restoreLibrary(raw: string): Promise<Library> {
  if (raw.length > 30000000) throw new Error("备份超过 30 MB，请分批恢复");
  const data = parseLibrary(raw);
  await flushLibrary();
  const current = await readRawLibrary();
  if (current) await AsyncStorage.setItem(RECOVERY_KEY, current);
  await AsyncStorage.setItem(LIBRARY_KEY, exportLibrary(data));
  return data;
}
let pending: Library | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let writes = Promise.resolve();
let waiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];
export function saveLibrary(value: Library): Promise<void> {
  pending = value;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushLibrary().catch(() => {});
  }, 250);
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}
export function flushLibrary(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!pending) return writes;
  const value = pending,
    listeners = waiters;
  pending = undefined;
  waiters = [];
  writes = writes
    .catch(() => {})
    .then(() => AsyncStorage.setItem(LIBRARY_KEY, exportLibrary(value)));
  writes.then(
    () => listeners.forEach((x) => x.resolve()),
    (e) => listeners.forEach((x) => x.reject(e)),
  );
  return writes;
}
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
