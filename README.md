# Autonomous Web Agent

Autonomous Web Agent is a **local-first research application** that converts a plain-language task into a constrained, observable web-research workflow. It interprets an objective, produces a compact plan, finds several candidate sources, extracts page content with a controlled browser tool, preserves source-linked evidence, cross-checks observations, and synthesizes a cited result. The interface intentionally exposes **operational state and evidence**, not private model reasoning.

> The application is designed for **research and synthesis**. It does not perform purchases, send messages, submit forms, publish content, delete data, or modify accounts. Requests that mention such consequential actions pause for explicit confirmation; even after confirmation, this MVP only continues the read-only research flow.

## Architecture

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Web application | React, TypeScript, Tailwind CSS, Express, tRPC | Brutalist task console, observable execution state, typed API boundary, and persistence. |
| Local intelligence | Ollama | Interprets research tasks, proposes safe plans, and synthesizes evidence-backed prose. It is configurable with environment variables. |
| Web research | Playwright + Chromium, with a read-only HTTP fallback | Opens public pages and extracts relevant page text without exposing application secrets. |
| State and evidence | MySQL via Drizzle ORM | Persists the request, parsed objective, plan, activity events, sources, evidence, retries, findings, result, and confirmation state. |
| Guardrails | Server-side validators | Block local/private URLs, constrain tool inputs, time-bound requests, isolate prompt-injection-like page text, and stop high-impact tasks for confirmation. |

## Research lifecycle

Every task is first interpreted by the local model, which decides whether it actually needs a web search:

- **Needs current / web-verifiable information** (news, prices, live data, facts that change over time, etc.) → the task moves through the full research pipeline: `PLAN → SEARCH → BROWSE → COLLECT → VERIFY → COMPARE → COMPLETE`.
- **Answerable from general knowledge** (arithmetic and other calculations, definitions, established facts, coding/writing help, etc.) → the local model answers the task directly from its own knowledge. No search, browsing, or source collection happens, and the run completes immediately after planning.

If the local model is unreachable, a deterministic fallback takes over: obvious calculations and time-sensitive phrasing ("today", "current", "latest", "price", "news", etc.) are routed heuristically, defaulting to a web search whenever the fallback can't tell.

The execution loop is deliberately separate from the UI. When a search is performed, the local model selects only from a small allowlist of research actions, and the application validates the action arguments before executing them. Search results are not treated as facts; the agent opens source pages where possible and records source-linked excerpts. Evidence is labelled **corroborated**, **single-source**, **conflicting**, or **uncertain**. Any unavailable page or model failure is surfaced in the exception ledger rather than silently hidden.

## Local setup on Windows

### 1. Install Node.js

Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/). Open a new PowerShell window and confirm that Node.js is available:

```powershell
node --version
corepack enable
```

### 2. Install Ollama

