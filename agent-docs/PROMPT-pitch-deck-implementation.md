# Implementation Prompt: Add Pitch Deck Domain + Separate Research Task from Output Format

Give this entire file to a fresh Claude instance pointing at the `main` branch.

---

## Goal

Add a new "pitch deck" research domain to DoublyAI and separate two concepts that are currently conflated:

1. **Research Task** (domain) — what kind of research to do (equity analysis vs pitch deck research)
2. **Output Format** — how to present findings (written prose report vs slide deck presentation)

By default, pitch deck queries produce a slide deck and equity queries produce a written report. But the user should be able to override this (e.g., "slide deck about Tesla's financials" = equity_research domain + slide_deck format).

## Important Context

Read `CLAUDE.md` first — it has the full architecture guide. Key things:
- The codebase uses React 19 + Vite 6 frontend, Express backend, Anthropic Claude API
- The pipeline is: Classifier → Researcher → Synthesizer → Verifier → Report
- Every factual claim is a "Finding" with an Explanation panel (supporting evidence, contrary evidence, certainty score)
- The content array pattern interleaves `{ type: "finding", id: "fN" }` with `{ type: "text", value: "..." }` and `{ type: "break" }`
- Tests: `npm test` (frontend, vitest+jsdom), `npm run test:server` (server, vitest+node), `npm run typecheck` (tsc)
- Test files: `server/agents/synthesizer.test.ts`, `server/agents/verifier.test.ts`, `server/storage.test.ts`, `src/components/QueryInput.test.tsx`, `src/App.stream-bug.test.tsx`, `src/components/ReportsPage.test.tsx`

## Files to Change (in order)

### 1. `shared/types.ts` — Add OutputFormat and slide-specific fields

Add before the `EvidenceItem` interface:
```ts
export type OutputFormat = "written_report" | "slide_deck";
```

Extend `Section`:
```ts
export interface Section {
  id: string;
  title: string;
  subtitle?: string;                                                    // NEW
  layout?: "title" | "content" | "two-column" | "stats" | "bullets";   // NEW
  content: ContentItem[];
  speakerNotes?: string;                                                // NEW
}
```

Extend `ReportMeta`:
```ts
export interface ReportMeta {
  // ... existing fields ...
  outputFormat?: OutputFormat;      // NEW — controls which frontend component renders
  companyDescription?: string;     // NEW — pitch deck: 2-3 sentence description
  fundingAsk?: string;             // NEW — pitch deck: funding ask summary
  tagline?: string;                // NEW — pitch deck: one-liner value proposition
}
```

Extend `DomainProfileBase`:
```ts
export interface DomainProfileBase {
  // ... existing fields ...
  defaultOutputFormat: OutputFormat;  // NEW
}
```

Extend `DomainProfile`:
```ts
export interface DomainProfile extends DomainProfileBase {
  // ... existing fields ...
  outputFormat: OutputFormat;  // NEW — actual format to use (may override default)
}
```

### 2. `server/agents/classifier.ts` — Add pitch_deck domain + outputFormat detection

Add a `pitch_deck` entry to `DOMAIN_PROFILES`:
```ts
pitch_deck: {
  domain: "pitch_deck",
  domainLabel: "Pitch Deck",
  defaultOutputFormat: "slide_deck",
  sourceHierarchy: ["market_research_reports", "industry_analysis", "company_data", "competitive_intelligence", "news_and_press", "academic_research"],
  certaintyRubric: "factual_verification",
  evidenceStyle: "mixed",
  contraryThreshold: "any_contradiction_lowers_score",
  toneTemplate: "startup_pitch",
  sections: ["title_slide", "problem", "solution", "market_opportunity", "business_model", "traction", "competitive_landscape", "team", "financials", "the_ask"],
  reportMeta: { ratingOptions: [] },
}
```

Add `defaultOutputFormat: "written_report"` to the existing `equity_research` profile.

Update the classifier's system prompt to detect BOTH domain and outputFormat. The LLM should return:
```json
{ "domain": "equity_research" | "pitch_deck", "outputFormat": "written_report" | "slide_deck", "ticker": "...", "companyName": "...", "focusAreas": [...], "timeframe": "..." }
```

When building the `DomainProfile` result, use the LLM's outputFormat if valid, otherwise fall back to `profile.defaultOutputFormat`.

