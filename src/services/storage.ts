import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { Resource, Template } from "../core";
export type Playlist = { id: string; name: string; resourceIds: string[] };
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
  syncBase: string;
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
  aiBase: "https://api.openai.com/v1",
  aiModel: "gpt-4.1-mini",
  syncBase: "",
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
  if (!raw) return emptyLibrary;
  const v = JSON.parse(raw);
  if (
    v.schema !== 1 ||
    !Array.isArray(v.resources) ||
    !Array.isArray(v.templates) ||
    !Array.isArray(v.playlists) ||
    !Array.isArray(v.history)
  )
    throw new Error("本地数据格式异常，已保留原始数据。请勿清除应用。");
  return { ...v, settings: { ...defaults, ...v.settings } };
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
