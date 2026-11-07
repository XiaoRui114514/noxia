import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { getSecret, setSecret } from "./storage";
import {
  DEFAULT_TTS_SETTINGS,
  listTTSVoices,
  ttsBase,
  validateTTSSettings,
  type TTSConsent,
  type TTSSettings,
  type TTSVoice,
} from "./tts";

const CONFIG_NAME = "noxia.tts-config.v1";
const canonical = (base: string) => {
  try {
    return ttsBase(base);
  } catch {
    return null;
  }
};
export async function voiceKeyStorageName(base: string) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    ttsBase(base),
  );
  return `tts-endpoint-${hash}`;
}

/** External voice credentials are device-only and never copied from the text AI connection. */
export function useVoiceConnection() {
  const [settings, publishSettings] = useState<TTSSettings>({
    ...DEFAULT_TTS_SETTINGS,
  });
  const current = useRef(settings);
  const [consent, publishConsent] = useState<TTSConsent | null>(null);
  const currentConsent = useRef<TTSConsent | null>(null);
  const [ready, setReady] = useState(false);
  const [keyReady, setKeyReady] = useState(true);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [externalVoices, setExternalVoices] = useState<TTSVoice[]>([]);
  const [voicesSupported, setVoicesSupported] = useState<boolean | null>(null);
  const [listStatus, setListStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [listError, setListError] = useState("");
  const mounted = useRef(true);
  const keyEpoch = useRef(0);
  const listEpoch = useRef(0);
  const editEpoch = useRef(0);
  const writes = useRef(Promise.resolve());

  function replace(next: TTSSettings) {
    current.current = next;
    publishSettings(next);
  }
  function updateConsent(next: TTSConsent | null) {
    currentConsent.current = next;
    publishConsent(next);
  }

  const hydrateKey = useCallback(async (base: string) => {
    const epoch = ++keyEpoch.current;
    setKeyReady(false);
    try {
      const key = await getSecret(await voiceKeyStorageName(base));
      if (
        !mounted.current ||
        epoch !== keyEpoch.current ||
        canonical(current.current.base) !== base
      )
        return;
      const next = { ...current.current, key: key ?? "" };
      current.current = next;
      publishSettings(next);
      setKeyReady(true);
    } catch {
      if (mounted.current && epoch === keyEpoch.current) {
        setKeyReady(true);
        setError("无法读取此语音接口的安全密钥，可重新输入后保存。");
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const start = ++editEpoch.current;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(CONFIG_NAME);
        if (!mounted.current || editEpoch.current !== start) return;
        if (raw) {
          const value: unknown = JSON.parse(raw);
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error();
          const v = value as Record<string, unknown>;
          const valid = validateTTSSettings({
            provider: "openai-compatible",
            base: v.base,
            key: "",
            model: v.model,
            voice: v.voice,
            version: v.version ?? "",
          });
          replace(valid);
          const storedConsent = v.consent as Record<string, unknown> | null;
          if (
            storedConsent?.confirmed === true &&
            typeof storedConsent.base === "string" &&
            canonical(storedConsent.base) === valid.base
          )
            updateConsent({ base: valid.base, confirmed: true });
          await hydrateKey(valid.base);
        }
      } catch {
        if (mounted.current && editEpoch.current === start)
          setError("语音配置未能读取，已保留原始数据。请检查设置后重新保存。");
      } finally {
        if (mounted.current) setReady(true);
      }
    })();
    return () => {
      mounted.current = false;
      keyEpoch.current++;
      listEpoch.current++;
      editEpoch.current++;
    };
  }, [hydrateKey]);

  const setConfig = useCallback(
    (patch: Partial<TTSSettings>) => {
      const prior = current.current;
      const next = { ...prior, ...patch };
      const oldBase = canonical(prior.base);
      const newBase = canonical(next.base);
      const changedBase =
        oldBase !== newBase || (!newBase && prior.base !== next.base);
      editEpoch.current++;
      setError("");
      setSaveState("idle");
      if (
        changedBase ||
        prior.model !== next.model ||
        patch.provider === "system"
      )
        updateConsent(null);
      if (changedBase) {
        // Clear synchronously before React effects run: no render may carry the old endpoint's key.
        keyEpoch.current++;
        listEpoch.current++;
        next.key = "";
        setExternalVoices([]);
        setVoicesSupported(null);
        setListStatus("idle");
        setListError("");
        setKeyReady(!newBase);
      }
      if (next.base.trim() && patch.provider !== "system")
        next.provider = "openai-compatible";
      replace(next);
      if (changedBase && newBase) void hydrateKey(newBase);
    },
    [hydrateKey],
  );

  const setKey = useCallback((key: string) => {
    if (!canonical(current.current.base)) return;
    // A typed key supersedes a still-pending keychain read.
    keyEpoch.current++;
    listEpoch.current++;
    editEpoch.current++;
    replace({ ...current.current, key });
    updateConsent(null);
    setKeyReady(true);
    setSaveState("idle");
    setError("");
    setExternalVoices([]);
    setListStatus("idle");
    setVoicesSupported(null);
  }, []);

  const setConsent = useCallback((checked: boolean) => {
    if (!checked) {
      updateConsent(null);
      setSaveState("idle");
      return;
    }
    try {
      const valid = validateTTSSettings(current.current);
      if (valid.provider !== "openai-compatible") throw new Error();
      updateConsent({ base: valid.base, confirmed: true });
      setError("");
      setSaveState("idle");
    } catch {
      setError("请先填写有效语音地址、模型和声音 ID，再确认发送。");
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    if (!canonical(current.current.base)) return;
    const snapshot = { ...current.current };
    const epoch = ++listEpoch.current;
    setListStatus("loading");
    setListError("");
    try {
      const result = await listTTSVoices(snapshot);
      if (!mounted.current || epoch !== listEpoch.current) return;
      setExternalVoices(result.voices);
      setVoicesSupported(result.supported);
      setListStatus("ready");
    } catch (e) {
      if (!mounted.current || epoch !== listEpoch.current) return;
      setExternalVoices([]);
      setListStatus("error");
      setListError(
        e instanceof Error
          ? e.message
          : "声音目录读取失败，请手动填写声音 ID。",
      );
    }
  }, []);

  useEffect(() => {
    if (
      !ready ||
      !keyReady ||
      !canonical(settings.base) ||
      settings.provider !== "openai-compatible"
    )
      return;
    const timer = setTimeout(() => void refreshVoices(), 700);
    return () => {
      clearTimeout(timer);
      listEpoch.current++;
    };
  }, [
    ready,
    keyReady,
    settings.base,
    settings.key,
    settings.provider,
    refreshVoices,
  ]);

  const save = useCallback(async () => {
    const epoch = editEpoch.current;
    let snapshot: TTSSettings;
    try {
      snapshot = validateTTSSettings(current.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "语音设置无效");
      setSaveState("error");
      return;
    }
    if (snapshot.provider === "system") {
      setError("请先配置一个外部语音地址；系统声音无需额外保存。");
      return;
    }
    setSaveState("saving");
    setError("");
    const savedConsent = currentConsent.current;
    const operation = writes.current
      .catch(() => {})
      .then(async () => {
        await setSecret(await voiceKeyStorageName(snapshot.base), snapshot.key);
        // Whitelisted metadata only. No personal key, input text, catalog or audio is serialized.
        await AsyncStorage.setItem(
          CONFIG_NAME,
          JSON.stringify({
            base: snapshot.base,
            model: snapshot.model,
            voice: snapshot.voice,
            version: snapshot.version,
            consent: savedConsent?.base === snapshot.base ? savedConsent : null,
          }),
        );
      });
    writes.current = operation;
    try {
      await operation;
      if (mounted.current && epoch === editEpoch.current) setSaveState("saved");
    } catch {
      if (mounted.current && epoch === editEpoch.current) {
        setSaveState("error");
        setError("语音配置保存失败，请检查设备存储后重试。");
      }
    }
  }, []);

  return {
    settings,
    consent,
    ready,
    keyReady,
    error,
    saveState,
    externalVoices,
    voicesSupported,
    listStatus,
    listError,
    setConfig,
    setKey,
    setConsent,
    save,
    refreshVoices,
  };
}
export type VoiceConnection = ReturnType<typeof useVoiceConnection>;
