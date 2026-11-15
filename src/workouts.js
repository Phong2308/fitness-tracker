"use strict";

// workouts — extracted from the working app; public function names preserved.
const WORKOUT_TYPES = {
  swimming: "🏊 Bơi",
  cycling: "🚴 Đạp xe",
  running: "🏃 Chạy bộ",
  walking: "🚶 Đi bộ",
  calisthenics: "💪 Workout"
};
function resolveWorkoutType(item) {
  if (item.workoutId || item.personalWorkoutId) return 'calisthenics';
  const raw = normalizeText(item.type || item.activity || "").replace(/đ/g, "d");
  if (/calisthenics/.test(raw)) return "calisthenics";
  if (/boi|swim/.test(raw)) return "swimming";
  if (/dap xe|cycling|cycle/.test(raw)) return "cycling";
  if (/chay|running|run/.test(raw)) return "running";
  if (/di bo|walking|walk/.test(raw)) return "walking";
  return null;
}
function isPlannedWorkoutComplete(item, today) {
  const type = resolveWorkoutType(item);
  return Boolean(type && ownsCurrentUser(today) && today.date === getDateKey() && (today.workoutEntries || []).some(entry => entry.type === type && entry.completed === true && (item.planKey ? entry.planKey === item.planKey : item.workoutId ? entry.workoutId === item.workoutId : true)));
}
function validateLibrary(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Workout Library chưa có bài tập Calisthenics.");
  const seen = new Set();
  return rows.map(row => {
    const round = Number(row.round),
      order = Number(row.order);
    if (normalizeText(row.workout) !== "calisthenics" || !Number.isInteger(round) || round < 1 || !Number.isInteger(order) || order < 1 || !String(row.exercise || "").trim()) throw new Error("Workout Library có dòng không hợp lệ.");
    const key = round + ":" + order;
    if (seen.has(key)) throw new Error("Workout Library bị trùng Vòng/Thứ tự.");
    seen.add(key);
    return {
      ...row,
      round,
      order,
      key
    };
  }).sort((a, b) => a.round - b.round || a.order - b.order);
}
async function loadSessionExercises(item) {
  const id = item.workoutId || item.personalWorkoutId;
  if (id) {
    const userId = getCurrentUserId();
    if ((item.userId || item.personalUserId) !== userId) throw new Error("Bài tập không thuộc nhân vật hiện tại.");
    const result = await personalWorkoutRequest({
      action: 'getPersonalWorkouts',
      userId
    });
    if (result.userId !== userId) throw new Error("Thư viện trả về sai nhân vật.");
    const own = result.data.find(w => w.id === id);
    if (!own) throw new Error("Không tìm thấy bài tập riêng.");
    item.activity = own.name;
    item.workoutId = id;
    item.personalWorkoutId = id;
    item.restSeconds = own.restSeconds;
    return {
      rows: expandLibraryForPlan(own.rows, item.target),
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(WEB_APP_URL + "?action=getWorkoutLibrary&workout=Calisthenics&_=" + Date.now(), {
      cache: "no-store",
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Không tải được Workout Library.");
    return {
      rows: item.target ? expandLibraryForPlan(result.data, item.target) : validateLibrary(result.data),
    };
  } catch (error) {
    console.error("Workout Library chưa sẵn sàng:", error);
    throw new Error("Không tải được Workout Library. Hãy kiểm tra API thư viện; không thay bằng bài cố định.");
  } finally {
    clearTimeout(timer);
  }
}
function expandLibraryForPlan(rows, target) {
  const match = String(target || '').trim().match(/^(\d+)\s*vòng$/i);
  const count = match ? Number(match[1]) : 0;
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Weekly Plan cần Mục tiêu dạng “3 vòng” (1–100 vòng).');
  const first = Math.min(...rows.map(r => Number(r.round) || 1));
  const base = rows.filter(r => (Number(r.round) || 1) === first).sort((a, b) => Number(a.order) - Number(b.order));
  return validateLibrary(Array.from({
    length: count
  }, (_, i) => base.map((r, j) => ({
    ...r,
    round: i + 1,
    order: j + 1
  }))).flat());
}
function renderRoundWorkout(app, item, rows, active) {
  let closeExerciseClock = null;
  const sound = createWorkoutSound();
  let exerciseRestStarted = null;
  let exerciseRestDuration = null;
  let exerciseRestSource = null;
  let exerciseRestTimer = null;
  let automatic = false;
  const exerciseDurations = {};
  const rounds = [...new Set(rows.map(row => row.round))];
  const checked = new Set();
  const started = Date.now();
  let index = 0,
    restSeconds = item.personalWorkoutId ? item.restSeconds : 60,
    timer = null,
    saved = false,
    resting = false;
  const stop = () => {
    if (closeExerciseClock) { closeExerciseClock(); closeExerciseClock = null; }
    if (timer !== null) clearTimeout(timer);
    if (exerciseRestTimer !== null) clearTimeout(exerciseRestTimer);
    timer = null;
    exerciseRestTimer = null;
    exerciseRestStarted = null;
    sound.close();
  };
  app.stopWorkoutTimer = stop;
  function render() {
    if (closeExerciseClock) { closeExerciseClock(); closeExerciseClock = null; }
    if (!active()) {
      stop();
      return;
    }
    if (exerciseRestTimer !== null) clearTimeout(exerciseRestTimer);
    exerciseRestTimer = null;
    const current = rows.filter(row => row.round === rounds[index]);
    app.innerHTML = `<section class="card"><h2>${htmlText(item.activity || "Calisthenics")}</h2><p>Mục tiêu: ${htmlText(item.duration || "")} · ${htmlText(item.target || rounds.length + " vòng")}</p><p>Workout Library</p>
        <div class="progress-bar" role="progressbar" aria-label="Tiến độ bài tập" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(checked.size / rows.length * 100)}"><div style="height:100%;background:#111827;width:${checked.size / rows.length * 100}%"></div></div><p>${checked.size}/${rows.length} bài hoàn thành</p>
        <h3>Vòng ${index + 1} / ${rounds.length}</h3>
        <label class="auto-workout"><input id="automaticWorkout" type="checkbox" ${automatic ? 'checked' : ''}> Tự động chuyển động tác</label>
        <label class="auto-workout"><input id="soundWorkout" type="checkbox" ${sound.enabled ? 'checked' : ''}> Âm báo đếm giờ</label>
        <div id="automaticDurations" ${automatic ? '' : 'hidden'}>${[...new Map(rows.filter(row => parseExerciseClock(row.repsTime)?.mode !== 'down').map(row => [row.exercise, row])).values()].map(row => `<label class="auto-duration">${htmlText(row.exercise)} · giây <input type="number" min="1" step="1" inputmode="numeric" data-duration-exercise="${htmlText(row.exercise)}" value="${exerciseDurations[row.exercise] || ''}"></label>`).join('')}</div>
        <label>Nghỉ giữa các vòng (giây)<input id="roundRestSeconds" type="number" min="0" max="3600" step="1" value="${restSeconds}" style="width:100px;margin:8px;padding:8px"></label>
        <dialog id="exerciseRestDialog" class="rest-dialog" aria-labelledby="restTitle"><h2 id="restTitle">Thời gian nghỉ</h2><p id="exerciseRestLabel"></p><div id="exerciseRestClock" role="timer"></div><p id="nextExerciseName"></p><label class="auto-workout"><input id="automaticRest" type="checkbox" ${automatic ? 'checked' : ''}> Tự động chuyển động tác</label><label class="auto-workout"><input id="soundRest" type="checkbox" ${sound.enabled ? 'checked' : ''}> Âm báo đếm giờ</label><label id="nextDurationLabel" class="auto-duration" hidden>Thời gian động tác (giây) <input id="nextDuration" type="number" min="1" step="1" inputmode="numeric"></label><p id="restError" role="alert"></p><button id="startNextExercise" type="button">▶ Bắt đầu động tác tiếp theo</button></dialog>
        <div id="roundExercises">${current.map(row => `<label style="display:flex;align-items:flex-start;gap:12px;padding:14px 0"><input type="checkbox" data-round-exercise="${row.key}" ${checked.has(row.key) ? "checked" : ""}><span><strong>${htmlText(row.exercise)}</strong><br>${htmlText(row.repsTime)}${row.rest ? " · Nghỉ " + htmlText(row.rest) : ""}${row.note ? "<br>" + htmlText(row.note) : ""}</span></label>`).join("")}</div>
        <div id="roundRestPanel" hidden><h3>Đã xong vòng ${index + 1} — nghỉ</h3><p id="roundCountdown" role="status"></p><button id="skipRoundRest" type="button">Bỏ qua nghỉ</button></div><p id="roundMessage" role="alert"></p><button id="exitRounds" type="button">Về Home</button></section>`;
    const input = document.getElementById("roundRestSeconds");
    const updateSound = enabled => {
      sound.setEnabled(enabled);
      document.getElementById('soundWorkout').checked = enabled;
      document.getElementById('soundRest').checked = enabled;
    };
    document.getElementById('soundWorkout').onchange = event => updateSound(event.target.checked);
    document.getElementById('soundRest').onchange = event => updateSound(event.target.checked);
    const updateAutomatic = enabled => {
      automatic = enabled;
      document.getElementById('automaticWorkout').checked = enabled;
      document.getElementById('automaticRest').checked = enabled;
      document.getElementById('automaticDurations').hidden = !enabled;
      const nextLabel = document.getElementById('nextDurationLabel');
      if (nextLabel.dataset.required === 'true') nextLabel.hidden = !enabled;
      document.getElementById('restError').textContent = '';
    };
    app.querySelectorAll('[data-duration-exercise]').forEach(field => {
      field.oninput = () => { exerciseDurations[field.dataset.durationExercise] = field.value; };
    });
    document.getElementById('automaticWorkout').onchange = event => updateAutomatic(event.target.checked);
    document.getElementById('automaticRest').onchange = event => updateAutomatic(event.target.checked);
    if (exerciseRestStarted !== null) {
      let lastSoundSecond = null;
      const restClock = document.getElementById("exerciseRestClock");
      const restLabel = document.getElementById("exerciseRestLabel");
      const tickExerciseRest = () => {
        if (!active() || exerciseRestStarted === null) return;
        const elapsed = Math.floor(Math.max(0, Date.now() - exerciseRestStarted) / 1000);
        const remaining = exerciseRestDuration === null ? null : Math.max(0, exerciseRestDuration - elapsed);
        if (remaining !== null && remaining <= 5 && remaining !== lastSoundSecond) {
          sound.beep(remaining === 0);
          lastSoundSecond = remaining;
        }
        if (exerciseRestDuration === null) {
          restLabel.textContent = "Chưa đặt thời gian nghỉ";
          restClock.textContent = formatExerciseClock(elapsed);
        } else if (elapsed < exerciseRestDuration) {
          restLabel.textContent = "Nghỉ còn";
          restClock.textContent = formatExerciseClock(exerciseRestDuration - elapsed);
        } else {
          restLabel.textContent = "Nghỉ thêm";
          restClock.textContent = "+" + formatExerciseClock(elapsed - exerciseRestDuration);
          if (automatic && !document.getElementById('restError').textContent) {
            document.getElementById('startNextExercise').click();
            if (exerciseRestStarted === null) return;
          }
        }
        exerciseRestTimer = setTimeout(tickExerciseRest, 250);
      };
      exerciseRestTimer = setTimeout(tickExerciseRest, 0);
    }
    app.querySelectorAll('[data-round-exercise]').forEach(box => {
      const row = current.find(r => r.key === box.dataset.roundExercise);
      if (box.checked) return;
      const button = document.createElement('button');
      button.dataset.startExercise = row.key;
      button.type = 'button'; button.textContent = '▶ Bắt đầu';
      button.setAttribute('aria-label', 'Bắt đầu tính giờ ' + row.exercise);
      box.closest('label').after(button);
      button.onclick = () => {
        if (!active() || resting || saved) return;
        const duration = Number(exerciseDurations[row.exercise]);
        const timedRow = automatic && parseExerciseClock(row.repsTime)?.mode !== 'down' && Number.isInteger(duration) && duration > 0
          ? {...row, repsTime: duration + ' giây'} : row;
        if (automatic && parseExerciseClock(timedRow.repsTime)?.mode !== 'down') {
          const message = 'Nhập thời gian tính bằng giây cho ' + row.exercise + '.';
          document.getElementById('roundMessage').textContent = message;
          document.getElementById('restError').textContent = message;
          return;
        }
        if (closeExerciseClock) closeExerciseClock();
        if (exerciseRestStarted !== null) {
          try {
            const today = getTodayData();
            today.workoutRestEntries = [...(today.workoutRestEntries || []), {
              workoutId: item.workoutId || item.personalWorkoutId || '',
              workoutName: item.activity || 'Calisthenics',
              kind: exerciseRestSource.kind,
              round: exerciseRestSource.round,
              afterExercise: exerciseRestSource.exercise,
              nextExercise: row.exercise,
              plannedSeconds: exerciseRestDuration,
              actualSeconds: Math.max(0, (Date.now() - exerciseRestStarted) / 1000),
              startedAt: new Date(exerciseRestStarted).toISOString(),
              endedAt: new Date().toISOString()
            }];
            saveTodayData(today);
          } catch (error) {
            updateAutomatic(false);
            const message = 'Chưa lưu được thời gian nghỉ: ' + error.message;
            document.getElementById('roundMessage').textContent = message;
            document.getElementById('restError').textContent = message;
            return;
          }
        }
        exerciseRestStarted = null;
        if (exerciseRestTimer !== null) clearTimeout(exerciseRestTimer);
        exerciseRestTimer = null;
        const restDialog = document.getElementById("exerciseRestDialog");
        if (restDialog.open) restDialog.close();
        if (!parseExerciseClock(timedRow.repsTime)) return;
        closeExerciseClock = openExerciseClock(timedRow, active, () => {
          box.checked = true;
          box.onchange(); // Use the existing checklist/progress flow unchanged.
        }, button, () => automatic, updateAutomatic, sound, updateSound);
      };
    });
    if (exerciseRestStarted !== null) {
      const nextRow = current.find(row => !checked.has(row.key));
      const restDialog = document.getElementById('exerciseRestDialog');
      document.getElementById('nextExerciseName').textContent = nextRow.exercise;
      const nextDurationLabel = document.getElementById('nextDurationLabel');
      const nextDuration = document.getElementById('nextDuration');
      nextDurationLabel.dataset.required = String(parseExerciseClock(nextRow.repsTime)?.mode !== 'down');
      nextDurationLabel.hidden = !automatic || nextDurationLabel.dataset.required !== 'true';
      nextDuration.value = exerciseDurations[nextRow.exercise] || '';
      nextDuration.oninput = () => {
        exerciseDurations[nextRow.exercise] = nextDuration.value;
        document.getElementById('restError').textContent = '';
        const field = [...app.querySelectorAll('[data-duration-exercise]')].find(element => element.dataset.durationExercise === nextRow.exercise);
        if (field) field.value = nextDuration.value;
      };
      document.getElementById('startNextExercise').onclick = () => {
        const button = [...app.querySelectorAll('[data-start-exercise]')].find(element => element.dataset.startExercise === nextRow.key);
        if (button) button.click();
      };
      restDialog.addEventListener('cancel', event => event.preventDefault());
      restDialog.showModal();
    }
    input.onchange = () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isInteger(value) || value < 0 || value > 3600) {
        input.value = restSeconds;
        document.getElementById("roundMessage").textContent = "Nhập từ 0 đến 3600 giây.";
      } else {
        restSeconds = value;
        document.getElementById("roundMessage").textContent = "";
      }
    };
    document.getElementById("exitRounds").onclick = () => {
      stop();
      showHome();
    };
    app.querySelectorAll("[data-round-exercise]").forEach(box => box.onchange = () => {
      if (!active() || resting || saved) return;
      if (box.checked) checked.add(box.dataset.roundExercise);else checked.delete(box.dataset.roundExercise);
      if (!current.every(row => checked.has(row.key))) {
        if (box.checked) {
          exerciseRestStarted = Date.now();
          const completedRow = current.find(row => row.key === box.dataset.roundExercise);
          exerciseRestDuration = parseRestSeconds(completedRow.rest);
          exerciseRestSource = {kind: 'exercise', round: rounds[index], exercise: completedRow.exercise};
        } else exerciseRestStarted = null;
        render();
        return;
      }
      if (index === rounds.length - 1) {
        finish();
        return;
      }
      exerciseRestStarted = Date.now();
      exerciseRestDuration = restSeconds;
      exerciseRestSource = {kind: 'round', round: rounds[index], exercise: current.find(row => row.key === box.dataset.roundExercise).exercise};
      index++;
      render();
    });
  }
  function finish() {
    stop();
    if (!active() || saved) return;
    try {
      const minutes = Math.max(0.1, Math.round((Date.now() - started) / 6000) / 10);
      saveWorkoutEntry("calisthenics", minutes, rounds.length, (item.personalWorkoutId ? item.activity + ". " : "") + "Hoàn thành từng bài; thời gian bao gồm nghỉ giữa vòng.", item.target, item);
      saved = true;
      app.innerHTML = `<section class="card"><h2>✅ Hoàn thành bài tập</h2><p>${rounds.length} vòng · ${checked.size}/${rows.length} bài · ${minutes} phút (gồm thời gian nghỉ)</p><p>Đã lưu trên máy cho nhân vật hiện tại. Chưa đồng bộ Sheet.</p><button id="finishedHome" type="button">Về Home</button></section>`;
      document.getElementById("finishedHome").onclick = showHome;
    } catch (error) {
      document.getElementById("roundMessage").textContent = "Chưa lưu được: " + error.message;
    }
  }
  render();
}
function parseRestSeconds(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(s|giây|sec|seconds?|phút|min|minutes?)?$/);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  const seconds = amount * (/^(phút|min|minutes?)$/.test(match[2] || '') ? 60 : 1);
  return Number.isFinite(seconds) ? Math.ceil(seconds) : null;
}
function parseExerciseClock(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const reps = text.match(/^(\d+(?:[.,]\d+)?)\s*reps?\b/);
  if (reps && Number(reps[1].replace(',', '.')) > 0) return {mode:'up', seconds:0};
  const time = text.match(/^(\d+(?:[.,]\d+)?)\s*(s|giây|sec|seconds?|phút|min|minutes?)$/);
  if (!time) return null;
  const seconds = Number(time[1].replace(',', '.')) * (/^(phút|min|minutes?)$/.test(time[2]) ? 60 : 1);
  return Number.isFinite(seconds) && seconds > 0 ? {mode:'down', seconds} : null;
}
function exerciseClockSeconds(spec, elapsedMs) {
  return spec.mode === 'down' ? Math.max(0, Math.ceil(spec.seconds - elapsedMs / 1000)) : Math.floor(Math.max(0, elapsedMs) / 1000);
}
function formatExerciseClock(seconds) {
  return String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
}
function createWorkoutSound() {
  let context = null;
  const sound = {
    enabled: false,
    setEnabled(enabled) {
      sound.enabled = enabled;
      if (!enabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        context ||= new AudioContext();
        if (context.state === 'suspended') {
          context.resume().then(() => sound.beep(false)).catch(() => {});
        } else {
          sound.beep(false);
        }
      } catch (_) { /* Audio is optional when the browser cannot start it. */ }
    },
    beep(finished) {
      if (!sound.enabled || !context || context.state !== 'running') return;
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.frequency.value = finished ? 880 : 660;
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (finished ? 0.3 : 0.12));
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + (finished ? 0.3 : 0.12));
      } catch (_) { /* Keep the timer running if sound playback fails. */ }
    },
    close() {
      if (context && context.state !== 'closed') context.close().catch(() => {});
      context = null;
    }
  };
  return sound;
}
function openExerciseClock(row, active, complete, trigger, isAutomatic = () => false, setAutomatic = () => {}, sound = {enabled:false, beep() {}}, setSound = () => {}) {
  const spec = parseExerciseClock(row.repsTime);
  const dialog = document.createElement('dialog');
  dialog.className = 'exercise-clock';
  dialog.setAttribute('aria-label', 'Đồng hồ ' + row.exercise);
  dialog.innerHTML = `<button type="button" class="exercise-clock-close" aria-label="Đóng đồng hồ">×</button><h2>${htmlText(row.exercise)}</h2><div class="exercise-clock-number" role="timer" aria-label="Thời gian">00:00</div><p class="exercise-clock-end" role="status"></p><label class="auto-workout"><input type="checkbox" data-clock-auto ${isAutomatic() ? 'checked' : ''}> Tự động chuyển động tác</label><label class="auto-workout"><input type="checkbox" data-clock-sound ${sound.enabled ? 'checked' : ''}> Âm báo đếm giờ</label><div class="exercise-clock-actions"><button type="button" data-clock-pause>Tạm dừng</button><label><input type="checkbox" data-clock-complete> Hoàn thành</label></div>`;
  document.body.append(dialog);
  let timer=null, closed=false, paused=false, elapsed=0, started=Date.now();
  const close = () => {
    if (closed) return;
    closed=true; clearTimeout(timer); dialog.close(); dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  };
  dialog.querySelector('.exercise-clock-close').onclick = close;
  dialog.addEventListener('cancel', event => {event.preventDefault();close();});
  const autoControl = dialog.querySelector('[data-clock-auto]');
  if (autoControl) autoControl.onchange = event => setAutomatic(event.target.checked);
  const soundControl = dialog.querySelector('[data-clock-sound]');
  if (soundControl) soundControl.onchange = event => setSound(event.target.checked);
  dialog.querySelector('[data-clock-complete]').onchange = () => {
    if (!active()) {close();return;}
    close(); complete();
  };
  const pause=dialog.querySelector('[data-clock-pause]');
  pause.onclick = () => {
    if (!active()) {close();return;}
    if (!paused) elapsed += Date.now()-started; else started=Date.now();
    paused=!paused; pause.textContent=paused?'Tiếp tục':'Tạm dừng';
  };
  let lastSoundSecond = null;
  function tick() {
    if (closed) return;
    if (!active()) {close();return;}
    const seconds=exerciseClockSeconds(spec,elapsed+(paused?0:Date.now()-started));
    if (spec.mode === 'down' && !paused && seconds <= 5 && seconds !== lastSoundSecond) {
      sound.beep(seconds === 0);
      lastSoundSecond = seconds;
    }
    dialog.querySelector('[role="timer"]').textContent=formatExerciseClock(seconds);
    if(spec.mode==='down' && seconds===0){
      if (isAutomatic()) { close(); complete(); return; }
      dialog.querySelector('.exercise-clock-end').textContent='Hết giờ';
      pause.disabled=true; return; // Never auto-tick or advance a round.
    }
    timer=setTimeout(tick,200);
  }
  dialog.showModal(); tick();
  return close;
}
async function beginWorkout(item) {
  requireCurrentUser();
  const type = resolveWorkoutType(item);
  if (!type) {
    alert("Chưa hỗ trợ loại workout này.");
    return;
  }
  const user = CURRENT_USER,
    date = getDateKey(),
    app = document.querySelector(".app");
  if (app.stopWorkoutTimer) app.stopWorkoutTimer();
  const token = {};
  app.workoutToken = token;
  const active = () => CURRENT_USER === user && getDateKey() === date && app.workoutToken === token;
  let rows = [];
  app.innerHTML = '<section class="card"><p>Đang chuẩn bị bài tập…</p></section>';
  try {
    if (type === "calisthenics") {
      if (item.userId && !item.workoutId) throw new Error('Dòng Calisthenics trong Weekly Plan thiếu Workout ID ở cột M.');
      const exercises = await loadSessionExercises(item);
      rows = exercises.rows;
    }
    if (!active()) return;
    if (type === "calisthenics") {
      renderRoundWorkout(app, item, rows, active);
      return;
    }
    app.innerHTML = `<section class="card"><h2>${htmlText(item.activity || WORKOUT_TYPES[type])}</h2><p>Mục tiêu: ${htmlText(item.duration || "Chưa đặt thời gian")} · ${htmlText(item.target || "Chưa đặt kết quả")}</p>
        <form id="sessionForm">
        <label>Thời gian thực tế (phút)<input name="minutes" type="number" min="0.1" step="0.1" required></label>
        <label>Quãng đường thực tế (${type === "swimming" ? "m" : "km"})<input name="amount" type="number" min="0.1" step="0.1" required></label>
        <button id="finishSession" type="submit">Lưu hoàn thành</button><p id="sessionError" role="alert"></p></form><button id="backSession" type="button">Về Home</button><p class="local-status">Kết quả lưu trên máy, chưa đồng bộ Sheet.</p></section>`;
    const form = document.getElementById("sessionForm");
    let saved = false;
    form.addEventListener("submit", event => {
      event.preventDefault();
      try {
        if (!active() || saved) throw new Error("Phiên tập đã kết thúc hoặc nhân vật/ngày đã đổi.");
        saveWorkoutEntry(type, form.elements.minutes.value, form.elements.amount.value, "", item.target, item);
        saved = true;
        showHome();
      } catch (error) {
        document.getElementById("sessionError").textContent = error.message;
      }
    });
    document.getElementById("backSession").onclick = showHome;
  } catch (error) {
    if (!active()) return;
    app.innerHTML = `<section class="card"><h2>Không mở được bài tập</h2><p>${htmlText(error.message)}</p><p>Calisthenics cần API getWorkoutLibrary đã triển khai. Không dùng danh sách bài cố định thay thế.</p><button id="backSession">Về Home</button></section>`;
    document.getElementById("backSession").onclick = showHome;
  }
}
function saveWorkoutEntry(type, minutes, amount, note, targetOverride, source = {}) {
  if (!Object.hasOwn(WORKOUT_TYPES, type)) throw new Error("Hoạt động không hợp lệ.");
  const duration = Number(minutes),
    quantity = Number(amount);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Thời gian và kết quả phải lớn hơn 0.");
  if (type === "calisthenics" && !Number.isInteger(quantity)) throw new Error("Số vòng phải là số nguyên.");
  const today = getTodayData();
  const entry = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2),
    type,
    minutes: duration,
    distance: type === "calisthenics" ? null : quantity,
    distanceUnit: type === "swimming" ? "m" : "km",
    rounds: type === "calisthenics" ? quantity : null,
    note: String(note || ""),
    target: targetOverride ?? getTodayPlan().filter(item => resolveWorkoutType(item) === type).map(item => item.target).join("; "),
    workoutId: source.workoutId || source.personalWorkoutId || '',
    planKey: source.planKey || '',
    completed: true,
    at: new Date().toISOString()
  };
  today.workoutEntries = [...(today.workoutEntries || []), entry];
  updateDayCompletion(today);
  saveTodayData(today);
}
