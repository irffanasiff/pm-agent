-- ============================================================
-- UNIVERSAL AGENT OBSERVABILITY SCHEMA V3
-- Single source of truth for UI, Analytics, and Debugging
-- ============================================================

-- Drop existing tables (clean slate)
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS tool_calls CASCADE;
DROP TABLE IF EXISTS llm_calls CASCADE;
DROP TABLE IF EXISTS entities CASCADE;
DROP TABLE IF EXISTS agent_sessions CASCADE;
DROP TABLE IF EXISTS workflow_runs CASCADE;

-- Drop old v2 tables if they exist
DROP TABLE IF EXISTS spans CASCADE;
DROP TABLE IF EXISTS metrics CASCADE;
DROP TABLE IF EXISTS annotations CASCADE;

-- Drop old v1 tables if they exist
DROP TABLE IF EXISTS pipeline_runs CASCADE;
DROP TABLE IF EXISTS agent_runs CASCADE;
DROP TABLE IF EXISTS market_progress CASCADE;
DROP TABLE IF EXISTS session_messages CASCADE;
DROP TABLE IF EXISTS tool_executions CASCADE;
DROP TABLE IF EXISTS cost_entries CASCADE;

-- ============================================================
-- TABLE 1: workflow_runs
-- Top-level container for any multi-step job
-- ============================================================
CREATE TABLE workflow_runs (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY
  -- ═══════════════════════════════════════════════════════════
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL DEFAULT gen_random_uuid(),

  -- What is this workflow?
  name TEXT NOT NULL,
  version TEXT,

  -- Who/what started it?
  initiated_by TEXT,
  initiated_from TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- INPUT/OUTPUT (for replay)
  -- ═══════════════════════════════════════════════════════════
  input JSONB NOT NULL DEFAULT '{}',
  input_summary TEXT,
  config JSONB NOT NULL DEFAULT '{}',

  output JSONB,
  output_summary TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- STATE (for real-time UI)
  -- ═══════════════════════════════════════════════════════════
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),

  -- Phase tracking (for stepper UI)
  phases JSONB DEFAULT '[]',
  current_phase TEXT,

  -- Progress (for progress bar)
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  progress_message TEXT,

  -- Current activity (for "what's happening now")
  current_activity TEXT,
  current_session_id UUID,

  -- ═══════════════════════════════════════════════════════════
  -- COUNTERS (for live stats)
  -- ═══════════════════════════════════════════════════════════
  counters JSONB NOT NULL DEFAULT '{}',

  -- ═══════════════════════════════════════════════════════════
  -- TIMING
  -- ═══════════════════════════════════════════════════════════
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,

  -- ═══════════════════════════════════════════════════════════
  -- COST & TOKENS (aggregated)
  -- ═══════════════════════════════════════════════════════════
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  total_input_tokens BIGINT DEFAULT 0,
  total_output_tokens BIGINT DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  total_llm_calls INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- ERROR (if failed)
  -- ═══════════════════════════════════════════════════════════
  error_code TEXT,
  error_message TEXT,
  error_details JSONB,

  -- ═══════════════════════════════════════════════════════════
  -- METADATA
  -- ═══════════════════════════════════════════════════════════
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_trace ON workflow_runs(trace_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_name ON workflow_runs(name);
CREATE INDEX idx_workflow_runs_created ON workflow_runs(created_at DESC);
CREATE INDEX idx_workflow_runs_initiated_by ON workflow_runs(initiated_by);
CREATE INDEX idx_workflow_runs_tags ON workflow_runs USING GIN(tags);

-- ============================================================
-- TABLE 2: agent_sessions
-- Individual agent invocation within a workflow
-- ============================================================
CREATE TABLE agent_sessions (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY & HIERARCHY
  -- ═══════════════════════════════════════════════════════════
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  parent_session_id UUID REFERENCES agent_sessions(id),
  trace_id UUID NOT NULL,

  -- What agent is this?
  agent_name TEXT NOT NULL,
  agent_version TEXT,

  -- What is it working on?
  task TEXT,
  task_type TEXT,

  -- Context reference
  context_type TEXT,
  context_id TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- MODEL CONFIGURATION (frozen at start)
  -- ═══════════════════════════════════════════════════════════
  model TEXT NOT NULL,
  model_config JSONB DEFAULT '{}',
  system_prompt_hash TEXT,

  -- Limits
  max_turns INTEGER,
  max_tokens INTEGER,
  max_cost_usd NUMERIC(12,6),
  timeout_ms INTEGER,

  -- Tools available
  tools_available TEXT[] DEFAULT '{}',

  -- ═══════════════════════════════════════════════════════════
  -- STATE (for real-time UI)
  -- ═══════════════════════════════════════════════════════════
  status TEXT DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'initializing', 'running', 'thinking', 'streaming',
      'tool_running', 'completed', 'failed', 'cancelled', 'timeout'
    )),

  -- Current turn
  current_turn INTEGER DEFAULT 0,

  -- Current activity (for UI)
  current_activity TEXT,
  current_llm_call_id UUID,
  current_tool_call_id UUID,

  -- Streaming state
  streaming_text TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- RESULT
  -- ═══════════════════════════════════════════════════════════
  result JSONB,
  result_summary TEXT,
  stop_reason TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- TOKENS & COST
  -- ═══════════════════════════════════════════════════════════
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cache_read_tokens BIGINT DEFAULT 0,
  cache_write_tokens BIGINT DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- TIMING
  -- ═══════════════════════════════════════════════════════════
  started_at TIMESTAMPTZ,
  first_token_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,
  api_time_ms BIGINT,
  tool_time_ms BIGINT,

  -- ═══════════════════════════════════════════════════════════
  -- TOOL USAGE SUMMARY
  -- ═══════════════════════════════════════════════════════════
  tools_used TEXT[] DEFAULT '{}',
  tool_call_count INTEGER DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- ERROR
  -- ═══════════════════════════════════════════════════════════
  error_code TEXT,
  error_message TEXT,
  error_turn INTEGER,
  error_details JSONB,

  -- ═══════════════════════════════════════════════════════════
  -- METADATA
  -- ═══════════════════════════════════════════════════════════
  sequence_number INTEGER,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_sessions_workflow ON agent_sessions(workflow_id);
