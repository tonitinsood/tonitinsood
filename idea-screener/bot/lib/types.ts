/** Source channel for a pitch row. */
export type SourceType =
  | "letter"
  | "sec_13d"
  | "sec_13g"
  | "sec_8k"
  | "substack"
  | "x";

export type MetricsSource = "fmp" | "yfinance" | "partial" | "";

/** Columns on the master `Pitches` tab (order matters for Sheets). */
export type PitchRow = {
  row_id: string;
  date: string;
  discovered_at: string;
  source_type: SourceType;
  /** Org, publication, fund, or filer entity — not the individual pitcher. */
  source_name: string;
  /** Person who pitched the idea (author, PM, X display name, letter signatory). */
  pitched_by: string;
  ticker: string;
  exchange_country: string;
  company: string;
  thesis_short: string;
  full_pitch: string;
  pe: string;
  ev_ebit: string;
  roic: string;
  net_debt_ebitda: string;
  metrics_source: MetricsSource;
  source_url: string;
  shortlisted: boolean;
  archived: boolean;
  notes: string;
};

/** LLM / extractor output for one pitch before metrics enrichment. */
export type ExtractedPitch = {
  date: string;
  source_type: SourceType;
  source_name: string;
  pitched_by: string;
  ticker: string;
  exchange_country: string;
  company: string;
  thesis_short: string;
  full_pitch: string;
  source_url: string;
};

export type MetricSnapshot = {
  pe: string;
  ev_ebit: string;
  roic: string;
  net_debt_ebitda: string;
  metrics_source: MetricsSource;
};

export type IngestDocument = {
  source_type: SourceType;
  source_name: string;
  pitched_by: string;
  source_url: string;
  date: string;
  title: string;
  body: string;
};
