import { tracedCreate } from "../anthropic-client";
import type {
  DomainProfile,
  SendFn,
  AgentResult,
  TraceData,
} from "../../shared/types";

const HAIKU_MODEL = "claude-haiku-4-5";

/**
 * Produces a quick, naive draft answer using Haiku.
 * This runs immediately after classification to give the user something
 * to read while the full pipeline (research → synthesize → verify) runs.
 */
export async function draftAnswer(
  query: string,
  domainProfile: DomainProfile,
  _send: SendFn
): Promise<AgentResult<string>> {
  const systemPrompt = `You are a financial research assistant. Provide a concise, helpful draft answer to the user's query about ${domainProfile.companyName} (${domainProfile.ticker}). This is a quick preliminary answer — keep it to 2-4 paragraphs covering the key points. Be direct and informative. Do not use markdown headers or bullet points — write in flowing prose paragraphs.`;

  const { response, trace }: { response: { content: Array<{ type: string; text?: string }> }; trace: TraceData } =
    await tracedCreate({
      model: HAIKU_MODEL,
      system: systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: `<user_query>${query}</user_query>`,
        },
      ],
    });

  const text: string = response.content?.[0]?.type === "text"
    ? (response.content[0].text ?? "")
    : "";

  return { result: text, trace };
}
