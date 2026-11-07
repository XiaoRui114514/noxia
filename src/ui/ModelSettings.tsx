import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  canonicalModelBase,
  ModelConnectionManager,
} from "../services/modelConnection";

export type ModelConnectionProps = {
  base: string;
  selectedModel: string;
  apiKey: string;
  onBaseChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  /** Disables automatic GET only; endpoint key hydration always occurs. */
  enabled: boolean;
};
export function useModelConnection(props: ModelConnectionProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const [manager] = useState(
    () =>
      new ModelConnectionManager({
        onBaseChange: (value) => callbacks.current.onBaseChange(value),
        onModelChange: (value) => callbacks.current.onModelChange(value),
        onKeyChange: (value) => callbacks.current.onKeyChange(value),
      }),
  );
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
  // Callback identities intentionally live in a ref, avoiding fetch loops from inline parent callbacks.
  useEffect(() => {
    manager.updateBase(props.base, callbacks.current.selectedModel);
  }, [manager, props.base]);
  useEffect(() => {
    manager.syncExternalKey(props.apiKey);
  }, [manager, props.apiKey, props.base]);
  useEffect(() => {
    manager.syncSelectedModel(props.selectedModel);
  }, [manager, props.selectedModel]);
  useEffect(() => {
    manager.setEnabled(props.enabled);
  }, [manager, props.enabled]);
  useEffect(() => () => manager.dispose(), [manager]);
  const current = snapshot.base === canonicalModelBase(props.base);
  const settings = current ? manager.settings : null;
  return {
    ...snapshot,
    base: props.base,
    apiKey: current ? snapshot.apiKey : "",
    hydrated: current && snapshot.hydrated,
    settings,
    canGenerate: settings !== null,
    setBase: manager.changeBase,
    setKey: manager.setKey,
    selectModel: manager.selectModel,
    retry: manager.retry,
    saveKey: manager.saveKey,
  };
}
export type ModelConnection = ReturnType<typeof useModelConnection>;
export type ModelSettingsColors = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  danger: string;
  soft: string;
};
export function ModelSettings({
  connection,
  colors: c,
}: {
  connection: ModelConnection;
  colors: ModelSettingsColors;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (connection.status !== "ready") setOpen(false);
  }, [connection.status, connection.base]);
  const loading = ["hydrating", "debouncing", "loading"].includes(
    connection.status,
  );
  const ready = connection.status === "ready" && connection.models.length > 0;
  const label = {
    idle: "等待填写接口",
    hydrating: "读取设置…",
    debouncing: "等待输入…",
    loading: "读取模型…",
    ready: `${connection.models.length} 个模型`,
    error: connection.error,
  }[connection.status];
  const filtered = connection.models.filter((id) =>
    id.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  function action(
    text: string,
    onPress: () => void,
    disabled = false,
    accessibilityLabel = text,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            borderColor: c.line,
            backgroundColor: c.surface,
            opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
          },
        ]}
      >
        <Text style={[styles.buttonText, { color: c.text }]}>{text}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.root}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: c.text }]}
      >
        模型
      </Text>
      <Text style={[styles.help, { color: c.muted }]}>
        OpenAI兼容协议，填入地址后自动读取模型。
      </Text>
      <Text style={[styles.label, { color: c.text }]}>接口</Text>
      <TextInput
        accessibilityLabel="兼容协议 HTTPS v1 地址"
        value={connection.base}
        onChangeText={connection.setBase}
        placeholder="https://your-provider.example/v1"
        placeholderTextColor={c.muted}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="URL"
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.line },
        ]}
      />
      <Text style={[styles.label, { color: c.text }]}>密钥（可选）</Text>
      <TextInput
        accessibilityLabel="此接口的 API Key（可选）"
        value={connection.apiKey}
        onChangeText={connection.setKey}
        editable={connection.hydrated}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={
          connection.hydrated ? "服务无需鉴权时可留空" : "先填写有效接口地址"
        }
        placeholderTextColor={c.muted}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.line },
        ]}
      />
      <View style={styles.actions}>
        {action(
          "保存密钥",
          () => void connection.saveKey(),
          !connection.hydrated || connection.keySaveState === "saving",
          "保存此接口密钥",
        )}
        {action(
          "刷新",
          connection.retry,
          !connection.hydrated || loading,
          "重新读取模型",
        )}
      </View>
      {connection.keySaveState === "saved" && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.help, { color: c.muted }]}
        >
          {Platform.OS === "web"
            ? "密钥仅存于本次浏览器会话，关闭后清除。"
            : "密钥已存入设备安全存储，不参与云同步。"}
        </Text>
      )}
      {connection.keySaveState === "error" && (
        <Text
          accessibilityRole="alert"
          style={[styles.help, { color: c.danger }]}
        >
          密钥保存失败，请重试；当前输入仅用于此接口。
        </Text>
      )}
      <View style={styles.status}>
        {loading && <ActivityIndicator color={c.text} />}
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={
            connection.status === "error" ? "alert" : undefined
          }
          style={[
            styles.help,
            {
              flex: 1,
              color: connection.status === "error" ? c.danger : c.muted,
            },
          ]}
        >
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择模型"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => {
          setSearch("");
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.model,
          {
            backgroundColor: c.surface,
            borderColor: c.line,
            opacity: !ready ? 0.45 : pressed ? 0.65 : 1,
          },
        ]}
      >
        <Text style={[styles.label, { color: c.muted }]}>模型</Text>
        <Text style={[styles.modelName, { color: c.text }]}>
          {ready && connection.models.includes(connection.selectedModel)
            ? connection.selectedModel
            : "选择模型"}
        </Text>
        <Text style={[styles.help, { color: c.muted }]}>选择模型 ›</Text>
      </Pressable>
      <Text style={[styles.help, { color: c.muted }]}>
        仅读取模型列表，不发送讲稿或调用生成；结果缓存5分钟，切换接口后单独读取密钥。
      </Text>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={[styles.sheet, { backgroundColor: c.bg }]}>
            <View style={styles.sheetHeader}>
              <Text
                accessibilityRole="header"
                style={[styles.heading, { flex: 1, color: c.text }]}
              >
                选择模型
              </Text>
              {action("关闭", () => setOpen(false), false, "关闭模型选择")}
            </View>
            <TextInput
              accessibilityLabel="搜索接口返回的模型"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="搜索模型"
              placeholderTextColor={c.muted}
              style={[
                styles.input,
                {
                  color: c.text,
                  borderColor: c.line,
                  backgroundColor: c.surface,
                },
              ]}
            />
            <FlatList
              data={filtered}
              keyExtractor={(id) => id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={
                <Text
                  style={[styles.help, { color: c.muted, paddingVertical: 20 }]}
                >
                  无匹配模型
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`选择模型 ${item}`}
                  accessibilityState={{
                    selected: connection.selectedModel === item,
                  }}
                  onPress={() => {
                    connection.selectModel(item);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.modelRow,
                    { borderBottomColor: c.line, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.modelName, { color: c.text, flex: 1 }]}>
                    {item}
                  </Text>
                  {connection.selectedModel === item && (
                    <Text
                      accessibilityLabel="已选择"
                      style={{ color: c.text, fontSize: 20 }}
                    >
                      ✓
                    </Text>
                  )}
                </Pressable>
              )}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 10, width: "100%", marginVertical: 8 },
  heading: { fontSize: 22, fontWeight: "600" },
  label: { fontSize: 15, lineHeight: 22 },
  help: { fontSize: 14, lineHeight: 22 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: {
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
  },
  buttonText: { fontSize: 15, fontWeight: "600" },
  status: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    minHeight: 36,
  },
  model: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 16,
    minHeight: 88,
    gap: 5,
  },
  modelName: { fontSize: 17, lineHeight: 25 },
  sheet: {
    flex: 1,
    padding: 20,
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
    gap: 16,
  },
  sheetHeader: { flexDirection: "row", gap: 12, alignItems: "center" },
  modelRow: {
    minHeight: 56,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
});
