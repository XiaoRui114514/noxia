import React, { useState } from "react";
import { Text, View } from "react-native";
import { Resource, Template } from "../core";
import {
  Playlist,
  PlaylistOptions,
  addResource,
  removeResource,
  moveResource,
  validatePlaylist,
  validatePlaylistOptions,
} from "../core/collections";
import { uid } from "../services/storage";
import { Action, Field } from "./CollectionControls";
import { OrderedTracks } from "./OrderedTracks";
import { VoicePicker, VoiceChoice } from "./VoicePicker";
import { AppColors } from "./theme";

type Props = {
  lists: Playlist[];
  resources: Resource[];
  templates: Template[];
  voices: VoiceChoice[];
  colors: AppColors;
  onChange: (
    id: string,
    change: (current: Playlist) => Playlist,
  ) => Promise<void>;
  onCreate: (list: Playlist) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPlay: (list: Playlist) => void;
  onEnqueue: (ids: string[]) => void;
  onAlbum: (list: Playlist) => void;
};
export function PlaylistPage(props: Props) {
  const { lists, colors: c } = props,
    [id, setId] = useState(lists[0]?.id ?? ""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [creationOpen, setCreationOpen] = useState(!lists.length);
  const active = lists.find((p) => p.id === id) ?? lists[0];
  return (
    <View style={{ gap: 18, maxWidth: 900, width: "100%" }}>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 34, fontWeight: "600" }}
      >
        播放列表
      </Text>
      <Text style={{ color: c.muted, lineHeight: 24 }}>
        按已加入曲目的顺序播放。声音和遍数可在专辑中统一设置。
      </Text>
      <Action
        text="新建列表"
        onPress={() => setCreationOpen((v) => !v)}
        colors={c}
      />
      {creationOpen && (
        <>
          <Field
            label="新播放列表名称"
            value={name}
            onChange={setName}
            colors={c}
          />
          <Action
            text="创建列表"
            disabled={creating}
            onPress={() => {
              if (creating) return;
              try {
                const p = validatePlaylist({
                  id: uid(),
                  name,
                  resourceIds: [],
                });
                setError("");
                setCreating(true);
                void props
                  .onCreate(p)
                  .then(() => {
                    setId(p.id);
                    setName("");
                    setCreationOpen(false);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setCreating(false));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            colors={c}
            primary
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error}
        </Text>
      )}
      {!lists.length && (
        <Text style={{ color: c.muted }}>暂无列表，先取个名称。</Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {lists.map((p) => (
          <Action
            key={p.id}
            text={`${p.name} (${p.resourceIds.length})`}
            selected={p.id === active?.id}
            onPress={() => setId(p.id)}
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
        <PlaylistDetails key={active.id} {...props} list={active} />
      )}
    </View>
  );
}
function PlaylistDetails({ list: p, ...props }: Props & { list: Playlist }) {
  const { resources, templates, voices, colors: c } = props,
    [item, setItem] = useState(""),
    [name, setName] = useState(p.name),
    [state, setState] = useState("已保存"),
    [renaming, setRenaming] = useState(false);
  function change(fn: (p: Playlist) => Playlist) {
    setState("保存中…");
    void props
      .onChange(p.id, (current) => validatePlaylist(fn(current)))
      .then(() => setState("已保存"))
      .catch((e) => setState(`保存失败：${e.message}`));
  }
  return (
    <View style={{ gap: 16 }}>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: 25, fontWeight: "600" }}
      >
        {p.name}
      </Text>
      <Text
        accessibilityRole="status"
        style={{ color: c.muted, lineHeight: 24 }}
      >
        {state}
      </Text>
      {renaming && (
        <Field label="列表名称" value={name} onChange={setName} colors={c} />
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Action
          text={renaming ? "保存名称" : "重命名"}
          onPress={() => {
            if (renaming) {
              change((v) => ({ ...v, name }));
              setRenaming(false);
            } else setRenaming(true);
          }}
          colors={c}
        />
        <Action
          text="播放列表"
          primary
          disabled={!p.resourceIds.length}
          onPress={() => props.onPlay(p)}
          colors={c}
        />
        <Action
          text="加入待播队列"
          disabled={!p.resourceIds.length}
          onPress={() => props.onEnqueue(p.resourceIds)}
          colors={c}
        />
        <Action
          text="创建专辑副本"
          onPress={() => props.onAlbum(p)}
          colors={c}
        />
        <Action
          text="删除列表"
          onPress={() => {
            void props.onDelete(p.id).catch((e) => setState(e.message));
          }}
          colors={c}
        />
      </View>
      <OrderedTracks
        ids={p.resourceIds}
        resources={resources}
        colors={c}
        onAdd={(id) => change((v) => addResource(v, id))}
        onRemove={(id) => change((v) => removeResource(v, id))}
        onMove={(id, direction) =>
          change((v) => moveResource(v, v.resourceIds.indexOf(id), direction))
        }
      />
      {!!p.resourceIds.length && (
        <>
          <Text
            accessibilityRole="header"
            style={{
              color: c.text,
              fontSize: 23,
              fontWeight: "600",
              marginTop: 18,
            }}
          >
            单篇设置
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
            {p.resourceIds.map((id, i) => (
              <Action
                key={id + i}
                text={resources.find((r) => r.id === id)?.title ?? "资料已删除"}
                onPress={() => setItem(item === id ? "" : id)}
                selected={item === id}
                colors={c}
              />
            ))}
          </View>
          {p.resourceIds.includes(item) && (
            <ItemOptions
              key={`${p.id}:${item}:${JSON.stringify(p.options?.[item])}`}
              initial={p.options?.[item] ?? {}}
              templates={templates}
              voices={voices}
              colors={c}
              onSave={(options) =>
                change((v) => ({
                  ...v,
                  options: { ...v.options, [item]: options },
                }))
              }
            />
          )}
        </>
      )}
    </View>
  );
}
function ItemOptions({
  initial,
  templates,
  voices,
  colors: c,
  onSave,
}: {
  initial: PlaylistOptions;
  templates: Template[];
  voices: VoiceChoice[];
  colors: AppColors;
  onSave: (p: PlaylistOptions) => void;
}) {
  const [draft, setDraft] = useState(initial),
    [rate, setRate] = useState(String(initial.rate ?? 1)),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 10,
        padding: 16,
        gap: 16,
      }}
    >
      <Text style={{ color: c.muted, lineHeight: 23 }}>
        编辑后保存生效；未设置的项目跟随默认配置。
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        {[{ id: "", name: "默认编排" }, ...templates].map((t) => (
          <Action
            key={t.id}
            text={t.name}
            selected={(draft.templateId ?? "") === t.id}
            onPress={() =>
              setDraft((v) => ({ ...v, templateId: t.id || undefined }))
            }
            colors={c}
          />
        ))}
      </View>
      <VoicePicker
        label="单篇原文声音"
        value={draft.voiceId ?? ""}
        onChange={(voiceId) =>
          setDraft((v) => ({ ...v, voiceId: voiceId || undefined }))
        }
        choices={voices}
        colors={c}
        emptyLabel="跟随默认"
      />
      <VoicePicker
        label="单篇译文声音"
        value={draft.translationVoiceId ?? ""}
        onChange={(translationVoiceId) =>
          setDraft((v) => ({
            ...v,
            translationVoiceId: translationVoiceId || undefined,
          }))
        }
        choices={voices}
        colors={c}
        emptyLabel="跟随默认"
      />
      <Field
        label="此篇语速倍率 0.25—2"
        value={rate}
        onChange={setRate}
        colors={c}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error}
        </Text>
      )}
      <Action
        text="保存单篇设置"
        onPress={() => {
          try {
            if (!rate.trim()) throw new Error("请填写语速");
            const next = validatePlaylistOptions({
              ...draft,
              rate: Number(rate),
            });
            setError("");
            onSave(next);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        colors={c}
        primary
      />
    </View>
  );
}
