export type AppColors = {
  bg: string;
  surface: string;
  sidebar: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  soft: string;
  cover: string;
  danger: string;
};

/** Neutral surfaces keep the document and playback controls in focus. */
export const palettes: Record<"light" | "dark", AppColors> = {
  light: {
    bg: "#F5F5F5",
    surface: "#FFFFFF",
    sidebar: "#FAFAFA",
    text: "#141414",
    muted: "#686868",
    line: "#DEDEDE",
    accent: "#151515",
    onAccent: "#FFFFFF",
    soft: "#EAEAEA",
    cover: "#E3E3E3",
    danger: "#444444",
  },
  dark: {
    bg: "#0B0B0B",
    surface: "#151515",
    sidebar: "#101010",
    text: "#F5F5F5",
    muted: "#ACACAC",
    line: "#333333",
    accent: "#F2F2F2",
    onAccent: "#151515",
    soft: "#292929",
    cover: "#242424",
    danger: "#D5D5D5",
  },
};
