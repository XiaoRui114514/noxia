import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { GlassSurface, useAccessibilityPreferences } from "./GlassSurface";
import type { AppColors } from "./theme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
export type NavigationItem<Page extends string = string> = {
  id: Page;
  label: string;
  icon: IconName;
};
export type AdaptiveShellProps<Page extends string> = {
  children: React.ReactNode;
  miniPlayer?: React.ReactNode;
  navItems: readonly NavigationItem<Page>[];
  currentPage: Page;
  onNavigate: (page: Page) => void;
  dark: boolean;
  colors: AppColors;
  playerAction?: () => void;
};

/** Navigation follows the space available to the document, including split-screen width. */
export function AdaptiveShell<Page extends string>({
  children,
  miniPlayer,
  navItems,
  currentPage,
  onNavigate,
  dark,
  colors,
  playerAction,
}: AdaptiveShellProps<Page>) {
  const { width, height, fontScale } = useWindowDimensions();
  const { reduceMotion } = useAccessibilityPreferences();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<React.ComponentRef<typeof Pressable>>(null);
  const wasDrawerOpen = useRef(false);
  // A sidebar must leave a useful reading pane. Narrow portrait, split view and
  // large accessibility type switch to a sheet instead of compressing the text.
  const supportsSidebar =
    width >= 1000 &&
    width - 240 >= 700 &&
    fontScale <= 1.35 &&
    (width >= height * 0.95 || width >= 1100);
  const showSidebar = supportsSidebar && !collapsed;
  const currentLabel =
    navItems.find((item) => item.id === currentPage)?.label ?? "播放器";

  useEffect(() => {
    setDrawerOpen(false);
  }, [width, height, fontScale]);
  useEffect(() => {
    if (Platform.OS !== "web" || !drawerOpen || typeof window === "undefined")
      return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);
  useEffect(() => {
    if (wasDrawerOpen.current && !drawerOpen) menuRef.current?.focus();
    wasDrawerOpen.current = drawerOpen;
  }, [drawerOpen]);

  function navigate(page: Page) {
    setDrawerOpen(false);
    onNavigate(page);
  }
  function iconButton(
    name: IconName,
    label: string,
    onPress: () => void,
    testID?: string,
  ) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        testID={testID}
        hitSlop={4}
        style={({ pressed }) => [
          styles.iconButton,
          { backgroundColor: pressed ? colors.soft : "transparent" },
        ]}
      >
        <Ionicons name={name} size={23} color={colors.text} />
      </Pressable>
    );
  }
  function navigation(isDrawer: boolean) {
    return (
      <>
        <View style={styles.brandRow}>
          <Text style={[styles.brand, { color: colors.text }]}>Noxia</Text>
          {iconButton(
            isDrawer ? "close-outline" : "menu-outline",
            isDrawer ? "关闭导航菜单" : "收起侧栏",
            () => (isDrawer ? setDrawerOpen(false) : setCollapsed(true)),
            isDrawer ? "shell-close-navigation" : "shell-collapse-sidebar",
          )}
        </View>
        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {navItems.map((item) => {
            const selected = currentPage === item.id;
            return (
              <Pressable
                key={item.id}
                testID={`nav-${item.id}`}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                aria-selected={selected}
                onPress={() => navigate(item.id)}
                style={({ pressed }) => [
                  styles.navRow,
                  {
                    backgroundColor:
                      selected || pressed
                        ? dark
                          ? "rgba(255,255,255,0.09)"
                          : "rgba(0,0,0,0.055)"
                        : "transparent",
                  },
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={21}
                  color={selected ? colors.text : colors.muted}
                />
                <Text
                  style={[
                    styles.navLabel,
                    {
                      color: selected ? colors.text : colors.muted,
                      fontWeight: selected ? "600" : "400",
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {playerAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开播放器"
            onPress={() => {
              setDrawerOpen(false);
              playerAction();
            }}
            style={({ pressed }) => [
              styles.playerLink,
              { borderTopColor: colors.line, opacity: pressed ? 0.55 : 1 },
            ]}
          >
            <Ionicons name="headset-outline" size={20} color={colors.muted} />
            <Text style={[styles.navLabel, { color: colors.muted }]}>
              打开播放器
            </Text>
          </Pressable>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <SafeAreaView
        style={styles.root}
        accessibilityElementsHidden={drawerOpen}
        importantForAccessibility={drawerOpen ? "no-hide-descendants" : "auto"}
      >
        <View style={styles.columns}>
          {showSidebar ? (
            <GlassSurface
              dark={dark}
              style={[styles.sidebar, { borderRightColor: colors.line }]}
              testID="shell-sidebar"
            >
              {navigation(false)}
            </GlassSurface>
          ) : null}
          <View style={styles.main}>
            <GlassSurface
              dark={dark}
              style={[styles.toolbar, { borderBottomColor: colors.line }]}
            >
              <View style={styles.toolbarLeading}>
                {!showSidebar ? (
                  <Pressable
                    ref={menuRef}
                    accessibilityRole="button"
                    testID="shell-open-navigation"
                    accessibilityLabel={
                      supportsSidebar ? "展开侧栏" : "打开导航菜单"
                    }
                    accessibilityState={{ expanded: drawerOpen }}
                    onPress={() =>
                      supportsSidebar
                        ? setCollapsed(false)
                        : setDrawerOpen(true)
                    }
                    style={({ pressed }) => [
                      styles.iconButton,
                      {
                        backgroundColor: pressed ? colors.soft : "transparent",
                      },
                    ]}
                  >
                    <Ionicons
                      name="menu-outline"
                      size={24}
                      color={colors.text}
                    />
                  </Pressable>
                ) : null}
                <Text
                  numberOfLines={2}
                  style={[styles.pageTitle, { color: colors.text }]}
                >
                  {currentLabel}
                </Text>
              </View>
              {playerAction
                ? iconButton("headset-outline", "打开播放器", playerAction)
                : null}
            </GlassSurface>
            <View style={styles.content}>{children}</View>
            {miniPlayer ? (
              <GlassSurface
                dark={dark}
                interactive
                style={[
                  styles.miniPlayer,
                  {
                    borderColor: dark
                      ? "rgba(255,255,255,0.14)"
                      : "rgba(0,0,0,0.09)",
                  },
                ]}
              >
                {miniPlayer}
              </GlassSurface>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
      <Modal
        visible={drawerOpen}
        transparent
        presentationStyle="overFullScreen"
        animationType={reduceMotion ? "none" : "fade"}
        onRequestClose={() => setDrawerOpen(false)}
        supportedOrientations={[
          "portrait",
          "portrait-upside-down",
          "landscape-left",
          "landscape-right",
        ]}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭导航菜单"
            onPress={() => setDrawerOpen(false)}
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: dark ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.24)",
              },
            ]}
          />
          <SafeAreaView style={styles.drawerSafeArea} pointerEvents="box-none">
            <GlassSurface
              dark={dark}
              testID="shell-navigation-drawer"
              accessibilityViewIsModal
              style={[
                styles.drawer,
                {
                  width: Math.max(0, Math.min(320, width - 24)),
                  borderColor: dark
                    ? "rgba(255,255,255,0.16)"
                    : "rgba(255,255,255,0.7)",
                },
              ]}
            >
              {navigation(true)}
            </GlassSurface>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  columns: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: {
    width: 240,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
  },
  brandRow: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 12,
    paddingRight: 2,
  },
  brand: { fontSize: 25, fontWeight: "600", letterSpacing: -1, flexShrink: 1 },
  navScroll: { flex: 1, minHeight: 0 },
  navContent: { gap: 4, paddingVertical: 8 },
  navRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 11,
  },
  navLabel: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  playerLink: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  toolbar: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarLeading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  pageTitle: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  miniPlayer: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
  },
  modalRoot: { flex: 1 },
  drawerSafeArea: { flex: 1, flexDirection: "row", minHeight: 0 },
  drawer: {
    margin: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    paddingHorizontal: 12,
    minHeight: 0,
  },
});

export default AdaptiveShell;
