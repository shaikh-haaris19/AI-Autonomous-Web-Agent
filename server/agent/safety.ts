import type { SafeToolRequest } from "@shared/agent";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"]);
const HIGH_IMPACT_PATTERN = /\b(buy|purchase|checkout|place order|submit|send (?:an )?(?:email|message)|delete|remove account|transfer|pay|publish|post)\b/i;

export function findHighImpactAction(task: string) {
  const match = task.match(HIGH_IMPACT_PATTERN);
  return match ? {
    action: match[0],
    reason: "This request includes an action that could create an external or irreversible consequence.",
    required: true,
  } : null;
}

export function validateExternalUrl(value: string): { ok: true } | { ok: false; reason: string } {
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

export function validateToolRequest(request: SafeToolRequest): { ok: true } | { ok: false; reason: string } {
  if (request.tool === "web_search") {
    if (!request.query?.trim()) return { ok: false, reason: "Search requests require a query." };
    return request.query.length <= 500 ? { ok: true } : { ok: false, reason: "Search query exceeds the permitted length." };
  }
  return request.url ? validateExternalUrl(request.url) : { ok: false, reason: "This action requires a URL." };
}

export function containsPromptInjection(value: string) {
  return /\b(ignore (?:all|previous|the above)|system prompt|developer message|jailbreak|reveal (?:your )?instructions|act as|do not follow)\b/i.test(value);
}

export function sanitizeExtractedText(value: string): { text: string; injectionDetected: boolean } {
  const text = value.replace(/\s+/g, " ").trim().slice(0, 12_000);
  return { text, injectionDetected: containsPromptInjection(text) };
}
