import { useEffect, useRef, useState } from "react";

import { Check, FolderPlus, Globe, Search } from "../icons/index.js";
import type { GuiProjectView } from "../../shared/ipc.js";

export type ProjectPickerMenuProps = {
  projects: GuiProjectView[];
  selectedKey: string | null;
  onSelect(key: string): void;
  onAddLocal(): void;
  onAddRemote(): void;
  onClose(): void;
};

export function ProjectPickerMenu({
  projects,
  selectedKey,
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
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Project picker"
      >
        <label className="composer__pill" style={{ paddingLeft: 0 }}>
          <Search size={14} />
          <input
            ref={inputRef}
            className="overlay-popover__search"
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <ul className="overlay-popover__list">
          {items.length === 0 ? (
            <li className="muted-row">没有匹配的项目</li>
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
                    <Globe size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {project.displayName}
                    </span>
                    {key === selectedKey ? <Check size={14} /> : <span />}
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
          <FolderPlus size={14} />
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
          <Globe size={14} />
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
