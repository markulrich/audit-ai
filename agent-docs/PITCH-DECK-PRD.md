# Pitch Deck & Multi-Format Output — Product Requirements Document

**Status:** Draft v1 — Feb 9, 2026
**Author:** Claude (AI) + human review needed
**Context:** Initial implementation shipped (classifier, researcher, synthesizer, verifier, SlideDeck.tsx). This PRD captures what exists, what's incomplete, and the long-term vision.

---

## 1. Problem Statement

DoublyAI currently generates equity research reports as a single output format. Users in VC and startup ecosystems need a different artifact: pitch decks — slide-based presentations with concise, evidence-backed claims. The system also needs to cleanly separate "what to research" from "how to present it" so the two can be mixed freely.

## 2. Core Architecture: Research Task × Output Format

The system separates two independent concepts:

### Research Task (Domain)
Determines **what** to research — what evidence to gather, what sections to produce, what tone to use.

| Domain | Description | Default Format | Key Sections |
|--------|-------------|---------------|--------------|
| `equity_research` | Financial analysis of public companies | `written_report` | investment_thesis, financial_performance, key_risks, analyst_consensus, ... (8 sections) |
| `pitch_deck` | Startup/company pitch analysis | `slide_deck` | title_slide, problem, solution, market_opportunity, business_model, traction, competitive_landscape, team, financials, the_ask (10 sections) |
| `deal_memo` (future) | VC deal evaluation | `written_report` | company_overview, market_analysis, team_assessment, financials, risks, recommendation |
| `scientific_review` (future) | Research paper analysis | `written_report` | abstract_summary, methodology, findings, limitations, implications |

### Output Format
Determines **how** to present the findings.

| Format | Description | Rendering Component |
|--------|-------------|-------------------|
| `written_report` | Traditional prose with sections and flowing text | `Report.tsx` |
| `slide_deck` | Navigable slide presentation with concise bullets | `SlideDeck.tsx` |

### Cross-product
Any domain × format combination should work:
- "Analyze NVIDIA" → equity_research × written_report (both defaults)
- "Pitch deck for fintech startup" → pitch_deck × slide_deck (both defaults)
- "Slide deck on Tesla's financials" → equity_research × slide_deck (format override)
- "Detailed report on AI startup pitch" → pitch_deck × written_report (format override)

## 3. Current State (What's Shipped)

### 3.1 Classifier
- [x] Detects `equity_research` vs `pitch_deck` domain
- [x] Detects `written_report` vs `slide_deck` output format
- [x] Allows format overrides (non-default combos)
- [x] Falls back to equity_research + written_report on parse failure
- [ ] No confidence score for classification — hard to know if it chose correctly
- [ ] No user override UI (dropdown to force domain/format)

