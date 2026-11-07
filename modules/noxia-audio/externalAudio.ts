/** Bound user-supplied TTS responses before keeping an in-memory browser data URI. */
export const MAX_EXTERNAL_AUDIO_BYTES = 10 * 1024 * 1024;

export function externalAudioDataURI(base64: string, key: string): string {
  if (key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('音频缓存键须为 64 位十六进制摘要。');
  if (!base64 || base64.length > Math.ceil(MAX_EXTERNAL_AUDIO_BYTES / 3) * 4 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('音频不是有效的 Base64 或超过 10 MiB。');
  }
  const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes <= 0 || bytes > MAX_EXTERNAL_AUDIO_BYTES) throw new Error('单段音频不得超过 10 MiB。');
  return `data:audio/mpeg;base64,${base64}`;
}
