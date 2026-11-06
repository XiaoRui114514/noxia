export type ResourceKind = "poetry" | "grammar" | "custom";

export interface Segment {
  id: string;
  original: string;
  translation?: string;
  explanation?: string;
  keywords?: string | string[];
  important?: boolean;
  paragraph?: number;
}

export interface Resource {
  id: string;
  title: string;
  author?: string;
  kind: ResourceKind;
  source?: { repo: string; path: string; version: string; url: string };
  segments: Segment[];
  generated?: boolean;
}

export const stepKinds = [
  "original",
  "translation",
  "explanation",
  "custom",
  "keywords",
  "recall",
  "pause",
  "nextSentence",
  "nextParagraph",
] as const;
export type StepKind = (typeof stepKinds)[number];

export interface Step {
  id: string;
  kind: StepKind;
  text?: string;
  repeat: number;
  /** Relative speech rate, 1 = normal. */
  rate: number;
  volume: number;
  durationMs: number;
  voiceId?: string;
  enabled: boolean;
}

export interface Template {
  id: string;
  name: string;
  scope: "sentence" | "paragraph" | "document";
  steps: Step[];
}

export interface AudioStep {
  id: string;
  segmentId: string;
  /** Cross-resource sessions retain source segment IDs and identify their owning resource here. */
  resourceId?: string;
  title?: string;
  author?: string;
  kind: "speech" | "silence";
  text?: string;
  durationMs?: number;
  voiceId?: string;
  rate: number;
  volume: number;
}

export interface Plan {
  id: string;
  title: string;
  author?: string;
  steps: AudioStep[];
  loop: boolean;
  warnings: string[];
}

export interface CompileOptions {
  selectedIds?: string[];
  voiceId?: string;
  translationVoiceId?: string;
  loop?: boolean;
}
