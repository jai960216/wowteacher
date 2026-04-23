import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 런타임 에러 캐치. 한 컴포넌트 폭발이 전체 화이트 스크린으로 번지지 않게 root에 래핑.
 * fallback UI에서 새로고침·로그아웃 옵션 제공.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleLogout = (): void => {
    try {
      localStorage.clear();
    } catch { /* noop */ }
    window.location.href = "/";
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#0e0e16" }}>
        <div className="max-w-md w-full rounded-lg p-6" style={{ background: "#131320", border: "1px solid #2a2a40" }}>
          <h1 className="text-lg font-bold text-white mb-2">⚠️ 문제가 발생했어요</h1>
          <p className="text-xs text-gray-400 mb-4">
            예기치 못한 오류로 화면을 표시할 수 없습니다. 새로고침하거나 로그아웃 후 다시 시도해주세요.
          </p>
          <pre
            className="text-[10px] text-red-300 p-2 rounded mb-4 overflow-auto max-h-40"
            style={{ background: "#1a0c10", border: "1px solid #2a1215" }}
          >
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
              className="flex-1 py-2 rounded text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
            >
              새로고침
            </button>
            <button
              onClick={this.handleLogout}
              className="flex-1 py-2 rounded text-xs font-semibold"
              style={{ background: "#1c1c30", color: "#9ca3af", border: "1px solid #2a2a40" }}
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    );
  }
}
