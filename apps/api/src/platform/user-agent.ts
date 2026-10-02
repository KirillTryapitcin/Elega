/**
 * A short, human-readable device label for the session list ("Chrome on Android"). Deliberately
 * coarse: it is shown to the user, compared to spot new devices, and is not a fingerprint.
 */
export function deviceName(userAgent: string): string {
  const ua = userAgent;
  const browser = /YaBrowser\//.test(ua)
    ? 'Yandex Browser'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? 'Unknown device';
}
