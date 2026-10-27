// HTTP GET with timeout, retries and an optional on-disk cache (for local development: --cache <dir>).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER_AGENT = "fertility-tracker-data-pipeline (+https://github.com/RostyslavDzhohola/fertility-tracker)";

let cacheDir = null;
export function useCache(dir) {
  cacheDir = dir;
}

const defaults = { retries: 4, timeoutMs: 60_000, baseDelayMs: 1500 };
/** Override retry/timeout defaults (tests use retries: 1, baseDelayMs: 0). */
export function configureHttp(options) {
  Object.assign(defaults, options);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a URL as text. Retries network errors, 429 and 5xx with exponential backoff.
 * Throws after the last attempt with a message naming the URL.
 */
export async function getText(url, { retries = defaults.retries, timeoutMs = defaults.timeoutMs, accept = "*/*" } = {}) {
  const key = cacheDir && join(cacheDir, createHash("sha1").update(url).digest("hex"));
  if (key) {
    const hit = await readFile(key, "utf8").catch(() => null);
    if (hit != null) return hit;
  }
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      const text = await res.text();
      if (key) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(key, text);
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === retries) break;
      await sleep(defaults.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`GET ${url} failed: ${lastErr?.message ?? lastErr}`);
}

export async function getJson(url, opts) {
  const text = await getText(url, { accept: "application/json", ...opts });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GET ${url} returned invalid JSON (starts: ${JSON.stringify(text.slice(0, 80))})`);
  }
}

/** Run async fn over items with at most `limit` in flight. Results keep input order; errors are captured per item. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
