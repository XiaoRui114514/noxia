import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { AppColors } from "./theme";
export function Action({
  text,
  label = text,
  onPress,
  colors: c,
  primary = false,
  disabled = false,
  selected,
}: {
  text: string;
  label?: string;
  onPress: () => void;
  colors: AppColors;
  primary?: boolean;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        maxWidth: "100%",
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderRadius: 8,
        backgroundColor: primary ? c.accent : c.soft,
        borderWidth: selected ? 1 : 0,
        borderColor: c.text,
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
        justifyContent: "center",
        alignItems: "center",
        alignSelf: "flex-start",
      })}
    >
      <Text
        style={{
          color: primary ? c.onAccent : c.text,
          fontSize: 15,
          fontWeight: "600",
          flexShrink: 1,
        }}
      >
        {text}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChange,
  colors: c,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  colors: AppColors;
  numeric?: boolean;
}) {
  return (
    <View
      style={
        numeric
          ? { flexGrow: 1, flexBasis: 135, maxWidth: 210, gap: 7 }
          : { width: "100%", gap: 7 }
      }
    >
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 22 }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize="none"
        style={{
          color: c.text,
          fontSize: 16,
          lineHeight: 25,
          minHeight: 48,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          backgroundColor: c.surface,
        }}
      />
    </View>
  );
}
