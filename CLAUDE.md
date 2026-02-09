# DoublyAI — Agent Context Guide

## What Is This Project?

DoublyAI is an **explainable research platform** that generates professional-grade research reports where every factual claim ("Finding") is interactive — click it to see the Explanation panel with sources, reasoning, certainty scores, and supporting/contrary evidence.

**Target market:** Enterprise teams in financial services and VC (deal memos).
**V1 scope:** Equity research reports and pitch deck analysis. Two independent axes: **domain** (equity_research, pitch_deck) and **output format** (written_report, slide_deck). Architecture supports future domains (deal memo, scientific review, geopolitical analysis).

## Tech Stack

- **Frontend:** React 19 + Vite 6 (NOT Next.js — explicit founder preference)
- **Backend:** Express with SSE streaming (TypeScript via tsx)
- **AI:** Anthropic Claude API via `@anthropic-ai/sdk` ^0.39.0. Default model configurable via `ANTHROPIC_MODEL` env var (defaults to `claude-haiku-4-5`). Reasoning levels can override models per agent stage.
- **Storage:** S3-compatible object storage (Tigris on Fly.io) via `@aws-sdk/client-s3`
- **Testing:** Vitest + Testing Library + Playwright (browser tests)
- **CI/CD:** GitHub Actions (test, deploy, PR previews)
- **Deployment:** fly.io with Docker (node:22-slim)

## Architecture: Multi-Agent Pipeline

```
User Query → Classifier → Draft Answer → Researcher → Synthesizer → Verifier → Report
```

1. **Classifier** (`server/agents/classifier.ts`) — Identifies domain + output format, extracts ticker/company. Returns a `DomainProfile` with both `domain` and `outputFormat`
2. **Draft Answer** (`server/agents/draft-answer.ts`) — Quick preliminary answer using Haiku while the full pipeline runs. Non-critical; failures are logged and skipped
3. **Researcher** (`server/agents/researcher.ts`) — Gathers evidence items with sources. Domain-aware: uses different prompts for equity research vs pitch deck
4. **Synthesizer** (`server/agents/synthesizer.ts`) — Drafts findings. Format-aware: produces prose sections (written_report) or slide deck with layouts/speakerNotes (slide_deck)
5. **Verifier** (`server/agents/verifier.ts`) — Adversarial fact-checker, assigns certainty scores, removes weak findings. Preserves slide-specific fields when format is slide_deck

All agents use `tracedCreate()` from `server/anthropic-client.ts` which wraps the Anthropic SDK with tracing (request params, raw response, timing, token usage). The client has model fallback chains, model-specific max_tokens limits, and 120s timeout with 2 retries.

Pipeline orchestration is in `server/pipeline.ts` — accepts `isAborted` callback to bail out if client disconnects, optional `ConversationContext` for follow-up queries, and optional `preClassified` data to skip re-running the classifier.

### Reasoning Levels

Configurable quality/speed tradeoffs defined in `server/reasoning-levels.ts`:

| Level | Models | Findings | Evidence | Use Case |
|-------|--------|----------|----------|----------|
| `x-light` | Default (haiku) | 3-5 | 2+ items | Fast testing |
| `light` | Default (haiku) | 12-18 | 20+ items | Reduced scope |
| `heavy` | Sonnet for synth+verify | 25-35 | 40+ items | Production quality |
| `x-heavy` | Opus for research+synth+verify | 35-50 | 60+ items | Maximum thoroughness |

Default is `x-light`. Each level controls: models per agent, evidence count, findings count, explanation length, quote length, certainty threshold, and methodology detail.

## Key Design Patterns

### Finding/Explanation UX Pattern
The core UX innovation: every factual claim in the report is a `FindingSpan` component with a colored underline (green >90%, orange 50-90%, red <50%). Hovering/clicking reveals the `ExplanationPanel` on the right with supporting evidence, contrary evidence, and a certainty score.

