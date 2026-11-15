import React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
export type PageUI = {
  button: (
    label: string,
    onPress: () => void,
    primary?: boolean,
    icon?: React.ComponentProps<typeof Ionicons>["name"],
    disabled?: boolean,
  ) => React.ReactNode;
  input: (
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    multiline?: boolean,
    secure?: boolean,
    editable?: boolean,
  ) => React.ReactNode;
  heading: (title: string, sub?: string) => React.ReactNode;
  section: (title: string) => React.ReactNode;
  small: (text: string) => React.ReactNode;
};
