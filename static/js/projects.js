const RECENTS_KEY = 'raumgestalter.recents.v1';
const MAX_RECENTS = 12;

export function recentProjects() {
  try {
    const items = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(items)
      ? items.filter((item) => item && /^[A-Za-z0-9_-]{16,32}$/.test(item.id) && typeof item.name === 'string')
      : [];
  } catch { return []; }
}

export function rememberProject(project) {
  if (!project?.id || !/^[A-Za-z0-9_-]{16,32}$/.test(project.id)) return;
  const items = recentProjects().filter((item) => item.id !== project.id);
  items.unshift({
    id: project.id,
    name: String(project.name || 'Mein Raum').slice(0, 80),
    updatedAt: project.updatedAt || new Date().toISOString(),
  });
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(items.slice(0, MAX_RECENTS))); } catch { /* Speicher voll oder gesperrt */ }
}

export function forgetProject(projectId) {
  try {
    const items = recentProjects().filter((item) => item.id !== projectId);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(items));
  } catch { /* Speicher gesperrt */ }
}