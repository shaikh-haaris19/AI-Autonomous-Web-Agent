import { chromium } from "playwright";
import type { SafeToolRequest } from "@shared/agent";

const AGENT_LIMITS = {
  maxSources: 6,
  maxPageCharacters: 12_000,
  requestTimeoutMs: 12_000,
};
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);

function validateExternalUrl(value: string): { ok: true } | { ok: false; reason: string } {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only HTTP and HTTPS pages may be opened." };
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(host)) {
      return { ok: false, reason: "Private or local network targets are not permitted." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "The supplied URL is invalid." };
  }
}

function validateToolRequest(request: SafeToolRequest): { ok: true } | { ok: false; reason: string } {
  if (request.tool === "web_search") {
    if (!request.query?.trim()) return { ok: false, reason: "Search requests require a query." };
    return request.query.length <= 500 ? { ok: true } : { ok: false, reason: "Search query exceeds the permitted length." };
  }
  return request.url ? validateExternalUrl(request.url) : { ok: false, reason: "This action requires a URL." };
}

function sanitizeExtractedText(value: string): { text: string; injectionDetected: boolean } {
  const text = value.replace(/\s+/g, " ").trim().slice(0, AGENT_LIMITS.maxPageCharacters);
  const injectionDetected = /\b(ignore (?:all|previous|the above)|system prompt|developer message|jailbreak|reveal (?:your )?instructions|act as|do not follow)\b/i.test(text);
  return { text, injectionDetected };
}

export type SearchHit = { title: string; url: string; summary: string };
export type PageExtraction = { title: string; url: string; text: string; injectionDetected: boolean; method: "playwright" | "fetch" };

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const CONTENT_BLOCK_PATTERN = /<(?:h[1-6]|p|li|blockquote|dt|dd|td|th)\b[^>]*>([\s\S]*?)<\/(?:h[1-6]|p|li|blockquote|dt|dd|td|th)>/gi;
const NOISE_BLOCK_PATTERN = /<(script|style|noscript|template|svg|canvas|iframe|nav|header|footer|aside|form|button|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;

export function extractReadableTextFromHtml(html: string) {
  const withoutNoise = html.replace(/<!--[\s\S]*?-->/g, " ").replace(NOISE_BLOCK_PATTERN, " ");
  const blocks = Array.from(withoutNoise.matchAll(CONTENT_BLOCK_PATTERN))
    .map((match) => stripHtml(match[1]))
    .filter((block) => block.length >= 20);
  const structuredText = Array.from(new Set(blocks)).join(" ").trim();
  const fallbackText = stripHtml(withoutNoise);
  return structuredText.length >= 240 ? structuredText : fallbackText;
}

export function extractReadableTextFromDom(root: Element) {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, noscript, template, svg, canvas, iframe, nav, header, footer, aside, form, button, select, textarea").forEach((node) => node.remove());
  const blocks = Array.from(clone.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd, td, th"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
    .filter((block) => block.length >= 20);
  const structuredText = Array.from(new Set(blocks)).join(" ").trim();
  const fallbackText = clone.textContent?.replace(/\s+/g, " ").trim() || "";
  return structuredText.length >= 240 ? structuredText : fallbackText;
}

function unwrapResultUrl(value: string) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    return url.searchParams.get("uddg") || url.toString();
  } catch {
    return value;
  }
}

export async function webSearch(query: string): Promise<SearchHit[]> {
  const validation = validateToolRequest({ tool: "web_search", query });
  if (!validation.ok) throw new Error(validation.reason);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_LIMITS.requestTimeoutMs);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutonomousResearchAgent/1.0)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`);
    const html = await response.text();
    const matches = Array.from(html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
    const hits = matches.map((match) => {
      const matchEnd = (match.index || 0) + match[0].length;
      const resultTail = html.slice(matchEnd, matchEnd + 4_000);
      const snippet = resultTail.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] || "";
      return {
        title: stripHtml(match[2]),
        url: unwrapResultUrl(match[1]),
        summary: stripHtml(snippet) || "Discovered through web search; the source page will be opened for full content.",
      };
    }).filter((hit) => validateExternalUrl(hit.url).ok);
    return hits.slice(0, AGENT_LIMITS.maxSources);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_LIMITS.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AutonomousResearchAgent/1.0)" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Page returned HTTP ${response.status}.`);
    const finalValidation = validateExternalUrl(response.url);
    if (!finalValidation.ok) throw new Error(finalValidation.reason);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error("The page does not provide readable HTML or text content.");
    }
    return { html: await response.text(), finalUrl: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

export async function openPage(url: string): Promise<PageExtraction> {
  const validation = validateToolRequest({ tool: "open_page", url });
  if (!validation.ok) throw new Error(validation.reason);

  if (process.env.BROWSER_MODE !== "fetch") {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({ headless: true, timeout: AGENT_LIMITS.requestTimeoutMs });
      const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; AutonomousResearchAgent/1.0)" });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: AGENT_LIMITS.requestTimeoutMs });
      const finalUrl = page.url();
      const finalValidation = validateExternalUrl(finalUrl);
      if (!finalValidation.ok) throw new Error(finalValidation.reason);
      const title = await page.title();
      const rawText = await page.locator("body").evaluate((body) => {
        const clone = body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, noscript, template, svg, canvas, iframe, nav, header, footer, aside, form, button, select, textarea").forEach((node) => node.remove());
        const blocks = Array.from(clone.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd, td, th"))
          .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
          .filter((block) => block.length >= 20);
        const structuredText = Array.from(new Set(blocks)).join(" ").trim();
        const fallbackText = clone.textContent?.replace(/\s+/g, " ").trim() || "";
        return structuredText.length >= 240 ? structuredText : fallbackText;
      });
      const cleaned = sanitizeExtractedText(rawText);
      return { title: title || new URL(finalUrl).hostname, url: finalUrl, text: cleaned.text, injectionDetected: cleaned.injectionDetected, method: "playwright" };
    } catch {
      // A local Playwright browser may not be installed. The read-only HTTP fallback preserves basic research capability.
    } finally {
      await browser?.close();
    }
  }

  const { html, finalUrl } = await fetchWithTimeout(url);
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || new URL(finalUrl).hostname;
  const cleaned = sanitizeExtractedText(extractReadableTextFromHtml(html));
  return { title, url: finalUrl, text: cleaned.text, injectionDetected: cleaned.injectionDetected, method: "fetch" };
}
