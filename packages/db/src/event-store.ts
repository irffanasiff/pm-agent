/**
 * Event Store
 * Batched event emission with retry handling
 */

import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import {
  EventTypes,
  type EventType,
  type EventInsert,
  type EventLevel,
  type TraceContext,
  getEventCategory,
} from "./types.js";

export { EventTypes };

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  BATCH_INTERVAL_MS: 100,
  MAX_BATCH_SIZE: 100,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 100,
  RETRY_MULTIPLIER: 2,
};

// ============================================================
// Event Queue
// ============================================================

interface QueuedEvent extends EventInsert {
  timestamp: string;
}

class EventQueue {
  private events: QueuedEvent[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private flushPromise: Promise<void> | null = null;

  add(event: QueuedEvent): void {
    this.events.push(event);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) return;

    if (this.events.length >= CONFIG.MAX_BATCH_SIZE) {
      this.flush().catch(console.error);
      return;
    }

    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush().catch(console.error);
    }, CONFIG.BATCH_INTERVAL_MS);
  }

  async flush(): Promise<void> {
    if (this.isFlushing && this.flushPromise) {
      await this.flushPromise;
      if (this.events.length > 0) {
        return this.flush();
      }
      return;
    }

    if (this.events.length === 0) return;
    if (!isSupabaseConfigured()) {
      this.events = [];
      return;
    }

    this.isFlushing = true;
    const batch = [...this.events];
    this.events = [];

    this.flushPromise = this.doFlush(batch);

    try {
      await this.flushPromise;
    } finally {
      this.isFlushing = false;
      this.flushPromise = null;
    }
  }

  private async doFlush(events: QueuedEvent[], attempt = 1): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.from("events").insert(events);

    if (error) {
      if (attempt < CONFIG.MAX_RETRIES) {
        const delay = CONFIG.RETRY_DELAY_MS * Math.pow(CONFIG.RETRY_MULTIPLIER, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
        return this.doFlush(events, attempt + 1);
      }
      console.error("[EventStore] Flush failed:", error.message);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    await this.flush();
  }

  getStats(): { pending: number } {
    return { pending: this.events.length };
  }
}

const queue = new EventQueue();

// ============================================================
// Public API
// ============================================================

export function emitEvent(
  eventType: EventType,
  context: TraceContext,
  options: {
    message?: string;
    data?: Record<string, unknown>;
    level?: EventLevel;
  } = {}
): void {
  if (!isSupabaseConfigured()) return;

  queue.add({
    trace_id: context.traceId,
    workflow_id: context.workflowId,
    session_id: context.sessionId,
    llm_call_id: context.llmCallId,
    tool_call_id: context.toolCallId,
    event_type: eventType,
    event_source: getEventCategory(eventType),
    level: options.level ?? "info",
    message: options.message,
    payload: options.data ?? {},
    timestamp: new Date().toISOString(),
  });
}

export async function flushEvents(): Promise<void> {
  await queue.flush();
}

export async function shutdown(): Promise<void> {
  await queue.shutdown();
}

export function getQueueStats(): { pending: number } {
  return queue.getStats();
}

// ============================================================
// Convenience Functions
// ============================================================

// Workflow events
export function emitWorkflowQueued(ctx: TraceContext, data?: Record<string, unknown>): void {
  emitEvent(EventTypes.WORKFLOW_QUEUED, ctx, { message: "Workflow queued", data });
}

export function emitWorkflowStarted(ctx: TraceContext, data?: Record<string, unknown>): void {
  emitEvent(EventTypes.WORKFLOW_STARTED, ctx, { message: "Workflow started", data });
}

export function emitWorkflowPhaseChanged(ctx: TraceContext, phase: string, previousPhase?: string): void {
  emitEvent(EventTypes.WORKFLOW_PHASE_CHANGED, ctx, {
    message: `Phase changed: ${previousPhase ?? "none"} → ${phase}`,
    data: { phase, previousPhase },
  });
}