### Content Array Pattern
Sections don't store raw text. Instead they use a content array that interleaves findings and connecting prose:
```json
[
  { "type": "finding", "id": "f1" },
  { "type": "text", "value": ", which suggests " },
  { "type": "finding", "id": "f2" },
  { "type": "text", "value": "." }
]
```
This lets the Report component dynamically render interactive findings inline with natural prose.

### Certainty Scoring Rubric
- **95-99%**: Requires 3+ corroborating sources AND 0 contrary evidence
- **85-94%**: 2+ corroborating sources
- **70-84%**: Credible with meaningful caveats
- **50-69%**: Significant uncertainty
- **25-49%**: Weak/speculative
- **<25%**: Auto-removed by verifier

### Domain vs Output Format (Two Independent Axes)
- **Domain** = research task (what to research): `equity_research`, `pitch_deck`
- **Output Format** = presentation style (how to present): `written_report`, `slide_deck`
- Each domain has a `defaultOutputFormat` but users can override (e.g., "slide deck about Tesla" = equity_research + slide_deck)
- The classifier detects both from the user query

### Domain Profiles
Configurable rubrics per research domain. V1 ships `equity_research` and `pitch_deck`. Located in `classifier.ts` as `DOMAIN_PROFILES` constant. Each profile defines:
- Source hierarchy (what sources are most authoritative)
- Certainty rubric style
- Evidence style (quantitative vs qualitative)
- Tone template
- Section structure
- Default output format
- Report meta options (e.g., rating options)

### Conversational Interface Pattern
The app uses a chat-based UI (`ChatPanel.tsx`) alongside the report view. Users submit queries via a message input, and the pipeline runs via SSE to `/api/chat`. The conversation state includes:
- `ChatMessage[]` — full message history (user + assistant messages with progress/trace/error data)
- `ConversationContext` — passed to agents with `previousReport` and `messageHistory` for follow-up queries
- Auto-save — after each successful pipeline run, the report + conversation are persisted to S3

### Classify-First Navigation Pattern
On the homepage, user query submission triggers a two-step flow:
1. `POST /api/classify` — fast classifier call returns `{ slug, domainProfile, trace }`
2. Navigate to `/reports/:slug` and start the full pipeline via `/api/chat` with `preClassified` data (skips re-running classifier)

This gives instant navigation feedback while the pipeline runs.

## Project Structure

