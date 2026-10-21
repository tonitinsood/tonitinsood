import { readFile } from "node:fs/promises";
import { google } from "googleapis";

const ENV_HINT =
  "Set Google_Account_Json, GOOGLE_SERVICE_ACCOUNT_JSON (JSON string or file path), or GOOGLE_APPLICATION_CREDENTIALS (file path).";

/** Resolve raw service-account JSON text (first matching env var wins). */
export async function resolveGoogleCredentialsJson(): Promise<string> {
  const inlineCandidates = [
    process.env.Google_Account_Json,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  ];
  for (const raw of inlineCandidates) {
    if (!raw?.trim()) continue;
    let jsonText = raw.trim();
    if (!jsonText.startsWith("{")) {
      jsonText = await readFile(jsonText, "utf8");
    }
    return jsonText;
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (credPath) {
    return readFile(credPath, "utf8");
  }
  throw new Error(`Google service account not configured. ${ENV_HINT}`);
}

export async function getServiceAccountClientEmail(): Promise<string | undefined> {
  try {
    const jsonText = await resolveGoogleCredentialsJson();
    const creds = JSON.parse(jsonText) as { client_email?: string };
    return creds.client_email;
  } catch {
    return undefined;
  }
}

export async function getGoogleAuth() {
  const jsonText = await resolveGoogleCredentialsJson();
  const creds = JSON.parse(jsonText) as {
    client_email?: string;
    private_key?: string;
  };
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function sheetsClient() {
  const auth = await getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}
