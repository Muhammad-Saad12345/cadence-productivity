// Minimal assertion helpers (node:assert based; no network-fetched test deps).
import nodeAssert from "node:assert/strict";

export function assert(cond: unknown, msg?: string): asserts cond {
  nodeAssert.ok(cond, msg);
}
export function assertEquals<T>(actual: T, expected: T, msg?: string) {
  nodeAssert.deepStrictEqual(actual, expected, msg);
}
export async function assertRejects(fn: () => Promise<unknown>, _errorClass?: unknown, includes?: string, msg?: string) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    const text = String((e as Error)?.message ?? e);
    if (includes && !text.includes(includes)) {
      throw new Error(`${msg ?? "assertRejects"}: expected error containing "${includes}", got "${text}"`);
    }
  }
  if (!threw) throw new Error(`${msg ?? "assertRejects"}: expected promise to reject`);
}