```
doublyai/
├── CLAUDE.md                    <- You are here
├── agent-docs/                  <- Decision log and architecture docs
│   ├── DECISIONS.md             <- Chronological decision log
│   ├── ARCHITECTURE.md          <- Detailed architecture doc
│   └── AUDIT-LOG.md             <- Security/UX audit findings and fixes
├── .github/
│   └── workflows/
│       ├── tests.yml            <- Run tests on all pushes/PRs
│       ├── deploy.yml           <- Production deploy on main branch push
│       └── preview.yml          <- PR preview environments on Fly.io
├── shared/
│   └── types.ts                 <- Shared TypeScript types (Report, Finding, DomainProfile, ReasoningConfig, TraceData, ChatMessage, etc.)
├── server/
│   ├── index.ts                 <- Express server (rate limiting, SSE, security headers, all API routes)
│   ├── anthropic-client.ts      <- Shared Anthropic client (model fallbacks, traced calls, max_tokens per model)
│   ├── pipeline.ts              <- Orchestrates 5-stage agent pipeline with conversation context
│   ├── storage.ts               <- S3/Tigris report persistence (save, get, list, versioning, slug generation)
│   ├── storage.test.ts          <- Storage tests
│   ├── health.ts                <- Health check logic (Anthropic + S3 + build info + runtime stats)
│   ├── reasoning-levels.ts      <- Reasoning level presets (x-light, light, heavy, x-heavy)
│   └── agents/
│       ├── classifier.ts        <- Domain + output format classification
│       ├── classifier.test.ts   <- Classifier tests
│       ├── draft-answer.ts      <- Quick Haiku draft answer while pipeline runs
│       ├── researcher.ts        <- Evidence gathering (domain-aware prompts)
│       ├── synthesizer.ts       <- Report synthesis (format-aware: written vs slide deck)
│       ├── synthesizer.test.ts  <- Synthesizer tests
│       ├── verifier.ts          <- Adversarial verification + orphan cleanup
│       └── verifier.test.ts     <- Verifier tests
├── src/
│   ├── main.tsx                 <- React entry point
│   ├── App.tsx                  <- State machine, client routing, SSE parsing, conversation state, auto-save
│   ├── index.css                <- Minimal global styles
│   ├── App.stream-bug.test.tsx  <- Tests for stream closure bug fixes
│   ├── App.stream.browser.test.tsx <- Browser-specific streaming tests (Playwright)
│   └── components/
│       ├── QueryInput.tsx       <- Input with example query chips, reasoning level selector
│       ├── QueryInput.test.tsx  <- QueryInput component tests
│       ├── ChatPanel.tsx        <- Chat conversation UI (messages, progress, reasoning level, save state)
│       ├── ProgressStream.tsx   <- 4-stage streaming progress UI
│       ├── Report.tsx           <- Written report with explanation panel
│       ├── SlideDeck.tsx        <- Slide deck presentation with 16:9 slides
│       ├── ReportsPage.tsx      <- List all published reports
│       ├── ReportsPage.test.tsx <- ReportsPage tests
│       ├── ReportDetails.tsx    <- Pipeline trace viewer (system prompts, raw output, findings diff, token usage)
│       ├── HealthPage.tsx       <- Health dashboard (service status, build info, runtime)
│       └── shared/              <- Components shared between Report and SlideDeck
│           ├── certainty-utils.ts    <- Color/label helpers for certainty scores
│           ├── useIsMobile.ts        <- Mobile breakpoint hook
│           ├── CertaintyBadge.tsx    <- Certainty score badge
│           ├── EvidenceSection.tsx   <- Evidence list renderer
│           ├── ExplanationPanel.tsx  <- Full explanation side panel
│           └── FeedbackWidget.tsx    <- Thumbs up/down feedback
├── test/
│   └── setup.ts                 <- Test setup file (Testing Library matchers)
├── package.json
├── tsconfig.json                <- Root TypeScript config (project references)
├── tsconfig.app.json            <- Frontend TS config (React, DOM libs, src/ + shared/)
├── tsconfig.node.json           <- Backend TS config (server/ + shared/ + config files)
├── vite.config.ts               <- Vite config: proxies /api to Express, jsdom test env
├── vitest.server.config.ts      <- Server-side test config (node environment)
├── vitest.browser.config.ts     <- Browser test config (Playwright)
├── index.html                   <- Entry HTML (loads Inter font)
├── Dockerfile                   <- node:22-slim, git for build-info, builds frontend, serves via Express
├── fly.toml                     <- fly.io config (sjc region, port 3001, 1GB memory)
├── .env.example                 <- Template: ANTHROPIC_API_KEY, ANTHROPIC_MODEL
└── .gitignore
```

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check (Anthropic + S3 status, build info, runtime stats) |
| `POST` | `/api/classify` | Run classifier only, generate slug. Rate-limited. |
| `POST` | `/api/generate` | Legacy SSE endpoint for full pipeline (no conversation context) |
| `POST` | `/api/chat` | Primary SSE endpoint: chat-based report generation with conversation context |
| `POST` | `/api/reports/save` | Save report + messages to S3 (versioned) |
| `POST` | `/api/reports/publish` | Legacy alias for `/api/reports/save` |
| `GET` | `/api/reports` | List all saved reports |
| `GET` | `/api/reports/:slug` | Retrieve a specific report (optional `?v=N` for version) |

### SSE Event Types (from `/api/chat` and `/api/generate`)

