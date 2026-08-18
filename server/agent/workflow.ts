import { nanoid } from "nanoid";
import type { ActivityEvent, AgentPhase, ConfirmationRequest, EvidenceRecord, PlanStep, ResearchRunSnapshot, SourceRecord, TaskInterpretation, VerificationStatus } from "@shared/agent";
import { createResearchRun, getResearchRun, updateResearchRun } from "../db.ts";
import { answerDirectly, createPlan, interpretTask, synthesizeAnswer } from "./ollama.ts";
import { openPage, webSearch } from "./webTools.ts";

const AGENT_LIMITS = { maxSources: 6 };
const HIGH_IMPACT_PATTERN = /\b(buy|purchase|checkout|place order|submit|send (?:an )?(?:email|message)|delete|remove account|transfer|pay|publish|post)\b/i;

// Heuristics used only when the local model is unreachable and interpretTask falls back to a
// deterministic interpretation. When the model is available, it decides needsWebSearch itself.
const ARITHMETIC_ONLY_PATTERN = /^[\d\s+\-*/().^%,=]+$/;
const CALCULATION_LEAD_IN_PATTERN = /^(?:what(?:'s| is)|how much is|compute|calculate)\s+/i;
const CALCULATION_KEYWORD_PATTERN = /\b(calculate|compute|square root|cube root|factorial|derivative|integral|solve for|simplify|percent of|multiplied by|divided by)\b/i;
const TIME_SENSITIVE_PATTERN = /\b(today|right now|current(?:ly)?|latest|recent(?:ly)?|this (?:week|month|year)|breaking|news|price|stock|score|weather|forecast|who is the (?:current|new)|as of \d{4})\b/i;

function looksLikeArithmetic(task: string): boolean {
  const stripped = task.replace(CALCULATION_LEAD_IN_PATTERN, "").replace(/\?+$/, "").trim();
  return stripped.length > 0 && /\d/.test(stripped) && ARITHMETIC_ONLY_PATTERN.test(stripped);
}

function heuristicNeedsWebSearch(task: string): boolean {
  const trimmed = task.trim();
  if (looksLikeArithmetic(trimmed) || CALCULATION_KEYWORD_PATTERN.test(trimmed)) return false;
  if (TIME_SENSITIVE_PATTERN.test(trimmed)) return true;
  // Without the local model's judgment, default to searching so factual claims stay verifiable.
  return true;
}

function findHighImpactAction(task: string): ConfirmationRequest | null {
  const match = task.match(HIGH_IMPACT_PATTERN);
  return match ? {
    action: match[0],
    reason: "This request includes an action that could create an external or irreversible consequence.",
    required: true,
  } : null;
}

const activeRuns = new Map<string, ResearchRunSnapshot>();

function now() {
  return new Date().toISOString();
}

function fallbackInterpretation(task: string): TaskInterpretation {
  return {
    objective: task.trim(),
    constraints: ["Use multiple sources when available", "Cite all key claims", "Flag uncertainty"],
    outputFormat: "Concise research summary with cited sources",
    entities: [],
    needsComparison: /\b(compare|versus|vs\.?|best|which)\b/i.test(task),
    needsWebSearch: heuristicNeedsWebSearch(task),
  };
}

function directAnswerPlan(): PlanStep[] {
  return [
    {
      id: "step-1",
      title: "Answer directly",
      purpose: "The local model determined this task does not require up-to-date or web-verifiable information, so it is answered directly from its own knowledge.",
      tool: "answer_directly",
      status: "pending",
    },
  ];
}

function fallbackDirectAnswer(run: ResearchRunSnapshot) {
  return [
    `## Direct answer`,
    `**Objective:** ${run.interpretation?.objective || run.originalRequest}`,
    "",
    "The local model was unavailable, so this task could not be answered directly. No web search was attempted because the task did not appear to require up-to-date information. Retry once the local model is reachable.",
  ].join("\n");
}

function fallbackPlan(interpretation: TaskInterpretation): PlanStep[] {
  const steps: Array<Pick<PlanStep, "title" | "purpose" | "tool">> = [
    { title: "Find independent sources", purpose: "Search broadly for relevant primary and reputable sources.", tool: "web_search" },
    { title: "Read source material", purpose: "Open the most relevant sources and extract objective content.", tool: "open_page" },
    { title: "Collect evidence", purpose: "Record source-linked observations relevant to the objective.", tool: "extract_content" },
    { title: "Cross-check claims", purpose: "Compare evidence across sources and flag uncertainty.", tool: "verify_claims" },
  ];
  if (interpretation.needsComparison) steps.push({ title: "Normalize comparisons", purpose: "Compare entities using consistent criteria.", tool: "compare_results" });
  steps.push({ title: "Synthesize result", purpose: "Produce a concise answer with linked evidence.", tool: "synthesize" });
  return steps.map((step, index) => ({ ...step, id: `step-${index + 1}`, status: "pending" }));
}

function authorityFor(url: string): SourceRecord["authority"] {
  const domain = new URL(url).hostname.toLowerCase();
  if (domain.endsWith(".gov") || domain.endsWith(".edu") || domain.includes("who.int") || domain.includes("europa.eu")) return "primary";
  if (domain.includes("reuters.com") || domain.includes("apnews.com") || domain.includes("bbc.") || domain.includes("nature.com")) return "reputable";
  return "unknown";
}

function markStep(run: ResearchRunSnapshot, tool: PlanStep["tool"], status: PlanStep["status"]) {
  const next = run.plan.find((step) => step.tool === tool && step.status === "pending") || run.plan.find((step) => step.tool === tool && step.status === "active");
  if (next) next.status = status;
}

async function persist(run: ResearchRunSnapshot) {
  run.updatedAt = now();
  activeRuns.set(run.id, structuredClone(run));
  await updateResearchRun(run);
}

async function emit(run: ResearchRunSnapshot, phase: AgentPhase, kind: ActivityEvent["kind"], message: string, url?: string) {
  run.phase = phase;
  run.currentAction = message;
  run.activities.push({ id: nanoid(10), timestamp: now(), phase, kind, message, ...(url ? { url } : {}) });
  await persist(run);
}

function makeEvidence(sourceId: string, text: string): EvidenceRecord {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40);
  const excerpt = (sentences.slice(0, 4).join(" ") || text).slice(0, 1_200);
  const claim = (sentences[0] || text).slice(0, 420);
  return {
    id: nanoid(10),
    sourceId,
    claim,
    excerpt,
    verification: "single_source",
    relatedSourceIds: [],
  };
}

function evidenceTokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 5));
}

