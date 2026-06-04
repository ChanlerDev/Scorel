const ADD_PROJECT_EVENT = "scorel:add-project";

export function requestAddProjectDialog(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
}

export function subscribeAddProjectDialog(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(ADD_PROJECT_EVENT, handler);
  return () => window.removeEventListener(ADD_PROJECT_EVENT, handler);
}
