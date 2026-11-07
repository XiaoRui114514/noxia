import Constants from "expo-constants";

/** Build-time service configuration. Never derive this address from user input. */
export function resolveAccountApi(
  manifestValue: unknown,
  environmentValue?: string,
): string {
  const candidate =
    manifestValue === undefined ||
    manifestValue === null ||
    manifestValue === ""
      ? environmentValue
      : manifestValue;
  if (typeof candidate !== "string" || !candidate.trim()) return "";
  try {
    const raw = candidate.trim();
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      raw.includes("?") ||
      raw.includes("#")
    )
      return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export const ACCOUNT_API = resolveAccountApi(
  Constants.expoConfig?.extra?.services?.accountApi,
  process.env.EXPO_PUBLIC_ACCOUNT_API,
);

/** A configured address does not imply that deployment or login was verified. */
export function isAccountConfigured(): boolean {
  return ACCOUNT_API.length > 0;
}

export const ACCOUNT_UNAVAILABLE_MESSAGE =
  "账号服务暂未开放，你可以继续使用本机学习。";
