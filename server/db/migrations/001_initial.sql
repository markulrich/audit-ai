-- 001_initial.sql — DoublyAI database schema
-- Designed with nullable user_id columns for future auth integration.

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations track each research query
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                          -- nullable until auth is added
  query TEXT NOT NULL,
  domain VARCHAR(100),                   -- e.g. 'equity_research'
  ticker VARCHAR(20),
  company_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_created_at ON conversations (created_at DESC);
CREATE INDEX idx_conversations_user_id ON conversations (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_conversations_status ON conversations (status);

-- Reports store the final verified output
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  report_json JSONB NOT NULL,
  title VARCHAR(500),
  rating VARCHAR(50),
  ticker VARCHAR(20),
  overall_certainty INTEGER,
  findings_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_conversation_id ON reports (conversation_id);
CREATE INDEX idx_reports_created_at ON reports (created_at DESC);
CREATE INDEX idx_reports_ticker ON reports (ticker);

-- Artifacts store intermediate pipeline outputs (classify, research, synthesize, verify)
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  stage VARCHAR(50) NOT NULL,            -- classified | researched | synthesized | verified
  artifact_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_artifacts_conversation_id ON artifacts (conversation_id);
