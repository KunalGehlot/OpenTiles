import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  /** Changes when the learner goes somewhere else, which clears an error. */
  resetKey: string;
  children: ReactNode;
}

/**
 * Keeps one broken screen from blanking the whole app: the header stays, the learner is told what
 * happened in plain words and can reload or go elsewhere. Nothing is sent anywhere (hard rule 5);
 * opt-in crash reports are handled by crash/reporter.ts. React requires a class for this.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Visible to a developer with the console open; never uploaded.
    console.error('OpenTiles screen failed:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="session-message" role="alert">
        <h1>Something went wrong on this screen</h1>
        <p className="muted">
          Your pieces and settings are safe on this device. Reloading usually fixes it, for example
          after OpenTiles was updated while this page was open.
        </p>
        <p>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>{' '}
          <a className="button" href="#/">
            Back to pieces
          </a>
        </p>
      </div>
    );
  }
}