| Event | Payload | Description |
|-------|---------|-------------|
| `progress` | `ProgressEvent` | Pipeline stage updates with substeps, stats, evidence previews |
| `trace` | `TraceEvent` | Full LLM call traces (request, response, timing, intermediate output) |
| `report` | `Report` | Final verified report |
| `error` | `{ message, detail }` | Pipeline error with diagnostic detail |
| `done` | `{ success: true }` | Stream complete |

### Client-Side Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Homepage (QueryInput) | Centered layout with query input and example chips |
| `/reports` | ReportsPage | List all published reports |
| `/reports/:slug` | ChatPanel + Report/SlideDeck | Three-column layout: chat, report, explanation panel |
| `/health` | HealthPage | Health dashboard |

## Agent-to-Frontend Data Contract

This is the most important section of this file. The Report.tsx component reads specific JSON paths. If agents produce JSON with fields in the wrong location, the report will render incorrectly.

### Finding Schema (what Report.tsx expects)

```json
{
  "id": "f1",
  "section": "investment_thesis",
  "text": "Finding sentence -- a verifiable claim with specific data",
  "certainty": 85,                          // <- ROOT level, NOT inside explanation
  "explanation": {
    "title": "Short Title (2-5 words)",
    "text": "2-4 sentences of context and significance",
    "supportingEvidence": [                  // <- INSIDE explanation
      { "source": "NVIDIA Newsroom (Official)", "quote": "Exact quote or data point", "url": "https://nvidianews.nvidia.com/news/nvidia-financial-results-q4-fiscal-2025" }
    ],
    "contraryEvidence": [                    // <- INSIDE explanation (same level as supportingEvidence)
      { "source": "Source Name", "quote": "Contradicting data or caveat", "url": "https://example.com/full/path/to/source" }
    ]
  }
}
```

### Who produces what:

| Field | Produced by | Notes |
|-------|------------|-------|
| `id`, `section`, `text` | Synthesizer | Sequential IDs: f1, f2, ... f30 |
| `explanation.title` | Synthesizer | Short descriptive title |
| `explanation.text` | Synthesizer (enriched by Verifier) | Context paragraph |
| `explanation.supportingEvidence` | Synthesizer | Min 3 items per finding |
| `certainty` | Verifier | 1-99%, at finding root level |
| `explanation.contraryEvidence` | Verifier | Synthesizer sets to `[]` |
| `meta.overallCertainty` | Verifier | Arithmetic mean of all certainty scores |
| `meta.methodology` | Verifier | Overview explanation with sources, corrections, caveats |

### URL conventions in evidence items:

- Regular sources: full URL (e.g., `"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K"`)
- General knowledge: `"general"`
- Multiple sources: `"various"`
- Calculated/derived: `"derived"`
- Internal methodology: `"internal"`

Report.tsx renders full URLs as clickable links (displaying just the hostname). It filters out "general", "various", "derived", and "internal" from displaying any source link.

### Content array item types:

- `{ "type": "finding", "id": "f1" }` — Reference to a finding (rendered as interactive span)
- `{ "type": "text", "value": "..." }` — Connecting prose (rendered as plain text)
- `{ "type": "break" }` — Paragraph separator (Report.tsx splits content into `<p>` elements on these)

Sections with 4+ findings should have at least one break for visual breathing room.

### Methodology overview:

The Verifier produces a `meta.methodology` object with an `explanation` containing `title`, `text`, `supportingEvidence`, and `contraryEvidence`. Report.tsx reads this for the overview panel (when user clicks the certainty banner). If `meta.methodology` is absent, a hardcoded fallback is shown.

### Slide Deck Section Schema

