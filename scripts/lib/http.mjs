// HTTP GET with timeout, retries and an optional on-disk cache (for local development: --cache <dir>).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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

/**
 * GET a URL and return the Response (2xx only), with the same retry policy as getText. The body is not read, so
 * callers can stream large files. Throws naming the URL after the last attempt.
 */
async function fetchOk(url, { retries = defaults.retries, timeoutMs = defaults.timeoutMs, accept = "*/*" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === retries) break;
      await sleep(defaults.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`GET ${url} failed: ${lastErr?.message ?? lastErr}`);
}

const lastModifiedDate = (h) => {
  const t = Date.parse(h ?? "");
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/**
 * Open a (large, binary) download as a Node stream without buffering it. Returns { stream, lastModified } where
 * lastModified is the server's Last-Modified date (YYYY-MM-DD) or null. With --cache the file is first written to
 * the cache directory (streamed to disk), then read back from there. A failure while reading the body surfaces as a
 * stream error: callers that need all-or-nothing results restart from scratch (see withRetries).
 * timeoutMs covers the whole download here (default 10 minutes), not just the response headers.
 */
export async function openStream(url, { timeoutMs = 600_000, ...opts } = {}) {
  const key = cacheDir && join(cacheDir, createHash("sha1").update(url).digest("hex"));
  if (key) {
    const hit = await stat(key).catch(() => null);
    const meta = await readFile(`${key}.meta`, "utf8").then(JSON.parse, () => ({}));
    if (hit) return { stream: createReadStream(key), lastModified: meta.lastModified ?? null };
  }
  const res = await fetchOk(url, { ...opts, timeoutMs });
  const lastModified = lastModifiedDate(res.headers.get("last-modified"));
  const body = Readable.fromWeb(res.body);
  if (!key) return { stream: body, lastModified };
  await mkdir(cacheDir, { recursive: true });
  const tmp = `${key}.tmp-${process.pid}`;
  try {
    await pipeline(body, createWriteStream(tmp));
    await rename(tmp, key);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new Error(`GET ${url} failed while downloading: ${err.message ?? err}`);
  }
  await writeFile(`${key}.meta`, JSON.stringify({ url, lastModified }));
  return { stream: createReadStream(key), lastModified };
}

/** GET a small binary file (e.g. a zip of a few MB) into a Buffer. Returns { buffer, lastModified }. */
export async function getBuffer(url, opts) {
  const { stream, lastModified } = await openStream(url, opts);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return { buffer: Buffer.concat(chunks), lastModified };
}

/** Run fn (which must start from scratch on each call) up to `attempts` times; for streamed downloads. */
export async function withRetries(fn, { attempts = defaults.retries, label = "download" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await sleep(defaults.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr?.message ?? lastErr}`);
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