export function emitWorkflowProgress(ctx: TraceContext, pct: number, message?: string): void {
  emitEvent(EventTypes.WORKFLOW_PROGRESS, ctx, {
    message: message ?? `Progress: ${pct}%`,
    data: { progress_pct: pct },
  });
}

export function emitWorkflowCompleted(ctx: TraceContext, summary?: string): void {
  emitEvent(EventTypes.WORKFLOW_COMPLETED, ctx, {
    message: summary ?? "Workflow completed",
    data: { summary },
  });
}

export function emitWorkflowFailed(ctx: TraceContext, errorCode: string, errorMessage: string): void {
  emitEvent(EventTypes.WORKFLOW_FAILED, ctx, {
    message: `Workflow failed: ${errorMessage}`,
    data: { error_code: errorCode, error_message: errorMessage },
    level: "error",
  });
}

export function emitWorkflowCancelled(ctx: TraceContext): void {
  emitEvent(EventTypes.WORKFLOW_CANCELLED, ctx, { message: "Workflow cancelled" });
}

// Agent events
export function emitAgentStarted(ctx: TraceContext, agentName: string, model: string, task?: string): void {
  emitEvent(EventTypes.AGENT_STARTED, ctx, {
    message: `Agent ${agentName} started`,
    data: { agent_name: agentName, model, task },
  });
}

export function emitAgentThinking(ctx: TraceContext, activity?: string): void {
  emitEvent(EventTypes.AGENT_THINKING, ctx, {
    message: activity ?? "Thinking...",
    data: { activity },
  });
}

export function emitAgentStreaming(ctx: TraceContext): void {
  emitEvent(EventTypes.AGENT_STREAMING, ctx, { message: "Streaming response..." });
}

export function emitAgentToolRunning(ctx: TraceContext, toolName: string): void {
  emitEvent(EventTypes.AGENT_TOOL_RUNNING, ctx, {
    message: `Running tool: ${toolName}`,
    data: { tool_name: toolName },
  });
}

export function emitAgentTurnCompleted(ctx: TraceContext, turn: number): void {
  emitEvent(EventTypes.AGENT_TURN_COMPLETED, ctx, {
    message: `Turn ${turn} completed`,
    data: { turn },
  });
}

export function emitAgentCompleted(
  ctx: TraceContext,
  result: {
    agent_name: string;
    turns: number;
    duration_ms: number;
    cost_usd: number;
    tools_used: string[];
  }
): void {
  emitEvent(EventTypes.AGENT_COMPLETED, ctx, {
    message: `Agent ${result.agent_name} completed in ${result.turns} turns`,
    data: result,
  });
}

export function emitAgentFailed(ctx: TraceContext, agentName: string, errorCode: string, errorMessage: string): void {
  emitEvent(EventTypes.AGENT_FAILED, ctx, {
    message: `Agent ${agentName} failed: ${errorMessage}`,
    data: { agent_name: agentName, error_code: errorCode, error_message: errorMessage },
    level: "error",
  });
}

// Tool events
export function emitToolStarted(ctx: TraceContext, toolName: string, inputPreview?: string): void {
  emitEvent(EventTypes.TOOL_STARTED, ctx, {
    message: `Tool ${toolName} started`,
    data: { tool_name: toolName, input_preview: inputPreview },
  });
}

export function emitToolProgress(ctx: TraceContext, toolName: string, pct: number, message?: string): void {
  emitEvent(EventTypes.TOOL_PROGRESS, ctx, {
    message: message ?? `Tool ${toolName}: ${pct}%`,
    data: { tool_name: toolName, progress_pct: pct },
  });
}

export function emitToolCompleted(ctx: TraceContext, toolName: string, durationMs: number, outputPreview?: string): void {
  emitEvent(EventTypes.TOOL_COMPLETED, ctx, {
    message: `Tool ${toolName} completed in ${durationMs}ms`,
    data: { tool_name: toolName, duration_ms: durationMs, output_preview: outputPreview },
  });
}

