import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import { resolveAccountApi } from "./accountConfig";

describe("fixed account service configuration", () => {
  it("uses build manifest before environment fallback and normalizes slashes", () => {
    expect(
      resolveAccountApi("https://account.example/", "https://fallback.example"),
    ).toBe("https://account.example");
    expect(resolveAccountApi(undefined, "https://account.example/")).toBe(
      "https://account.example",
    );
    expect(resolveAccountApi(null, "https://account.example")).toBe(
      "https://account.example",
    );
    expect(resolveAccountApi("", "https://account.example")).toBe(
      "https://account.example",
    );
  });

  it("remains unavailable when no verified service address was supplied", () => {
    expect(resolveAccountApi(undefined)).toBe("");
    expect(resolveAccountApi("  ")).toBe("");
  });

  it("fails closed for invalid or credential-bearing configuration", () => {
    for (const value of [
      "http://account.example",
      "https://name:password@account.example",
      "https://account.example?key=example",
      "https://account.example#example",
      "https://account.example?",
      "https://account.example#",
      "not-a-service",
      12,
    ])
      expect(resolveAccountApi(value, "https://fallback.example")).toBe("");
  });
});
