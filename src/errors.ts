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
  path: string;
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
  return `Himetrica-ReactNative/0.1.28 (${Platform.OS} ${Platform.Version})`;
}

export class ErrorTracker {
  private config: ResolvedConfig;
  private storage: Storage;
  private transport: Transport;
  private errorTimestamps: number[] = [];
  private sentErrorHashes = new Set<string>();
  private currentPath: () => string;

  constructor(
    config: ResolvedConfig,
    storage: Storage,
    transport: Transport,
    currentPath?: () => string
  ) {
    this.config = config;
    this.storage = storage;
    this.transport = transport;
    this.currentPath = currentPath ?? (() => "/");
  }

  setCurrentPath(pathFn: () => string): void {
    this.currentPath = pathFn;
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
      path: this.currentPath(),
      userAgent: getUserAgent(),
      timestamp: new Date().toISOString(),
      context,
    };

    this.transport.sendOrQueue(
      `/api/t/errors?apiKey=${this.config.apiKey}`,
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
