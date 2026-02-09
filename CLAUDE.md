# DoublyAI — Agent Context Guide

## What Is This Project?

DoublyAI is an **explainable research platform** that generates professional-grade research reports where every factual claim ("Finding") is interactive — click it to see the Explanation panel with sources, reasoning, certainty scores, and supporting/contrary evidence.

**Target market:** Enterprise teams in financial services and VC (deal memos).
**V1 scope:** Equity research reports and pitch deck slide presentations. Architecture supports future domains (deal memo, scientific review, geopolitical analysis).

## Tech Stack

- **Frontend:** React 19 + Vite 6 (NOT Next.js — explicit founder preference)
- **Backend:** Express with SSE streaming
- **AI:** Anthropic Claude API (configurable via `ANTHROPIC_MODEL`, default `claude-3-7-sonnet-latest`) via `@anthropic-ai/sdk`
- **Deployment:** fly.io with Docker (node:22-slim)

## Architecture: Multi-Agent Pipeline

```
User Query → Classifier → Researcher → Synthesizer → Verifier → Report
```

1. **Classifier** (`server/agents/classifier.ts`) — Identifies domain + output format, extracts ticker/company
2. **Researcher** (`server/agents/researcher.ts`) — Gathers 40+ evidence items with sources (domain-aware prompts)
3. **Synthesizer** (`server/agents/synthesizer.ts`) — Drafts findings as written report or slide deck
4. **Verifier** (`server/agents/verifier.ts`) — Adversarial fact-checker, assigns certainty scores, removes weak findings

All agents share a single Anthropic client (`server/anthropic-client.js`) with 120s timeout and 2 retries.

Pipeline orchestration is in `server/pipeline.js` — accepts `isAborted` callback to bail out if client disconnects.

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

### Research Tasks vs Output Formats
The system separates two independent concepts:

**Research Task** (domain) — determines what to research:
- `equity_research`: Stock analysis, financials, competitive positioning (sections: investment_thesis, recent_price_action, etc.)
- `pitch_deck`: Market analysis, competitive landscape, value propositions (sections: title_slide, problem, solution, market_opportunity, etc.)

**Output Format** — determines how to present findings:
- `written_report`: Traditional prose report with sections and flowing text. Default for equity_research.
- `slide_deck`: Slide-based presentation with concise bullet points. Default for pitch_deck.

These can be mixed: "Make a slide deck about Tesla's financials" → equity_research domain + slide_deck format.

### Domain Profiles
Configurable rubrics per research domain. Located in `classifier.ts` as `DOMAIN_PROFILES` constant. Each profile defines:
- Default output format (`defaultOutputFormat`)
- Source hierarchy (what sources are most authoritative)
- Certainty rubric style
- Evidence style (quantitative vs qualitative vs mixed)
- Tone template
- Section structure
- Report meta options (e.g., rating options)

## Project Structure

```
doublyai/
├── CLAUDE.md                    ← You are here
├── agent-docs/                  ← Decision log and architecture docs
│   ├── DECISIONS.md             ← Chronological decision log
│   ├── ARCHITECTURE.md          ← Detailed architecture doc
│   └── AUDIT-LOG.md             ← Security/UX audit findings and fixes
├── server/
│   ├── index.js                 ← Express server (rate limiting, SSE, security headers)
│   ├── anthropic-client.js      ← Shared Anthropic client (validates API key at startup)
│   ├── pipeline.js              ← Orchestrates 4-stage agent pipeline
│   └── agents/
│       ├── classifier.js        ← Domain classification
│       ├── researcher.js        ← Evidence gathering
│       ├── synthesizer.js       ← Report synthesis
│       └── verifier.js          ← Adversarial verification + orphan cleanup
├── src/
│   ├── main.jsx                 ← React entry point
│   ├── App.jsx                  ← State machine (idle→loading→done|error)
│   ├── index.css                ← Minimal global styles
│   └── components/
│       ├── QueryInput.tsx       ← Input with example query chips
│       ├── ProgressStream.tsx   ← 4-stage streaming progress UI
│       ├── Report.tsx           ← Full interactive written report with explanation panel
│       └── SlideDeck.tsx        ← Slide deck presentation with explanation panel
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

### Section IDs (canonical):

**Equity Research:** `investment_thesis`, `recent_price_action`, `financial_performance`, `product_and_technology`, `competitive_landscape`, `industry_and_macro`, `key_risks`, `analyst_consensus`

**Pitch Deck:** `title_slide`, `problem`, `solution`, `market_opportunity`, `business_model`, `traction`, `competitive_landscape`, `team`, `financials`, `the_ask`

Report.tsx and SlideDeck.tsx have SECTION_TITLES maps. Agents should use the canonical long-form IDs.

### Section Schema (slide deck extensions):

For slide deck output, sections include additional optional fields:
```json
{
  "id": "problem",
  "title": "The Problem",
  "subtitle": "Optional subtitle",
  "layout": "title" | "content" | "two-column" | "stats" | "bullets",
  "content": [...],
  "speakerNotes": "Expanded talking points for the presenter..."
}
```

### ReportMeta extensions:

For pitch deck output, meta includes additional fields:
- `outputFormat`: `"written_report"` or `"slide_deck"` — controls which frontend component renders
- `tagline`: One-liner value proposition
- `companyDescription`: 2-3 sentence description
- `fundingAsk`: Funding ask summary

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

## Current Status (as of Feb 7, 2026)

### Completed
- Full V1 pipeline (classify → research → synthesize → verify)
- Interactive report with Finding/Explanation UX
- Security hardening (rate limiting, input validation, prompt injection guards, error sanitization, API key validation)
- UX fixes (stale closure bug, AbortController, keyboard navigation, mobile responsive layout, browser tab title, empty state handling, orphaned finding cleanup)
- Pitch deck domain profile with slide deck output format
- Separated research task (domain) from output format — either can be combined independently
- SlideDeck.tsx component with dark theme, slide navigation, and explanation panel

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
- The verifier always runs `cleanOrphanedRefs()` to remove dangling finding references after deletion
- Optional chaining (`response.content?.[0]?.text`) is used throughout agents for robustness
- React state closures are avoided in App.jsx by using local `let receivedReport` flags
