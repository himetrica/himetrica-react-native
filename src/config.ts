export interface HimetricaConfig {
  apiKey: string;
  apiUrl?: string;
  autoTrackScreens?: boolean;
  sessionTimeout?: number;
  enableLogging?: boolean;
  maxQueueSize?: number;
  flushInterval?: number;
  /** App version string (e.g. "1.2.3"). Sent with every event. */
  appVersion?: string;
  /** Device model string (e.g. "iPhone 15 Pro"). Sent with screen view events. */
  deviceModel?: string;
}

export interface ResolvedConfig {
  apiKey: string;
  apiUrl: string;
  autoTrackScreens: boolean;
  sessionTimeout: number;
  enableLogging: boolean;
  maxQueueSize: number;
  flushInterval: number;
  appVersion?: string;
  deviceModel?: string;
}

export function resolveConfig(config: HimetricaConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl ?? "https://app.himetrica.com",
    autoTrackScreens: config.autoTrackScreens ?? true,
    sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000,
    enableLogging: config.enableLogging ?? false,
    maxQueueSize: config.maxQueueSize ?? 1000,
    flushInterval: config.flushInterval ?? 30,
    appVersion: config.appVersion,
    deviceModel: config.deviceModel,
  };
}
