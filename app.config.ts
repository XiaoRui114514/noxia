import { version } from "./package.json";
import type { ExpoConfig } from "expo/config";
const config: ExpoConfig = {
  name: "Noxia",
  icon: "./assets/noxia-icon.png",
  slug: "noxia",
  version,
  orientation: "default",
  scheme: "noxia",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    buildNumber: "4",
    bundleIdentifier: "com.noxia.app",
    infoPlist: {
      UIBackgroundModes: ["audio"],
      UIRequiresFullScreen: false,
      ITSAppUsesNonExemptEncryption: false,
      UISupportedInterfaceOrientations: [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
    },
  },
  android: { package: "com.noxia.app" },
  web: { bundler: "metro", name: "Noxia", favicon: "./assets/noxia-icon.png" },
  plugins: ["expo-dev-client", "expo-secure-store", "expo-document-picker"],
  extra: {
    services: { accountApi: process.env.EXPO_PUBLIC_ACCOUNT_API || "" },
  },
  experiments: { tsconfigPaths: true },
};
export default config;
