const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const render = async (): Promise<void> => {
  const root = document.getElementById("root");
  if (!root) return;

  const status = await window.scorel.getHostStatus();
  const projects = await window.scorel.listLocalProjects();

  root.innerHTML = `
    <aside class="sidebar">
      <div class="brand">Scorel</div>
      <div class="section-label">Projects</div>
      <ul class="project-list" data-testid="project-list">
        ${
          projects.length === 0
            ? "<li class=\"muted\">No local projects yet</li>"
            : projects.map((project) => `<li>${escapeHtml(project.displayName)}</li>`).join("")
        }
      </ul>
    </aside>
    <main class="workspace">
      <p class="status" data-testid="host-status">${escapeHtml(status.state)}</p>
      <h1>What should we build in Scorel?</h1>
    </main>
  `;
};

void render().catch((cause) => {
  const root = document.getElementById("root");
  if (root) {
    root.textContent = cause instanceof Error ? cause.message : String(cause);
  }
});
