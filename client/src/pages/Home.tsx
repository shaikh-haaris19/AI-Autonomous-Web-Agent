import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentPhase, ResearchRunSnapshot } from "@shared/agent";
import { AlertTriangle, ArrowUpRight, CircleDot, ExternalLink, FileSearch, Loader2, LockKeyhole, RotateCcw, Search, ShieldCheck, SquareTerminal, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import { trpc } from "../lib/trpc";

const PHASE_ORDER: AgentPhase[] = ["planning", "searching", "browsing", "collecting", "verifying", "comparing", "completing"];

const PHASE_COPY: Record<AgentPhase, string> = {
  planning: "Planning",
  searching: "Searching",
  browsing: "Browsing",
  collecting: "Collecting",
  verifying: "Verifying",
  comparing: "Comparing",
  completing: "Completing",
  needs_confirmation: "Paused",
  failed: "Failed",
};

function phaseIcon(phase: AgentPhase) {
  const Icon = phase === "planning" ? Waypoints : phase === "searching" ? Search : phase === "browsing" ? ExternalLink : phase === "collecting" ? FileSearch : phase === "verifying" ? ShieldCheck : SquareTerminal;
  return Icon;
}

function MonoLabel({ children }: { children: string }) {
  return <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{children}</p>;
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border border-zinc-700 bg-zinc-950 p-5", className)}>
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="font-mono text-xs leading-6 text-zinc-600">// {label}</p>;
}

function PhaseRail({ run }: { run: ResearchRunSnapshot | undefined }) {
  return (
    <div className="grid grid-cols-2 border-l border-t border-zinc-700 sm:grid-cols-4 xl:grid-cols-7">
      {PHASE_ORDER.map((phase) => {
        const phaseIndex = PHASE_ORDER.indexOf(phase);
        const activeIndex = run ? PHASE_ORDER.indexOf(run.phase) : -1;
        const complete = run?.status === "completed" || activeIndex > phaseIndex;
        const active = run?.phase === phase;
        const Icon = phaseIcon(phase);
        return (
          <div key={phase} className={cn("min-h-24 border-b border-r border-zinc-700 p-3", active && "bg-[#e52222] text-white", complete && !active && "bg-zinc-900") }>
            <div className="flex items-start justify-between gap-2">
              <Icon className="h-4 w-4" strokeWidth={2.5} />
              <span className="font-mono text-[9px]">0{phaseIndex + 1}</span>
            </div>
            <p className="mt-6 text-xl font-bold uppercase leading-none tracking-wide">{PHASE_COPY[phase]}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [task, setTask] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [confirmationDismissed, setConfirmationDismissed] = useState(false);
  const utils = trpc.useUtils();
  const healthQuery = trpc.agent.localHealth.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const runQuery = trpc.agent.get.useQuery({ runId: runId || "pending-run" }, { enabled: Boolean(runId), refetchInterval: (query) => {
    const status = query.state.data?.status;
    return status === "running" || status === "queued" ? 1100 : false;
  }});
  const createMutation = trpc.agent.create.useMutation({
    onSuccess: (run) => {
      setRunId(run.id);
      setConfirmationDismissed(false);
      utils.agent.get.setData({ runId: run.id }, run);
      executeMutation.mutate({ runId: run.id });
    },
  });
  const executeMutation = trpc.agent.execute.useMutation({
    onSuccess: (run) => {
      utils.agent.get.setData({ runId: run.id }, run);
    },
  });
  const run = runQuery.data;
  const isWorking = createMutation.isPending || executeMutation.isPending || run?.status === "running" || run?.status === "queued";
  const showConfirmation = run?.status === "needs_confirmation" && !confirmationDismissed;

  useEffect(() => {
    if (run?.status !== "needs_confirmation") setConfirmationDismissed(false);
  }, [run?.status]);

  const submitTask = () => {
    if (task.trim().length >= 8 && !isWorking) createMutation.mutate({ task: task.trim() });
  };

  return (
    <main className="min-h-screen bg-black text-white selection:bg-red-600">
      <div className="h-3 w-full bg-[#e52222]" />
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-7 lg:px-10">
        <header className="grid gap-6 border-b-2 border-zinc-200 pb-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-center gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-red-500"><CircleDot className="h-3.5 w-3.5 fill-red-500" /> Autonomous research terminal / v0.1</div>
            <h1 className="mt-3 max-w-4xl text-6xl font-black uppercase leading-[0.82] tracking-[-0.055em] sm:text-8xl lg:text-[8.5rem]">Web<br />Agent</h1>
          </div>
          <div className="max-w-xs border-l-2 border-[#e52222] pl-4 font-mono text-xs leading-5 text-zinc-400">
            Plans, searches, reads, verifies and reports. Operational summaries only. Private reasoning never shown.
          </div>
        </header>

        <section className="grid gap-0 border-b border-zinc-700 py-7 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="border border-zinc-700 bg-zinc-950 p-4 sm:p-6">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <MonoLabel>01 / Task Directive</MonoLabel>
                <p className="mt-2 text-2xl font-bold uppercase tracking-wide">State the objective. The system selects the route.</p>
              </div>
              <p className="max-w-[240px] font-mono text-[10px] leading-5 text-zinc-500">SEARCH / BROWSE / COLLECT / VERIFY / COMPARE / SYNTHESIZE</p>
            </div>
            <textarea
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitTask(); }}
              disabled={isWorking}
              placeholder="e.g. Compare the latest policies affecting residential solar incentives in California. Use official sources and explain uncertainty."
              className="mt-6 min-h-36 w-full resize-y border-y border-zinc-600 bg-black px-0 py-4 text-2xl font-semibold leading-tight text-white outline-none placeholder:text-zinc-600 focus:border-red-500 disabled:opacity-50 sm:text-3xl"
              aria-label="Research task"
            />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Ctrl / Cmd + Enter to launch</p>
              <Button onClick={submitTask} disabled={task.trim().length < 8 || isWorking} className="h-auto rounded-none bg-[#e52222] px-6 py-3 text-xl font-extrabold uppercase tracking-wide text-white hover:bg-white hover:text-black disabled:bg-zinc-800 disabled:text-zinc-500">
                {isWorking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Executing</> : <>Run research <ArrowUpRight className="ml-2 h-5 w-5" /></>}
              </Button>
            </div>
            {createMutation.error ? <p className="mt-4 font-mono text-xs text-red-400">INPUT ERROR // {createMutation.error.message}</p> : null}
          </div>
          <div className="border border-t-0 border-zinc-700 bg-white p-5 text-black lg:border-l-0 lg:border-t">
            <MonoLabel>Execution State</MonoLabel>
            <p className="mt-4 text-5xl font-black uppercase leading-[0.85] tracking-[-0.04em]">{run ? PHASE_COPY[run.phase] : "Standby"}</p>
            <div className="mt-7 border-t border-black pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider">{run?.status || "Awaiting directive"}</p>
              <p className="mt-2 text-lg font-semibold leading-tight">{run?.currentAction || "Enter a task to initialize a controlled research run."}</p>
            </div>
            <div className="mt-5 border-t border-black pt-3">
              <p className="font-mono text-[10px] uppercase tracking-wider">Local Ollama</p>
              <p className={cn("mt-1 font-mono text-[10px] leading-4", healthQuery.data?.available ? "text-lime-700" : "text-zinc-600")}>{healthQuery.isLoading ? "CHECKING LOCAL RUNTIME..." : healthQuery.data?.available ? `READY / ${healthQuery.data.model}` : healthQuery.data?.checked ? "LOCAL SERVICE OFFLINE" : "CHECKED ONLY IN LOCAL WINDOWS MODE"}</p>
            </div>
            {run?.interpretation ? (
              <div className="mt-5 border-t border-black pt-3">
                <p className="font-mono text-[10px] uppercase tracking-wider">Route</p>
                <p className="mt-1 font-mono text-[10px] leading-4 text-zinc-700">{run.interpretation.needsWebSearch ? "WEB SEARCH / MODEL FLAGGED NEED FOR CURRENT INFO" : "DIRECT ANSWER / NO SEARCH PERFORMED"}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="pt-6">
          <div className="mb-3 flex items-center justify-between"><MonoLabel>Live Execution Rail</MonoLabel><p className="font-mono text-[10px] text-zinc-600">STATUS / NOT REASONING</p></div>
          <PhaseRail run={run} />
        </section>

        <section className="grid gap-0 py-6 xl:grid-cols-[0.88fr_1.15fr_0.97fr]">
          <Cell label="02 / Current plan" className="border-b-0 xl:border-r-0 xl:border-b">
            {run?.plan.length ? <ol className="space-y-0">{run.plan.map((step, index) => <li key={step.id} className="flex gap-3 border-t border-zinc-800 py-3 first:border-t-0"><span className="font-mono text-xs text-red-500">0{index + 1}</span><div><p className="text-lg font-bold uppercase leading-none">{step.title}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">{step.status} / {step.tool.replace("_", " ")}</p></div></li>)}</ol> : <EmptyState label="PLAN WILL APPEAR AFTER TASK INTERPRETATION" />}
          </Cell>
          <Cell label="03 / Agent activity" className="border-b-0 xl:border-r-0 xl:border-b">
            <div className="max-h-[285px] space-y-0 overflow-y-auto pr-1">
              {run?.activities.length ? run.activities.slice().reverse().map((activity) => <div key={activity.id} className="border-t border-zinc-800 py-3 first:border-t-0"><div className="flex justify-between gap-4"><p className="font-mono text-[10px] uppercase tracking-wider text-red-500">{PHASE_COPY[activity.phase]}</p><time className="font-mono text-[10px] text-zinc-600">{new Date(activity.timestamp).toLocaleTimeString()}</time></div><p className="mt-1 text-base font-semibold leading-tight">{activity.message}</p>{activity.url ? <p className="mt-1 truncate font-mono text-[10px] text-zinc-500">{activity.url}</p> : null}</div>) : <EmptyState label="NO ACTIONS RECORDED" />}
            </div>
          </Cell>
          <Cell label="04 / System limits">
            <div className="space-y-4 font-mono text-xs leading-5 text-zinc-400"><p><span className="text-white">READ-ONLY WEB TOOLS.</span> External submissions, messages, purchases, deletions and publishing are blocked.</p><p><span className="text-white">PAGE CONTENT IS UNTRUSTED.</span> Instruction-like text is screened and never treated as agent direction.</p><p><span className="text-white">CONSEQUENTIAL REQUESTS PAUSE.</span> Explicit user confirmation is required before research can continue.</p></div>
          </Cell>
        </section>

        <section className="grid gap-0 border-t border-zinc-700 py-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Cell label="05 / Research output" className="border-b-0 lg:border-r-0 lg:border-b">
            {run?.finalAnswer ? <article className="prose prose-invert prose-zinc max-w-none font-sans prose-headings:font-sans prose-headings:uppercase prose-headings:tracking-tight prose-p:font-mono prose-p:text-sm prose-p:leading-6"><Streamdown>{run.finalAnswer}</Streamdown></article> : <div className="min-h-48"><EmptyState label="FINAL ANSWER WILL ARRIVE AFTER SOURCE COLLECTION AND VERIFICATION" /></div>}
          </Cell>
          <Cell label="06 / Evidence ledger">
            <div className="max-h-[420px] space-y-0 overflow-y-auto pr-1">
              {run?.evidence.length ? run.evidence.map((item) => { const source = run.sources.find((record) => record.id === item.sourceId); return <div key={item.id} className="border-t border-zinc-800 py-3 first:border-t-0"><div className="flex items-center justify-between gap-3"><p className={cn("font-mono text-[10px] uppercase tracking-wider", item.verification === "corroborated" ? "text-lime-400" : item.verification === "conflicting" ? "text-red-400" : "text-amber-400")}>{item.verification.replace("_", " ")}</p><p className="font-mono text-[9px] text-zinc-600">{source?.domain}</p></div><p className="mt-1 text-base font-semibold leading-tight">{item.claim}</p><p className="mt-2 font-mono text-xs leading-5 text-zinc-400">{item.excerpt}</p></div>}) : <EmptyState label="NO SOURCE-LINKED EVIDENCE YET" />}
            </div>
          </Cell>
        </section>

        <section className="grid gap-0 border-t border-zinc-700 pb-8 pt-6 lg:grid-cols-[1fr_1fr]">
          <Cell label="07 / Source registry" className="border-b-0 lg:border-r-0 lg:border-b">
            {run?.sources.length ? <div className="grid gap-2">{run.sources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-3 border-t border-zinc-800 py-3 first:border-t-0 hover:text-red-400"><div className="min-w-0"><p className="text-lg font-bold leading-none">[{index + 1}] {source.title}</p><p className="mt-1 font-mono text-[10px] uppercase text-zinc-500">{source.authority} / {source.visited ? "read" : "queued"} / {source.domain}</p>{source.summary ? <p className="mt-2 font-mono text-xs leading-5 text-zinc-400">{source.summary}</p> : null}</div><ExternalLink className="h-4 w-4 shrink-0" /></a>)}
</div> : <EmptyState label="SOURCES DISCOVERED DURING EXECUTION APPEAR HERE" />}
          </Cell>
          <Cell label="08 / Exceptions">
            {run?.errors.length ? <div className="space-y-3">{run.errors.map((error, index) => <div key={`${error}-${index}`} className="flex gap-3 border-t border-red-950 py-3 first:border-t-0"><AlertTriangle className="h-4 w-4 shrink-0 text-red-500" /><p className="font-mono text-xs leading-5 text-zinc-300">{error}</p></div>)}</div> : <div className="flex items-center gap-3"><RotateCcw className="h-4 w-4 text-zinc-600" /><EmptyState label="NO RETRIES OR ERRORS REPORTED" /></div>}
          </Cell>
        </section>

        <footer className="flex flex-col justify-between gap-3 border-t border-zinc-700 pt-4 font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-600 sm:flex-row"><p>Autonomous Web Agent / Evidence-first research workflow</p><p>High-impact actions require confirmation / private reasoning withheld</p></footer>
      </div>

      <AlertDialog open={showConfirmation}>
        <AlertDialogContent className="rounded-none border-2 border-[#e52222] bg-black text-white sm:max-w-lg">
          <AlertDialogHeader><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-red-500"><LockKeyhole className="h-4 w-4" /> Consequential action blocked</div><AlertDialogTitle className="text-4xl font-black uppercase leading-none tracking-tight">Confirm research continuation</AlertDialogTitle><AlertDialogDescription className="font-mono text-xs leading-5 text-zinc-400">{run?.confirmation?.reason} This MVP remains read-only: it will not complete an external action. Confirmation only permits the evidence-gathering workflow to continue.</AlertDialogDescription></AlertDialogHeader>
          <div className="border-y border-zinc-700 py-3 font-mono text-xs text-zinc-300">DETECTED: {run?.confirmation?.action?.toUpperCase()}</div>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmationDismissed(true)} className="rounded-none border-zinc-600 bg-black text-white hover:bg-zinc-900 hover:text-white">Hold task</AlertDialogCancel><AlertDialogAction onClick={() => runId && executeMutation.mutate({ runId, confirmationApproved: true })} className="rounded-none bg-[#e52222] font-bold uppercase hover:bg-white hover:text-black">Confirm &amp; research</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
