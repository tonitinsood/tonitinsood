export type Stance = "long" | "short" | "unknown";

export type LetterPitch = {
  stance: Stance;
  ticker: string;
  company: string;
  country: string;
  writeup: string;
  pe: string;
  ev_ebit: string;
  roic: string;
  net_debt_ebitda: string;
  metrics_source: string;
};

export type LetterRecord = {
  id: string;
  date: string;
  quarter: string;
  fund_id: string;
  fund: string;
  manager: string;
  title: string;
  region: string;
  geo: string;
  cap: string;
  tickers: string[];
  themes: string[];
  pitches: LetterPitch[];
  pdf_url: string;
  pdf_local: string;
  source_url: string;
  extract_method: "llm" | "heuristic";
};

export type SeedLetter = {
  id: string;
  title: string;
  date: string;
  pdf_url: string;
  manager?: string;
};

export type FundConfig = {
  id: string;
  name: string;
  manager: string;
  region: string;
  index_url?: string;
  pdf_url_include?: string;
  letters: SeedLetter[];
};

export type FundsFile = {
  comment?: string;
  blocked_hosts?: string[];
  funds: FundConfig[];
};

export type SitePayload = {
  generated_at: string;
  cadence: string;
  letters: LetterRecord[];
};
