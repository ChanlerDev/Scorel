import { PanelRight } from "../icons/index.js";

export type TopbarProps = {
  title?: string;
  error?: string;
  hostMessage?: string;
  sidebarCollapsed?: boolean;
  onSidebarToggle?: () => void;
};

export function Topbar({
  title,
  error,
  hostMessage,
  sidebarCollapsed = false,
  onSidebarToggle,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        {sidebarCollapsed && onSidebarToggle ? (
          <button
            type="button"
            className="topbar__sidebar-toggle"
            aria-label="展开侧边栏"
            title="展开侧边栏"
            onClick={onSidebarToggle}
            data-testid="topbar-sidebar-toggle"
          >
            <PanelRight size={15} />
          </button>
        ) : null}
        <div className="topbar__title">{title ?? ""}</div>
      </div>
      <div className="topbar__right">
        {hostMessage ? <span className="topbar__error">{hostMessage}</span> : null}
        {error ? <span className="topbar__error">{error}</span> : null}
      </div>
    </header>
  );
}
