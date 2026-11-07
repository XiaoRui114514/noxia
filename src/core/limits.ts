/** Must stay aligned with modules/noxia-audio/ios/NoxiaAudioModule.swift guards. */
export const AUDIO_LIMITS = Object.freeze({
  maxSteps: 1000,
  maxSpeechCharacters: 150000,
  maxUtteranceCharacters: 10000,
  maxTimelineMs: 8 * 60 * 60 * 1000,
  minSilenceMs: 50,
  maxSilenceMs: 600000,
});

export const RESOURCE_LIMITS = Object.freeze({
  title: 500,
  segments: 2000,
  characters: 1000000,
  keywordCharacters: 4000,
});