CREATE INDEX idx_agent_sessions_trace ON agent_sessions(trace_id);
CREATE INDEX idx_agent_sessions_parent ON agent_sessions(parent_session_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_name);
CREATE INDEX idx_agent_sessions_context ON agent_sessions(context_type, context_id);
CREATE INDEX idx_agent_sessions_model ON agent_sessions(model);
CREATE INDEX idx_agent_sessions_created ON agent_sessions(created_at DESC);

-- Add foreign key for current_session_id after agent_sessions exists
ALTER TABLE workflow_runs
  ADD CONSTRAINT fk_workflow_current_session
  FOREIGN KEY (current_session_id) REFERENCES agent_sessions(id);

-- ============================================================
-- TABLE 3: llm_calls
-- Every single API call to Claude
-- ============================================================
CREATE TABLE llm_calls (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY & HIERARCHY
  -- ═══════════════════════════════════════════════════════════
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,

  turn_number INTEGER NOT NULL,

  -- ═══════════════════════════════════════════════════════════
  -- REQUEST (for replay)
  -- ═══════════════════════════════════════════════════════════
  provider TEXT DEFAULT 'anthropic',
  model TEXT NOT NULL,

  system_prompt TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  tools_provided JSONB DEFAULT '[]',
  tool_choice JSONB,

  -- ═══════════════════════════════════════════════════════════
  -- RESPONSE
  -- ═══════════════════════════════════════════════════════════
  response_id TEXT,
  stop_reason TEXT,

  content_blocks JSONB DEFAULT '[]',
  text_response TEXT,
  tool_calls_requested JSONB DEFAULT '[]',

  -- ═══════════════════════════════════════════════════════════
  -- TOKENS & COST
  -- ═══════════════════════════════════════════════════════════
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- TIMING
  -- ═══════════════════════════════════════════════════════════
  started_at TIMESTAMPTZ,
  first_token_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  tokens_per_second NUMERIC(10,2),

  is_streaming BOOLEAN DEFAULT true,

  -- ═══════════════════════════════════════════════════════════
  -- ERROR
  -- ═══════════════════════════════════════════════════════════
  is_error BOOLEAN DEFAULT false,
  error_code TEXT,
  error_message TEXT,

  retry_attempt INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_llm_calls_session ON llm_calls(session_id, turn_number);
CREATE INDEX idx_llm_calls_workflow ON llm_calls(workflow_id);
CREATE INDEX idx_llm_calls_trace ON llm_calls(trace_id);
CREATE INDEX idx_llm_calls_model ON llm_calls(provider, model);
CREATE INDEX idx_llm_calls_created ON llm_calls(created_at DESC);
CREATE INDEX idx_llm_calls_error ON llm_calls(is_error) WHERE is_error = true;

-- Add foreign key for current_llm_call_id
ALTER TABLE agent_sessions
  ADD CONSTRAINT fk_session_current_llm_call
  FOREIGN KEY (current_llm_call_id) REFERENCES llm_calls(id);

-- ============================================================
-- TABLE 4: tool_calls
-- Every tool invocation
-- ============================================================
CREATE TABLE tool_calls (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY & HIERARCHY
  -- ═══════════════════════════════════════════════════════════
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  llm_call_id UUID REFERENCES llm_calls(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,

  tool_use_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_type TEXT,

  parent_tool_call_id UUID REFERENCES tool_calls(id),
  depth INTEGER DEFAULT 0,

  turn_number INTEGER,
  sequence_in_turn INTEGER DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- INPUT/OUTPUT
  -- ═══════════════════════════════════════════════════════════
  input JSONB NOT NULL DEFAULT '{}',
  input_preview TEXT,

  output JSONB,
  output_preview TEXT,
  output_type TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- STATE
  -- ═══════════════════════════════════════════════════════════
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')),

  progress_pct INTEGER,
  progress_message TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- TIMING
  -- ═══════════════════════════════════════════════════════════
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms BIGINT,

  -- ═══════════════════════════════════════════════════════════
  -- ERROR
  -- ═══════════════════════════════════════════════════════════
  is_error BOOLEAN DEFAULT false,
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_llm ON tool_calls(llm_call_id);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_workflow ON tool_calls(workflow_id);
CREATE INDEX idx_tool_calls_trace ON tool_calls(trace_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX idx_tool_calls_status ON tool_calls(status);
CREATE INDEX idx_tool_calls_error ON tool_calls(is_error) WHERE is_error = true;

-- Add foreign key for current_tool_call_id
ALTER TABLE agent_sessions
  ADD CONSTRAINT fk_session_current_tool_call
  FOREIGN KEY (current_tool_call_id) REFERENCES tool_calls(id);

-- ============================================================
-- TABLE 5: entities
-- Generic tracking of domain objects
-- ============================================================
CREATE TABLE entities (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY
  -- ═══════════════════════════════════════════════════════════
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  trace_id UUID,

  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,

  name TEXT NOT NULL,
  description TEXT,
  url TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- FLEXIBLE DATA
  -- ═══════════════════════════════════════════════════════════
  attributes JSONB NOT NULL DEFAULT '{}',

  -- ═══════════════════════════════════════════════════════════
  -- STATE
  -- ═══════════════════════════════════════════════════════════
  status TEXT DEFAULT 'pending',
  status_message TEXT,

  current_phase TEXT,
  progress_pct INTEGER DEFAULT 0,

  current_session_id UUID REFERENCES agent_sessions(id),

  -- ═══════════════════════════════════════════════════════════
  -- RESULTS
  -- ═══════════════════════════════════════════════════════════
  results JSONB DEFAULT '{}',
  scores JSONB DEFAULT '{}',

  verdict TEXT,
  verdict_reason TEXT,
  verdict_confidence NUMERIC(5,4),

  -- ═══════════════════════════════════════════════════════════
  -- COST
  -- ═══════════════════════════════════════════════════════════
  total_cost_usd NUMERIC(12,6) DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- TIMING
  -- ═══════════════════════════════════════════════════════════
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,

  -- ═══════════════════════════════════════════════════════════
  -- ERROR
  -- ═══════════════════════════════════════════════════════════
  error_code TEXT,
  error_message TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- METADATA
  -- ═══════════════════════════════════════════════════════════
  priority INTEGER DEFAULT 0,
  sort_order INTEGER,
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workflow_id, entity_type, external_id)
);

CREATE INDEX idx_entities_workflow ON entities(workflow_id);
CREATE INDEX idx_entities_trace ON entities(trace_id);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_external ON entities(entity_type, external_id);
CREATE INDEX idx_entities_status ON entities(status);
CREATE INDEX idx_entities_tags ON entities USING GIN(tags);

-- ============================================================
-- TABLE 6: messages
-- Full conversation history for replay
-- ============================================================
CREATE TABLE messages (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY & HIERARCHY
  -- ═══════════════════════════════════════════════════════════
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  llm_call_id UUID REFERENCES llm_calls(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,

  turn_number INTEGER NOT NULL,
  sequence_in_turn INTEGER DEFAULT 0,

  -- ═══════════════════════════════════════════════════════════
  -- MESSAGE CONTENT
  -- ═══════════════════════════════════════════════════════════
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool_result')),

  content JSONB NOT NULL DEFAULT '[]',
  text_content TEXT,

  tool_use_id TEXT,
  tool_name TEXT,

  -- ═══════════════════════════════════════════════════════════
  -- METADATA
  -- ═══════════════════════════════════════════════════════════
  token_count INTEGER,

  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON messages(session_id, turn_number, sequence_in_turn);
CREATE INDEX idx_messages_llm_call ON messages(llm_call_id);
CREATE INDEX idx_messages_workflow ON messages(workflow_id);
CREATE INDEX idx_messages_trace ON messages(trace_id);

-- ============================================================
-- TABLE 7: events
-- Immutable activity log
-- ============================================================
CREATE TABLE events (
  -- ═══════════════════════════════════════════════════════════
  -- IDENTITY
  -- ═══════════════════════════════════════════════════════════
  id BIGSERIAL PRIMARY KEY,

  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  llm_call_id UUID REFERENCES llm_calls(id) ON DELETE CASCADE,
  tool_call_id UUID REFERENCES tool_calls(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  trace_id UUID,

  -- ═══════════════════════════════════════════════════════════
  -- EVENT TYPE
  -- ═══════════════════════════════════════════════════════════
  event_type TEXT NOT NULL,
  event_category TEXT,

  level TEXT DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'warn', 'error')),

  -- ═══════════════════════════════════════════════════════════
  -- CONTENT
  -- ═══════════════════════════════════════════════════════════
  message TEXT,
  data JSONB NOT NULL DEFAULT '{}',

  -- ═══════════════════════════════════════════════════════════
  -- ORDERING
  -- ═══════════════════════════════════════════════════════════
  sequence BIGSERIAL,

  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_workflow ON events(workflow_id, sequence);
CREATE INDEX idx_events_session ON events(session_id, sequence);
CREATE INDEX idx_events_trace ON events(trace_id, sequence);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_category ON events(event_category);
CREATE INDEX idx_events_level ON events(level) WHERE level IN ('warn', 'error');
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_workflow_runs_updated
  BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_agent_sessions_updated
  BEFORE UPDATE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_entities_updated
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-propagate trace_id from workflow
CREATE OR REPLACE FUNCTION set_trace_id_from_workflow()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trace_id IS NULL AND NEW.workflow_id IS NOT NULL THEN
    SELECT trace_id INTO NEW.trace_id
    FROM workflow_runs WHERE id = NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_agent_sessions_trace
  BEFORE INSERT ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION set_trace_id_from_workflow();

CREATE TRIGGER tr_entities_trace
  BEFORE INSERT ON entities
  FOR EACH ROW EXECUTE FUNCTION set_trace_id_from_workflow();

-- ============================================================
-- VIEWS FOR ANALYTICS
-- ============================================================

-- Workflow status overview
CREATE OR REPLACE VIEW v_workflow_status AS
SELECT
  w.*,
  COUNT(DISTINCT s.id) as session_count,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status IN ('running', 'thinking', 'streaming', 'tool_running')) as active_sessions,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed') as completed_sessions,
  COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'failed') as failed_sessions,
  COUNT(DISTINCT e.id) as entity_count
FROM workflow_runs w
LEFT JOIN agent_sessions s ON s.workflow_id = w.id
LEFT JOIN entities e ON e.workflow_id = w.id
GROUP BY w.id;

-- Model performance
CREATE OR REPLACE VIEW v_model_performance AS
SELECT
  provider,
  model,
  COUNT(*) as total_calls,
  AVG(duration_ms) as avg_latency_ms,
  AVG(time_to_first_token_ms) as avg_ttft_ms,
  AVG(tokens_per_second) as avg_tps,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cost_usd) as total_cost_usd,
  COUNT(*) FILTER (WHERE is_error) as error_count,
  ROUND(COUNT(*) FILTER (WHERE is_error)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as error_rate_pct
FROM llm_calls
GROUP BY provider, model;

-- Tool usage stats
CREATE OR REPLACE VIEW v_tool_usage AS
SELECT
  tool_name,
  tool_type,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE status = 'completed') as successful,
  COUNT(*) FILTER (WHERE is_error) as failed,
  AVG(duration_ms) as avg_duration_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms
FROM tool_calls
GROUP BY tool_name, tool_type;

-- Agent performance
CREATE OR REPLACE VIEW v_agent_performance AS
SELECT
  agent_name,
  model,
  COUNT(*) as total_sessions,
  COUNT(*) FILTER (WHERE status = 'completed') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as success_rate_pct,
  AVG(duration_ms) as avg_duration_ms,
  AVG(cost_usd) as avg_cost_usd,
  AVG(current_turn) as avg_turns,
  AVG(tool_call_count) as avg_tool_calls
FROM agent_sessions
GROUP BY agent_name, model;

-- Recent errors
CREATE OR REPLACE VIEW v_recent_errors AS
SELECT * FROM (
  SELECT
    'workflow' as source,
    id::TEXT as source_id,
    name,
    error_code,
    error_message,
    created_at as timestamp
  FROM workflow_runs WHERE status = 'failed'
  UNION ALL
  SELECT
    'session' as source,
    id::TEXT as source_id,
    agent_name as name,
    error_code,
    error_message,
    created_at as timestamp
  FROM agent_sessions WHERE status = 'failed'
  UNION ALL
  SELECT
    'llm_call' as source,
    id::TEXT as source_id,
    model as name,
    error_code,
    error_message,
    created_at as timestamp
  FROM llm_calls WHERE is_error = true
  UNION ALL
  SELECT
    'tool_call' as source,
    id::TEXT as source_id,
    tool_name as name,
    error_code,
    error_message,
    created_at as timestamp
  FROM tool_calls WHERE is_error = true
) errors
ORDER BY timestamp DESC
LIMIT 100;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Get full trace for debugging
CREATE OR REPLACE FUNCTION get_workflow_trace(p_workflow_id UUID)
RETURNS TABLE (
  level TEXT,
  id UUID,
  name TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  duration_ms BIGINT,
  cost_usd NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'workflow'::TEXT, w.id, w.name, w.status, w.started_at, w.duration_ms, w.total_cost_usd
  FROM workflow_runs w WHERE w.id = p_workflow_id
  UNION ALL
  SELECT 'session'::TEXT, s.id, s.agent_name, s.status, s.started_at, s.duration_ms, s.cost_usd
  FROM agent_sessions s WHERE s.workflow_id = p_workflow_id
  UNION ALL
  SELECT 'llm_call'::TEXT, l.id, l.model, CASE WHEN l.is_error THEN 'error' ELSE 'completed' END,
         l.started_at, l.duration_ms::BIGINT, l.cost_usd
  FROM llm_calls l WHERE l.workflow_id = p_workflow_id
  ORDER BY started_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workflow_runs;
    ALTER PUBLICATION supabase_realtime ADD TABLE agent_sessions;
    ALTER PUBLICATION supabase_realtime ADD TABLE entities;
    ALTER PUBLICATION supabase_realtime ADD TABLE events;
    ALTER PUBLICATION supabase_realtime ADD TABLE tool_calls;
  END IF;
END $$;
