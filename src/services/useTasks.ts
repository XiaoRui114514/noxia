import { useRef, useState } from "react";
export type TaskState = {
  status: "running" | "complete" | "error";
  error?: string;
};
export function useTasks(report: (e: unknown) => void) {
  const active = useRef(new Set<string>());
  const [states, setStates] = useState<Record<string, TaskState>>({});
  async function task(id: string, work: () => Promise<void>) {
    if (active.current.has(id)) return;
    active.current.add(id);
    setStates((v) => ({ ...v, [id]: { status: "running" } }));
    try {
      await work();
      setStates((v) => ({ ...v, [id]: { status: "complete" } }));
    } catch (e) {
      setStates((v) => ({
        ...v,
        [id]: {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        },
      }));
      report(e);
    } finally {
      active.current.delete(id);
    }
  }
  return {
    task,
    tasks: Object.keys(states).filter((id) => states[id].status === "running"),
    states,
  };
}
