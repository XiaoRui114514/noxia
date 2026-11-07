import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import Audio from "./modules/noxia-audio";
import type {
  AudioPlan,
  AudioStatus,
  Voice,
} from "./modules/noxia-audio/types";
import {
  compileSession,
  presets,
  makeStep,
  parseTemplate,
  exportTemplate,
  type Resource,
  type Template,
  type Step,
} from "./src/core";
import {
  emptyLibrary,
  getSecret,
  loadLibrary,
  saveLibrary,
  setSecret,
  uid,
  type Library,
} from "./src/services/storage";
import { generateCachedScript } from "./src/services/ai";
import { login, logout, syncRequest, SyncError } from "./src/services/sync";
import {
  listRemoteResources,
  loadRemoteResource,
  type ResourceEntry,
} from "./src/resources";
import { palettes } from "./src/ui/theme";
import { AdaptiveShell } from "./src/ui/AdaptiveShell";
import { ModelSettings, useModelConnection } from "./src/ui/ModelSettings";
import {
  ACCOUNT_API,
  isAccountConfigured,
  ACCOUNT_UNAVAILABLE_MESSAGE,
} from "./src/services/accountConfig";
import { VoiceSettings } from "./src/ui/VoiceSettings";
import { useVoiceConnection } from "./src/services/useVoiceConnection";
import { prepareExternalAudio } from "./src/services/externalAudio";

const SAMPLE: Resource = {
  id: "welcome",
  title: "留一点时间，听见自己",
  author: "Noxia · 原创示例",
  kind: "custom",
  segments: [
    {
      id: "welcome:1",
      original: "把今天的一个知识点，讲给明天的自己。",
      translation: "Explain one thing you learned today to your future self.",
      paragraph: 0,
    },
    {
      id: "welcome:2",
      original: "听过之后，留一点安静的时间，试着自己回想。",
      translation:
        "After listening, leave a quiet moment and try to recall it yourself.",
      paragraph: 1,
    },
    {
      id: "welcome:3",
      original: "慢一点也没关系，记忆需要练习。",
      translation: "Take your time. Remembering takes practice.",
      paragraph: 2,
    },
  ],
};
type Page =
  | "home"
  | "library"
  | "editor"
  | "player"
  | "templates"
  | "voices"
  | "audio"
  | "history"
  | "ai"
  | "settings"
  | "playlists"
  | "sleep";
