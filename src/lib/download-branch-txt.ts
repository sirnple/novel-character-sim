/**
 * Download a branch's prose as UTF-8 .txt via GET /api/branches?...&download=1
 */

function sanitizeFilename(name: string): string {
  const base = (name || "branch")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 80) || "branch";
  return base.endsWith(".txt") ? base : `${base}.txt`;
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetch branch text from API and save as .txt.
 * @returns null on success, error message on failure
 */
export async function downloadBranchAsTxt(
  novelId: string,
  branchId: string,
  displayName?: string,
): Promise<string | null> {
  if (!novelId || !branchId) return "缺少 novelId 或 branchId";

  const url =
    `/api/branches?novelId=${encodeURIComponent(novelId)}` +
    `&branchId=${encodeURIComponent(branchId)}&download=1`;

  const res = await fetch(url);
  const ct = res.headers.get("Content-Type") || "";

  if (!res.ok) {
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => ({}));
      return (data as { error?: string }).error || `下载失败 (${res.status})`;
    }
    return `下载失败 (${res.status})`;
  }

  // Server may return JSON error with 200 only if misconfigured; guard content-type
  if (ct.includes("application/json")) {
    const data = await res.json().catch(() => ({}));
    return (data as { error?: string }).error || "下载失败";
  }

  const text = await res.text();
  const headerName = res.headers.get("X-Branch-Name");
  const nameFromHeader = headerName ? decodeURIComponent(headerName) : "";
  const filename = sanitizeFilename(displayName || nameFromHeader || branchId);

  triggerBlobDownload(filename, new Blob([text], { type: "text/plain;charset=utf-8" }));
  return null;
}
