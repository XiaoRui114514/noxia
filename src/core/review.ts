import { Library, Review } from "../services/storage";
/** Scores are explicit self assessments, never inferred from listening. */
export function assessReview(
  previous: Review | undefined,
  resourceId: string,
  segmentId: string,
  score: 0 | 1 | 2,
  now = Date.now(),
): Review {
  const attempts = (previous?.attempts ?? 0) + 1;
  const days =
    score === 0
      ? 0
      : score === 1
        ? 1
        : Math.min(30, 2 ** Math.min(attempts, 4));
  return {
    resourceId,
    segmentId,
    score,
    attempts,
    date: new Date(now).toISOString(),
    due: new Date(now + (days ? days * 86400000 : 10 * 60000)).toISOString(),
  };
}
export function dueReviews(db: Library, now = Date.now()) {
  return (db.reviews ?? []).filter(
    (r) =>
      Date.parse(r.due) <= now &&
      db.resources.some(
        (x) =>
          x.id === r.resourceId && x.segments.some((s) => s.id === r.segmentId),
      ),
  );
}
