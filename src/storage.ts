import AsyncStorage from "@react-native-async-storage/async-storage";
import { generateId } from "./visitor";

const KEY_VISITOR_ID = "hm_visitor_id";
const KEY_SESSION_ID = "hm_session_id";
const KEY_SESSION_TIMESTAMP = "hm_session_timestamp";
const KEY_OFFLINE_QUEUE = "hm_offline_queue";

export interface QueuedEvent {
  id: string;
  endpoint: string;
  data: unknown;
  timestamp: number;
  retryCount: number;
}

export class Storage {
  private visitorId: string = "";
  private sessionId: string = "";
  private sessionTimestamp: number = 0;
  private initialized = false;

  async init(sessionTimeout: number): Promise<void> {
    const [visitorId, sessionId, sessionTimestamp] = await AsyncStorage.multiGet([
      KEY_VISITOR_ID,
      KEY_SESSION_ID,
      KEY_SESSION_TIMESTAMP,
    ]);

    this.visitorId = visitorId[1] || generateId();
    const storedTimestamp = sessionTimestamp[1]
      ? parseInt(sessionTimestamp[1], 10)
      : 0;

    const now = Date.now();
    const expired = now - storedTimestamp > sessionTimeout;

    if (sessionId[1] && !expired) {
      this.sessionId = sessionId[1];
      this.sessionTimestamp = storedTimestamp;
    } else {
      this.sessionId = generateId();
      this.sessionTimestamp = now;
    }

    await AsyncStorage.multiSet([
      [KEY_VISITOR_ID, this.visitorId],
      [KEY_SESSION_ID, this.sessionId],
      [KEY_SESSION_TIMESTAMP, String(this.sessionTimestamp)],
    ]);

    this.initialized = true;
  }

  getVisitorId(): string {
    return this.visitorId;
  }

  setVisitorId(id: string): void {
    this.visitorId = id;
    AsyncStorage.setItem(KEY_VISITOR_ID, id).catch(() => {});
  }

  getSessionId(sessionTimeout: number): string {
    const now = Date.now();
    if (now - this.sessionTimestamp > sessionTimeout) {
      this.sessionId = generateId();
      this.sessionTimestamp = now;
      AsyncStorage.multiSet([
        [KEY_SESSION_ID, this.sessionId],
        [KEY_SESSION_TIMESTAMP, String(now)],
      ]).catch(() => {});
    } else {
      this.sessionTimestamp = now;
      AsyncStorage.setItem(KEY_SESSION_TIMESTAMP, String(now)).catch(() => {});
    }
    return this.sessionId;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async getQueue(): Promise<QueuedEvent[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY_OFFLINE_QUEUE);
      if (!raw) return [];
      return JSON.parse(raw) as QueuedEvent[];
    } catch {
      return [];
    }
  }

  async saveQueue(queue: QueuedEvent[]): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY_OFFLINE_QUEUE, JSON.stringify(queue));
    } catch {
      // silently fail
    }
  }

  async enqueueEvent(event: QueuedEvent): Promise<void> {
    const queue = await this.getQueue();
    queue.push(event);
    await this.saveQueue(queue);
  }

  async removeEvent(id: string): Promise<void> {
    const queue = await this.getQueue();
    await this.saveQueue(queue.filter((e) => e.id !== id));
  }

  async updateEvent(event: QueuedEvent): Promise<void> {
    const queue = await this.getQueue();
    const idx = queue.findIndex((e) => e.id === event.id);
    if (idx !== -1) {
      queue[idx] = event;
      await this.saveQueue(queue);
    }
  }

  async pruneQueue(maxSize: number): Promise<void> {
    const queue = await this.getQueue();
    if (queue.length > maxSize) {
      await this.saveQueue(queue.slice(queue.length - maxSize));
    }
  }
}
