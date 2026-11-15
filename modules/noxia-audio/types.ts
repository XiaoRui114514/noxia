export type Voice = { id: string; name: string; language: string; quality: string; gender?: 'male' | 'female' | 'unspecified' };
export type AudioStep = {
  id: string;
  segmentId: string;
  kind: 'speech' | 'silence' | 'file';
  /** File steps accept audio already synthesized at their requested rate. */
  uri?: string;
  text?: string;
  durationMs?: number;
  voiceId?: string;
  rate: number;
  volume: number;
  /** Optional per-resource metadata for a single native timeline containing a playlist. */
  resourceId?: string;
  title?: string;
  author?: string;
};
export type AudioPlan = {
  id: string;
  title: string;
  author?: string;
  steps: AudioStep[];
  loop: boolean;
  pronunciations?: Record<string, string>;
};
export type AudioStatus = {
  playing: boolean;
  position: number;
  duration: number;
  stepIndex: number;
  cachedCount?: number;
  preparing?: boolean;
  preparedCount?: number;
  totalSteps?: number;
  error?: string;
  resourceId?: string;
  /** Progress inside the current contiguous resource block, in seconds. */
  resourcePosition?: number;
  resourceDuration?: number;
};
export type Subscription = { remove(): void };
export interface AudioBackend {
  listVoices(): Promise<Voice[]>;
  prepare(plan: AudioPlan): Promise<{ duration: number }>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  /** Seek to a prepared timeline step (not a text-character offset). */
  skipStep(index: number): void;
  setRate(rate: number): void;
  setSleepTimer(seconds: number, fadeSeconds: number): void;
  getStatus(): AudioStatus;
  getCacheInfo(): Promise<{ count: number; bytes: number }>;
  clearCache(): Promise<void>;
  cacheExternalAudio(base64: string, key: string): Promise<{ uri: string }>;
  getExternalAudio(key: string): Promise<{ uri: string } | null>;
  addListener(event: 'onStatus', listener: (status: AudioStatus) => void): Subscription;
}
