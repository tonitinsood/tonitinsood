import { defineAgent } from "@cursor/bdk";

/**
 * Hosting declarations for dashboard deploy. Secret *names* only (never
 * values). BDK requires UPPER_SNAKE_CASE; Cloud Agent mixed-case names map
 * to these aliases (GOOGLE_SERVICE_ACCOUNT_JSON ← Google_Account_Json,
 * GOOGLE_SHEET_ID ← Google_Sheet_Id). Code already reads both styles.
 */
export default defineAgent({
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    secretNames: [
      "FMP_API_KEY",
      "GOOGLE_SERVICE_ACCOUNT_JSON",
      "GOOGLE_SHEET_ID",
    ],
    egressDomains: [
      "financialmodelingprep.com",
      "*.financialmodelingprep.com",
      "*.googleapis.com",
      "accounts.google.com",
      "sec.gov",
      "*.sec.gov",
      "substack.com",
      "*.substack.com",
      "valueandopportunity.com",
      "www.valueandopportunity.com",
      "fool.co.uk",
      "*.fool.co.uk",
      "fool.com.au",
      "*.fool.com.au",
      "smallcappower.com",
      "www.smallcappower.com",
      "capitalmind.in",
      "www.capitalmind.in",
      "nitter.net",
    ],
  },
});
