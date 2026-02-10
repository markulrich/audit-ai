/**
 * Web search module using Brave Search API.
 *
 * Provides real URLs and page snippets that the researcher can use to
 * produce evidence with deterministic quote→URL links. The LLM decides
 * what to search for, but the content comes from actual web pages.
 *
 * Gracefully degrades: if BRAVE_API_KEY is not set, returns empty results
 * and the researcher falls back to LLM knowledge only.
 */

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Page body text (fetched via Brave's extra_snippets or summarizer if available) */
  pageText?: string;
  age?: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
}

/**
 * Returns true if web search is available (API key is configured).
 */
export function isWebSearchAvailable(): boolean {
  return BRAVE_API_KEY.length > 0;
}

/**
 * Search the web using Brave Search API.
 *
 * Returns real URLs, titles, and snippets. If the API key is not set
 * or the search fails, returns an empty results array (non-fatal).
 */
export async function webSearch(
  query: string,
  count: number = 5,
): Promise<WebSearchResponse> {
  if (!BRAVE_API_KEY) {
    return { query, results: [] };
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    text_decorations: "false",
    search_lang: "en",
    extra_snippets: "true",
  });

  try {
    const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(`[web-search] Brave API error: ${response.status} ${response.statusText}`);
      return { query, results: [] };
    }

    const data = await response.json() as BraveApiResponse;
    const webResults = data.web?.results || [];

    return {
      query,
      results: webResults.map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.description || "",
        pageText: (r.extra_snippets || []).join("\n\n") || undefined,
        age: r.age || undefined,
      })),
    };
  } catch (err) {
    console.warn(`[web-search] Search failed for "${query}":`, (err as Error).message);
    return { query, results: [] };
  }
}

/**
 * Run multiple search queries in parallel.
 */
export async function webSearchBatch(
  queries: string[],
  resultsPerQuery: number = 5,
): Promise<WebSearchResponse[]> {
  return Promise.all(queries.map((q) => webSearch(q, resultsPerQuery)));
}

// ── Brave API response types ──────────────────────────────────────────────

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
  age?: string;
}

interface BraveApiResponse {
  web?: {
    results?: BraveWebResult[];
  };
}
