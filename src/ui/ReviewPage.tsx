import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Library, saveLibrary } from "../services/storage";
import { assessReview, dueReviews } from "../core/review";
import { ModelSettingsColors } from "./ModelSettings";
export function ReviewPage({
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
  const [answer, setAnswer] = useState(db.reviewSession?.answer ?? ""),
    [score, setScore] = useState<0 | 1 | 2 | undefined>(
      db.reviewSession?.score,
    ),
    [submitted, setSubmitted] = useState(db.reviewSession?.submitted ?? false),
    [saving, setSaving] = useState(false);
  const saved = db.reviewSession,
    resource = db.resources.find((r) => r.id === saved?.resourceId),
    segment = resource?.segments.find((s) => s.id === saved?.segmentId);
  const due = dueReviews(db),
    weak = (db.reviews ?? []).filter((r) => r.score < 2),
    today = (db.reviews ?? []).filter(
      (r) => new Date(r.date).toDateString() === new Date().toDateString(),
    );
  const button = (label: string, fn: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      disabled={disabled || saving}
      accessibilityState={{ disabled: disabled || saving }}
      onPress={fn}
      style={{
        padding: 12,
        minHeight: 44,
        borderRadius: 8,
        backgroundColor: c.soft,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  function open(resourceId: string, segmentId: string) {
    const value = {
      ...db,
      reviewSession: { resourceId, segmentId, revealed: false },
    };
    onChange(value);
    setAnswer("");
    setScore(undefined);
    setSubmitted(false);
  }
  return (
    <View style={{ gap: 18, maxWidth: 760, width: "100%" }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 32, color: c.text, fontWeight: "600" }}
      >
        每日复习
      </Text>
      <Text style={{ color: c.muted, lineHeight: 24 }}>
        今日自评 {today.length} 句 · 到期 {due.length} 句 · 薄弱 {weak.length}{" "}
        句
      </Text>
      {!segment && (
        <>
          <Text style={{ color: c.muted }}>
            选择一句，先回想，再核对与自评。
          </Text>
          {button(
            "开始到期复习",
            () => open(due[0].resourceId, due[0].segmentId),
            !due.length,
          )}
          {db.resources.map((r) => (
            <View key={r.id} style={{ gap: 10 }}>
              <Text style={{ color: c.text }}>{r.title}</Text>
              {button(`练习 ${r.title}`, () => open(r.id, r.segments[0].id))}
            </View>
          ))}
        </>
      )}
      {segment && resource && (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 22 }}
          >
            {resource.title} · 第 {resource.segments.indexOf(segment) + 1} 句
          </Text>
          <Text style={{ color: c.muted }}>
            回想原文，可写下答案或在心中回答。提交的是自评结果。
          </Text>
          <TextInput
            accessibilityLabel="我的回答"
            multiline
            value={answer}
            onChangeText={(v) => {
              setAnswer(v);
              onChange({
                ...db,
                reviewSession: { ...db.reviewSession!, answer: v },
              });
            }}
            editable={!saved?.revealed}
            placeholder="写下回想内容（可选）"
            placeholderTextColor={c.muted}
            style={{
              padding: 16,
              minHeight: 130,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: c.line,
              color: c.text,
              fontSize: 18,
              lineHeight: 28,
            }}
          />
          {!saved?.revealed &&
            button("揭晓原文", () =>
              onChange({
                ...db,
                reviewSession: {
                  resourceId: resource.id,
                  segmentId: segment.id,
                  revealed: true,
                  answer,
                },
              }),
            )}
          {saved?.revealed && (
            <>
              <Text
                selectable
                style={{ color: c.text, fontSize: 23, lineHeight: 36 }}
              >
                {segment.original}
              </Text>
              {!!segment.translation && (
                <Text style={{ color: c.muted, lineHeight: 27 }}>
                  {segment.translation}
                </Text>
              )}
              {!!segment.explanation && (
                <Text style={{ color: c.text, lineHeight: 27 }}>
                  解析 · {segment.explanation}
                </Text>
              )}
              {!segment.explanation && (
                <Text style={{ color: c.muted }}>
                  暂无解析；请对照原资料核对。
                </Text>
              )}
              <Text style={{ color: c.muted }}>自评，不自动判定正误</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {([0, 1, 2] as const).map((n) =>
                  button(
                    `${score === n ? "✓ " : ""}${["未记住", "不熟", "熟悉"][n]}`,
                    () => setScore(n),
                    submitted,
                  ),
                )}
              </View>
              {!submitted &&
                button(
                  "提交自评",
                  () => {
                    if (score === undefined) return;
                    const record = assessReview(
                      db.reviews?.find(
                        (r) =>
                          r.resourceId === resource.id &&
                          r.segmentId === segment.id,
                      ),
                      resource.id,
                      segment.id,
                      score,
                    );
                    const value = {
                      ...db,
                      reviewSession: {
                        ...db.reviewSession!,
                        score,
                        submitted: true,
                      },
                      reviews: [
                        record,
                        ...(db.reviews ?? []).filter(
                          (r) =>
                            !(
                              r.resourceId === resource.id &&
                              r.segmentId === segment.id
                            ),
                        ),
                      ],
                    };
                    setSaving(true);
                    onChange(value);
                    void saveLibrary(value)
                      .then(() => {
                        setSubmitted(true);
                        report(
                          score < 2
                            ? "已记录薄弱句及复习时间"
                            : "已记录自评及下次复习",
                        );
                      })
                      .catch((e) => report(e.message))
                      .finally(() => setSaving(false));
                  },
                  score === undefined,
                )}
              {submitted && (
                <Text accessibilityRole="status" style={{ color: c.text }}>
                  已提交 · {score === 2 ? "熟悉" : "待复习"} · {today.length}{" "}
                  句已评
                </Text>
              )}
              {button(
                "下一题",
                () => {
                  const next =
                    resource.segments[resource.segments.indexOf(segment) + 1];
                  if (next) open(resource.id, next.id);
                  else {
                    onChange({ ...db, reviewSession: undefined });
                    setSubmitted(false);
                    report("本篇已完成自评");
                  }
                },
                !submitted,
              )}
            </>
          )}
          {button("返回复习列表", () =>
            onChange({ ...db, reviewSession: undefined }),
          )}
        </>
      )}
      {!!weak.length && (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 23 }}
          >
            薄弱句
          </Text>
          {weak.slice(0, 30).map((r) => {
            const x = db.resources.find((x) => x.id === r.resourceId),
              s = x?.segments.find((s) => s.id === r.segmentId);
            return (
              s && (
                <View key={r.resourceId + r.segmentId} style={{ gap: 8 }}>
                  <Text style={{ color: c.text, lineHeight: 25 }}>
                    {s.original}
                  </Text>
                  {button("复习此句", () => open(r.resourceId, r.segmentId))}
                </View>
              )
            );
          })}
        </>
      )}
    </View>
  );
}
