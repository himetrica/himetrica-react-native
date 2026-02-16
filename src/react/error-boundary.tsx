import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { HimetricaContext } from "./provider";
import type { HimetricaClient } from "../client";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
}

export class HimetricaErrorBoundary extends Component<Props, State> {
  static contextType = HimetricaContext;
  declare context: HimetricaClient | null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.context?.captureError(error, {
      componentStack: errorInfo.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
