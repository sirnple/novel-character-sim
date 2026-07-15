/** Fired when style/idea/novel libraries should re-fetch (e.g. after modular extract). */
export const LIBRARIES_REFRESH_EVENT = "libraries:refresh";

export function notifyLibrariesRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIBRARIES_REFRESH_EVENT));
}
