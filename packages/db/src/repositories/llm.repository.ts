/**
 * LLM Call Repository
 * CRUD operations for llm_calls table
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

export interface LLMCallInsert {
  session_id: string;
  workflow_id?: string | null;
  trace_id: string;
  turn_number: number;
  model: string;
  provider?: string;
  system_prompt?: string;
  messages?: unknown[];
  tools_provided?: unknown[];
  is_streaming?: boolean;
}

export interface LLMCallUpdate {
  response_id?: string;
  stop_reason?: string;
  content_blocks?: unknown[];
  text_response?: string;
  tool_calls_requested?: unknown[];
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  time_to_first_token_ms?: number;
  tokens_per_second?: number;
  is_error?: boolean;
  error_code?: string;
  error_message?: string;
}

export async function create(data: LLMCallInsert): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();

  const insertData: Record<string, unknown> = {
    session_id: data.session_id,
    trace_id: data.trace_id,
    turn_number: data.turn_number,
    model: data.model,
    provider: data.provider ?? "anthropic",
    started_at: new Date().toISOString(),
    is_streaming: data.is_streaming ?? true,
  };

  if (data.workflow_id) insertData.workflow_id = data.workflow_id;
  if (data.system_prompt) insertData.system_prompt = data.system_prompt;
  if (data.messages) insertData.messages = data.messages;
  if (data.tools_provided) insertData.tools_provided = data.tools_provided;

  const { data: result, error } = await supabase
    .from("llm_calls")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[LLMRepo] Create error:", error.message);
    return null;
  }

  return result?.id ?? null;
}

export async function complete(
  id: string,
  data: {
    response_id?: string;
    stop_reason?: string;
    text_response?: string;
    tool_calls_requested?: unknown[];
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_usd?: number;
    duration_ms?: number;
    first_token_at?: string;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    completed_at: new Date().toISOString(),
  };

  if (data.response_id !== undefined) updateData.response_id = data.response_id;
  if (data.stop_reason !== undefined) updateData.stop_reason = data.stop_reason;
  if (data.text_response !== undefined) updateData.text_response = data.text_response;
  if (data.tool_calls_requested !== undefined) updateData.tool_calls_requested = data.tool_calls_requested;
  if (data.input_tokens !== undefined) updateData.input_tokens = data.input_tokens;
  if (data.output_tokens !== undefined) updateData.output_tokens = data.output_tokens;
  if (data.cache_read_tokens !== undefined) updateData.cache_read_tokens = data.cache_read_tokens;
  if (data.cache_write_tokens !== undefined) updateData.cache_write_tokens = data.cache_write_tokens;
  if (data.cost_usd !== undefined) updateData.cost_usd = data.cost_usd;
  if (data.duration_ms !== undefined) updateData.duration_ms = data.duration_ms;
  if (data.first_token_at !== undefined) updateData.first_token_at = data.first_token_at;

  const { error } = await supabase
    .from("llm_calls")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[LLMRepo] Complete error:", error.message);
    return false;
  }

  return true;
}

export async function recordFirstToken(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("llm_calls")
    .update({
      first_token_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[LLMRepo] RecordFirstToken error:", error.message);
    return false;
  }

  return true;
}

export async function fail(
  id: string,
  errorCode: string,
  errorMessage: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("llm_calls")
    .update({
      is_error: true,
      error_code: errorCode,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[LLMRepo] Fail error:", error.message);
    return false;
  }

  return true;
}

export async function getForSession(sessionId: string) {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("llm_calls")
    .select("*")
    .eq("session_id", sessionId)
    .order("turn_number", { ascending: true });

  if (error) {
    console.error("[LLMRepo] GetForSession error:", error.message);
    return [];
  }

  return data ?? [];
}

export const llmRepo = {
  create,
  complete,
  recordFirstToken,
  fail,
  getForSession,
};
