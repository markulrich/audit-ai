# DoublyAI — Agent Context Guide

## What Is This Project?

DoublyAI is an **explainable research platform** that generates professional-grade research reports where every factual claim ("Finding") is interactive — click it to see the Explanation panel with sources, reasoning, certainty scores, and supporting/contrary evidence.

**Target market:** Enterprise teams in financial services and VC (deal memos).
**V1 scope:** Equity research reports and pitch deck analysis. Two independent axes: **domain** (equity_research, pitch_deck) and **output format** (written_report, slide_deck). Architecture supports future domains (deal memo, scientific review, geopolitical analysis).

## Tech Stack

- **Frontend:** React 19 + Vite 6 (NOT Next.js — explicit founder preference)
- **Backend:** Express with SSE streaming
- **AI:** Anthropic Claude API (configurable via `ANTHROPIC_MODEL`, default `claude-3-7-sonnet-latest`) via `@anthropic-ai/sdk`
- **Deployment:** fly.io with Docker (node:22-slim)

## Architecture: Multi-Agent Pipeline

```
User Query → Classifier → Researcher → Synthesizer → Verifier → Report
```

1. **Classifier** (`server/agents/classifier.ts`) — Identifies domain + output format, extracts ticker/company. Returns a `DomainProfile` with both `domain` and `outputFormat`
2. **Researcher** (`server/agents/researcher.ts`) — Gathers 40+ evidence items with sources. Domain-aware: uses different prompts for equity research vs pitch deck
3. **Synthesizer** (`server/agents/synthesizer.ts`) — Drafts findings. Format-aware: produces prose sections (written_report) or slide deck with layouts/speakerNotes (slide_deck)
4. **Verifier** (`server/agents/verifier.ts`) — Adversarial fact-checker, assigns certainty scores, removes weak findings. Preserves slide-specific fields when format is slide_deck

All agents share a single Anthropic client (`server/anthropic-client.ts`) with 120s timeout and 2 retries.

Pipeline orchestration is in `server/pipeline.ts` — accepts `isAborted` callback to bail out if client disconnects.

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

## Project Structure

```
doublyai/
├── CLAUDE.md                    ← You are here
├── agent-docs/                  ← Decision log and architecture docs
│   ├── DECISIONS.md             ← Chronological decision log
│   ├── ARCHITECTURE.md          ← Detailed architecture doc
│   └── AUDIT-LOG.md             ← Security/UX audit findings and fixes
├── shared/
│   └── types.ts                 ← Shared TypeScript types (Report, Finding, DomainProfile, etc.)
├── server/
│   ├── index.js                 ← Express server (rate limiting, SSE, security headers)
│   ├── anthropic-client.ts      ← Shared Anthropic client (validates API key at startup)
│   ├── pipeline.ts              ← Orchestrates 4-stage agent pipeline
│   └── agents/
│       ├── classifier.ts        ← Domain + output format classification
│       ├── researcher.ts        ← Evidence gathering (domain-aware prompts)
│       ├── synthesizer.ts       ← Report synthesis (format-aware: written vs slide deck)
│       ├── verifier.ts          ← Adversarial verification + orphan cleanup
│       ├── classifier.test.ts   ← Classifier tests
│       ├── synthesizer.test.ts  ← Synthesizer tests
│       └── verifier.test.ts     ← Verifier tests
├── src/
│   ├── main.tsx                 ← React entry point
│   ├── App.tsx                  ← State machine (idle→loading→done|error), routes to Report or SlideDeck
│   ├── index.css                ← Minimal global styles
│   └── components/
│       ├── QueryInput.tsx       ← Input with example query chips
│       ├── ProgressStream.tsx   ← 4-stage streaming progress UI
│       ├── Report.tsx           ← Written report with explanation panel
│       ├── SlideDeck.tsx        ← Slide deck presentation with 16:9 slides
│       └── shared/              ← Components shared between Report and SlideDeck
│           ├── certainty-utils.ts    ← Color/label helpers for certainty scores
│           ├── useIsMobile.ts        ← Mobile breakpoint hook
│           ├── CertaintyBadge.tsx    ← Certainty score badge
│           ├── EvidenceSection.tsx   ← Evidence list renderer
│           ├── ExplanationPanel.tsx  ← Full explanation side panel
│           └── FeedbackWidget.tsx    ← Thumbs up/down feedback
├── package.json
├── vite.config.js               ← Proxies /api to Express backend
├── index.html                   ← Entry HTML (loads Inter font)
├── Dockerfile                   ← node:22-slim, builds frontend, serves via Express
├── fly.toml                     ← fly.io config (sjc region, port 3001)
├── .env.example                 ← Template: ANTHROPIC_API_KEY=your-key-here
└── .gitignore
```

