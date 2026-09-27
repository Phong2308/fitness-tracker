"use strict";

// habits — extracted from the working app; public function names preserved.

function saveBodyData(weight, food) {
  const today = getTodayData();
  if (weight !== null) {
    const value = String(weight).trim();
    if (value && (!Number.isFinite(Number(value)) || Number(value) <= 0)) throw new Error("Cân nặng không hợp lệ.");
    today.weight = value ? Number(value) : "";
  }
  if (food !== null) today.foodControlled = Boolean(food);
  saveTodayData(today);
}
function habitState(today) {
  return today.habits || {
    waterMl: 0,
    waterEntries: [],
    sleepHours: 0,
    steps: 0
  };
}
function scheduledWorkout(plan) {
  return plan.some(item => resolveWorkoutType(item) !== null);
}
function homeProgress(today, plan) {
  const habits = habitState(today);
  const targets = getHabitTargets(today.userId);
  const achieved = ["waterMl", "sleepHours", "steps"].reduce((sum, key) => sum + Number(targets[key] > 0 && habits[key] >= targets[key]), 0);
  const workoutDone = (today.workoutEntries || []).some(item => item.completed === true);
  return scheduledWorkout(plan) ? achieved * 30 + (workoutDone ? 10 : 0) : Math.round(achieved / 3 * 100);
}
function saveHabitValue(kind, value) {
  const number = Number(value);
  if (String(value).trim() === "" || !Number.isFinite(number) || number < 0) throw new Error("Nhập một số hợp lệ, không âm.");
  if (kind === "waterMl" && number <= 0) throw new Error("Lượng nước thêm phải lớn hơn 0.");
  if (kind === "sleepHours" && number > 24) throw new Error("Giấc ngủ không vượt quá 24 giờ.");
  if (kind === "steps" && !Number.isInteger(number)) throw new Error("Số bước phải là số nguyên.");
  if (!Object.hasOwn(HABIT_TARGETS, kind)) throw new Error("Thói quen không hợp lệ.");
  const today = getTodayData();
  today.habits = habitState(today);
  today.habitEdited = {
    ...(today.habitEdited || {}),
    [kind]: true
  };
  if (kind === "waterMl") {
    today.habits.waterMl += number;
    today.habits.waterEntries.push({
      amountMl: number,
      at: new Date().toISOString()
    });
  } else today.habits[kind] = number;
  updateDayCompletion(today);
  saveTodayData(today);
}
