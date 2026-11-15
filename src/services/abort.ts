/** Works in React Native runtimes without AbortSignal.any/timeout. Dispose after consuming the body. */
export function timedSignal(parent?: AbortSignal, milliseconds = 90000) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, milliseconds);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
    },
  };
}
export function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      const e = new Error("请求已取消或超时");
      e.name = "AbortError";
      reject(e);
    };
    if (signal.aborted) {
      cancel();
      operation.catch(() => {});
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}
