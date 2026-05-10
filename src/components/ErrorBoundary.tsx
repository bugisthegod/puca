import { Component, type ErrorInfo, type ReactNode } from "react";
import PucaMark from "./PucaMark";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static override getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Púca fumbled:", error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div class="error-fallback">
          <div class="error-fallback__inner">
            <PucaMark size={120} />
            <h1 class="error-fallback__title">Oops, Púca broke something</h1>
            <p class="error-fallback__text">
              A little gremlin snuck into the code. Give it another go?
            </p>
            <button
              class="error-fallback__btn"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