### 3.2 Researcher
- [x] Domain-aware prompts (TAM/SAM/SOM for pitch, SEC filings for equity)
- [x] Separate source hierarchies per domain
- [ ] Evidence categories are not fully distinct per domain (e.g., `customer_data` exists for pitch but isn't well-utilized)
- [ ] No live web search (V1 limitation applies to all domains)

### 3.3 Synthesizer
- [x] Written report prompt (existing, unchanged)
- [x] Slide deck prompt with layout/speakerNotes/subtitle fields
- [x] Domain-aware section IDs
- [x] Format-aware content style (prose vs bullet points)
- [ ] Two large prompt builders with duplicated schema rules — should extract shared template
- [ ] Slide layouts (`two-column`, `stats`) declared in types but not distinctly rendered

### 3.4 Verifier
- [x] Format-aware prompt language
- [x] Preserves slide-specific fields (layout, speakerNotes, subtitle)
- [x] `cleanOrphanedRefs` handles title_slide (no findings) correctly
- [ ] Same certainty rubric for both domains — pitch deck findings might warrant different thresholds

### 3.5 Pipeline
- [x] Format-aware progress messages and substeps
- [x] Ensures `meta.outputFormat` is set for frontend routing
- [x] Domain-aware research/synthesis substep labels

### 3.6 Frontend
- [x] `SlideDeck.tsx` — dark theme, slide navigation, explanation panel, speaker notes
- [x] `App.tsx` routes to correct component based on `meta.outputFormat`
- [x] Pitch deck example queries in QueryInput
- [ ] SlideDeck duplicates ~300 lines from Report (ExplanationPanel, EvidenceSection, CertaintyBadge)
- [ ] No shared component library between Report and SlideDeck
- [ ] Slide layouts not visually differentiated (all render the same)
- [ ] No keyboard shortcut hints in UI
- [ ] No PDF/PPTX export

## 4. Short-Term Fixes (Next Sprint)

### 4.1 Extract Shared Components
**Priority: High** — Reduces maintenance burden and ensures UX consistency.

Create `src/components/shared/`:
- `ExplanationPanel.tsx` — used by both Report and SlideDeck
- `CertaintyBadge.tsx` — color-coded certainty indicator
- `EvidenceSection.tsx` — renders supporting/contrary evidence lists
- `FindingInteractive.tsx` — base interactive finding component (Report uses inline spans, SlideDeck uses bullet cards)
- `FeedbackWidget.tsx` — thumbs up/down + comment

### 4.2 Slide Layout Differentiation
**Priority: Medium** — Currently all layouts render identically.

| Layout | Rendering |
|--------|-----------|
| `title` | Centered hero with company name, tagline, key stats |
| `content` | Title + bullet-point findings (current default) |
| `two-column` | Split view — findings on left, supporting visual/stats on right |
| `stats` | Large metric cards (like a KPI dashboard slide) |
| `bullets` | Clean bullet list with sub-points |

### 4.3 Test Coverage
**Priority: High** — No tests for the new pitch deck path.

- Classifier: test domain detection for pitch queries, format override detection
- Synthesizer: test slide deck output schema (layout field, speakerNotes presence)
- Verifier: test that slide fields survive verification
- SlideDeck component: basic rendering tests

### 4.4 User Format Override
**Priority: Medium** — Let users explicitly choose domain + format.

Add a dropdown or toggle near the query input:
- "Auto" (default — classifier decides)
- "Written Report"
- "Slide Deck"

Passed to `/api/generate` as `outputFormat` parameter. Classifier respects it if provided.

## 5. Medium-Term Enhancements (Next Quarter)

### 5.1 Prompt Template System
Replace the two monolithic prompt builders with a composable template system:

```
BasePrompt (finding schema, evidence format, content array rules)
  + DomainPrompt (equity: financial focus, pitch: market focus)
  + FormatPrompt (written: prose style, slides: bullet style)
  = Final Prompt
```

This prevents the current problem of duplicating schema rules across prompts.

### 5.2 Domain-Specific Certainty Rubrics
Pitch deck findings have different verifiability characteristics:
- Market size claims: often estimated, rarely >85%
- Customer pain point statistics: survey-dependent, moderate certainty
- Competitive positioning: subjective, lower certainty floor

Consider domain-specific rubric overlays rather than one universal rubric.

### 5.3 Speaker Notes Enhancement
Currently speaker notes are a single text string generated by the synthesizer. Enhance to:
- Include talking point bullets
- Reference specific findings ("Emphasize F3 — the TAM figure")
- Include objection handlers ("If asked about competition, point to F7")
- Time estimates per slide

### 5.4 Slide Deck Export
- **PPTX export** — Generate a downloadable PowerPoint file with the slide content
- **PDF export** — Print-friendly version of the slide deck
- **Google Slides integration** — Export directly to Google Slides via API

### 5.5 Template Themes
Allow users to choose visual themes for slide decks:
- Dark (current default)
- Light / minimal
- Corporate
- Startup / bold

Theme selection stored in `meta.theme` and applied via CSS variables.

### 5.6 Interactive Editing
Allow users to:
- Reorder slides
- Edit slide titles and finding text
- Remove findings or add manual text
- Re-run verification after edits

## 6. Long-Term Vision (6+ Months)

### 6.1 Additional Domains
Each new domain is a `DomainProfileBase` entry in the classifier plus domain-aware prompts:

| Domain | Target User | Key Sections |
|--------|------------|--------------|
| `deal_memo` | VC associates | company_overview, team, market, financials, risks, terms, recommendation |
| `scientific_review` | Researchers | abstract, methodology, results, limitations, future_work |
| `geopolitical_analysis` | Policy teams | situation_overview, actors, risks, scenarios, implications |
| `competitive_intel` | Strategy teams | market_map, competitor_profiles, swot, strategic_options |

### 6.2 Additional Formats
| Format | Description |
|--------|-------------|
| `executive_summary` | 1-page condensed version of any domain's findings |
| `email_brief` | Email-formatted summary with key findings |
| `dashboard` | Interactive cards/charts layout for data-heavy domains |

### 6.3 Multi-Step Refinement
Instead of one-shot generation, allow iterative refinement:
1. Generate initial draft
2. User reviews and provides feedback ("emphasize the competitive moat more")
3. Pipeline re-runs synthesis with user feedback as additional context
4. Verifier re-checks

### 6.4 Live Data Integration
Replace Claude's training knowledge with real-time data:
- Financial APIs (Alpha Vantage, Polygon.io) for equity research
- Market research APIs (Statista, CB Insights) for pitch decks
- News APIs (NewsAPI, Google News) for current events

### 6.5 Collaboration
- Shared workspaces for teams
- Comments on individual findings
- Approval workflows (analyst → reviewer → published)
- Version history with diff view

## 7. Technical Debt to Address

| Item | Severity | Description |
|------|----------|-------------|
| Component duplication | High | SlideDeck.tsx copies ~300 lines from Report.tsx — extract shared components |
| Prompt duplication | Medium | Synthesizer has two large prompt builders with repeated schema rules |
| No pitch deck tests | High | Zero test coverage for pitch classification, slide output, SlideDeck component |
| Layout types unused | Low | `two-column` and `stats` layouts exist in types but render identically |
| Hardcoded date strings | Low | "February 9, 2026" appears in multiple prompts — should be dynamic |
| `valid` variable unused | Low | `repairTruncatedJson` in synthesizer declares `valid` but never reads it |

## 8. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Pitch deck classification accuracy | >95% | Manual review of 50 test queries |
| Slide deck generation success rate | >90% | Pipeline completion without errors |
| Average certainty (pitch findings) | >65% | Meta.overallCertainty across pitch decks |
| User satisfaction | >4/5 | In-app feedback widget |
| Time to generate (slide deck) | <90s on heavy | Pipeline timing stats |

## 9. Open Questions

1. **Should pitch deck slides have a fixed order?** Currently the synthesizer can reorder sections. Should title_slide always be first and the_ask always be last?

2. **How should the system handle queries that don't fit either domain?** Currently falls back to equity_research. Should there be a "general research" domain?

3. **Should findings on slide decks have the same interactive behavior as written reports?** The current implementation uses bullet cards that open the explanation panel. An alternative is to show certainty badges inline without requiring a click.

4. **What's the right evidence count for pitch decks?** Currently uses the same reasoning level config as equity research (40+ items on heavy). Pitch decks may need fewer but more diverse evidence items.

5. **Should the verifier be less aggressive for pitch decks?** Pitch claims about market size and customer pain points are inherently less verifiable than financial data. The removal threshold may need to be domain-aware.

---

*This PRD should be reviewed by the product team before implementation of medium/long-term items.*