The fallback (parse failure) should default to `equity_research` + `written_report`.

### 3. `server/agents/researcher.ts` — Make prompts domain-aware

Extract the system prompt and user message into helper functions that branch on `domainProfile.domain`.

For `pitch_deck`: different source hierarchy (market research reports > industry analysis > company data > competitive intel > news > academic), different evidence categories (`market_data`, `competitive_intel`, `product_news`, `financial_data`, `risk_factor`, `macro_trend`, `customer_data`), different coverage targets (TAM/SAM/SOM, market growth, customer pain points, competitive landscape, traction benchmarks, revenue model benchmarks).

For `equity_research`: keep the current prompt unchanged.

The function signature doesn't change — it already takes `domainProfile`.

### 4. `server/agents/synthesizer.ts` — Branch based on output format

Create two prompt builder functions:
- `buildWrittenReportPrompt(domainProfile, config)` — the current equity research prompt, unchanged. Add `"outputFormat": "written_report"` to the meta schema example.
- `buildSlideDeckPrompt(domainProfile, config)` — new prompt for slide deck output.

The slide deck prompt differences:
- Each section = one slide, with a `layout` field and optional `speakerNotes`
- Content should be concise bullet-point style, not flowing prose
- Use `{ type: "break" }` between findings to separate them as distinct bullets
- Section IDs depend on domain (pitch_deck sections vs equity_research sections)
- Meta should include `outputFormat: "slide_deck"` and, for pitch_deck domain, `tagline`, `companyDescription`, `fundingAsk`
- Key stats differ by domain (TAM/Growth/Funding for pitch vs Price Target/Market Cap/P/E for equity)

In the `synthesize()` function, choose the prompt based on `domainProfile.outputFormat`.

**IMPORTANT**: Both prompts must specify the exact same finding schema and content array schema — these are the contracts that Report.tsx and SlideDeck.tsx both depend on. The only difference is the STYLE of content (prose vs bullets) and the presence of slide-specific fields (layout, speakerNotes, subtitle).

### 5. `server/agents/verifier.ts` — Make format-aware

- Accept `domainProfile` parameter (it already does, since it takes a `DomainProfile`)
- Adapt the prompt text to say "slide deck" vs "equity research report" based on `outputFormat`
- Add instruction to PRESERVE slide-specific fields: `layout`, `subtitle`, `speakerNotes`
- In `cleanOrphanedRefs()`, don't remove `title_slide` sections even if they have no findings (the title slide typically has text content only)

### 6. `server/pipeline.ts` — Pass format through, adapt progress messages

After classification, determine `isPitch = domainProfile.domain === "pitch_deck"` and `isSlides = domainProfile.outputFormat === "slide_deck"` and use these to:
- Customize research substep labels (market/TAM for pitch vs SEC/financials for equity)
- Customize synthesis progress messages ("Designing slides..." vs "Drafting report...")
- After verification, ensure `report.meta.outputFormat = domainProfile.outputFormat` so the frontend can route correctly

### 7. `src/components/SlideDeck.tsx` — New slide deck renderer

**CRITICAL: Do NOT copy-paste from Report.tsx.** Instead:

Step 7a: First, extract shared components from Report.tsx into separate files:
- `src/components/shared/CertaintyBadge.tsx` — the color-coded certainty badge
- `src/components/shared/EvidenceSection.tsx` — renders a list of evidence items
- `src/components/shared/ExplanationPanel.tsx` — the full explanation side panel
- `src/components/shared/FeedbackWidget.tsx` — thumbs up/down feedback
- `src/components/shared/certainty-utils.ts` — `getCertaintyColor()`, `getCertaintyLabel()`
- `src/components/shared/useIsMobile.ts` — the mobile breakpoint hook

Then update Report.tsx to import from these shared files instead of defining inline.

