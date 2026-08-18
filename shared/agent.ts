export const AGENT_PHASES = [
  "planning",
  "searching",
  "browsing",
  "collecting",
  "verifying",
  "comparing",
  "completing",
  "needs_confirmation",
  "failed",
] as const;

export type AgentPhase = (typeof AGENT_PHASES)[number];
export type RunStatus = "queued" | "running" | "completed" | "needs_confirmation" | "failed";
export type VerificationStatus = "corroborated" | "single_source" | "conflicting" | "uncertain";
export type ActivityKind = "system" | "plan" | "tool" | "source" | "verification" | "error" | "confirmation";

export type TaskInterpretation = {
  objective: string;
  constraints: string[];
  outputFormat: string;
  entities: string[];
  needsComparison: boolean;
  /**
   * Whether answering this task actually requires up-to-date, real-time, or otherwise
   * web-verifiable information (current events, prices, live data, recent changes, facts
   * about entities that could have changed, etc). When false, the local model answers the
   * task directly from its own knowledge and no web search or browsing is performed.
   */
  needsWebSearch: boolean;
};

export type PlanStep = {
  id: string;
  title: string;
  purpose: string;
  status: "pending" | "active" | "completed" | "blocked" | "skipped";
  tool: "web_search" | "open_page" | "extract_content" | "verify_claims" | "compare_results" | "synthesize" | "answer_directly";
};

export type SourceRecord = {
  id: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  authority: "primary" | "reputable" | "unknown";
  visited: boolean;
};

export type EvidenceRecord = {
  id: string;
  sourceId: string;
  claim: string;
  excerpt: string;
  verification: VerificationStatus;
  relatedSourceIds: string[];
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  phase: AgentPhase;
  kind: ActivityKind;
  message: string;
  url?: string;
  retry?: number;
};

export type ConfirmationRequest = {
  action: string;
  reason: string;
  target?: string;
  required: boolean;
};

export type ResearchRunSnapshot = {
  id: string;
  originalRequest: string;
  interpretation: TaskInterpretation | null;
  status: RunStatus;
  phase: AgentPhase;
  currentAction: string;
  plan: PlanStep[];
  sources: SourceRecord[];
  evidence: EvidenceRecord[];
  activities: ActivityEvent[];
  visitedUrls: string[];
  errors: string[];
  retries: number;
  finalAnswer: string | null;
  finalFindings: string[];
  confirmation: ConfirmationRequest | null;
  createdAt: string;
  updatedAt: string;
};

export type ToolName = PlanStep["tool"];

export type SafeToolRequest = {
  tool: ToolName;
  query?: string;
  url?: string;
};
