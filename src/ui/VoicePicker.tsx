import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { Action } from "./CollectionControls";
import { AppColors } from "./theme";
export type VoiceChoice = { id: string; name: string; detail: string };
export function VoicePicker({
  label,
  value,
  onChange,
  choices,
  colors: c,
  emptyLabel = "系统自动",
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  choices: VoiceChoice[];
  colors: AppColors;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const focus = useRef<HTMLElement | null>(null),
    search = useRef<React.ComponentRef<typeof TextInput>>(null);
  const close = () => {
    setOpen(false);
    if (Platform.OS === "web")
      requestAnimationFrame(() => focus.current?.focus());
  };
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    globalThis.addEventListener("keydown", key);
    return () => globalThis.removeEventListener("keydown", key);
  }, [open]);
  const selected = choices.find((v) => v.id === value),
    all = [{ id: "", name: emptyLabel, detail: "" }, ...choices];
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 22 }}>
        {label}
      </Text>
      <Action
        label={`${label}：${value ? (selected?.name ?? "所选声音未找到") : emptyLabel}`}
        text={value ? (selected?.name ?? `${value}（未找到）`) : emptyLabel}
        onPress={() => {
          if (Platform.OS === "web")
            focus.current = document.activeElement as HTMLElement;
          setQuery("");
          setOpen(true);
        }}
        colors={c}
      />
      {!!value && !selected && (
        <Text style={{ color: c.muted, lineHeight: 23 }}>
          请前往声音页刷新目录，或重新选择。
        </Text>
      )}
      {value.startsWith("remote:") && (
        <Text style={{ color: c.muted, lineHeight: 23 }}>
          外部声音会发送朗读文字，可能产生费用。
        </Text>
      )}
      <Modal
        accessibilityLabel={`选择${label}`}
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        onShow={() => search.current?.focus()}
      >
        <KeyboardAvoidingView
          style={{
            flex: 1,
            backgroundColor: "#0008",
            padding: 20,
            justifyContent: "center",
          }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: c.surface,
              borderRadius: 14,
              padding: 20,
              width: "100%",
              maxWidth: 560,
              maxHeight: "90%",
              alignSelf: "center",
              gap: 14,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: c.text, fontSize: 23, fontWeight: "600" }}
            >
              选择{label}
            </Text>
            <TextInput
              ref={search}
              accessibilityLabel="搜索声音"
              placeholder="名称或语言"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              style={{
                color: c.text,
                padding: 12,
                minHeight: 48,
                borderWidth: 1,
                borderColor: c.line,
                borderRadius: 8,
                fontSize: 16,
              }}
            />
            <FlatList
              style={{ flexGrow: 0, maxHeight: 350 }}
              keyboardShouldPersistTaps="handled"
              data={all.filter((v) =>
                `${v.name} ${v.detail} ${v.id}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )}
              keyExtractor={(v) => v.id || "auto"}
              renderItem={({ item }) => (
                <View style={{ paddingVertical: 8, gap: 4 }}>
                  <Action
                    text={item.name}
                    label={`选择声音 ${item.name}`}
                    selected={item.id === value}
                    onPress={() => {
                      onChange(item.id);
                      close();
                    }}
                    colors={c}
                  />
                  {!!item.detail && (
                    <Text style={{ color: c.muted, lineHeight: 22 }}>
                      {item.detail}
                    </Text>
                  )}
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: c.muted }}>没有匹配声音</Text>
              }
            />
            <Action text="关闭" onPress={close} colors={c} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
