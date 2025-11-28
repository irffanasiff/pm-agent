/**
 * Supabase Observability
 * Database-backed implementation using existing schema
 */

import type {
  IObservability,
  StartSessionParams,
  SessionResult,
  ObservabilityEvent,
  ObservabilityOptions,
  LogLevel,
} from "./types.js";

// Import from @probable/db package
import {
  isSupabaseConfigured,
  sessionRepo,
  toolRepo,
  emitAgentStarted,
  emitAgentCompleted,
  emitAgentFailed,
  emitToolStarted,
  emitToolCompleted,
  flushEvents,
} from "@probable/db";

/**
 * Supabase observability options
 */
export interface SupabaseObservabilityOptions extends ObservabilityOptions {
  /** Workflow ID to link sessions to */
  workflowId?: string;

  /** System name (e.g., "analyst", "scout") */
  systemName?: string;
}

/**
 * Supabase-backed observability
 */
export class SupabaseObservability implements IObservability {
  private readonly options: SupabaseObservabilityOptions;
  private readonly enabled: boolean;

  constructor(options: SupabaseObservabilityOptions = {}) {
    this.options = {
      logLevel: options.logLevel ?? "info",
      console: options.console ?? true,
      ...options,
    };
    this.enabled = isSupabaseConfigured();

    if (!this.enabled) {
      this.log("warn", "[Observability] Supabase not configured - using console only");
    }
  }

  /**
   * Start tracking an agent session
   */
  async startSession(params: StartSessionParams): Promise<string> {
    // Always log to console
    this.log("info", `[${params.agentName}] Session started`, {
      correlationId: params.correlationId,
      agentVersion: params.agentVersion,
    });

    if (!this.enabled) {
      return params.correlationId;
    }

    try {
      // Create session in database
      const session = await sessionRepo.create({
        workflow_id: this.options.workflowId,
        trace_id: params.correlationId,
        agent_name: params.agentName,
        agent_version: params.agentVersion,
        task: typeof params.input === "object" && params.input !== null
          ? JSON.stringify(params.input).slice(0, 500)
          : String(params.input).slice(0, 500),
        task_type: this.options.systemName ?? params.agentName,
        model: "claude-sonnet-4-20250514",
        tools_available: [],
      });

      if (session?.id) {
        await sessionRepo.start(session.id);

        // Emit event
        emitAgentStarted(
          {
            traceId: params.correlationId,
            workflowId: this.options.workflowId,
            sessionId: session.id,
          },
          params.agentName,
          "claude-sonnet-4-20250514",
          String(params.input).slice(0, 200)
        );

        return session.id;
      }
    } catch (error) {
      this.log("error", "[Observability] Failed to create session", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return params.correlationId;
  }

  /**
   * End a session
   */
  async endSession(sessionId: string, result: SessionResult): Promise<void> {
    const metadata = result.metadata as Record<string, unknown> | undefined;

    if (result.success) {
      this.log("info", `Session completed`, {
        sessionId,
        durationMs: metadata?.durationMs,
        costUsd: metadata?.costUsd,
      });
    } else {
      this.log("error", `Session failed`, {
        sessionId,
        error: result.error instanceof Error ? result.error.message : String(result.error),
      });
    }

    if (!this.enabled) {
      return;
    }

    try {
      if (result.success) {
        await sessionRepo.complete(sessionId, {
          result: result.output,
          result_summary: typeof result.output === "object"
            ? JSON.stringify(result.output).slice(0, 500)
            : String(result.output).slice(0, 500),
          stop_reason: "end_turn",
          cost_usd: (metadata?.costUsd as number) ?? 0,
          duration_ms: (metadata?.durationMs as number) ?? 0,
          tools_used: (metadata?.toolsUsed as string[]) ?? [],
          tool_call_count: ((metadata?.toolsUsed as string[]) ?? []).length,
        });

        emitAgentCompleted(
          {
            traceId: sessionId,
            sessionId,
            workflowId: this.options.workflowId,
          },
          {
            agent_name: (metadata?.agentName as string) ?? "unknown",
            turns: (metadata?.turns as number) ?? 0,
            duration_ms: (metadata?.durationMs as number) ?? 0,
            cost_usd: (metadata?.costUsd as number) ?? 0,
            tools_used: (metadata?.toolsUsed as string[]) ?? [],
          }
        );
      } else {
        const errorMsg = result.error instanceof Error
          ? result.error.message
          : String(result.error);

        await sessionRepo.fail(sessionId, "AGENT_ERROR", errorMsg);

        emitAgentFailed(
          {
            traceId: sessionId,
            sessionId,
            workflowId: this.options.workflowId,
          },
          (metadata?.agentName as string) ?? "unknown",
          "AGENT_ERROR",
          errorMsg
        );
      }

      await flushEvents();
    } catch (error) {
      this.log("error", "[Observability] Failed to end session", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record an event
   */
  async recordEvent(event: ObservabilityEvent): Promise<void> {
    const level = event.level ?? "info";

    this.log(level, `[Event] ${event.type}`, {
      correlationId: event.correlationId,
      sessionId: event.sessionId,
      ...event.data,
    });

    // Events are automatically batched by the event store
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }

  /**
   * Log a message
   */
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.options.console) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data && Object.keys(data).length > 0) {
      const dataStr = JSON.stringify(data);
      console.log(`${prefix} ${message} ${dataStr}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Record a metric
   */
  metric(name: string, value: number, tags?: Record<string, string>): void {
    this.log("info", `METRIC: ${name}=${value}`, tags);
  }
}

/**
 * Create Supabase observability
 */
export function createSupabaseObservability(
  options?: SupabaseObservabilityOptions
): IObservability {
  return new SupabaseObservability(options);
}