function includesNegation(value: string) {
  return /\b(no|not|never|neither|none|without|unable|cannot|can.t|didn.t|doesn.t|isn.t|wasn.t)\b/i.test(value);
}

function numbersIn(value: string) {
  return value.match(/\b\d+(?:[.,]\d+)?(?:%|\s?(?:million|billion|thousand|km|days|hours|years))?\b/gi) || [];
}

function appearsConflicting(left: string, right: string) {
  if (includesNegation(left) !== includesNegation(right)) return true;
  const leftNumbers = numbersIn(left);
  const rightNumbers = numbersIn(right);
  return leftNumbers.length > 0 && rightNumbers.length > 0 && leftNumbers.join("|") !== rightNumbers.join("|");
}

function verifyEvidence(evidence: EvidenceRecord[]) {
  for (const item of evidence) {
    const tokens = evidenceTokens(item.claim);
    const related = evidence.filter((other) => other.id !== item.id && Array.from(tokens).filter((token) => evidenceTokens(other.claim).has(token)).length >= 3);
    item.relatedSourceIds = related.map((relatedItem) => relatedItem.sourceId);
    const status: VerificationStatus = related.some((other) => appearsConflicting(item.claim, other.claim))
      ? "conflicting"
      : related.length
        ? "corroborated"
        : /\b(may|might|could|reportedly|allegedly|unclear|unknown)\b/i.test(item.claim)
          ? "uncertain"
          : "single_source";
    item.verification = status;
  }
}

