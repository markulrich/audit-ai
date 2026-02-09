import { tracedCreate, ANTHROPIC_MODEL } from "../anthropic-client";
import type { CreateMessageParams } from "../anthropic-client";
import type {
  DomainProfileBase,
  DomainProfile,
  OutputFormat,
  ReasoningConfig,
  SendFn,
  AgentResult,
  TraceData,
  ConversationContext,
} from "../../shared/types";

/** Shape of the JSON the classifier LLM returns. */
interface ClassifierResponse {
  domain: string;
  outputFormat?: OutputFormat;
  ticker?: string;
  companyName?: string;
  focusAreas?: string[];
  timeframe?: string;
}

const DOMAIN_PROFILES: Record<string, DomainProfileBase> = {
  equity_research: {
    domain: "equity_research",
    domainLabel: "Equity Research",
    defaultOutputFormat: "written_report",
    sourceHierarchy: [
      "sec_filings",
      "earnings_calls",
      "official_press_releases",
      "analyst_consensus",
      "market_data_providers",
      "industry_press",
    ],
    certaintyRubric: "factual_verification",
    evidenceStyle: "quantitative",
    contraryThreshold: "any_contradiction_lowers_score",
    toneTemplate: "investment_bank_equity_research",
    sections: [
      "investment_thesis",
      "recent_price_action",
      "financial_performance",
      "product_and_technology",
      "competitive_landscape",
      "industry_and_macro",
      "key_risks",
      "analyst_consensus",
    ],
    reportMeta: {
      ratingOptions: ["Overweight", "Equal-Weight", "Underweight"],
    },
  },
  pitch_deck: {
    domain: "pitch_deck",
    domainLabel: "Pitch Deck",
    defaultOutputFormat: "slide_deck",
    sourceHierarchy: [
      "market_research_reports",
      "industry_analysis",
      "company_data",
      "competitive_intelligence",
      "news_and_press",
      "academic_research",
    ],
    certaintyRubric: "factual_verification",
    evidenceStyle: "mixed",
    contraryThreshold: "any_contradiction_lowers_score",
    toneTemplate: "startup_pitch",
    sections: [
      "title_slide",
      "problem",
      "solution",
      "market_opportunity",
      "business_model",
      "traction",
      "competitive_landscape",
      "team",
      "financials",
      "the_ask",
    ],
    reportMeta: {
      ratingOptions: [],
    },
  },
};

/**
 * Classifies the user query into a domain and returns the appropriate profile.
 * Also determines the output format (written_report or slide_deck).
 * The user can request a non-default format (e.g., "slide deck of NVIDIA financials").
 */
export async function classifyDomain(
  query: string,
  send: SendFn | undefined,
  config: Partial<ReasoningConfig> = {},
  conversationContext?: ConversationContext,
): Promise<AgentResult<DomainProfile>> {
  // If we have a previous report, we can shortcut classification
  const contextNote = conversationContext?.previousReport?.meta?.ticker
    ? `\nThis is a follow-up message in an ongoing conversation about ${conversationContext.previousReport.meta.title || "a company"}. The previous report covered ${conversationContext.previousReport.meta.ticker}. The user may be refining, asking follow-ups, or exploring a new topic. Classify accordingly.`
    : "";

  const params: CreateMessageParams = {
    model: config.classifierModel || ANTHROPIC_MODEL,
    system: `You are a query classifier for DoublyAI, an explainable research platform.
Given a user query, determine:
1. Which research domain it belongs to
2. What output format to use

RESEARCH DOMAINS (determines what kind of research to do):
- equity_research: Stock analysis, company financials, earnings, market data, analyst ratings, price targets, competitive positioning of public companies.
- pitch_deck: Startup pitches, business plans, investor presentations, company pitch decks, product launches, fundraising materials.

OUTPUT FORMATS (determines how to present the research):
- written_report: Traditional written research report with sections and flowing prose. Default for equity_research.
- slide_deck: Slide-based presentation format with concise bullet points per slide. Default for pitch_deck.

The user can override the default format. For example:
- "Analyze NVIDIA" → equity_research + written_report (default)
- "Pitch deck for a fintech startup" → pitch_deck + slide_deck (default)
- "Make a slide deck about Tesla's financials" → equity_research + slide_deck (override)
- "Write a detailed report on an AI startup pitch" → pitch_deck + written_report (override)

Supported domains: equity_research, pitch_deck. Default to equity_research if unclear.
${contextNote}
Respond with JSON only:
{
  "domain": "equity_research" | "pitch_deck",
  "outputFormat": "written_report" | "slide_deck",
  "ticker": "NVDA",
  "companyName": "NVIDIA Corporation",
  "focusAreas": ["financials", "competition", "product_roadmap"],
  "timeframe": "current"
}

For pitch_deck queries, ticker may be empty and companyName should be the company/product name or concept being pitched.
If the query doesn't clearly match either domain, use your best judgment based on the intent.`,
    messages: [{ role: "user" as const, content: `<user_query>\n${query}\n</user_query>` }],
  };

  // Emit pre-call trace so frontend can show request details while LLM is working
  if (send) {
    send("trace", {
      stage: "classifier",
      agent: "Classifier",
      status: "pending",
      trace: {
        request: {
          model: params.model || "(default)",
          max_tokens: "(model max)",
          system: params.system,
          messages: params.messages,
        },
      },
    });
  }

  const { response, trace } = await tracedCreate(params);

  try {
    const firstBlock = response.content?.[0];
    const text = firstBlock && "text" in firstBlock ? (firstBlock as { text: string }).text : undefined;
    if (!text) throw new Error("Empty classifier response");
    const json: ClassifierResponse = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());

    const domain = json.domain && DOMAIN_PROFILES[json.domain] ? json.domain : "equity_research";
    const profile = DOMAIN_PROFILES[domain];
    const outputFormat: OutputFormat = json.outputFormat === "written_report" || json.outputFormat === "slide_deck"
      ? json.outputFormat
      : profile.defaultOutputFormat;

    const result: DomainProfile = {
      ...profile,
      outputFormat,
      ticker: json.ticker || "N/A",
      companyName: json.companyName || query,
      focusAreas: json.focusAreas || [],
      timeframe: json.timeframe || "current",
    };
    return { result, trace: { ...trace, parsedOutput: json as unknown as Record<string, unknown> } };
  } catch {
    const result: DomainProfile = {
      ...DOMAIN_PROFILES.equity_research,
      outputFormat: "written_report",
      ticker: "N/A",
      companyName: query,
      focusAreas: [],
      timeframe: "current",
    };
    return { result, trace: { ...trace, parsedOutput: undefined, parseError: "Fallback used" } };
  }
}