For `outputFormat: "slide_deck"`, sections include additional fields:
```json
{
  "id": "section_id",
  "title": "Slide Title",
  "subtitle": "Optional subtitle",
  "layout": "content",
  "content": [{ "type": "finding", "id": "f1" }],
  "speakerNotes": "Presenter talking points"
}
```
- `layout`: `"title"` (for title_slide), `"content"` (default), `"two-column"`, `"stats"`, `"bullets"`
- `speakerNotes`: Optional presenter notes shown below each slide
- `subtitle`: Optional subtitle text for the slide

### Section IDs (canonical):

**Equity Research:** `investment_thesis`, `recent_price_action`, `financial_performance`, `product_and_technology`, `competitive_landscape`, `industry_and_macro`, `key_risks`, `analyst_consensus`

**Pitch Deck:** `title_slide`, `problem`, `solution`, `market_opportunity`, `business_model`, `traction`, `competitive_landscape`, `team`, `financials`, `the_ask`

Report.tsx and SlideDeck.tsx have SECTION_TITLES/SLIDE_TITLES maps. Agents should use the canonical long-form IDs.

## Storage Layer

Reports are persisted to S3-compatible storage (Tigris on Fly.io) via `server/storage.ts`.

**Object key layout:**
```
reports/{slug}/meta.json   -- slug metadata + current version pointer
reports/{slug}/v{N}.json   -- full report snapshot + conversation messages for version N
```

**Slug generation:** From ticker/company name, lowercased, alphanumeric + hyphens, max 30 chars, with 4-char random suffix.

**Versioning:** Each save increments the version number. Old versions are preserved and accessible via `?v=N` query parameter.

**Auto-save:** After each successful pipeline run, `App.tsx` calls `POST /api/reports/save` with the report + full conversation messages.

## Testing

### Test Framework
- **Vitest** as test runner (not Jest)
- **Testing Library** (`@testing-library/react`, `@testing-library/user-event`) for component tests
- **Playwright** for browser-specific tests (`*.browser.test.tsx`)
- **jsdom** for standard component tests

### Running Tests
```bash
npm test              # Run jsdom-based tests (src/**/*.test.*)
npm run test:server   # Run server-side tests (server/**/*.test.*)
npm run test:browser  # Run Playwright browser tests (*.browser.test.*)
npm run test:ci       # Full CI suite: typecheck + test + test:server + test:browser
```

### Test Configuration
- `vite.config.ts` — includes jsdom test config for `src/**/*.test.*`, excludes `*.browser.test.*`
- `vitest.server.config.ts` — node environment for `server/**/*.test.ts`
- `vitest.browser.config.ts` — Playwright for `*.browser.test.tsx`
- `test/setup.ts` — Testing Library matchers setup

## Running Locally

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install
npm run dev    # Starts Vite + Express concurrently
```

Frontend: http://localhost:5173 (proxies API to 3001)
Backend: http://localhost:3001

### Key Scripts
```bash
npm run dev         # Concurrent Vite dev server + Express with tsx --watch
npm run build       # Vite production build
npm run start       # Production server (NODE_ENV=production)
npm run typecheck   # TypeScript type checking (tsc -b)
npm test            # Vitest (jsdom tests)
npm run test:server # Vitest (server tests)
npm run test:browser # Vitest (Playwright browser tests)
npm run test:ci     # Full CI: typecheck + all test suites
```

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key. Server starts without it but API calls will fail. |

### Optional (local dev)
| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_MODEL` | Default model for agents | `claude-haiku-4-5` |
| `PORT` | Server port | `3001` |

### Required for storage (production)
Set automatically by `fly storage create` on Fly.io, or manually:

