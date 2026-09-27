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
