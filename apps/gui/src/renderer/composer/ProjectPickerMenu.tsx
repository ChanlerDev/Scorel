import { useEffect, useRef, useState } from "react";

import { Check, FolderPlus, Globe, Search } from "../icons/index.js";
import type { GuiProjectView } from "../../shared/ipc.js";

export type ProjectPickerMenuProps = {
  projects: GuiProjectView[];
  selectedKey: string | null;
  anchor?: { left: number; top: number };
  onSelect(key: string): void;
  onAddLocal(): void;
  onAddRemote(): void;
  onClose(): void;
};

export function ProjectPickerMenu({
  projects,
  selectedKey,
  anchor,
  onSelect,
  onAddLocal,
  onAddRemote,
  onClose,
}: ProjectPickerMenuProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const items = projects.filter((project) =>
    project.displayName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="overlay-backdrop" onMouseDown={onClose}>
      <div
        className="overlay-popover"
        style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Project picker"
      >
        <div className="overlay-popover__search">
          <Search />
          <input
            ref={inputRef}
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <ul className="overlay-popover__list">
          {items.length === 0 ? (
            <li className="muted-row" style={{ padding: "8px 12px" }}>没有匹配的项目</li>
          ) : (
            items.map((project) => {
              const key = projectKey(project);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="overlay-popover__item"
                    onClick={() => {
                      onSelect(key);
                      onClose();
                    }}
                  >
                    <Globe />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {project.displayName}
                    </span>
                    {key === selectedKey ? <Check /> : <span />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="overlay-popover__divider" />
        <button
          type="button"
          className="overlay-popover__item"
          onClick={() => {
            onAddLocal();
            onClose();
          }}
          data-testid="picker-add-local"
        >
          <FolderPlus />
          <span>添加本地项目</span>
          <span />
        </button>
        <button
          type="button"
          className="overlay-popover__item"
          onClick={() => {
            onAddRemote();
            onClose();
          }}
          data-testid="picker-add-remote"
        >
          <Globe />
          <span>添加远程项目</span>
          <span />
        </button>
      </div>
    </div>
  );
}

function projectKey(project: GuiProjectView): string {
  return project.source === "local"
    ? `local:${project.projectId}`
    : `relay:${project.deviceId}:${project.projectId}`;
}
