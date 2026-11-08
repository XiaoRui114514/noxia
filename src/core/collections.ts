import { ValidationError } from "./validation";

export type PlaylistOptions = {
  templateId?: string;
  voiceId?: string;
  translationVoiceId?: string;
  rate?: number;
};
export type Playlist = {
  id: string;
  name: string;
  resourceIds: string[];
  options?: Record<string, PlaylistOptions>;
};
export type OrderedCollection = Pick<Playlist, "resourceIds">;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function collectionIdentity(value: unknown): {
  id: string;
  name: string;
  resourceIds: string[];
} {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    value.id.length > 300 ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 500 ||
    !Array.isArray(value.resourceIds) ||
    value.resourceIds.length > 1000 ||
    value.resourceIds.some(
      (id) => typeof id !== "string" || !id || id.length > 300,
    )
  )
    throw new ValidationError("名称须为 1–500 字符，曲目最多 1000 篇");
  return {
    id: value.id,
    name: value.name.trim(),
    resourceIds: value.resourceIds.slice() as string[],
  };
}
export function validatePlaylistOptions(raw: unknown): PlaylistOptions {
  if (!record(raw)) throw new ValidationError("单篇设置无效");
  const result: PlaylistOptions = {};
  for (const key of ["templateId", "voiceId", "translationVoiceId"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "string" || raw[key].length > 300)
        throw new ValidationError("声音或编排设置无效");
      result[key] = raw[key];
    }
  }
  if (raw.rate !== undefined) {
    if (
      typeof raw.rate !== "number" ||
      !Number.isFinite(raw.rate) ||
      raw.rate < 0.25 ||
      raw.rate > 2
    )
      throw new ValidationError("语速须为 0.25–2");
    result.rate = raw.rate;
  }
  return result;
}
export function validatePlaylist(raw: unknown): Playlist {
  const identity = collectionIdentity(raw);
  if (!record(raw)) throw new ValidationError("列表无效");
  if (raw.options !== undefined && !record(raw.options))
    throw new ValidationError("列表设置无效");
  return {
    ...identity,
    options:
      raw.options === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(raw.options as Record<string, unknown>).map(
              ([id, value]) => [id, validatePlaylistOptions(value)],
            ),
          ),
  };
}
/** Separate idempotent add/remove operations: a double add can never remove a track. */
export function addResource<T extends OrderedCollection>(
  collection: T,
  id: string,
): T {
  return collection.resourceIds.includes(id)
    ? collection
    : { ...collection, resourceIds: [...collection.resourceIds, id] };
}
export function removeResource<T extends OrderedCollection>(
  collection: T,
  id: string,
): T {
  return {
    ...collection,
    resourceIds: collection.resourceIds.filter((x) => x !== id),
  };
}
export function moveResource<T extends OrderedCollection>(
  collection: T,
  index: number,
  delta: -1 | 1,
): T {
  const next = index + delta;
  if (
    index < 0 ||
    index >= collection.resourceIds.length ||
    next < 0 ||
    next >= collection.resourceIds.length
  )
    return collection;
  const ids = collection.resourceIds.slice();
  [ids[index], ids[next]] = [ids[next], ids[index]];
  return { ...collection, resourceIds: ids };
}

export function restoreResourceLink<T extends OrderedCollection>(
  current: T,
  before: T,
  id: string,
): T {
  if (current.resourceIds.includes(id)) return current;
  const ids = current.resourceIds.slice(),
    original = before.resourceIds.indexOf(id);
  const next = before.resourceIds
    .slice(original + 1)
    .find((x) => ids.includes(x));
  const previous = before.resourceIds
    .slice(0, original)
    .findLast((x) => ids.includes(x));
  const at = next
    ? ids.indexOf(next)
    : previous
      ? ids.indexOf(previous) + 1
      : ids.length;
  ids.splice(at, 0, id);
  return { ...current, resourceIds: ids };
}
