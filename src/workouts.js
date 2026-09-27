"use strict";

// workouts — extracted from the working app; public function names preserved.
const WORKOUT_TYPES = {
  swimming: "🏊 Bơi",
  cycling: "🚴 Đạp xe",
  running: "🏃 Chạy bộ",
  calisthenics: "💪 Calisthenics"
};
function resolveWorkoutType(item) {
  if (item.workoutId || item.personalWorkoutId) return 'calisthenics';
  const raw = normalizeText(item.type || item.activity || "").replace(/đ/g, "d");
  if (/calisthenics/.test(raw)) return "calisthenics";
  if (/boi|swim/.test(raw)) return "swimming";
  if (/dap xe|cycling|cycle/.test(raw)) return "cycling";
  if (/chay|running|run/.test(raw)) return "running";
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
  const rounds = [...new Set(rows.map(row => row.round))];
  const checked = new Set();
  const started = Date.now();
  let index = 0,
    restSeconds = item.personalWorkoutId ? item.restSeconds : 60,
    timer = null,
    saved = false,
    resting = false;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  app.stopWorkoutTimer = stop;
  function render() {
    if (!active()) {
      stop();
      return;
    }
    const current = rows.filter(row => row.round === rounds[index]);
    app.innerHTML = `<section class="card"><h2>${htmlText(item.activity || "Calisthenics")}</h2><p>Mục tiêu: ${htmlText(item.duration || "")} · ${htmlText(item.target || rounds.length + " vòng")}</p><p>Workout Library</p>
        <div class="progress-bar" role="progressbar" aria-label="Tiến độ bài tập" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(checked.size / rows.length * 100)}"><div style="height:100%;background:#111827;width:${checked.size / rows.length * 100}%"></div></div><p>${checked.size}/${rows.length} bài hoàn thành</p>
        <h3>Vòng ${index + 1} / ${rounds.length}</h3>
        <label>Nghỉ giữa các vòng (giây)<input id="roundRestSeconds" type="number" min="0" max="3600" step="1" value="${restSeconds}" style="width:100px;margin:8px;padding:8px"></label>
        <div id="roundExercises">${current.map(row => `<label style="display:flex;align-items:flex-start;gap:12px;padding:14px 0"><input type="checkbox" data-round-exercise="${row.key}" ${checked.has(row.key) ? "checked" : ""}><span><strong>${htmlText(row.exercise)}</strong><br>${htmlText(row.repsTime)}${row.rest ? " · Nghỉ " + htmlText(row.rest) : ""}${row.note ? "<br>" + htmlText(row.note) : ""}</span></label>`).join("")}</div>
        <div id="roundRestPanel" hidden><h3>Đã xong vòng ${index + 1} — nghỉ</h3><p id="roundCountdown" role="status"></p><button id="skipRoundRest" type="button">Bỏ qua nghỉ</button></div><p id="roundMessage" role="alert"></p><button id="exitRounds" type="button">Về Home</button></section>`;
    const input = document.getElementById("roundRestSeconds");
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
        render();
        return;
      }
      if (index === rounds.length - 1) {
        finish();
        return;
      }
      render();
      resting = true;
      document.getElementById("roundExercises").hidden = true;
      document.getElementById("roundRestPanel").hidden = false;
      document.getElementById("roundRestSeconds").disabled = true;
      const deadline = Date.now() + restSeconds * 1000;
      function next() {
        stop();
        if (!active() || !resting) return;
        resting = false;
        index++;
        render();
      }
      document.getElementById("skipRoundRest").onclick = next;
      function tick() {
        if (!active()) {
          stop();
          return;
        }
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        document.getElementById("roundCountdown").textContent = remaining + " giây · tiếp theo vòng " + (index + 2);
        if (!remaining) next();else timer = setTimeout(tick, 250);
      }
      tick();
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
