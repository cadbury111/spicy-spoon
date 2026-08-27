import React from "react";
import { Utensils, RefreshCw, Home, AlertTriangle } from "lucide-react";
import "./ErrorBoundary.css";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Spicy Spoon Runtime Boundary Caught Error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.hash = "#home";
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.hash = "#home";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-brand-header">
              <Utensils size={32} className="error-brand-icon" />
              <h1>
                SPICY <span>SPOON</span>
              </h1>
            </div>

            <div className="error-badge-row">
              <AlertTriangle size={24} className="warning-icon" />
              <h2>Something went wrong</h2>
            </div>

            <p className="error-msg-desc">
              We encountered a temporary interface loading issue. Your data and orders are safe.
            </p>

            {this.state.error && (
              <div className="error-details-collapsible">
                <code>{this.state.error.toString()}</code>
              </div>
            )}

            <div className="error-actions-group">
              <button className="btn-error-refresh" onClick={this.handleReset}>
                <RefreshCw size={18} />
                <span>Reload App</span>
              </button>
              <button className="btn-error-home" onClick={this.handleGoHome}>
                <Home size={18} />
                <span>Back to Home</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
