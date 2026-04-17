export function resolveDesktopDownloadUrl(
  downloadUrl: string,
  pageUrl: string
): string | null {
  const trimmedUrl = downloadUrl.trim();

  if (!trimmedUrl) {
    return null;
  }

  try {
    const resolved = new URL(trimmedUrl, pageUrl);

    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

export function getDownloadFileNameFromPath(path: string, fallbackName: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const candidate = segments.at(-1)?.trim();

  if (!candidate) {
    return fallbackName;
  }

  return candidate;
}
