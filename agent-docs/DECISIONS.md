# DoublyAI — Decision Log

Chronological record of product and technical decisions for context preservation.

---

## Decision 1: Product Surface — Web App (not API-first)

**Date:** Feb 7, 2026
**Context:** Discussed whether V1 should be API, consumer app, or both.
**Decision:** Web app as primary surface. Start consumer-facing, sell to enterprise teams.
**Rationale:** Enterprise financial services and VC teams want a polished UI they can use immediately. API can come later. The interactive Finding/Explanation UX is the key differentiator and requires a frontend to experience.

---

## Decision 2: React 19 + Vite (NOT Next.js)

**Date:** Feb 7, 2026
**Context:** Founder (Mark) explicitly rejected Next.js.
**Decision:** Plain React 19 with Vite 6 for build tooling. Express backend separate.
**Rationale:** Founder preference. Simpler architecture, faster iteration. No SSR needed since this is a SPA with a clear API boundary. Vite proxies `/api` to Express during dev.

---

## Decision 3: SSE Streaming (not WebSockets)

**Date:** Feb 7, 2026
**Context:** Pipeline takes 60-90 seconds. Need progress feedback.
**Decision:** Server-Sent Events (SSE) from Express to React.
**Rationale:** Simpler than WebSockets for one-directional streaming. Built into browser APIs. No extra dependencies. Events are typed (progress, report, error, done) with JSON payloads.

---

## Decision 4: Domain Profiles Architecture

**Date:** Feb 7, 2026
**Context:** Product needs to handle different research domains (equity, deal memos, scientific).
**Decision:** Configurable Domain Profiles — JSON objects that parameterize the agent pipeline.
**Rationale:** Each domain has different source hierarchies, certainty rubrics, tone templates, and section structures. V1 ships only equity_research, but the architecture is ready for expansion without rewriting agents.

---

## Decision 5: 4-Agent Pipeline (not 3, not 5)

**Date:** Feb 7, 2026
**Context:** Designing the sub-agent architecture.
**Decision:** Classifier → Researcher → Synthesizer → Verifier
**Rationale:**
- Classifier is lightweight and fast (determines domain profile)
- Researcher ONLY collects evidence (no synthesis = less hallucination)
- Synthesizer transforms evidence into structured report
- Verifier is adversarial — its job is to LOWER certainty, catch errors, add contrary evidence
- Separation of concerns prevents the "write AND fact-check yourself" failure mode

---

## Decision 6: Content Array Pattern (not markdown)

**Date:** Feb 7, 2026
**Context:** How to interleave interactive findings with natural prose.
**Decision:** Section content is an array of `{ type: "finding", id }` and `{ type: "text", value }` items.
**Rationale:** Markdown would require complex parsing to find and wrap findings. The content array pattern lets the Synthesizer output structured data that the Report component renders directly. Each finding is a clear, extractable entity with its own metadata.

---

## Decision 7: Terminology — "Explanation" (not "Audit")

**Date:** Feb 7, 2026
**Context:** The side panel that shows evidence, reasoning, and certainty for each finding.
**Decision:** Call it "Explanation" throughout the product.
**Reasoning (pending full analysis — see below):**
- "Explanation" is user-centric: it explains WHY a claim is made
- "Audit" implies compliance/verification — useful for the process, but the panel is showing the OUTPUT of that process
- Enterprise buyers in financial services may prefer "Explanation" because "Audit" has specific regulatory connotations (financial audit, SOX compliance) that could create confusion
- The verification PROCESS is called "Verification" internally (the agent name). The USER-FACING panel shows the explanation.
- **NOTE:** This is an open question from the founder — see full analysis below.

### Full Analysis: "Audit" vs "Explanation" for Enterprise

**"Explanation" advantages:**
- More intuitive for end users ("explain this to me")
- Aligns with XAI (Explainable AI) industry terminology
- Less likely to create regulatory confusion in financial services
- Feels educational and empowering, not punitive

**"Audit" advantages:**
- Signals rigor and accountability (enterprise values this)
- Implies a formal verification process happened
- Aligns with compliance language (SOX, internal audit)
- "Audit trail" is a common enterprise feature request

**Possible hybrid:** Keep "Explanation" as the user-facing panel name, but market the overall feature as an "Audit Trail" or "Verification Layer" in sales materials. This gives you both: user-friendly UX language + enterprise-grade positioning.

---

## Decision 8: Shared Anthropic Client

**Date:** Feb 7, 2026
**Context:** Security audit found each agent was creating its own `new Anthropic()` client.
**Decision:** Single shared client in `server/anthropic-client.js` with validation, timeout, and retry config.
**Rationale:** Validates API key once at startup (fail-fast), consistent timeout/retry behavior, single place to configure. Agents import `{ client }` instead of creating their own.

---

## Decision 9: Prompt Injection Guards

**Date:** Feb 7, 2026
**Context:** Security audit identified that user queries flow directly into agent system prompts.
**Decision:** Wrap user input in `<user_query>` tags and instruct agents to treat content within as data only.
**Rationale:** Defense-in-depth. The tags create a clear boundary between instructions and user data. Agents are instructed to ignore any directives inside the tags. Not bulletproof, but significantly raises the bar for injection attacks.

---

## Decision 10: Orphaned Finding Cleanup

**Date:** Feb 7, 2026
**Context:** Verifier removes findings with <25% certainty, but section content arrays still referenced deleted finding IDs.
**Decision:** Added `cleanOrphanedRefs()` in verifier.js that removes orphaned finding refs, collapses adjacent text nodes, and removes empty sections.
**Rationale:** Without cleanup, the Report component would render gaps or null elements where deleted findings were referenced. The cleanup runs after every verification pass.

---

## Decision 11: Agent-to-Frontend Schema Contract

**Date:** Feb 7, 2026
**Context:** Compared the NVDA prototype report data (hardcoded in `nvda-research-report.jsx`) against what the agent pipeline would produce, and found critical field-placement mismatches.
**Decision:** Established an explicit data contract between agents and Report.jsx:
- `certainty` at finding root level (NOT inside explanation)
- `contraryEvidence` INSIDE `explanation` (alongside `supportingEvidence`)
- Both evidence arrays use `{ source, quote, url }` format
- URL values are domain names, with special values: "general", "various", "derived", "internal"

**Changes made:**
1. Synthesizer prompt: Added `contraryEvidence: []` to finding schema, showed realistic example finding, bumped evidence requirement to 3+ items, added CRITICAL SCHEMA RULES section
2. Verifier prompt: Replaced vague "OUTPUT FORMAT" with explicit JSON schema showing exact field placement, emphasized `certainty` at root and `contraryEvidence` inside explanation
3. Researcher prompt: Bumped max_tokens from 8192→12288, added evidence quality standards, documented URL conventions
4. CLAUDE.md: Added "Agent-to-Frontend Data Contract" section with the canonical schema

**Rationale:** The original prompts were ambiguous about JSON structure. The Verifier could reasonably put `contraryEvidence` at the finding root level instead of inside `explanation`, which would silently break the Report component (it reads `expl?.contraryEvidence` where `expl = activeData.explanation`). Making the schema explicit in the prompts prevents this class of silent rendering failures.
