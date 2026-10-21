import { readFile } from "node:fs/promises";
import { google } from "googleapis";

export async function getGoogleAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set (JSON string or path to key file).",
    );
  }
  let jsonText = raw.trim();
  if (!jsonText.startsWith("{")) {
    jsonText = await readFile(jsonText, "utf8");
  }
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
