import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  Template,
  Step,
  parseTemplate,
  exportTemplate,
  makeStep,
} from "../core";
import { Library, uid } from "../services/storage";
import { PageUI } from "./pageUI";
import { ModelSettingsColors } from "./ModelSettings";
export function TemplatePage({
  db,
  allTemplates,
  templateDraft,
  setTemplateDraft,
  templateJSON,
  setTemplateJSON,
  setTemplateId,
  update,
  setNotice,
  message,
  ui,
  colors: c,
}: {
  db: Library;
  allTemplates: Template[];
  templateDraft: Template | null;
  setTemplateDraft: React.Dispatch<React.SetStateAction<Template | null>>;
  templateJSON: string;
  setTemplateJSON: (text: string) => void;
  setTemplateId: (id: string) => void;
  update: (fn: (v: Library) => Library) => Library;
  setNotice: (text: string) => void;
  message: (e: unknown) => void;
  ui: PageUI;
  colors: ModelSettingsColors;
}) {
  const { button, input, heading, section, small } = ui;
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
  function content() {
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
                  {!s.kind.startsWith("next") && (
                    <View style={{ width: 100 }}>
                      {small("重复次数")}
                      {input(
                        String(s.repeat),
                        (v) => patchStep(i, { repeat: Number(v) }),
                        "次数",
                      )}
                    </View>
                  )}
                  {![
                    "pause",
                    "recall",
                    "nextSentence",
                    "nextParagraph",
                  ].includes(s.kind) && (
                    <View style={{ width: 110 }}>
                      {small("语速倍率")}
                      {input(
                        String(s.rate),
                        (v) => patchStep(i, { rate: Number(v) }),
                        "语速",
                      )}
                    </View>
                  )}
                  {![
                    "pause",
                    "recall",
                    "nextSentence",
                    "nextParagraph",
                  ].includes(s.kind) && (
                    <View style={{ width: 110 }}>
                      {small("音量 0—1")}
                      {input(
                        String(s.volume),
                        (v) => patchStep(i, { volume: Number(v) }),
                        "音量",
                      )}
                    </View>
                  )}
                  {["pause", "recall"].includes(s.kind) && (
                    <View style={{ width: 130 }}>
                      {small("停顿／留白毫秒")}
                      {input(
                        String(s.durationMs),
                        (v) => patchStep(i, { durationMs: Number(v) }),
                        "时长",
                      )}
                    </View>
                  )}
                </View>
                {s.kind === "custom" &&
                  input(
                    s.text ?? "",
                    (text) => patchStep(i, { text }),
                    "自定义朗读文字",
                  )}
                {!["pause", "recall", "nextSentence", "nextParagraph"].includes(
                  s.kind,
                ) &&
                  input(
                    s.voiceId ?? "",
                    (voiceId) =>
                      patchStep(i, { voiceId: voiceId || undefined }),
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
  return content();
}
const styles = StyleSheet.create({
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
  step: { borderWidth: 1, borderRadius: 10, padding: 16, marginVertical: 8 },
});
