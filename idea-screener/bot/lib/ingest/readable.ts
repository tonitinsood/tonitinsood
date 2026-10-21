/** Detect garbage (PDF binary, control chars) and produce a 1–3 sentence thesis. */

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const REPLACEMENT_RE = /\uFFFD/g;

export function latinRatio(text: string, sampleSize = 4000): number {
  const sample = text.slice(0, sampleSize);
  if (!sample) return 0;
  let latin = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) ||
      c === 32
    ) {
      latin += 1;
    }
  }
  return latin / sample.length;
}

export function looksUnreadable(text: string): boolean {
  const s = text ?? "";
  if (!s.trim()) return true;
  if (s.includes("%PDF-") || s.trimStart().startsWith("%PDF")) return true;
  const sample = s.slice(0, 8000);
  const replacements = sample.match(REPLACEMENT_RE)?.length ?? 0;
  if (replacements > 20) return true;
  const controls = sample.match(CONTROL_RE)?.length ?? 0;
  if (controls > 15) return true;
  if (latinRatio(sample) < 0.4) return true;
  return false;
}

export function looksLikePageChrome(text: string): boolean {
  const s = text.slice(0, 2500);
  return (
    /Opens in a new window/i.test(s) ||
    /Subscribe Sign in/i.test(s) ||
    /googletagmanager\.com/i.test(s) ||
    /&amp;amp;lt;iframe/i.test(s) ||
    /Continue reading this post on Substack/i.test(s)
  );
}

/** True when column J/K should be rewritten from the source document. */
export function needsNarrativeRewrite(
  fullPitch: string,
  thesisShort: string,
): boolean {
  return (
    looksUnreadable(fullPitch) ||
    looksUnreadable(thesisShort) ||
    looksLikePageChrome(fullPitch) ||
    looksLikePageChrome(thesisShort)
  );
}

export function sanitizeText(text: string): string {
  return text
    .replace(REPLACEMENT_RE, "")
    .replace(CONTROL_RE, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

export function unreadableNote(url: string, reason: string): string {
  return `Could not extract readable text (${reason}). Open the source: ${url}`;
}

const CHROME_SENTENCE =
  /subscribe|sign in|opens in a new window|cookie|privacy policy|manage settings|share this|leave a comment|googletagmanager|iframe src/i;

/**
 * 1–3 sentence thesis from title + body. Skips nav/chrome sentences.
 */
export function thesisFromBody(title: string, body: string, maxLen = 500): string {
  const cleaned = sanitizeText(body).replace(/\s+/g, " ").trim();
  const rawSentences = cleaned.split(/(?<=[.!?])\s+/);
  const sentences = rawSentences.filter((s) => {
    const t = s.trim();
    if (t.length < 40) return false;
    if (CHROME_SENTENCE.test(t)) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    if (looksUnreadable(t)) return false;
    return true;
  });
  const picked = sentences.slice(0, 3).join(" ");
  const fallback = sanitizeText(title).replace(/\s+/g, " ").trim();
  const out = picked || fallback || "See the source URL for the full pitch.";
  return out.slice(0, maxLen);
}
