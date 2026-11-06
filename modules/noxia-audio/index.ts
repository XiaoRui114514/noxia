import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { AudioBackend } from './types';
import { createWebAudio } from './web';
export * from './types';

const native = Platform.OS === 'ios'
  ? requireOptionalNativeModule<AudioBackend>('NoxiaAudio')
  : null;
const audio: AudioBackend = native ?? createWebAudio();
/** Browser preview only supports foreground speech. Expo Go has no Noxia module. */
export const audioCapabilities = {
  native: !!native,
  background: !!native,
  offlineCache: !!native,
  unavailable: Platform.OS !== 'web' && !native,
};
export default audio;
