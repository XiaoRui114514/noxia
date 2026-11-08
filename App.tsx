import { AlbumPage } from "./src/ui/AlbumPage";
import { PlaylistPage } from "./src/ui/PlaylistPage";
import { ResourceConsent } from "./src/ui/ResourceConsent";
import { albumDefaults, albumSummary, compileAlbum, validateAlbum, type Album } from "./src/core/albums";
import { validatePlaylist, removeResource, type Playlist } from "./src/core/collections";
import type { PlaybackCollection } from "./src/services/storage";
import { version } from "./package.json";
import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
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
  parseTemplate,
  type Resource,
  type Template,
  validateResource,
} from "./src/core";
import {
  emptyLibrary,
  loadLibrary,
  saveLibrary,
  uid,
  type Library,
  validatePronunciations,
  flushLibrary,
} from "./src/services/storage";
import { fingerprint, resumePosition } from "./src/core/resume";
import { editResource, resourceBody } from "./src/core/editor";
import { useTasks } from "./src/services/useTasks";
import { PlayerPage } from "./src/ui/PlayerPage";
import { TemplatePage } from "./src/ui/TemplatePage";
import { SegmentEditor } from "./src/ui/SegmentEditor";
import { ReviewPage } from "./src/ui/ReviewPage";
import { AccountPanel } from "./src/ui/AccountPanel";
import { DataPanel } from "./src/ui/DataPanel";
import { generateCachedScript } from "./src/services/ai";
import {
  login,
  logout,
  syncRequest,
  SyncError,
  createSyncBatch,
  readAllTemplates,
} from "./src/services/sync";
import {
  RESOURCE_LICENSE_VERSION,
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
  | "review"
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
  | "albums"
  | "playlists"
  | "sleep";
const nav: {
  id: Page;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { id: "home", label: "现在听", icon: "sunny-outline" },
  { id: "review", label: "复习", icon: "checkmark-circle-outline" },
  { id: "library", label: "资源", icon: "library-outline" },
  { id: "playlists", label: "播放列表", icon: "list-outline" },
  { id: "albums", label: "专辑", icon: "albums-outline" },
  { id: "editor", label: "文稿", icon: "create-outline" },
  { id: "ai", label: "讲稿", icon: "reader-outline" },
  { id: "templates", label: "编排", icon: "reorder-four-outline" },
  { id: "voices", label: "声音", icon: "mic-outline" },
  { id: "audio", label: "缓存", icon: "download-outline" },
  { id: "history", label: "记录", icon: "time-outline" },
  { id: "sleep", label: "睡前", icon: "moon-outline" },
  { id: "settings", label: "设置", icon: "settings-outline" },
];
const clock = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
export default function App() {
  const { width } = useWindowDimensions();
  const system = useColorScheme();
  const [db, setDb] = useState<Library>(emptyLibrary),
    [loaded, setLoaded] = useState(false),
    [storageOK, setStorageOK] = useState(false);
  const [page, setPage] = useState<Page>("home"),
    [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState("welcome"),
    [templateId, setTemplateId] = useState(""),
    [selected, setSelected] = useState<string[] | undefined>(undefined),
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
  const [structured, setStructured] = useState(false),
    [listLimit, setListLimit] = useState(40);
  const [editorSnapshot, setEditorSnapshot] = useState({
      id: "",
      title: "",
      body: "",
    }),
    [saveState, setSaveState] = useState("已保存");
  const saveEpoch = useRef(0);
  const [editId, setEditId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState("");
  const [templateDraft, setTemplateDraft] = useState<Template | null>(null),
    [templateJSON, setTemplateJSON] = useState("");
  const [remote, setRemote] = useState<ResourceEntry[]>([]),
    [licenseKind, setLicenseKind] = useState<"poetry"|"grammar"|null>(null),
    [query, setQuery] = useState("");
  const [aiKey, setAIKey] = useState(""),
    [aiStyle, setAIStyle] = useState("简单讲解"),
    [prompt, setPrompt] = useState("目标约 3 分钟，解释概念、例子与常见错误。"),
    [aiSource, setAISource] = useState(""),
    [aiOutput, setAIOutput] = useState(""),
    [usage, setUsage] = useState("");
  const [account, setAccount] = useState(""),[albumId,setAlbumId]=useState("");
  const [queue, setQueue] = useState<string[]>([]),
    [deadline, setDeadline] = useState(""),
    [dictionary, setDictionary] = useState("");
  const [stopAt, setStopAt] = useState<number | null>(null);
  const sourcePlan = useRef<AudioPlan | null>(null),
    contextRef = useRef("");
  const sessionMeta = useRef<{ selectedIds?: string[]; rate: number; templateId?:string;collection?:PlaybackCollection }>({
    rate: 1,
  });
  sessionMeta.current.rate=rate;
  const aiJob = useRef<{ id: number; controller: AbortController } | null>(
      null,
    ),
    aiEpoch = useRef(0),
    aiRevision = useRef(0);
  const [aiRunning, setAIRunning] = useState(false);
  const [preparation, setPreparation] = useState<{
      done: number;
      total: number;
      cached: number;
      failedIds: string[];
    } | null>(null),
    [confirmCache, setConfirmCache] = useState(false);
  const [dictionaryState, setDictionaryState] = useState("");
  const pageScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const syncBatch = useRef<Awaited<ReturnType<typeof createSyncBatch>> | null>(
    null,
  );
  const syncPreview = useRef<Awaited<
    ReturnType<typeof createSyncBatch>
  > | null>(null);
  const [syncConflict, setSyncConflict] = useState<unknown>(null);
  const dbRef = useRef(db),
    statusRef = useRef(status),
    activeRef = useRef(activeId),
    templateRef = useRef(templateId);
  const storageReady = useRef(storageOK);
  storageReady.current = storageOK;
  const [repeatCount, setRepeatCount] = useState(1),
    [shuffle, setShuffle] = useState(false);
  const toggleAction = useRef<() => void>(() => {});
  toggleAction.current = toggle;
  const livePlanRef = useRef(plan);
  livePlanRef.current = plan;
  const started = useRef(false),
    lastSaved = useRef(0),
    fade = useRef(new Animated.Value(1)).current,
    reduceMotion = useRef(true);
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
    const value = fn(dbRef.current);
    dbRef.current = value;
    setDb(value);
    return value;
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
  const collectionVoices=[...voices.map(v=>({id:v.id,name:v.name,detail:`${v.language} · 系统声音`})),...(voiceConnection.ready&&voiceConnection.keyReady&&voiceConnection.consent?.confirmed&&voiceConnection.settings.provider==='openai-compatible'?[...new Map([...voiceConnection.externalVoices.map(v=>({id:`remote:${v.id}`,name:v.name,detail:`${v.language} · 外部服务`})),...(voiceConnection.settings.voice?[{id:`remote:${voiceConnection.settings.voice}`,name:voiceConnection.settings.voice,detail:'已配置的外部声音'}]:[])].map(v=>[v.id,v])).values()]:[])];

  const audioPreparation = useRef(0),
    audioAbort = useRef<AbortController | null>(null);
  function message(error: unknown) {
    setNotice(error instanceof Error ? error.message : String(error));
  }
  const { task, tasks } = useTasks(message);
  const audioBusy = tasks.some((x) => /准备|试听/.test(x));
  function playbackContext(value = dbRef.current, owner=sessionMeta.current.collection) {
    if(owner?.kind==='album')return fingerprint([value.resources,value.pronunciations,value.albums?.find(a=>a.id===owner.id)]);
    const context:unknown[]=[value.resources,value.templates,value.settings.voiceId,value.settings.translationVoiceId,value.pronunciations];
    if(owner)context.push(value.playlists.find(p=>p.id===owner.id));
    return fingerprint(context);
  }
  function invalidateCollection(owner:PlaybackCollection){
    if(sessionMeta.current.collection?.kind===owner.kind&&sessionMeta.current.collection.id===owner.id){stopAudio();setPlan(null);setQueue([]);}
  }
  const ownsResume=(v:Library,owner:PlaybackCollection)=>v.resume?.collection?.kind===owner.kind&&v.resume.collection.id===owner.id;
  async function changePlaylist(id:string,fn:(p:Playlist)=>Playlist){
    const current=dbRef.current.playlists.find(p=>p.id===id);if(!current)throw new Error('列表已删除');
    const next=validatePlaylist(fn(current));invalidateCollection({kind:'playlist',id});
    const value=update(v=>({...v,playlists:v.playlists.map(p=>p.id===id?next:p),resume:ownsResume(v,{kind:'playlist',id})?undefined:v.resume}));
    await saveLibrary(value);
  }
  async function createPlaylist(p:Playlist){const next=validatePlaylist(p);await saveLibrary(update(v=>({...v,playlists:[...v.playlists,next]})));}
  async function deletePlaylist(id:string){invalidateCollection({kind:'playlist',id});await saveLibrary(update(v=>({...v,playlists:v.playlists.filter(p=>p.id!==id),resume:ownsResume(v,{kind:'playlist',id})?undefined:v.resume})));}
  async function changeAlbum(id:string,fn:(a:Album)=>Album){
    const current=dbRef.current.albums?.find(a=>a.id===id);if(!current)throw new Error('专辑已删除');
    const next=validateAlbum(fn(current));invalidateCollection({kind:'album',id});
    await saveLibrary(update(v=>({...v,albums:v.albums?.map(a=>a.id===id?next:a),resume:ownsResume(v,{kind:'album',id})?undefined:v.resume})));
  }
  async function createAlbum(a:Album){const next=validateAlbum(a);await saveLibrary(update(v=>({...v,albums:[...(v.albums??[]),next]})));}
  async function deleteAlbum(id:string){invalidateCollection({kind:'album',id});await saveLibrary(update(v=>({...v,albums:v.albums?.filter(a=>a.id!==id),resume:ownsResume(v,{kind:'album',id})?undefined:v.resume})));}
  async function copyAlbum(p:Playlist){const a:Album={id:uid(),name:p.name,resourceIds:[...p.resourceIds],settings:{...albumDefaults}};await createAlbum(a);setAlbumId(a.id);go('albums');setNotice('已复制曲目顺序；请设置专辑朗读规则。');}
  async function requestCatalogue(kind:'poetry'|'grammar',accepted=false){
    if(!accepted&&dbRef.current.consents?.learningResources?.version!==RESOURCE_LICENSE_VERSION){setLicenseKind(kind);return;}
    await task('读取公开目录',async()=>setRemote(await listRemoteResources(kind,{acceptPersonalUseLicense:true})));
  }
  async function acceptResourceLicense(){
    const kind=licenseKind;if(!kind)return;
    const value=update(v=>({...v,consents:{...v.consents,learningResources:{version:RESOURCE_LICENSE_VERSION,acceptedAt:new Date().toISOString()}}}));
    await saveLibrary(value);setLicenseKind(null);await requestCatalogue(kind,true);
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
    const value = update((prev) => ({
      ...prev,
      resume: {
        collection:sessionMeta.current.collection,
        resourceId: id,
        templateId: sessionMeta.current.templateId??templateRef.current,
        position: s.position,
        planId: sourcePlan.current?.id,
        stepId: livePlanRef.current?.steps[s.stepIndex]?.id,
        stepIndex: s.stepIndex,
        sourcePlan: sourcePlan.current ?? undefined,
        context: contextRef.current,
        selectedIds: sessionMeta.current.selectedIds,
        rate: sessionMeta.current.rate,
      },
      history: [h, ...prev.history.filter((x) => x.resourceId !== id)].slice(
        0,
        200,
      ),
    }));
    if (storageReady.current) void saveLibrary(value).catch(message);
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
      let data: Library;
      try {
        data = await loadLibrary();
      } catch (e) {
        setLoaded(true);
        setPage("settings");
        throw e;
      }
      if (
        !data.resources.length &&
        !data.trash?.length &&
        !data.quarantine?.length
      )
        data.resources = [SAMPLE];
      setDb(data);
      setStorageOK(true);
      if (data.resume) {
        sessionMeta.current.collection=data.resume.collection;
        if(data.resume.collection?.kind==='album')setAlbumId(data.resume.collection.id);
        setActiveId(data.resume.resourceId);
        setTemplateId(data.resume.templateId);
        setSelected(data.resume.selectedIds);
        setRate(data.resume.rate ?? 1);
      }
      if (data.timer?.mode === "absolute") setStopAt(data.timer.at);
      else if (data.timer?.mode === "relative") setSleep(data.timer.minutes);
      if (data.editorDraft) {
        setEditId(data.editorDraft.id);
        setTitle(data.editorDraft.title);
        setBody(data.editorDraft.body);
        const r = data.resources.find((r) => r.id === data.editorDraft?.id);
        setEditorSnapshot({
          id: r?.id ?? "",
          title: r?.title ?? "",
          body: r ? resourceBody(r) : "",
        });
      }
      setAIOutput(data.scriptDraft ?? "");
      setDictionary(
        Object.entries(data.pronunciations?.global ?? {})
          .map(([a, b]) => `${a}=${b}`)
          .join("\n"),
      );
      if (data.quarantine?.length)
        setNotice(
          `已隔离 ${data.quarantine.length} 条异常；请在设置中备份或修复。`,
        );
      setLoaded(true);
    });
    Audio.listVoices().then(setVoices).catch(message);
    Audio.getCacheInfo().then(setCache).catch(message);
    const sub = Audio.addListener("onStatus", (s) => {
      if (s.preparing) {
        setStatus(s);
        return;
      }
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
        setSelected(undefined);
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
    if (page === "audio")
      void Audio.getCacheInfo().then(setCache).catch(message);
  }, [page]);
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
    if (loaded && storageOK) {
      const epoch = ++saveEpoch.current;
      setSaveState("保存中…");
      void saveLibrary(db)
        .then(() => {
          if (epoch === saveEpoch.current) setSaveState("已保存");
        })
        .catch((e) => {
          if (epoch === saveEpoch.current) setSaveState("保存失败");
          message(e);
        });
    }
  }, [db, loaded, storageOK]);
  useEffect(() => {
    const save = () => {
      persistProgress();
      void flushLibrary().catch(message);
    };
    const sub = AppState.addEventListener("change", (value) => {
      if (value !== "active") save();
    });
    if (Platform.OS === "web") globalThis.addEventListener("pagehide", save);
    return () => {
      sub.remove();
      if (Platform.OS === "web")
        globalThis.removeEventListener("pagehide", save);
    };
  }, []);
  useEffect(() => {
    if (loaded && storageOK)
      update((v) => ({
        ...v,
        timer: stopAt
          ? { mode: "absolute", at: stopAt }
          : { mode: "relative", minutes: sleep },
      }));
  }, [stopAt, sleep, loaded, storageOK]);
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
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (target?.closest('[role="dialog"],[aria-modal="true"]')) return;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if (e.code === "Space") {
        if (
          target?.closest(
            'button,[role="button"],[role="tab"],[role="checkbox"]',
          )
        )
          return;
        e.preventDefault();
        toggleAction.current();
      }
      if (e.code === "ArrowRight") Audio.seek(statusRef.current.position + 10);
      if (e.code === "ArrowLeft")
        Audio.seek(Math.max(0, statusRef.current.position - 10));
    };
    globalThis.addEventListener?.("keydown", handler);
    return () => globalThis.removeEventListener?.("keydown", handler);
  }, [plan]);
  useEffect(() => {
    if (loaded && storageOK && page === "editor")
      update((v) => ({ ...v, editorDraft: { id: editId, title, body } }));
  }, [editId, title, body, page, loaded, storageOK]);
  const editorDirty =
    title !== editorSnapshot.title ||
    body !== editorSnapshot.body ||
    editId !== editorSnapshot.id;
  function go(next: Page) {
    if (!loaded) return;
    if (!storageOK && next !== "settings") {
      setNotice("请先备份并恢复资料库");
      return;
    }
    pageScroll.current?.scrollTo({ y: 0, animated: false });
    if (next === "sleep") {
      if (!stopAt) setSleep((v) => v || 30);
      setLoop(false);
    }
    setPage(next);
    setNotice("");
  }
  function putResource(input: Resource) {
    if (!storageOK) throw new Error("请先在设置中备份并恢复资料库，再保存内容");
    const r = validateResource(input);
    stopAudio();
    setPlan(null);
    const value = update((v) => ({
      ...v,
      resources: [r, ...v.resources.filter((x) => x.id !== r.id)],
      resume: undefined,
      reviews: (v.reviews ?? [])
        .flatMap((review) => {
          if (
            review.resourceId !== r.id ||
            r.segments.some((s) => s.id === review.segmentId)
          )
            return [review];
          const old = v.resources
            .find((x) => x.id === r.id)
            ?.segments.find((s) => s.id === review.segmentId);
          const target =
            old &&
            r.segments.find((s) =>
              s.original
                .replace(/\s/g, "")
                .includes(old.original.replace(/\s/g, "")),
            );
          return target ? [{ ...review, segmentId: target.id }] : [];
        })
        .filter(
          (x, i, all) =>
            all.findIndex(
              (y) =>
                y.resourceId === x.resourceId && y.segmentId === x.segmentId,
            ) === i,
        ),
      versions: [
        ...v.resources
          .filter(
            (x) => x.id === r.id && JSON.stringify(x) !== JSON.stringify(r),
          )
          .map((resource) => ({ resource, date: new Date().toISOString() })),
        ...(v.versions ?? []),
      ].slice(0, 20),
    }));
    setActiveId(r.id);
    setSelected(undefined);
    return value;
  }
  function edit(r?: Resource) {
    if (editorDirty) {
      go("editor");
      setNotice("当前稿未保存，请先保存或清空编辑区。");
      return;
    }
    setEditorSnapshot({
      id: r?.id ?? "",
      title: r?.title ?? "",
      body: r ? resourceBody(r) : "",
    });
    setStructured(false);
    setEditId(r?.id ?? "");
    setTitle(r?.title ?? "");
    setBody(
      r?.segments
        .map((s) => s.original + (s.translation ? "\t" + s.translation : ""))
        .join("\n") ?? "",
    );
    go("editor");
  }
  async function saveText(generated = false) {
    const id = editId || uid();
    const existing = resources.find((r) => r.id === editId);
    if (
      existing &&
      editId === editorSnapshot.id &&
      (existing.title !== editorSnapshot.title ||
        resourceBody(existing) !== editorSnapshot.body)
    )
      throw new Error("资料已更新，请先备份当前草稿再重新编辑");
    const next = editResource(existing, id, title, body, uid);
    putResource({ ...next, generated: generated || next.generated });
    const normalized = resourceBody(next);
    const value = update((v) => ({
      ...v,
      editorDraft: { id, title: next.title, body: normalized },
    }));
    await saveLibrary(value);
    setEditId(id);
    setTitle(next.title);
    setBody(normalized);
    setEditorSnapshot({ id, title: next.title, body: normalized });
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
    setPreparation(null);
    audioPreparation.current++;
    audioAbort.current?.abort();
    audioAbort.current = null;
    persistProgress();
    Audio.stop();
    livePlanRef.current = null;
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
      (progress) => {
        if (epoch === audioPreparation.current) setPreparation(progress);
      },
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
    return {
      ...db.pronunciations?.global,
      ...db.pronunciations?.resources[active.id],
    };
  }

  async function playCompiled(
    p: ReturnType<typeof compileSession> & {
      pronunciations?: Record<string, string>;
    },
    resume = false,
    playbackRate = rate,
    meta:typeof sessionMeta.current = sessionMeta.current,
  ) {
    const resumeMarker=resume?dbRef.current.resume:undefined;
    stopAudio();
    sessionMeta.current=meta;
    started.current = false;
    setPlan(null);
    livePlanRef.current = null;
    const epoch = ++audioPreparation.current;
    audioAbort.current?.abort();
    const controller = new AbortController();
    audioAbort.current = controller;
    setPreparation(null);
    const source = {
      ...p,
      pronunciations: p.pronunciations ?? pronunciationMap(),
    };
    sourcePlan.current = source;
    contextRef.current = playbackContext();
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
      (progress) => {
        if (epoch === audioPreparation.current) setPreparation(progress);
      },
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
    if (Platform.OS === "ios")
      update((v) => ({
        ...v,
        offline: {
          ...v.offline,
          ...Object.fromEntries(
            [...new Set(p.steps.map((s) => s.resourceId).filter(Boolean))].map(
              (id) => [
                id,
                {
                  steps: p.steps.filter((s) => s.resourceId === id).length,
                  date: new Date().toISOString(),
                },
              ],
            ),
          ),
        },
      }));
    Audio.setRate(playbackRate);
    const position = resume
      ? resumePosition(
          resumeMarker,
          next,
          info.duration,
          contextRef.current,
        )
      : undefined;
    if (position !== undefined) Audio.seek(position);
    const seconds = stopAt ? (stopAt - Date.now()) / 1000 : sleep * 60;
    if (stopAt && seconds <= 0) {
      stopAudio();
      setPlan(null);
      throw new Error("停止时间已到，未开始播放");
    }
    Audio.setSleepTimer(Math.max(0, seconds), 10);
    Audio.play();
    const now = Audio.getStatus();
    const remaining = next.steps
      .slice(now.stepIndex)
      .map((s) => s.resourceId)
      .filter((id, i, all) => id && (i === 0 || id !== all[i - 1]));
    setQueue(remaining.slice(1) as string[]);
    go("player");
    const warnings = [...(p.warnings ?? []), ...prepared.warnings];
    if (resume && resumeMarker?.position && position === undefined)
      warnings.push("恢复标记与当前编排不符，已从头开始。");
    if (warnings.length) setNotice([...new Set(warnings)].join("；"));
  }
  async function start(
    resource: Resource = active,
    chosen: Template = template,
    resume = false,
    playbackRate = rate,
  ) {
    if (audioBusy) return;
    await task("准备本地音频 · 请保持前台", async () => {
      const p = compileSession(
        [
          {
            resource,
            template: chosen,
            selectedIds: resource.id === activeId ? selected : undefined,
            voiceId: db.settings.voiceId || undefined,
            translationVoiceId: db.settings.translationVoiceId || undefined,
          },
        ],
        { loop, repeat: repeatCount },
      );
      setActiveId(resource.id);setTemplateId(chosen.id);setQueue([]);
      await playCompiled(p, resume, playbackRate,{templateId:chosen.id,selectedIds:resource.id===activeId?selected:undefined,rate:playbackRate});
    });
  }
  async function startList(
    ids: string[],
    itemOptions?: Library["playlists"][number]["options"],
    owner?:PlaybackCollection,
  ) {
    if (audioBusy) return;
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
          translationVoiceId: options?.translationVoiceId || db.settings.translationVoiceId || undefined,
          rate: options?.rate ?? 1,
        };
      });

      setSelected(undefined);
      const playlist=owner?.kind==='playlist';
      const p = compileSession(entries, playlist?{loop:false,repeat:1,shuffle:false}:{loop,repeat:repeatCount,shuffle});
      if(playlist)setRate(1);
      const order = p.steps
        .map((s) => s.resourceId!)
        .filter((id, i, all) => i === 0 || id !== all[i - 1]);
      setActiveId(order[0]);
      setQueue(order.slice(1));
      await playCompiled(p,false,playlist?1:rate,{rate:playlist?1:rate,templateId:entries[0]?.template.id,collection:owner});
    });
  }
  async function startAlbum(id:string){
    if(audioBusy)return;
    await task('准备专辑音频',async()=>{
      const a=dbRef.current.albums?.find(a=>a.id===id);if(!a)throw new Error('专辑已删除');
      const p=compileAlbum(a,dbRef.current.resources);
      setRate(1);setSelected(undefined);setActiveId(p.steps[0].resourceId!);
      await playCompiled(p,false,1,{rate:1,templateId:`album:${a.id}`,collection:{kind:'album',id:a.id}});
    });
  }
  async function generate(force = false) {
    if (aiJob.current) return;
    if (!modelConnection.settings) {
      setNotice("请先连接服务并选择模型");
      return;
    }
    const id = ++aiEpoch.current,
      controller = new AbortController(),
      revision = aiRevision.current;
    const requestIdentity = fingerprint([
      aiSource,
      aiStyle,
      prompt,
      modelConnection.settings,
    ]);
    aiJob.current = { id, controller };
    setAIRunning(true);
    setNotice("");
    const config = modelConnection.settings;
    try {
      const result = await generateCachedScript(
        config,
        aiSource,
        aiStyle,
        prompt,
        force,
        controller.signal,
      );
      if (controller.signal.aborted || aiJob.current?.id !== id) return;
      update((v) => ({
        ...v,
        scriptHistory: [
          {
            id: uid(),
            text: result.text,
            date: new Date().toISOString(),
            model: config.model,
          },
          ...(v.scriptHistory ?? []),
        ].slice(0, 10),
      }));
      if (
        aiRevision.current === revision &&
        aiRequestRef.current === requestIdentity
      ) {
        setAIOutput(result.text);
        update((v) => ({ ...v, scriptDraft: result.text }));
        setUsage(
          result.cached
            ? "已复用生成结果，未重复请求"
            : "生成完成，请核对资料。",
        );
      } else setNotice("生成稿已存入历史，保留当前编辑。");
    } catch (e) {
      if (!controller.signal.aborted) message(e);
    } finally {
      if (aiJob.current?.id === id) {
        aiJob.current = null;
        setAIRunning(false);
      }
    }
  }
  const aiRequestRef = useRef("");
  aiRequestRef.current = fingerprint([
    aiSource,
    aiStyle,
    prompt,
    modelConnection.settings,
  ]);
  function continuePlayback() {
    if (audioBusy) return;
    if(selected&&selected.length===0){setNotice("筛选为空，请重新选择句段");return;}
    if (
      plan &&
      livePlanRef.current &&
      plan.steps[statusRef.current.stepIndex]?.resourceId === active.id && contextRef.current===playbackContext()
    ) {
      if (stopAt) {
        const seconds = (stopAt - Date.now()) / 1000;
        if (seconds <= 0) {
          setNotice("停止时间已到");
          return;
        }
        Audio.setSleepTimer(seconds, 10);
      }
      Audio.play();
      go("player");
      return;
    }
    const saved = dbRef.current.resume;
    if (saved)
      sessionMeta.current = {
        collection:saved.collection,
        templateId:saved.templateId,
        selectedIds: saved.selectedIds,
        rate: saved.rate ?? rate,
      };
    if (
      saved?.sourcePlan &&
      saved.context === playbackContext() &&
      saved.resourceId === active.id
    ) {
      void task("准备恢复会话", () =>
        playCompiled(
          saved.sourcePlan as ReturnType<typeof compileSession>,
          true,
          saved.rate ?? rate,
        ),
      );
    } else void start(active, template, true);
  }
  function toggle() {
    if (audioBusy) return;
    if (status.playing) {
      Audio.pause();
      persistProgress();
    } else continuePlayback();
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
            maxWidth: "100%",
            borderWidth: /删除|清理/.test(label) ? 1 : 0,
            borderColor: c.line,
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
            flexShrink: 1,
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
            setSelected(undefined);
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
  function replaceLibrary(value: Library) {
    stopAudio();
    setPlan(null);
    dbRef.current = value;
    setDb(value);
    setStorageOK(true);
    setLoaded(true);
    setActiveId(value.resume?.resourceId ?? value.resources[0]?.id ?? "");
    setTemplateId(value.resume?.templateId ?? "");
    setSelected(value.resume?.selectedIds);
    setAIOutput(value.scriptDraft ?? "");
    setDictionary(
      Object.entries(value.pronunciations?.global ?? {})
        .map(([a, b]) => `${a}=${b}`)
        .join("\n"),
    );
  }
  function render() {
    if (!loaded)
      return (
        <ActivityIndicator accessibilityLabel="打开资料中" color={c.text} />
      );
    if (!storageOK)
      return (
        <>
          {heading("资料恢复", "原始数据已保留，请导出后选择备份恢复。")}
          <DataPanel
            db={db}
            colors={c}
            report={setNotice}
            onChange={replaceLibrary}
          />
        </>
      );
    switch (page) {
      case "review":
        return (
          <ReviewPage
            db={db}
            colors={c}
            onChange={(value) => {
              dbRef.current = value;
              setDb(value);
            }}
            report={setNotice}
          />
        );
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
                  {button("继续听", continuePlayback, true, "play")}
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
            {section("每日任务")}
            {small(
              `自评 ${db.reviews?.length ?? 0} 句 · 薄弱 ${db.reviews?.filter((r) => r.score < 2).length ?? 0} 句`,
            )}
            {button("开始复习", () => go("review"), true)}
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
            {plan&&sessionMeta.current.collection?.kind==='album'&&<View style={{marginBottom:20,gap:8}}>{small(`专辑 · ${db.albums?.find(a=>a.id===sessionMeta.current.collection?.id)?.name??'专辑'}`)}{button('专辑设置',()=>{setAlbumId(sessionMeta.current.collection!.id);go('albums');})}</View>}
            <PlayerPage
              active={active}
              resources={resources}
              status={status}
              plan={plan}
              wide={wide}
              colors={c}
              selected={selected}
              setSelected={setSelected}
              rate={rate}
              setRate={setRate}
              loop={loop}
              setLoop={setLoop}
              sleep={sleep}
              setSleep={setSleep}
              stopAt={stopAt}
              setStopAt={setStopAt}
              allTemplates={allTemplates}
              template={template}
              setTemplateId={setTemplateId}
              repeatCount={repeatCount}
              setRepeatCount={setRepeatCount}
              shuffle={shuffle}
              setShuffle={setShuffle}
              queue={queue}
              setQueue={setQueue}
              reduceMotion={reduceMotion.current}
              ui={{ button, input, section, small, heading }}
              actions={{
                toggle,
                nextSentence,
                start,
                startList,
                edit,
                setNotice,
              }}
            />
          </>
        );
      case "library":
        return (
          <>
            {heading("资源", "管理本机资料，或从学习项目导入。")}
            {input(query, setQuery, "搜索全文")}
            <View style={styles.chips}>
              {button("新建文稿", () => edit(), true)}
              {button(
                "导入 TXT / Markdown",
                () => void task("读取文件", importText),
              )}
            </View>
            {resources
              .filter((r) =>
                [
                  r.title,
                  r.author,
                  ...r.segments.flatMap((s) => [
                    s.original,
                    s.translation,
                    s.explanation,
                    Array.isArray(s.keywords)
                      ? s.keywords.join(" ")
                      : s.keywords,
                  ]),
                ].some((x) => x?.toLowerCase().includes(query.toLowerCase())),
              )
              .slice(0, listLimit)
              .map(row)}
            {resources.length > listLimit &&
              button("更多资料", () => setListLimit((v) => v + 40))}
            {section("学习项目")}
            <View style={styles.chips}>
              {button('古诗文目录',()=>void requestCatalogue('poetry'))}
              {button('英语语法目录',()=>void requestCatalogue('grammar'))}
            </View>
            <ResourceConsent open={licenseKind!==null} onClose={()=>setLicenseKind(null)} onAgree={acceptResourceLicense} colors={c}/>
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
                          acceptPersonalUseLicense: dbRef.current.consents?.learningResources?.version===RESOURCE_LICENSE_VERSION,
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
              editId ? "编辑文稿" : "新建文稿",
              "一行一个朗读单元；原文与译文之间用 Tab 分隔，不猜测文言文句子对应。",
            )}
            {small(
              editId
                ? `正在编辑 · ${resources.find((r) => r.id === editId)?.title ?? "已移除资料"}`
                : "新建文稿，不覆盖已有资料",
            )}
            {small(
              tasks.includes("保存文稿")
                ? "保存中…"
                : editorDirty
                  ? "未保存"
                  : saveState,
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
                  void task("保存文稿", () => saveText());
                },
                true,
                "checkmark-outline",
              )}
              {button("导入文件", () => void task("读取文件", importText))}
              {button("清空编辑区", () => {
                setBody("");
                setTitle("");
                setEditId("");
                setEditorSnapshot({ id: "", title: "", body: "" });
              })}
            </View>
            {small(
              "PDF 提取和扫描 OCR 尚未实现，请先转换为 TXT。导入文件仅保存在本机，不自动上传。",
            )}
            {editId &&
              button(structured ? "收起句段编辑" : "句段编辑", () => {
                const r = resources.find((r) => r.id === editId);
                if (
                  !structured &&
                  r &&
                  (body !== resourceBody(r) || title !== r.title)
                ) {
                  setNotice("请先保存文字，再编辑句段");
                  return;
                }
                setStructured(!structured);
              })}
            {structured && resources.find((r) => r.id === editId) && (
              <SegmentEditor
                key={editId}
                resource={resources.find((r) => r.id === editId)!}
                colors={c}
                report={setNotice}
                onSave={async (r) => {
                  const value = putResource(r);
                  setBody(resourceBody(r));
                  await saveLibrary(value);
                  setStructured(false);
                  setEditorSnapshot({
                    id: r.id,
                    title: r.title,
                    body: resourceBody(r),
                  });
                  setNotice("句段已保存");
                }}
              />
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
                    trash: [
                      {
                        resource: r,
                        deletedAt: new Date().toISOString(),
                        playlists: v.playlists.filter((p) =>
                          p.resourceIds.includes(r.id),
                        ),
                        albums: v.albums?.filter(a => a.resourceIds.includes(r.id)),
                      },
                      ...(v.trash ?? []),
                    ],
                    resume:
                      v.resume?.resourceId === r.id ? undefined : v.resume,
                    resources: v.resources.filter((x) => x.id !== r.id),
                    albums:v.albums?.map(a=>removeResource(a,r.id)),
                    playlists: v.playlists.map((p) => ({
                      ...p,
                      resourceIds: p.resourceIds.filter((id) => id !== r.id),
                    })),
                  }));
                  if (editId === r.id) {
                    setEditId("");
                    setTitle("");
                    setBody("");
                    setEditorSnapshot({ id: "", title: "", body: "" });
                  }
                  setNotice("已移入回收站，可在设置中恢复。");
                })}
              </View>
            ))}
          </>
        );
      case "templates":
        return (
          <TemplatePage
            db={db}
            allTemplates={allTemplates}
            templateDraft={templateDraft}
            setTemplateDraft={setTemplateDraft}
            templateJSON={templateJSON}
            setTemplateJSON={setTemplateJSON}
            setTemplateId={setTemplateId}
            update={update}
            setNotice={setNotice}
            message={message}
            ui={{ button, input, heading, section, small }}
            colors={c}
          />
        );
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
            onDictionaryChange={(v) => {
              setDictionary(v);
              setDictionaryState("未保存");
            }}
            dictionaryState={dictionaryState}
            onSaveDictionary={() => {
              try {
                if (!storageOK) throw new Error("请先备份并恢复资料库");
                const global = validatePronunciations(dictionary);
                update((v) => ({
                  ...v,
                  pronunciations: {
                    global,
                    resources: v.pronunciations?.resources ?? {},
                  },
                }));
                setDictionaryState("保存中…");
                void saveLibrary(dbRef.current)
                  .then(() => setDictionaryState("已保存"))
                  .catch((e) => {
                    setDictionaryState("保存失败");
                    message(e);
                  });
              } catch (e) {
                message(e);
              }
            }}
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
                    if (!confirmCache) {
                      setConfirmCache(true);
                      setNotice("清理会停止播放并删除全部音频；再点一次确认。");
                      return;
                    }
                    await Audio.clearCache();
                    update((v) => ({ ...v, offline: {} }));
                    setConfirmCache(false);
                    setCache(await Audio.getCacheInfo());
                  }),
              )}
            </View>
            {section("已准备篇目")}
            {Object.entries(db.offline ?? {}).map(([id, x]) => (
              <Text key={id} style={{ color: c.text, lineHeight: 26 }}>
                {resources.find((r) => r.id === id)?.title ?? "已删除文稿"} ·{" "}
                {x.steps} 步
              </Text>
            ))}
            {!Object.keys(db.offline ?? {}).length &&
              small("暂无本机音频；播放前先准备。")}
            {section(
              `${cache.count} 个片段 · ${(cache.bytes / 1024 / 1024).toFixed(1)} MB`,
            )}
            {small(
              "清理会停止播放，但不会删除文稿、模板或学习记录。没有缓存配额和逐项删除功能；请留意设备剩余空间。",
            )}
          </>
        );
      case "playlists":
        return <PlaylistPage lists={db.playlists} resources={resources} templates={allTemplates} voices={collectionVoices} colors={c} onChange={changePlaylist} onCreate={createPlaylist} onDelete={deletePlaylist} onPlay={p=>void startList(p.resourceIds,p.options,{kind:'playlist',id:p.id})} onEnqueue={ids=>{setQueue(v=>[...v,...ids]);setNotice('已加入待播队列；在播放器准备队列后生效。');}} onAlbum={p=>void task('创建专辑副本',()=>copyAlbum(p))}/>;
      case "albums":
        return <AlbumPage albums={db.albums??[]} preferredId={albumId} onSelect={setAlbumId} resources={resources} voices={collectionVoices} colors={c} onCreate={createAlbum} onChange={changeAlbum} onDelete={deleteAlbum} onPlay={a=>void startAlbum(a.id)} busy={audioBusy} onVoices={()=>go('voices')}/>;
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
                    setActiveId(r.id);
                    if (db.resume?.resourceId === r.id) {
                      void task("准备恢复会话", () =>
                        db.resume?.sourcePlan &&
                        db.resume.context === playbackContext()
                          ? playCompiled(
                              db.resume.sourcePlan as ReturnType<
                                typeof compileSession
                              >,
                              true,
                            )
                          : start(r, template, true),
                      );
                    } else void start(r, template);
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
              {button(
                "生成讲稿",
                () => void generate(),
                true,
                undefined,
                aiRunning || !modelConnection.canGenerate,
              )}
              {button(
                "重新生成（调用接口）",
                () => void generate(true),
                false,
                undefined,
                aiRunning || !modelConnection.canGenerate,
              )}
              {aiRunning &&
                button("停止生成", () => {
                  aiJob.current?.controller.abort();
                  aiJob.current = null;
                  ++aiEpoch.current;
                  setAIRunning(false);
                })}
              {button("配置模型", () => go("settings"))}
            </View>
            {small(
              modelConnection.canGenerate
                ? "资料会发送到所选服务，费用按服务商计算。"
                : modelConnection.error ||
                    "模型尚未就绪，请先在设置中连接并选择模型。",
            )}
            {section("待核对的生成稿")}
            {input(
              aiOutput,
              (v) => {
                aiRevision.current++;
                setAIOutput(v);
                update((x) => ({ ...x, scriptDraft: v }));
              },
              "生成内容可直接修改；不是权威教材。",
              true,
            )}
            {small(usage)}
            {button(
              "核对后存为文稿",
              () => {
                if (!aiOutput.trim()) return;
                try {
                  const id = uid();
                  putResource({
                    ...editResource(
                      undefined,
                      id,
                      `${aiStyle} · ${new Date().toLocaleDateString()}`,
                      aiOutput,
                      uid,
                    ),
                    generated: true,
                  });
                } catch (e) {
                  message(e);
                  return;
                }
                editId && setEditId("");
                setNotice("已保存，并标记为生成讲稿。可在我的文稿继续编辑。");
              },
              true,
            )}
            {section("生成历史")}
            {(db.scriptHistory ?? []).map((h, i) =>
              button(`载入历史 ${i + 1}`, () => {
                aiRevision.current++;
                setAIOutput(h.text);
                update((v) => ({ ...v, scriptDraft: h.text }));
                setNotice("已载入待核对稿");
              }),
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
                    setStopAt(null);
                    setSleep(n);
                    setLoop(n === 0);
                  },
                  !stopAt && sleep === n,
                ),
              )}
            </View>
            {small(
              stopAt
                ? `固定截止 ${new Date(stopAt).toLocaleString()}`
                : sleep
                  ? `当前睡眠定时：${sleep} 分钟`
                  : "整晚循环，需手动停止",
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
              setStopAt(d.getTime());
              Audio.setSleepTimer(sec, 10);
              setSleep(0);
              setNotice("已设置停止时间");
            })}
          </>
        );
      case "settings":
        return (
          <View style={{ maxWidth: 800, width: "100%" }}>
            {heading("设置")}
            <AccountPanel
              account={account}
              colors={c}
              onLogin={async (username, password) => {
                if (!ACCOUNT_API) throw new Error(ACCOUNT_UNAVAILABLE_MESSAGE);
                await login(ACCOUNT_API, username, password);
                setAccount(username);
                syncPreview.current = null;
                setSyncConflict(null);
              }}
              onLogout={() =>
                void task("退出登录", async () => {
                  const result = await logout(ACCOUNT_API);
                  if (result.localCleared) {
                    setAccount("");
                    syncPreview.current = null;
                    setSyncConflict(null);
                  }
                  setNotice(
                    result.remoteRevoked
                      ? "已退出"
                      : "已在本机退出；远端撤销未完成，可稍后重试。",
                  );
                })
              }
            />
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
                        const batch = await createSyncBatch(ACCOUNT_API);
                        syncBatch.current = batch;
                        try {
                          let uploaded = 0;
                          for (const t of db.templates) {
                            try {
                              const remote = await batch.request(
                                `/v1/sync/templates/${encodeURIComponent(t.id)}`,
                              );
                              if (remote.version > 0) {
                                syncPreview.current = batch;
                                setSyncConflict(remote);
                                throw new Error(
                                  "云端已有同 ID 模板。请先查看并导入云端版本，未覆盖已有数据。",
                                );
                              }
                            } catch (e) {
                              if (!(e instanceof SyncError && e.status === 404))
                                throw e;
                            }
                            await batch.request(
                              `/v1/sync/templates/${encodeURIComponent(t.id)}`,
                              { baseVersion: 0, data: t, deleted: false },
                              "PUT",
                            );
                            uploaded++;
                          }
                          setNotice(
                            `已上传 ${uploaded} 个自建模板；已有云端版本不会覆盖。`,
                          );
                        } finally {
                          batch.dispose();
                          if (syncBatch.current === batch)
                            syncBatch.current = null;
                        }
                      }),
                  )}
                  {button(
                    "读取云端模板",
                    () =>
                      void task("读取云端", async () => {
                        const batch = await createSyncBatch(ACCOUNT_API);
                        syncBatch.current = batch;
                        try {
                          const entries = await readAllTemplates(batch);
                          syncPreview.current = batch;
                          setSyncConflict(entries);
                        } finally {
                          batch.dispose();
                          if (syncBatch.current === batch)
                            syncBatch.current = null;
                        }
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
                      void task("导入云端模板", async () => {
                        try {
                          if (!syncPreview.current)
                            throw new Error("请重新读取云端模板");
                          await syncPreview.current.check();
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
                      });
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
            <DataPanel
              db={db}
              colors={c}
              report={setNotice}
              onChange={replaceLibrary}
            />
            {section("关于")}

            {small(`版本 ${version}`)}
            <View style={styles.chips}>
              {button(
                "源代码与构建文档",
                () =>
                  void Linking.openURL(
                    "https://github.com/XiaoRui114514/noxia",
                  ),
              )}
            </View>
          </View>
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
          ref={pageScroll}
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
            {(status.preparing || preparation) &&
              small(
                status.preparing
                  ? `音频准备 ${status.preparedCount ?? 0}/${status.totalSteps ?? 0} · 缓存命中 ${status.cachedCount ?? 0}`
                  : `外部准备 ${preparation!.done}/${preparation!.total} · 命中 ${preparation!.cached} · 失败 ${preparation!.failedIds.length}`,
              )}
            {!!preparation?.failedIds.length&&small(`已改用系统声音：${preparation.failedIds.slice(0,5).map(id=>sourcePlan.current?.steps.find(s=>s.id===id)?.text?.slice(0,36)??'朗读片段').join('；')}${preparation.failedIds.length>5?'…':''}`)}
            {syncBatch.current &&
              button("停止同步", () => syncBatch.current?.cancel())}
            {tasks.length > 0 && (
              <View style={[styles.inline, { marginBottom: 20 }]}>
                <ActivityIndicator color={c.text} />
                <Text style={{ color: c.muted, flex: 1 }}>
                  {tasks.join(" · ")}
                </Text>
                {audioBusy &&
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
    padding: 24,
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
