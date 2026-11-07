import type { Playlist } from "../services/storage";
/** Reinsert at the original position without overwriting later edits to other items. */
export function restorePlaylistLink(
  current: Playlist,
  before: Playlist,
  resourceId: string,
): Playlist {
  if (current.resourceIds.includes(resourceId)) return current;
  const resourceIds = [...current.resourceIds];
  const original = before.resourceIds.indexOf(resourceId);
  const next = before.resourceIds
    .slice(original + 1)
    .find((id) => resourceIds.includes(id));
  const previous = before.resourceIds
    .slice(0, original)
    .findLast((id) => resourceIds.includes(id));
  const at = next
    ? resourceIds.indexOf(next)
    : previous
      ? resourceIds.indexOf(previous) + 1
      : resourceIds.length;
  resourceIds.splice(at, 0, resourceId);
  return {
    ...current,
    resourceIds,
    options: {
      ...current.options,
      ...(before.options?.[resourceId]
        ? { [resourceId]: before.options[resourceId] }
        : {}),
    },
  };
}
