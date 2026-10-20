export function deriveNameFromLink(link: string): string {
  const hashIndex = link.indexOf('#');
  if (hashIndex >= 0 && hashIndex < link.length - 1) {
    try {
      return decodeURIComponent(link.slice(hashIndex + 1));
    } catch {
      return link.slice(hashIndex + 1);
    }
  }
  if (link.startsWith('vmess://')) {
    try {
      const encoded = link.slice('vmess://'.length).trim().replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      if (typeof parsed.ps === 'string' && parsed.ps.trim()) return parsed.ps.trim();
    } catch {
      // Keep the generic fallback for malformed or unsupported links.
    }
  }
  try {
    const url = new URL(link);
    return url.hostname;
  } catch {
    return link.slice(0, 32);
  }
}

export function createInClause(ids: string[]): { clause: string; bindings: string[] } {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length)));
  if (unique.length === 0) {
    return { clause: '(NULL)', bindings: [] };
  }
  const placeholders = unique.map(() => '?').join(', ');
  return { clause: `(${placeholders})`, bindings: unique };
}
