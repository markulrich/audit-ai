import { tracedCreate, ANTHROPIC_MODEL } from "../anthropic-client";
import type { CreateMessageParams } from "../anthropic-client";
import type {
  DomainProfileBase,
  DomainProfile,
  ReasoningConfig,
  SendFn,
  AgentResult,
  TraceData,
} from "../../shared/types";

/** Shape of the JSON the classifier LLM returns. */
interface ClassifierResponse {
  domain: string;
  ticker?: string;
  companyName?: string;
  focusAreas?: string[];
  timeframe?: string;
}

const DOMAIN_PROFILES: Record<string, DomainProfileBase> = {
  equity_research: {
    domain: "equity_research",
    domainLabel: "Equity Research",
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
  // Future: deal_memo, scientific_review, geopolitical_analysis
};

/**
 * Classifies the user query into a domain and returns the appropriate profile.
 * For V1, we only support equity_research but the architecture supports expansion.
 */
export async function classifyDomain(
  query: string,
  send: SendFn | undefined,
  config: Partial<ReasoningConfig> = {},
): Promise<AgentResult<DomainProfile>> {
  const params: CreateMessageParams = {
    model: config.classifierModel || ANTHROPIC_MODEL,
    system: `You are a query classifier for DoublyAI, an explainable research platform.
Given a user query, determine which research domain it belongs to.

Currently supported domains:
- equity_research: Stock analysis, company financials, earnings, market data, analyst ratings, price targets, competitive positioning of public companies.

Respond with JSON only:
{
  "domain": "equity_research",
  "ticker": "NVDA",
  "companyName": "NVIDIA Corporation",
  "focusAreas": ["financials", "competition", "product_roadmap"],
  "timeframe": "current"
}

If the query doesn't match any supported domain, still use "equity_research" as the closest match for V1.
Extract the stock ticker if mentioned or inferable. Extract the company name.`,
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
    const result: DomainProfile = {
      ...DOMAIN_PROFILES.equity_research,
      ticker: json.ticker || "N/A",
      companyName: json.companyName || query,
      focusAreas: json.focusAreas || [],
      timeframe: json.timeframe || "current",
    };
    return { result, trace: { ...trace, parsedOutput: json as unknown as Record<string, unknown> } };
  } catch {
    const result: DomainProfile = {
      ...DOMAIN_PROFILES.equity_research,
      ticker: "N/A",
      companyName: query,
      focusAreas: [],
      timeframe: "current",
    };
    return { result, trace: { ...trace, parsedOutput: undefined, parseError: "Fallback used" } };
  }
}
