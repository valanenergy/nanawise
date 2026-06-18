import { z } from 'zod';

/** Typed fetch error carrying status + body for diagnosis. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * Fetch JSON with a timeout and one retry, then validate against `schema`.
 * predict-server response shapes are undocumented (docs/03 §10) — callers pass a
 * tolerant schema (often `.passthrough()`/`z.unknown()`) and fail soft.
 */
export async function safeFetch<T>(
  url: string,
  schema: z.ZodType<T>,
  opts: { timeoutMs?: number; retries?: number; init?: RequestInit } = {},
): Promise<T> {
  const { timeoutMs = 10_000, retries = 1, init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status} for ${url}`, url, res.status, text.slice(0, 500));
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new FetchError(`Non-JSON response from ${url}`, url, res.status, text.slice(0, 500));
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new FetchError(
          `Schema mismatch for ${url}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          url,
          res.status,
          text.slice(0, 500),
        );
      }
      return parsed.data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new FetchError(String(lastErr), url);
}

/** Loose object schema: keeps every key but lets us read known fields. */
export const looseObject = z.record(z.string(), z.unknown());
export const looseArray = z.array(z.unknown());
