import { useCallback, useContext, useEffect } from "react";
import { HimetricaContext } from "./provider";
import type { HimetricaClient } from "../client";

export function useHimetrica(): HimetricaClient {
  const client = useContext(HimetricaContext);
  if (!client) {
    throw new Error("useHimetrica must be used within a HimetricaProvider");
  }
  return client;
}

export function useTrackEvent(): (
  eventName: string,
  properties?: Record<string, unknown>
) => void {
  const client = useHimetrica();
  return useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      client.track(eventName, properties);
    },
    [client]
  );
}

export function useCaptureError(): (
  error: Error,
  context?: Record<string, unknown>
) => void {
  const client = useHimetrica();
  return useCallback(
    (error: Error, context?: Record<string, unknown>) => {
      client.captureError(error, context);
    },
    [client]
  );
}

export function useTrackScreen(name: string, path?: string): void {
  const client = useHimetrica();
  useEffect(() => {
    client.trackScreen(name, path);
  }, [client, name, path]);
}
