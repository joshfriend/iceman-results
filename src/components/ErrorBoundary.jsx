import { Component } from "react";

export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Could not display race results", error, info);
  }

  render() {
    if (this.state.error) {
      return <main><p className="message error" role="alert">Could not display race results. Please reload the page.</p>
        <button type="button" onClick={() => location.reload()}>Reload</button></main>;
    }
    return this.props.children;
  }
}
