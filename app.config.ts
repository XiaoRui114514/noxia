import type { ExpoConfig } from "expo/config";
const config: ExpoConfig = {
  name: "Noxia",
  icon: "./assets/noxia-icon.png",
  slug: "noxia",
  version: "0.1.0",
  orientation: "default",
  scheme: "noxia",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
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
  web: { bundler: "metro", name: "Noxia" },
  plugins: ["expo-dev-client", "expo-secure-store", "expo-document-picker"],
  experiments: { tsconfigPaths: true },
};
export default config;
