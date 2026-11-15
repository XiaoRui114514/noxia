import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  StyleSheet,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Audio, { AudioPlan, AudioStatus } from "../../modules/noxia-audio";
import { Resource, Template } from "../core";
import { Library } from "../services/storage";
import { AppColors } from "./theme";
import { PageUI } from "./pageUI";
export function PlayerPage({
  active,
  resources,
  status,
  plan,
  wide,
  colors: c,
  selected,
  setSelected,
  rate,
  setRate,
  loop,
  setLoop,
  sleep,
  setSleep,
  stopAt,
  setStopAt,
  allTemplates,
  template,
  setTemplateId,
  repeatCount,
  setRepeatCount,
  shuffle,
  setShuffle,
  queue,
  setQueue,
  ui,
  actions,
  reduceMotion,
}: {
  active: Resource;
  resources: Resource[];
  status: AudioStatus;
  plan: AudioPlan | null;
  wide: boolean;
  colors: AppColors;
  selected: string[] | undefined;
  setSelected: React.Dispatch<React.SetStateAction<string[] | undefined>>;
  rate: number;
  setRate: (v: number) => void;
  loop: boolean;
  setLoop: (v: boolean) => void;
  sleep: number;
  setSleep: (v: number) => void;
  stopAt: number | null;
  setStopAt: (v: number | null) => void;
  allTemplates: Template[];
  template: Template;
  setTemplateId: (v: string) => void;
  repeatCount: number;
  setRepeatCount: (v: number) => void;
  shuffle: boolean;
  setShuffle: (v: boolean) => void;
  queue: string[];
  setQueue: React.Dispatch<React.SetStateAction<string[]>>;
  ui: PageUI;
  reduceMotion: boolean;
  actions: {
    toggle: () => void;
    nextSentence: (delta: number, paragraph?: boolean) => void;
    start: () => Promise<void>;
    startList: (
      ids: string[],
      options?: Library["playlists"][number]["options"],
    ) => Promise<void>;
    edit: (r: Resource) => void;
    setNotice: (v: string) => void;
  };
}) {
  const { button, input, section, small } = ui;
  const { toggle, nextSentence, start, startList, edit, setNotice } = actions;
  const [showTranscript, setShowTranscript] = useState(true),
    [follow, setFollow] = useState(true),
    [advanced, setAdvanced] = useState(false),
    [readingLimit, setReadingLimit] = useState(30);
  const transcriptRef = useRef<React.ComponentRef<typeof ScrollView>>(null),
    transcriptOffsets = useRef<Record<string, number>>({}),
    progressWidth = useRef(1);
  const clock = (seconds: number) =>
    `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
  const currentSegment = plan?.steps[status.stepIndex]?.segmentId;
  useEffect(() => {
    if (currentSegment) {
      const index = active.segments.findIndex((s) => s.id === currentSegment);
      if (index >= readingLimit) setReadingLimit(index + 20);
    }
    if (
      currentSegment &&
      showTranscript &&
      follow &&
      transcriptOffsets.current[currentSegment] !== undefined
    )
      transcriptRef.current?.scrollTo({
        y: Math.max(0, (transcriptOffsets.current[currentSegment] ?? 0) - 12),
        animated: !reduceMotion,
      });
  }, [currentSegment, showTranscript, follow, readingLimit]);
  function content() {
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
                  padding: wide ? 22 : 12,
                  backgroundColor: c.cover,
                  aspectRatio: 1,
                  width: "100%",
                  maxWidth: wide ? 260 : 160,
                  alignSelf: "center",
                },
              ]}
            >
              <View
                style={[
                  styles.coverRule,
                  { borderColor: c.accent, padding: wide ? 20 : 10 },
                ]}
              >
                <Text
                  style={{ fontSize: 12, letterSpacing: 5, color: c.accent }}
                >
                  noxia
                </Text>
                <Text
                  numberOfLines={4}
                  style={{
                    fontSize: wide ? 28 : 16,
                    lineHeight: wide ? 36 : 23,
                    fontWeight: "300",
                    color: c.text,
                    marginVertical: wide ? 24 : 10,
                  }}
                >
                  {active?.title}
                </Text>
                <View
                  style={{ width: 32, height: 1, backgroundColor: c.accent }}
                />
                <Text style={{ color: c.accent, marginTop: 12, fontSize: 12 }}>
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
            {!!currentSegment && (
              <Text
                accessibilityRole="status"
                style={{
                  color: c.text,
                  fontSize: 20,
                  lineHeight: 31,
                  marginTop: 18,
                }}
              >
                {active.segments.find((s) => s.id === currentSegment)?.original}
              </Text>
            )}
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
            {advanced && (
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
            )}
            {advanced && (
              <View style={styles.chips}>
                {[0, 15, 30, 45].map((n) =>
                  button(
                    n ? `${n} 分钟` : "取消定时",
                    () => {
                      setStopAt(null);
                      setSleep(n);
                      Audio.setSleepTimer(n * 60, 10);
                    },
                    !stopAt && sleep === n,
                  ),
                )}
              </View>
            )}
            {advanced &&
              small(
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
            {button(follow ? "暂停跟随" : "自动跟随", () => setFollow(!follow))}
            {small(
              selected === undefined
                ? "全文播放；点选后应用编排。"
                : selected.length
                  ? `已选 ${selected.length} 句`
                  : "筛选为空，请重新选择。",
            )}
            {showTranscript && (
              <ScrollView
                ref={transcriptRef}
                nestedScrollEnabled
                onScrollBeginDrag={() => setFollow(false)}
                onTouchStart={() => setFollow(false)}
                style={{ maxHeight: wide ? 520 : 420 }}
              >
                {active?.segments.slice(0, readingLimit).map((s, i) => (
                  <Pressable
                    key={s.id}
                    onLayout={(e) => {
                      transcriptOffsets.current[s.id] = e.nativeEvent.layout.y;
                      if (s.id === currentSegment && follow)
                        transcriptRef.current?.scrollTo({
                          y: Math.max(0, e.nativeEvent.layout.y - 12),
                          animated: !reduceMotion,
                        });
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: (selected ?? []).includes(s.id),
                    }}
                    aria-checked={(selected ?? []).includes(s.id)}
                    onPress={() =>
                      setSelected((v) =>
                        (v ?? []).includes(s.id)
                          ? (v ?? []).filter((x) => x !== s.id)
                          : [...(v ?? []), s.id],
                      )
                    }
                    style={[
                      styles.transcript,
                      {
                        borderLeftColor:
                          currentSegment === s.id ? c.accent : "transparent",
                        backgroundColor: (selected ?? []).includes(s.id)
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
                      {(selected ?? []).includes(s.id) ? " · 已选" : ""}
                    </Text>
                    <Text
                      style={{
                        color: c.text,
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
                {active.segments.length > readingLimit &&
                  button("更多原文", () => setReadingLimit((v) => v + 30))}
              </ScrollView>
            )}
            <View style={styles.chips}>
              {button("只选重点", () => {
                const ids = active.segments
                  .filter((s) => s.important)
                  .map((s) => s.id);
                setSelected(ids);
                if (!ids.length) setNotice("没有重点句，请先在文稿中标记");
              })}
              {button("清除选择", () => setSelected(undefined))}
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
            {button(advanced ? "收起播放设置" : "播放设置", () =>
              setAdvanced(!advanced),
            )}
            {advanced && (
              <>
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
              </>
            )}
          </View>
        </View>
      </>
    );
  }
  return content();
}
const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, letterSpacing: 0.2, fontWeight: "500" },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  },
  playerColumns: { gap: 0 },
  cover: { borderRadius: 9, padding: 20, overflow: "hidden" },
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginVertical: 12,
    alignItems: "center",
  },
  transcript: {
    marginTop: 13,
    paddingVertical: 18,
    paddingLeft: 19,
    paddingRight: 12,
    borderLeftWidth: 3,
    borderRadius: 3,
  },
});
