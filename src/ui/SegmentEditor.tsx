import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Resource, Segment, validateResource } from "../core";
import { mergeSegments, splitSegment } from "../core/editor";
import { ModelSettingsColors } from "./ModelSettings";
export function SegmentEditor({
  resource,
  onSave,
  colors: c,
  report,
}: {
  resource: Resource;
  onSave: (r: Resource) => Promise<void>;
  colors: ModelSettingsColors;
  report: (text: string) => void;
}) {
  const [draft, setDraft] = useState(resource),
    [limit, setLimit] = useState(20),
    [offset, setOffset] = useState(""),
    [pending, setPending] = useState(false);
  const button = (label: string, fn: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={pending}
      onPress={fn}
      style={{
        padding: 12,
        minHeight: 44,
        borderRadius: 8,
        backgroundColor: c.soft,
      }}
    >
      <Text style={{ color: c.text }}>{label}</Text>
    </Pressable>
  );
  const patch = (id: string, values: Partial<Segment>) =>
    setDraft((v) => ({
      ...v,
      segments: v.segments.map((s) => (s.id === id ? { ...s, ...values } : s)),
    }));
  const field = (
    label: string,
    value: string,
    change: (text: string) => void,
  ) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={c.muted}
      multiline
      value={value}
      onChangeText={change}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 8,
        fontSize: 16,
        lineHeight: 25,
        color: c.text,
        minHeight: 48,
      }}
    />
  );
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: c.muted, lineHeight: 23 }}>
        逐句保留 ID
        和段落编号。拆分保留首句关联；合并汇集解释、关键词和重点。译文须人工对应。
      </Text>
      {draft.segments.slice(0, limit).map((s, i) => (
        <View
          key={s.id}
          style={{
            gap: 10,
            padding: 16,
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: c.text, fontSize: 20 }}>第 {i + 1} 句</Text>
          {field(`原文 ${i + 1}`, s.original, (v) =>
            patch(s.id, { original: v }),
          )}
          {field(`译文 ${i + 1}`, s.translation ?? "", (v) =>
            patch(s.id, { translation: v || undefined }),
          )}
          {field(`解释 ${i + 1}`, s.explanation ?? "", (v) =>
            patch(s.id, { explanation: v || undefined }),
          )}
          {field(
            `关键词 ${i + 1}`,
            Array.isArray(s.keywords)
              ? s.keywords.join("，")
              : (s.keywords ?? ""),
            (v) => patch(s.id, { keywords: v || undefined }),
          )}
          {field(
            `段落编号 ${i + 1}`,
            s.paragraph === undefined ? "" : String(s.paragraph),
            (v) => patch(s.id, { paragraph: v === "" ? undefined : Number(v) }),
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {button(s.important ? "取消重点" : "标为重点", () =>
              patch(s.id, { important: !s.important }),
            )}
            {button(`合并下一句 ${i + 1}`, () => {
              try {
                setDraft(mergeSegments(draft, i));
              } catch (e) {
                report(String(e));
              }
            })}
          </View>
          {field(`拆分位置 ${i + 1}`, offset, setOffset)}
          {button(`拆分此句 ${i + 1}`, () => {
            try {
              setDraft(
                splitSegment(
                  draft,
                  i,
                  Number(offset),
                  `${draft.id}:split:${Date.now()}`,
                ),
              );
            } catch (e) {
              report(String(e));
            }
          })}
        </View>
      ))}
      {draft.segments.length > limit &&
        button("更多句段", () => setLimit((v) => v + 20))}
      {button(pending ? "保存中…" : "保存句段", () => {
        try {
          const valid = validateResource(draft);
          setPending(true);
          void onSave(valid)
            .catch((e) => report(e.message))
            .finally(() => setPending(false));
        } catch (e) {
          report(String(e));
        }
      })}
    </View>
  );
}
