/**
 * Entity Repository
 * CRUD operations for entities table
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import type { Entity, EntityInsert, EntityUpdate } from "../types.js";

export async function create(data: EntityInsert): Promise<Entity | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: entity, error } = await supabase
    .from("entities")
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error("[EntityRepo] Create error:", error.message);
    return null;
  }

  return entity;
}

export async function upsert(data: EntityInsert): Promise<Entity | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data: entity, error } = await supabase
    .from("entities")
    .upsert(data, {
      onConflict: "workflow_id,entity_type,external_id",
    })
    .select()
    .single();

  if (error) {
    console.error("[EntityRepo] Upsert error:", error.message);
    return null;
  }

  return entity;
}

export async function get(id: string): Promise<Entity | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("entities")
    .select()
    .eq("id", id)
    .single();

  if (error) {
    console.error("[EntityRepo] Get error:", error.message);
    return null;
  }

  return data;
}

export async function getByExternalId(
  entityType: string,
  externalId: string,
  workflowId?: string
): Promise<Entity | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  let query = supabase
    .from("entities")
    .select()
    .eq("entity_type", entityType)
    .eq("external_id", externalId);

  if (workflowId) {
    query = query.eq("workflow_id", workflowId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[EntityRepo] Get by external ID error:", error.message);
    return null;
  }

  return data;
}

export async function update(id: string, data: EntityUpdate): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { error } = await supabase.from("entities").update(data).eq("id", id);

  if (error) {
    console.error("[EntityRepo] Update error:", error.message);
    return false;
  }

  return true;
}

export async function startProcessing(
  id: string,
  sessionId?: string,
  phase?: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "processing",
    status_reason: "Processing started",
    current_phase: phase,
    processing_started_at: new Date().toISOString(),
  };

  if (sessionId) {
    updateData.session_ids = [sessionId];
  }

  const { error } = await supabase.from("entities").update(updateData).eq("id", id);

  if (error) {
    console.error("[EntityRepo] StartProcessing error:", error.message);
    return false;
  }
  return true;
}

export async function updateProgress(
  id: string,
  progressPct: number,
  message?: string,
  phase?: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    progress_percent: progressPct,
  };
  if (message) updateData.status_reason = message;
  if (phase) updateData.current_phase = phase;

  const { error } = await supabase.from("entities").update(updateData).eq("id", id);

  if (error) {
    console.error("[EntityRepo] UpdateProgress error:", error.message);
    return false;
  }
  return true;
}

export async function completeProcessing(
  id: string,
  result: {
    results?: Record<string, unknown>;
    scores?: Record<string, number>;
    verdict?: string;
    verdict_reason?: string;
    verdict_confidence?: number;
    total_cost_usd?: number;
  }
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const updateData: Record<string, unknown> = {
    status: "completed",
    status_reason: null,
    progress_percent: 100,
    session_ids: [],
    processing_completed_at: new Date().toISOString(),
  };

  if (result.results !== undefined) updateData.results = result.results;
  if (result.scores !== undefined) updateData.scores = result.scores;
  if (result.verdict !== undefined) updateData.verdict = result.verdict;
  if (result.verdict_reason !== undefined) updateData.verdict_reason = result.verdict_reason;
  if (result.verdict_confidence !== undefined) updateData.verdict_confidence = result.verdict_confidence;
  if (result.total_cost_usd !== undefined) updateData.total_cost_usd = result.total_cost_usd;

  const { error } = await supabase.from("entities").update(updateData).eq("id", id);

  if (error) {
    console.error("[EntityRepo] CompleteProcessing error:", error.message);
    return false;
  }
  return true;
}

export async function failProcessing(
  id: string,
  errorCode: string,
  errorMessage: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("entities")
    .update({
      status: "failed",
      status_reason: errorMessage,
      session_ids: [],
      processing_completed_at: new Date().toISOString(),
      error_type: errorCode,
      error_message: errorMessage,
    })
    .eq("id", id);

  if (error) {
    console.error("[EntityRepo] FailProcessing error:", error.message);
    return false;
  }
  return true;
}

export async function skip(id: string, reason?: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("entities")
    .update({
      status: "skipped",
      status_reason: reason ?? "Skipped",
      progress_percent: 0,
    })
    .eq("id", id);

  if (error) {
    console.error("[EntityRepo] Skip error:", error.message);
    return false;
  }
  return true;
}

export async function setVerdict(
  id: string,
  verdict: string,
  reason?: string,
  confidence?: number
): Promise<boolean> {
  return update(id, {
    verdict,
    verdict_reason: reason,
    verdict_confidence: confidence,
  });
}

export async function addScore(
  id: string,
  scoreName: string,
  scoreValue: number
): Promise<boolean> {
  const entity = await get(id);
  if (!entity) return false;

  return update(id, {
    scores: {
      ...entity.scores,
      [scoreName]: scoreValue,
    },
  });
}

export async function getForWorkflow(
  workflowId: string,
  entityType?: string
): Promise<Entity[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  let query = supabase
    .from("entities")
    .select()
    .eq("workflow_id", workflowId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[EntityRepo] Get for workflow error:", error.message);
    return [];
  }

  return data ?? [];
}

export async function getByStatus(
  workflowId: string,
  status: string,
  entityType?: string
): Promise<Entity[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  let query = supabase
    .from("entities")
    .select()
    .eq("workflow_id", workflowId)
    .eq("status", status);

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[EntityRepo] Get by status error:", error.message);
    return [];
  }

  return data ?? [];
}

export async function countByStatus(
  workflowId: string,
  entityType?: string
): Promise<Record<string, number>> {
  if (!isSupabaseConfigured()) return {};

  const supabase = getSupabase();
  let query = supabase
    .from("entities")
    .select("status")
    .eq("workflow_id", workflowId);

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[EntityRepo] Count by status error:", error.message);
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return counts;
}

export async function list(options: {
  limit?: number;
  entityType?: string;
  status?: string;
}): Promise<Entity[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  let query = supabase
    .from("entities")
    .select()
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  if (options.entityType) query = query.eq("entity_type", options.entityType);
  if (options.status) query = query.eq("status", options.status);

  const { data, error } = await query;

  if (error) {
    console.error("[EntityRepo] List error:", error.message);
    return [];
  }

  return data ?? [];
}

export const entityRepo = {
  create,
  upsert,
  get,
  getByExternalId,
  update,
  startProcessing,
  updateProgress,
  completeProcessing,
  failProcessing,
  skip,
  setVerdict,
  addScore,
  getForWorkflow,
  getByStatus,
  countByStatus,
  list,
};
