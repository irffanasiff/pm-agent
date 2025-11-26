/**
 * Structured Logging
 * Simple but production-ready logging with context support
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  agentType?: string;
  marketId?: string;
  sessionId?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// Log level priority
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Current log level (default: info)
let currentLevel: LogLevel = "info";

// Log output handlers
type LogHandler = (entry: LogEntry) => void;
const handlers: LogHandler[] = [];

/**
 * Default console handler with colors
 */
const consoleHandler: LogHandler = (entry) => {
  const colors = {
    debug: "\x1b[90m", // gray
    info: "\x1b[36m",  // cyan
    warn: "\x1b[33m",  // yellow
    error: "\x1b[31m", // red
  };
  const reset = "\x1b[0m";
  const color = colors[entry.level];

  const prefix = `${color}[${entry.timestamp}] [${entry.level.toUpperCase()}]${reset}`;
  const contextStr = entry.context
    ? ` ${JSON.stringify(entry.context)}`
    : "";

  if (entry.error) {
    console.error(`${prefix} ${entry.message}${contextStr}`);
    console.error(`  Error: ${entry.error.message}`);
    if (entry.error.stack) {
      console.error(`  Stack: ${entry.error.stack.split("\n").slice(1, 4).join("\n")}`);
    }
  } else {
    console.log(`${prefix} ${entry.message}${contextStr}`);
  }
};

// Add default console handler
handlers.push(consoleHandler);

/**
 * Create a log entry
 */
function createEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = context;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return entry;
}

/**
 * Emit a log entry to all handlers
 */
function emit(entry: LogEntry): void {
  // Check if this level should be logged
  if (LEVEL_PRIORITY[entry.level] < LEVEL_PRIORITY[currentLevel]) {
    return;
  }

  for (const handler of handlers) {
    try {
      handler(entry);
    } catch (e) {
      console.error("Logger handler error:", e);
    }
  }
}

/**
 * Logger interface
 */
export const logger = {
  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return currentLevel;
  },

  /**
   * Add a custom log handler
   */
  addHandler(handler: LogHandler): void {
    handlers.push(handler);
  },

  /**
   * Remove all handlers (except console)
   */
  resetHandlers(): void {
    handlers.length = 0;
    handlers.push(consoleHandler);
  },

  /**
   * Debug level logging
   */
  debug(message: string, context?: LogContext): void {
    emit(createEntry("debug", message, context));
  },

  /**
   * Info level logging
   */
  info(message: string, context?: LogContext): void {
    emit(createEntry("info", message, context));
  },

  /**
   * Warning level logging
   */
  warn(message: string, context?: LogContext): void {
    emit(createEntry("warn", message, context));
  },

  /**
   * Error level logging
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const err = error instanceof Error ? error : undefined;
    emit(createEntry("error", message, context, err));
  },

  /**
   * Create a child logger with preset context
   */
  child(baseContext: LogContext): ChildLogger {
    return new ChildLogger(baseContext);
  },

  /**
   * Log a metric (for cost tracking, performance, etc.)
   */
  metric(name: string, value: number, context?: LogContext): void {
    emit(
      createEntry("info", `METRIC: ${name}=${value}`, {
        ...context,
        metric: name,
        value,
      })
    );
  },
};

/**
 * Child logger with preset context
 */
class ChildLogger {
  constructor(private baseContext: LogContext) {}

  debug(message: string, context?: LogContext): void {
    logger.debug(message, { ...this.baseContext, ...context });
  }

  info(message: string, context?: LogContext): void {
    logger.info(message, { ...this.baseContext, ...context });
  }

  warn(message: string, context?: LogContext): void {
    logger.warn(message, { ...this.baseContext, ...context });
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    logger.error(message, error, { ...this.baseContext, ...context });
  }

  metric(name: string, value: number, context?: LogContext): void {
    logger.metric(name, value, { ...this.baseContext, ...context });
  }

  /**
   * Create a child with additional context
   */
  child(additionalContext: LogContext): ChildLogger {
    return new ChildLogger({ ...this.baseContext, ...additionalContext });
  }
}

export type { ChildLogger };
