import React, { useState } from "react";
import {
  Platform,
  Share,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import {
  Library,
  exportLibrary,
  parseLibrary,
  readRawLibrary,
  readRecoveryBackup,
  restoreLibrary,
} from "../services/storage";
import { restorePlaylistLink } from "../core/libraryOperations";
import { validateResource } from "../core";
import { ModelSettingsColors } from "./ModelSettings";
export function DataPanel({
  db,
  onChange,
  colors: c,
  report,
}: {
  db: Library;
  onChange: (value: Library) => void;
  colors: ModelSettingsColors;
  report: (text: string) => void;
}) {
  const [text, setText] = useState(""),
    [preview, setPreview] = useState<Library | null>(null),
    [repairId, setRepairId] = useState(""),
    [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void fn()
      .catch((e) => report(e.message))
      .finally(() => setBusy(false));
  };
  const button = (label: string, fn: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={fn}
      style={{
        padding: 12,
        minHeight: 44,
        borderRadius: 8,
        backgroundColor: c.soft,
      }}
    >
      <Text style={{ color: c.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
  const hint = (value: string) => (
    <Text style={{ color: c.muted, lineHeight: 23 }}>{value}</Text>
  );
  async function download(raw: string) {
    setText(raw);
    setPreview(null);
    setRepairId("");
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(
        new Blob([raw], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `noxia-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const f = new File(Paths.document, `noxia-backup-${Date.now()}.json`);
      f.create();
      f.write(raw);
      await Share.share(
        Platform.OS === "ios"
          ? { url: f.uri, title: "Noxia 备份" }
          : { message: raw, title: "Noxia 备份" },
      );
    }
    report("已导出备份；包含私人文稿，请妥善保存。");
  }
  return (
    <View style={{ gap: 14, marginVertical: 20 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 23, fontWeight: "600", color: c.text }}
      >
        数据
      </Text>
      {hint(
        `${db.resources.length} 篇资料 · ${db.trash?.length ?? 0} 篇回收站 · ${db.quarantine?.length ?? 0} 条异常`,
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {button("整库备份", () => run(() => download(exportLibrary(db))))}
        {button("导出原始数据", () =>
          run(async () => download(await readRawLibrary())),
        )}
        {button("恢复备份", () =>
          run(async () => {
            const r = await DocumentPicker.getDocumentAsync({
              type: ["application/json", "text/plain"],
            });
            if (r.canceled) return;
            const f = r.assets[0];
            if ((f.size ?? 0) > 30000000) throw new Error("文件超过30 MB");
            const raw =
              Platform.OS === "web" && f.file
                ? await f.file.text()
                : await new File(f.uri).text();
            setText(raw);
            setPreview(parseLibrary(raw));
            setRepairId("");
          }),
        )}
        {button("读取恢复点", () =>
          run(async () => {
            const raw = await readRecoveryBackup();
            if (!raw) throw new Error("暂无恢复点");
            setText(raw);
            setPreview(parseLibrary(raw));
            setRepairId("");
          }),
        )}
      </View>
      {hint(
        "恢复前自动保存当前原文。备份包含资料、模板、词典、复习和进度，不含密钥及音频。",
      )}
      <TextInput
        accessibilityLabel="备份或修复 JSON"
        multiline
        value={text}
        onChangeText={(v) => {
          setText(v);
          setPreview(null);
        }}
        placeholder="粘贴备份 JSON"
        placeholderTextColor={c.muted}
        style={{
          minHeight: 110,
          maxHeight: 240,
          padding: 14,
          borderWidth: 1,
          borderColor: c.line,
          color: c.text,
          borderRadius: 8,
          textAlignVertical: "top",
          fontSize: 15,
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {button("预览备份", () => {
          try {
            setPreview(parseLibrary(text));
            setRepairId("");
          } catch (e) {
            report(String(e));
          }
        })}
        {preview &&
          button("确认恢复", () =>
            run(async () => {
              onChange(await restoreLibrary(text));
              setPreview(null);
              report("已恢复；旧数据已保存为恢复点。");
            }),
          )}
        {repairId &&
          button("保存修复", () => {
            try {
              const resource = validateResource(JSON.parse(text));
              onChange({
                ...db,
                resources: [
                  resource,
                  ...db.resources.filter((r) => r.id !== resource.id),
                ],
                quarantine: db.quarantine?.filter((q) => q.id !== repairId),
              });
              setRepairId("");
              setText("");
              report("已修复并恢复资料");
            } catch (e) {
              report(String(e));
            }
          })}
      </View>
      {preview &&
        hint(
          `将恢复 ${preview.resources.length} 篇、${preview.templates.length} 个模板；隔离 ${preview.quarantine?.length ?? 0} 条。当前资料库将替换。`,
        )}
      {(db.quarantine ?? []).map((q) => (
        <View key={q.id} style={{ gap: 8, paddingVertical: 10 }}>
          {hint(`${q.collection} · ${q.reason}`)}
          {button("查看异常原文", () => {
            setText(JSON.stringify(q.raw, null, 2));
            setRepairId(q.collection === "resources" ? q.id : "");
            setPreview(null);
          })}
        </View>
      ))}
      <Text accessibilityRole="header" style={{ fontSize: 20, color: c.text }}>
        回收站
      </Text>
      {!db.trash?.length && hint("回收站为空")}
      {(db.trash ?? []).map((item, i) => (
        <View key={item.resource.id + i} style={{ gap: 8, paddingVertical: 8 }}>
          <Text style={{ color: c.text }}>{item.resource.title}</Text>
          {button(`恢复 ${item.resource.title}`, () => {
            if (db.resources.some((r) => r.id === item.resource.id)) {
              report("同 ID 资料已存在，请先备份再处理");
              return;
            }
            onChange({
              ...db,
              resources: [item.resource, ...db.resources],
              trash: db.trash?.filter((_, j) => i !== j),
              playlists: db.playlists.map((p) => {
                const before = item.playlists.find((x) => x.id === p.id);
                return before
                  ? restorePlaylistLink(p, before, item.resource.id)
                  : p;
              }),
            });
            report("已恢复文稿及列表关联");
          })}
        </View>
      ))}
      <Text accessibilityRole="header" style={{ fontSize: 20, color: c.text }}>
        版本历史
      </Text>
      {hint("保留最近 20 次编辑前版本。恢复为编辑前内容，当前版仍保留在历史。")}
      {(db.versions ?? []).slice(0, 20).map((v, i) => (
        <View key={i} style={{ gap: 8 }}>
          {hint(`${v.resource.title} · ${new Date(v.date).toLocaleString()}`)}
          {button(`恢复版本 ${i + 1}`, () => {
            const current = db.resources.find((r) => r.id === v.resource.id);
            onChange({
              ...db,
              resources: [
                v.resource,
                ...db.resources.filter((r) => r.id !== v.resource.id),
              ],
              versions: [
                ...(current
                  ? [{ resource: current, date: new Date().toISOString() }]
                  : []),
                ...(db.versions ?? []),
              ].slice(0, 20),
              resume: undefined,
            });
            report("已恢复版本");
          })}
        </View>
      ))}
    </View>
  );
}
