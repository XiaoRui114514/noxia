import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  isAccountConfigured,
  ACCOUNT_UNAVAILABLE_MESSAGE,
} from "../services/accountConfig";
import { ModelSettingsColors } from "./ModelSettings";
export function AccountPanel({
  account,
  colors: c,
  onLogin,
  onLogout,
}: {
  account: string;
  colors: ModelSettingsColors;
  onLogin: (username: string, password: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const previousFocus = useRef<HTMLElement | null>(null);
  const field = useRef<React.ComponentRef<typeof TextInput>>(null);
  const close = () => {
    setOpen(false);
    setPassword("");
    setError("");
    if (Platform.OS === "web")
      requestAnimationFrame(() => previousFocus.current?.focus());
  };
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [open]);
  const action = (label: string, run: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={run}
      style={{
        minHeight: 44,
        padding: 12,
        borderRadius: 8,
        backgroundColor: c.soft,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  const configured = isAccountConfigured() && Platform.OS !== "web";
  return (
    <View
      style={{
        padding: 20,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 12,
        gap: 12,
        marginBottom: 30,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 23, fontWeight: "600", color: c.text }}
      >
        账号登录
      </Text>
      <Text style={{ color: c.muted, lineHeight: 23 }}>
        {account
          ? `已登录 · ${account}`
          : isAccountConfigured()
            ? "未登录"
            : ACCOUNT_UNAVAILABLE_MESSAGE}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {action(account ? "账号状态" : "登录入口", () => {
          if (Platform.OS === "web")
            previousFocus.current = document.activeElement as HTMLElement;
          setOpen(true);
        })}
        {account && action("退出", onLogout)}
      </View>
      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        onShow={() => field.current?.focus()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{
            flex: 1,
            backgroundColor: "#0008",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          >
            <View
              accessibilityViewIsModal
              role="dialog"
              aria-label="账号登录"
              style={{
                width: "100%",
                maxWidth: 480,
                alignSelf: "center",
                padding: 24,
                borderRadius: 14,
                backgroundColor: c.surface,
                gap: 16,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{ fontSize: 25, fontWeight: "600", color: c.text }}
              >
                账号登录
              </Text>
              <Text style={{ color: c.muted, lineHeight: 24 }}>
                {account
                  ? `已登录 · ${account}`
                  : configured
                    ? "使用学习账号登录"
                    : isAccountConfigured()
                      ? "请在应用内登录，网页预览不发送密码。"
                      : ACCOUNT_UNAVAILABLE_MESSAGE}
              </Text>
              {configured && !account && (
                <>
                  <TextInput
                    ref={field}
                    accessibilityLabel="用户名"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoComplete="username"
                    placeholder="用户名"
                    placeholderTextColor={c.muted}
                    style={{
                      padding: 14,
                      borderWidth: 1,
                      borderColor: c.line,
                      borderRadius: 8,
                      color: c.text,
                      fontSize: 16,
                    }}
                  />
                  <TextInput
                    accessibilityLabel="密码"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="current-password"
                    placeholder="密码"
                    placeholderTextColor={c.muted}
                    style={{
                      padding: 14,
                      borderWidth: 1,
                      borderColor: c.line,
                      borderRadius: 8,
                      color: c.text,
                      fontSize: 16,
                    }}
                  />
                  {action(
                    pending ? "登录中…" : "登录",
                    () => {
                      setPending(true);
                      setError("");
                      void onLogin(username, password)
                        .then(close)
                        .catch((e) => setError(String(e.message ?? e)))
                        .finally(() => setPending(false));
                    },
                    pending,
                  )}
                </>
              )}
              {!!error && (
                <Text accessibilityRole="alert" style={{ color: c.danger }}>
                  {error}
                </Text>
              )}
              {action("关闭", close)}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
