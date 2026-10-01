"use strict";

// sync — extracted from the working app; public function names preserved.
let fitnessSyncBusy = false;
const fitnessSyncMessages = {};
function syncDayPayload(day) {
  const h = day.habits,
    daily = {};
  if (h) {
    const edited = day.habitEdited || {};
    // Old local records lack edit flags: do not overwrite Sheet with default zeroes.
    if (edited.waterMl || h.waterMl > 0) daily.waterLiters = Number((h.waterMl / 1000).toFixed(3));
    if (edited.sleepHours || h.sleepHours > 0) daily.sleepHours = h.sleepHours;
    if (edited.steps || h.steps > 0) daily.steps = h.steps;
  }
  if (day.weight !== undefined) daily.weight = day.weight;
  if (day.foodControlled !== undefined) daily.foodControlled = day.foodControlled;
  for (const key of ["sleepTime", "wakeTime", "note"]) if (day[key] !== undefined) daily[key] = day[key];
  return {
    action: "syncFitnessDay",
    schemaVersion: 2,
    userId: day.userId,
    date: day.date,
    daily,
    entries: (day.workoutEntries || []).filter(entry => entry.completed === true).map(entry => ({
      ...entry
    }))
  };
}
function pendingFitnessDays(userId) {
  return Object.entries(loadLocalData()).filter(([key, day]) => day && day.userId === userId && key === userId + "_" + day.date).map(([key, day]) => ({
    key,
    payload: syncDayPayload(day),
    previous: day.sheetSyncSignature
  })).filter(item => (Object.keys(item.payload.daily).length || item.payload.entries.length) && JSON.stringify(item.payload) !== item.previous).sort((a, b) => a.payload.date.localeCompare(b.payload.date));
}
async function syncFitnessToSheet() {
  requireCurrentUser();
  if (fitnessSyncBusy) return;
  const selected = CURRENT_USER,
    userId = getCurrentUserId();
  const pending = pendingFitnessDays(userId);
  fitnessSyncBusy = true;
  fitnessSyncMessages[userId] = "Đang gửi dữ liệu…";
  showHome();
  let count = 0;
  try {
    const infoResponse = await fetch(WEB_APP_URL + "?action=getSyncInfo&_=" + Date.now(), {
      cache: "no-store"
    });
    const info = await infoResponse.json();
    if (!info.success || info.schemaVersion !== 2 || info.destination !== "Daily Log") throw new Error("Cần triển khai backend bản chốt trước. Chưa gửi dữ liệu để tránh ghi vào Cardio Log.");
    for (const item of pending) {
      if (CURRENT_USER !== selected) throw new Error("Đã đổi nhân vật; dừng gửi các ngày còn lại.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      let result;
      try {
        const response = await fetch(WEB_APP_URL, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(item.payload),
          signal: controller.signal
        });
        result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Sheet chưa xác nhận ghi dữ liệu.");
      } finally {
        clearTimeout(timeout);
      }
      if (result.userId !== userId || result.date !== item.payload.date || !Array.isArray(result.acceptedIds) || item.payload.entries.some(entry => !result.acceptedIds.includes(entry.id))) throw new Error("Phản hồi đồng bộ không khớp; chưa đánh dấu đã gửi.");
      const all = loadLocalData();
      if (all[item.key] && all[item.key].userId === userId) {
        // Mark only the sent snapshot. Edits made while uploading stay pending.
        all[item.key].sheetSyncSignature = JSON.stringify(item.payload);
        all[item.key].sheetSyncedAt = new Date().toISOString();
        saveLocalData(all);
      }
      count++;
    }
    if (CURRENT_USER !== selected) throw new Error("Đã đổi nhân vật; chưa đồng bộ streak.");
    await syncMealsToSheet(selected);
    await syncCompletedDays(userId);
    fitnessSyncMessages[userId] = "Đã đồng bộ " + count + " ngày, bữa ăn và ngày đạt lên Google Sheet.";
  } catch (error) {
    fitnessSyncMessages[userId] = "Đã gửi " + count + " ngày. Chưa đồng bộ hết: " + (error.name === "AbortError" ? "Kết nối quá lâu. Có thể bấm gửi lại; mã workout giúp chống trùng." : error.message);
  } finally {
    fitnessSyncBusy = false;
    if (CURRENT_USER === selected) showHome();
  }
}
