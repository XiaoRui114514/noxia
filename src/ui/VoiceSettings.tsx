import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Voice } from "../../modules/noxia-audio";
import {
  filterSystemVoices,
  TTS_SERVICE_NOTICE,
  type TTSConsent,
  type TTSSettings,
  type VoiceGender,
} from "../services/tts";
import type { VoiceConnection } from "../services/useVoiceConnection";
import type { AppColors } from "./theme";

export type VoiceSettingsProps = {
  connection: VoiceConnection;
  voices: Voice[];
  colors: AppColors;
  primaryVoice: string;
  translationVoice: string;
  onSelectVoice: (id: string, target: "original" | "translation") => void;
  onRefresh: () => void;
  onPreviewSystem: (voice: Voice) => void;
  onPreviewExternal: (settings: TTSSettings, consent: TTSConsent) => void;
  dictionaryState: string;
  onSaveDictionary: () => void;
  dictionary: string;
  onDictionaryChange: (value: string) => void;
};

const qualityLabels: Record<string, string> = {
  premium: "高级",
  enhanced: "增强",
  default: "标准",
  "system-local": "本地",
  "browser-network": "在线",
};
const qualityLabel = (value: string) => qualityLabels[value] ?? "系统";

/** A real voice picker. All external operations remain explicit and separate from text AI settings. */
export function VoiceSettings({
  connection,
  voices,
  colors: c,
  primaryVoice,
  translationVoice,
  onSelectVoice,
  onRefresh,
  onPreviewSystem,
  onPreviewExternal,
  dictionaryState,
  onSaveDictionary,
  dictionary,
  onDictionaryChange,
}: VoiceSettingsProps) {
  const [target, setTarget] = useState<"original" | "translation">("original");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("zh");
  const [quality, setQuality] = useState("all");
  const [gender, setGender] = useState<VoiceGender | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [externalQuery, setExternalQuery] = useState("");
  const filtered = useMemo(
    () => filterSystemVoices(voices, { query, language, quality, gender }),
    [voices, query, language, quality, gender],
  );
  const qualities = [...new Set(voices.map((voice) => voice.quality))];
  const selected = target === "original" ? primaryVoice : translationVoice;
  const externalFiltered = connection.externalVoices.filter((voice) =>
    `${voice.name} ${voice.language} ${voice.id}`
      .toLocaleLowerCase()
      .includes(externalQuery.trim().toLocaleLowerCase()),
  );
  const config = connection.settings;
  const canExternal =
    connection.ready &&
    connection.keyReady &&
    !!connection.consent &&
    !!config.voice.trim();
  const labelStyle = [styles.label, { color: c.text }];
  const helpStyle = [styles.help, { color: c.muted }];

  function button(
    label: string,
    action: () => void,
    options: {
      selected?: boolean;
      disabled?: boolean;
      small?: boolean;
      accessibilityLabel?: string;
    } = {},
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={options.accessibilityLabel ?? label}
        accessibilityState={{
          selected: options.selected,
          disabled: options.disabled,
        }}
        disabled={options.disabled}
        onPress={action}
        style={({ pressed }) => [
          styles.button,
          options.small && styles.smallButton,
          {
            borderColor: options.selected ? c.text : c.line,
            backgroundColor: options.selected ? c.soft : c.surface,
            opacity: options.disabled ? 0.4 : pressed ? 0.6 : 1,
          },
        ]}
      >
        <Text style={{ color: c.text, fontSize: 15 }}>{label}</Text>
      </Pressable>
    );
  }
  function input(
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    options: {
      placeholder?: string;
      secure?: boolean;
      editable?: boolean;
      multiline?: boolean;
      accessibilityLabel?: string;
    } = {},
  ) {
    return (
      <View style={styles.field}>
        <Text style={labelStyle}>{label}</Text>
        <TextInput
          accessibilityLabel={options.accessibilityLabel ?? label}
          value={value}
          onChangeText={onChangeText}
          placeholder={options.placeholder}
          placeholderTextColor={c.muted}
          secureTextEntry={options.secure}
          editable={options.editable !== false}
          multiline={options.multiline}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            options.multiline && styles.multiline,
            {
              color: c.text,
              backgroundColor: c.surface,
              borderColor: c.line,
              opacity: options.editable === false ? 0.5 : 1,
            },
          ]}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.sectionHeader}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.text }]}
        >
          声音
        </Text>
        {button("刷新", onRefresh, { accessibilityLabel: "刷新设备声音" })}
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.subtitle, { color: c.text }]}
      >
        系统
      </Text>
      <Text style={helpStyle}>
        系统声音无额外费用，可在iPad辅助功能的语音设置中下载更多音色。
      </Text>
      <View style={styles.actions}>
        {button("原文", () => setTarget("original"), {
          accessibilityLabel: "为原文选择",
          selected: target === "original",
        })}
        {button("译文", () => setTarget("translation"), {
          accessibilityLabel: "为译文选择",
          selected: target === "translation",
        })}
        {button("自动", () => onSelectVoice("", target), {
          accessibilityLabel: "使用系统自动声音",
          selected: !selected,
        })}
      </View>
      {input("搜索", query, setQuery, {
        placeholder: "名称或语言",
        accessibilityLabel: "搜索设备声音",
      })}
      <Text style={labelStyle}>语言</Text>
      <View style={styles.actions}>
        {[
          ["zh", "中文"],
          ["en", "英语"],
          ["all", "全部"],
        ].map(([id, label]) => (
          <React.Fragment key={id}>
            {button(label, () => setLanguage(id), {
              selected: language === id,
            })}
          </React.Fragment>
        ))}
      </View>
      <Text style={labelStyle}>音质</Text>
      <View style={styles.actions}>
        {button("全部", () => setQuality("all"), {
          accessibilityLabel: "全部音质",
          selected: quality === "all",
        })}
        {qualities.map((id) => (
          <React.Fragment key={id}>
            {button(qualityLabel(id), () => setQuality(id), {
              selected: quality === id,
            })}
          </React.Fragment>
        ))}
      </View>
      <Text style={labelStyle}>性别</Text>
      <View style={styles.actions}>
        {button("不限", () => setGender(undefined), {
          selected: gender === undefined,
        })}
        {button("女声", () => setGender("female"), {
          selected: gender === "female",
        })}
        {button("男声", () => setGender("male"), {
          selected: gender === "male",
        })}
        {button("未知", () => setGender("unknown"), {
          accessibilityLabel: "系统未提供声音性别",
          selected: gender === "unknown",
        })}
      </View>
      <Text accessibilityLiveRegion="polite" style={helpStyle}>
        {filtered.length}个声音；性别依系统信息显示。
      </Text>
      {!voices.length && (
        <Text style={helpStyle}>
          尚无声音，请刷新。浏览器目录不代表iPad已安装音色。
        </Text>
      )}
      {!!voices.length && !filtered.length && (
        <Text style={helpStyle}>无匹配声音，请调整筛选。</Text>
      )}
      <View>
        {filtered.slice(0, 100).map((voice) => (
          <View
            key={voice.id}
            style={[styles.voiceRow, { borderBottomColor: c.line }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`将${voice.name}用于${target === "original" ? "原文" : "译文"}`}
              accessibilityState={{ selected: selected === voice.id }}
              onPress={() => onSelectVoice(voice.id, target)}
              style={({ pressed }) => [
                styles.voiceMain,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.voiceName, { color: c.text }]}>
                {voice.name}
                {selected === voice.id ? " · 已选" : ""}
              </Text>
              <Text style={helpStyle}>
                {voice.language} · {qualityLabel(voice.quality)}
              </Text>
            </Pressable>
            {button("试听", () => onPreviewSystem(voice), { small: true })}
          </View>
        ))}
      </View>
      {filtered.length > 100 && (
        <Text style={helpStyle}>显示前100个结果，可搜索筛选。</Text>
      )}

      <View style={[styles.divider, { borderTopColor: c.line }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="额外语音服务设置"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={styles.expand}
        >
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              style={[styles.subtitle, { color: c.text }]}
            >
              接口
            </Text>
            <Text style={helpStyle}>可选 · 自有密钥或授权服务</Text>
          </View>
          <Text style={[styles.chevron, { color: c.text }]}>
            {expanded ? "−" : "+"}
          </Text>
        </Pressable>
        {expanded && (
          <View style={styles.external}>
            <Text style={helpStyle}>{TTS_SERVICE_NOTICE}</Text>
            <Text style={helpStyle}>
              支持OpenAI兼容语音服务和自托管Kokoro。密钥与讲稿接口分开保存；模型开源不代表算力免费。
            </Text>
            {input(
              "接口",
              config.base,
              (base) => connection.setConfig({ base }),
              {
                placeholder: "https://your-voice-service.example/v1",
                accessibilityLabel: "语音接口地址",
                editable: connection.ready,
              },
            )}
            {input("密钥（可选）", config.key, connection.setKey, {
              secure: true,
              accessibilityLabel: "此语音接口的 API Key · 可选",
              editable:
                connection.ready && connection.keyReady && !!config.base.trim(),
              placeholder: connection.keyReady
                ? "无需鉴权时可留空"
                : "读取接口密钥…",
            })}
            {input(
              "模型",
              config.model,
              (model) => connection.setConfig({ model }),
              {
                placeholder: "服务提供的模型ID",
                accessibilityLabel: "语音模型",
                editable: connection.ready,
              },
            )}
            <View style={styles.actions}>
              {button("刷新", () => void connection.refreshVoices(), {
                accessibilityLabel: "读取服务声音",
                disabled:
                  !connection.ready ||
                  !connection.keyReady ||
                  !config.base.trim() ||
                  connection.listStatus === "loading",
              })}
              {connection.listStatus === "loading" && (
                <ActivityIndicator color={c.text} />
              )}
            </View>
            <Text style={helpStyle}>
              填入地址后自动读取音色，不发送学习文字；目录不可用时可手动填写声音ID。
            </Text>
            {connection.voicesSupported === false && (
              <Text accessibilityLiveRegion="polite" style={helpStyle}>
                目录不可用，请按服务文档填写声音ID。
              </Text>
            )}
            {connection.listError ? (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.danger }]}
              >
                {connection.listError}
              </Text>
            ) : null}
            {!!connection.externalVoices.length && (
              <>
                {input("搜索", externalQuery, setExternalQuery, {
                  placeholder: "名称或语言",
                  accessibilityLabel: "搜索服务声音",
                })}
                <Text style={helpStyle}>
                  共{connection.externalVoices.length}个，匹配
                  {externalFiltered.length}个。
                </Text>
                {externalFiltered.slice(0, 100).map((voice) => (
                  <View
                    key={voice.id}
                    style={[styles.voiceRow, { borderBottomColor: c.line }]}
                  >
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.voiceName, { color: c.text }]}>
                        {voice.name}
                      </Text>
                      {voice.language ? (
                        <Text style={helpStyle}>{voice.language}</Text>
                      ) : null}
                    </View>
                    {button(
                      config.voice === voice.id ? "已选" : "选择",
                      () => connection.setConfig({ voice: voice.id }),
                      {
                        selected: config.voice === voice.id,
                        accessibilityLabel:
                          config.voice === voice.id ? "已选声音" : "选择声音",
                      },
                    )}
                  </View>
                ))}
                {externalFiltered.length > 100 && (
                  <Text style={helpStyle}>可搜索其余音色。</Text>
                )}
              </>
            )}
            {input(
              "音色",
              config.voice,
              (voice) => connection.setConfig({ voice }),
              {
                placeholder: "选择或输入声音ID",
                accessibilityLabel: "服务声音 ID",
                editable: connection.ready,
              },
            )}
            {input(
              "版本（可选）",
              config.version,
              (version) => connection.setConfig({ version }),
              {
                placeholder: "服务升级后修改以更新缓存",
                accessibilityLabel: "模型或声音版本 · 可选",
                editable: connection.ready,
              },
            )}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="同意将朗读文字发送到此语音服务并了解可能收费"
              accessibilityState={{ checked: !!connection.consent }}
              onPress={() => connection.setConsent(!connection.consent)}
              style={[
                styles.consent,
                { borderColor: c.line, backgroundColor: c.surface },
              ]}
            >
              <View
                style={[
                  styles.check,
                  {
                    borderColor: c.text,
                    backgroundColor: connection.consent ? c.text : c.surface,
                  },
                ]}
              >
                {connection.consent && (
                  <Text style={{ color: c.surface, fontSize: 16 }}>✓</Text>
                )}
              </View>
              <Text style={[styles.help, { flex: 1, color: c.text }]}>
                此服务会收到朗读文字，并可能收费。我有权使用所选声音；更改地址或模型后需重新确认。
              </Text>
            </Pressable>
            <View style={styles.actions}>
              {button(
                "试听",
                () => {
                  if (connection.consent)
                    onPreviewExternal(config, connection.consent);
                },
                { disabled: !canExternal, accessibilityLabel: "试听服务声音" },
              )}
              {button(
                "原文",
                () => onSelectVoice(`remote:${config.voice}`, "original"),
                {
                  disabled: !canExternal,
                  accessibilityLabel: "用于原文",
                  selected:
                    canExternal && primaryVoice === `remote:${config.voice}`,
                },
              )}
              {button(
                "译文",
                () => onSelectVoice(`remote:${config.voice}`, "translation"),
                {
                  disabled: !canExternal,
                  accessibilityLabel: "用于译文",
                  selected:
                    canExternal &&
                    translationVoice === `remote:${config.voice}`,
                },
              )}
              {button("保存", () => void connection.save(), {
                accessibilityLabel: "保存语音设置",
                disabled:
                  !connection.ready ||
                  !connection.keyReady ||
                  connection.saveState === "saving",
              })}
            </View>
            {connection.saveState === "saved" && (
              <Text accessibilityLiveRegion="polite" style={helpStyle}>
                {Platform.OS === "web"
                  ? "设置已保存；密钥仅存于本次浏览器会话。"
                  : "设置已保存；密钥使用设备安全存储，不参与云同步。"}
              </Text>
            )}
            {!!connection.error && (
              <Text
                accessibilityRole="alert"
                style={[styles.help, { color: c.danger }]}
              >
                {connection.error}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={[styles.divider, { borderTopColor: c.line }]}>
        <Text
          accessibilityRole="header"
          style={[styles.subtitle, { color: c.text }]}
        >
          读音
        </Text>
        <Text style={helpStyle}>
          每行“原词=朗读文字”，只影响朗读，不改原文；接口音色的读音由服务决定。
        </Text>
        <Text style={{ color: c.muted }}>
          {dictionaryState || "每行 原词=读音；保存后生效"}
        </Text>
        {button("保存词典", onSaveDictionary)}
        {input("词典", dictionary, onDictionaryChange, {
          multiline: true,
          placeholder: "原词=朗读文字",
          accessibilityLabel: "发音词典",
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16, width: "100%" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  },
  title: { fontSize: 30, fontWeight: "500" },
  subtitle: { fontSize: 21, fontWeight: "500" },
  label: { fontSize: 15, fontWeight: "500" },
  help: { fontSize: 14, lineHeight: 21 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
  smallButton: { paddingHorizontal: 16 },
  field: { gap: 8 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  voiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  voiceMain: {
    flex: 1,
    gap: 4,
    minHeight: 52,
    justifyContent: "center",
    paddingVertical: 8,
  },
  voiceName: { fontSize: 17 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 20,
    gap: 16,
    marginTop: 8,
  },
  expand: {
    flexDirection: "row",
    gap: 16,
    minHeight: 56,
    alignItems: "center",
    paddingVertical: 8,
  },
  chevron: { fontSize: 28 },
  external: { gap: 16 },
  consent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  check: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
});
