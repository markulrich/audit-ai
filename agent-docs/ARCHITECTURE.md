# DoublyAI — Architecture

## System Overview

```
┌─────────────┐     POST /api/generate     ┌──────────────┐
│  React SPA  │ ──────────────────────────→ │ Express API  │
│  (Vite)     │ ←──────────────────────────  │ (SSE stream) │
└─────────────┘     event: progress/report  └──────┬───────┘
                                                   │
                                                   ▼
                                          ┌────────────────┐
                                          │  Pipeline.js   │
                                          │  (orchestrator) │
                                          └────────┬───────┘
                                                   │
                    ┌──────────┬──────────┬────────┴────────┐
                    ▼          ▼          ▼                  ▼
              ┌──────────┐ ┌────────┐ ┌───────────┐ ┌──────────┐
              │Classifier│ │Research│ │Synthesizer│ │ Verifier │
              │  Agent   │ │ Agent  │ │   Agent   │ │  Agent   │
              └──────────┘ └────────┘ └───────────┘ └──────────┘
                    │          │          │                  │
                    └──────────┴──────────┴─────────────────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │ anthropic-     │
                              │ client.js      │
                              │ (shared SDK)   │
                              └───────┬───────┘
                                      │
                                      ▼
                              ┌───────────────┐
                              │ Claude API    │
                              │ (Anthropic)   │
                              └───────────────┘
```

## Data Flow

### 1. User submits query
Frontend `App.jsx` sends `POST /api/generate` with `{ query }`.

### 2. Server opens SSE stream
Express sets up SSE headers and creates `send(event, data)` + `isAborted()` callbacks.

### 3. Pipeline executes sequentially

| Stage | Agent | Input | Output | SSE Events |
|-------|-------|-------|--------|------------|
| 1. Classify | `classifier.js` | Raw query string | `domainProfile` object | `classifying` → `classified` |
| 2. Research | `researcher.js` | Query + domainProfile | Array of 40+ evidence items | `researching` → `researched` |
| 3. Synthesize | `synthesizer.js` | Query + domainProfile + evidence | Draft report JSON (meta, sections, findings) | `synthesizing` → `synthesized` |
| 4. Verify | `verifier.js` | Query + domainProfile + draft | Final report JSON with certainty scores | `verifying` → `verified` |

### 4. Report delivered
Pipeline sends `event: report` with the final JSON. Frontend transitions to Report view.

## Report JSON Schema

```json
{
  "meta": {
    "title": "NVIDIA Corporation (NVDA)",
    "subtitle": "Equity Research — Initiating Coverage",
    "date": "February 7, 2026",
    "rating": "Overweight",
    "priceTarget": "$180",
    "currentPrice": "$152.50",
    "ticker": "NVDA",
    "exchange": "NASDAQ",
    "sector": "Semiconductors",
    "overallCertainty": 78,
    "keyStats": [
      { "label": "Price Target", "value": "$180" },
      { "label": "Market Cap", "value": "$3.7T" }
    ]
  },
  "sections": [
    {
      "id": "investment_thesis",
      "title": "Investment Thesis",
      "content": [
        { "type": "finding", "id": "f1" },
        { "type": "text", "value": ", driven by " },
        { "type": "finding", "id": "f2" },
        { "type": "text", "value": "." }
      ]
    }
  ],
  "findings": [
    {
      "id": "f1",
      "section": "investment_thesis",
      "text": "NVIDIA reported Q4 FY2026 revenue of $39.3 billion",
      "certainty": 96,
      "explanation": {
        "title": "Q4 Revenue Figure",
        "text": "This figure comes directly from NVIDIA's official earnings release...",
        "supportingEvidence": [
          { "source": "NVIDIA IR", "quote": "Revenue was $39.3B...", "url": "investor.nvidia.com" }
        ],
        "contraryEvidence": []
      }
    }
  ]
}
```

## Security Model

### Server Layer
- Rate limiting: 10 requests per 15 minutes per IP
- Input validation: 3-5000 character query length
- JSON body limit: 100kb
- Security headers: X-Content-Type-Options, X-Frame-Options
- Error sanitization: Never leaks stack traces or API details to client
- SSE heartbeat: Every 15 seconds to keep connections alive through proxies
- Client disconnect tracking: `aborted` flag checked between pipeline stages

### Agent Layer
- Shared Anthropic client validates API key at startup (fail-fast)
- Prompt injection defense: User input wrapped in `<user_query>` tags
- All agents instructed to treat query content as data, not instructions
- Optional chaining on all API responses (`response.content?.[0]?.text`)
- JSON parse fallbacks: regex extraction if initial parse fails

### Frontend Layer
- AbortController cancels in-flight requests on reset/navigation
- Local flags prevent stale closure bugs in async SSE handling
- Keyboard navigation skips when textarea/input is focused

## Mobile Strategy

Report.jsx uses a `useIsMobile()` hook (768px breakpoint) to switch between:
- **Desktop:** Side-by-side layout (68% report, 32% explanation panel)
- **Mobile:** Full-width report with floating "?" button → bottom sheet overlay for explanation panel

## Future Architecture Considerations

### Adding New Domain Profiles
1. Add profile to `DOMAIN_PROFILES` in `classifier.js`
2. Update classifier system prompt to recognize the new domain
3. Researcher/Synthesizer/Verifier automatically adapt via `domainProfile` parameter
4. May need domain-specific section title mappings in `Report.jsx`

### Adding Live Web Search (V2)
- Insert between Classifier and Researcher
- Use Brave/SerpAPI to gather real-time URLs
- Feed URLs to Researcher as additional evidence context
- Increases certainty for recent data (prices, earnings)

### Adding Persistence (V2)
- Store reports in PostgreSQL or Supabase
- Add report history view
- Enable report sharing via URL
- Store feedback for model improvement