function fallbackAnswer(run: ResearchRunSnapshot) {
  const evidenceLines = run.evidence.slice(0, 4).map((item) => {
    const sourceIndex = run.sources.findIndex((source) => source.id === item.sourceId) + 1;
    const qualifier = item.verification === "corroborated" ? "Corroborated" : "Single-source";
    return `- **${qualifier}:** ${item.excerpt || item.claim} [${sourceIndex}]`;
  });
  return [
    `## Research result`,
    `**Objective:** ${run.interpretation?.objective || run.originalRequest}`,
    "",
    "### Findings",
    evidenceLines.length ? evidenceLines.join("\n") : "No usable evidence could be collected from the available sources.",
    "",
    "### Limitations",
    "This run uses source-linked excerpts. Claims marked single-source should be independently checked before consequential use.",
  ].join("\n");
}

export async function createRun(task: string, userId?: number) {
  const timestamp = now();
  const run: ResearchRunSnapshot = {
    id: nanoid(18),
    originalRequest: task.trim(),
    interpretation: null,
    status: "queued",
    phase: "planning",
    currentAction: "Queued for safe task interpretation.",
    plan: [],
    sources: [],
    evidence: [],
    activities: [{ id: nanoid(10), timestamp, phase: "planning", kind: "system", message: "Research run created." }],
    visitedUrls: [],
    errors: [],
    retries: 0,
    finalAnswer: null,
    finalFindings: [],
    confirmation: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  activeRuns.set(run.id, run);
  await createResearchRun(run, userId);
  return run;
}

export async function readRun(id: string) {
  return activeRuns.get(id) || await getResearchRun(id);
}

export async function executeRun(id: string, confirmationApproved = false) {
  const run = await readRun(id);
  if (!run) throw new Error("Research run not found.");
  if (run.status === "completed") return run;

  if (!confirmationApproved) {
    const confirmation = findHighImpactAction(run.originalRequest);
    if (confirmation) {
      run.status = "needs_confirmation";
      run.phase = "needs_confirmation";
      run.confirmation = confirmation;
      await emit(run, "needs_confirmation", "confirmation", "Explicit confirmation is required before a high-impact action can proceed.");
      return run;
    }
  }

  run.status = "running";
  run.confirmation = null;
  await emit(run, "planning", "plan", "Interpreting the research objective and constraints.");

  try {
    try {
      run.interpretation = await interpretTask(run.originalRequest);
      await emit(run, "planning", "plan", "Local model parsed the objective and research constraints.");
    } catch {
      run.interpretation = fallbackInterpretation(run.originalRequest);
      await emit(run, "planning", "system", "Local model was unavailable; using a deterministic planning fallback.");
    }

    if (!run.interpretation.needsWebSearch) {
      run.plan = directAnswerPlan();
      markStep(run, "answer_directly", "active");
      await emit(run, "planning", "system", "Local model determined this task does not need up-to-date web information; answering directly without a search.");
      try {
        const candidate = await answerDirectly(run.originalRequest, run.interpretation);
        run.finalAnswer = candidate.trim().length ? candidate : fallbackDirectAnswer(run);
      } catch {
        run.finalAnswer = fallbackDirectAnswer(run);
      }
      run.finalFindings = [];
      markStep(run, "answer_directly", "completed");
      run.status = "completed";
      await emit(run, "completing", "system", "Research run completed by answering directly; no web search or browsing was performed.");
      return run;
    }

    try {
      run.plan = await createPlan(run.interpretation);
    } catch {
      run.plan = fallbackPlan(run.interpretation);
    }
    markStep(run, "web_search", "active");
    await persist(run);

    const searchQuery = `${run.interpretation.objective} official sources`;
    await emit(run, "searching", "tool", `Searching independent sources for: ${searchQuery}`);
    let hits = await webSearch(searchQuery);
    if (hits.length < 2) {
      await emit(run, "searching", "system", "Initial search returned limited results; refining the query.");
      hits = await webSearch(run.interpretation.objective);
    }
    if (!hits.length) throw new Error("No usable web-search results were found.");
    run.sources = hits.map((hit) => ({
      id: nanoid(10), title: hit.title, url: hit.url, domain: new URL(hit.url).hostname, summary: hit.summary,
      authority: authorityFor(hit.url), visited: false,
    }));
    markStep(run, "web_search", "completed");
    markStep(run, "open_page", "active");
    await emit(run, "searching", "source", `${run.sources.length} sources discovered and queued for review.`);

    for (const source of run.sources.slice(0, 4)) {
      try {
        await emit(run, "browsing", "tool", `Opening ${source.domain}`, source.url);
        const page = await openPage(source.url);
        run.visitedUrls.push(page.url);
        source.url = page.url;
        source.title = page.title || source.title;
        source.visited = true;
        source.summary = page.injectionDetected ? "Content was screened for suspicious instruction-like text; no such text was used." : page.text.slice(0, 280);
        if (page.injectionDetected) {
          await emit(run, "browsing", "system", `Suspicious instruction-like page content was isolated on ${source.domain}; it was not treated as agent guidance.`, source.url);
          continue;
        }
        const evidence = makeEvidence(source.id, page.text);
        if (evidence.claim.trim()) run.evidence.push(evidence);
        await emit(run, "collecting", "source", `Collected a source-linked excerpt from ${source.domain}.`, source.url);
      } catch (error) {
        run.retries += 1;
        const message = error instanceof Error ? error.message : "Unknown browser error.";
        run.errors.push(`Could not read ${source.domain}: ${message}`);
        await emit(run, "browsing", "error", `Could not read ${source.domain}; continuing with an alternative source.`);
      }
    }

    markStep(run, "open_page", "completed");
    markStep(run, "extract_content", "completed");
    markStep(run, "verify_claims", "active");
    await emit(run, "verifying", "verification", "Cross-checking source-linked findings and flagging their confidence.");
    verifyEvidence(run.evidence);
    markStep(run, "verify_claims", "completed");
    if (run.interpretation.needsComparison) {
      markStep(run, "compare_results", "completed");
      await emit(run, "comparing", "verification", "Normalized the available source observations for comparison.");
    }

    markStep(run, "synthesize", "active");
    await emit(run, "completing", "tool", "Synthesizing a concise answer with source references.");
    try {
      const candidate = await synthesizeAnswer({
        task: run.originalRequest,
        interpretation: run.interpretation,
        sources: run.sources.map(({ title, url, summary }) => ({ title, url, summary })),
        evidence: run.evidence.map((item) => {
          const source = run.sources.find((record) => record.id === item.sourceId);
          return {
            claim: item.claim,
            excerpt: item.excerpt,
            verification: item.verification,
            sourceTitle: source?.title || "Unknown source",
            sourceUrl: source?.url || "",
          };
        }),
      });
      run.finalAnswer = candidate.trim().length >= 120 ? candidate : fallbackAnswer(run);
    } catch {
      run.finalAnswer = fallbackAnswer(run);
    }
    run.finalFindings = run.evidence.slice(0, 5).map((item) => item.claim);
    markStep(run, "synthesize", "completed");
    run.status = "completed";
    await emit(run, "completing", "system", "Research run completed. Review source confidence before acting on single-source findings.");
    return run;
  } catch (error) {
    run.status = "failed";
    run.phase = "failed";
    const message = error instanceof Error ? error.message : "The research workflow encountered an unknown error.";
    run.errors.push(message);
    await emit(run, "failed", "error", message);
    return run;
  }
}
