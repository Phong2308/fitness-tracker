"use strict";

// targets — extracted from the working app; public function names preserved.
const HABIT_TARGETS = {
  waterMl: null,
  sleepHours: null,
  steps: null
};
const habitTargetMessages = {};
const habitTargetMemory = {};
function cacheHabitTargets(userId, targets) {
  habitTargetMemory[userId] = targets;
  try {
    localStorage.setItem("fitness_targets_" + userId, JSON.stringify(targets));
  } catch (_) {}
}
async function loadHabitTargetsFromSheet(userId) {
  try {
    const result = await personalWorkoutRequest({
      action: "getHabitTargets",
      userId
    });
    if (!result.success || result.userId !== userId || !result.targets) throw new Error(result.error || "Phản hồi mục tiêu không hợp lệ.");
    const saved = getHabitTargets(userId);
    for (const kind of Object.keys(HABIT_TARGETS)) {
      const value = result.targets[kind];
      if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error("Mục tiêu trên Sheet không hợp lệ.");
      if (value !== null) saved[kind] = value;
    }
    cacheHabitTargets(userId, saved);
    habitTargetMessages[userId] = "Đã tải mục tiêu từ User Master.";
  } catch (error) {
    habitTargetMessages[userId] = "Chưa tải được mục tiêu từ Sheet; đang dùng bản lưu trên máy nếu có. " + error.message;
  }
}
function getHabitTargets(userId = getCurrentUserId()) {
  if (habitTargetMemory[userId]) return {
    ...habitTargetMemory[userId]
  };
  try {
    const saved = JSON.parse(localStorage.getItem("fitness_targets_" + userId) || "null");
    return {
      ...HABIT_TARGETS,
      ...(saved || {})
    };
  } catch (_) {
    return {
      ...HABIT_TARGETS
    };
  }
}
async function saveHabitTarget(kind, value) {
  requireCurrentUser();
  const selected = CURRENT_USER,
    userId = getCurrentUserId();
  const n = Number(value),
    actual = kind === "waterMl" ? Math.round(n * 1000) : n;
  if (!Object.hasOwn(HABIT_TARGETS, kind) || !Number.isFinite(actual) || actual <= 0 || kind === "steps" && !Number.isInteger(actual) || kind === "sleepHours" && actual > 24) throw new Error("Mục tiêu không hợp lệ.");
  const result = await personalWorkoutRequest({
    action: "saveHabitTargets",
    userId,
    targets: {
      [kind]: actual
    }
  }, true);
  if (!result.success || result.userId !== userId || !result.targets || result.targets[kind] !== actual) throw new Error(result.error || "Sheet chưa xác nhận mục tiêu. Hãy thử lưu lại.");
  cacheHabitTargets(userId, {
    ...getHabitTargets(userId),
    ...Object.fromEntries(Object.entries(result.targets).filter(([, v]) => v !== null))
  });
  habitTargetMessages[userId] = "Đã lưu mục tiêu lên User Master.";
  if (CURRENT_USER !== selected) return;
  const today = getTodayData();
  updateDayCompletion(today);
  saveTodayData(today);
}
