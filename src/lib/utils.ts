import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const m = (e as { message?: string }).message ?? String(e);
  if (m.includes("invalid_reference")) return "That item belongs to another account.";
  if (m.includes("task_closed")) return "This task is already closed.";
  if (m.includes("rate_limited")) return "Slow down — try again in a minute.";
  if (m.includes("Failed to fetch")) return "You appear to be offline.";
  return m;
}
