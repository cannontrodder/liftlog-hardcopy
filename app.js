(function () {
  'use strict';

  let data = null;          // current phase backup JSON
  let phasesData = null;    // all phases from phases.json
  let historyData = null;
  let activeSession = null;
  let activeExIdx = 0;
  let focusMode = false;
  let activePhaseName = null;
  let warmupExerciseName = null;
  let dismissedUpdateVersion = sessionStorage.getItem('liftlog:update-prompted-version') || null;
  let updateCheckInFlight = false;

  const STATE_KEY = 'liftlog-hardcopy:ui:v1';
  const FIELD_KEY_PREFIX = 'liftlog-hardcopy:field:v2';
  const DEPLOY_VERSION_META = 'liftlog-deploy-version';
  const DEPLOY_VERSION_RE = /^\d{20,}$/;
  const LATEST_DEPLOY_FILE = 'deploy-version.json';
  const UPDATE_PROMPT_STATE_KEY = 'liftlog:update-prompted-version';

  const timer = {
    duration: 90,
    remaining: 0,
    running: false,
    interval: null,
  };

  // ── Storage ──────────────────────────────────────────────────────────────

  function stateKey() {
    return STATE_KEY;
  }

  function fieldStorageKey(phaseName, sessionName, exerciseName, setIndex, field) {
    return `${FIELD_KEY_PREFIX}:${phaseName}:${sessionName}:${exerciseName}:set${setIndex}:${field}`;
  }

  function legacyFieldStorageKey(sessionName, exerciseName, setIndex, field) {
    return `liftlog-${data.backupDate}-${sessionName}-${exerciseName}-set${setIndex}-${field}`;
  }

  function readUiState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(stateKey()));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
    return null;
  }

  function writeUiState(next) {
    localStorage.setItem(stateKey(), JSON.stringify(next));
  }

  function saveViewState() {
    if (!activeSession || !activeSession.exercises.length) return;
    writeUiState({
      phaseName: activePhaseName,
      sessionName: activeSession.name,
      exerciseName: activeSession.exercises[activeExIdx]?.name || null,
      exerciseIndex: activeExIdx,
      focusMode,
    });
  }

  function loadStoredField(sessionName, exerciseName, setIndex, field) {
    const phaseName = activePhaseName || data?.name;
    if (phaseName) {
      const current = localStorage.getItem(fieldStorageKey(phaseName, sessionName, exerciseName, setIndex, field));
      if (current != null) return current;
    }
    return localStorage.getItem(legacyFieldStorageKey(sessionName, exerciseName, setIndex, field));
  }

  function migrateLegacyFields(phaseName, sessions) {
    if (!phaseName || !sessions) return;
    sessions.forEach(session => {
      session.exercises.forEach(exercise => {
        for (let i = 0; i < exercise.sets; i++) {
          ['weight', 'reps'].forEach(field => {
            const stableKey = fieldStorageKey(phaseName, session.name, exercise.name, i, field);
            if (localStorage.getItem(stableKey) != null) return;

            const suffix = `-${session.name}-${exercise.name}-set${i}-${field}`;
            for (let idx = 0; idx < localStorage.length; idx++) {
              const key = localStorage.key(idx);
              if (key && key.startsWith('liftlog-') && key.endsWith(suffix)) {
                const value = localStorage.getItem(key);
                if (value != null) localStorage.setItem(stableKey, value);
                return;
              }
            }
          });
        }
      });
    });
  }

  function saveField(sessionName, exerciseName, setIndex, field, value) {
    const key = fieldStorageKey(activePhaseName || data.name, sessionName, exerciseName, setIndex, field);
    if (value === '' || value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  }

  function loadField(sessionName, exerciseName, setIndex, field) {
    return loadStoredField(sessionName, exerciseName, setIndex, field) ?? '';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  function fmtKg(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    return Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, '');
  }

  function fmtWeightLabel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'BW';
    if (num === 0) return 'BW';
    return `${fmtKg(num)}kg`;
  }

  function parseKg(value) {
    if (value === '' || value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function roundToPlate(value) {
    return Math.max(0, Math.round(value / 2.5) * 2.5);
  }

  function fmtDelta(value, suffix = '') {
    const num = Number(value);
    if (!Number.isFinite(num) || num === 0) return `0${suffix}`;
    return `${num > 0 ? '+' : ''}${fmtKg(num)}${suffix}`;
  }

  function sessionByName(name) {
    return data.sessions.find(session => session.name === name) || null;
  }

  function exerciseIndexByName(session, exerciseName) {
    if (!session) return 0;
    const idx = session.exercises.findIndex(ex => ex.name === exerciseName);
    return idx >= 0 ? idx : 0;
  }

  function totalLoggedSets(session) {
    return session.exercises.reduce((sum, exercise) => {
      let filled = 0;
      for (let i = 0; i < exercise.sets; i++) {
        if (loadField(session.name, exercise.name, i, 'reps') !== '') filled++;
      }
      return sum + filled;
    }, 0);
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

  function updateSetDelta(node, currentWeight, currentReps, lastWeight, lastReps) {
    if (!node) return;
    const weight = parseKg(currentWeight);
    const reps = parseKg(currentReps);
    const hasCurrent = weight != null || reps != null;
    if (!hasCurrent) {
      if (lastWeight != null || lastReps != null) {
        node.textContent = `Last: ${fmtWeightLabel(lastWeight ?? 0)} × ${fmtKg(lastReps ?? 0)}`;
      } else {
        node.textContent = 'No prior log';
      }
      return;
    }

    const weightDelta = weight != null && lastWeight != null ? weight - lastWeight : null;
    const repsDelta = reps != null && lastReps != null ? reps - lastReps : null;
    const pieces = [];
    if (weightDelta != null && weightDelta !== 0) pieces.push(`${fmtDelta(weightDelta, 'kg')}`);
    if (repsDelta != null && repsDelta !== 0) pieces.push(`${fmtDelta(repsDelta, ' reps')}`);
    if (pieces.length === 0) {
      node.textContent = 'Same as last';
      return;
    }
    node.textContent = `Vs last ${pieces.join(' · ')}`;
  }

  function oldestSession(sessions) {
    return sessions.reduce((oldest, s) => {
      if (!oldest.lastDate) return s;
      if (!s.lastDate) return oldest;
      return s.lastDate < oldest.lastDate ? s : oldest;
    });
  }

  function nextSessionAfter(currentSession) {
    const remaining = data.sessions.filter(session => session.name !== currentSession.name);
    if (remaining.length === 0) return currentSession;
    return oldestSession(remaining);
  }

  function workingWeightForExercise(exercise) {
    const savedFirstSet = parseKg(loadField(activeSession.name, exercise.name, 0, 'weight'));
    if (savedFirstSet != null) return savedFirstSet;
    const lastWeights = (exercise.last || [])
      .map(set => parseKg(set.weight))
      .filter(weight => weight != null);
    if (lastWeights.length > 0) return lastWeights[0];
    return null;
  }

  function warmupPlanForExercise(exercise) {
    const baseWeight = workingWeightForExercise(exercise);
    if (baseWeight == null || baseWeight <= 0) return null;
    return [
      { label: '50%', weight: roundToPlate(baseWeight * 0.5) },
      { label: '75%', weight: roundToPlate(baseWeight * 0.75) },
    ];
  }

  function latestExerciseHistory(sessionName, exerciseName) {
    const sessions = historyData ? (historyData[sessionName] || []) : [];
    const session = sessions.find(entry => entry.exercises.some(ex => ex.name === exerciseName));
    if (session) {
      const entry = session.exercises.find(ex => ex.name === exerciseName);
      return {
        date: session.date,
        done: entry ? entry.done : [],
      };
    }
    return null;
  }

  function workoutHasStarted() {
    if (!activeSession) return false;
    return activeSession.exercises.some(exercise => loadField(activeSession.name, exercise.name, 0, 'reps') !== '');
  }

  function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
  }

  function currentDeployVersion() {
    const meta = document.querySelector(`meta[name="${DEPLOY_VERSION_META}"]`);
    const raw = meta?.content || window.__LIFTLOG_DEPLOY_VERSION__ || '';
    return DEPLOY_VERSION_RE.test(raw) ? raw : null;
  }

  function liveDeployVersionUrl() {
    const current = currentDeployVersion();
    const cacheBust = current || String(Date.now());
    return `${LATEST_DEPLOY_FILE}?v=${encodeURIComponent(cacheBust)}`;
  }

  function compareDeployVersions(left, right) {
    try {
      const a = BigInt(left);
      const b = BigInt(right);
      if (a === b) return 0;
      return a > b ? 1 : -1;
    } catch {
      return left.localeCompare(right);
    }
  }

  function removeUpdatePrompt() {
    document.getElementById('update-prompt-backdrop')?.remove();
  }

  function showUpdatePrompt(version) {
    if (!version || dismissedUpdateVersion === version) return;
    if (document.getElementById('update-prompt-backdrop')) return;

    const backdrop = el('div', 'update-prompt-backdrop');
    backdrop.id = 'update-prompt-backdrop';
    backdrop.setAttribute('role', 'presentation');

    const card = el('div', 'update-prompt-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'update-prompt-title');
    card.setAttribute('aria-describedby', 'update-prompt-body');

    const title = el('div', 'update-prompt-title');
    title.id = 'update-prompt-title';
    title.textContent = 'New version available';

    const body = el('div', 'update-prompt-body');
    body.id = 'update-prompt-body';
    body.textContent = 'A newer LiftLog deploy is live. Refresh now to load it?';

    const meta = el('div', 'update-prompt-meta');
    meta.textContent = `Current: ${currentDeployVersion() || 'local'} · Latest: ${version}`;

    const actions = el('div', 'update-prompt-actions');
    const laterBtn = el('button', 'update-prompt-btn secondary');
    laterBtn.textContent = 'Later';
    laterBtn.addEventListener('click', () => {
      dismissedUpdateVersion = version;
      sessionStorage.setItem(UPDATE_PROMPT_STATE_KEY, version);
      removeUpdatePrompt();
    });

    const refreshBtn = el('button', 'update-prompt-btn primary');
    refreshBtn.textContent = 'Refresh now';
    refreshBtn.addEventListener('click', () => {
      sessionStorage.removeItem(UPDATE_PROMPT_STATE_KEY);
      removeUpdatePrompt();
      window.location.reload();
    });

    actions.appendChild(laterBtn);
    actions.appendChild(refreshBtn);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(meta);
    card.appendChild(actions);
    backdrop.appendChild(card);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) laterBtn.click();
    });
    document.body.appendChild(backdrop);
  }

  async function checkForDeployUpdate() {
    const current = currentDeployVersion();
    if (!current || updateCheckInFlight) return;

    updateCheckInFlight = true;
    try {
      const response = await fetch(liveDeployVersionUrl(), { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      const live = typeof payload === 'string' ? payload : payload?.version;
      if (!live || !DEPLOY_VERSION_RE.test(live)) return;
      if (dismissedUpdateVersion === live) return;
      if (compareDeployVersions(live, current) > 0) {
        showUpdatePrompt(live);
      }
    } catch {
      // Ignore version-check failures; the page should still work normally.
    } finally {
      updateCheckInFlight = false;
    }
  }

  function focusTimerScale() {
    if (!timer.running) return 1;
    if (timer.duration <= 0) return 1;
    const progress = Math.max(0, Math.min(1, timer.remaining / timer.duration));
    return 1 + (2 * progress);
  }

  function focusOverlay() {
    return document.getElementById('focus-overlay');
  }

  function setFocusBlink(active) {
    const overlay = focusOverlay();
    if (!overlay) return;
    if (active) {
      overlay.classList.remove('timer-complete-blink');
      // Restart the animation each time the timer finishes.
      void overlay.offsetWidth;
      overlay.classList.add('timer-complete-blink');
      setTimeout(() => {
        overlay.classList.remove('timer-complete-blink');
      }, 1200);
    } else {
      overlay.classList.remove('timer-complete-blink');
    }
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
        setFocusBlink(true);
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
      inlineWrap.style.setProperty('--focus-height', `${Math.round(64 * focusTimerScale())}px`);
      inlineWrap.dataset.timerState = state;
    }
    if (state === 'idle') {
      setFocusBlink(false);
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

  function buildSetRows(exercise, onLastSetFilled, onRepEntered) {
    const rows = [];
    for (let i = 0; i < exercise.sets; i++) {
      const row = el('div', 'set-row');
      const lastSet = exercise.last && exercise.last[i];
      const lastWeight = parseKg(lastSet && lastSet.weight);
      const lastReps = parseKg(lastSet && lastSet.reps);

      const label = el('div', 'set-label');
      label.textContent = `Set ${i + 1}`;

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

      const delta = el('div', 'set-delta');

      const onChange = () => {
        const previousR = rInput.dataset.previousValue ?? savedR;
        const w = wInput.value.trim();
        const r = rInput.value.trim();
        const firstSetJustStarted = i === 0 && previousR === '' && r !== '';
        saveField(activeSession.name, exercise.name, i, 'weight', w);
        saveField(activeSession.name, exercise.name, i, 'reps', r);
        wInput.classList.toggle('filled', w !== '');
        rInput.classList.toggle('filled', r !== '');
        updateSetDelta(delta, w, r, lastWeight, lastReps);
        rInput.dataset.previousValue = r;
        if (previousR === '' && r !== '' && typeof onRepEntered === 'function') onRepEntered();
        if (firstSetJustStarted) {
          warmupExerciseName = null;
          document.querySelectorAll('.warmup-panel').forEach(panel => panel.remove());
        } else if (i === 0) {
          refreshWarmupPanel(exercise);
        }
        updateBreadcrumb(exercise.name);
        if (i === exercise.sets - 1 && r !== '') onLastSetFilled();
      };

      wInput.addEventListener('input', onChange);
      rInput.addEventListener('input', onChange);
      rInput.dataset.previousValue = savedR;
      updateSetDelta(delta, savedW, savedR, lastWeight, lastReps);

      row.appendChild(label);
      row.appendChild(wInput);
      row.appendChild(mid);
      row.appendChild(rInput);
      row.appendChild(delta);
      rows.push(row);
    }
    return rows;
  }

  function closeSummary() {
    document.getElementById('session-summary-overlay')?.remove();
  }

  function openSessionSummary() {
    closeSummary();

    const overlay = el('div', 'summary-backdrop');
    overlay.id = 'session-summary-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSummary();
    });

    const card = el('div', 'summary-card');
    const header = el('div', 'summary-header');
    const titleWrap = el('div', 'summary-title-wrap');
    const eyebrow = el('div', 'summary-eyebrow');
    eyebrow.textContent = 'Workout complete';
    const title = el('div', 'summary-title');
    title.textContent = activeSession.name;
    titleWrap.appendChild(eyebrow);
    titleWrap.appendChild(title);

    const closeBtn = el('button', 'summary-close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeSummary);
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);
    card.appendChild(header);

    const completedExercises = activeSession.exercises.filter(ex => exerciseState(activeSession, ex) === 'complete').length;
    const totalExercises = activeSession.exercises.length;
    const loggedSets = totalLoggedSets(activeSession);
    const totalSets = activeSession.exercises.reduce((sum, ex) => sum + ex.sets, 0);
    const nextSession = nextSessionAfter(activeSession);

    const stats = el('div', 'summary-stats');
    [
      [`Exercises`, `${completedExercises} / ${totalExercises}`],
      [`Sets logged`, `${loggedSets} / ${totalSets}`],
      [`Next session`, nextSession ? nextSession.name : 'None'],
    ].forEach(([label, value]) => {
      const row = el('div', 'summary-stat');
      const statLabel = el('div', 'summary-stat-label');
      statLabel.textContent = label;
      const statValue = el('div', 'summary-stat-value');
      statValue.textContent = value;
      row.appendChild(statLabel);
      row.appendChild(statValue);
      stats.appendChild(row);
    });
    card.appendChild(stats);

    if (nextSession) {
      const note = el('div', 'summary-note');
      note.textContent = nextSession === activeSession
        ? 'This routine is still the oldest session in the rotation.'
        : `Up next: ${nextSession.name}.`;
      card.appendChild(note);
    }

    const actions = el('div', 'summary-actions');
    const backBtn = el('button', 'summary-action summary-action-primary');
    backBtn.textContent = 'Resume workout';
    backBtn.addEventListener('click', closeSummary);
    actions.appendChild(backBtn);
    card.appendChild(actions);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function renderWarmupPanel(exercise) {
    const plan = warmupPlanForExercise(exercise);
    if (!plan) return null;

    const panel = el('div', 'warmup-panel');
    const head = el('div', 'warmup-head');
    const label = el('div', 'warmup-label');
    label.textContent = 'Warm-up';
    const hint = el('div', 'warmup-hint');
    hint.textContent = `From ${fmtKg(workingWeightForExercise(exercise))}kg`;
    head.appendChild(label);
    head.appendChild(hint);
    panel.appendChild(head);

    const rows = el('div', 'warmup-rows');
    plan.forEach((step, index) => {
      const item = el('div', 'warmup-step');
      const stepLabel = el('div', 'warmup-step-label');
      stepLabel.textContent = `Set ${index + 1}`;
      const stepPct = el('div', 'warmup-step-pct');
      stepPct.textContent = `${step.label}`;
      const stepWeight = el('div', 'warmup-step-weight');
      stepWeight.textContent = `${fmtKg(step.weight)}kg`;
      item.appendChild(stepLabel);
      item.appendChild(stepPct);
      item.appendChild(stepWeight);
      rows.appendChild(item);
    });
    panel.appendChild(rows);
    return panel;
  }

  function refreshWarmupPanel(exercise) {
    const panels = Array.from(document.querySelectorAll('.warmup-panel'));
    if (panels.length === 0) return;
    panels.forEach(panel => {
      const nextPanel = renderWarmupPanel(exercise);
      if (!nextPanel) {
        panel.remove();
        return;
      }
      panel.replaceWith(nextPanel);
    });
  }

  // ── Main render ──────────────────────────────────────────────────────────

  function render() {
    const app = document.getElementById('app');
    app.innerHTML = '';

    // Remove any stale floating timer
    document.querySelectorAll('.rest-timer').forEach(t => t.remove());

    if (!activeSession) activeSession = oldestSession(data.sessions);
    if (!activeSession) return;
    if (activeExIdx >= activeSession.exercises.length) activeExIdx = 0;
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
        warmupExerciseName = null;
        saveViewState();
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
      crumb.addEventListener('click', () => { activeExIdx = idx; warmupExerciseName = null; saveViewState(); render(); });
      bc.appendChild(crumb);
    });
    app.appendChild(bc);

    // Nav bar: ‹  1/7  ›  [⛶ Focus]
    const nav = el('div', 'exercise-nav');

    const prevBtn = el('button', 'nav-btn');
    prevBtn.textContent = '‹';
    prevBtn.disabled = activeExIdx === 0;
    prevBtn.addEventListener('click', () => {
      if (activeExIdx > 0) {
        activeExIdx--;
        warmupExerciseName = null;
        saveViewState();
        render();
      }
    });

    const counter = el('div', 'nav-counter');
    counter.textContent = `${activeExIdx + 1} / ${activeSession.exercises.length}`;

    const nextBtn = el('button', 'nav-btn');
    nextBtn.textContent = '›';
    nextBtn.disabled = activeExIdx === activeSession.exercises.length - 1;
    nextBtn.addEventListener('click', () => {
      if (activeExIdx < activeSession.exercises.length - 1) {
        activeExIdx++;
        warmupExerciseName = null;
        saveViewState();
        render();
      }
    });

    const focusToggle = el('button', 'nav-focus-btn' + (focusMode ? ' active' : ''));
    focusToggle.innerHTML = '⛶ Focus';
    focusToggle.addEventListener('click', () => {
      focusMode = true;
      saveViewState();
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
    const started = workoutHasStarted();

    const exHeader = el('div', 'exercise-header');
    const left = el('div', 'exercise-header-left');
    left.innerHTML = `<div class="exercise-name">${exercise.name}</div>
      <div class="exercise-meta">${exercise.sets} sets · ${exercise.repsPerSet} reps target</div>`;

    const actions = el('div', 'exercise-header-actions');
    const warmupBtn = el('button', 'icon-btn');
    warmupBtn.textContent = 'WU';
    warmupBtn.title = 'Warm-up builder';
    warmupBtn.addEventListener('click', () => {
      warmupExerciseName = warmupExerciseName === exercise.name ? null : exercise.name;
      render();
    });

    const histBtn = el('button', 'icon-btn');
    histBtn.textContent = '📋';
    histBtn.title = 'History';
    histBtn.addEventListener('click', () => openHistory(exercise.name));

    actions.appendChild(warmupBtn);
    actions.appendChild(histBtn);
    exHeader.appendChild(left);
    exHeader.appendChild(actions);
    card.appendChild(exHeader);

    if (!started && warmupExerciseName === exercise.name) {
      const warmupPanel = renderWarmupPanel(exercise);
      if (warmupPanel) card.appendChild(warmupPanel);
    }

    const grid = el('div', 'sets-grid');
    buildSetRows(
      exercise,
      () => timerStart(activeSession.targetRestSeconds || 90),
      () => timerStart(activeSession.targetRestSeconds || 90)
    )
      .forEach(row => grid.appendChild(row));
    card.appendChild(grid);
    area.appendChild(card);
    app.appendChild(area);

    setupSwipe(area);

    // Floating timer (bottom-right)
    const timerEl = el('div', 'rest-timer');
    timerEl.appendChild(buildTimerWidget());
    document.body.appendChild(timerEl);

    saveViewState();
  }

  // ── Focus mode ──────────────────────────────────────────────────────────

  function renderFocus() {
    // Remove existing focus overlay if any
    const existing = document.getElementById('focus-overlay');
    if (existing) existing.remove();

    const exercise = activeSession.exercises[activeExIdx];
    const overlay = el('div', 'focus-overlay');
    overlay.id = 'focus-overlay';

    // Top bar: detail exit + progress
    const topBar = el('div', 'focus-top-bar');

    const backBtn = el('button', 'focus-back');
    backBtn.innerHTML = '← Detail mode';
    backBtn.title = 'Exit focus mode';
    backBtn.addEventListener('click', () => {
      focusMode = false;
      saveViewState();
      overlay.remove();
      render();
    });

    const focusCounter = el('div', 'nav-counter');
    focusCounter.style.flex = '1';
    focusCounter.style.textAlign = 'center';
    focusCounter.textContent = `${activeExIdx + 1} / ${activeSession.exercises.length}`;

    // Full-width timer action stays above the focus header while the workout scrolls.
    const timerWrap = el('div', 'focus-timer-inline');
    const state = timerStateClass();
    if (state !== 'idle') timerWrap.classList.add(state);

    const timerText = el('button', 'focus-timer-text');
    timerText.type = 'button';
    timerText.textContent = timerDisplayText(state);
    timerText.title = 'Start or stop rest timer';
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

    overlay.appendChild(timerWrap);
    topBar.appendChild(backBtn);
    topBar.appendChild(focusCounter);
    overlay.appendChild(topBar);

    // Body
    const body = el('div', 'focus-body');
    const started = workoutHasStarted();

    const nameDiv = el('div', 'focus-name');
    nameDiv.textContent = exercise.name;
    body.appendChild(nameDiv);

    const targetDiv = el('div', 'focus-target');
    targetDiv.textContent = `${exercise.sets} sets · ${exercise.repsPerSet} reps target`;
    body.appendChild(targetDiv);

    const focusWarmup = !started ? renderWarmupPanel(exercise) : null;
    if (focusWarmup) body.appendChild(focusWarmup);

    const setsWrap = el('div', 'focus-sets');
    buildSetRows(
      exercise,
      () => timerStart(activeSession.targetRestSeconds || 90),
      () => timerStart(activeSession.targetRestSeconds || 90)
    )
      .forEach(row => {
        row.classList.add('focus-set-row');
        setsWrap.appendChild(row);
      });
    body.appendChild(setsWrap);
    overlay.appendChild(body);

    // Footer: prev / next
    const footer = el('div', 'focus-footer');

    const prevBtn = el('button', 'focus-nav-btn');
    prevBtn.textContent = '‹ Previous';
    prevBtn.disabled = activeExIdx === 0;
    prevBtn.addEventListener('click', () => {
      activeExIdx--;
      warmupExerciseName = null;
      saveViewState();
      renderFocus();
    });

    const isLast = activeExIdx === activeSession.exercises.length - 1;
    const nextBtn = el('button', 'focus-next-btn');
    nextBtn.textContent = isLast ? 'Done ✓' : 'Next →';
    nextBtn.addEventListener('click', () => {
      if (isLast) {
        focusMode = false;
        saveViewState();
        overlay.remove();
        render();
        openSessionSummary();
        return;
      }
      activeExIdx++;
      warmupExerciseName = null;
      saveViewState();
      renderFocus();
    });

    footer.appendChild(prevBtn);
    footer.appendChild(nextBtn);
    overlay.appendChild(footer);

    document.body.appendChild(overlay);
    updateAllTimers(timerStateClass());
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
      if (dx < 0 && activeExIdx < activeSession.exercises.length - 1) {
        activeExIdx++;
        warmupExerciseName = null;
        saveViewState();
        render();
      } else if (dx > 0 && activeExIdx > 0) {
        activeExIdx--;
        warmupExerciseName = null;
        saveViewState();
        render();
      }
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
    warmupExerciseName = null;
    saveViewState();
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
      const savedState = readUiState();
      activePhaseName = savedState?.phaseName || data.name;
      // Merge live data into phasesData so the selector includes the loaded phase with real lastDates
      if (phasesData) {
        phasesData[data.name] = data.sessions;
      }
      if (phasesData && activePhaseName !== data.name && phasesData[activePhaseName]) {
        data = {
          name: activePhaseName,
          backupDate: data.backupDate,
          sessions: phasesData[activePhaseName],
        };
      } else {
        activePhaseName = data.name;
      }
      migrateLegacyFields(activePhaseName, data.sessions);
      activeSession = sessionByName(savedState?.sessionName) || oldestSession(data.sessions);
      activeExIdx = exerciseIndexByName(activeSession, savedState?.exerciseName) || 0;
      focusMode = savedState?.focusMode === true;
      render();
      if (focusMode) renderFocus();
      void checkForDeployUpdate();
      setInterval(() => { void checkForDeployUpdate(); }, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void checkForDeployUpdate();
      });
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
