// Start/stop tracking from anywhere a project is shown (sidebar, Projects, Reports).
import { running } from '../../core/model.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { act, state } from './state.js';

export const isTracking = (projectId) => running(state.db)?.projectId === (projectId ?? null) && !!running(state.db);

/** Starts a timer on the project, or stops it when that project is already running. */
export function toggleProject(projectId) {
  if (isTracking(projectId)) return act({ type: 'timer.stop' });
  return act({ type: 'timer.start', projectId: projectId ?? null });
}

/** Round ▶ / ■ button for a project row. Clicks don't reach the row. */
export function playButton(projectId, { name = '' } = {}) {
  const on = isTracking(projectId);
  return h('button.play-btn', {
    class: on ? 'on' : '',
    title: on ? 'Stop' : name ? `Start ${name}` : 'Start',
    onclick: (e) => { e.stopPropagation(); toggleProject(projectId); },
  }, icon(on ? 'stop' : 'play'));
}
