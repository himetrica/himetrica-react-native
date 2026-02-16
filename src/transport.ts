import { generateId } from "./visitor";
import type { ResolvedConfig } from "./config";
import type { Storage, QueuedEvent } from "./storage";

export class Transport {
  private config: ResolvedConfig;
  private storage: Storage;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(config: ResolvedConfig, storage: Storage) {
    this.config = config;
    this.storage = storage;
  }

  start(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushInterval * 1000);

    // Flush any queued events from previous session
    this.flush();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async send(endpoint: string, data: unknown): Promise<boolean> {
    const url = `${this.config.apiUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.config.apiKey,
        },
        body: JSON.stringify(data),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async sendOrQueue(endpoint: string, data: unknown): Promise<void> {
    const success = await this.send(endpoint, data);
    if (!success) {
      await this.storage.enqueueEvent({
        id: generateId(),
        endpoint,
        data,
        timestamp: Date.now(),
        retryCount: 0,
      });
      await this.storage.pruneQueue(this.config.maxQueueSize);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      const queue = await this.storage.getQueue();
      if (queue.length === 0) return;

      const batch = queue.slice(0, 50);
      const results = await Promise.allSettled(
        batch.map(async (event) => {
          const success = await this.send(event.endpoint, event.data);
          if (success) {
            await this.storage.removeEvent(event.id);
          } else if (event.retryCount < 3) {
            await this.storage.updateEvent({
              ...event,
              retryCount: event.retryCount + 1,
            });
          } else {
            await this.storage.removeEvent(event.id);
            this.log(`Event ${event.id} discarded after max retries`);
          }
        })
      );

      void results; // consumed by allSettled
    } finally {
      this.flushing = false;
    }
  }

  async persistQueue(): Promise<void> {
    // Queue is already persisted on each enqueue, but this
    // can be called on app background as a safety measure
    await this.flush();
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[Himetrica] ${message}`);
    }
  }
}
