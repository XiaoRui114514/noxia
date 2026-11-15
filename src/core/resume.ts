import { AudioPlan } from "../../modules/noxia-audio/types";
import { Resume } from "../services/storage";
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let a = 2166136261,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b);
  }
  return `${a >>> 0}-${b >>> 0}`;
}
export function resumePosition(
  resume: Resume | undefined,
  plan: AudioPlan,
  duration: number,
  context: string,
): number | undefined {
  if (
    !resume ||
    resume.planId !== plan.id ||
    resume.context !== context ||
    !Number.isFinite(resume.position) ||
    resume.position < 0 ||
    resume.position >= duration
  )
    return;
  const step = plan.steps[resume.stepIndex ?? -1];
  if (
    !step ||
    step.id !== resume.stepId ||
    step.resourceId !== resume.resourceId
  )
    return;
  return resume.position;
}
