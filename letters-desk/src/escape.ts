export function esc(value: string | undefined | null): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtNum(v: string): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return esc(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function paraHtml(text: string): string {
  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((p) => `<p>${esc(p)}</p>`).join("\n");
}
