"use strict";

// weekly-plan — extracted from the working app; public function names preserved.

async function loadWeeklyPlan() {
  const selected = CURRENT_USER,
    userId = getCurrentUserId();
  if (!userId) {
    weeklyPlan = [];
    return;
  }
  try {
    const response = await fetch(WEB_APP_URL + "?action=weeklyPlan&userId=" + encodeURIComponent(userId) + "&_=" + Date.now(), {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Không đọc được Weekly Plan");
    }
    if (CURRENT_USER !== selected) return;
    if (result.planSchemaVersion !== 3 || result.userId !== userId || !Array.isArray(result.data)) throw new Error('Cần triển khai backend lịch cá nhân mới (User ID + Workout ID).');
    result.data = result.data.filter(item => item.userId === userId);
    CURRENT_USER.hasAssignedPlan = result.data.length > 0;
    weeklyPlan = Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    if (CURRENT_USER !== selected) return;
    weeklyPlan = [];
    throw error;
  }
}
function getCurrentWeek() {
  const today = getTodayDate();
  const start = new Date(PLAN_START_DATE + "T00:00:00");
  const difference = today.getTime() - start.getTime();
  const days = Math.floor(difference / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return 1;
  }
  return Math.floor(days / 7) + 1;
}
function getTodayPlan() {
  if (!getCurrentUserId()) return [];
  const week = getCurrentWeek();
  const dayNo = getTodayDate().getDay() || 7;
  return weeklyPlan.filter(item => item.userId === getCurrentUserId() && parseWeekNumber(item.week) === week && (item.dayNo != null && item.dayNo !== "" ? Number(item.dayNo) === dayNo : normalizeDay(item.day) === getDayName()));
}
