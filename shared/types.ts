// ── Output Format ─────────────────────────────────────────────────────────

export type OutputFormat = "written_report" | "slide_deck";

// ── Evidence ────────────────────────────────────────────────────────────────

export interface EvidenceItem {
  source: string;
  quote: string;
  url: string;
  category?: string;
  authority?: string;
}

// ── Explanation ─────────────────────────────────────────────────────────────

export interface Explanation {
  title: string;
  text: string;
  supportingEvidence: EvidenceItem[];
  contraryEvidence: EvidenceItem[];
}

// ── Finding ─────────────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  section: string;
  text: string;
  certainty?: number;
  explanation: Explanation;
}

// ── Content Array Items ─────────────────────────────────────────────────────

export interface FindingRef {
  type: "finding";
  id: string;
}

export interface TextContent {
  type: "text";
  value: string;
}

export interface BreakContent {
  type: "break";
}

export type ContentItem = FindingRef | TextContent | BreakContent;

// ── Section ─────────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  title: string;
  subtitle?: string;
  layout?: "title" | "content" | "two-column" | "stats" | "bullets";
  content: ContentItem[];
  speakerNotes?: string;
}

// ── Report Meta ─────────────────────────────────────────────────────────────

export interface KeyStat {
  label: string;
  value: string;
}

export interface MethodologyData {
  explanation: Explanation;
}

export interface ReportMeta {
  title: string;
  subtitle?: string;
  date?: string;
  rating?: string;
  priceTarget?: string;
  currentPrice?: string;
  ticker?: string;
  exchange?: string;
  sector?: string;
  keyStats?: KeyStat[];
  overallCertainty?: number;
  methodology?: MethodologyData;
  outputFormat?: OutputFormat;
  companyDescription?: string;
  fundingAsk?: string;
  tagline?: string;
}

// ── Report ──────────────────────────────────────────────────────────────────

export interface Report {
  meta: ReportMeta;
  sections: Section[];
  findings: Finding[];
}

// ── Domain Profile ──────────────────────────────────────────────────────────

export interface DomainProfileBase {
  domain: string;
  domainLabel: string;
  defaultOutputFormat: OutputFormat;
  sourceHierarchy: string[];
  certaintyRubric: string;
  evidenceStyle: string;
  contraryThreshold: string;
  toneTemplate: string;
  sections: string[];
  reportMeta: {
    ratingOptions: string[];
  };
}

export interface DomainProfile extends DomainProfileBase {
  ticker: string;
  companyName: string;
  focusAreas: string[];
  timeframe: string;
  outputFormat: OutputFormat;
}

// ── Reasoning Config ────────────────────────────────────────────────────────

export interface ReasoningConfig {
  label: string;
  description: string;
  classifierModel?: string;
  researcherModel?: string;
  synthesizerModel?: string;
  verifierModel?: string;
  evidenceMinItems: number;
  totalFindings: string;
  findingsPerSection: string;
  supportingEvidenceMin: number;
  explanationLength: string;
  quoteLength: string;
  keyStatsCount: number;
  methodologyLength: string;
  methodologySources: string;
  removalThreshold: number;
}

// ── Trace Types ─────────────────────────────────────────────────────────────

export interface TraceRequest {
  model?: string;
  max_tokens?: number | string;
  system?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface TraceResponse {
  raw?: string;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface TraceTiming {
  startTime?: string;
  durationMs?: number;
}

export interface TraceData {
  request?: TraceRequest;
  response?: TraceResponse;
  timing?: TraceTiming;
  parsedOutput?: Record<string, unknown>;
  parseWarning?: string;
  parseError?: string;
}

export interface TraceEvent {
  stage: string;
  agent: string;
  status?: string;
  trace: TraceData;
  intermediateOutput?: unknown;
  rawOutput?: string;
}

// ── Agent Result ────────────────────────────────────────────────────────────

export interface AgentResult<T> {
  result: T;
  trace: TraceData;
}

// ── Pipeline Types ──────────────────────────────────────────────────────────

export type SendFn = (event: string, data: unknown) => void;

export interface ProgressSubstep {
  text: string;
  status: string;
}

export interface ProgressStats {
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  evidenceCount?: number;
  findingsCount?: number;
  sectionsCount?: number;
  avgCertainty?: number;
  rating?: string;
  removedCount?: number;
  certaintyBuckets?: CertaintyBuckets;
}

export interface CertaintyBuckets {
  high: number;
  moderate: number;
  mixed: number;
  weak: number;
}

export interface EvidencePreviewItem {
  source: string;
  category: string;
  quote: string;
}

export interface ProgressEvent {
  stage: string;
  message: string;
  percent: number;
  detail?: string;
  domainProfile?: DomainProfile;
  substeps?: ProgressSubstep[];
  stats?: ProgressStats;
  evidencePreview?: EvidencePreviewItem[];
}

// ── Error Types ─────────────────────────────────────────────────────────────

export interface ErrorInfo {
  message: string;
  detail?: ErrorDetail | null;
}

export interface ErrorDetail {
  message?: string;
  stage?: string;
  status?: number | null;
  type?: string;
  rawOutputPreview?: string | null;
  stopReason?: string | null;
  tokenUsage?: TraceResponse["usage"] | null;
  durationMs?: number | null;
  originalError?: string;
  hint?: string | null;
}

// ── Pipeline Error ──────────────────────────────────────────────────────────

export interface PipelineError extends Error {
  stage?: string;
  status?: number;
  keyMissing?: boolean;
  agentTrace?: TraceData;
  rawOutput?: string;
}

// ── Chat / Conversation Types ──────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  reportVersion?: number;
  progress?: ProgressEvent[];
  traceData?: TraceEvent[];
  error?: ErrorInfo | null;
}

export interface ConversationContext {
  conversationId: string;
  previousReport?: Report | null;
  messageHistory?: Array<{ role: string; content: string }>;
}
