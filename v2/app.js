/* LiftLog v2 — client-side workout tracker */

(function () {
  'use strict';

  let data = null;           // full backup JSON
  let activeSession = null;  // session object currently displayed

  // ── Storage helpers ──────────────────────────────────────────────────────

  function storageKey(sessionName, exerciseName, setIndex) {
    return `liftlog-v2-${data.backupDate}-${sessionName}-${exerciseName}-set${setIndex}`;
  }

  function saveRep(sessionName, exerciseName, setIndex, value) {
    const key = storageKey(sessionName, exerciseName, setIndex);
    if (value === '' || value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }

  function loadRep(sessionName, exerciseName, setIndex) {
    return localStorage.getItem(storageKey(sessionName, exerciseName, setIndex)) ?? '';
  }

  // ── Date formatting ───────────────────────────────────────────────────────

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  // ── Completion state ──────────────────────────────────────────────────────

  function exerciseState(session, exercise) {
    const filled = Array.from({ length: exercise.sets }, (_, i) =>
      loadRep(session.name, exercise.name, i)
    ).filter(v => v !== '');
    if (filled.length === 0) return 'none';
    if (filled.length === exercise.sets) return 'complete';
    return 'partial';
  }

  function crumbIcon(state) {
    if (state === 'complete') return '✓';
    if (state === 'partial') return '◐';
    return '●';
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Header
    const header = el('div', 'header');
    header.innerHTML = `
      <div class="header-title">${data.name}</div>
      <div class="header-name">${activeSession.name} <span style="color:var(--text-muted);font-size:14px;font-weight:400">— ${fmtDate(activeSession.lastDate)}</span></div>
    `;
    app.appendChild(header);

    // Session tabs — history (last 4 sessions by lastDate desc) + unstated ones
    const sorted = [...data.sessions].sort((a, b) => {
      if (!a.lastDate) return 1;
      if (!b.lastDate) return -1;
      return b.lastDate.localeCompare(a.lastDate);
    });
    const tabSessions = sorted.slice(0, 4);
    // Ensure active session is visible even if not in top 4
    if (!tabSessions.find(s => s.name === activeSession.name)) {
      tabSessions.push(activeSession);
    }

    const nextSession = oldestSession(data.sessions);

    const tabsEl = el('div', 'session-tabs');
    tabSessions.forEach(session => {
      const tab = el('button', 'session-tab' + (session.name === activeSession.name ? ' active' : ''));
      tab.setAttribute('data-session', session.name);
      const isNext = session.name === nextSession.name;
      tab.innerHTML = `
        <div class="session-tab-name">${session.name}${isNext ? '<span class="next-badge">NEXT</span>' : ''}</div>
        <div class="session-tab-date">${fmtDate(session.lastDate)}</div>
      `;
      tab.addEventListener('click', () => {
        activeSession = data.sessions.find(s => s.name === session.name);
        render();
      });
      tabsEl.appendChild(tab);
    });
    app.appendChild(tabsEl);

    // Breadcrumb
    const bc = el('div', 'breadcrumb');
    bc.setAttribute('id', 'breadcrumb');
    activeSession.exercises.forEach(exercise => {
      const state = exerciseState(activeSession, exercise);
      const crumb = el('div', `crumb${state === 'partial' ? ' partial' : state === 'complete' ? ' complete' : ''}`);
      crumb.setAttribute('data-crumb', exercise.name);
      crumb.innerHTML = `<span class="crumb-icon">${crumbIcon(state)}</span><span class="crumb-label" title="${exercise.name}">${exercise.name}</span>`;
      bc.appendChild(crumb);
    });
    app.appendChild(bc);

    // Exercise cards
    const exercisesEl = el('div', 'exercises');
    activeSession.exercises.forEach(exercise => {
      exercisesEl.appendChild(renderExercise(exercise));
    });
    app.appendChild(exercisesEl);
  }

  function renderExercise(exercise) {
    const card = el('div', 'exercise-card');
    card.setAttribute('data-exercise', exercise.name);

    const header = el('div', 'exercise-header');
    header.innerHTML = `
      <div class="exercise-name">${exercise.name}</div>
      <div class="exercise-meta">${exercise.sets} × ${exercise.repsPerSet} reps target</div>
    `;
    card.appendChild(header);

    const grid = el('div', 'sets-grid');
    for (let i = 0; i < exercise.sets; i++) {
      const row = el('div', 'set-row');
      const setNum = el('div', 'set-num');
      setNum.textContent = i + 1;

      const lastSet = exercise.last && exercise.last[i];
      const lastInfo = el('div', 'last-info');
      if (lastSet) {
        lastInfo.innerHTML = `<span>${lastSet.reps}</span> @ <span>${lastSet.weight}kg</span>`;
      } else {
        lastInfo.textContent = '—';
      }

      const savedVal = loadRep(activeSession.name, exercise.name, i);
      const input = el('input', 'rep-input' + (savedVal ? ' filled' : ''));
      input.type = 'number';
      input.min = '0';
      input.inputMode = 'numeric';
      input.pattern = '[0-9]*';
      input.placeholder = '0';
      input.value = savedVal;
      input.setAttribute('data-exercise', exercise.name);
      input.setAttribute('data-set', String(i));
      input.setAttribute('aria-label', `${exercise.name} set ${i + 1} reps`);

      input.addEventListener('input', () => {
        const val = input.value.trim();
        saveRep(activeSession.name, exercise.name, i, val);
        input.classList.toggle('filled', val !== '');
        updateBreadcrumb(exercise.name);
      });

      row.appendChild(setNum);
      row.appendChild(lastInfo);
      row.appendChild(input);
      grid.appendChild(row);
    }
    card.appendChild(grid);
    return card;
  }

  function updateBreadcrumb(exerciseName) {
    const exercise = activeSession.exercises.find(e => e.name === exerciseName);
    if (!exercise) return;
    const state = exerciseState(activeSession, exercise);
    const crumb = document.querySelector(`[data-crumb="${CSS.escape(exerciseName)}"]`);
    if (!crumb) return;
    crumb.className = `crumb${state === 'partial' ? ' partial' : state === 'complete' ? ' complete' : ''}`;
    crumb.querySelector('.crumb-icon').textContent = crumbIcon(state);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function oldestSession(sessions) {
    return sessions.reduce((oldest, s) => {
      if (!oldest.lastDate) return s;
      if (!s.lastDate) return oldest;
      return s.lastDate < oldest.lastDate ? s : oldest;
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async function boot() {
    const app = document.getElementById('app');
    try {
      const latestRes = await fetch('../latest.json');
      if (!latestRes.ok) throw new Error(`latest.json: ${latestRes.status}`);
      const latest = await latestRes.json();

      const dataRes = await fetch('../' + latest.dataUrl);
      if (!dataRes.ok) throw new Error(`backup: ${dataRes.status}`);
      data = await dataRes.json();

      activeSession = oldestSession(data.sessions);
      render();
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load data:<br>${err.message}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
