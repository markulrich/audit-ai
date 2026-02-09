# Agent Framework Evaluation for DoublyAI

> **Date:** February 9, 2026
> **Requirements:** Multi-model (Claude + GPT + Gemini), agent loop with tool calling, Agent Skills compatibility, TypeScript/Node.js, Express integration
> **Current stack:** Express backend, Anthropic SDK (`@anthropic-ai/sdk`), custom pipeline orchestrator, Fly.io deployment

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Requirements Matrix](#requirements-matrix)
3. [Framework Deep Dives](#framework-deep-dives)
   - [Vercel AI SDK](#1-vercel-ai-sdk)
   - [Mastra](#2-mastra)
   - [LangGraph.js](#3-langgraphjs)
   - [OpenAI Agents SDK](#4-openai-agents-sdk)
   - [Block Goose](#5-block-goose)
   - [Claude Agent SDK](#6-claude-agent-sdk)
4. [Frameworks Eliminated](#frameworks-eliminated)
5. [Agent Skills Compatibility](#agent-skills-compatibility)
6. [Comparison Matrix](#comparison-matrix)
7. [Recommendation](#recommendation)
8. [Migration Path](#migration-path)

---

## Executive Summary

We evaluated 10 frameworks against three hard requirements: (1) multi-model support for Claude, GPT, and Gemini, (2) agent loop with tool/skill calling, and (3) TypeScript/Node.js with Express integration.

**Four were eliminated immediately** — CrewAI, AutoGen, and Semantic Kernel have no official TypeScript support; Claude Agent SDK is locked to Claude models only.

**Of the six viable options, the recommendation is Vercel AI SDK (`ai`) as the LLM abstraction layer, with our existing orchestrator pattern preserved.** Mastra is the strongest alternative if we want a full framework rather than a toolkit. Both support MCP, all three required providers, and Express integration.

Agent Skills is a markdown-based instruction spec, not a runtime API. No framework natively loads skills — but the format is trivial to integrate (scan directories, parse YAML frontmatter, inject into system prompts). Skills and MCP are complementary: MCP provides tool access, Skills provide procedural knowledge.

---

## Requirements Matrix

| Requirement | Weight | Notes |
|---|---|---|
| **Multi-model** (Claude + GPT + Gemini) | Must-have | Switch models per pipeline stage or A/B test |
| **Agent loop** with tool calling | Must-have | LLM decides which tools to call, loop until done |
| **Agent Skills** compatibility | Must-have | Load `SKILL.md` files, follow instructions |
| **TypeScript/Node.js** | Must-have | Existing codebase is TS + Express |
| **Express integration** | Must-have | Drop into existing `server/index.js` |
| **MCP support** | Strong want | Future-proof, 3000+ tool servers |
| **Streaming/SSE** | Strong want | Current frontend uses SSE for progress |
| **Workflow orchestration** | Nice-to-have | Pipeline: classify → research → synthesize → verify |
| **Minimal migration cost** | Nice-to-have | Preserve existing skill logic |

---

## Framework Deep Dives

### 1. Vercel AI SDK

**Package:** `ai` (v6.0.77) + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`

**What it is:** A TypeScript toolkit for building AI applications. Not a framework — it doesn't dictate app structure. You compose functions (`generateText`, `streamText`, `tool`, `ToolLoopAgent`) into your existing architecture.

**Provider support:** 24+ official providers, 30+ community. Claude, GPT, and Gemini all have first-party packages maintained by Vercel.

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

// Switch provider with one line
const result = await generateText({
  model: anthropic('claude-sonnet-4-20250514'), // or openai('gpt-4o') or google('gemini-2.0-flash')
  tools: { classify, research, synthesize, verify },
  prompt: query,
});
```

**Agent loop:** `ToolLoopAgent` class or `generateText`/`streamText` with `stopWhen: stepCountIs(N)`. The loop runs automatically: call LLM → execute requested tools → feed results back → repeat until done.

**MCP:** Full support via `@ai-sdk/mcp`. Connect to MCP servers, use their tools alongside custom tools.

```typescript
import { createMCPClient } from '@ai-sdk/mcp';
const client = await createMCPClient({ transport: { type: 'http', url: 'http://localhost:3000/mcp' } });
const tools = { ...await client.tools(), ...customTools };
```

**Express integration:** First-class. `pipeTextStreamToResponse(res)` pipes directly to Express responses. Cookbook and examples provided.

**Structured output:** `Output.object({ schema: z.object({...}) })` for type-safe JSON responses — replaces our manual JSON parsing of LLM output.

| Metric | Value |
|---|---|
| GitHub Stars | 21,600 |
| npm Weekly Downloads | 2,800,000 |
| Latest Release | v6.0.77 (Feb 7, 2026) |
| License | Apache 2.0 |
| Maintainer | Vercel ($250M+ funded) |

**Strengths:**
- Most downloaded TS AI package (2.8M/week)
- Provider-agnostic — one-line model switching
- Toolkit, not framework — drops into existing Express app
- Built-in streaming with SSE support
- MCP support (stable in v6)
- DevTools for debugging LLM calls
- Zod-based tool schemas with type safety

**Weaknesses:**
- No built-in skills registry — you build your own
- No workflow orchestration — you write the pipeline yourself
- Some docs assume Vercel serverless (our Fly.io Docker is fine, just not the default path)
- No semantic caching

**Fit for DoublyAI:** Excellent as an LLM abstraction layer. Replace `@anthropic-ai/sdk` with `ai` + provider packages. Keep our custom pipeline orchestrator. Use `generateText` for fixed-order stages, `ToolLoopAgent` for stages where the LLM should choose tools freely (e.g., researcher).

---

### 2. Mastra

**Package:** `@mastra/core` (v1.2.0) + `@mastra/mcp`, `@mastra/express`

**What it is:** A full TypeScript AI framework from the Gatsby founders (YC W25). Provides agents, workflows, RAG, memory, evals, and MCP — all batteries-included.

**Provider support:** 600+ models across 40+ providers via a unified string format.

```typescript
const agent = new Agent({
  model: "anthropic/claude-sonnet-4-20250514",  // or "openai/gpt-4o" or "google/gemini-2.0-flash"
  tools: { classify, research },
  maxSteps: 10,
});
```

**Agent loop:** Mastra-controlled loop (since v0.14.0, not delegated to AI SDK). `maxSteps` parameter, `onStepFinish` callbacks, multi-agent networks via `.network()`.

**MCP:** Bidirectional — both client (consume external tools) and server (expose your tools to other agents). Transport auto-detection (stdio vs HTTP).

**Workflow orchestration:** Graph-based with `.then()` chaining, branching, parallel execution, suspend/resume, typed Zod schemas between steps.

```typescript
const pipeline = createWorkflow({ id: "research-pipeline", inputSchema, outputSchema })
  .then(classifyStep)
  .then(researchStep)
  .then(synthesizeStep)
  .then(verifyStep)
  .commit();
```

**Express integration:** Dedicated `@mastra/express` adapter. Mount alongside existing routes.

```typescript
import { MastraServer } from "@mastra/express";
const server = new MastraServer({ app, mastra, prefix: '/api/v2' });
await server.init();
```

| Metric | Value |
|---|---|
| GitHub Stars | 20,900 |
| npm Weekly Downloads | 188,000 |
| Latest Release | v1.2.0 (Feb 4, 2026) |
| License | Open source |
| Maintainer | YC W25 company |

**Strengths:**
- Full framework: agents + workflows + RAG + memory + evals
- Typed workflow steps map directly to our pipeline stages
- Bidirectional MCP (client + server)
- Express adapter for existing apps
- Built-in observability and tracing
- Suspend/resume workflows (good for long-running reports)
- Agent networks for multi-agent orchestration

**Weaknesses:**
- Depends on Vercel AI SDK internally (transitive dependency)
- Younger ecosystem — fewer community examples than LangChain
- More opinionated than a toolkit — may conflict with existing patterns
- Learning curve for workflows, agents, evals concepts
- 188K weekly downloads vs 2.8M for Vercel AI SDK

**Fit for DoublyAI:** Strong fit if we want to adopt a full framework. The workflow system maps naturally to our pipeline. The Express adapter integrates cleanly. But it's a bigger commitment than just swapping the LLM layer — we'd be adopting Mastra's patterns for agents, workflows, and tool definitions.

---

### 3. LangGraph.js

**Package:** `@langchain/langgraph` (v1.1.4) + `@langchain/anthropic`, `@langchain/openai`, `@langchain/google-genai`

**What it is:** A stateful graph-based agent orchestrator from LangChain, Inc. Models workflows as cyclic graphs with nodes (tasks), edges (control flow), and shared state.

**Provider support:** 50+ providers via LangChain integration packages. All three required providers have first-party packages.

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
```

**Agent loop:** First-class. The graph naturally expresses agent loops: Agent node → Tools node → conditional edge back to Agent or to END. `ToolNode` auto-executes whatever the LLM requests.

**MCP:** Via `@langchain/mcp-adapters`. Converts MCP tools into LangChain-compatible tools. Multi-server support.

**Graph model:** Express pipelines as explicit state machines:

```typescript
const workflow = new StateGraph(StateAnnotation)
  .addNode("classifier", classifierNode)
  .addNode("researcher", researcherNode)
  .addNode("synthesizer", synthesizerNode)
  .addNode("verifier", verifierNode)
  .addEdge(START, "classifier")
  .addEdge("classifier", "researcher")
  .addEdge("researcher", "synthesizer")
  .addConditionalEdges("verifier", shouldResynthesize, {
    retry: "synthesizer",
    done: END,
  })
  .compile();
```

**Express integration:** The compiled graph is an async function — call `graph.invoke()` or `graph.stream()` in route handlers. Multiple streaming modes.

| Metric | Value |
|---|---|
| GitHub Stars (JS) | 2,500 (LangGraph) / 17,000 (LangChain.js) |
| npm Weekly Downloads | 1,300,000 (`@langchain/langgraph`) |
| Latest Release | v1.1.4 (Feb 6, 2026) |
| License | MIT |
| Maintainer | LangChain, Inc. (VC-backed) |

**Strengths:**
- Explicit graph model makes control flow visible and debuggable
- Conditional edges enable retry loops (e.g., verifier rejects → back to synthesizer)
- Checkpointing for durability (replaces our S3 state persistence)
- Built-in streaming with multiple modes
- Massive ecosystem (LangChain integrations)
- LangSmith observability

**Weaknesses:**
- Abstraction overhead — Runnable interface wraps everything, stack traces are deep
- Our pipeline is currently linear (A→B→C→D) — LangGraph's power is in cycles/branches we don't use yet
- Heavy dependency tree (`@langchain/core` + `langchain` + `@langchain/langgraph` + per-provider packages)
- Ecosystem churn — history of breaking changes between LangChain versions
- Debugging through multiple abstraction layers is harder than direct SDK calls

**Fit for DoublyAI:** Good fit if we plan to add conditional branching (e.g., verifier sends back to synthesizer) or parallel execution. Overkill for the current linear pipeline. The graph model is conceptually clean but adds abstraction weight.

---

### 4. OpenAI Agents SDK

**Package:** `@openai/agents` (v0.4.6)

**What it is:** OpenAI's official TypeScript SDK for multi-agent workflows. Evolved from the "Swarm" research project. Provides agents, handoffs, guardrails, and tracing.

**Provider support:** Provider-agnostic by design. Abstracts `Model` and `ModelProvider` interfaces. Use Claude/Gemini via the Vercel AI SDK adapter:

```typescript
import { Agent } from '@openai/agents';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createVercelAIAdapter } from '@openai/agents-vercelai';

const model = createVercelAIAdapter(anthropic, 'claude-sonnet-4-20250514');
const agent = new Agent({ model, tools: [...] });
```

**Agent loop:** `Runner.run()` executes an automatic multi-turn tool loop. Handoffs allow agent-to-agent delegation.

**MCP:** Built-in. MCP servers are a first-class tool category alongside function tools and hosted tools.

**Tool system:** Six categories — hosted OpenAI tools, local built-in tools, function tools, agents-as-tools, MCP servers, Codex tool.

| Metric | Value |
|---|---|
| GitHub Stars | 2,300 |
| npm Weekly Downloads | ~50,000 (estimated) |
| Latest Release | v0.4.6 |
| License | MIT |
| Maintainer | OpenAI |

**Strengths:**
- Clean handoff pattern for multi-agent orchestration
- Built-in guardrails (input/output validation)
- Built-in tracing/observability
- Provider-agnostic via Vercel AI SDK adapter
- Voice agent support (WebRTC)

**Weaknesses:**
- Multi-provider requires the Vercel AI SDK adapter (extra indirection)
- Hosted tools (web search, file search, code interpreter) only work with OpenAI models
- Requires Zod v4 — may conflict with our Zod v3 usage
- Smaller community (2.3K stars)
- Pre-1.0 (v0.4.x) — API may change
- No workflow orchestration beyond the agent loop

**Fit for DoublyAI:** Viable but awkward. Multi-provider requires an adapter layer. The handoff pattern is interesting for multi-agent but doesn't map to our fixed pipeline. No workflow system means we'd still need our own orchestrator.

---

### 5. Block Goose

**Type:** Standalone AI agent (CLI + desktop app), not an SDK

**What it is:** An open-source local AI agent from Block. Runs as a separate process. Supports 30+ providers, 3000+ MCP extensions, Skills (`SKILL.md`), and Recipes (YAML workflows).

| Metric | Value |
|---|---|
| GitHub Stars | 30,100 |
| Language | Rust + TypeScript |
| Latest Release | v1.23.2 (Feb 6, 2026) |
| License | Apache 2.0 |

**Why it doesn't fit:**
- **It's a developer tool, not an SDK.** Goose is a coding agent (like Claude Code or Cursor). It helps developers write code — it doesn't help you build a multi-agent research platform.
- **No programmatic API.** You can't `import { Agent } from 'goose'` in your Express server. You'd have to spawn it as a subprocess and parse stdout.
- **Integration path:** You'd wrap each DoublyAI skill as an MCP server, create a Goose recipe, spawn Goose as the worker process on each Fly Machine. This is architecturally viable but adds a Rust binary dependency and process management complexity.

**Best use case:** Install Skills from the Goose/Agent Skills ecosystem for your development workflow. Not for production application architecture.

---

### 6. Claude Agent SDK

**Package:** `@anthropic-ai/claude-agent-sdk` (v0.2.37)

**What it is:** The same infrastructure that powers Claude Code, extracted as a programmable SDK. Rich built-in tools (file I/O, shell, web search, grep), subagents, hooks, and sessions.

| Metric | Value |
|---|---|
| GitHub Stars | 763 |
| npm Weekly Downloads | ~15,000 (estimated) |
| Latest Release | v0.2.37 |
| License | Anthropic proprietary |

**Why it doesn't meet requirements:**
- **Claude-only.** Cannot use OpenAI or Gemini models. Supports multi-cloud deployment (Bedrock, Vertex, Azure) but all paths run Claude.
- Excellent for Claude-native applications but fails the multi-model requirement.

---

## Frameworks Eliminated

| Framework | Reason |
|---|---|
| **CrewAI** | Python only. No official TypeScript/JavaScript version. Community ports (`crewai-ts`) are unmaintained. |
| **Microsoft AutoGen** | Python and .NET only. No official TypeScript support. Merging into "Microsoft Agent Framework." |
| **Microsoft Semantic Kernel** | C#, Python, Java only. TypeScript branch marked experimental and stale. |
| **Claude Agent SDK** | Claude-only. Does not support GPT or Gemini models. |

---

## Agent Skills Compatibility

### What Agent Skills Actually Is

Agent Skills is a **file-based specification**, not a runtime or SDK. A skill is a folder with a `SKILL.md` file containing YAML frontmatter (`name`, `description`) and markdown instructions. Optional subdirectories hold scripts, references, and assets.

**The "API" is the LLM's ability to read and follow instructions.** There is no function schema, no tool definition format, no structured input/output contract. Skills are "soft" capabilities conveyed through natural language injected into the LLM's system prompt.

### How Frameworks Consume Skills

No framework natively loads Agent Skills. The integration pattern is manual but trivial:

1. Scan configured directories for `SKILL.md` files
2. Parse YAML frontmatter (name + description, ~100 tokens each)
3. Inject metadata into system prompt as XML
4. When the model requests a skill, read full `SKILL.md` into context
5. Model follows the instructions, optionally runs bundled scripts

```typescript
// ~50 lines to implement a skill loader
function loadSkills(dirs: string[]): Skill[] {
  const skills: Skill[] = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const content = fs.readFileSync(skillPath, 'utf-8');
      const { data, content: body } = parseFrontmatter(content);
      skills.push({ name: data.name, description: data.description, body, path: skillPath });
    }
  }
  return skills;
}
```

### Skills vs MCP

| | Agent Skills | MCP |
|---|---|---|
| Provides | Procedural knowledge ("how") | Tool/data access ("what") |
| Format | Markdown files | JSON-RPC protocol |
| Execution | LLM follows instructions | Structured tool calls |
| Use together | Yes — MCP provides tools, Skills teach how to use them |

### 27+ Tools Support Agent Skills

Claude Code, OpenAI Codex, Gemini CLI, Cursor, VS Code Copilot, GitHub Copilot, Goose, Amp (Sourcegraph), Roo Code, TRAE (ByteDance), Mistral Vibe, Spring AI, Databricks, and 15+ others.

### Relevant npm Packages

| Package | What it does | Programmatic API? |
|---|---|---|
| `skills` (Vercel) | CLI to install skills from skills.sh directory | No — CLI only |
| `openskills` | CLI to manage skill files across agent directories | No — CLI only |
| `opencode-skills` | Registers skills as dynamic tools in OpenCode | Yes, but OpenCode-specific |

**Bottom line:** Build a simple skill loader (~50 lines). No framework does this for you.

---

## Comparison Matrix

| | Vercel AI SDK | Mastra | LangGraph.js | OpenAI Agents SDK | Goose | Claude Agent SDK |
|---|---|---|---|---|---|---|
| **Type** | Toolkit/SDK | Framework | Orchestrator | Agent SDK | Standalone app | Agent SDK |
| **Claude** | ✅ `@ai-sdk/anthropic` | ✅ `anthropic/...` | ✅ `@langchain/anthropic` | ✅ via adapter | ✅ | ✅ (only) |
| **GPT** | ✅ `@ai-sdk/openai` | ✅ `openai/...` | ✅ `@langchain/openai` | ✅ native | ✅ | ❌ |
| **Gemini** | ✅ `@ai-sdk/google` | ✅ `google/...` | ✅ `@langchain/google-genai` | ✅ via adapter | ✅ | ❌ |
| **Agent loop** | ✅ `ToolLoopAgent` | ✅ `maxSteps` | ✅ graph cycles | ✅ `Runner.run()` | ✅ built-in | ✅ built-in |
| **MCP** | ✅ `@ai-sdk/mcp` | ✅ bidirectional | ✅ `@langchain/mcp-adapters` | ✅ built-in | ✅ native | ✅ built-in |
| **Agent Skills** | Manual | Manual | Manual | Manual | ✅ native | ✅ native |
| **Express** | ✅ `pipeToResponse` | ✅ `@mastra/express` | ✅ `invoke()`/`stream()` | ✅ manual | ❌ subprocess | ✅ but heavy |
| **Workflows** | ❌ DIY | ✅ graph-based | ✅ `StateGraph` | ❌ DIY | ✅ Recipes | ❌ |
| **Streaming** | ✅ `streamText` | ✅ agent + workflow | ✅ 4 modes | ✅ `Runner.stream()` | ❌ | ✅ |
| **Stars** | 21.6K | 20.9K | 2.5K | 2.3K | 30.1K | 0.8K |
| **npm/week** | 2,800,000 | 188,000 | 1,300,000 | ~50,000 | N/A | ~15,000 |
| **Maturity** | v6 (stable) | v1.2 (stable) | v1.1 (stable) | v0.4 (pre-1.0) | v1.23 (stable) | v0.2 (pre-1.0) |
| **Migration cost** | Low | Medium | Medium-High | Medium | High | N/A (no GPT) |

---

## Recommendation

### Primary: Vercel AI SDK (`ai`)

**Use Vercel AI SDK as the LLM abstraction layer. Keep our pipeline orchestrator.**

**Why:**
1. **Lowest migration cost.** Replace `@anthropic-ai/sdk` with `ai` + provider packages. Each agent's core logic stays the same — only the LLM call layer changes.
2. **Most adopted.** 2.8M weekly downloads. If something breaks, answers exist.
3. **Toolkit, not framework.** Doesn't force us to restructure the app. Drops into existing Express routes.
4. **Provider switching is one line.** Use Claude for synthesis, GPT for classification, Gemini Flash for cheap verification — all with the same tool definitions.
5. **MCP ready.** When we add web search or external tools, `@ai-sdk/mcp` connects to MCP servers without changing agent code.
6. **Streaming built-in.** `streamText` + `pipeTextStreamToResponse` simplifies our SSE implementation.

**What changes:**
- `server/anthropic-client.ts` → replace with Vercel AI SDK model initialization
- Each agent: replace `anthropic.messages.create()` with `generateText()` or `streamText()`
- Tool definitions: wrap in `tool()` with Zod schemas (we already use Zod in validation)
- Add skill loader (~50 lines) to scan `SKILL.md` files and inject into system prompts

**What stays the same:**
- Pipeline orchestrator (`server/orchestrator.ts`)
- Skills system (`server/skills/index.ts`)
- Job system (`server/jobs.ts`)
- Fly Machines (`server/machines.ts`)
- S3 storage (`server/storage.ts`)
- Entire frontend

### Alternative: Mastra

**If we want a full framework with built-in workflows, agents, memory, and evals.**

Mastra would replace more of our custom code:
- `server/orchestrator.ts` → Mastra workflow with `.then()` chaining
- `server/skills/index.ts` → Mastra tools + agents
- `server/anthropic-client.ts` → Mastra's model abstraction
- SSE streaming → Mastra's workflow streaming

The tradeoff is: less custom code to maintain, but more framework-level concepts to learn and depend on. Mastra is also built on top of the Vercel AI SDK internally, so we'd be getting AI SDK + orchestration + Express adapter in one package.

### Not Recommended

| Framework | Why not |
|---|---|
| **LangGraph.js** | Our pipeline is linear today. LangGraph's power (cyclic graphs, conditional edges) is overhead we don't need yet. Heavy abstraction layer. Ecosystem churn risk. Reconsider if we add verifier→synthesizer retry loops. |
| **OpenAI Agents SDK** | Multi-provider requires adapter indirection. Pre-1.0. Zod v4 conflict. No workflow system. |
| **Goose** | Developer tool, not an SDK. Would require spawning as subprocess. |
| **Claude Agent SDK** | Fails the multi-model requirement. Claude-only. |

---

## Migration Path

### Phase 1: LLM Layer Swap (Low Risk)

Replace `@anthropic-ai/sdk` with Vercel AI SDK. One agent at a time.

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
```

```typescript
// Before (server/anthropic-client.ts)
import Anthropic from "@anthropic-ai/sdk";
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  system: systemPrompt,
  messages: [{ role: "user", content: query }],
});
const text = response.content[0].text;

// After
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
const { text } = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  system: systemPrompt,
  prompt: query,
});
```

### Phase 2: Structured Tools

Convert pipeline skills to Vercel AI SDK tools with Zod schemas:

```typescript
import { tool } from "ai";
import { z } from "zod";

const classifyTool = tool({
  description: "Classify the research query into domain and output format",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    // existing classifyDomain() logic
  },
});
```

### Phase 3: Agent Skills Loader

Add a skill loader that scans directories and injects into system prompts:

```
.agents/skills/          # Project-level, portable
~/.config/agents/skills/ # Global, portable
```

### Phase 4: MCP Integration (When Needed)

When adding web search, database access, or external tools:

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
const webSearch = await createMCPClient({
  transport: { type: "http", url: "http://localhost:3000/mcp" },
});
```

### Phase 5: Multi-Model Optimization (When Needed)

Use different models for different pipeline stages:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

// Cheap + fast for classification
const classification = await generateText({
  model: google("gemini-2.0-flash"),
  ...
});

// Strong reasoning for synthesis
const report = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  ...
});
```

---

## Sources

- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai) — 21.6K stars
- [Mastra Documentation](https://mastra.ai/docs)
- [Mastra GitHub](https://github.com/mastra-ai/mastra) — 20.9K stars
- [LangGraph.js Documentation](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [LangGraph.js GitHub](https://github.com/langchain-ai/langgraphjs) — 2.5K stars
- [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js) — 2.3K stars
- [Block Goose](https://github.com/block/goose) — 30.1K stars
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) — 763 stars
- [Agent Skills Specification](https://agentskills.io/specification)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
- [Agent Skills Open Standard](https://github.com/agentskills/agentskills)
- [MCP and Agent Skills Relationship](https://thenewstack.io/agent-skills-anthropics-next-bid-to-define-ai-standards/)
- [Vercel Skills Ecosystem](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)
