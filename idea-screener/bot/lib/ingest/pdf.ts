import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/pdf_text.py",
);

const MAX_STDOUT = 2_000_000;

/** Extract text from a PDF buffer via pypdf. Empty string = unreadable/scanned. */
export function extractPdfText(bytes: Buffer, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    let out = "";
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish("");
    }, timeoutMs);
    proc.stdout.on("data", (c: Buffer) => {
      if (out.length < MAX_STDOUT) out += c.toString("utf8");
    });
    proc.on("close", (code) => {
      finish(code === 0 ? out : "");
    });
    proc.on("error", () => finish(""));
    proc.stdin.on("error", () => finish(""));
    proc.stdin.end(bytes);
  });
}

export function isPdfMagic(bytes: Buffer): boolean {
  const start = bytes.subarray(0, 16).toString("latin1");
  return start.includes("%PDF");
}
