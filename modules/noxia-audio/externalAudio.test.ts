import { describe, expect, it } from 'vitest';
import { externalAudioDataURI, MAX_EXTERNAL_AUDIO_BYTES } from './externalAudio';

describe('external audio browser payload boundaries', () => {
  const key = 'a'.repeat(64);
  it('returns an in-memory audio data URI without claiming persisted playback', () => {
    expect(externalAudioDataURI('SUQzBAAAAAAA', key)).toBe('data:audio/mpeg;base64,SUQzBAAAAAAA');
  });
  it.each(['../outside', 'g'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)}.mp3`, `${'a'.repeat(64)}\n`])('rejects a non-digest identity', value => {
    expect(() => externalAudioDataURI('SUQzBAAAAAAA', value)).toThrow('64');
  });
  it.each(['', 'not-base64!', 'AAA', 'AA=A', 'AAAA===', 'AAAA\n'])('rejects malformed base64', value => {
    expect(() => externalAudioDataURI(value, key)).toThrow('Base64');
  });
  it('bounds encoded input before retaining a large response', () => {
    const oversized = 'A'.repeat(Math.ceil(MAX_EXTERNAL_AUDIO_BYTES / 3) * 4 + 4);
    expect(() => externalAudioDataURI(oversized, key)).toThrow('10 MiB');
  });
  it('also rejects decoded content above the limit when it fits the padded encoded length', () => {
    const oversized = 'A'.repeat(Math.ceil(MAX_EXTERNAL_AUDIO_BYTES / 3) * 4);
    expect(() => externalAudioDataURI(oversized, key)).toThrow('10 MiB');
  });
});
