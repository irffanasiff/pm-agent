/**
 * Session Repository
 * CRUD operations for agent_sessions table
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type {
  AgentSession,
  AgentSessionInsert,
  AgentSessionUpdate,
  SessionStatus,
} from "../types.js";

export async function create(data: AgentSessionInsert): Promise<AgentSession | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: session, error } = await supabase
    .from("agent_sessions")
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error("[SessionRepo] Create error:", error.message);
    return null;
  }

  return session;
}

export async function get(id: string): Promise<AgentSession | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("agent_sessions")
    .select()
    .eq("id", id)
    .single();

  if (error) {
    console.error("[SessionRepo] Get error:", error.message);
    return null;
  }

  return data;
}

export async function update(id: string, data: AgentSessionUpdate): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("agent_sessions")
    .update(data)
    .eq("id", id);

  if (error) {
    console.error("[SessionRepo] Update error:", error.message);
    return false;
  }

  return true;
}

export async function start(id: string): Promise<boolean> {
  return update(id, {
    status: "running",
    started_at: new Date().toISOString(),
  });
}

export async function setThinking(id: string, _activity?: string): Promise<boolean> {
  return update(id, { status: "running" });
}

export async function setStreaming(id: string, _activity?: string): Promise<boolean> {
  const now = new Date().toISOString();
  const session = await get(id);
  const data: Partial<AgentSessionUpdate> = { status: "running" };
  if (session && !session.first_token_at) {
    data.first_token_at = now;
  }
  return update(id, data as AgentSessionUpdate);
}

export async function updateStreamingText(_id: string, _text: string): Promise<boolean> {
  return true;
}

export async function setToolRunning(id: string, _toolCallId: string, _toolName: string): Promise<boolean> {
  return update(id, { status: "running" });
}

export async function clearToolRunning(id: string): Promise<boolean> {
  return update(id, { status: "running" });
}

export async function incrementTurn(id: string): Promise<boolean> {
  const session = await get(id);
  if (!session) return false;
  return update(id, { current_turn: session.current_turn + 1 });
}

export async function setCurrentLLMCall(_id: string, _llmCallId: string | null): Promise<boolean> {
  return true;
}

export async function complete(
  id: string,
  result: {
    result?: unknown;
    result_summary?: string;
    stop_reason?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_usd?: number;
    duration_ms?: number;
    api_time_ms?: number;
    tool_time_ms?: number;
    tools_used?: string[];
    tool_call_count?: number;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "completed",
    completed_at: new Date().toISOString(),
  };

  if (result.result !== undefined) updateData.result = result.result;
  if (result.result_summary !== undefined) updateData.result_text = result.result_summary;
  if (result.stop_reason !== undefined) updateData.result_type = result.stop_reason;
  if (result.input_tokens !== undefined) updateData.input_tokens = result.input_tokens;
  if (result.output_tokens !== undefined) updateData.output_tokens = result.output_tokens;
  if (result.cache_read_tokens !== undefined) updateData.cache_read_tokens = result.cache_read_tokens;
  if (result.cache_write_tokens !== undefined) updateData.cache_write_tokens = result.cache_write_tokens;
  if (result.cost_usd !== undefined) updateData.cost_usd = result.cost_usd;
  if (result.duration_ms !== undefined) updateData.duration_ms = result.duration_ms;
  if (result.api_time_ms !== undefined) updateData.api_time_ms = result.api_time_ms;
  if (result.tool_time_ms !== undefined) updateData.tool_time_ms = result.tool_time_ms;
  if (result.tools_used !== undefined) updateData.tools_used = result.tools_used;
  if (result.tool_call_count !== undefined) updateData.tool_call_count = result.tool_call_count;

  const { error } = await supabase
    .from("agent_sessions")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[SessionRepo] Complete error:", error.message);
    return false;
  }

  return true;
}

export async function fail(
  id: string,
  errorCode: string,
  errorMessage: string,
  errorTurn?: number,
  _errorDetails?: Record<string, unknown>
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
    error_type: errorCode,
    error_message: errorMessage,
  };

  if (errorTurn !== undefined) updateData.error_turn = errorTurn;

  const { error } = await supabase
    .from("agent_sessions")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[SessionRepo] Fail error:", error.message);
    return false;
  }

  return true;
}

export async function timeout(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("agent_sessions")
    .update({
      status: "timeout",
      completed_at: new Date().toISOString(),
      error_type: "TIMEOUT",
      error_message: "Session timed out",
    })
    .eq("id", id);

  if (error) {
    console.error("[SessionRepo] Timeout error:", error.message);
    return false;
  }
  return true;
}

export async function cancel(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("agent_sessions")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[SessionRepo] Cancel error:", error.message);
    return false;
  }
  return true;
}

export async function addTokens(
  id: string,
  tokens: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    cost_usd?: number;
  }
): Promise<boolean> {
  const session = await get(id);
  if (!session) return false;

  return update(id, {
    input_tokens: session.input_tokens + (tokens.input ?? 0),
    output_tokens: session.output_tokens + (tokens.output ?? 0),
    cache_read_tokens: session.cache_read_tokens + (tokens.cache_read ?? 0),
    cache_write_tokens: session.cache_write_tokens + (tokens.cache_write ?? 0),
    cost_usd: session.cost_usd + (tokens.cost_usd ?? 0),
  });
}

export async function addToolUsed(id: string, toolName: string): Promise<boolean> {
  const session = await get(id);
  if (!session) return false;

  const toolsUsed = session.tools_used.includes(toolName)
    ? session.tools_used
    : [...session.tools_used, toolName];

  return update(id, {
    tools_used: toolsUsed,
    tool_call_count: session.tool_call_count + 1,
  });
}

export async function getForWorkflow(workflowId: string): Promise<AgentSession[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("agent_sessions")
    .select()
    .eq("workflow_id", workflowId)
    .order("sequence_number", { ascending: true });

  if (error) {
    console.error("[SessionRepo] Get for workflow error:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getActiveForWorkflow(workflowId: string): Promise<AgentSession[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("agent_sessions")
    .select()
    .eq("workflow_id", workflowId)
    .in("status", ["pending", "initializing", "running", "thinking", "streaming", "tool_running"])
    .order("sequence_number", { ascending: true });

  if (error) {
    console.error("[SessionRepo] Get active for workflow error:", error.message);
    return [];
  }

  return data ?? [];
}

export async function list(options: {
  limit?: number;
  status?: SessionStatus;
  agentName?: string;
  model?: string;
}): Promise<AgentSession[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  let query = supabase
    .from("agent_sessions")
    .select()
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.status) query = query.eq("status", options.status);
  if (options.agentName) query = query.eq("agent_name", options.agentName);
  if (options.model) query = query.eq("model", options.model);

  const { data, error } = await query;

  if (error) {
    console.error("[SessionRepo] List error:", error.message);
    return [];
  }

  return data ?? [];
}

export const sessionRepo = {
  create,
  get,
  update,
  start,
  setThinking,
  setStreaming,
  updateStreamingText,
  setToolRunning,
  clearToolRunning,
  incrementTurn,
  setCurrentLLMCall,
  complete,
  fail,
  timeout,
  cancel,
  addTokens,
  addToolUsed,
  getForWorkflow,
  getActiveForWorkflow,
  list,
};