## Agent-to-Frontend Data Contract

This is the most important section of this file. The Report.jsx component reads specific JSON paths. If agents produce JSON with fields in the wrong location, the report will render incorrectly.

### Finding Schema (what Report.jsx expects)

```json
{
  "id": "f1",
  "section": "investment_thesis",
  "text": "Finding sentence — a verifiable claim with specific data",
  "certainty": 85,                          // ← ROOT level, NOT inside explanation
  "explanation": {
    "title": "Short Title (2-5 words)",
    "text": "2-4 sentences of context and significance",
    "supportingEvidence": [                  // ← INSIDE explanation
      { "source": "NVIDIA Newsroom (Official)", "quote": "Exact quote or data point", "url": "https://nvidianews.nvidia.com/news/nvidia-financial-results-q4-fiscal-2025" }
    ],
    "contraryEvidence": [                    // ← INSIDE explanation (same level as supportingEvidence)
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

- Regular sources: full URL (e.g., `"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=10-K"`, `"https://seekingalpha.com/article/nvidia-earnings-analysis"`)
- General knowledge: `"general"`
- Multiple sources: `"various"`
- Calculated/derived: `"derived"`
- Internal methodology: `"internal"`

Report.tsx renders full URLs as clickable links (displaying just the hostname). It filters out "general", "various", "derived", and "internal" from displaying any source link.

### Content array item types:

- `{ "type": "finding", "id": "f1" }` — Reference to a finding (rendered as interactive span)
- `{ "type": "text", "value": "..." }` — Connecting prose (rendered as plain text)
- `{ "type": "break" }` — Paragraph separator (Report.jsx splits content into `<p>` elements on these)

Sections with 4+ findings should have at least one break for visual breathing room.

### Methodology overview:

The Verifier produces a `meta.methodology` object with an `explanation` containing `title`, `text`, `supportingEvidence`, and `contraryEvidence`. Report.jsx reads this for the overview panel (when user clicks the certainty banner). If `meta.methodology` is absent, a hardcoded fallback is shown.

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

## Running Locally

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install
npm run dev    # Starts Vite + Express concurrently
```

Frontend: http://localhost:5173 (proxies API to 3001)
Backend: http://localhost:3001

## Deploying to fly.io

```bash
fly secrets set ANTHROPIC_API_KEY=your-key-here
fly deploy
```

## Current Status (as of Feb 9, 2026)

### Completed
- Full V1 pipeline (classify → research → synthesize → verify)
- Interactive report with Finding/Explanation UX
- Security hardening (rate limiting, input validation, prompt injection guards, error sanitization, API key validation)
- UX fixes (stale closure bug, AbortController, keyboard navigation, mobile responsive layout, browser tab title, empty state handling, orphaned finding cleanup)
- Pitch deck domain with slide deck output format
- Domain/format separation (independent axes: domain × outputFormat)
- Shared component extraction (CertaintyBadge, EvidenceSection, ExplanationPanel, FeedbackWidget)
- SlideDeck presentation component (dark theme, 16:9 slides, thumbnail navigation)

### Not Yet Done
- Live web search integration (V1 uses Claude's training knowledge only)
- Persistent storage / report history
- User authentication
- Feedback collection backend (currently client-side only)
- Additional domain profiles (deal memo, scientific review)
- PDF export
- Enterprise features (team workspaces, audit trails, SSO)

## Important Conventions

- The side panel is called "Explanation" (not "Audit") — see agent-docs/DECISIONS.md
- All agents use `<user_query>` tags to wrap user input as a prompt injection defense
- The verifier always runs `cleanOrphanedRefs()` to remove dangling finding references after deletion. `title_slide` sections are preserved even with no findings
- Optional chaining (`response.content?.[0]?.text`) is used throughout agents for robustness
- React state closures are avoided in App.tsx by using local `let receivedReport` flags
- `App.tsx` routes to `SlideDeck.tsx` when `meta.outputFormat === "slide_deck"`, otherwise `Report.tsx`
- Pipeline sets `report.meta.outputFormat = domainProfile.outputFormat` after verification
