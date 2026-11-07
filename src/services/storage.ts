import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  validateResource,
  validateTemplate,
  type Resource,
  type Template,
} from "../core";
export type Playlist = {
  id: string;
  name: string;
  resourceIds: string[];
  options?: Record<
    string,
    { templateId?: string; voiceId?: string; rate?: number }
  >;
};
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
export type Library = {
  resources: Resource[];
  templates: Template[];
  playlists: Playlist[];
  history: History[];
  settings: Settings;
  resume?: { resourceId: string; templateId: string; position: number };
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
export async function loadLibrary(): Promise<Library> {
  const raw = await AsyncStorage.getItem("noxia.library.v1");
  if (!raw)
    return {
      ...emptyLibrary,
      resources: [],
      templates: [],
      playlists: [],
      history: [],
      settings: { ...defaults },
    };
  const v = JSON.parse(raw);
  if (
    v.schema !== 1 ||
    !Array.isArray(v.resources) ||
    !Array.isArray(v.templates) ||
    !Array.isArray(v.playlists) ||
    !Array.isArray(v.history)
  )
    throw new Error("本地数据格式异常，已保留原始数据。请勿清除应用。");
  try {
    v.resources.forEach(validateResource);
    v.templates = v.templates.map(validateTemplate);
    if (
      v.playlists.some(
        (p: Playlist) =>
          !p ||
          typeof p.id !== "string" ||
          typeof p.name !== "string" ||
          !Array.isArray(p.resourceIds) ||
          p.resourceIds.some((id) => typeof id !== "string"),
      )
    )
      throw new Error("playlists");
    if (
      v.history.some(
        (h: History) =>
          !h ||
          typeof h.resourceId !== "string" ||
          typeof h.title !== "string" ||
          typeof h.date !== "string" ||
          !Number.isFinite(h.position) ||
          h.position < 0,
      )
    )
      throw new Error("history");
    const settings = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof Settings)[]) {
      if (typeof v.settings?.[key] === "string")
        (settings as Record<string, string>)[key] = v.settings[key];
    }
    return { ...v, settings };
  } catch {
    throw new Error(
      "本地资料校验失败，已保留原始数据，未覆盖。请保留应用数据并联系维护者。",
    );
  }
}
let pending = Promise.resolve();
export function saveLibrary(value: Library) {
  pending = pending
    .catch(() => {})
    .then(() =>
      AsyncStorage.setItem(
        "noxia.library.v1",
        JSON.stringify({ ...value, schema: 1 }),
      ),
    );
  return pending;
}
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
