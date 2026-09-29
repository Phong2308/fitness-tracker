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
    return closedDayStreakStats().current;
}

function calculateBestStreak() {
    return closedDayStreakStats().best;
}

const streakMessages = {};
function closedDayStreakStats() {
    const yesterday = getTodayDate(); yesterday.setDate(yesterday.getDate()-1);
    return calculateStreakStats(loadLocalData(), getCurrentUserId(), getDateKey(yesterday));
}
async function loadStreakHistory() {
    const selected=CURRENT_USER, userId=getCurrentUserId();
    try {
        const result=await personalWorkoutRequest({action:"getStreakHistory",userId});
        if(CURRENT_USER!==selected)return;
        if(result.streakVersion!==1 || result.userId!==userId || !Array.isArray(result.data))throw new Error("Phản hồi streak không hợp lệ.");
        const all=loadLocalData(), seen=new Set();
        for(const row of result.data){
            const parsed=new Date(row.date+"T00:00:00Z");
            if(row.userId!==userId || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==row.date || typeof row.completedDay!=="boolean" || seen.has(row.date))throw new Error("Lịch sử streak sai người/ngày hoặc trùng ngày.");
            seen.add(row.date);
            const key=userId+"_"+row.date, old=all[key];
            if(old && (old.userId!==userId || old.date!==row.date))throw new Error("Lịch sử trên máy không khớp; chưa thay đổi.");
            all[key]={...(old || {userId,date:row.date}),completedDay:old?.completedDay===true || row.completedDay};
        }
        saveLocalData(all);
        streakMessages[userId]="Đã tải lịch sử ngày đạt từ Sheet. Chỉ tính đến hết hôm qua.";
    } catch(error){if(CURRENT_USER===selected)streakMessages[userId]="Đang dùng lịch sử trên máy. Chưa tải được streak: "+error.message;}
}
async function syncCompletedDays(userId) {
    const dates=Object.entries(loadLocalData()).filter(([key,day])=>day && day.userId===userId && key===userId+"_"+day.date && day.completedDay===true && day.date<=getDateKey()).map(([,day])=>day.date);
    const result=await personalWorkoutRequest({action:"syncStreakDays",userId,dates},true);
    if(result.streakVersion!==1 || result.userId!==userId || !Array.isArray(result.acceptedDates) || dates.some(date=>!result.acceptedDates.includes(date)))throw new Error("Chưa xác nhận lưu đủ các ngày đạt.");
    streakMessages[userId]="Đã lưu ngày đạt lên Sheet; ngày hôm nay sẽ được tính từ ngày mai.";
}

function updateDayCompletion(today) {
    // Once earned, retain completion even if targets later change.
    const state = homeLoadState[getCurrentUserId()];
    today.completedDay = today.completedDay === true || ((!state || state.planReady) && homeProgress(today, getTodayPlan()) === 100);
}
