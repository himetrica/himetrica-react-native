export interface HimetricaConfig {
  apiKey: string;
  apiUrl?: string;
  autoTrackScreens?: boolean;
  autoTrackErrors?: boolean;
  sessionTimeout?: number;
  enableLogging?: boolean;
  maxQueueSize?: number;
  flushInterval?: number;
}

export interface ResolvedConfig {
  apiKey: string;
  apiUrl: string;
  autoTrackScreens: boolean;
  autoTrackErrors: boolean;
  sessionTimeout: number;
  enableLogging: boolean;
  maxQueueSize: number;
  flushInterval: number;
}

export function resolveConfig(config: HimetricaConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    apiUrl: config.apiUrl ?? "https://app.himetrica.com",
    autoTrackScreens: config.autoTrackScreens ?? true,
    autoTrackErrors: config.autoTrackErrors ?? true,
    sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000,
    enableLogging: config.enableLogging ?? false,
    maxQueueSize: config.maxQueueSize ?? 1000,
    flushInterval: config.flushInterval ?? 30,
  };
}
