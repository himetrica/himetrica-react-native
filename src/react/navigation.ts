import { useCallback, useContext, useRef } from "react";
import type { NavigationContainerRef } from "@react-navigation/native";
import { HimetricaContext } from "./provider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavigationRef = NavigationContainerRef<any>;

function getActiveRouteName(state: { index?: number; routes: Array<{ name: string; state?: unknown }> }): string | null {
  if (state.index == null) return null;
  const route = state.routes[state.index];
  // Recurse into nested navigators
  if (route.state) {
    return getActiveRouteName(route.state as typeof state) ?? route.name;
  }
  return route.name;
}

export function useHimetricaNavigation(): {
  ref: React.RefObject<NavigationRef | null>;
  onReady: () => void;
  onStateChange: () => void;
} {
  const client = useContext(HimetricaContext);
  const navigationRef = useRef<NavigationRef | null>(null);
  const routeNameRef = useRef<string | null>(null);

  const onReady = useCallback(() => {
    const state = navigationRef.current?.getRootState();
    if (state) {
      routeNameRef.current = getActiveRouteName(state);
    }
  }, []);

  const onStateChange = useCallback(() => {
    if (!client) return;

    const state = navigationRef.current?.getRootState();
    if (!state) return;

    const currentRouteName = getActiveRouteName(state);
    if (currentRouteName && currentRouteName !== routeNameRef.current) {
      client.trackScreen(currentRouteName);
      routeNameRef.current = currentRouteName;
    }
  }, [client]);

  return {
    ref: navigationRef,
    onReady,
    onStateChange,
  };
}
