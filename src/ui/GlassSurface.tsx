import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";

type Preferences = { reduceMotion: boolean; reduceTransparency: boolean };

/** Observe native accessibility settings and their browser media-query equivalents. */
export function useAccessibilityPreferences(): Preferences {
  // Start with the accessible rendering until the asynchronous system query resolves.
  const [preferences, setPreferences] = useState<Preferences>({
    reduceMotion: true,
    reduceTransparency: true,
  });
  useEffect(() => {
    let disposed = false;
    const update = (value: Partial<Preferences>) => {
      if (!disposed) setPreferences((previous) => ({ ...previous, ...value }));
    };
    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      window.matchMedia
    ) {
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const transparency = window.matchMedia(
        "(prefers-reduced-transparency: reduce)",
      );
      const refresh = () =>
        update({
          reduceMotion: motion.matches,
          reduceTransparency: transparency.matches,
        });
      refresh();
      motion.addEventListener("change", refresh);
      transparency.addEventListener("change", refresh);
      return () => {
        disposed = true;
        motion.removeEventListener("change", refresh);
        transparency.removeEventListener("change", refresh);
      };
    }
    const motionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => update({ reduceMotion: value }),
    );
    const transparencySubscription =
      Platform.OS === "ios"
        ? AccessibilityInfo.addEventListener(
            "reduceTransparencyChanged",
            (value) => update({ reduceTransparency: value }),
          )
        : undefined;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => update({ reduceMotion: value }))
      .catch(() => {});
    if (Platform.OS === "ios") {
      void AccessibilityInfo.isReduceTransparencyEnabled()
        .then((value) => update({ reduceTransparency: value }))
        .catch(() => {});
    } else {
      update({ reduceTransparency: false });
    }
    return () => {
      disposed = true;
      motionSubscription.remove();
      transparencySubscription?.remove();
    };
  }, []);
  return preferences;
}

export type GlassSurfaceProps = ViewProps & {
  dark: boolean;
  intensity?: number;
  interactive?: boolean;
  /** Reading surfaces and callers requiring a solid background can explicitly opt out. */
  opaque?: boolean;
};

function canUseNativeGlass() {
  if (
    Platform.OS !== "ios" ||
    Number.parseInt(String(Platform.Version), 10) < 26
  )
    return false;
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

/** Material applies only behind its children; text and controls are never blurred. */
export function GlassSurface({
  children,
  dark,
  style,
  intensity = 54,
  interactive = false,
  opaque = false,
  ...viewProps
}: GlassSurfaceProps) {
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const solid = dark ? "#151515" : "#FAFAFA";
  const translucent = dark ? "rgba(21,21,21,0.78)" : "rgba(255,255,255,0.78)";
  if (opaque || reduceTransparency) {
    return (
      <View
        {...viewProps}
        style={[styles.surface, { backgroundColor: solid }, style]}
      >
        {children}
      </View>
    );
  }
  if (canUseNativeGlass()) {
    return (
      <GlassView
        {...viewProps}
        style={[styles.surface, style]}
        colorScheme={dark ? "dark" : "light"}
        glassEffectStyle={{
          style: "regular",
          animate: !reduceMotion,
          animationDuration: 0.18,
        }}
        tintColor={dark ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.12)"}
        isInteractive={interactive}
      >
        {children}
      </GlassView>
    );
  }
  if (Platform.OS === "ios") {
    return (
      <BlurView
        {...viewProps}
        style={[styles.surface, style]}
        intensity={Math.max(0, Math.min(100, intensity))}
        tint={dark ? "systemThinMaterialDark" : "systemThinMaterialLight"}
      >
        {children}
      </BlurView>
    );
  }
  if (Platform.OS === "web") {
    const backdrop: ViewStyle & {
      backdropFilter: string;
      WebkitBackdropFilter: string;
    } = {
      backgroundColor: translucent,
      backdropFilter: "blur(22px)",
      WebkitBackdropFilter: "blur(22px)",
    };
    return (
      <View {...viewProps} style={[styles.surface, backdrop, style]}>
        {children}
      </View>
    );
  }
  // Avoid enabling costly experimental Android blur without an explicit blur target.
  return (
    <View
      {...viewProps}
      style={[styles.surface, { backgroundColor: solid }, style]}
    >
      {children}
    </View>
  );
}
const styles = StyleSheet.create({ surface: { overflow: "hidden" } });
export default GlassSurface;
