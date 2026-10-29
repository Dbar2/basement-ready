// The 3D views load their code on demand. On weak Wi-Fi, or with a page left open across a deploy,
// that download can fail; it retries once, and if it still fails only the 3D box says so.
import { Component, lazy, type ComponentType, type ReactNode } from "react";

export function lazy3d<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    const component = await load().catch(() => new Promise((r) => setTimeout(r, 1500)).then(load));
    return { default: component };
  });
}

// Keeps a failed 3D view inside its own box, so the rest of the answer stays up.
export class View3DBoundary extends Component<{ children: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="viewer-empty">
        <div className="viewer-failed">
          <p className="mono">The 3D view didn't load. The rest of your answer is fine.</p>
          <button className="btn btn-ghost" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
