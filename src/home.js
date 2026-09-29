"use strict";

// home — extracted from the working app; public function names preserved.

function showHome() {
  if (!getCurrentUserId()) return showUserSelector();
  const app = document.querySelector(".app");
  if (!app) return;
  app.workoutToken = null;
  if (app.stopWorkoutTimer) app.stopWorkoutTimer();
  const today = getTodayData(),
    habits = habitState(today),
    plan = getTodayPlan();
  const percent = homeProgress(today, plan);
  const targets = getHabitTargets();
  const displayTarget = kind => targets[kind] > 0 ? kind === "waterMl" ? targets[kind] / 1000 : targets[kind] : "Chưa đặt";
  const habitCard = (kind, title, unit, label, step) => `<article class="habit-item">
        <h3>${title}</h3><p class="habit-target-line"><span>Mục tiêu: ${displayTarget(kind)} ${unit}</span><button type="button" data-edit-target="${kind}"><span aria-hidden="true">✎</span> Sửa mục tiêu</button></p>
        <form data-target-form="${kind}" hidden><label>Mục tiêu (${unit})<input name="targetValue" type="number" min="${step}" step="${step}" value="${targets[kind] > 0 ? displayTarget(kind) : ""}" required></label><button type="submit">Lưu mục tiêu</button><p role="alert"></p></form>
        <p>Thực tế: <strong>${kind === "waterMl" ? Number((habits[kind] / 1000).toFixed(3)) : habits[kind]} ${unit}</strong> · ${targets[kind] > 0 && habits[kind] >= targets[kind] ? "✅ Đạt" + (habits[kind] > targets[kind] ? " · Dư " + Number(((habits[kind] - targets[kind]) / (kind === "waterMl" ? 1000 : 1)).toFixed(3)) + " " + unit : "") : "Chưa đạt"}</p>
        <form data-habit="${kind}"><label>${kind === "waterMl" ? "Thêm nước (ml)" : "Tổng hôm nay (" + unit + ")"}<input name="value" type="number" inputmode="${kind === "waterMl" ? "numeric" : "decimal"}" min="${kind === "waterMl" ? 1 : 0}" step="${kind === "waterMl" ? 1 : step}" ${kind === "waterMl" ? 'placeholder="Ví dụ: 200"' : ''} ${kind === "sleepHours" ? 'max="24"' : ''} required></label>
        <button type="submit">${label}</button><p class="form-error" role="alert"></p></form></article>`;
  app.innerHTML = `<header class="header"><h1>Fitness Tracker</h1><p>${htmlText(getCurrentUserName())}</p><p>${new Date().toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })}</p></header>
        <section class="card" id="streakCard"><h2>🔥 Streak</h2><p>${STREAK_PAUSE_ON_MISSED_DAYS ? "Số ngày đạt tích lũy" : "Chuỗi hiện tại"}: <strong>${calculateCurrentStreak()} ngày</strong></p><p>Kỷ lục liên tiếp: <strong>${calculateBestStreak()} ngày</strong></p>${STREAK_PAUSE_ON_MISSED_DAYS ? '<p class="local-status">Chế độ thử: giữ số ngày đã đạt, không reset khi bỏ ngày hoặc đổi nhân vật.</p>' : ''}<p class="local-status">${htmlText(streakMessages[getCurrentUserId()] || "Tính riêng theo nhân vật, đến hết hôm qua. Bấm Đồng bộ để lưu ngày đạt lên Sheet.")}</p></section>
        <section class="card"><h2>📊 Tiến độ hôm nay</h2><div class="progress-bar" role="progressbar" aria-label="Tiến độ hôm nay" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div style="width:${percent}%;height:100%;background:#111827"></div></div><p><strong>${percent}% hoàn thành</strong></p></section>
        <section class="card"><h2>📝 Thói quen hàng ngày</h2><p role="status">${htmlText(habitTargetMessages[getCurrentUserId()] || "")}</p>
        <p role="status">${htmlText(dailyRestoreMessages[getCurrentUserId()] || "")}</p>
        ${habitCard("waterMl", "💧 Uống nước", "L", "+ Nhập nước", 0.001)}
        <details><summary>Lịch sử uống nước · ${Number((habits.waterMl / 1000).toFixed(3))}/${displayTarget("waterMl")} L</summary>${habits.waterEntries.map(e => `<p>${new Date(e.at).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit"
  })} +${Number((e.amountMl / 1000).toFixed(3))} L</p>`).join("") || '<p>Chưa có lần nhập nào.</p>'}</details>
        ${habitCard("sleepHours", "💤 Giấc ngủ", "giờ", "Nhập giờ ngủ", 0.1)}
        ${habitCard("steps", "🚶 Số bước", "bước", "Nhập bước", 1)}</section>
        <section class="card"><h2>📝 Cơ thể &amp; Ăn uống</h2><form id="bodyForm"><label>⚖️ Cân nặng (kg)<input name="weight" type="number" min="0.1" step="0.1" value="${htmlText(today.weight ?? "")}" placeholder="Không bắt buộc"></label><button type="submit">Lưu cân nặng</button><p role="alert"></p></form><label><input id="foodControlled" type="checkbox" ${today.foodControlled ? "checked" : ""}> Ăn uống có kiểm soát</label></section>
        <section class="card"><h2>🎯 Hôm nay tập gì?</h2>${plan.map((item, index) => `<article class="habit-item"><h3>${htmlText(item.activity)}</h3><p>Mục tiêu: ${htmlText(item.duration)} · ${htmlText(item.target)}</p><p>Giờ dự kiến: ${htmlText(item.time)}</p>${isPlannedWorkoutComplete(item, today) ? '<p role="status" style="color:#15803d;font-weight:600">✅ Đã hoàn thành bài tập hôm nay</p>' : resolveWorkoutType(item) ? `<button type="button" data-start-workout="${index}">Bắt đầu tập</button>` : ""}</article>`).join("") || '<p>Chưa có kế hoạch cho hôm nay trong Weekly Plan.</p>'}
        <div class="replacement-workout"><h3>Workout thay thế</h3><label for="actualWorkoutType">Hoạt động</label><select id="actualWorkoutType" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit">${Object.entries(WORKOUT_TYPES).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
        <div class="workout-actions"><button id="startReplacement" type="button">Bắt đầu bài thay thế</button><button id="personalWorkouts" type="button">Bài tập của tôi · + Tạo bài</button></div>
        ${(today.workoutEntries || []).map(e => `<p>✅ ${WORKOUT_TYPES[e.type]} · ${e.minutes} phút · ${e.rounds === null ? e.distance + " " + e.distanceUnit : e.rounds + " vòng"}${e.note ? " · " + htmlText(e.note) : ""}</p>`).join("")}
        <p class="local-status">${pendingFitnessDays(getCurrentUserId()).length ? "Có dữ liệu trên máy chưa đồng bộ." : "Dữ liệu đã gửi sẽ được giữ lại trên máy."}</p><button id="syncFitnessButton" type="button" ${fitnessSyncBusy ? "disabled" : ""}>${fitnessSyncBusy ? "Đang đồng bộ…" : "Đồng bộ Google Sheet"}</button><p role="status" class="local-status">${htmlText(fitnessSyncMessages[getCurrentUserId()] || "Đồng bộ thói quen, cơ thể và tổng kết workout vào Daily Log.")}</p></div></section>`;
  document.getElementById("syncFitnessButton").onclick = syncFitnessToSheet;
  document.getElementById("personalWorkouts").onclick = showPersonalWorkouts;
  const selected = CURRENT_USER,
    date = getDateKey();
  app.querySelectorAll("[data-start-workout]").forEach(button => button.onclick = () => beginWorkout(plan[Number(button.dataset.startWorkout)]));
  document.getElementById("startReplacement").onclick = () => {
    const type = document.getElementById("actualWorkoutType").value;
    if (type === 'calisthenics') {
      showPersonalWorkouts();
      return;
    }
    beginWorkout({
      type,
      activity: WORKOUT_TYPES[type]
    });
  };
  const guard = () => {
    if (CURRENT_USER !== selected || getDateKey() !== date) throw new Error("Nhân vật hoặc ngày đã đổi. Hãy tải lại trang.");
  };
  app.querySelectorAll("[data-edit-target]").forEach(button => button.onclick = () => {
    const form = app.querySelector('[data-target-form="' + button.dataset.editTarget + '"]');
    form.hidden = !form.hidden;
  });
  app.querySelectorAll("[data-target-form]").forEach(form => form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    form.querySelector('[role="alert"]').textContent = "Đang lưu lên Sheet…";
    try {
      guard();
      await saveHabitTarget(form.dataset.targetForm, form.elements.targetValue.value);
      guard();
      showHome();
    } catch (error) {
      form.querySelector('[role="alert"]').textContent = "Chưa lưu: " + error.message;
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("bodyForm").onsubmit = event => {
    event.preventDefault();
    try {
      guard();
      saveBodyData(event.currentTarget.elements.weight.value, null);
      showHome();
    } catch (error) {
      event.currentTarget.querySelector('[role="alert"]').textContent = error.message;
    }
  };
  document.getElementById("foodControlled").onchange = event => {
    guard();
    saveBodyData(null, event.target.checked);
  };
  app.querySelectorAll("[data-habit]").forEach(form => form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      guard();
      const value = form.elements.value.value;
      saveHabitValue(form.dataset.habit, value);
      showHome();
    } catch (error) {
      form.querySelector(".form-error").textContent = error.message;
    }
  }));
}
