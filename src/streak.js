// Pure calculation: never writes, resets, or deletes a user's history.
// Trial mode keeps accumulated completed days across gaps.
// Strict mode counts calendar-consecutive days, giving today time to finish.
function calculateStreakStats(all, userId, todayKey, pauseOnMissedDays = STREAK_PAUSE_ON_MISSED_DAYS) {
    const dayNumber = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
        const timestamp = Date.parse(value + "T00:00:00Z");
        return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
            ? timestamp / 86400000 : NaN;
    };
    const today = dayNumber(todayKey);
    if (!userId || !Number.isFinite(today)) return {current: 0, best: 0, total: 0, paused: false};
    const dates = new Set();
    for (const [key, record] of Object.entries(all || {})) {
        if (!record || record.userId !== userId || (record.User_ID != null && String(record.User_ID).trim() !== userId)) continue;
        if (!key.startsWith(userId + "_")) continue;
        const dateKey = key.slice(userId.length + 1);
        if (record.date != null && record.date !== dateKey) continue;
        const day = dayNumber(dateKey);
        if (Number.isFinite(day) && day <= today && record.completedDay === true) dates.add(day);
    }
    const ordered = [...dates].sort((a, b) => a - b);
    let best = 0, run = 0, previous = null;
    for (const day of ordered) {
        run = previous !== null && day === previous + 1 ? run + 1 : 1;
        best = Math.max(best, run);
        previous = day;
    }
    if (pauseOnMissedDays) {
        return {current: dates.size, best, total: dates.size, paused: dates.size > 0 && !dates.has(today)};
    }
    let cursor = dates.has(today) ? today : today - 1, current = 0;
    while (dates.has(cursor)) { current++; cursor--; }
    return {current, best, total: dates.size, paused: current > 0 && !dates.has(today)};
}

function calculateCurrentStreak() {
    return calculateStreakStats(loadLocalData(), getCurrentUserId(), getDateKey()).current;
}

function calculateBestStreak() {
    return calculateStreakStats(loadLocalData(), getCurrentUserId(), getDateKey()).best;
}

function updateDayCompletion(today) {
    // Once earned, retain completion even if targets later change.
    today.completedDay = today.completedDay === true || homeProgress(today, getTodayPlan()) === 100;
}
