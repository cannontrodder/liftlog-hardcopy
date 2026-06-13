/* LiftLog — client-side workout tracker */

(function () {
  'use strict';

  let data = null;           // full backup JSON
  let historyData = null;    // history.json
  let activeSession = null;  // session object currently displayed
  let activeExIdx = 0;       // index of exercise being shown

  // ── Timer state ───────────────────────────────────────────────────────────
  const timer = {
    duration: 90,       // seconds (from session or custom)
    remaining: 0,
    running: false,
    interval: null,
    popoverOpen: false,
  };

  // ── Storage helpers ──────────────────────────────────────────────────────

  function storageKey(sessionName, exerciseName, setIndex, field) {
    return `liftlog-${data.backupDate}-${sessionName}-${exerciseName}-set${setIndex}-${field}`;
  }

  function saveField(sessionName, exerciseName, setIndex, field, value) {
    const key = storageKey(sessionName, exerciseName, setIndex, field);
    if (value === '' || value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  }

  function loadField(sessionName, exerciseName, setIndex, field) {
    return localStorage.getItem(storageKey(sessionName, exerciseName, setIndex, field)) ?? '';
  }

  // ── Date formatting ───────────────────────────────────────────────────────

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  // ── Completion state ──────────────────────────────────────────────────────

  function exerciseState(session, exercise) {
    let filled = 0;
    for (let i = 0; i < exercise.sets; i++) {
      const r = loadField(session.name, exercise.name, i, 'reps');
      if (r !== '') filled++;
    }
    if (filled === 0) return 'none';
    if (filled === exercise.sets) return 'complete';
    return 'partial';
  }

  function crumbIcon(state) {
    if (state === 'complete') return '✓';
    if (state === 'partial') return '◐';
    return '●';
  }

  // ── NEXT session ──────────────────────────────────────────────────────────

  function oldestSession(sessions) {
    return sessions.reduce((oldest, s) => {
      if (!oldest.lastDate) return s;
      if (!s.lastDate) return oldest;
      return s.lastDate < oldest.lastDate ? s : oldest;
    });
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

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
        updateTimerUI('done');
        setTimeout(() => {
          if (!timer.running) updateTimerUI('idle');
        }, 3000);
        return;
      }
      updateTimerUI(timer.remaining <= 15 ? 'warning' : 'active');
    }, 1000);
    updateTimerUI('active');
  }

  function timerStop() {
    if (timer.interval) clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    timer.remaining = 0;
    updateTimerUI('idle');
  }

  function timerFmt(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateTimerUI(state) {
    const pill = document.querySelector('.timer-pill');
    const text = document.querySelector('.timer-text');
    const icon = document.querySelector('.timer-icon');
    if (!pill) return;

    pill.className = 'timer-pill';
    if (state === 'active') pill.classList.add('active');
    else if (state === 'warning') pill.classList.add('warning');
    else if (state === 'done') pill.classList.add('done');

    if (state === 'idle') {
      icon.textContent = '⏱';
      text.textContent = 'Rest';
    } else if (state === 'done') {
      icon.textContent = '🟢';
      text.textContent = 'GO!';
    } else {
      icon.textContent = '';
      text.textContent = timerFmt(timer.remaining);
    }

    // Also update focus mode inline timer if visible
    const focusTimer = document.querySelector('.focus-timer-inline');
    if (focusTimer) {
      focusTimer.className = 'focus-timer-inline';
      if (state === 'idle') { focusTimer.textContent = 'Rest'; focusTimer.classList.add('idle'); }
      else if (state === 'done') { focusTimer.textContent = 'GO!'; focusTimer.classList.add('done'); }
      else if (state === 'warning') { focusTimer.textContent = timerFmt(timer.remaining); focusTimer.classList.add('warning'); }
      else { focusTimer.textContent = timerFmt(timer.remaining); }
    }
  }

  // ── History overlay ───────────────────────────────────────────────────────

  function openHistory(exerciseName) {
    const allEntries = historyData ? (historyData[activeSession.name] || []) : [];
    const last4 = allEntries
      .filter(e => e.exercises.some(ex => ex.name === exerciseName))
      .slice(-4)
      .reverse();

    const backdrop = el('div', 'overlay-backdrop');
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

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
        setsDiv.innerHTML = entry.done.map((s, i) => {
          return `Set ${i + 1}: <span>${s.weight}kg × ${s.reps}</span>`;
        }).join(' &nbsp; ');
        row.appendChild(dateDiv);
        row.appendChild(setsDiv);
        sheet.appendChild(row);
      });
    }

    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);
  }

  // ── Focus mode ────────────────────────────────────────────────────────────

  function openFocus(exercise) {
    const overlay = el('div', 'focus-overlay');
    overlay.setAttribute('id', 'focus-overlay');

    // Top bar
    const topBar = el('div', 'focus-top-bar');
    const backBtn = el('button', 'focus-back');
    backBtn.innerHTML = '← Back';
    backBtn.addEventListener('click', () => {
      overlay.remove();
    });

    const timerInline = el('div', 'focus-timer-inline idle');
    const timerState = timer.running
      ? (timer.remaining <= 15 ? 'warning' : 'active')
      : 'idle';
    timerInline.className = 'focus-timer-inline' + (timerState === 'idle' ? ' idle' : timerState === 'warning' ? ' warning' : '');
    timerInline.textContent = timer.running ? timerFmt(timer.remaining) : 'Rest';
    timerInline.addEventListener('click', () => {
      if (timer.running) timerStop();
      else timerStart(activeSession.targetRestSeconds || 90);
    });

    topBar.appendChild(backBtn);
    topBar.appendChild(timerInline);
    overlay.appendChild(topBar);

    // Body
    const body = el('div', 'focus-body');

    const nameDiv = el('div', 'focus-name');
    nameDiv.textContent = exercise.name;
    const targetDiv = el('div', 'focus-target');
    targetDiv.textContent = `Target: ${exercise.sets} sets × ${exercise.repsPerSet} reps`;
    body.appendChild(nameDiv);
    body.appendChild(targetDiv);

    // Last time
    const lastBox = el('div', 'focus-last');
    const lastLabel = el('div', 'focus-last-label');
    lastLabel.textContent = `Last time (${fmtDate(activeSession.lastDate)})`;
    const lastVal = el('div', 'focus-last-val');
    if (exercise.last && exercise.last.length) {
      lastVal.innerHTML = exercise.last.map((s, i) =>
        `Set ${i + 1}: <strong>${s.weight}kg × ${s.reps}</strong>`
      ).join(' &nbsp; ');
    } else {
      lastVal.textContent = 'No previous data';
    }
    lastBox.appendChild(lastLabel);
    lastBox.appendChild(lastVal);
    body.appendChild(lastBox);

    // Sets
    const setsWrap = el('div', 'focus-sets');
    for (let i = 0; i < exercise.sets; i++) {
      const row = el('div', 'focus-set-row');
      const num = el('div', 'set-num');
      num.textContent = i + 1;

      const lastSet = exercise.last && exercise.last[i];
      const savedW = loadField(activeSession.name, exercise.name, i, 'weight');
      const savedR = loadField(activeSession.name, exercise.name, i, 'reps');

      const wInput = el('input', 'set-input' + (savedW ? ' filled' : ''));
      wInput.type = 'number';
      wInput.min = '0';
      wInput.step = '0.5';
      wInput.inputMode = 'decimal';
      wInput.placeholder = lastSet ? lastSet.weight : '0';
      wInput.value = savedW || (lastSet ? lastSet.weight : '');
      wInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} weight`);

      const wUnit = el('span', 'set-unit');
      wUnit.textContent = 'kg';

      const sep = el('div', 'set-sep');
      sep.textContent = '×';

      const rInput = el('input', 'set-input' + (savedR ? ' filled' : ''));
      rInput.type = 'number';
      rInput.min = '0';
      rInput.inputMode = 'numeric';
      rInput.pattern = '[0-9]*';
      rInput.placeholder = lastSet ? String(lastSet.reps) : '0';
      rInput.value = savedR;
      rInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} reps`);

      const saveAndCheck = () => {
        const w = wInput.value.trim();
        const r = rInput.value.trim();
        saveField(activeSession.name, exercise.name, i, 'weight', w);
        saveField(activeSession.name, exercise.name, i, 'reps', r);
        wInput.classList.toggle('filled', w !== '');
        rInput.classList.toggle('filled', r !== '');
        updateBreadcrumb(exercise.name);
        // Also update main view inputs if visible
        syncMainInputs(exercise.name, i, w, r);
        // Auto-start timer when last set reps are entered
        if (i === exercise.sets - 1 && r !== '') {
          timerStart(activeSession.targetRestSeconds || 90);
        }
      };

      wInput.addEventListener('input', saveAndCheck);
      rInput.addEventListener('input', saveAndCheck);

      row.appendChild(num);
      row.appendChild(wInput);
      row.appendChild(wUnit);
      row.appendChild(sep);
      row.appendChild(rInput);
      setsWrap.appendChild(row);
    }
    body.appendChild(setsWrap);
    overlay.appendChild(body);

    // Footer
    const footer = el('div', 'focus-footer');
    const nextBtn = el('button', 'focus-next-btn');
    const isLast = activeExIdx === activeSession.exercises.length - 1;
    nextBtn.textContent = isLast ? 'Session complete ✓' : 'Next exercise →';
    nextBtn.addEventListener('click', () => {
      overlay.remove();
      if (!isLast) {
        activeExIdx++;
        render();
      }
    });
    footer.appendChild(nextBtn);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
  }

  // Sync inputs in main view (if rendered) when focus mode changes them
  function syncMainInputs(exerciseName, setIndex, weight, reps) {
    const cards = document.querySelectorAll('.exercise-card');
    cards.forEach(card => {
      if (card.getAttribute('data-exercise') !== exerciseName) return;
      const rows = card.querySelectorAll('.set-row');
      const row = rows[setIndex];
      if (!row) return;
      const inputs = row.querySelectorAll('.set-input');
      if (inputs[0]) { inputs[0].value = weight; inputs[0].classList.toggle('filled', weight !== ''); }
      if (inputs[1]) { inputs[1].value = reps; inputs[1].classList.toggle('filled', reps !== ''); }
    });
  }

  // ── Timer popover ─────────────────────────────────────────────────────────

  function toggleTimerPopover() {
    timer.popoverOpen = !timer.popoverOpen;
    const existing = document.querySelector('.timer-popover');
    if (!timer.popoverOpen || existing) {
      if (existing) existing.remove();
      timer.popoverOpen = false;
      return;
    }
    const popover = el('div', 'timer-popover');
    const label = el('div', 'timer-popover-label');
    label.textContent = 'Set duration';
    const presets = el('div', 'timer-presets');
    [30, 60, 90, 120, 180].forEach(s => {
      const btn = el('button', 'timer-preset-btn');
      btn.textContent = s < 60 ? `${s}s` : `${s / 60}m`;
      btn.addEventListener('click', () => {
        timer.popoverOpen = false;
        const pop = document.querySelector('.timer-popover');
        if (pop) pop.remove();
        timerStart(s);
      });
      presets.appendChild(btn);
    });
    popover.appendChild(label);
    popover.appendChild(presets);
    const timerEl = document.querySelector('.rest-timer');
    if (timerEl) timerEl.insertBefore(popover, timerEl.firstChild);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    const exercise = activeSession.exercises[activeExIdx];

    // Header
    const header = el('div', 'header');
    header.innerHTML = `
      <div class="header-title">${data.name}</div>
      <div class="header-row">
        <div class="header-name">${activeSession.name}</div>
        <div class="header-date">${fmtDate(activeSession.lastDate)}</div>
      </div>
    `;
    app.appendChild(header);

    // Session tabs
    const nextSession = oldestSession(data.sessions);
    const tabsEl = el('div', 'session-tabs');
    data.sessions.forEach(session => {
      const tab = el('button', 'session-tab' + (session.name === activeSession.name ? ' active' : ''));
      tab.setAttribute('data-session', session.name);
      const isNext = session.name === nextSession.name;
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

    // Breadcrumb — clickable exercise dots
    const bc = el('div', 'breadcrumb');
    bc.setAttribute('id', 'breadcrumb');
    activeSession.exercises.forEach((ex, idx) => {
      const state = exerciseState(activeSession, ex);
      const crumb = el('div', `crumb${idx === activeExIdx ? ' active-crumb' : ''}${state === 'partial' ? ' partial' : state === 'complete' ? ' complete' : ''}`);
      crumb.setAttribute('data-crumb', ex.name);
      crumb.innerHTML = `<span class="crumb-icon">${crumbIcon(state)}</span><span class="crumb-label" title="${ex.name}">${ex.name}</span>`;
      crumb.addEventListener('click', () => {
        activeExIdx = idx;
        render();
      });
      bc.appendChild(crumb);
    });
    app.appendChild(bc);

    // Exercise navigation bar
    const nav = el('div', 'exercise-nav');
    const prevBtn = el('button', 'nav-btn');
    prevBtn.textContent = '‹';
    prevBtn.disabled = activeExIdx === 0;
    prevBtn.addEventListener('click', () => {
      if (activeExIdx > 0) { activeExIdx--; render(); }
    });

    const counter = el('div', 'nav-counter');
    counter.textContent = `${activeExIdx + 1} / ${activeSession.exercises.length}`;

    const nextBtn = el('button', 'nav-btn');
    nextBtn.textContent = '›';
    nextBtn.disabled = activeExIdx === activeSession.exercises.length - 1;
    nextBtn.addEventListener('click', () => {
      if (activeExIdx < activeSession.exercises.length - 1) { activeExIdx++; render(); }
    });

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
    app.appendChild(nav);

    // Exercise card
    const area = el('div', 'exercise-area');
    area.appendChild(renderExercise(exercise));
    app.appendChild(area);

    // Floating rest timer
    renderTimer(app);

    // Swipe support
    setupSwipe(area);
  }

  function renderExercise(exercise) {
    const card = el('div', 'exercise-card');
    card.setAttribute('data-exercise', exercise.name);

    const header = el('div', 'exercise-header');
    const left = el('div', 'exercise-header-left');
    left.innerHTML = `
      <div class="exercise-name">${exercise.name}</div>
      <div class="exercise-meta">${exercise.sets} × ${exercise.repsPerSet} reps target</div>
    `;
    const actions = el('div', 'exercise-header-actions');

    const histBtn = el('button', 'icon-btn');
    histBtn.textContent = '📋';
    histBtn.title = 'History';
    histBtn.addEventListener('click', () => openHistory(exercise.name));

    const focusBtn = el('button', 'icon-btn');
    focusBtn.textContent = '⛶';
    focusBtn.title = 'Focus mode';
    focusBtn.addEventListener('click', () => openFocus(exercise));

    actions.appendChild(histBtn);
    actions.appendChild(focusBtn);
    header.appendChild(left);
    header.appendChild(actions);
    card.appendChild(header);

    const grid = el('div', 'sets-grid');
    for (let i = 0; i < exercise.sets; i++) {
      const row = el('div', 'set-row');
      const setNum = el('div', 'set-num');
      setNum.textContent = i + 1;

      const lastSet = exercise.last && exercise.last[i];

      const savedW = loadField(activeSession.name, exercise.name, i, 'weight');
      const savedR = loadField(activeSession.name, exercise.name, i, 'reps');

      const wInput = el('input', 'set-input' + (savedW ? ' filled' : ''));
      wInput.type = 'number';
      wInput.min = '0';
      wInput.step = '0.5';
      wInput.inputMode = 'decimal';
      wInput.placeholder = lastSet ? lastSet.weight : '0';
      wInput.value = savedW || (lastSet ? lastSet.weight : '');
      wInput.setAttribute('data-exercise', exercise.name);
      wInput.setAttribute('data-set', String(i));
      wInput.setAttribute('data-field', 'weight');
      wInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} weight`);

      const wUnit = el('span', 'set-unit');
      wUnit.textContent = 'kg';

      const sep = el('div', 'set-sep');
      sep.textContent = '×';

      const rInput = el('input', 'set-input' + (savedR ? ' filled' : ''));
      rInput.type = 'number';
      rInput.min = '0';
      rInput.inputMode = 'numeric';
      rInput.pattern = '[0-9]*';
      rInput.placeholder = lastSet ? String(lastSet.reps) : '0';
      rInput.value = savedR;
      rInput.setAttribute('data-exercise', exercise.name);
      rInput.setAttribute('data-set', String(i));
      rInput.setAttribute('data-field', 'reps');
      rInput.setAttribute('aria-label', `${exercise.name} set ${i + 1} reps`);

      const onInput = () => {
        const w = wInput.value.trim();
        const r = rInput.value.trim();
        saveField(activeSession.name, exercise.name, i, 'weight', w);
        saveField(activeSession.name, exercise.name, i, 'reps', r);
        wInput.classList.toggle('filled', w !== '');
        rInput.classList.toggle('filled', r !== '');
        updateBreadcrumb(exercise.name);
        // Auto-start timer when last set reps are entered
        if (i === exercise.sets - 1 && r !== '') {
          timerStart(activeSession.targetRestSeconds || 90);
        }
      };

      wInput.addEventListener('input', onInput);
      rInput.addEventListener('input', onInput);

      row.appendChild(setNum);
      row.appendChild(wInput);
      row.appendChild(wUnit);
      row.appendChild(sep);
      row.appendChild(rInput);
      grid.appendChild(row);
    }
    card.appendChild(grid);
    return card;
  }

  function renderTimer(container) {
    const timerEl = el('div', 'rest-timer');

    const pill = el('div', 'timer-pill' + (timer.running ? (timer.remaining <= 15 ? ' warning' : ' active') : ''));
    const icon = el('span', 'timer-icon');
    icon.textContent = timer.running ? '' : '⏱';
    const text = el('span', 'timer-text');
    text.textContent = timer.running ? timerFmt(timer.remaining) : 'Rest';

    pill.appendChild(icon);
    pill.appendChild(text);

    // Single tap: start/stop
    pill.addEventListener('click', (e) => {
      // Close popover if open
      if (timer.popoverOpen) {
        toggleTimerPopover();
        return;
      }
      if (timer.running) {
        timerStop();
      } else {
        timerStart(activeSession.targetRestSeconds || 90);
      }
    });

    // Long-press: open popover
    let pressTimer = null;
    pill.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        toggleTimerPopover();
      }, 600);
    });
    pill.addEventListener('pointerup', () => { if (pressTimer) clearTimeout(pressTimer); });
    pill.addEventListener('pointercancel', () => { if (pressTimer) clearTimeout(pressTimer); });

    timerEl.appendChild(pill);
    document.body.appendChild(timerEl);
  }

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

  // ── Swipe support ─────────────────────────────────────────────────────────

  function setupSwipe(el) {
    let startX = 0;
    let startY = 0;
    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // vertical dominant
      if (Math.abs(dx) < 50) return; // threshold
      if (dx < 0 && activeExIdx < activeSession.exercises.length - 1) {
        activeExIdx++;
        render();
      } else if (dx > 0 && activeExIdx > 0) {
        activeExIdx--;
        render();
      }
    }, { passive: true });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  async function boot() {
    const app = document.getElementById('app');

    // Remove any stale timer pill from previous render
    document.querySelectorAll('.rest-timer').forEach(t => t.remove());

    try {
      const latestRes = await fetch('latest.json');
      if (!latestRes.ok) throw new Error(`latest.json: ${latestRes.status}`);
      const latest = await latestRes.json();

      const dataRes = await fetch(latest.dataUrl);
      if (!dataRes.ok) throw new Error(`backup: ${dataRes.status}`);
      data = await dataRes.json();

      // Load history (non-fatal)
      try {
        const histRes = await fetch('data/history.json');
        if (histRes.ok) historyData = await histRes.json();
      } catch (_) { /* history unavailable */ }

      activeSession = oldestSession(data.sessions);
      activeExIdx = 0;
      render();
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load data:<br>${err.message}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
