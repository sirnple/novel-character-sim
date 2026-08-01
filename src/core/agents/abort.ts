/** Shared abort helpers for agent chat + long analysis pipelines. */

export class AbortError extends Error {
  constructor(message = "ABORTED") {
    super(message);
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new AbortError();
}

export function isAbortError(e: unknown): boolean {
  if (e instanceof AbortError) return true;
  if (e instanceof Error) {
    return e.message === "ABORTED" || e.name === "AbortError";
  }
  return false;
}
