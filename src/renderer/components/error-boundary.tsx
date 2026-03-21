import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  region: string;
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`Renderer error in ${this.props.region}`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-primary)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            padding: 20,
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            boxShadow: "0 10px 30px var(--shadow)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            {this.props.region} crashed
          </div>
          <div style={{ color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
            Scorel recovered the rest of the window. Reset this area to continue.
          </div>
          {process.env.NODE_ENV !== "production" && this.state.error ? (
            <pre
              style={{
                margin: "0 0 16px",
                padding: 12,
                borderRadius: 10,
                overflowX: "auto",
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                fontSize: 12,
              }}
            >
              {this.state.error.stack ?? this.state.error.message}
            </pre>
          ) : null}
          <button
            onClick={this.handleReset}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }
}
