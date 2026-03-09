import { AppState, Dimensions, type AppStateStatus } from "react-native";
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
  private pendingScreen: { name: string; path: string; screenViewId: string } | null = null;
  private isFirstScreen = true;
  private firstScreenViewSent = false;
  private pendingCustomEvents: Array<() => void> = [];
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private appState: AppStateStatus = AppState.currentState;
  private backgroundAt: number = 0;
  private tapCount: number = 0;

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
    this.pendingScreen = { name, path: effectivePath, screenViewId };

    this.screenDebounceTimer = setTimeout(() => {
      this.sendPendingScreen();
    }, delay);
  }

  private drainPendingEvents(): void {
    if (!this.firstScreenViewSent) {
      this.firstScreenViewSent = true;
      const queued = this.pendingCustomEvents;
      this.pendingCustomEvents = [];
      for (const fn of queued) fn();
    }
  }

  private sendPendingScreen(): void {
    if (!this.pendingScreen) return;
    const { name, path, screenViewId } = this.pendingScreen;
    this.pendingScreen = null;
    this.screenDebounceTimer = null;

    this.currentScreenName = name;
    this.currentScreenPath = path;
    this.currentScreenViewId = screenViewId;
    this.screenStartTime = Date.now();
    this.tapCount = 0;
    this.isFirstScreen = false;

    if (!this.storage.isReady()) return;

    const payload = {
      visitorId: this.storage.getVisitorId(),
      sessionId: this.storage.getSessionId(this.config.sessionTimeout),
      pageViewId: screenViewId,
      path,
      title: name,
      referrer: "",
      queryString: "",
      screenWidth: Math.round(Dimensions.get("screen").width),
      screenHeight: Math.round(Dimensions.get("screen").height),
    };

    this.transport.sendOrQueue(
      `/api/track/event`,
      payload
    );

    this.drainPendingEvents();
    this.log(`Screen: ${name}`);
  }

  private flushPendingScreen(): void {
    if (this.screenDebounceTimer && this.pendingScreen) {
      clearTimeout(this.screenDebounceTimer);
      this.sendPendingScreen(); // sendPendingScreen calls drainPendingEvents internally
    }
  }

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (this.destroyed) return;

    if (!EVENT_NAME_REGEX.test(eventName) || eventName.length > MAX_EVENT_NAME_LENGTH) {
      this.log(`Invalid event name: ${eventName}`);
      return;
    }

    // Queue custom events until the first screen view has been sent.
    // This prevents the server from creating a bare session (pageCount=0)
    // when track() fires before the delayed first screen view.
    if (!this.firstScreenViewSent) {
      this.pendingCustomEvents.push(() => this.track(eventName, properties));
      return;
    }

    if (!this.storage.isReady()) return;

    // Flush any pending screen view so the server creates the session
    // before the custom event arrives.
    this.flushPendingScreen();

    const payload = {
      visitorId: this.storage.getVisitorId(),
      sessionId: this.storage.getSessionId(this.config.sessionTimeout),
      eventName,
      properties: properties ?? {},
      path: this.currentScreenPath || "/",
      title: this.currentScreenName || "",
      queryString: "",
    };

    this.transport.sendOrQueue(
      `/api/track/custom-event`,
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
    this.flushPendingScreen();
    this.sendScreenDuration();
    await this.transport.flush();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;

    // flushPendingScreen sends the pending screen (if any) and drains queued
    // custom events internally.  We set destroyed AFTER so drained track()
    // closures aren't short-circuited by the destroyed check.
    this.flushPendingScreen();
    this.sendScreenDuration();

    this.destroyed = true;

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
      this.backgroundAt = Date.now();
    }

    if (this.appState.match(/inactive|background/) && nextState === "active") {
      if (this.storage.isReady()) {
        const awayTime = this.backgroundAt > 0 ? Date.now() - this.backgroundAt : 0;
        this.backgroundAt = 0;

        if (awayTime >= this.config.sessionTimeout) {
          // Session expired — new session will be created by getSessionId,
          // re-track the current screen
          this.storage.getSessionId(this.config.sessionTimeout);
          if (this.currentScreenName) {
            const name = this.currentScreenName;
            const path = this.currentScreenPath;
            this.currentScreenName = null;
            this.currentScreenPath = null;
            this.trackScreen(name, path ?? undefined);
          }
        } else if (awayTime > 5 * 60 * 1000) {
          // Away 5+ min but session still valid — lightweight heartbeat
          const payload = {
            visitorId: this.storage.getVisitorId(),
            sessionId: this.storage.getSessionId(this.config.sessionTimeout),
          };
          this.transport.sendOrQueue(
            `/api/track/heartbeat`,
            payload
          );
        } else {
          // Short absence — just refresh session timestamp
          this.storage.getSessionId(this.config.sessionTimeout);
        }
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

    const payload: Record<string, unknown> = {
      pageViewId: this.currentScreenViewId,
      duration: clampedDuration,
    };
    if (this.tapCount > 0) {
      payload.clickCount = this.tapCount;
    }

    this.transport.sendOrQueue(
      `/api/track/beacon`,
      payload
    );

    this.currentScreenViewId = null;
    this.screenStartTime = 0;
  }

  /** Track a user tap/press. Call this from your UI to count interactions per screen. */
  trackTap(): void {
    if (this.destroyed) return;
    this.tapCount++;
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[Himetrica] ${message}`);
    }
  }
}
