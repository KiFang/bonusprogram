import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; onReset?: () => void };
type State = { error: Error | null };

/** Вместо пустого экрана показывает, что сломалось, и даёт вернуться назад. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("screen crashed", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="notice bad" role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <b>Экран не открылся</b>
        <span className="mono xs" style={{ wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
          {String(error.message || error)}
          {"\n"}
          {(error.stack ?? "").split("\n").slice(0, 4).join("\n")}
        </span>
        <span className="sm">Пришлите скриншот этого сообщения разработчику.</span>
        <button
          className="btn"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset?.();
          }}
        >
          Вернуться в кошелёк
        </button>
      </div>
    );
  }
}
