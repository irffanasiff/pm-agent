/**
 * Console Observability
 * Simple console-based implementation
 */

import type {
  IObservability,
  StartSessionParams,
  SessionResult,
  ObservabilityEvent,
  ObservabilityOptions,
  LogLevel,
} from "./types.js";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Console-based observability
 */
export class ConsoleObservability implements IObservability {
  private readonly options: ObservabilityOptions;
  private readonly minLevel: number;

  constructor(options: ObservabilityOptions = {}) {
    this.options = {
      logLevel: options.logLevel ?? "info",
      console: options.console ?? true,
      ...options,
    };
    this.minLevel = LOG_LEVELS[this.options.logLevel ?? "info"];
  }

  /**
   * Start a session
   */
  async startSession(params: StartSessionParams): Promise<string> {
    const sessionId = crypto.randomUUID();

    this.log("info", `[${params.agentName}] Session started`, {
      sessionId,
      correlationId: params.correlationId,
      agentVersion: params.agentVersion,
    });

    return sessionId;
  }

  /**
   * End a session
   */
  async endSession(sessionId: string, result: SessionResult): Promise<void> {
    if (result.success) {
      this.log("info", `Session completed`, {
        sessionId,
        durationMs: (result.metadata as Record<string, unknown>)?.durationMs,
        costUsd: (result.metadata as Record<string, unknown>)?.costUsd,
      });
    } else {
      this.log("error", `Session failed`, {
        sessionId,
        error: result.error instanceof Error ? result.error.message : String(result.error),
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

    // Call custom handler if provided
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }

  /**
   * Log a message
   */
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

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
 * No-op observability for testing
 */
export class NoOpObservability implements IObservability {
  async startSession(_params: StartSessionParams): Promise<string> {
    return crypto.randomUUID();
  }

  async endSession(_sessionId: string, _result: SessionResult): Promise<void> {
    // No-op
  }

  async recordEvent(_event: ObservabilityEvent): Promise<void> {
    // No-op
  }

  log(_level: LogLevel, _message: string, _data?: Record<string, unknown>): void {
    // No-op
  }

  metric(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op
  }
}

/**
 * Create console observability
 */
export function createConsoleObservability(options?: ObservabilityOptions): IObservability {
  return new ConsoleObservability(options);
}

/**
 * Create no-op observability (for testing)
 */
export function createNoOpObservability(): IObservability {
  return new NoOpObservability();
}
