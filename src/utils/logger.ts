import { Logging } from '@google-cloud/logging';

// Initialize Google Cloud Logging
const logging = new Logging({
  projectId: process.env.GOOGLE_PROJECT_ID || 'bot-of-culture',
});

const log = logging.log('bot-of-culture-app');

export enum LogSeverity {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  NOTICE = 'NOTICE',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export interface LogMetadata {
  service?: string;
  method?: string;
  userId?: string;
  guildId?: string;
  commandName?: string;
  latencyMs?: number;
  cacheHit?: boolean;
  apiLatencyMs?: number;
  error?: Error | string;
  [key: string]: any;
}

export interface RequestTimer {
  startTime: number;
  metadata: LogMetadata;
}

/**
 * Logger utility that supports both Google Cloud Logging and console logging
 */
class Logger {
  private timers: Map<string, RequestTimer> = new Map();

  /**
   * Start a timer for a request
   * @param requestId Unique identifier for the request
   * @param metadata Initial metadata to associate with the request
   */
  startTimer(requestId: string, metadata: LogMetadata = {}): void {
    this.timers.set(requestId, {
      startTime: Date.now(),
      metadata,
    });
  }

  /**
   * End a timer and log the request
   * @param requestId Unique identifier for the request
   * @param additionalMetadata Additional metadata to merge with initial metadata
   * @param severity Log severity level
   */
  endTimer(
    requestId: string,
    additionalMetadata: LogMetadata = {},
    severity: LogSeverity = LogSeverity.INFO
  ): void {
    const timer = this.timers.get(requestId);
    if (!timer) {
      console.warn(`No timer found for request ID: ${requestId}`);
      return;
    }

    const latencyMs = Date.now() - timer.startTime;
    const metadata = {
      ...timer.metadata,
      ...additionalMetadata,
      latencyMs,
    };

    this.log(severity, `Request completed: ${requestId}`, metadata);
    this.timers.delete(requestId);
  }

  /**
   * Log a message with metadata
   * @param severity Log severity level
   * @param message Log message
   * @param metadata Additional structured data
   */
  async log(
    severity: LogSeverity,
    message: string,
    metadata: LogMetadata = {}
  ): Promise<void> {
    const entry = log.entry(
      {
        severity,
        resource: {
          type: 'global',
        },
      },
      {
        message,
        ...metadata,
        timestamp: new Date().toISOString(),
      }
    );

    try {
      // Write to Cloud Logging
      await log.write(entry);

      // Also log to console for local development
      const consoleMessage = `[${severity}] ${message}`;
      const consoleData = { ...metadata };

      switch (severity) {
        case LogSeverity.ERROR:
        case LogSeverity.CRITICAL:
          console.error(consoleMessage, consoleData);
          break;
        case LogSeverity.WARNING:
          console.warn(consoleMessage, consoleData);
          break;
        default:
          console.log(consoleMessage, consoleData);
      }
    } catch (error) {
      // Fallback to console if Cloud Logging fails
      console.error('Failed to write to Cloud Logging:', error);
      console.log(`[${severity}] ${message}`, metadata);
    }
  }

  /**
   * Log an info message
   */
  info(message: string, metadata: LogMetadata = {}): Promise<void> {
    return this.log(LogSeverity.INFO, message, metadata);
  }

  /**
   * Log a warning message
   */
  warn(message: string, metadata: LogMetadata = {}): Promise<void> {
    return this.log(LogSeverity.WARNING, message, metadata);
  }

  /**
   * Log an error message
   */
  error(message: string, metadata: LogMetadata = {}): Promise<void> {
    return this.log(LogSeverity.ERROR, message, metadata);
  }

  /**
   * Log a debug message
   */
  debug(message: string, metadata: LogMetadata = {}): Promise<void> {
    return this.log(LogSeverity.DEBUG, message, metadata);
  }

  /**
   * Log API call metrics
   */
  async logApiCall(
    service: string,
    method: string,
    latencyMs: number,
    cacheHit: boolean,
    additionalMetadata: LogMetadata = {}
  ): Promise<void> {
    return this.log(LogSeverity.INFO, `API call: ${service}.${method}`, {
      service,
      method,
      apiLatencyMs: latencyMs,
      cacheHit,
      ...additionalMetadata,
    });
  }
}

// Export singleton instance
export const logger = new Logger();