Download and install Ollama for Windows from [ollama.com/download](https://ollama.com/download). Ollama normally starts its local service automatically. If it is not running, start it from a PowerShell terminal:

```powershell
ollama serve
```

### 3. Download a local instruction model

In a second PowerShell terminal, download the default configured model:

```powershell
ollama pull qwen2.5:7b-instruct
```

You may use another capable local instruction model, provided that its name is set in `OLLAMA_MODEL`.

### 4. Install the project and Chromium

From the project folder, install JavaScript packages and the browser binary used by Playwright:

```powershell
pnpm install
pnpm exec playwright install chromium
```

If `pnpm` is unavailable, Corepack should install it after the `corepack enable` command above. You can also use `corepack pnpm install`.

### 5. Configure environment variables

Copy the local environment template and adjust it if you selected a different model or a non-default Ollama host:

```powershell
Copy-Item env.example .env
```

The defaults expect Ollama on `http://127.0.0.1:11434` and `qwen2.5:7b-instruct`. Keep `LOCAL_WINDOWS_RUNTIME=true` in the copied `.env` file when running on your Windows computer. Set `BROWSER_MODE=fetch` if Chromium cannot be installed; the agent will retain basic read-only page extraction but will not have full browser rendering support. The console calls the Ollama health check only when both the app is served from `localhost` and `LOCAL_WINDOWS_RUNTIME=true`; hosted environments never attempt to contact the `127.0.0.1` Ollama endpoint.

### 6. Start the development server

```powershell
pnpm dev
```

Open the local URL shown in the terminal. Enter a research task such as:

> Compare current residential solar-incentive policies in California using official sources. Identify the program names, material eligibility constraints, and any information that could not be independently verified.

The status rail will show each execution phase. The source registry and evidence ledger appear after the agent has collected material. If Ollama is unavailable, the system uses a deterministic research-plan fallback and reports that condition in the activity log.

### Optional: enable durable run history

The agent runs without a database by keeping active research runs in memory. This is the recommended route for the first Windows-local launch. To persist runs across server restarts, install and run a MySQL-compatible database, add `DATABASE_URL` to `.env`, then run:

```powershell
pnpm db:migrate
```

Do **not** run any Drizzle command until `DATABASE_URL` is set. The database is optional and is not required for `pnpm dev`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Base URL of the local Ollama service. |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Local instruction model used for interpretation, planning, and synthesis. |
| `OLLAMA_TIMEOUT_MS` | `30000` | Maximum local-model request time. |
| `BROWSER_MODE` | `playwright` | Browser mode: `playwright` for Chromium, `fetch` for read-only fallback extraction. |
| `AGENT_MAX_SOURCES` | `6` | Intended cap for discovered sources. |
| `AGENT_REQUEST_TIMEOUT_MS` | `12000` | Intended cap for a single network or browser action. |
| `AGENT_MAX_RETRIES` | `2` | Intended retry limit for recoverable failures. |

## Safety model

The agent keeps page content separate from trusted application instructions. It does not execute arbitrary action requests received from a web page. It rejects non-HTTP(S), local, link-local, and private-network URLs; does not pass application secrets into page contexts; applies bounded page and request limits; and records recoverable tool failures as visible activity events. The model is asked to select from predeclared research tools only, while the server independently validates every tool request.

High-impact language such as `purchase`, `submit`, `send email`, `delete`, `transfer`, or `publish` creates a visible confirmation gate. The confirmation UI is intentionally explicit. In this MVP, confirmation permits continued **research only**; it does not authorize an irreversible web action.

## Development checks

Run the following before committing or sharing changes:

```powershell
pnpm check
pnpm test
```

The test suite covers the input, URL, prompt-injection, and high-impact action safeguards. Browser-based behavior should also be manually checked in the console using a low-risk research task.

## If Windows reports a missing `server/agent` module

Current versions of the startup path do **not** import `server/agent/safety.ts`; safety checks are embedded in the two runtime modules that use them. The separate `server/agent/safety.test.ts` file is test-only. If Windows still reports a missing `safety.ts` runtime module, the local folder contains an older copy of `workflow.ts` or `webTools.ts`.

First, stop the development server. Download the source archive from the latest project checkpoint, extract it into a **new** folder, and replace the old local project folder rather than merging selected files. In the extracted folder, verify the required runtime files:

```powershell
Get-ChildItem .\server\agent
Test-Path .\server\agent\safety.ts
```

The folder must include `ollama.ts`, `webTools.ts`, and `workflow.ts`, in addition to any `*.test.ts` files. `safety.ts` may remain present for test coverage, but it is not required to start the current server. Then reinstall the lockfile dependencies and restart:

```powershell
pnpm install
Copy-Item env.example .env -Force
pnpm dev
```

## Scope and limitations

The current browser workflow focuses on public, read-only research pages. It does not log into sites, evade access controls, complete forms, manipulate accounts, or run background jobs. Pages blocked by anti-bot systems, JavaScript challenges, robots policy, network failure, or unsupported content types are reported as exceptions. Evidence classification is a heuristic signal, not a substitute for domain-expert review. Always inspect cited sources before using a result for material, legal, medical, financial, or safety-critical decisions.
