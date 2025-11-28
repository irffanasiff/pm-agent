/**
 * Workflow Repository
 * CRUD operations for workflow_runs table
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type {
  WorkflowRun,
  WorkflowRunInsert,
  WorkflowRunUpdate,
  WorkflowStatus,
} from "../types.js";

export async function create(data: WorkflowRunInsert): Promise<WorkflowRun | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: workflow, error } = await supabase
    .from("workflow_runs")
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error("[WorkflowRepo] Create error:", error.message);
    return null;
  }

  return workflow;
}

export async function get(id: string): Promise<WorkflowRun | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("workflow_runs")
    .select()
    .eq("id", id)
    .single();

  if (error) {
    console.error("[WorkflowRepo] Get error:", error.message);
    return null;
  }

  return data;
}

export async function update(id: string, data: WorkflowRunUpdate): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("workflow_runs")
    .update(data)
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] Update error:", error.message);
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

export async function updateProgress(
  id: string,
  progressPct: number,
  message?: string,
  counters?: Record<string, number>
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const progressObj: Record<string, unknown> = {
    percent: progressPct,
  };
  if (message) progressObj.message = message;

  const updateData: Record<string, unknown> = {
    progress: progressObj,
  };
  if (counters) updateData.counters = counters;

  const { error } = await supabase
    .from("workflow_runs")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] UpdateProgress error:", error.message);
    return false;
  }
  return true;
}

export async function updatePhase(
  id: string,
  phase: string,
  _phases?: WorkflowRun["phases"]
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("workflow_runs")
    .update({
      progress: { phase },
    })
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] UpdatePhase error:", error.message);
    return false;
  }
  return true;
}

export async function setActivity(
  _id: string,
  _activity: string,
  _sessionId?: string
): Promise<boolean> {
  return true;
}

export async function complete(
  id: string,
  output?: Record<string, unknown>,
  summary?: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "completed",
    completed_at: new Date().toISOString(),
    progress: { percent: 100 },
  };

  if (output) updateData.output = output;
  if (summary) updateData.output_summary = summary;

  const { error } = await supabase
    .from("workflow_runs")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] Complete error:", error.message);
    return false;
  }
  return true;
}

export async function fail(
  id: string,
  errorCode: string,
  errorMessage: string,
  errorDetails?: Record<string, unknown>
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "failed",
    completed_at: new Date().toISOString(),
    error_type: errorCode,
    error_message: errorMessage,
  };

  if (errorDetails) updateData.error_context = errorDetails;

  const { error } = await supabase
    .from("workflow_runs")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] Fail error:", error.message);
    return false;
  }
  return true;
}

export async function cancel(id: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("workflow_runs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] Cancel error:", error.message);
    return false;
  }
  return true;
}

export async function addTotals(
  id: string,
  totals: {
    cost_usd?: number;
    input_tokens?: number;
    output_tokens?: number;
    sessions?: number;
    llm_calls?: number;
    tool_calls?: number;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { data: workflow, error: getError } = await supabase
    .from("workflow_runs")
    .select("total_cost_usd, total_input_tokens, total_output_tokens, total_llm_calls, total_tool_calls")
    .eq("id", id)
    .single();

  if (getError || !workflow) {
    console.error("[WorkflowRepo] AddTotals get error:", getError?.message);
    return false;
  }

  const { error } = await supabase
    .from("workflow_runs")
    .update({
      total_cost_usd: (workflow.total_cost_usd || 0) + (totals.cost_usd ?? 0),
      total_input_tokens: (workflow.total_input_tokens || 0) + (totals.input_tokens ?? 0),
      total_output_tokens: (workflow.total_output_tokens || 0) + (totals.output_tokens ?? 0),
      total_llm_calls: (workflow.total_llm_calls || 0) + (totals.llm_calls ?? 0),
      total_tool_calls: (workflow.total_tool_calls || 0) + (totals.tool_calls ?? 0),
    })
    .eq("id", id);

  if (error) {
    console.error("[WorkflowRepo] AddTotals update error:", error.message);
    return false;
  }
  return true;
}

export async function list(options: {
  limit?: number;
  status?: WorkflowStatus;
  name?: string;
  initiatedBy?: string;
}): Promise<WorkflowRun[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  let query = supabase
    .from("workflow_runs")
    .select()
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.status) query = query.eq("status", options.status);
  if (options.name) query = query.eq("name", options.name);
  if (options.initiatedBy) query = query.eq("initiated_by", options.initiatedBy);

  const { data, error } = await query;

  if (error) {
    console.error("[WorkflowRepo] List error:", error.message);
    return [];
  }

  return data ?? [];
}

export const workflowRepo = {
  create,
  get,
  update,
  start,
  updateProgress,
  updatePhase,
  setActivity,
  complete,
  fail,
  cancel,
  addTotals,
  list,
};
