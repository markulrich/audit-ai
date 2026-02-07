import Anthropic from "@anthropic-ai/sdk";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "FATAL: ANTHROPIC_API_KEY environment variable is not set.\n" +
    "Copy .env.example to .env and add your key:\n" +
    "  cp .env.example .env"
  );
  process.exit(1);
}

export const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 120_000,
  maxRetries: 2,
});