| Variable | Description |
|----------|-------------|
| `BUCKET_NAME` | S3 bucket name |
| `AWS_ENDPOINT_URL_S3` | S3-compatible endpoint URL |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_REGION` | S3 region (defaults to `"auto"`) |

## Deploying to fly.io

```bash
fly secrets set ANTHROPIC_API_KEY=your-key-here
fly storage create   # Sets up Tigris S3 + all AWS_* secrets automatically
fly deploy
```

### CI/CD (GitHub Actions)

- **`tests.yml`** — Runs `npm run test:ci` on all pushes and PRs. Installs Playwright for browser tests.
- **`deploy.yml`** — On push to `main`: runs tests, validates all required secrets, sets Fly.io secrets, deploys to production. Uses concurrency group to prevent simultaneous deploys.
- **`preview.yml`** — On PR open/update: creates a temporary Fly.io app (`audit-ai-pr-{number}`), deploys, posts preview URL as PR comment. Tears down on PR close.

### Required GitHub Secrets
`FLY_API_TOKEN`, `ANTHROPIC_API_KEY`, `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

## Current Status (as of Feb 9, 2026)

### Completed
- Full V1 pipeline (classify -> draft answer -> research -> synthesize -> verify)
- Interactive report with Finding/Explanation UX
- Security hardening (rate limiting, input validation, prompt injection guards, error sanitization, API key validation)
- UX fixes (stale closure bug, AbortController, keyboard navigation, mobile responsive layout, browser tab title, empty state handling, orphaned finding cleanup)
- Pitch deck domain with slide deck output format
- Domain/format separation (independent axes: domain x outputFormat)
- Shared component extraction (CertaintyBadge, EvidenceSection, ExplanationPanel, FeedbackWidget)
- SlideDeck presentation component (dark theme, 16:9 slides, thumbnail navigation)
- Conversational interface (ChatPanel with multi-turn message history)
- Draft answer agent (quick Haiku response while pipeline runs)
- Persistent storage (S3/Tigris) with versioned reports and auto-save
- Report history page (list + view saved reports)
- Health monitoring endpoint + dashboard (Anthropic + S3 status, build info, runtime)
- Configurable reasoning levels (x-light through x-heavy)
- LLM call tracing (full request/response/timing captured per agent stage)
- Pipeline trace viewer (ReportDetails: system prompts, raw output, findings diff, token usage)
- Classify-first navigation (instant slug generation, skip re-classification)
- CI/CD with GitHub Actions (tests, production deploy, PR preview environments)
- TypeScript throughout (server + frontend + shared types)
- Test infrastructure (Vitest + Testing Library + Playwright browser tests)
- Model fallback chains and model-specific max_tokens in anthropic-client.ts

### Not Yet Done
- Live web search integration (V1 uses Claude's training knowledge only)
- User authentication
- Feedback collection backend (currently client-side only)
- Additional domain profiles (deal memo, scientific review)
- PDF export
- Enterprise features (team workspaces, audit trails, SSO)

## Important Conventions

- The side panel is called "Explanation" (not "Audit") -- see agent-docs/DECISIONS.md
- All agents use `<user_query>` tags to wrap user input as a prompt injection defense
- The verifier always runs `cleanOrphanedRefs()` to remove dangling finding references after deletion. `title_slide` sections are preserved even with no findings
- Optional chaining (`response.content?.[0]?.text`) is used throughout agents for robustness
- `App.tsx` routes to `SlideDeck.tsx` when `meta.outputFormat === "slide_deck"`, otherwise `Report.tsx`
- Pipeline sets `report.meta.outputFormat = domainProfile.outputFormat` after verification
- `tracedCreate()` should be used for all LLM calls (not raw `client.messages.create`) to capture trace data
- Agents return `AgentResult<T>` with both `result` and `trace` data
- Pipeline accepts `preClassified` parameter to skip re-running classifier when data is already available
- Auto-save triggers after each successful pipeline run; state tracked via `SaveState` type (`idle` | `saving` | `saved` | `error`)
- Server entry point is `server/index.ts` (TypeScript, run via tsx)
- Vite config is `vite.config.ts` (TypeScript)
- All server-side code is TypeScript (`.ts` files, not `.js`)
- Reasoning level defaults to `x-light` for fast iteration; override via reasoning level selector in UI
- Health endpoint (`/api/health`) reads build info from `build-info.json` (written during Docker build) or falls back to git