const nav: {
  id: Page;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { id: "home", label: "现在听", icon: "sunny-outline" },
  { id: "library", label: "资源", icon: "library-outline" },
  { id: "playlists", label: "播放列表", icon: "list-outline" },
  { id: "editor", label: "文稿", icon: "create-outline" },
  { id: "ai", label: "讲稿", icon: "reader-outline" },
  { id: "templates", label: "编排", icon: "reorder-four-outline" },
  { id: "voices", label: "声音", icon: "mic-outline" },
  { id: "audio", label: "缓存", icon: "download-outline" },
  { id: "history", label: "记录", icon: "time-outline" },
  { id: "sleep", label: "睡前", icon: "moon-outline" },
  { id: "settings", label: "设置", icon: "settings-outline" },
];
const labels: Record<string, string> = {
  original: "原文",
  translation: "翻译",
  explanation: "解释",
  custom: "自定义文字",
  keywords: "关键词",
  recall: "留白自背",
  pause: "静音停顿",
  nextSentence: "下一句",
  nextParagraph: "下一段",
};
const clock = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
export default function App() {
  const { width } = useWindowDimensions();
  const system = useColorScheme();
  const [db, setDb] = useState<Library>(emptyLibrary),
    [loaded, setLoaded] = useState(false),
    [storageOK, setStorageOK] = useState(false);
  const [page, setPage] = useState<Page>("home"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const [activeId, setActiveId] = useState("welcome"),
    [templateId, setTemplateId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [loop, setLoop] = useState(false),
    [rate, setRate] = useState(1),
    [sleep, setSleep] = useState(0);
  const [status, setStatus] = useState<AudioStatus>({
      playing: false,
      position: 0,
      duration: 0,
      stepIndex: 0,
    }),
    [plan, setPlan] = useState<AudioPlan | null>(null),
    [voices, setVoices] = useState<Voice[]>([]),
    [cache, setCache] = useState({ count: 0, bytes: 0 });
  const [editId, setEditId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [templateDraft, setTemplateDraft] = useState<Template | null>(null),
    [templateJSON, setTemplateJSON] = useState("");
  const [remote, setRemote] = useState<ResourceEntry[]>([]),
    [consent, setConsent] = useState(false),
    [query, setQuery] = useState("");
  const [aiKey, setAIKey] = useState(""),
    [aiStyle, setAIStyle] = useState("简单讲解"),
    [prompt, setPrompt] = useState("目标约 3 分钟，解释概念、例子与常见错误。"),
    [aiSource, setAISource] = useState(""),
    [aiOutput, setAIOutput] = useState(""),
    [usage, setUsage] = useState("");
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [account, setAccount] = useState(""),
    [playlistName, setPlaylistName] = useState(""),
    [playlistId, setPlaylistId] = useState("");
  const [queue, setQueue] = useState<string[]>([]),
    [deadline, setDeadline] = useState(""),
    [dictionary, setDictionary] = useState("");
  const [showTranscript, setShowTranscript] = useState(true);
  const transcriptRef = useRef<React.ComponentRef<typeof ScrollView>>(null),
    transcriptOffsets = useRef<Record<string, number>>({});
  const [syncConflict, setSyncConflict] = useState<unknown>(null);
  const dbRef = useRef(db),
    statusRef = useRef(status),
    activeRef = useRef(activeId),
    templateRef = useRef(templateId);
  const progressWidth = useRef(1);
  const [repeatCount, setRepeatCount] = useState(1),
    [shuffle, setShuffle] = useState(false),
    [itemEditId, setItemEditId] = useState("");
  const livePlanRef = useRef(plan);
  livePlanRef.current = plan;
  const started = useRef(false),
    lastSaved = useRef(0),
    positionRestore = useRef(0),
    fade = useRef(new Animated.Value(1)).current,
    reduceMotion = useRef(false);
  dbRef.current = db;
  statusRef.current = status;
  activeRef.current = activeId;
  templateRef.current = templateId;
  const dark =
    page === "sleep" ||
    db.settings.dark === "dark" ||
    (db.settings.dark === "system" && system === "dark");
  const c = palettes[dark ? "dark" : "light"];
  const wide = width >= 1100;
  const resources = db.resources;
  const active =
    resources.find((r) => r.id === activeId) ?? resources[0] ?? SAMPLE;
  const allTemplates = [...Object.values(presets), ...db.templates];
  const template =
    allTemplates.find((t) => t.id === templateId) ?? allTemplates[0];
  function update(fn: (prev: Library) => Library) {
    setDb((v) => fn(v));
  }
  function settings(p: Partial<Library["settings"]>) {
    update((v) => ({ ...v, settings: { ...v.settings, ...p } }));
  }
  const modelConnection = useModelConnection({
    base: db.settings.aiBase,
    selectedModel: db.settings.aiModel,
    apiKey: aiKey,
    onBaseChange: (base) => settings({ aiBase: base }),
    onModelChange: (model) => settings({ aiModel: model }),
    onKeyChange: setAIKey,
    enabled: loaded && (page === "settings" || page === "ai"),
  });
  const voiceConnection = useVoiceConnection();
  const audioPreparation = useRef(0),
    audioAbort = useRef<AbortController | null>(null);
  function message(error: unknown) {
    setNotice(error instanceof Error ? error.message : String(error));
  }
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      message(e);
    } finally {
      setBusy("");
    }
  }
  function persistProgress(completed = false, sample?: AudioStatus) {
    if (!livePlanRef.current) return;
    const v = dbRef.current,
      s = sample ?? statusRef.current,
      id = s.resourceId ?? activeRef.current;
    const resource = v.resources.find((r) => r.id === id);
    if (!resource || s.duration === 0) return;
    const h = {
      resourceId: id,
      title: resource.title,
      position: s.resourcePosition ?? s.position,
      date: new Date().toISOString(),
      completed,
    };
    setDb((prev) => ({
      ...prev,
      resume: {
        resourceId: id,
        templateId: templateRef.current,
        position: s.resourcePosition ?? s.position,
      },
      history: [h, ...prev.history.filter((x) => x.resourceId !== id)].slice(
        0,
        200,
      ),
    }));
  }
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(
      (v) => (reduceMotion.current = v),
    );
    const reduce = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => (reduceMotion.current = v),
    );
    task("打开资料", async () => {
      const data = await loadLibrary();
      if (!data.resources.length) data.resources = [SAMPLE];
      setDb(data);
      setStorageOK(true);
      if (data.resume) {
        setActiveId(data.resume.resourceId);
        setTemplateId(data.resume.templateId);
        positionRestore.current = data.resume.position;
      }
      setLoaded(true);
    });
    Audio.listVoices().then(setVoices).catch(message);
    const sub = Audio.addListener("onStatus", (s) => {
      const previous = statusRef.current;
      if (s.resourceId && s.resourceId !== previous.resourceId) {
        persistProgress(
          (previous.resourceDuration ?? 0) > 0 &&
            (previous.resourcePosition ?? 0) >=
              (previous.resourceDuration ?? 0) - 0.35,
          previous,
        );
        activeRef.current = s.resourceId;
        setActiveId(s.resourceId);
        setSelected([]);
        setQueue((v) => {
          const i = v.indexOf(s.resourceId!);
          return i >= 0 ? v.slice(i + 1) : v;
        });
      }
      statusRef.current = s;
      setStatus(s);
      if (s.error) setNotice(s.error);
      if (s.playing) started.current = true;
      if (
        started.current &&
        !s.playing &&
        s.duration > 0 &&
        s.position >= s.duration - 0.15
      ) {
        started.current = false;
        persistProgress(true);
      }
      if (s.playing && Date.now() - lastSaved.current > 5000) {
        lastSaved.current = Date.now();
        persistProgress();
      }
    });
    return () => {
      reduce.remove();
      sub.remove();
    };
  }, []);
  useEffect(() => {
    if (!loaded || !isAccountConfigured()) return;
    let active = true;
    void syncRequest(ACCOUNT_API, "/v1/auth/me")
      .then((data) => {
        if (active && typeof data.user?.username === "string")
          setAccount(data.user.username);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [loaded]);
  useEffect(() => {
    if (loaded && storageOK) saveLibrary(db).catch(message);
  }, [db, loaded, storageOK]);
  useEffect(() => {
    if (!reduceMotion.current) {
      fade.setValue(0.35);
      Animated.timing(fade, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [page]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
      if (e.code === "ArrowRight") Audio.seek(statusRef.current.position + 10);
      if (e.code === "ArrowLeft")
        Audio.seek(Math.max(0, statusRef.current.position - 10));
    };
    globalThis.addEventListener?.("keydown", handler);
    return () => globalThis.removeEventListener?.("keydown", handler);
  }, [plan]);
  function go(next: Page) {
    if (next === "sleep") {
      setSleep((v) => v || 30);
      setLoop(false);
    }
    setPage(next);
    setNotice("");
  }
  function putResource(r: Resource) {
    stopAudio();
    setPlan(null);
    update((v) => ({
      ...v,
      resources: [r, ...v.resources.filter((x) => x.id !== r.id)],
    }));
    setActiveId(r.id);
    setSelected([]);
  }
  function edit(r?: Resource) {
    setEditId(r?.id ?? "");
    setTitle(r?.title ?? "");
    setBody(
      r?.segments
        .map((s) => s.original + (s.translation ? "\t" + s.translation : ""))
        .join("\n") ?? "",
    );
    go("editor");
  }
  function saveText(generated = false) {
    if (!title.trim() || !body.trim()) throw new Error("请填写标题和文稿");
    if (body.length > 100000) throw new Error("文稿上限 10 万字，请分篇保存");
    const id = editId || uid();
    const existing = resources.find((r) => r.id === editId);
    const segments = body
      .split(/\r?\n/)
      .filter((x) => x.trim())
      .map((line, i) => {
        const [original, ...translation] = line.split("\t");
        return {
          id: `${id}:${i}`,
          original: original.trim(),
          translation: translation.join("\t").trim() || undefined,
          paragraph: i,
        };
      });
    if (!segments.length) throw new Error("没有可朗读文字");
    putResource({
      ...existing,
      id,
      title: title.trim(),
      kind: existing?.kind ?? "custom",
      generated: generated || existing?.generated,
      segments,
    });
    setEditId(id);
    setNotice("已保存到本机。每一行作为一个明确的朗读单元。");
  }
  async function importText() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/plain", "text/markdown", "application/json"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const item = result.assets[0];
    if ((item.size ?? 0) > 1000000)
      throw new Error("文件超过 1 MB，请拆分导入");
    const text =
      Platform.OS === "web" && item.file
        ? await item.file.text()
        : await new File(item.uri).text();
    if (item.name.endsWith(".json")) {
      const t = parseTemplate(text);
      setTemplateDraft({ ...t, id: uid() });
      setTemplateJSON(text);
      go("templates");
      return;
    }
    setEditId("");
    setTitle(item.name.replace(/\.[^.]+$/, ""));
    setBody(text);
    go("editor");
  }
  function stopAudio() {
    audioPreparation.current++;
    audioAbort.current?.abort();
    audioAbort.current = null;
    Audio.stop();
  }
  async function previewAudio(
    plan: AudioPlan,
    config = voiceConnection.settings,
    consent = voiceConnection.consent,
  ) {
    stopAudio();
    setPlan(null);
    livePlanRef.current = null;
    const epoch = audioPreparation.current,
      controller = new AbortController();
    audioAbort.current = controller;
    const prepared = await prepareExternalAudio(
      plan,
      config,
      consent,
      controller.signal,
    );
    if (epoch !== audioPreparation.current || controller.signal.aborted)
      throw new Error("已停止试听");
    await Audio.prepare(prepared.plan);
    if (epoch !== audioPreparation.current || controller.signal.aborted)
      throw new Error("已停止试听");
    Audio.play();
    if (prepared.warnings.length) setNotice(prepared.warnings.join("；"));
  }
  function pronunciationMap() {
    const values: Record<string, string> = {};
    for (const line of dictionary.split("\n").filter(Boolean)) {
      const [word, ...replacement] = line.split("=");
      if (word && replacement.join("=")) values[word] = replacement.join("=");
    }
    return values;
  }
  async function playCompiled(
    p: ReturnType<typeof compileSession>,
    resume = false,
    playbackRate = rate,
  ) {
    stopAudio();
    started.current = false;
    setPlan(null);
    livePlanRef.current = null;
    const epoch = ++audioPreparation.current;
    audioAbort.current?.abort();
    const controller = new AbortController();
    audioAbort.current = controller;
    const source = { ...p, pronunciations: pronunciationMap() };
    if (
      source.steps.some((s) => s.voiceId?.startsWith("remote:")) &&
      (!voiceConnection.ready || !voiceConnection.keyReady)
    )
      throw new Error("声音设置正在读取，请稍后播放");
    const prepared = await prepareExternalAudio(
      source,
      voiceConnection.settings,
      voiceConnection.consent,
      controller.signal,
    );
    if (epoch !== audioPreparation.current || controller.signal.aborted)
      throw new Error("已停止准备");
    const next = prepared.plan;
    const info = await Audio.prepare(next);
    if (epoch !== audioPreparation.current || controller.signal.aborted) {
      throw new Error("已停止准备");
    }
    setPlan(next);
    livePlanRef.current = next;
    Audio.setRate(playbackRate);
    if (resume && positionRestore.current) {
      Audio.seek(Math.min(positionRestore.current, info.duration));
      positionRestore.current = 0;
    }
    if (sleep) Audio.setSleepTimer(sleep * 60, 10);
    Audio.play();
    setPage("player");
    const warnings = [...p.warnings, ...prepared.warnings];
    if (warnings.length) setNotice([...new Set(warnings)].join("；"));
  }
  async function start(
    resource: Resource = active,
    chosen: Template = template,
    resume = false,
    playbackRate = rate,
  ) {
    if (busy) return;
    await task("准备本地音频 · 请保持前台", async () => {
      setActiveId(resource.id);
      setQueue([]);
      const p = compileSession(
        [
          {
            resource,
            template: chosen,
            selectedIds:
              resource.id === activeId && selected.length
                ? selected
                : undefined,
            voiceId: db.settings.voiceId || undefined,
            translationVoiceId: db.settings.translationVoiceId || undefined,
          },
        ],
        { loop, repeat: repeatCount },
      );
      await playCompiled(p, resume, playbackRate);
    });
  }
  async function startList(
    ids: string[],
    itemOptions?: Library["playlists"][number]["options"],
  ) {
    if (busy) return;
    await task("准备完整播放列表 · 缓存完成后可锁屏", async () => {
      const entries = ids.map((id) => {
        const resource = resources.find((r) => r.id === id);
        if (!resource) throw new Error("列表包含已删除材料，请先编辑列表");
        const options = itemOptions?.[id];
        return {
          resource,
          template:
            allTemplates.find((t) => t.id === options?.templateId) ?? template,
          voiceId: options?.voiceId || db.settings.voiceId || undefined,
          translationVoiceId: db.settings.translationVoiceId || undefined,
          rate: options?.rate ?? 1,
        };
      });
      const p = compileSession(entries, { loop, repeat: repeatCount, shuffle });
      const order = p.steps
        .map((s) => s.resourceId!)
        .filter((id, i, all) => i === 0 || id !== all[i - 1]);
      setActiveId(order[0]);
      setQueue(order.slice(1));
      await playCompiled(p);
    });
  }
  async function generate(force = false) {
    await task(
      force ? "重新生成 · 将调用模型接口" : "准备讲稿 · 优先复用本次会话缓存",
      async () => {
        const result = await generateCachedScript(
          (() => {
            if (!modelConnection.settings)
              throw new Error("请先连接服务并选择模型");
            return modelConnection.settings;
          })(),
          aiSource,
          aiStyle,
          prompt,
          force,
        );
        setAIOutput(result.text);
        setUsage(
          result.cached
            ? "已复用本次会话生成结果，未调用接口"
            : result.usage
              ? `本次接口报告：输入 ${result.usage.prompt_tokens ?? "?"} / 输出 ${result.usage.completion_tokens ?? "?"} tokens`
              : "接口未提供用量数据",
        );
      },
    );
  }
  function toggle() {
    if (busy) return;
    if (status.playing) {
      Audio.pause();
      persistProgress();
    } else if (plan) {
      Audio.play();
    } else void start(active, template, true);
  }
  function nextSentence(delta: number, paragraph = false) {
    if (!plan) return;
    const group = (index: number) => {
      const step = plan.steps[index],
        id = step.segmentId;
      const resource =
        resources.find((r) => r.id === step.resourceId) ?? active;
      return `${step.resourceId ?? resource.id}:${paragraph ? (resource.segments.find((s) => s.id === id)?.paragraph ?? id) : id}`;
    };
    const current = group(status.stepIndex);
    let at = status.stepIndex + delta;
    while (at >= 0 && at < plan.steps.length && group(at) === current)
      at += delta;
    if (at < 0) {
      Audio.seek(0);
      return;
    }
    if (at >= plan.steps.length) return;
    const target = group(at);
    while (at > 0 && group(at - 1) === target) at--;
    Audio.skipStep(at);
  }
  const shortLabels: Record<string, string> = {
    写一段文字: "新建",
    新建文稿: "新建",
    导入文稿: "导入",
    导入文件: "导入",
    留白自背: "自背",
    继续听: "继续",
    打开播放器: "播放器",
    保存文稿: "保存",
    保存模板: "保存",
    新建模板: "新建",
    删除自建模板: "删除",
    重新编排并播放: "应用编排",
    编辑文稿: "编辑",
    只选重点: "重点",
    清除选择: "清除",
    准备当前篇与待播队列: "播放队列",
    开始睡前听读: "开始",
    刷新缓存统计: "刷新",
    清理缓存: "清理",
    指定停止时间: "停止时间",
    核对后存为文稿: "保存文稿",
    生成讲稿: "生成",
    "重新生成（调用接口）": "重写",
    配置模型: "设置",
    校验并导入: "导入",
    "导出为 JSON 文本": "导出",
    删除列表: "删除",
    创建列表: "创建",
    加入待播队列: "加入队列",
    继续复习: "继续",
    古诗文练习: "语文",
    英语语法练习: "英语",
    源代码与构建文档: "源码",
  };
  function button(
    label: string,
    onPress: () => void,
    primary = false,
    icon?: React.ComponentProps<typeof Ionicons>["name"],
    disabled = false,
  ) {
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: primary ? c.accent : c.soft,
            opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
          },
        ]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={18}
            color={primary ? c.onAccent : c.accent}
          />
        )}
        <Text
          style={{
            color: primary ? c.onAccent : c.accent,
            fontSize: 15,
            fontWeight: "600",
          }}
        >
          {shortLabels[label] ?? label}
        </Text>
      </Pressable>
    );
  }
  function input(
    value: string,
    onChangeText: (x: string) => void,
    placeholder: string,
    multiline = false,
    secure = false,
    editable = true,
  ) {
    return (
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        multiline={multiline}
        editable={editable}
        secureTextEntry={secure}
        autoCapitalize="none"
        style={[
          styles.input,
          { color: c.text, borderColor: c.line, backgroundColor: c.surface },
          multiline && { minHeight: 150, textAlignVertical: "top" },
        ]}
      />
    );
  }
  function heading(text: string, sub?: string) {
    return (
      <View style={{ marginBottom: 26 }}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: c.text }]}
        >
          {text}
        </Text>
        {sub && (
          <Text style={[styles.subtitle, { color: c.muted }]}>{sub}</Text>
        )}
      </View>
    );
  }
  function section(text: string) {
    return (
      <Text
        accessibilityRole="header"
        style={[styles.section, { color: c.text }]}
      >
        {text}
      </Text>
    );
  }
  function small(text: string) {
    return <Text style={[styles.small, { color: c.muted }]}>{text}</Text>;
  }
  function row(r: Resource, index = 0) {
    return (
      <View
        key={r.id}
        style={[styles.resourceRow, { borderBottomColor: c.line }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`打开 ${r.title}`}
          onPress={() => {
            if (r.id !== activeId) {
              stopAudio();
              setPlan(null);
              livePlanRef.current = null;
            }
            setActiveId(r.id);
            setSelected([]);
            go("player");
          }}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
          }}
        >
          <View
            style={[
              styles.bookSmall,
              { backgroundColor: index % 2 ? c.soft : c.cover },
            ]}
          >
            <Text style={{ fontSize: 23, color: c.accent }}>
              {r.kind === "grammar" ? "Aa" : r.title.slice(0, 1)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: "600" }}>
              {r.title}
            </Text>
            <Text style={{ color: c.muted, marginTop: 6, fontSize: 13 }}>
              {r.author ?? (r.generated ? "生成讲稿 · 待核对" : "个人文稿")} ·{" "}
              {r.segments.length} 个单元
            </Text>
          </View>
        </Pressable>
        {button("播放", () => void start(r), false, "play-outline")}
      </View>
    );
  }
  const currentSegment = plan?.steps[status.stepIndex]?.segmentId;
  useEffect(() => {
    if (currentSegment && showTranscript)
      transcriptRef.current?.scrollTo({
        y: Math.max(0, (transcriptOffsets.current[currentSegment] ?? 0) - 12),
        animated: !reduceMotion.current,
      });
  }, [currentSegment, showTranscript]);
  function player() {
    return (
      <>
        <View
          style={[
            styles.playerColumns,
            wide && { flexDirection: "row", gap: 48 },
          ]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <View
              style={[
                styles.cover,
                {
                  backgroundColor: c.cover,
                  aspectRatio: 1,
                  width: "100%",
                  maxWidth: 320,
                  alignSelf: "center",
                },
              ]}
            >
              <View style={[styles.coverRule, { borderColor: c.accent }]}>
                <Text
                  style={{ fontSize: 12, letterSpacing: 5, color: c.accent }}
                >
                  noxia
                </Text>
                <Text
                  numberOfLines={4}
                  style={{
                    fontSize: 32,
                    lineHeight: 44,
                    fontWeight: "300",
                    color: c.text,
                    marginVertical: 32,
                  }}
                >
                  {active?.title}
                </Text>
                <View
                  style={{ width: 32, height: 1, backgroundColor: c.accent }}
                />
                <Text style={{ color: c.accent, marginTop: 22, fontSize: 13 }}>
                  {active?.kind === "grammar"
                    ? "语言与思考"
                    : `${active.segments.length} 个句段`}
                </Text>
              </View>
            </View>
            <View style={{ marginTop: 26 }}>
              <Text style={{ color: c.text, fontSize: 25, fontWeight: "600" }}>
                {active?.title}
              </Text>
              <Text style={{ color: c.muted, fontSize: 15, marginTop: 7 }}>
                {active?.author ?? "我的学习文稿"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="adjustable"
              accessibilityLabel="播放进度，点击定位"
              accessibilityValue={{
                min: 0,
                max: Math.round(status.duration),
                now: Math.round(status.position),
              }}
              onAccessibilityAction={(e) =>
                Audio.seek(
                  status.position +
                    (e.nativeEvent.actionName === "increment" ? 10 : -10),
                )
              }
              accessibilityActions={[
                { name: "increment", label: "前进10秒" },
                { name: "decrement", label: "后退10秒" },
              ]}
              onLayout={(e) => {
                progressWidth.current = e.nativeEvent.layout.width;
              }}
              onPress={(e) =>
                Audio.seek(
                  Math.max(
                    0,
                    Math.min(
                      1,
                      e.nativeEvent.locationX / progressWidth.current,
                    ),
                  ) * status.duration,
                )
              }
              style={{ height: 44, justifyContent: "center", marginTop: 19 }}
            >
              <View
                style={{ height: 4, borderRadius: 2, backgroundColor: c.line }}
              >
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: c.accent,
                    width: `${status.duration ? Math.min(100, (status.position / status.duration) * 100) : 0}%`,
                  }}
                />
              </View>
            </Pressable>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              {small(clock(status.position))}
              {small(clock(status.duration))}
            </View>
            <View style={styles.transport}>
              {button(
                "上一句",
                () => nextSentence(-1),
                false,
                "play-skip-back-outline",
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={status.playing ? "暂停" : "播放"}
                onPress={toggle}
                style={[styles.playCircle, { backgroundColor: c.accent }]}
              >
                <Ionicons
                  name={status.playing ? "pause" : "play"}
                  size={36}
                  color={c.bg}
                />
              </Pressable>
              {button(
                "下一句",
                () => nextSentence(1),
                false,
                "play-skip-forward-outline",
              )}
            </View>
            <View style={styles.chips}>
              {button("上一段", () => nextSentence(-1, true))}
              {button("下一段", () => nextSentence(1, true))}
              {button("−10 秒", () =>
                Audio.seek(Math.max(0, status.position - 10)),
              )}
              {button("+10 秒", () => Audio.seek(status.position + 10))}
              {button(`${rate}×`, () => {
                const n =
                  rate >= 1.5 ? 0.75 : Math.round((rate + 0.25) * 100) / 100;
                setRate(n);
                Audio.setRate(n);
              })}
              {button(
                loop ? "循环 · 开" : "循环",
                () => {
                  setLoop(!loop);
                  setNotice("循环设置将在下次「重新编排」时生效");
                },
                loop,
              )}
            </View>
            <View style={styles.chips}>
              {[0, 15, 30, 45].map((n) =>
                button(
                  n ? `${n} 分钟` : "取消定时",
                  () => {
                    setSleep(n);
                    Audio.setSleepTimer(n * 60, 10);
                  },
                  sleep === n,
                ),
              )}
            </View>
            {small(
              sleep
                ? `睡眠定时 ${sleep} 分钟 · 最后 10 秒渐弱`
                : "播放完毕后停止。锁屏能力需原生开发构建。",
            )}
            <View style={styles.chips}>
              {button(
                "重新编排并播放",
                () => void start(),
                false,
                "refresh-outline",
              )}
              {button("编辑文稿", () => edit(active))}
            </View>
          </View>
          <View style={{ flex: 1, minWidth: 0, marginTop: wide ? 0 : 36 }}>
            <Text style={[styles.eyebrow, { color: c.accent }]}>阅读面板</Text>
            {section("原文与笔记")}
            {button(showTranscript ? "收起阅读面板" : "展开阅读面板", () =>
              setShowTranscript(!showTranscript),
            )}
            {small("点选句子后重新编排，只听选中的部分。未选择时播放全文。")}
            {showTranscript && (
              <ScrollView
                ref={transcriptRef}
                nestedScrollEnabled
                style={{ maxHeight: wide ? 520 : 420 }}
              >
                {active?.segments.map((s, i) => (
                  <Pressable
                    key={s.id}
                    onLayout={(e) => {
                      transcriptOffsets.current[s.id] = e.nativeEvent.layout.y;
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.includes(s.id) }}
                    aria-checked={selected.includes(s.id)}
                    onPress={() =>
                      setSelected((v) =>
                        v.includes(s.id)
                          ? v.filter((x) => x !== s.id)
                          : [...v, s.id],
                      )
                    }
                    style={[
                      styles.transcript,
                      {
                        borderLeftColor:
                          currentSegment === s.id ? c.accent : "transparent",
                        backgroundColor: selected.includes(s.id)
                          ? c.soft
                          : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: currentSegment === s.id ? c.accent : c.muted,
                        fontSize: 12,
                        marginBottom: 10,
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                      {s.important ? " · 考试重点" : ""}
                      {selected.includes(s.id) ? " · 已选" : ""}
                    </Text>
                    <Text
                      style={{
                        color: currentSegment === s.id ? c.text : c.muted,
                        fontSize: 23,
                        lineHeight: 36,
                        fontWeight: currentSegment === s.id ? "500" : "400",
                      }}
                    >
                      {s.original}
                    </Text>
                    {s.translation && (
                      <Text
                        style={{
                          fontSize: 15,
                          lineHeight: 25,
                          color: c.muted,
                          marginTop: 12,
                        }}
                      >
                        {s.translation}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.chips}>
              {button("只选重点", () =>
                setSelected(
                  active.segments.filter((s) => s.important).map((s) => s.id),
                ),
              )}
              {button("清除选择", () => setSelected([]))}
            </View>
            {active.source && (
              <View style={{ marginTop: 20 }}>
                {small(
                  (active as Resource & { attribution?: string }).attribution ??
                    `资源来源：${active.source.repo}`,
                )}
                {button(
                  "查看原始资源与许可",
                  () => void Linking.openURL(active.source!.url),
                )}
                {small(
                  "来源资料保留原许可；修改后的内容仍需核对，不能随 MIT 代码再分发。",
                )}
              </View>
            )}
            {section("使用编排")}
            <View style={styles.chips}>
              {allTemplates.map((t) =>
                button(
                  t.name,
                  () => {
                    setTemplateId(t.id);
                    setNotice("已选择，点击「重新编排并播放」应用");
                  },
                  template.id === t.id,
                ),
              )}
            </View>
            {section("播放规则")}
            <View style={styles.chips}>
              <View style={{ width: 160 }}>
                {small("整篇／列表次数 1—20")}
                {input(
                  String(repeatCount),
                  (v) => setRepeatCount(Number(v)),
                  "全篇播放次数",
                )}
              </View>
              {button(
                shuffle ? "随机顺序 · 开" : "随机顺序",
                () => setShuffle(!shuffle),
                shuffle,
              )}
            </View>
            {button(
              "准备当前篇与待播队列",
              () => void startList([active.id, ...queue]),
            )}
            {section(`待播队列 · ${queue.length}`)}
            {queue.map((id, i) => (
              <View key={`${id}-${i}`} style={styles.inline}>
                <Text style={{ color: c.text, flex: 1 }}>
                  {resources.find((r) => r.id === id)?.title ?? id}
                </Text>
                {button("移除", () =>
                  setQueue((v) => v.filter((_, j) => j !== i)),
                )}
              </View>
            ))}
            {small("播放前会先生成音频；更改队列后需重新准备。")}
          </View>
        </View>
      </>
    );
  }
  function saveTemplate() {
    if (!templateDraft) return;
    const valid = parseTemplate(exportTemplate(templateDraft));
    update((v) => ({
      ...v,
      templates: [valid, ...v.templates.filter((t) => t.id !== valid.id)],
    }));
    setTemplateId(valid.id);
    setNotice("模板已保存在本机");
  }
  function patchStep(index: number, patch: Partial<Step>) {
    setTemplateDraft((t) =>
      t
        ? {
            ...t,
            steps: t.steps.map((s, i) =>
              i === index ? { ...s, ...patch } : s,
            ),
          }
        : t,
    );
  }
  function templatePage() {
    return (
      <>
        {heading("编排", "按顺序组合朗读、重复和留白")}
        <View style={styles.chips}>
          {allTemplates.map((t) =>
            button(t.name, () =>
              setTemplateDraft({
                ...t,
                id: db.templates.some((v) => v.id === t.id) ? t.id : uid(),
                steps: t.steps.map((s) => ({ ...s })),
              }),
            ),
          )}
          {button(
            "新建模板",
            () =>
              setTemplateDraft({
                id: uid(),
                name: "我的编排",
                scope: "sentence",
                steps: [makeStep("original")],
              }),
            true,
          )}
        </View>
        {templateDraft && (
          <>
            {input(
              templateDraft.name,
              (name) => setTemplateDraft({ ...templateDraft, name }),
              "模板名称",
            )}
            <View style={styles.chips}>
              {(["sentence", "paragraph", "document"] as const).map((scope) =>
                button(
                  { sentence: "逐句", paragraph: "逐段", document: "全文" }[
                    scope
                  ],
                  () => setTemplateDraft({ ...templateDraft, scope }),
                  templateDraft.scope === scope,
                ),
              )}
            </View>
            {templateDraft.steps.map((s, i) => (
              <View
                key={`${i}-${s.id}`}
                style={[styles.step, { borderColor: c.line }]}
              >
                <View style={styles.inline}>
                  <Text style={{ fontSize: 20, color: c.text, flex: 1 }}>
                    {i + 1}. {labels[s.kind]}
                  </Text>
                  {button(
                    s.enabled ? "启用" : "停用",
                    () => patchStep(i, { enabled: !s.enabled }),
                    s.enabled,
                  )}
                  {button("↑", () => {
                    if (!i) return;
                    const steps = [...templateDraft.steps];
                    [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                    setTemplateDraft({ ...templateDraft, steps });
                  })}
                  {button("↓", () => {
                    if (i === templateDraft.steps.length - 1) return;
                    const steps = [...templateDraft.steps];
                    [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]];
                    setTemplateDraft({ ...templateDraft, steps });
                  })}
                  {button("删除", () =>
                    setTemplateDraft({
                      ...templateDraft,
                      steps: templateDraft.steps.filter((_, j) => j !== i),
                    }),
                  )}
                </View>
                <View style={styles.chips}>
                  <View style={{ width: 100 }}>
                    {small("重复次数")}
                    {input(
                      String(s.repeat),
                      (v) => patchStep(i, { repeat: Number(v) }),
                      "次数",
                    )}
                  </View>
                  <View style={{ width: 110 }}>
                    {small("语速倍率")}
                    {input(
                      String(s.rate),
                      (v) => patchStep(i, { rate: Number(v) }),
                      "语速",
                    )}
                  </View>
                  <View style={{ width: 110 }}>
                    {small("音量 0—1")}
                    {input(
                      String(s.volume),
                      (v) => patchStep(i, { volume: Number(v) }),
                      "音量",
                    )}
                  </View>
                  <View style={{ width: 130 }}>
                    {small("停顿／留白毫秒")}
                    {input(
                      String(s.durationMs),
                      (v) => patchStep(i, { durationMs: Number(v) }),
                      "时长",
                    )}
                  </View>
                </View>
                {s.kind === "custom" &&
                  input(
                    s.text ?? "",
                    (text) => patchStep(i, { text }),
                    "自定义朗读文字",
                  )}
                {input(
                  s.voiceId ?? "",
                  (voiceId) => patchStep(i, { voiceId: voiceId || undefined }),
                  "音色 ID（留空使用默认）",
                )}
              </View>
            ))}
            {section("添加步骤")}
            <View style={styles.chips}>
              {Object.keys(labels).map((kind) =>
                button(labels[kind], () =>
                  setTemplateDraft({
                    ...templateDraft,
                    steps: [
                      ...templateDraft.steps,
                      makeStep(kind as Step["kind"]),
                    ],
                  }),
                ),
              )}
            </View>
            <View style={styles.chips}>
              {button(
                "保存模板",
                () => {
                  try {
                    saveTemplate();
                  } catch (e) {
                    message(e);
                  }
                },
                true,
              )}
              {button("导出为 JSON 文本", () => {
                try {
                  setTemplateJSON(exportTemplate(templateDraft));
                } catch (e) {
                  message(e);
                }
              })}
              {button("删除自建模板", () => {
                update((v) => ({
                  ...v,
                  templates: v.templates.filter(
                    (t) => t.id !== templateDraft.id,
                  ),
                }));
                setTemplateDraft(null);
              })}
            </View>
          </>
        )}
        {section("导入与导出")}
        {input(
          templateJSON,
          setTemplateJSON,
          "粘贴模板 JSON，或复制已导出的文本",
          true,
        )}
        {button("校验并导入", () => {
          try {
            setTemplateDraft({ ...parseTemplate(templateJSON), id: uid() });
            setNotice("已校验，确认后保存");
          } catch (e) {
            message(e);
          }
        })}
      </>
    );
  }
  function render() {
    switch (page) {
      case "home":
        return (
          <>
            {heading("现在听", "继续播放，或选择一份文稿")}
            <View style={[styles.hero, { backgroundColor: c.soft }]}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: c.accent,
                    fontSize: 12,
                    letterSpacing: 3,
                    marginBottom: 22,
                  }}
                >
                  接着上次听
                </Text>
                <Text
                  style={{
                    color: c.text,
                    fontSize: 31,
                    lineHeight: 42,
                    fontWeight: "500",
                  }}
                >
                  {active.title}
                </Text>
                <Text
                  style={{ color: c.muted, marginVertical: 14, lineHeight: 23 }}
                >
                  继续上次播放，或更换背诵模板。
                </Text>
                <View style={styles.chips}>
                  {button(
                    "继续听",
                    () => void start(active, template, true),
                    true,
                    "play",
                  )}
                  {button("打开播放器", () => go("player"))}
                </View>
              </View>
              {wide && (
                <Text
                  style={{
                    color: c.accent,
                    fontSize: 100,
                    fontWeight: "200",
                    padding: 32,
                  }}
                >
                  听
                </Text>
              )}
            </View>
            <View style={[styles.chips, { marginTop: 24 }]}>
              {button("写一段文字", () => edit(), false, "add-outline")}
              {button(
                "导入文稿",
                () => void task("导入文稿", importText),
                false,
                "document-text-outline",
              )}
              {button(
                "留白自背",
                () => {
                  setTemplateId(presets.recall.id);
                  void start(active, presets.recall);
                },
                false,
                "leaf-outline",
              )}
            </View>
            {section("文稿")}
            {resources.slice(0, 6).map(row)}
            {section("复习入口")}
            {small(
              "听过不等于掌握。播放记录与默写、做题结果分开；可前往原学习项目练习。",
            )}
            <View style={styles.chips}>
              {button(
                "古诗文练习",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/poetry-recite",
                  ),
              )}
              {button(
                "英语语法练习",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/english-grammar-lab",
                  ),
              )}
            </View>
          </>
        );
      case "player":
        return (
          <>
            {heading("正在播放")}
            {player()}
          </>
        );
      case "library":
        return (
          <>
            {heading("资源", "本机保存，可自由组合。远程资源保留各自的许可。")}
            {input(query, setQuery, "搜索标题")}
            <View style={styles.chips}>
              {button("新建文稿", () => edit(), true)}
              {button(
                "导入 TXT / Markdown",
                () => void task("读取文件", importText),
              )}
            </View>
            {resources.filter((r) => r.title.includes(query)).map(row)}
            {section("连接学习项目")}
            {small(
              "以下两个项目采用个人非商业许可。下载仅供个人学习；内容不是 MIT 授权教材，不随 Noxia 开源代码分发。",
            )}
            {button(
              consent
                ? "已同意个人非商业使用许可"
                : "我已阅读并同意仅作个人非商业学习",
              () => setConsent(!consent),
              consent,
            )}
            <View style={styles.chips}>
              {button(
                "查看古诗文许可",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/poetry-recite/blob/main/LICENSE",
                  ),
              )}
              {button(
                "查看英语许可",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/english-grammar-lab/blob/main/LICENSE",
                  ),
              )}
            </View>
            <View style={styles.chips}>
              {button(
                "古诗文目录",
                () =>
                  void task("读取公开目录", async () =>
                    setRemote(
                      await listRemoteResources("poetry", {
                        acceptPersonalUseLicense: consent,
                      }),
                    ),
                  ),
              )}
              {button(
                "英语语法目录",
                () =>
                  void task("读取公开目录", async () =>
                    setRemote(
                      await listRemoteResources("grammar", {
                        acceptPersonalUseLicense: consent,
                      }),
                    ),
                  ),
              )}
            </View>
            {remote
              .filter((r) => r.title.includes(query))
              .map((r) => (
                <View
                  key={r.id}
                  style={[styles.resourceRow, { borderBottomColor: c.line }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontSize: 18 }}>
                      {r.title}
                    </Text>
                    {small(r.author ?? "知识卡 · 固定版本")}
                  </View>
                  {button(
                    "下载到本机",
                    () =>
                      void task("下载并核对对应关系", async () => {
                        const resource = await loadRemoteResource(r, {
                          acceptPersonalUseLicense: consent,
                        });
                        putResource(resource);
                        setNotice(
                          resource.warnings?.join("；") ?? "已保存本机",
                        );
                      }),
                  )}
                </View>
              ))}
          </>
        );
      case "editor":
        return (
          <>
            {heading(
              "文稿",
              "一行一个朗读单元；原文与译文之间用 Tab 分隔，不猜测文言文句子对应。",
            )}
            {input(title, setTitle, "作品标题")}
            {input(
              body,
              setBody,
              "输入或粘贴文字。可从 TXT / Markdown 导入。",
              true,
            )}
            <View style={styles.chips}>
              {button(
                "保存文稿",
                () => {
                  try {
                    saveText();
                  } catch (e) {
                    message(e);
                  }
                },
                true,
                "checkmark-outline",
              )}
              {button("导入文件", () => void task("读取文件", importText))}
              {button("清空编辑区", () => {
                setBody("");
                setTitle("");
                setEditId("");
              })}
            </View>
            {small(
              "PDF 提取和扫描 OCR 尚未实现，请先转换为 TXT。导入文件仅保存在本机，不自动上传。",
            )}
            {section("已有文稿")}
            {resources.map((r) => (
              <View
                key={r.id}
                style={[styles.resourceRow, { borderBottomColor: c.line }]}
              >
                <Text style={{ color: c.text, flex: 1 }}>{r.title}</Text>
                {button("编辑", () => edit(r))}
                {button("删除", () => {
                  stopAudio();
                  setPlan(null);
                  update((v) => ({
                    ...v,
                    resources: v.resources.filter((x) => x.id !== r.id),
                    playlists: v.playlists.map((p) => ({
                      ...p,
                      resourceIds: p.resourceIds.filter((id) => id !== r.id),
                    })),
                  }));
                  setNotice("已从书架删除。音频缓存可在离线音频页清理。");
                })}
              </View>
            ))}
          </>
        );
      case "templates":
        return templatePage();
      case "voices":
        return (
          <VoiceSettings
            connection={voiceConnection}
            voices={voices}
            colors={c}
            primaryVoice={db.settings.voiceId}
            translationVoice={db.settings.translationVoiceId}
            onSelectVoice={(id, target) =>
              settings(
                target === "original"
                  ? { voiceId: id }
                  : { translationVoiceId: id },
              )
            }
            onRefresh={() =>
              void task("读取声音", async () =>
                setVoices(await Audio.listVoices()),
              )
            }
            onPreviewSystem={(voice) =>
              void task("准备试听", () =>
                previewAudio({
                  id: "preview",
                  title: voice.name,
                  steps: [
                    {
                      id: "preview",
                      segmentId: "preview",
                      kind: "speech",
                      text: voice.language.startsWith("zh")
                        ? "这是一段声音试听。"
                        : "This is a short voice preview.",
                      voiceId: voice.id,
                      rate: 1,
                      volume: 1,
                    },
                  ],
                  loop: false,
                }),
              )
            }
            onPreviewExternal={(settings, consent) =>
              void task("准备试听", async () => {
                if (Platform.OS !== "ios")
                  throw new Error("外部声音请在应用内试听");
                await previewAudio(
                  {
                    id: "preview-external",
                    title: "试听",
                    steps: [
                      {
                        id: "v",
                        segmentId: "v",
                        kind: "speech",
                        text: "这是一段声音试听。This is a short voice preview.",
                        voiceId: `remote:${settings.voice}`,
                        rate: 1,
                        volume: 1,
                      },
                    ],
                    loop: false,
                  },
                  settings,
                  consent,
                );
              })
            }
            dictionary={dictionary}
            onDictionaryChange={setDictionary}
          />
        );
      case "audio":
        return (
          <>
            {heading(
              "缓存",
              "系统语音先生成本地 PCM 音频，同样的内容与参数复用缓存。",
            )}
            {small(
              Platform.OS === "web"
                ? "Web 预览不支持持久音频缓存。"
                : "已生成的文件保存在应用支持目录；不上传 D1。下载系统音色后，能否完全断网合成仍需对应设备验证。",
            )}
            <View style={styles.chips}>
              {button(
                "刷新缓存统计",
                () =>
                  void task("读取缓存", async () =>
                    setCache(await Audio.getCacheInfo()),
                  ),
              )}
              {button(
                "清理缓存",
                () =>
                  void task("清理音频", async () => {
                    stopAudio();
                    setPlan(null);
                    await Audio.clearCache();
                    setCache(await Audio.getCacheInfo());
                  }),
              )}
            </View>
            {section(
              `${cache.count} 个片段 · ${(cache.bytes / 1024 / 1024).toFixed(1)} MB`,
            )}
            {small(
              "清理会停止播放，但不会删除文稿、模板或学习记录。没有缓存配额和逐项删除功能；请留意设备剩余空间。",
            )}
          </>
        );
      case "playlists":
        return (
          <>
            {heading("播放列表", "选择内容与播放顺序")}
            {input(playlistName, setPlaylistName, "新播放列表名称")}
            {button(
              "创建列表",
              () => {
                if (!playlistName.trim()) return;
                const id = uid();
                update((v) => ({
                  ...v,
                  playlists: [
                    ...v.playlists,
                    { id, name: playlistName.trim(), resourceIds: [] },
                  ],
                }));
                setPlaylistId(id);
                setPlaylistName("");
              },
              true,
            )}
            <View style={styles.chips}>
              {db.playlists.map((p) =>
                button(
                  `${p.name} (${p.resourceIds.length})`,
                  () => setPlaylistId(p.id),
                  playlistId === p.id,
                ),
              )}
            </View>
            {db.playlists
              .filter((p) => p.id === playlistId)
              .map((p) => (
                <View key={p.id}>
                  {section(p.name)}
                  {resources.map((r) => (
                    <View
                      key={r.id}
                      style={[
                        styles.resourceRow,
                        { borderBottomColor: c.line },
                      ]}
                    >
                      <Text style={{ color: c.text, flex: 1 }}>{r.title}</Text>
                      {button(
                        p.resourceIds.includes(r.id) ? "移出" : "加入",
                        () =>
                          update((v) => ({
                            ...v,
                            playlists: v.playlists.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    resourceIds: x.resourceIds.includes(r.id)
                                      ? x.resourceIds.filter(
                                          (id) => id !== r.id,
                                        )
                                      : [...x.resourceIds, r.id],
                                  }
                                : x,
                            ),
                          })),
                      )}
                    </View>
                  ))}
                  {section("单篇设置")}
                  <View style={styles.chips}>
                    {p.resourceIds.map((id) =>
                      button(
                        resources.find((r) => r.id === id)?.title ?? id,
                        () => setItemEditId(id),
                        itemEditId === id,
                      ),
                    )}
                  </View>
                  {p.resourceIds.includes(itemEditId) && (
                    <View>
                      <View style={styles.chips}>
                        {allTemplates.map((t) =>
                          button(
                            t.name,
                            () =>
                              update((v) => ({
                                ...v,
                                playlists: v.playlists.map((x) =>
                                  x.id === p.id
                                    ? {
                                        ...x,
                                        options: {
                                          ...x.options,
                                          [itemEditId]: {
                                            ...x.options?.[itemEditId],
                                            templateId: t.id,
                                          },
                                        },
                                      }
                                    : x,
                                ),
                              })),
                            p.options?.[itemEditId]?.templateId === t.id,
                          ),
                        )}
                      </View>
                      {input(
                        p.options?.[itemEditId]?.voiceId ?? "",
                        (voiceId) =>
                          update((v) => ({
                            ...v,
                            playlists: v.playlists.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    options: {
                                      ...x.options,
                                      [itemEditId]: {
                                        ...x.options?.[itemEditId],
                                        voiceId,
                                      },
                                    },
                                  }
                                : x,
                            ),
                          })),
                        "此篇音色 ID（留空使用默认）",
                      )}
                      {input(
                        String(p.options?.[itemEditId]?.rate ?? 1),
                        (rate) =>
                          update((v) => ({
                            ...v,
                            playlists: v.playlists.map((x) =>
                              x.id === p.id
                                ? {
                                    ...x,
                                    options: {
                                      ...x.options,
                                      [itemEditId]: {
                                        ...x.options?.[itemEditId],
                                        rate: Number(rate),
                                      },
                                    },
                                  }
                                : x,
                            ),
                          })),
                        "此篇语速倍率 0.25—2",
                      )}
                    </View>
                  )}
                  <View style={styles.chips}>
                    {button(
                      "播放列表",
                      () => {
                        if (!p.resourceIds.length) {
                          setNotice("请先加入文稿");
                          return;
                        }
                        void startList(p.resourceIds, p.options);
                      },
                      true,
                    )}
                    {button("加入待播队列", () =>
                      setQueue((v) => [...v, ...p.resourceIds]),
                    )}
                    {button("删除列表", () =>
                      update((v) => ({
                        ...v,
                        playlists: v.playlists.filter((x) => x.id !== p.id),
                      })),
                    )}
                  </View>
                </View>
              ))}
            {small(
              "整个列表一次准备，支持随机顺序、有限次数和循环。每篇可独立设置编排、原文音色与语速。实际后台连续播放仍需 iPad 验收。",
            )}
          </>
        );
      case "history":
        return (
          <>
            {heading(
              "听过的，再想一想",
              "播放足迹不是掌握程度；最近播放进度自动保存在本机。",
            )}
            {db.history.map((h, i) => (
              <View
                key={`${h.resourceId}-${i}`}
                style={[styles.resourceRow, { borderBottomColor: c.line }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 18 }}>{h.title}</Text>
                  {small(
                    `${new Date(h.date).toLocaleString()} · ${clock(h.position)} · ${h.completed ? "已播完" : "听读中"}`,
                  )}
                </View>
                {button("继续复习", () => {
                  const r = resources.find((x) => x.id === h.resourceId);
                  if (r) {
                    positionRestore.current = h.position;
                    void start(r, template, true);
                  }
                })}
              </View>
            ))}
          </>
        );
      case "ai":
        return (
          <>
            {heading("讲稿", "生成文本需你核对、编辑并保存后，再转成声音。")}
            {input(
              aiSource,
              setAISource,
              "粘贴参考资料。只依据这里的内容生成。",
              true,
            )}
            <View style={styles.chips}>
              {[
                "简单讲解",
                "完整知识讲解",
                "睡前舒缓讲述",
                "考前快速复习",
                "例题讲解",
                "故事化知识讲解",
              ].map((s) => button(s, () => setAIStyle(s), s === aiStyle))}
            </View>
            {input(
              prompt,
              setPrompt,
              "目标时长、难度、语气、例句或自定义要求",
              true,
            )}
            <View style={styles.chips}>
              {button("生成讲稿", () => void generate(), true)}
              {button("重新生成（调用接口）", () => void generate(true))}
              {button("配置模型", () => go("settings"))}
            </View>
            {small("资料会发送到所选服务，费用按服务商计算。")}
            {section("待核对的生成稿")}
            {input(
              aiOutput,
              setAIOutput,
              "生成内容可直接修改；不是权威教材。",
              true,
            )}
            {small(usage)}
            {button(
              "核对后存为文稿",
              () => {
                if (!aiOutput.trim()) return;
                const id = uid();
                putResource({
                  id,
                  title: `${aiStyle} · ${new Date().toLocaleDateString()}`,
                  kind: "custom",
                  generated: true,
                  segments: aiOutput
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((original, i) => ({
                      id: `${id}:${i}`,
                      original,
                      paragraph: i,
                    })),
                });
                editId && setEditId("");
                setNotice("已保存，并标记为生成讲稿。可在我的文稿继续编辑。");
              },
              true,
            )}
            {section("已保存的生成讲稿")}
            {resources.filter((r) => r.generated).map(row)}
          </>
        );
      case "sleep":
        return (
          <>
            {heading("睡前", "选择时长，结束前逐渐降低音量")}
            <View style={{ paddingVertical: 38 }}>
              <Ionicons name="moon-outline" size={64} color={c.accent} />
              <Text
                style={{
                  color: c.text,
                  fontSize: 29,
                  lineHeight: 42,
                  marginTop: 30,
                }}
              >
                {active.title}
              </Text>
              <Text
                style={{
                  color: c.muted,
                  fontSize: 16,
                  lineHeight: 27,
                  marginTop: 16,
                }}
              >
                默认有限时长的轻松复习。\n睡着后继续播放不代表记忆一定更好。
              </Text>
            </View>
            <View style={styles.chips}>
              {[15, 30, 45, 0].map((n) =>
                button(
                  n ? `${n} 分钟` : "整晚 · 手动停止",
                  () => {
                    setSleep(n);
                    setLoop(n === 0);
                  },
                  sleep === n,
                ),
              )}
            </View>
            {small(
              sleep ? `当前睡眠定时：${sleep} 分钟` : "整晚循环，需手动停止",
            )}
            {button(
              "开始睡前听读",
              () => {
                setRate(1);
                void start(active, presets.sleep, false, 1);
              },
              true,
              "play-outline",
            )}
            {small(
              "结束前 10 秒渐弱。你可以开启系统专注模式减少打扰；Noxia 不读取或修改通知。",
            )}
            <View style={styles.chips}>
              {button("暂停", () => {
                Audio.pause();
                persistProgress();
              })}
              {button("停止", () => {
                stopAudio();
                setPlan(null);
              })}
            </View>
            {section("指定停止时间")}
            {input(deadline, setDeadline, "输入本地时间 HH:MM")}
            {button("应用停止时间", () => {
              const m = /^(\d{2}):(\d{2})$/.exec(deadline);
              if (!m || +m[1] > 23 || +m[2] > 59) {
                setNotice("请输入有效时间，例如 22:30");
                return;
              }
              const d = new Date();
              d.setHours(+m[1], +m[2], 0, 0);
              if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
              const sec = (d.getTime() - Date.now()) / 1000;
              Audio.setSleepTimer(sec, 10);
              setSleep(Math.ceil(sec / 60));
              setNotice("已设置停止时间");
            })}
          </>
        );
      case "settings":
        return (
          <>
            {heading("设置")}
            {section("账号登录")}
            {small(
              isAccountConfigured()
                ? "与语文、英语项目共用学习账号"
                : ACCOUNT_UNAVAILABLE_MESSAGE,
            )}
            {input(
              username,
              setUsername,
              "用户名",
              false,
              false,
              isAccountConfigured(),
            )}
            {input(
              password,
              setPassword,
              "密码",
              false,
              true,
              isAccountConfigured(),
            )}
            <View style={styles.chips}>
              {button(
                account ? `已登录 ${account}` : "登录",
                () =>
                  void task("登录移动网关", async () => {
                    if (Platform.OS === "web")
                      throw new Error(
                        "请在应用内登录，网页预览不会发送账号密码。",
                      );
                    if (!ACCOUNT_API)
                      throw new Error(ACCOUNT_UNAVAILABLE_MESSAGE);
                    await login(ACCOUNT_API, username, password);
                    setAccount(username);
                    setPassword("");
                    setSyncConflict(null);
                    setNotice("已登录");
                  }),
                true,
                undefined,
                !isAccountConfigured(),
              )}
              {account &&
                button(
                  "退出",
                  () =>
                    void task("退出登录", async () => {
                      await logout(ACCOUNT_API);
                      setAccount("");
                      setSyncConflict(null);
                    }),
                )}
            </View>
            {account && (
              <>
                {section("同步")}
                {small(
                  "当前仅同步自建模板；不自动上传文稿、API Key、私人导入资料或音频。云端新版本会触发冲突，不直接覆盖。",
                )}
                <View style={styles.chips}>
                  {button(
                    "上传模板快照",
                    () =>
                      void task("上传模板", async () => {
                        let uploaded = 0;
                        for (const t of db.templates) {
                          try {
                            const remote = await syncRequest(
                              ACCOUNT_API,
                              `/v1/sync/templates/${encodeURIComponent(t.id)}`,
                            );
                            if (remote.version > 0) {
                              setSyncConflict(remote);
                              throw new Error(
                                "云端已有同 ID 模板。请先查看并导入云端版本，未覆盖已有数据。",
                              );
                            }
                          } catch (e) {
                            if (!(e instanceof SyncError && e.status === 404))
                              throw e;
                          }
                          await syncRequest(
                            ACCOUNT_API,
                            `/v1/sync/templates/${encodeURIComponent(t.id)}`,
                            { baseVersion: 0, data: t, deleted: false },
                            "PUT",
                          );
                          uploaded++;
                        }
                        setNotice(
                          `已上传 ${uploaded} 个自建模板；已有云端版本不会覆盖。`,
                        );
                      }),
                  )}
                  {button(
                    "读取云端模板",
                    () =>
                      void task("读取云端", async () => {
                        const index = await syncRequest(
                          ACCOUNT_API,
                          "/v1/sync/templates",
                        );
                        const entries = await Promise.all(
                          (index.items ?? [])
                            .filter((x: { deleted: boolean }) => !x.deleted)
                            .slice(0, 100)
                            .map((x: { id: string }) =>
                              syncRequest(
                                ACCOUNT_API,
                                `/v1/sync/templates/${encodeURIComponent(x.id)}`,
                              ),
                            ),
                        );
                        setSyncConflict(entries);
                      }),
                  )}
                </View>
                {syncConflict !== null && (
                  <>
                    {input(
                      JSON.stringify(syncConflict, null, 2),
                      () => {},
                      "云端快照（只读预览）",
                      true,
                    )}
                    {button("导入云端模板，保留本机模板", () => {
                      try {
                        const entries = Array.isArray(syncConflict)
                          ? syncConflict
                          : [syncConflict];
                        const imported = entries.map((raw) => {
                          const data = (raw as { data: unknown }).data;
                          return {
                            ...parseTemplate(JSON.stringify(data)),
                            id: uid(),
                          };
                        });
                        update((v) => ({
                          ...v,
                          templates: [...v.templates, ...imported],
                        }));
                        setSyncConflict(null);
                        setNotice("已作为新模板导入，保留本机版本。");
                      } catch (e) {
                        message(e);
                      }
                    })}
                  </>
                )}
              </>
            )}
            <ModelSettings connection={modelConnection} colors={c} />
            {section("外观")}
            <View style={styles.chips}>
              {(["system", "light", "dark"] as const).map((mode) =>
                button(
                  { system: "跟随系统", light: "浅色", dark: "深色" }[mode],
                  () => settings({ dark: mode }),
                  db.settings.dark === mode,
                ),
              )}
            </View>
            {section("关于")}

            {small("版本 0.2.0")}
            <View style={styles.chips}>
              {button(
                "源代码与构建文档",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/noxia",
                  ),
              )}
            </View>
          </>
        );
    }
  }
  const miniPlayer =
    page !== "player" ? (
      <View
        style={[
          styles.mini,
          { backgroundColor: "transparent", borderTopWidth: 0 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="展开播放器"
          onPress={() => go("player")}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={[styles.miniCover, { backgroundColor: c.cover }]}>
            <Ionicons name="musical-note-outline" size={22} color={c.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{ color: c.text, fontSize: 15, fontWeight: "600" }}
            >
              {active.title}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
              {status.playing
                ? "正在播放"
                : status.position
                  ? clock(status.position)
                  : "未播放"}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "暂停" : "播放"}
          onPress={toggle}
          style={{ padding: 14 }}
        >
          <Ionicons
            name={status.playing ? "pause" : "play"}
            size={27}
            color={c.text}
          />
        </Pressable>
      </View>
    ) : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <AdaptiveShell
        navItems={nav}
        currentPage={page}
        onNavigate={go}
        dark={dark}
        colors={c}
        playerAction={() => go("player")}
        miniPlayer={miniPlayer}
      >
        <ScrollView
          contentContainerStyle={{
            padding: wide ? 32 : 20,
            paddingBottom: 32,
            maxWidth: 1400,
            width: "100%",
            alignSelf: "center",
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={{ opacity: fade }}>
            {notice !== "" && (
              <Pressable
                accessibilityRole="alert"
                onPress={() => setNotice("")}
                style={[styles.notice, { backgroundColor: c.soft }]}
              >
                <Text selectable style={{ color: c.text, lineHeight: 23 }}>
                  {notice}
                </Text>
              </Pressable>
            )}
            {busy !== "" && (
              <View style={[styles.inline, { marginBottom: 20 }]}>
                <ActivityIndicator color={c.text} />
                <Text style={{ color: c.muted, flex: 1 }}>{busy}</Text>
                {/本地音频|完整播放列表/.test(busy) &&
                  button("停止准备", () => {
                    audioPreparation.current++;
                    audioAbort.current?.abort();
                    stopAudio();
                    setPlan(null);
                    livePlanRef.current = null;
                  })}
              </View>
            )}
            {render()}
          </Animated.View>
        </ScrollView>
      </AdaptiveShell>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth },
  navItem: {
    marginHorizontal: 12,
    paddingHorizontal: 13,
    paddingVertical: 14,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 3,
  },
  topbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: {
    fontSize: 34,
    lineHeight: 46,
    fontWeight: "600",
    letterSpacing: -1,
    marginTop: 13,
  },
  eyebrow: { fontSize: 11, letterSpacing: 0.2, fontWeight: "500" },
  subtitle: { fontSize: 15, lineHeight: 25, marginTop: 9, maxWidth: 700 },
  hero: {
    padding: 30,
    borderRadius: 14,
    flexDirection: "row",
    gap: 24,
    marginTop: 6,
  },
  section: {
    fontSize: 23,
    fontWeight: "600",
    marginTop: 34,
    marginBottom: 17,
    letterSpacing: -0.5,
  },
  small: { fontSize: 13, lineHeight: 22, marginVertical: 5 },
  button: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    alignSelf: "flex-start",
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginVertical: 12,
    alignItems: "center",
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    lineHeight: 25,
    marginVertical: 7,
    minHeight: 48,
  },
  resourceRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    flexWrap: "wrap",
  },
  bookSmall: {
    width: 52,
    height: 64,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  playerColumns: { gap: 0 },
  cover: { borderRadius: 9, padding: 29, overflow: "hidden" },
  coverRule: {
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    padding: 25,
    justifyContent: "center",
  },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginVertical: 24,
  },
  playCircle: {
    height: 76,
    width: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  transcript: {
    marginTop: 13,
    paddingVertical: 18,
    paddingLeft: 19,
    paddingRight: 12,
    borderLeftWidth: 3,
    borderRadius: 3,
  },
  step: { borderBottomWidth: 1, paddingVertical: 22 },
  mini: {
    minHeight: 78,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 14,
  },
  miniCover: {
    width: 46,
    height: 46,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { padding: 16, borderRadius: 8, marginBottom: 20 },
});
