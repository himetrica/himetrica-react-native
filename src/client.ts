import { AppState, type AppStateStatus } from "react-native";
import { type HimetricaConfig, type ResolvedConfig, resolveConfig } from "./config";
import { Storage } from "./storage";
import { Transport } from "./transport";
import { ErrorTracker } from "./errors";
import { generateId } from "./visitor";

const EVENT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_EVENT_NAME_LENGTH = 255;
const MIN_DURATION = 1;
const MAX_DURATION = 3600;
const FIRST_SCREEN_DELAY = 300;
const SUBSEQUENT_SCREEN_DELAY = 1000;

export class HimetricaClient {
  private config: ResolvedConfig;
  private storage: Storage;
  private transport: Transport;
  private errorTracker: ErrorTracker;
  private initialized = false;
  private destroyed = false;

  private currentScreenName: string | null = null;
  private currentScreenPath: string | null = null;
  private currentScreenViewId: string | null = null;
  private screenStartTime: number = 0;
  private screenDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isFirstScreen = true;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private appState: AppStateStatus = AppState.currentState;

  constructor(config: HimetricaConfig) {
    this.config = resolveConfig(config);
    this.storage = new Storage();
    this.transport = new Transport(this.config, this.storage);
    this.errorTracker = new ErrorTracker(this.config, this.storage, this.transport);
  }

  async init(): Promise<void> {
    if (this.initialized || this.destroyed) return;

    await this.storage.init(this.config.sessionTimeout);

    this.transport.start();

    if (this.config.autoTrackErrors) {
      this.errorTracker.install();
    }

    this.appStateSubscription = AppState.addEventListener(
      "change",
      this.handleAppStateChange
    );

    this.initialized = true;
    this.log("Initialized");
  }

  trackScreen(name: string, path?: string): void {
    if (this.destroyed) return;

    const effectivePath = path ?? `/${name}`;

    // Deduplicate consecutive same-screen events
    if (this.currentScreenName === name && this.currentScreenPath === effectivePath) {
      return;
    }

    // Send duration for previous screen
    this.sendScreenDuration();

    const delay = this.isFirstScreen ? FIRST_SCREEN_DELAY : SUBSEQUENT_SCREEN_DELAY;

    if (this.screenDebounceTimer) {
      clearTimeout(this.screenDebounceTimer);
    }

    const screenViewId = generateId();

    this.screenDebounceTimer = setTimeout(() => {
      this.currentScreenName = name;
      this.currentScreenPath = effectivePath;
      this.currentScreenViewId = screenViewId;
      this.screenStartTime = Date.now();
      this.isFirstScreen = false;

      if (!this.storage.isReady()) return;

      const payload = {
        visitorId: this.storage.getVisitorId(),
        sessionId: this.storage.getSessionId(this.config.sessionTimeout),
        screenViewId,
        screenName: name,
        path: effectivePath,
        timestamp: new Date().toISOString(),
      };

      this.transport.sendOrQueue(
        `/api/track/screen?apiKey=${this.config.apiKey}`,
        payload
      );

      this.log(`Screen: ${name}`);
    }, delay);
  }

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (this.destroyed) return;
    if (!this.storage.isReady()) return;

    if (!EVENT_NAME_REGEX.test(eventName) || eventName.length > MAX_EVENT_NAME_LENGTH) {
      this.log(`Invalid event name: ${eventName}`);
      return;
    }

    const payload = {
      visitorId: this.storage.getVisitorId(),
      sessionId: this.storage.getSessionId(this.config.sessionTimeout),
      event: eventName,
      properties: properties ?? {},
      timestamp: new Date().toISOString(),
    };

    this.transport.sendOrQueue(
      `/api/track/event?apiKey=${this.config.apiKey}`,
      payload
    );

    this.log(`Event: ${eventName}`);
  }

  async identify(data: {
    name?: string;
    email?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (this.destroyed) return;
    if (!this.storage.isReady()) return;

    const payload = {
      visitorId: this.storage.getVisitorId(),
      sessionId: this.storage.getSessionId(this.config.sessionTimeout),
      ...data,
      timestamp: new Date().toISOString(),
    };

    try {
      const url = `${this.config.apiUrl}/api/track/identify?apiKey=${this.config.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.visitorId && result.visitorId !== this.storage.getVisitorId()) {
          this.storage.setVisitorId(result.visitorId);
          this.log(`Visitor merged: ${result.visitorId}`);
        }
      }
    } catch {
      this.log("Identify request failed");
    }
  }

  captureError(error: Error, context?: Record<string, unknown>): void {
    if (this.destroyed) return;
    this.errorTracker.captureError(error, context);
  }

  captureMessage(
    message: string,
    severity?: "error" | "warning" | "info",
    context?: Record<string, unknown>
  ): void {
    if (this.destroyed) return;
    this.errorTracker.captureMessage(message, severity, context);
  }

  getVisitorId(): string {
    return this.storage.getVisitorId();
  }

  async flush(): Promise<void> {
    this.sendScreenDuration();
    await this.transport.flush();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    this.sendScreenDuration();

    if (this.screenDebounceTimer) {
      clearTimeout(this.screenDebounceTimer);
      this.screenDebounceTimer = null;
    }

    this.appStateSubscription?.remove();
    this.appStateSubscription = null;

    this.errorTracker.uninstall();
    this.transport.stop();

    this.log("Destroyed");
  }

  private handleAppStateChange = (nextState: AppStateStatus): void => {
    if (this.appState === "active" && nextState.match(/inactive|background/)) {
      // Going to background — send duration + persist queue
      this.sendScreenDuration();
      this.transport.persistQueue();
    }

    if (this.appState.match(/inactive|background/) && nextState === "active") {
      // Coming to foreground — check session, flush queue
      if (this.storage.isReady()) {
        this.storage.getSessionId(this.config.sessionTimeout);
      }
      this.transport.flush();
    }

    this.appState = nextState;
  };

  private sendScreenDuration(): void {
    if (!this.currentScreenViewId || !this.screenStartTime) return;
    if (!this.storage.isReady()) return;

    const durationSec = Math.round((Date.now() - this.screenStartTime) / 1000);
    const clampedDuration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, durationSec));

    if (durationSec < MIN_DURATION) return;

    const payload = {
      screenViewId: this.currentScreenViewId,
      duration: clampedDuration,
    };

    this.transport.sendOrQueue(
      `/api/track/screen/duration?apiKey=${this.config.apiKey}`,
      payload
    );

    this.currentScreenViewId = null;
    this.screenStartTime = 0;
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[Himetrica] ${message}`);
    }
  }
}
