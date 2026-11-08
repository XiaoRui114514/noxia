import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { resourceSources } from "../resources";
import { AppColors } from "./theme";
import { Action } from "./CollectionControls";
export function ResourceConsent({
  open,
  onClose,
  onAgree,
  colors: c,
}: {
  open: boolean;
  onClose: () => void;
  onAgree: () => Promise<void>;
  colors: AppColors;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const focus = useRef<HTMLElement | null>(null),
    pendingRef = useRef(pending);
  pendingRef.current = pending;
  const close = () => {
    if (pendingRef.current) return;
    onClose();
    if (Platform.OS === "web")
      requestAnimationFrame(() => focus.current?.focus());
  };
  useEffect(() => {
    if (!open) return;
    setError("");
    if (Platform.OS !== "web") return;
    focus.current = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    globalThis.addEventListener("keydown", key);
    return () => globalThis.removeEventListener("keydown", key);
  }, [open]);
  return (
    <Modal
      accessibilityLabel="资料许可"
      visible={open}
      transparent
      animationType="none"
      onRequestClose={close}
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
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        >
          <View
            accessibilityViewIsModal
            style={{
              maxWidth: 520,
              width: "100%",
              alignSelf: "center",
              backgroundColor: c.surface,
              borderRadius: 14,
              padding: 24,
              gap: 18,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: c.text, fontSize: 25, fontWeight: "600" }}
            >
              资料许可
            </Text>
            <Text style={{ color: c.text, fontSize: 16, lineHeight: 27 }}>
              古诗文与英语资料仅供个人、非商业学习。资料保留原项目许可，不随
              Noxia 的 MIT 许可重新授权。
            </Text>
            <Text style={{ color: c.muted, lineHeight: 24 }}>
              确认后会读取公开目录，并在本机记住选择；下载资料不自动上传私人文稿。
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              <Action
                text="古诗文原许可"
                onPress={() =>
                  void Linking.openURL(
                    `https://github.com/${resourceSources.poetry.repo}/blob/${resourceSources.poetry.version}/LICENSE`,
                  )
                }
                colors={c}
              />
              <Action
                text="英语原许可"
                onPress={() =>
                  void Linking.openURL(
                    `https://github.com/${resourceSources.grammar.repo}/blob/${resourceSources.grammar.version}/LICENSE`,
                  )
                }
                colors={c}
              />
            </View>
            {!!error && (
              <Text
                accessibilityRole="alert"
                style={{ color: c.text, lineHeight: 23 }}
              >
                {error}
              </Text>
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
              <Action
                text={pending ? "保存中…" : "同意并继续"}
                primary
                disabled={pending}
                onPress={() => {
                  setPending(true);
                  setError("");
                  void onAgree()
                    .then(() => {
                      if (Platform.OS === "web")
                        requestAnimationFrame(() => focus.current?.focus());
                    })
                    .catch((e) => setError(e.message))
                    .finally(() => setPending(false));
                }}
                colors={c}
              />
              <Action
                text="取消"
                disabled={pending}
                onPress={close}
                colors={c}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
