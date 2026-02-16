import { Platform } from "react-native";
import type { ResolvedConfig } from "./config";
import type { Storage } from "./storage";
import type { Transport } from "./transport";

const MAX_ERRORS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEDUP_EXPIRY_MS = 5 * 60_000;
const MAX_STACK_LINES = 20;

type Severity = "error" | "warning" | "info";

interface ErrorPayload {
  visitorId: string;
  sessionId: string;
  type: string;
  message: string;
  stack?: string;
  severity: Severity;
  userAgent: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function normalizeStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack.split("\n").slice(0, MAX_STACK_LINES).join("\n");
}

function getUserAgent(): string {
  return `${Platform.OS}/${Platform.Version}`;
}

export class ErrorTracker {
  private config: ResolvedConfig;
  private storage: Storage;
  private transport: Transport;
  private errorTimestamps: number[] = [];
  private sentErrorHashes = new Set<string>();
  private originalHandler: ((error: unknown, isFatal?: boolean) => void) | null = null;
  private installed = false;

  constructor(config: ResolvedConfig, storage: Storage, transport: Transport) {
    this.config = config;
    this.storage = storage;
    this.transport = transport;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    // Install global error handler
    const ErrorUtils = (global as Record<string, unknown>).ErrorUtils as
      | {
          getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
          setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
        }
      | undefined;

    if (ErrorUtils) {
      this.originalHandler = ErrorUtils.getGlobalHandler();
      ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        this.captureError(
          error instanceof Error ? error : new Error(String(error)),
          { isFatal },
          "error",
          isFatal ? "error" : "warning"
        );
        this.originalHandler?.(error, isFatal);
      });
    }

    // Promise rejection tracking
    const tracking = require("promise/setimmediate/rejection-tracking");
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: unknown) => {
        this.captureError(
          error instanceof Error ? error : new Error(String(error)),
          { type: "unhandledrejection" },
          "unhandledrejection",
          "error"
        );
      },
    });
  }

  uninstall(): void {
    if (!this.installed) return;

    const ErrorUtils = (global as Record<string, unknown>).ErrorUtils as
      | {
          setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
        }
      | undefined;

    if (ErrorUtils && this.originalHandler) {
      ErrorUtils.setGlobalHandler(this.originalHandler);
      this.originalHandler = null;
    }

    try {
      const tracking = require("promise/setimmediate/rejection-tracking");
      tracking.disable();
    } catch {
      // may not be available
    }

    this.installed = false;
  }

  captureError(
    error: Error,
    context?: Record<string, unknown>,
    type: string = "error",
    severity: Severity = "error"
  ): void {
    if (!this.storage.isReady()) return;

    const message = error.message || String(error);
    const stack = normalizeStack(error.stack);
    const dedupKey = hashString(`${message}|${stack || ""}`);

    if (this.isRateLimited()) return;
    if (this.isDuplicate(dedupKey)) return;

    const payload: ErrorPayload = {
      visitorId: this.storage.getVisitorId(),
      sessionId: this.storage.getSessionId(this.config.sessionTimeout),
      type,
      message,
      stack,
      severity,
      userAgent: getUserAgent(),
      timestamp: new Date().toISOString(),
      context,
    };

    this.transport.sendOrQueue(
      `/api/track/errors?apiKey=${this.config.apiKey}`,
      payload
    );
  }

  captureMessage(
    message: string,
    severity: Severity = "info",
    context?: Record<string, unknown>
  ): void {
    this.captureError(new Error(message), context, "console", severity);
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    this.errorTimestamps = this.errorTimestamps.filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS
    );
    if (this.errorTimestamps.length >= MAX_ERRORS_PER_WINDOW) return true;
    this.errorTimestamps.push(now);
    return false;
  }

  private isDuplicate(hash: string): boolean {
    if (this.sentErrorHashes.has(hash)) return true;
    this.sentErrorHashes.add(hash);
    setTimeout(() => {
      this.sentErrorHashes.delete(hash);
    }, DEDUP_EXPIRY_MS);
    return false;
  }
}