Step 7b: Create SlideDeck.tsx using the shared components. The SlideDeck component should have:
- **Dark theme** (background `#0f0f1a`, cards `#1a1a2e`) — visually distinct from the light Report
- **Slide navigation**: thumbnail bar at top + prev/next buttons at bottom + arrow key nav
- **Slide content area**: 16:9 aspect ratio white card with the current slide's content
- **FindingBullet subcomponent**: unlike Report's inline `FindingSpan`, this renders findings as clickable bullet cards with a certainty dot
- **Speaker notes**: collapsible `<details>` section below each slide
- **Explanation panel**: same shared ExplanationPanel on the right (desktop) or overlay (mobile)
- **Slide title map**: `SLIDE_TITLES` record for both pitch_deck and equity_research section IDs
- **Layout rendering**: title slides (centered hero), content slides (title + finding bullets). Future: two-column, stats layouts.

### 8. `src/App.tsx` — Route based on outputFormat

Import SlideDeck. In the `state === "done"` block, check `report.meta?.outputFormat`:
```tsx
if (state === "done" && report) {
  if (report.meta?.outputFormat === "slide_deck") {
    return <SlideDeck data={report} traceData={traceData} onBack={handleReset} publishedSlug={publishedSlug} />;
  }
  return <Report_ data={report} traceData={traceData} onBack={handleReset} publishedSlug={publishedSlug} />;
}
```

### 9. `src/components/QueryInput.tsx` — Add pitch deck examples

Replace two of the four example queries:
```ts
const EXAMPLES: string[] = [
  "Analyze NVIDIA (NVDA)",
  "Deep dive on Tesla's competitive position",
  "Pitch deck for an AI-powered legal tech startup",
  "Slide deck on Apple's financial performance",
];
```

### 10. Tests — Add coverage for new paths

**`server/agents/synthesizer.test.ts`** — Add tests:
- Test that `synthesize()` with a pitch_deck domain profile + slide_deck format calls the LLM with slide-deck-appropriate prompt (check system prompt contains "slide deck")
- Test that parsed output includes `outputFormat` in trace

**`server/agents/verifier.test.ts`** — Add tests:
- Test that slide-specific fields (`layout`, `speakerNotes`) survive verification
- Test that `cleanOrphanedRefs` preserves `title_slide` sections with no findings

**New `server/agents/classifier.test.ts`** — Add tests:
- Test equity query → equity_research domain + written_report format
- Test pitch query → pitch_deck domain + slide_deck format
- Test format override ("slide deck about Tesla") → equity_research + slide_deck
- Test fallback on parse failure → equity_research + written_report

The test pattern: mock `tracedCreate` (see existing tests), return a canned JSON response, verify the parsed result.

### 11. `CLAUDE.md` — Update documentation

Update:
- V1 scope line to mention pitch deck
- Architecture section to mention domain + output format detection
- Add "Research Tasks vs Output Formats" subsection explaining the separation
- Add pitch_deck section IDs to the canonical list
- Add slide deck section schema (layout, subtitle, speakerNotes)
- Add ReportMeta extensions (outputFormat, tagline, companyDescription, fundingAsk)
- Add SlideDeck.tsx to project structure
- Update status: pitch deck domain completed

## Key Architectural Decisions

1. **The Report data model stays the same** — `{ meta, sections, findings }`. For slide decks, sections are interpreted as slides. The content array pattern still works — findings as bullet points with breaks between them.

2. **`meta.outputFormat` drives frontend routing** — The pipeline ensures this is set. App.tsx checks it to render Report vs SlideDeck.

3. **Domain and format are independent axes** — The classifier detects both. Domain profiles define a `defaultOutputFormat` that can be overridden.

4. **Extract shared components BEFORE creating SlideDeck** — This avoids ~300 lines of duplication and ensures UX consistency.

## Validation Checklist

Before committing, verify:
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (frontend tests)
- [ ] `npm run test:server` passes (server tests)
- [ ] `npm run build` succeeds (Vite build)
- [ ] New tests exist for classifier domain detection, synthesizer format branching, verifier slide field preservation
- [ ] Report.tsx still works identically (existing equity research path unchanged)
- [ ] SlideDeck.tsx imports from shared components, not copy-pasted from Report.tsx

## What NOT to Do

- Don't create a separate data model for slide decks — reuse `Report`
- Don't duplicate ExplanationPanel, CertaintyBadge, EvidenceSection — extract and share
- Don't modify the finding schema — both formats use the same finding structure
- Don't change the verifier's certainty rubric based on domain (save for later)
- Don't add PDF/PPTX export (out of scope)
- Don't add user format override UI (out of scope — classifier handles it)
