# DoublyAI — Audit Log

Security and UX audit findings from Feb 7, 2026. All issues have been fixed.

## Security Audit Findings

### CRITICAL

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| S1 | API key not validated at startup — server starts without key, fails on first request | server/index.js | Created `anthropic-client.js` with startup validation (`process.exit(1)` if missing) |
| S2 | Each agent creates own `new Anthropic()` — no central config | agents/*.js | All 4 agents now import `{ client }` from shared `anthropic-client.js` |
| S3 | Error messages leak internal details (stack traces, API errors) | server/index.js | Sanitized error messages — maps status codes to safe user-facing strings |
| S4 | Prompt injection risk — user query flows directly into system prompts | agents/*.js | User input wrapped in `<user_query>` tags; agents instructed to treat as data only |

### HIGH

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| S5 | No rate limiting | server/index.js | In-memory rate limiter: 10 req/15min per IP with stale entry cleanup |
| S6 | No input length validation | server/index.js | Min 3 chars, max 5000 chars, JSON body limit 100kb |
| S7 | No security headers | server/index.js | Added X-Content-Type-Options: nosniff, X-Frame-Options: DENY |
| S8 | SSE not cleaned up on client disconnect | server/index.js | Added `req.on("close")` handler, `aborted` flag, heartbeat cleanup in `finally` block |

### MEDIUM

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| S9 | No request logging | server/index.js | Added structured JSON logging middleware (timestamp, method, path, status, duration, IP) |
| S10 | No SSE heartbeat — proxies may timeout | server/index.js | 15-second heartbeat interval |
| S11 | JSON parse not robust in agents | agents/*.js | Added optional chaining, fallback regex extraction, better error messages |

## UX Audit Findings

### CRITICAL

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| U1 | Stale closure bug — `state` and `report` referenced inside async closure capture initial values | App.jsx | Local `let receivedReport` / `receivedError` flags instead of reading React state in closure |
| U2 | No fetch abort on back/reset — SSE stream continues in background | App.jsx | AbortController with signal passed to fetch; aborted in handleReset |

### HIGH

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| U3 | Keyboard arrow keys conflict with textarea input | Report.jsx | Keyboard handler checks `document.activeElement.tagName` — skips if textarea/input/select |
| U4 | Empty findings array causes division by zero in overallCertainty | Report.jsx | `safeFindings` guard, conditional computation only when length > 0 |
| U5 | Orphaned finding IDs in section content after verifier removes findings | verifier.js | `cleanOrphanedRefs()` function removes orphaned refs, collapses adjacent text nodes, removes empty sections |

### MEDIUM

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| U6 | No mobile layout — side panel unusable on small screens | Report.jsx | `useIsMobile()` hook, bottom sheet overlay on mobile, floating "?" button |
| U7 | Browser tab title stays "Vite + React" during report view | Report.jsx | `useEffect` sets `document.title` to report title, restores on unmount |
| U8 | Sections with no valid findings still render empty headers | Report.jsx | `visibleSections` filter removes sections without at least one valid finding |
| U9 | No ARIA labels on interactive elements | Report.jsx | Added `role`, `aria-label`, `tabIndex` to FindingSpan, CertaintyBadge, buttons, ExplanationPanel |
| U10 | Empty state not handled when all findings are removed | Report.jsx | Shows "No sections with verified findings" message when visibleSections is empty |

## Pipeline Robustness

| # | Issue | Location | Fix Applied |
|---|-------|----------|-------------|
| P1 | Pipeline doesn't check abort between stages | pipeline.js | `isAborted()` check after each of the 4 stages; early return if client disconnected |
| P2 | Pipeline division by zero in verified message | pipeline.js | Guards `findingsCount > 0` before computing average certainty |
| P3 | Evidence count assumes array | pipeline.js | `Array.isArray(evidence) ? evidence.length : 0` |
