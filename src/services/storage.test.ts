import { beforeEach, afterEach, it, expect, vi } from "vitest";
const { store, writes } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  writes: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      writes(k, v);
      store.set(k, v);
    },
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
import {
  loadLibrary,
  saveLibrary,
  flushLibrary,
  parseLibrary,
  exportLibrary,
  restoreLibrary,
  freshLibrary,
  LIBRARY_KEY,
  BACKUP_KEY,
  RECOVERY_KEY,
  validatePronunciations,
} from "./storage";
const resource = {
  id: "r",
  title: "valid",
  kind: "custom",
  segments: [{ id: "s", original: "text", keywords: ["key"] }],
};
beforeEach(() => {
  store.clear();
  writes.mockClear();
});
afterEach(async () => {
  await flushLibrary();
  vi.useRealTimers();
});
it("backs up exact v1 bytes, isolates one invalid item, and retains valid records through reload", async () => {
  const raw = JSON.stringify({
    ...freshLibrary(),
    schema: 1,
    resources: [resource, { ...resource, id: "bad", title: "x".repeat(501) }],
  });
  store.set(LIBRARY_KEY, raw);
  const db = await loadLibrary();
  expect(store.get(BACKUP_KEY)).toBe(raw);
  expect(db.resources).toHaveLength(1);
  expect(db.quarantine?.[0].raw).toEqual({
    ...resource,
    id: "bad",
    title: "x".repeat(501),
  });
  const saved = saveLibrary(db);
  await flushLibrary();
  await saved;
  const loaded = await loadLibrary();
  expect(loaded.quarantine).toEqual(db.quarantine);
  expect(loaded.resources).toEqual(db.resources);
});
it("never overwrites malformed storage and preserves a restore point before replacement", async () => {
  store.set(LIBRARY_KEY, "broken original");
  await expect(loadLibrary()).rejects.toThrow();
  expect(store.get(LIBRARY_KEY)).toBe("broken original");
  const restored = await restoreLibrary(
    exportLibrary({ ...freshLibrary(), resources: [resource as any] }),
  );
  expect(restored.resources).toHaveLength(1);
  expect(store.get(RECOVERY_KEY)).toBe("broken original");
  await expect(restoreLibrary("invalid")).rejects.toThrow();
  expect(store.get(RECOVERY_KEY)).toBe("broken original");
});
it("coalesces consecutive updates into the latest snapshot with observable save failures", async () => {
  const a = saveLibrary(freshLibrary()),
    b = saveLibrary({ ...freshLibrary(), resources: [resource as any] });
  await flushLibrary();
  await Promise.all([a, b]);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(parseLibrary(store.get(LIBRARY_KEY)!).resources).toHaveLength(1);
});
it("validates dictionary entries and restores structured global/per-resource dictionaries", () => {
  expect(() => validatePronunciations("word=")).toThrow();
  expect(() => validatePronunciations("a=b\na=c")).toThrow();
  expect(() => validatePronunciations("a".repeat(101) + "=b")).toThrow();
  const map = validatePronunciations("重=chong\n行=hang");
  const db = parseLibrary(
    exportLibrary({
      ...freshLibrary(),
      pronunciations: { global: map, resources: { r: { 重: "zhong" } } },
    }),
  );
  expect(db.pronunciations?.global).toEqual(map);
  expect(db.pronunciations?.resources.r.重).toBe("zhong");
});

it('reports write errors and permits a later save without losing the pending content',async()=>{
 writes.mockImplementationOnce(()=>{throw new Error('disk full');});
 const pending=saveLibrary(freshLibrary()),rejected=expect(pending).rejects.toThrow('disk full');await expect(flushLibrary()).rejects.toThrow('disk full');await rejected;
 const retry=saveLibrary({...freshLibrary(),resources:[resource as any]});await flushLibrary();await retry;expect((await loadLibrary()).resources[0].title).toBe('valid');
});
