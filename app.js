(function () {
  'use strict';

  let data = null;          // current phase backup JSON
  let phasesData = null;    // all phases from phases.json
  let historyData = null;
  let activeSession = null;
  let activeExIdx = 0;
  let focusMode = false;
  let activePhaseName = null;

  const timer = {
    duration: 90,
    remaining: 0,
    running: false,
    interval: null,
  };

  // ── Storage ──────────────────────────────────────────────────────────────

  function storageKey(sessionName, exerciseName, setIndex, field) {
    return `liftlog-${data.backupDate}-${sessionName}-${exerciseName}-set${setIndex}-${field}`;
  }

  function saveField(sessionName, exerciseName, setIndex, field, value) {
    const key = storageKey(sessionName, exerciseName, setIndex, field);
    if (value === '' || value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  }

  function loadField(sessionName, exerciseName, setIndex, field) {
    return localStorage.getItem(storageKey(sessionName, exerciseName, setIndex, field)) ?? '';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  function exerciseState(session, exercise) {
    let filled = 0;
    for (let i = 0; i < exercise.sets; i++) {
      if (loadField(session.name, exercise.name, i, 'reps') !== '') filled++;
    }
    if (filled === 0) return 'none';
    if (filled === exercise.sets) return 'complete';
    return 'partial';
  }

  function crumbIcon(state) {
    return state === 'complete' ? '✓' : state === 'partial' ? '◐' : '●';
  }

  function oldestSession(sessions) {
    return sessions.reduce((oldest, s) => {
      if (!oldest.lastDate) return s;
      if (!s.lastDate) return oldest;
      return s.lastDate < oldest.lastDate ? s : oldest;
    });
  }

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  // ── Timer ────────────────────────────────────────────────────────────────

  function timerStart(seconds) {
    if (timer.interval) clearInterval(timer.interval);
    timer.duration = seconds || activeSession.targetRestSeconds || 90;
    timer.remaining = timer.duration;
    timer.running = true;
    timer.interval = setInterval(() => {
      timer.remaining--;
      if (timer.remaining <= 0) {
        timer.remaining = 0;
        timer.running = false;
        clearInterval(timer.interval);
        timer.interval = null;
        updateAllTimers('done');
        setTimeout(() => { if (!timer.running) updateAllTimers('idle'); }, 2500);
        return;
      }
      updateAllTimers(timer.remaining <= 15 ? 'warning' : 'active');
    }, 1000);
    updateAllTimers('active');
  }

  function timerStop() {
    if (timer.interval) clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.remaining = 0;
    updateAllTimers('idle');
  }

  function timerFmt(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function timerStateClass() {
    if (!timer.running && timer.remaining === 0) return 'idle';
    if (timer.remaining === 0) return 'done';
    return timer.remaining <= 15 ? 'warning' : 'active';
  }

  function timerDisplayText(state) {
    if (state === 'idle') return 'Rest';
    if (state === 'done') return 'GO!';
    return timerFmt(timer.remaining);
  }

  function updateAllTimers(state) {
    // Floating pill
    const pill = document.querySelector('.timer-pill');
    const text = document.querySelector('.timer-pill .timer-text');
    if (pill && text) {
      pill.className = `timer-pill ${state !== 'idle' ? state : ''}`.trim();
      text.textContent = timerDisplayText(state);
    }
    // Inline (focus mode)
    const inlineWrap = document.querySelector('.focus-timer-inline');
    const inlineText = document.querySelector('.focus-timer-text');
    if (inlineWrap && inlineText) {
      inlineWrap.className = `focus-timer-inline ${state !== 'idle' ? state : ''}`.trim();
      inlineText.textContent = timerDisplayText(state);
    }
  }

  // Shared timer widget — used in both floating and focus-mode inline positions
  function buildTimerWidget() {
    const wrap = el('div', 'timer-widget');

    const pill = el('div', 'timer-pill');
    const state = timerStateClass();
    if (state !== 'idle') pill.classList.add(state);

    const text = el('span', 'timer-text');
    text.textContent = timerDisplayText(state);
    pill.appendChild(text);

    pill.addEventListener('click', () => {
      if (timer.running) timerStop();
      else timerStart(activeSession.targetRestSeconds || 90);
    });

    const editBtn = el('button', 'timer-edit-btn');
    editBtn.textContent = '✏';
    editBtn.title = 'Change duration';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimerPresets(wrap, editBtn);
    });

    wrap.appendChild(pill);
    wrap.appendChild(editBtn);
    return wrap;
  }

  function toggleTimerPresets(wrap, editBtn) {
    const existing = wrap.querySelector('.timer-popover');
    if (existing) { existing.remove(); return; }

    const popover = el('div', 'timer-popover');
    const label = el('div', 'timer-popover-label');
    label.textContent = 'Rest duration';
    const presets = el('div', 'timer-presets');
    [30, 60, 90, 120, 180].forEach(s => {
      const btn = el('button', 'timer-preset-btn');
      btn.textContent = s < 60 ? `${s}s` : `${s / 60}m`;
      if (s === timer.duration) btn.classList.add('current');
      btn.addEventListener('click', () => {
        popover.remove();
        timerStart(s);
      });
      presets.appendChild(btn);
    });
    popover.appendChild(label);
    popover.appendChild(presets);
    // Insert before the pill so it appears above/before the widget
    wrap.insertBefore(popover, wrap.firstChild);
  }

  // ── History overlay ──────────────────────────────────────────────────────

  function openHistory(exerciseName) {
    const allEntries = historyData ? (historyData[activeSession.name] || []) : [];
    const last4 = allEntries
      .filter(e => e.exercises.some(ex => ex.name === exerciseName))
      .slice(0, 4);

    const backdrop = el('div', 'overlay-backdrop');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

    const sheet = el('div', 'history-sheet');

    const hdr = el('div', 'sheet-header');
    const title = el('div', 'sheet-title');
    title.textContent = exerciseName;
    const closeBtn = el('button', 'sheet-close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => backdrop.remove());
    hdr.appendChild(title);
    hdr.appendChild(closeBtn);
    sheet.appendChild(hdr);

    if (last4.length === 0) {
      const empty = el('div', 'history-empty');
      empty.textContent = 'No history yet';
      sheet.appendChild(empty);
    } else {
      last4.forEach(session => {
        const entry = session.exercises.find(ex => ex.name === exerciseName);
        if (!entry) return;
        const row = el('div', 'history-row');
        const dateDiv = el('div', 'history-date');
        dateDiv.textContent = fmtDate(session.date);
        const setsDiv = el('div', 'history-sets');
        setsDiv.innerHTML = entry.done.map((s, i) =>
          `<span>${s.weight}kg×${s.reps}</span>`
        ).join(' ');
        row.appendChild(dateDiv);
        row.appendChild(setsDiv);
        sheet.appendChild(row);
      });
    }

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
  }

  // ── Set rows (shared between main and focus) ─────────────────────────────

  function buildSetRows(exercise, onLastSetFilled) {
    const rows = [];
    for (let i = 0; i < exercise.sets; i++) {
      const row = el('div', 'set-row');

      const label = el('div', 'set-label');
      label.textContent = `Set ${i + 1}`;

      const lastSet = exercise.last && exercise.last[i];
      const savedW = loadField(activeSession.name, exercise.name, i, 'weight');
      const savedR = loadField(activeSession.name, exercise.name, i, 'reps');

      const wInput = el('input', 'set-input' + (savedW ? ' filled' : ''));
      wInput.type = 'number'; wInput.min = '0'; wInput.step = '0.5';
      wInput.inputMode = 'decimal';
      wInput.placeholder = lastSet ? lastSet.weight : '0';
      wInput.value = savedW || (lastSet ? lastSet.weight : '');
      wInput.setAttribute('data-field', 'weight');
      wInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} weight`);

      const mid = el('span', 'set-mid');
      mid.textContent = 'kg ×';

      const rInput = el('input', 'set-input' + (savedR ? ' filled' : ''));
      rInput.type = 'number'; rInput.min = '0';
      rInput.inputMode = 'numeric'; rInput.pattern = '[0-9]*';
      rInput.placeholder = lastSet ? String(lastSet.reps) : '0';
      rInput.value = savedR;
      rInput.setAttribute('data-field', 'reps');
      rInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} reps`);

      const onChange = () => {
        const w = wInput.value.trim();
        const r = rInput.value.trim();
        saveField(activeSession.name, exercise.name, i, 'weight', w);
        saveField(activeSession.name, exercise.name, i, 'reps', r);
        wInput.classList.toggle('filled', w !== '');
        rInput.classList.toggle('filled', r !== '');
        updateBreadcrumb(exercise.name);
        if (i === exercise.sets - 1 && r !== '') onLastSetFilled();
      };

      wInput.addEventListener('input', onChange);
      rInput.addEventListener('input', onChange);

      row.appendChild(label);
      row.appendChild(wInput);
      row.appendChild(mid);
      row.appendChild(rInput);
      rows.push(row);
    }
    return rows;
  }

  // ── Main render ──────────────────────────────────────────────────────────

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Remove any stale floating timer
    document.querySelectorAll('.rest-timer').forEach(t => t.remove());

    const exercise = activeSession.exercises[activeExIdx];
    const nextSession = oldestSession(data.sessions);

    // Header
    const header = el('div', 'header');
    const titleRow = el('div', 'header-title-row');
    const titleLabel = el('div', 'header-title');
    titleLabel.textContent = data.name;
    titleRow.appendChild(titleLabel);

    if (phasesData) {
      const phaseNames = Object.keys(phasesData);
      const phaseSel = el('select', 'phase-select');
      phaseNames.forEach(pn => {
        const opt = document.createElement('option');
        opt.value = pn;
        opt.textContent = pn;
        if (pn === activePhaseName) opt.selected = true;
        phaseSel.appendChild(opt);
      });
      phaseSel.addEventListener('change', () => {
        switchPhase(phaseSel.value);
      });
      titleRow.appendChild(phaseSel);
    }

    const nameRow = el('div', 'header-row');
    nameRow.innerHTML = `<div class="header-name">${activeSession.name}</div>
      <div class="header-date">${fmtDate(activeSession.lastDate)}</div>`;
    header.appendChild(titleRow);
    header.appendChild(nameRow);
    app.appendChild(header);

    // Session tabs
    const tabsEl = el('div', 'session-tabs');
    data.sessions.forEach(session => {
      const isNext = session.name === nextSession.name;
      const tab = el('button', 'session-tab' + (session.name === activeSession.name ? ' active' : ''));
      tab.setAttribute('data-session', session.name);
      tab.innerHTML = `
        <div class="session-tab-name">${session.name}${isNext ? '<span class="next-badge">NEXT</span>' : ''}</div>
        <div class="session-tab-date">${fmtDate(session.lastDate)}</div>
      `;
      tab.addEventListener('click', () => {
        activeSession = data.sessions.find(s => s.name === session.name);
        activeExIdx = 0;
        render();
      });
      tabsEl.appendChild(tab);
    });
    app.appendChild(tabsEl);

    // Breadcrumb
    const bc = el('div', 'breadcrumb');
    bc.id = 'breadcrumb';
    activeSession.exercises.forEach((ex, idx) => {
      const state = exerciseState(activeSession, ex);
      const crumb = el('div', `crumb${idx === activeExIdx ? ' active-crumb' : ''}${state === 'partial' ? ' partial' : state === 'complete' ? ' complete' : ''}`);
      crumb.setAttribute('data-crumb', ex.name);
      crumb.innerHTML = `<span class="crumb-icon">${crumbIcon(state)}</span><span class="crumb-label" title="${ex.name}">${ex.name}</span>`;
      crumb.addEventListener('click', () => { activeExIdx = idx; render(); });
      bc.appendChild(crumb);
    });
    app.appendChild(bc);

    // Nav bar: ‹  1/7  ›  [⛶ Focus]
    const nav = el('div', 'exercise-nav');

    const prevBtn = el('button', 'nav-btn');
    prevBtn.textContent = '‹';
    prevBtn.disabled = activeExIdx === 0;
    prevBtn.addEventListener('click', () => { if (activeExIdx > 0) { activeExIdx--; render(); } });

    const counter = el('div', 'nav-counter');
    counter.textContent = `${activeExIdx + 1} / ${activeSession.exercises.length}`;

    const nextBtn = el('button', 'nav-btn');
    nextBtn.textContent = '›';
    nextBtn.disabled = activeExIdx === activeSession.exercises.length - 1;
    nextBtn.addEventListener('click', () => { if (activeExIdx < activeSession.exercises.length - 1) { activeExIdx++; render(); } });

    const focusToggle = el('button', 'nav-focus-btn');
    focusToggle.innerHTML = '⛶ Focus';
    focusToggle.addEventListener('click', () => {
      focusMode = true;
      renderFocus();
    });

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
    nav.appendChild(focusToggle);
    app.appendChild(nav);

    // Exercise card
    const area = el('div', 'exercise-area');
    const card = el('div', 'exercise-card');
    card.setAttribute('data-exercise', exercise.name);

    const exHeader = el('div', 'exercise-header');
    const left = el('div', 'exercise-header-left');
    left.innerHTML = `<div class="exercise-name">${exercise.name}</div>
      <div class="exercise-meta">${exercise.sets} sets · ${exercise.repsPerSet} reps target</div>`;

    const histBtn = el('button', 'icon-btn');
    histBtn.textContent = '📋';
    histBtn.title = 'History';
    histBtn.addEventListener('click', () => openHistory(exercise.name));

    exHeader.appendChild(left);
    exHeader.appendChild(histBtn);
    card.appendChild(exHeader);

    const grid = el('div', 'sets-grid');
    buildSetRows(exercise, () => timerStart(activeSession.targetRestSeconds || 90))
      .forEach(row => grid.appendChild(row));
    card.appendChild(grid);
    area.appendChild(card);
    app.appendChild(area);

    setupSwipe(area);

    // Floating timer (bottom-right)
    const timerEl = el('div', 'rest-timer');
    timerEl.appendChild(buildTimerWidget());
    document.body.appendChild(timerEl);
  }

  // ── Focus mode ──────────────────────────────────────────────────────────

  function renderFocus() {
    // Remove existing focus overlay if any
    const existing = document.getElementById('focus-overlay');
    if (existing) existing.remove();

    const exercise = activeSession.exercises[activeExIdx];
    const overlay = el('div', 'focus-overlay');
    overlay.id = 'focus-overlay';

    // Top bar: ← Back   1/7   ⛶ Exit   [timer widget]
    const topBar = el('div', 'focus-top-bar');

    const backBtn = el('button', 'focus-back');
    backBtn.innerHTML = '← Back';
    backBtn.addEventListener('click', () => {
      focusMode = false;
      overlay.remove();
      render();
    });

    const focusCounter = el('div', 'nav-counter');
    focusCounter.style.flex = '1';
    focusCounter.style.textAlign = 'center';
    focusCounter.textContent = `${activeExIdx + 1} / ${activeSession.exercises.length}`;

    // Timer inline widget (same component, just positioned inline)
    const timerWrap = el('div', 'focus-timer-inline');
    const state = timerStateClass();
    if (state !== 'idle') timerWrap.classList.add(state);

    const timerText = el('span', 'focus-timer-text');
    timerText.textContent = timerDisplayText(state);
    timerText.addEventListener('click', () => {
      if (timer.running) timerStop();
      else timerStart(activeSession.targetRestSeconds || 90);
    });

    const timerEditBtn = el('button', 'timer-edit-btn');
    timerEditBtn.textContent = '✏';
    timerEditBtn.title = 'Change duration';
    timerEditBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimerPresets(timerWrap, timerEditBtn);
    });

    timerWrap.appendChild(timerText);
    timerWrap.appendChild(timerEditBtn);

    topBar.appendChild(backBtn);
    topBar.appendChild(focusCounter);
    topBar.appendChild(timerWrap);
    overlay.appendChild(topBar);

    // Body
    const body = el('div', 'focus-body');

    const nameDiv = el('div', 'focus-name');
    nameDiv.textContent = exercise.name;
    body.appendChild(nameDiv);

    const targetDiv = el('div', 'focus-target');
    targetDiv.textContent = `${exercise.sets} sets · ${exercise.repsPerSet} reps target`;
    body.appendChild(targetDiv);

    if (exercise.last && exercise.last.length) {
      const lastBox = el('div', 'focus-last');
      const lastLabel = el('div', 'focus-last-label');
      lastLabel.textContent = `Last time · ${fmtDate(activeSession.lastDate)}`;
      const lastVal = el('div', 'focus-last-val');
      lastVal.innerHTML = exercise.last.map((s, i) =>
        `<strong>${s.weight}kg×${s.reps}</strong>`
      ).join('  ');
      lastBox.appendChild(lastLabel);
      lastBox.appendChild(lastVal);
      body.appendChild(lastBox);
    }

    const setsWrap = el('div', 'focus-sets');
    buildSetRows(exercise, () => timerStart(activeSession.targetRestSeconds || 90))
      .forEach(row => {
        row.classList.add('focus-set-row');
        setsWrap.appendChild(row);
      });
    body.appendChild(setsWrap);
    overlay.appendChild(body);

    // Footer: prev / done / next
    const footer = el('div', 'focus-footer');

    const prevBtn = el('button', 'focus-nav-btn');
    prevBtn.textContent = '‹ Prev';
    prevBtn.disabled = activeExIdx === 0;
    prevBtn.addEventListener('click', () => {
      activeExIdx--;
      renderFocus();
    });

    const doneBtn = el('button', 'focus-next-btn');
    const isLast = activeExIdx === activeSession.exercises.length - 1;
    doneBtn.textContent = isLast ? 'Done ✓' : 'Next →';
    doneBtn.addEventListener('click', () => {
      if (!isLast) { activeExIdx++; renderFocus(); }
      else { focusMode = false; overlay.remove(); render(); }
    });

    const nextNavBtn = el('button', 'focus-nav-btn');
    nextNavBtn.textContent = 'Next ›';
    nextNavBtn.disabled = isLast;
    nextNavBtn.addEventListener('click', () => {
      activeExIdx++;
      renderFocus();
    });

    footer.appendChild(prevBtn);
    footer.appendChild(doneBtn);
    footer.appendChild(nextNavBtn);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
  }

  // ── Breadcrumb update (live) ──────────────────────────────────────────────

  function updateBreadcrumb(exerciseName) {
    const exercise = activeSession.exercises.find(e => e.name === exerciseName);
    if (!exercise) return;
    const state = exerciseState(activeSession, exercise);
    const crumb = document.querySelector(`[data-crumb="${CSS.escape(exerciseName)}"]`);
    if (!crumb) return;
    const isActive = crumb.classList.contains('active-crumb');
    crumb.className = `crumb${isActive ? ' active-crumb' : ''}${state === 'partial' ? ' partial' : state === 'complete' ? ' complete' : ''}`;
    crumb.querySelector('.crumb-icon').textContent = crumbIcon(state);
  }

  // ── Swipe ────────────────────────────────────────────────────────────────

  function setupSwipe(el) {
    let startX = 0, startY = 0;
    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < Math.abs(dy) * 1.5 || Math.abs(dx) < 50) return;
      if (dx < 0 && activeExIdx < activeSession.exercises.length - 1) { activeExIdx++; render(); }
      else if (dx > 0 && activeExIdx > 0) { activeExIdx--; render(); }
    }, { passive: true });
  }

  // ── Phase switching ───────────────────────────────────────────────────────

  function switchPhase(phaseName) {
    if (!phasesData || !phasesData[phaseName]) return;
    activePhaseName = phaseName;
    data = {
      name: phaseName,
      backupDate: data.backupDate,
      sessions: phasesData[phaseName]
    };
    activeSession = oldestSession(data.sessions.filter(s => s.lastDate)) || data.sessions[0];
    activeExIdx = 0;
    focusMode = false;
    document.getElementById('focus-overlay')?.remove();
    render();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    const app = document.getElementById('app');
    try {
      const latest = await fetch('latest.json').then(r => { if (!r.ok) throw new Error('latest.json ' + r.status); return r.json(); });
      data = await fetch(latest.dataUrl).then(r => { if (!r.ok) throw new Error('backup ' + r.status); return r.json(); });
      try { historyData = await fetch('data/history.json').then(r => r.ok ? r.json() : null); } catch {}
      try { phasesData = await fetch('data/phases.json').then(r => r.ok ? r.json() : null); } catch {}
      activePhaseName = data.name;
      // Merge live data into phasesData so the selector includes Phase 4 with real lastDates
      if (phasesData && !phasesData[data.name]) {
        phasesData[data.name] = data.sessions;
      } else if (phasesData) {
        phasesData[data.name] = data.sessions; // always use live data for current phase
      }
      activeSession = oldestSession(data.sessions);
      activeExIdx = 0;
      render();
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
