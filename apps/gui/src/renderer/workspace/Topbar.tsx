import { PanelRight } from "../icons/index.js";

export type TopbarProps = {
  title?: string;
  error?: string;
  hostMessage?: string;
};

export function Topbar({ title, error, hostMessage }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar__title">{title ?? ""}</div>
      <div className="topbar__right">
        {hostMessage ? <span className="topbar__error">{hostMessage}</span> : null}
        {error ? <span className="topbar__error">{error}</span> : null}
        <button type="button" className="topbar__icon-button" disabled aria-label="Toggle right panel">
          <PanelRight size={16} />
        </button>
      </div>
    </header>
  );
}