export function emitToolFailed(ctx: TraceContext, toolName: string, errorMessage: string): void {
  emitEvent(EventTypes.TOOL_FAILED, ctx, {
    message: `Tool ${toolName} failed: ${errorMessage}`,
    data: { tool_name: toolName, error_message: errorMessage },
    level: "error",
  });
}

// Entity events
export function emitEntityDiscovered(ctx: TraceContext, entityType: string, externalId: string, name: string): void {
  emitEvent(EventTypes.ENTITY_DISCOVERED, ctx, {
    message: `Discovered ${entityType}: ${name}`,
    data: { entity_type: entityType, external_id: externalId, name },
  });
}

export function emitEntityProcessingStarted(ctx: TraceContext, entityType: string, name: string): void {
  emitEvent(EventTypes.ENTITY_PROCESSING_STARTED, ctx, {
    message: `Processing ${entityType}: ${name}`,
    data: { entity_type: entityType, name },
  });
}

export function emitEntityProgress(ctx: TraceContext, entityType: string, name: string, pct: number): void {
  emitEvent(EventTypes.ENTITY_PROGRESS, ctx, {
    message: `${entityType} ${name}: ${pct}%`,
    data: { entity_type: entityType, name, progress_pct: pct },
  });
}

export function emitEntityCompleted(ctx: TraceContext, entityType: string, name: string, verdict?: string): void {
  emitEvent(EventTypes.ENTITY_COMPLETED, ctx, {
    message: `${entityType} ${name} completed${verdict ? `: ${verdict}` : ""}`,
    data: { entity_type: entityType, name, verdict },
  });
}

export function emitEntityFailed(ctx: TraceContext, entityType: string, name: string, errorMessage: string): void {
  emitEvent(EventTypes.ENTITY_FAILED, ctx, {
    message: `${entityType} ${name} failed: ${errorMessage}`,
    data: { entity_type: entityType, name, error_message: errorMessage },
    level: "error",
  });
}

// LLM events
export function emitLLMRequestStarted(ctx: TraceContext, model: string, turn: number): void {
  emitEvent(EventTypes.LLM_REQUEST_STARTED, ctx, {
    message: `LLM request started (turn ${turn})`,
    data: { model, turn },
    level: "debug",
  });
}

export function emitLLMFirstToken(ctx: TraceContext, ttftMs: number): void {
  emitEvent(EventTypes.LLM_FIRST_TOKEN, ctx, {
    message: `First token received in ${ttftMs}ms`,
    data: { time_to_first_token_ms: ttftMs },
    level: "debug",
  });
}

export function emitLLMResponseCompleted(
  ctx: TraceContext,
  result: { model: string; duration_ms: number; input_tokens: number; output_tokens: number; cost_usd: number }
): void {
  emitEvent(EventTypes.LLM_RESPONSE_COMPLETED, ctx, {
    message: `LLM response completed in ${result.duration_ms}ms`,
    data: result,
    level: "debug",
  });
}

export function emitLLMError(ctx: TraceContext, errorCode: string, errorMessage: string): void {
  emitEvent(EventTypes.LLM_ERROR, ctx, {
    message: `LLM error: ${errorMessage}`,
    data: { error_code: errorCode, error_message: errorMessage },
    level: "error",
  });
}

// System events
export function emitInfo(ctx: TraceContext, message: string, data?: Record<string, unknown>): void {
  emitEvent(EventTypes.INFO, ctx, { message, data });
}

export function emitWarn(ctx: TraceContext, message: string, data?: Record<string, unknown>): void {
  emitEvent(EventTypes.WARN, ctx, { message, data, level: "warn" });
}

export function emitError(ctx: TraceContext, message: string, data?: Record<string, unknown>): void {
  emitEvent(EventTypes.ERROR, ctx, { message, data, level: "error" });
}
