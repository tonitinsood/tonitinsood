import type { LetterPitch, LetterRecord, Stance } from "./types.js";

type LlmLetter = {
  date?: string;
  manager?: string;
  title?: string;
  tickers?: string[];
  themes?: string[];
  quick_take?: string;
  geo?: string;
  cap?: string;
  pitches?: {
    stance?: string;
    ticker?: string;
    company?: string;
    country?: string;
    writeup?: string;
  }[];
};

function endpoints(): { url: string; key: string; model: string }[] {
  const out: { url: string; key: string; model: string }[] = [];
  const cursor = process.env.CURSOR_API_KEY?.trim();
  const openai = process.env.OPENAI_API_KEY?.trim();
  const extra = process.env.LLM_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim() || "gpt-4o-mini";
  const customBase = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const customKey = extra || cursor || openai;
  if (customBase && customKey) {
    out.push({ url: `${customBase}/chat/completions`, key: customKey, model });
  }
  if (openai) {
    out.push({
      url: "https://api.openai.com/v1/chat/completions",
      key: openai,
      model,
    });
  }
  // Official Cursor API is Cloud Agents, not chat completions. Try only when
  // an OpenAI-compatible proxy base is not already set; swallow failures.
  if (cursor && !customBase) {
    out.push({
      url: "https://api.cursor.com/v1/chat/completions",
      key: cursor,
      model: process.env.LLM_MODEL?.trim() || "gpt-4o-mini",
    });
  }
  return out;
}

function parseJson(raw: string): LlmLetter | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as LlmLetter;
  } catch {
    return null;
  }
}

function asStance(v: string | undefined): Stance {
  const s = (v || "").toLowerCase();
  if (s === "short") return "short";
  if (s === "long") return "long";
  return "unknown";
}

export async function llmExtractLetter(
  text: string,
  fundName: string,
  manager: string,
  title: string,
  pdfUrl: string,
): Promise<Partial<LetterRecord> | null> {
  const targets = endpoints();
  if (targets.length === 0) return null;

  const excerpt = text.slice(0, 24_000);
  const prompt = `Extract structured metadata from this hedge-fund / investor letter.
Return JSON only with keys:
date (YYYY-MM-DD), manager, title, tickers (array of symbols), themes (short keywords),
quick_take (2-4 sentences, never the whole letter), geo, cap (mega|large|mid|small or ""),
pitches: array of {stance: long|short, ticker, company, country, writeup}.
Each pitch writeup must be a readable thesis for THAT name (a few paragraphs), not the entire letter.
If the letter is commentary with no stock pitch, pitches may be [].
Fund: ${fundName}. Stated manager: ${manager}. Title: ${title}. URL: ${pdfUrl}.

LETTER TEXT:
${excerpt}`;

  for (const t of targets) {
    try {
      const res = await fetch(t.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${t.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: t.model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You extract investment-letter metadata. Never copy an entire letter into a pitch field.",
            },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      const parsed = parseJson(content);
      if (!parsed) continue;
      const pitches: LetterPitch[] = (parsed.pitches ?? []).map((p) => ({
        stance: asStance(p.stance),
        ticker: (p.ticker || "").toUpperCase(),
        company: p.company || "",
        country: p.country || "",
        writeup: p.writeup || "",
        pe: "",
        ev_ebit: "",
        roic: "",
        net_debt_ebitda: "",
        metrics_source: "",
      }));
      return {
        date: parsed.date,
        manager: parsed.manager,
        title: parsed.title,
        tickers: parsed.tickers,
        themes: parsed.themes,
        quick_take: parsed.quick_take,
        geo: parsed.geo,
        cap: parsed.cap,
        pitches,
      };
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}
