/** Wire protocol v1: playlists use ordered items; listening history uses playedAt. */
export function toSyncEntity(
  collection,
  value,
  id = value.id ?? value.resourceId,
) {
  if (collection === "playlists")
    return {
      id,
      name: value.name,
      items: value.resourceIds.map((resourceId) => ({
        resourceId,
        ...value.options?.[resourceId],
      })),
    };
  if (collection === "history")
    return {
      id,
      resourceId: value.resourceId,
      position: value.position,
      completed: value.completed,
      playedAt: value.date,
    };
  return { ...value, id };
}
export function fromSyncEntity(collection, value) {
  if (collection === "playlists") {
    if (!Array.isArray(value.items)) throw new Error("云端列表格式异常");
    return {
      id: value.id,
      name: value.name ?? value.title,
      resourceIds: value.items.map((x) => x.resourceId),
      options: Object.fromEntries(
        value.items.map(({ resourceId, ...options }) => [resourceId, options]),
      ),
    };
  }
  if (collection === "history")
    return {
      resourceId: value.resourceId,
      title: "",
      position: value.position,
      completed: value.completed,
      date: value.playedAt,
    };
  return value;
}
