import React, { useState } from "react";
import { Text, View } from "react-native";
import {
  Album,
  AlbumSettings,
  albumDefaults,
  albumSummary,
  validateAlbum,
} from "../core/albums";
import { Resource } from "../core";
import { addResource, moveResource, removeResource } from "../core/collections";
import { uid } from "../services/storage";
import { AppColors } from "./theme";
import { Action, Field } from "./CollectionControls";
import { OrderedTracks } from "./OrderedTracks";
import { VoicePicker, VoiceChoice } from "./VoicePicker";
type Props = {
  albums: Album[];
  resources: Resource[];
  voices: VoiceChoice[];
  colors: AppColors;
  preferredId?: string;
  onSelect: (id: string) => void;
  onCreate: (a: Album) => Promise<void>;
  onChange: (id: string, fn: (current: Album) => Album) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPlay: (a: Album) => void;
  onVoices: () => void;
  busy: boolean;
};
export function AlbumPage(props: Props) {
  const { albums, colors: c } = props,
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [creationOpen, setCreationOpen] = useState(!albums.length);
  const active = albums.find((a) => a.id === props.preferredId) ?? albums[0];
  return (
    <View style={{ maxWidth: 900, width: "100%", gap: 18 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 34, fontWeight: "600", color: c.text }}
      >
        专辑
      </Text>
      <Text style={{ color: c.muted, lineHeight: 25 }}>
        把课文排成一张专辑，保存各自的声音、遍数和播放规则。
      </Text>
      <Action
        text="新建专辑"
        onPress={() => setCreationOpen((v) => !v)}
        colors={c}
      />
      {creationOpen && (
        <>
          <Field
            label="新专辑名称"
            value={name}
            onChange={setName}
            colors={c}
          />
          <Action
            text="创建专辑"
            disabled={creating}
            primary
            colors={c}
            onPress={() => {
              try {
                const a = validateAlbum({
                  id: uid(),
                  name,
                  resourceIds: [],
                  settings: { ...albumDefaults },
                });
                setCreating(true);
                setError("");
                void props
                  .onCreate(a)
                  .then(() => {
                    props.onSelect(a.id);
                    setName("");
                    setCreationOpen(false);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setCreating(false));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error}
        </Text>
      )}
      {!albums.length && (
        <Text style={{ color: c.muted, lineHeight: 24 }}>
          暂无专辑。也可以从播放列表创建副本。
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {albums.map((a) => (
          <Action
            key={a.id}
            text={`${a.name} (${a.resourceIds.length})`}
            selected={a.id === active?.id}
            onPress={() => props.onSelect(a.id)}
            colors={c}
          />
        ))}
      </View>
      {creating && (
        <Text accessibilityRole="status" style={{ color: c.muted }}>
          正在创建…
        </Text>
      )}
      {!creating && active && (
        <AlbumDetails key={active.id} {...props} album={active} />
      )}
    </View>
  );
}
function AlbumDetails({ album: a, ...props }: Props & { album: Album }) {
  const { colors: c } = props,
    [name, setName] = useState(a.name),
    [draft, setDraft] = useState(a.settings),
    [state, setState] = useState("已保存"),
    [saving, setSaving] = useState(false),
    [view, setView] = useState<"tracks" | "settings">("tracks"),
    [numbers, setNumbers] = useState({
      originalRepeat: String(a.settings.originalRepeat),
      translationRepeat: String(a.settings.translationRepeat),
      rate: String(a.settings.rate),
      gapMs: String(a.settings.gapMs / 1000),
      repeat: String(a.settings.repeat),
    });
  const values = {
    ...draft,
    ...Object.fromEntries(
      Object.entries(numbers).map(([k, v]) => [
        k,
        k === "gapMs" ? Math.round(Number(v) * 1000) : Number(v),
      ]),
    ),
  } as AlbumSettings;
  const dirty =
    name !== a.name ||
    JSON.stringify(values) !== JSON.stringify(a.settings) ||
    Object.values(numbers).some((v) => !v.trim());
  const patch = (v: Partial<AlbumSettings>) =>
    setDraft((p) => ({ ...p, ...v }));
  async function change(fn: (value: Album) => Album) {
    setState("保存中…");
    try {
      await props.onChange(a.id, (v) => validateAlbum(fn(v)));
      setState("已保存");
      return true;
    } catch (e) {
      setState(`保存失败：${(e as Error).message}`);
      return false;
    }
  }
  return (
    <View style={{ gap: 18 }}>
      <View
        style={{
          backgroundColor: c.soft,
          padding: 22,
          borderRadius: 12,
          gap: 12,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: c.text, fontSize: 27, fontWeight: "600" }}
        >
          {a.name}
        </Text>
        <Text style={{ color: c.muted, lineHeight: 24 }}>
          {albumSummary(a.settings)}
        </Text>
        <Text
          accessibilityRole="status"
          style={{ color: c.muted, lineHeight: 23 }}
        >
          {dirty ? "设置未保存" : state}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
          <Action
            text="播放专辑"
            primary
            disabled={props.busy || dirty || !a.resourceIds.length || saving}
            onPress={() => props.onPlay(a)}
            colors={c}
          />
          <Action
            text="删除专辑"
            onPress={() => {
              void props.onDelete(a.id).catch((e) => setState(e.message));
            }}
            disabled={saving}
            colors={c}
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Action
          text="曲目"
          onPress={() => setView("tracks")}
          selected={view === "tracks"}
          colors={c}
        />
        <Action
          text="朗读设置"
          onPress={() => setView("settings")}
          selected={view === "settings"}
          colors={c}
        />
      </View>
      {view === "settings" && (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 23, fontWeight: "600" }}
          >
            朗读设置
          </Text>
          <Field label="专辑名称" value={name} onChange={setName} colors={c} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            {(["article", "sentence"] as const).map((mode) => (
              <Action
                key={mode}
                text={mode === "article" ? "整篇" : "逐句"}
                selected={draft.mode === mode}
                onPress={() => patch({ mode })}
                colors={c}
              />
            ))}
          </View>
          <Text style={{ color: c.muted, lineHeight: 24 }}>
            {draft.mode === "article"
              ? "每篇先读完全部原文，再读完全部译文，然后换篇。"
              : "每句先读原文，再读译文，然后换句。"}
            遍数设为 0 则跳过该项。
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            {(
              [
                ["originalRepeat", "原文遍数"],
                ["translationRepeat", "译文遍数"],
                ["rate", "朗读语速"],
                ["gapMs", "句间间隔（秒）"],
                ["repeat", "专辑轮数"],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={numbers[key]}
                onChange={(v) => setNumbers((p) => ({ ...p, [key]: v }))}
                colors={c}
                numeric
              />
            ))}
          </View>
          <VoicePicker
            label="原文声音"
            value={draft.voiceId}
            onChange={(voiceId) => patch({ voiceId })}
            choices={props.voices}
            colors={c}
          />
          <VoicePicker
            label="译文声音"
            value={draft.translationVoiceId}
            onChange={(translationVoiceId) => patch({ translationVoiceId })}
            choices={props.voices}
            colors={c}
          />
          <Action text="声音管理" onPress={props.onVoices} colors={c} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            <Action
              text={draft.shuffle ? "随机顺序 · 开" : "随机顺序"}
              selected={draft.shuffle}
              onPress={() => patch({ shuffle: !draft.shuffle })}
              colors={c}
            />
            <Action
              text={draft.loop ? "循环播放 · 开" : "循环播放"}
              selected={draft.loop}
              onPress={() => patch({ loop: !draft.loop })}
              colors={c}
            />
          </View>
          <Text style={{ color: c.muted, lineHeight: 24 }}>
            顺序模式按已保存曲目排列；随机模式每次开始时打乱篇目，原文与译文仍按设置朗读。循环会重复已准备的整张专辑。
          </Text>
          <Action
            text={saving ? "保存中…" : "保存专辑设置"}
            disabled={saving}
            primary
            colors={c}
            onPress={() => {
              try {
                if (Object.values(numbers).some((v) => !v.trim()))
                  throw new Error("请填写完整的遍数、语速和间隔");
                const valid = validateAlbum({ ...a, name, settings: values });
                setSaving(true);
                void change((v) => ({
                  ...v,
                  name: valid.name,
                  settings: valid.settings,
                }))
                  .then((ok) => {
                    if (ok) {
                      setName(valid.name);
                      setDraft(valid.settings);
                      setNumbers({
                        originalRepeat: String(valid.settings.originalRepeat),
                        translationRepeat: String(
                          valid.settings.translationRepeat,
                        ),
                        rate: String(valid.settings.rate),
                        gapMs: String(valid.settings.gapMs / 1000),
                        repeat: String(valid.settings.repeat),
                      });
                    }
                  })
                  .finally(() => setSaving(false));
              } catch (e) {
                setState(`保存失败：${(e as Error).message}`);
                return false;
              }
            }}
          />
          {state.startsWith("保存失败") && (
            <Text
              accessibilityRole="alert"
              style={{ color: c.text, lineHeight: 24 }}
            >
              {state}
            </Text>
          )}
        </>
      )}
      {view === "tracks" && (
        <OrderedTracks
          ids={a.resourceIds}
          resources={props.resources}
          colors={c}
          onAdd={(id) => {
            void change((v) => addResource(v, id));
          }}
          onRemove={(id) => {
            void change((v) => removeResource(v, id));
          }}
          onMove={(id, delta) => {
            void change((v) =>
              moveResource(v, v.resourceIds.indexOf(id), delta),
            );
          }}
          disabled={saving}
        />
      )}
    </View>
  );
}
