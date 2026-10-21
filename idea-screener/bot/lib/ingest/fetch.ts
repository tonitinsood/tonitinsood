export async function fetchText(url: string, maxBytes = 500_000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "idea-screener/1.0 (stock research bot; +https://github.com/tonitinsood/tonitinsood)",
      Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
