(function () {
  const data = window.WORKOUT_DATA;
  const insights = window.PHASE4_INSIGHTS;
  const storageKey = "liftlog-hardcopy-spike:v1";

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Ignore bad local state in the spike.
    }
    return { drafts: {}, notes: {}, timer: { duration: 90, remaining: 90, running: false, startedAt: null } };
  }

  function setState(next) {
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  function readDraftKey(sessionName, exerciseName) {
    return `${sessionName}::${exerciseName}`;
  }

  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  }

  function formatSigned(value, suffix = "") {
    const n = Number(value);
    const sign = n > 0 ? "+" : "";
    return `${sign}${formatNumber(n)}${suffix}`;
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function formatShortDate(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
    }).format(date);
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function getSession(name) {
    return data.sessions.find((session) => session.name === name) || data.sessions[0];
  }

  function getSessionMeta(name) {
    return insights.sessionSplit.find((session) => session.name === name) || null;
  }

  function getTrend(sessionName, exerciseName) {
    return insights.trendCards.find(
      (item) => item.session === sessionName && item.exercise === exerciseName
    ) || null;
  }

  function getExerciseDraft(sessionName, exerciseName) {
    const state = getState();
    return state.drafts?.[readDraftKey(sessionName, exerciseName)] || null;
  }

  function setExerciseDraft(sessionName, exerciseName, reps) {
    const state = getState();
    state.drafts ||= {};
    state.drafts[readDraftKey(sessionName, exerciseName)] = { reps };
    setState(state);
  }

  function getSessionNote(sessionName) {
    const state = getState();
    return state.notes?.[sessionName] || "";
  }

  function setSessionNote(sessionName, note) {
    const state = getState();
    state.notes ||= {};
    state.notes[sessionName] = note;
    setState(state);
  }

  function renderSessionTabs(activeSessionName) {
    return data.sessions
      .map((session) => {
        const meta = getSessionMeta(session.name);
        const active = session.name === activeSessionName ? " is-active" : "";
        return `
          <button type="button" class="session-tab${active}" data-session-tab="${escapeHtml(session.name)}">
            <span>${escapeHtml(session.name)}</span>
            <strong>${meta ? `${meta.count} runs` : ""}</strong>
            <small>${formatShortDate(session.lastDate)}</small>
          </button>
        `;
      })
      .join("");
  }

  function renderMonthlyChart(items, options = {}) {
    const max = Math.max(...items.map((item) => item.count), 1);
    const label = options.label || "Sessions";
    return `
      <div class="bar-chart" role="img" aria-label="${escapeHtml(label)} chart">
        ${items
          .map((item) => {
            const height = Math.max(8, Math.round((item.count / max) * 100));
            const zero = item.count === 0 ? " is-zero" : "";
            const active = options.highlight?.includes(item.month) ? " is-highlight" : "";
            return `
              <div class="bar-group${zero}${active}" title="${escapeHtml(item.month)}: ${item.count}">
                <div class="bar-wrap">
                  <div class="bar" style="height:${height}%"></div>
                </div>
                <div class="bar-meta">
                  <span>${escapeHtml(item.month.slice(5))}</span>
                  <strong>${item.count}</strong>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderTrendCards(items, options = {}) {
    const sorted = [...items].sort((a, b) => {
      const metric = options.metric || "deltaVolume";
      return (Number(b[metric]) || 0) - (Number(a[metric]) || 0);
    });
    const max = Math.max(
      1,
      ...sorted.map((item) => Math.max(Math.abs(Number(item.deltaVolume) || 0), Math.abs(Number(item.deltaBestWeight) || 0)))
    );
    return `
      <div class="trend-grid">
        ${sorted
          .map((item) => {
            const directionClass = `is-${item.direction || "mixed"}`;
            const metricWidth = Math.round((Math.max(Math.abs(item.deltaVolume), Math.abs(item.deltaBestWeight)) / max) * 100);
            return `
              <article class="trend-card ${directionClass}">
                <div class="trend-card__head">
                  <span class="trend-pill">${escapeHtml(item.session)}</span>
                  <strong>${escapeHtml(item.exercise)}</strong>
                </div>
                <div class="trend-card__stats">
                  <span>${formatSigned(item.deltaBestWeight, " kg")} top set</span>
                  <span>${formatSigned(item.deltaVolume)} volume</span>
                </div>
                <div class="trend-card__bar">
                  <span style="width:${Math.max(10, metricWidth)}%"></span>
                </div>
                <p>${escapeHtml(item.note)}</p>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderSessionSummary(sessionName) {
    const session = getSession(sessionName);
    const meta = getSessionMeta(sessionName);
    const note = getSessionNote(sessionName);
    return `
      <section class="session-summary">
        <div class="session-summary__top">
          <div>
            <p class="eyebrow">Current routine</p>
            <h2>${escapeHtml(session.name)}</h2>
          </div>
          <div class="session-summary__meta">
            <span>${session.exercises.length} exercises</span>
            <span>${session.targetRestSeconds}s rest target</span>
            <span>Last logged ${formatDate(session.lastDate)}</span>
            ${meta ? `<span>${meta.count} runs in Phase 4</span>` : ""}
          </div>
        </div>
        <label class="session-note">
          <span>Local note</span>
          <textarea rows="2" data-session-note="${escapeHtml(session.name)}" placeholder="Write a quick local note for this workout.">${escapeHtml(note)}</textarea>
        </label>
        <div class="exercise-grid">
          ${session.exercises
            .map((exercise, index) => {
              const trend = getTrend(session.name, exercise.name);
              const stored = getExerciseDraft(session.name, exercise.name);
              const reps = (stored?.reps || exercise.last.map((set) => set.reps)).map((value) => String(value));
              return `
                <article class="exercise-card ${trend?.direction ? `is-${trend.direction}` : ""}" data-exercise-card>
                  <div class="exercise-card__head">
                    <div>
                      <p class="exercise-index">Set ${index + 1}</p>
                      <h3>${escapeHtml(exercise.name)}</h3>
                    </div>
                    <span class="exercise-trend">${trend ? `${formatSigned(trend.deltaBestWeight, " kg")}` : `${exercise.sets} sets`}</span>
                  </div>
                  <div class="exercise-card__meta">
                    <span>${exercise.sets} sets</span>
                    <span>${exercise.repsPerSet} reps target</span>
                    <span>${formatDuration(session.targetRestSeconds)} rest</span>
                  </div>
                  <div class="set-strip">
                    ${exercise.last
                      .map((set, setIndex) => `
                        <div class="set-chip">
                          <span>Last ${setIndex + 1}</span>
                          <strong>${formatNumber(set.weight)} kg</strong>
                          <small>${formatNumber(set.reps)} reps</small>
                        </div>
                      `)
                      .join("")}
                  </div>
                  <div class="rep-editor" data-exercise-key="${escapeHtml(session.name)}::${escapeHtml(exercise.name)}">
                    ${reps
                      .map((value, setIndex) => `
                        <label>
                          <span>Set ${setIndex + 1}</span>
                          <input type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(value)}" data-set-index="${setIndex}" />
                        </label>
                      `)
                      .join("")}
                  </div>
                  <p class="exercise-note">${escapeHtml(
                    trend?.note || "Local reps stay in the browser only."
                  )}</p>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function bindLocalEditors(root) {
    root.querySelectorAll("[data-session-note]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        setSessionNote(textarea.dataset.sessionNote, textarea.value);
      });
    });

    root.querySelectorAll("[data-exercise-key]").forEach((card) => {
      const [sessionName, ...rest] = card.dataset.exerciseKey.split("::");
      const exerciseName = rest.join("::");
      const inputs = [...card.querySelectorAll("input[data-set-index]")];
      inputs.forEach((input) => {
        input.addEventListener("input", () => {
          const state = getState();
          state.drafts ||= {};
          const key = readDraftKey(sessionName, exerciseName);
          const current = state.drafts[key]?.reps || [];
          current[Number(input.dataset.setIndex)] = input.value;
          state.drafts[key] = { reps: current };
          setState(state);
        });
      });
    });
  }

  function mountTimer(root) {
    const state = getState();
    let timerState = state.timer || { duration: 90, remaining: 90, running: false, startedAt: null };
    let tickId = null;

    function commit(next) {
      const current = getState();
      timerState = { ...timerState, ...next };
      current.timer = timerState;
      setState(current);
      render();
    }

    function syncFromRunning() {
      if (!timerState.running || !timerState.startedAt) return;
      const elapsed = Math.floor((Date.now() - new Date(timerState.startedAt).getTime()) / 1000);
      const remaining = Math.max(0, timerState.duration - elapsed);
      if (remaining !== timerState.remaining) {
        timerState.remaining = remaining;
        const current = getState();
        current.timer = timerState;
        setState(current);
      }
      if (remaining === 0) {
        timerState.running = false;
        timerState.startedAt = null;
        const current = getState();
        current.timer = timerState;
        setState(current);
      }
    }

    function render() {
      syncFromRunning();
      const progress = Math.max(0, Math.min(1, timerState.remaining / Math.max(1, timerState.duration)));
      const stroke = 226;
      const dash = Math.round(stroke * progress);
      const gap = stroke - dash;
      root.innerHTML = `
        <div class="rest-timer">
          <div class="rest-timer__ring" aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <circle class="ring-track" cx="50" cy="50" r="36"></circle>
              <circle class="ring-progress" cx="50" cy="50" r="36" style="stroke-dasharray:${dash} ${gap};"></circle>
            </svg>
          </div>
          <div class="rest-timer__body">
            <p class="eyebrow">Rest timer</p>
            <strong>${formatDuration(timerState.remaining)}</strong>
            <span>${timerState.running ? "running" : "ready"}</span>
          </div>
          <div class="rest-timer__controls">
            <button type="button" data-timer-preset="60">60s</button>
            <button type="button" data-timer-preset="90">90s</button>
            <button type="button" data-timer-preset="120">120s</button>
            <button type="button" data-timer-action="toggle">${timerState.running ? "Pause" : "Start"}</button>
            <button type="button" data-timer-action="reset">Reset</button>
          </div>
        </div>
      `;
    }

    function startTicker() {
      stopTicker();
      tickId = setInterval(() => {
        if (!timerState.running) return;
        syncFromRunning();
        render();
      }, 1000);
    }

    function stopTicker() {
      if (tickId) clearInterval(tickId);
      tickId = null;
    }

    root.addEventListener("click", (event) => {
      const preset = event.target.closest("[data-timer-preset]");
      const action = event.target.closest("[data-timer-action]");
      if (preset) {
        const duration = Number(preset.dataset.timerPreset);
        commit({ duration, remaining: duration, running: false, startedAt: null });
        return;
      }
      if (action?.dataset.timerAction === "toggle") {
        if (timerState.running) {
          syncFromRunning();
          commit({ running: false, startedAt: null });
        } else {
          commit({
            running: true,
            startedAt: new Date().toISOString(),
            remaining: timerState.remaining || timerState.duration,
          });
        }
        return;
      }
      if (action?.dataset.timerAction === "reset") {
        commit({ remaining: timerState.duration, running: false, startedAt: null });
      }
    });

    render();
    startTicker();
    return () => stopTicker();
  }

  window.LiftLog = {
    data,
    insights,
    escapeHtml,
    formatNumber,
    formatSigned,
    formatDate,
    formatShortDate,
    formatDuration,
    getSession,
    getTrend,
    renderSessionTabs,
    renderMonthlyChart,
    renderTrendCards,
    renderSessionSummary,
    bindLocalEditors,
    mountTimer,
  };
})();
