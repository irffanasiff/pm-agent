/**
 * Tool Call Repository
 * CRUD operations for tool_calls table
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

export interface ToolCallInsert {
  session_id: string;
  workflow_id?: string | null;
  trace_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_type?: string;
  turn_number?: number;
  sequence_in_turn?: number;
  input: Record<string, unknown>;
  input_preview?: string;
}

export interface ToolCallUpdate {
  status?: string;
  output?: Record<string, unknown>;
  output_preview?: string;
  output_type?: string;
  duration_ms?: number;
  is_error?: boolean;
  error_code?: string;
  error_message?: string;
}

export async function create(data: ToolCallInsert): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();

  const insertData: Record<string, unknown> = {
    session_id: data.session_id,
    trace_id: data.trace_id,
    tool_use_id: data.tool_use_id,
    tool_name: data.tool_name,
    input: data.input,
    status: "running",
    started_at: new Date().toISOString(),
  };

  if (data.workflow_id) insertData.workflow_id = data.workflow_id;
  if (data.tool_type) insertData.tool_type = data.tool_type;
  if (data.turn_number !== undefined) insertData.turn_number = data.turn_number;
  if (data.sequence_in_turn !== undefined) insertData.sequence_in_turn = data.sequence_in_turn;
  if (data.input_preview) insertData.input_preview = data.input_preview;

  const { data: result, error } = await supabase
    .from("tool_calls")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[ToolRepo] Create error:", error.message);
    return null;
  }

  return result?.id ?? null;
}

export async function complete(
  id: string,
  output: Record<string, unknown>,
  durationMs?: number
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "completed",
    output,
    output_preview: JSON.stringify(output).slice(0, 500),
    completed_at: new Date().toISOString(),
  };

  if (durationMs !== undefined) updateData.duration_ms = durationMs;

  const { error } = await supabase
    .from("tool_calls")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[ToolRepo] Complete error:", error.message);
    return false;
  }

  return true;
}

export async function fail(
  id: string,
  errorCode: string,
  errorMessage: string,
  durationMs?: number
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "failed",
    is_error: true,
    error_code: errorCode,
    error_message: errorMessage,
    completed_at: new Date().toISOString(),
  };

  if (durationMs !== undefined) updateData.duration_ms = durationMs;

  const { error } = await supabase
    .from("tool_calls")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[ToolRepo] Fail error:", error.message);
    return false;
  }

  return true;
}

export async function getForSession(sessionId: string) {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tool_calls")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[ToolRepo] GetForSession error:", error.message);
    return [];
  }

  return data ?? [];
}

export const toolRepo = {
  create,
  complete,
  fail,
  getForSession,
};
