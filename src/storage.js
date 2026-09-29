"use strict";

// storage — extracted from the working app; public function names preserved.

function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid history");
    return data;
  } catch (error) {
    throw new Error("Không đọc được lịch sử trên máy. Chưa ghi đè hay xóa dữ liệu; hãy sao lưu trước khi xử lý.");
  }
}
function saveLocalData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function getTodayData() {
  requireCurrentUser();
  const all = loadLocalData();
  const key = getCurrentUserId() + "_" + getDateKey();
  if (all[key] && !ownsCurrentUser(all[key])) throw new Error("Bản ghi không khớp nhân vật; giữ nguyên dữ liệu để kiểm tra.");
  if (!all[key]) {
    all[key] = {
      userId: getCurrentUserId(),
      date: getDateKey(),
      completedDay: false
    };
    saveLocalData(all);
  }
  return all[key];
}
function saveTodayData(data) {
  requireCurrentUser();
  if (!ownsCurrentUser(data) || data.date !== getDateKey()) {
    throw new Error("Không thể lưu dữ liệu của nhân vật hoặc ngày khác.");
  }
  const all = loadLocalData();
  const key = getCurrentUserId() + "_" + getDateKey();
  all[key] = data;
  saveLocalData(all);
}

const dailyRestoreMessages = {};
async function restoreTodayHabits() {
  const selected = CURRENT_USER, userId = getCurrentUserId(), date = getDateKey();
  try {
    const result = await personalWorkoutRequest({action: "getDailyLog", userId, date});
    if (CURRENT_USER !== selected || getDateKey() !== date) return;
    if (result.dailyReadVersion !== 2 || result.userId !== userId || !Array.isArray(result.data)) {
      throw new Error("Cần cập nhật hàm getDailyLog trong Apps Script.");
    }
    if (result.data.some(row => row.userId !== userId || row.date !== date) || result.data.length > 1) {
      throw new Error("Daily Log sai người/ngày hoặc có dòng trùng; chưa nhập vào máy.");
    }
    const row = result.data[0];
    if (row) {
      const today = getTodayData();
      const habits = {...habitState(today)};
      for (const [key, raw, factor] of [["waterMl", row.water, 1000], ["sleepHours", row.sleep, 1], ["steps", row.steps, 1]]) {
        if (raw === "" || raw == null) continue;
        const value = Number(raw) * factor;
        if (!Number.isFinite(value) || value < 0 || (key === "steps" && !Number.isInteger(value)) || (key === "sleepHours" && value > 24)) {
          throw new Error("Dữ liệu thói quen trên Sheet không hợp lệ.");
        }
        // Never replace a local edit, including an intentional zero, with a remote snapshot.
        if (!today.habitEdited?.[key] && !(today.habits?.[key] > 0)) habits[key] = key === "waterMl" ? Math.round(value) : value;
      }
      today.habits = habits;
      saveTodayData(today);
    }
    dailyRestoreMessages[userId] = "Đã kiểm tra dữ liệu hôm nay trên Sheet; giữ nguyên dữ liệu đang có trên máy.";
  } catch (error) {
    if (CURRENT_USER === selected) dailyRestoreMessages[userId] = "Chưa khôi phục từ Sheet: " + error.message + " Dữ liệu trên máy được giữ nguyên.";
  }
}
