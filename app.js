// Local-first. Sheet writes occur only after pressing the Sync button.
let fitnessSyncBusy = false;
const fitnessSyncMessages = {};

function syncDayPayload(day) {
    const h = day.habits, daily = {};
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
    return {action:"syncFitnessDay",schemaVersion:2,userId:day.userId,date:day.date,daily,
        entries:(day.workoutEntries || []).filter(entry=>entry.completed === true).map(entry=>({...entry}))};
}

function pendingFitnessDays(userId) {
    return Object.entries(loadLocalData()).filter(([key,day]) => day && day.userId === userId && key === userId + "_" + day.date)
        .map(([key,day])=>({key,payload:syncDayPayload(day),previous:day.sheetSyncSignature}))
        .filter(item=>(Object.keys(item.payload.daily).length || item.payload.entries.length) && JSON.stringify(item.payload)!==item.previous)
        .sort((a,b)=>a.payload.date.localeCompare(b.payload.date));
}

async function syncFitnessToSheet() {
    requireCurrentUser();
    if (fitnessSyncBusy) return;
    const selected = CURRENT_USER, userId = getCurrentUserId();
    const pending = pendingFitnessDays(userId);
    if (!pending.length) { fitnessSyncMessages[userId]="Không có dữ liệu mới cần gửi.";showHome();return; }
    fitnessSyncBusy=true;
    fitnessSyncMessages[userId]="Đang gửi dữ liệu…";
    showHome();
    let count=0;
    try {
        const infoResponse = await fetch(WEB_APP_URL + "?action=getSyncInfo&_=" + Date.now(), {cache:"no-store"});
        const info = await infoResponse.json();
        if (!info.success || info.schemaVersion !== 2 || info.destination !== "Daily Log") throw new Error("Cần triển khai backend bản chốt trước. Chưa gửi dữ liệu để tránh ghi vào Cardio Log.");
        for (const item of pending) {
            if (CURRENT_USER !== selected) throw new Error("Đã đổi nhân vật; dừng gửi các ngày còn lại.");
            const controller=new AbortController();
            const timeout=setTimeout(()=>controller.abort(),45000);
            let result;
            try {
                const response=await fetch(WEB_APP_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(item.payload),signal:controller.signal});
                result=await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || "Sheet chưa xác nhận ghi dữ liệu.");
            } finally { clearTimeout(timeout); }
            if (result.userId !== userId || result.date !== item.payload.date || !Array.isArray(result.acceptedIds) || item.payload.entries.some(entry=>!result.acceptedIds.includes(entry.id))) throw new Error("Phản hồi đồng bộ không khớp; chưa đánh dấu đã gửi.");
            const all=loadLocalData();
            if (all[item.key] && all[item.key].userId === userId) {
                // Mark only the sent snapshot. Edits made while uploading stay pending.
                all[item.key].sheetSyncSignature=JSON.stringify(item.payload);
                all[item.key].sheetSyncedAt=new Date().toISOString();
                saveLocalData(all);
            }
            count++;
        }
        fitnessSyncMessages[userId]="Đã đồng bộ " + count + " ngày lên Google Sheet.";
    } catch(error) {
        fitnessSyncMessages[userId]="Đã gửi " + count + " ngày. Chưa đồng bộ hết: " + (error.name === "AbortError" ? "Kết nối quá lâu. Có thể bấm gửi lại; mã workout giúp chống trùng." : error.message);
    } finally {
        fitnessSyncBusy=false;
        if (CURRENT_USER === selected) showHome();
    }
}
const HABIT_TARGETS = { waterMl: null, sleepHours: null, steps: null };
function getHabitTargets(userId = getCurrentUserId()) {
    const seeds = { P001:{waterMl:2000,sleepHours:8,steps:8000}, P002:{waterMl:1500,sleepHours:7,steps:6000} };
    try {
        const saved = JSON.parse(localStorage.getItem("fitness_targets_" + userId) || "null");
        return {...HABIT_TARGETS,...(seeds[userId] || {}),...(saved || {})};
    } catch (_) { return {...HABIT_TARGETS,...(seeds[userId] || {})}; }
}
function saveHabitTarget(kind, value) {
    requireCurrentUser();
    const n=Number(value), actual=kind === "waterMl" ? Math.round(n*1000) : n;
    if (!Object.hasOwn(HABIT_TARGETS,kind) || !Number.isFinite(actual) || actual<=0 || (kind === "steps" && !Number.isInteger(actual)) || (kind === "sleepHours" && actual>24)) throw new Error("Mục tiêu không hợp lệ.");
    localStorage.setItem("fitness_targets_"+getCurrentUserId(),JSON.stringify({...getHabitTargets(),[kind]:actual}));
    const today=getTodayData();today.completedDay=homeProgress(today,getTodayPlan())===100;saveTodayData(today);
}
function saveBodyData(weight, food) {
    const today=getTodayData();
    if (weight !== null) {
        const value=String(weight).trim();
        if (value && (!Number.isFinite(Number(value)) || Number(value)<=0)) throw new Error("Cân nặng không hợp lệ.");
        today.weight=value ? Number(value) : "";
    }
    if (food !== null) today.foodControlled=Boolean(food);
    saveTodayData(today);
}
const WORKOUT_TYPES = { swimming: "🏊 Bơi", cycling: "🚴 Đạp xe", running: "🏃 Chạy bộ", calisthenics: "💪 Calisthenics" };

function resolveWorkoutType(item) {
    if(item.workoutId || item.personalWorkoutId) return 'calisthenics';
    const raw = normalizeText(item.type || item.activity || "").replace(/đ/g, "d");
    if (/calisthenics/.test(raw)) return "calisthenics";
    if (/boi|swim/.test(raw)) return "swimming";
    if (/dap xe|cycling|cycle/.test(raw)) return "cycling";
    if (/chay|running|run/.test(raw)) return "running";
    return null;
}

function isPlannedWorkoutComplete(item, today) {
    const type = resolveWorkoutType(item);
    return Boolean(type && ownsCurrentUser(today) && today.date === getDateKey() &&
        (today.workoutEntries || []).some(entry => entry.type === type && entry.completed === true &&
            (item.planKey ? entry.planKey===item.planKey : item.workoutId ? entry.workoutId===item.workoutId : true)));
}

function validateLibrary(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("Workout Library chưa có bài tập Calisthenics.");
    const seen = new Set();
    return rows.map(row => {
        const round = Number(row.round), order = Number(row.order);
        if (normalizeText(row.workout) !== "calisthenics" || !Number.isInteger(round) || round < 1 || !Number.isInteger(order) || order < 1 || !String(row.exercise || "").trim()) throw new Error("Workout Library có dòng không hợp lệ.");
        const key = round + ":" + order;
        if (seen.has(key)) throw new Error("Workout Library bị trùng Vòng/Thứ tự.");
        seen.add(key);
        return {...row, round, order, key};
    }).sort((a,b) => a.round-b.round || a.order-b.order);
}

function builtInCalisthenics(item) {
    const match = String(item.target || "").match(/(\d+)\s*vòng/i);
    const count = match ? Number(match[1]) : 3;
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Số vòng không hợp lệ.");
    return validateLibrary(Array.from({length: count}, (_, round) =>
        CALISTHENICS_EXERCISES.map((exercise, index) => ({workout:"Calisthenics", round:round+1,
            order:index+1, exercise:exercise.name, repsTime:exercise.target, rest:"", note:""}))).flat());
}

async function loadSessionExercises(item) {
    const id=item.workoutId || item.personalWorkoutId;
    if (id) {
        const userId=getCurrentUserId();
        if ((item.userId || item.personalUserId)!==userId) throw new Error("Bài tập không thuộc nhân vật hiện tại.");
        const result=await personalWorkoutRequest({action:'getPersonalWorkouts',userId});
        if(result.userId!==userId) throw new Error("Thư viện trả về sai nhân vật.");
        const own=result.data.find(w=>w.id===id);
        if(!own) throw new Error("Không tìm thấy bài tập riêng.");
        item.activity=own.name;item.workoutId=id;item.personalWorkoutId=id;item.restSeconds=own.restSeconds;
        return {rows:expandLibraryForPlan(own.rows,item.target),fallback:false};
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(WEB_APP_URL + "?action=getWorkoutLibrary&workout=Calisthenics&_=" + Date.now(), {cache:"no-store", signal:controller.signal});
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Không tải được Workout Library.");
        return {rows:item.target ? expandLibraryForPlan(result.data,item.target) : validateLibrary(result.data), fallback:false};
    } catch (error) {
        console.error("Workout Library chưa sẵn sàng:", error);
        throw new Error("Không tải được Workout Library. Hãy kiểm tra API thư viện; không thay bằng bài cố định.");
    } finally { clearTimeout(timer); }
}

function expandLibraryForPlan(rows, target) {
    const match=String(target || '').trim().match(/^(\d+)\s*vòng$/i);
    const count=match?Number(match[1]):0;
    if(!Number.isInteger(count)||count<1||count>100)throw new Error('Weekly Plan cần Mục tiêu dạng “3 vòng” (1–100 vòng).');
    const first=Math.min(...rows.map(r=>Number(r.round)||1));
    const base=rows.filter(r=>(Number(r.round)||1)===first).sort((a,b)=>Number(a.order)-Number(b.order));
    return validateLibrary(Array.from({length:count},(_,i)=>base.map((r,j)=>({...r,round:i+1,order:j+1}))).flat());
}

function renderRoundWorkout(app, item, rows, fallback, active) {
    const rounds = [...new Set(rows.map(row => row.round))];
    const checked = new Set();
    const started = Date.now();
    let index = 0, restSeconds = item.personalWorkoutId ? item.restSeconds : 60, timer = null, saved = false, resting = false;
    const stop = () => { if (timer !== null) clearTimeout(timer); timer = null; };
    app.stopWorkoutTimer = stop;
    function render() {
        if (!active()) { stop(); return; }
        const current = rows.filter(row => row.round === rounds[index]);
        app.innerHTML = `<section class="card"><h2>${htmlText(item.activity || "Calisthenics")}</h2><p>Mục tiêu: ${htmlText(item.duration || "")} · ${htmlText(item.target || rounds.length + " vòng")}</p><p>${fallback ? "Bài tập có sẵn · Thư viện Sheet chưa kết nối" : "Workout Library"}</p>
        <div class="progress-bar" role="progressbar" aria-label="Tiến độ bài tập" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(checked.size/rows.length*100)}"><div style="height:100%;background:#111827;width:${checked.size/rows.length*100}%"></div></div><p>${checked.size}/${rows.length} bài hoàn thành</p>
        <h3>Vòng ${index + 1} / ${rounds.length}</h3>
        <label>Nghỉ giữa các vòng (giây)<input id="roundRestSeconds" type="number" min="0" max="3600" step="1" value="${restSeconds}" style="width:100px;margin:8px;padding:8px"></label>
        <div id="roundExercises">${current.map(row => `<label style="display:flex;align-items:flex-start;gap:12px;padding:14px 0"><input type="checkbox" data-round-exercise="${row.key}" ${checked.has(row.key) ? "checked" : ""}><span><strong>${htmlText(row.exercise)}</strong><br>${htmlText(row.repsTime)}${row.rest ? " · Nghỉ " + htmlText(row.rest) : ""}${row.note ? "<br>"+htmlText(row.note) : ""}</span></label>`).join("")}</div>
        <div id="roundRestPanel" hidden><h3>Đã xong vòng ${index + 1} — nghỉ</h3><p id="roundCountdown" role="status"></p><button id="skipRoundRest" type="button">Bỏ qua nghỉ</button></div><p id="roundMessage" role="alert"></p><button id="exitRounds" type="button">Về Home</button></section>`;
        const input = document.getElementById("roundRestSeconds");
        input.onchange = () => {
            const value = Number(input.value);
            if (input.value === "" || !Number.isInteger(value) || value < 0 || value > 3600) {
                input.value = restSeconds;
                document.getElementById("roundMessage").textContent = "Nhập từ 0 đến 3600 giây.";
            } else { restSeconds = value; document.getElementById("roundMessage").textContent = ""; }
        };
        document.getElementById("exitRounds").onclick = () => { stop(); showHome(); };
        app.querySelectorAll("[data-round-exercise]").forEach(box => box.onchange = () => {
            if (!active() || resting || saved) return;
            if (box.checked) checked.add(box.dataset.roundExercise); else checked.delete(box.dataset.roundExercise);
            if (!current.every(row => checked.has(row.key))) { render(); return; }
            if (index === rounds.length - 1) { finish(); return; }
            render();
            resting = true;
            document.getElementById("roundExercises").hidden = true;
            document.getElementById("roundRestPanel").hidden = false;
            document.getElementById("roundRestSeconds").disabled = true;
            const deadline = Date.now() + restSeconds * 1000;
            function next() {
                stop();
                if (!active() || !resting) return;
                resting = false; index++; render();
            }
            document.getElementById("skipRoundRest").onclick = next;
            function tick() {
                if (!active()) { stop(); return; }
                const remaining = Math.max(0, Math.ceil((deadline-Date.now())/1000));
                document.getElementById("roundCountdown").textContent = remaining + " giây · tiếp theo vòng " + (index + 2);
                if (!remaining) next(); else timer = setTimeout(tick, 250);
            }
            tick();
        });
    }
    function finish() {
        stop();
        if (!active() || saved) return;
        try {
            const minutes = Math.max(0.1, Math.round((Date.now()-started)/6000)/10);
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
    if (!type) { alert("Chưa hỗ trợ loại workout này."); return; }
    const user = CURRENT_USER, date = getDateKey(), app = document.querySelector(".app");
    if (app.stopWorkoutTimer) app.stopWorkoutTimer();
    const token = {};
    app.workoutToken = token;
    const active = () => CURRENT_USER === user && getDateKey() === date && app.workoutToken === token;
    let rows = [];
    let fallback = false;
    app.innerHTML = '<section class="card"><p>Đang chuẩn bị bài tập…</p></section>';
    try {
        if (type === "calisthenics") {
            if(item.userId && !item.workoutId)throw new Error('Dòng Calisthenics trong Weekly Plan thiếu Workout ID ở cột M.');
            const exercises = await loadSessionExercises(item);
            rows = exercises.rows;
            fallback = exercises.fallback;
        }
        if (!active()) return;
        if (type === "calisthenics") {
            renderRoundWorkout(app, item, rows, fallback, active);
            return;
        }
        const rounds = [...new Set(rows.map(row=>row.round))];
        app.innerHTML = `<section class="card"><h2>${htmlText(item.activity || WORKOUT_TYPES[type])}</h2><p>Mục tiêu: ${htmlText(item.duration || "Chưa đặt thời gian")} · ${htmlText(item.target || "Chưa đặt kết quả")}</p>
        ${rows.length ? `<p>${rounds.length} vòng · ${fallback ? "Bài tập có sẵn (thư viện Sheet chưa kết nối)" : "Workout Library"}</p><div class="progress-bar" role="progressbar" aria-label="Tiến độ bài tập" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="sessionProgress"><div id="sessionBar" style="width:0%;height:100%;background:#111827"></div></div><p id="sessionCount">0/${rows.length} bài hoàn thành</p>` : ""}
        <form id="sessionForm">${rounds.map(round=>`<fieldset style="border:1px solid #e5e7eb;border-radius:12px;margin:16px 0"><legend>Vòng ${round}</legend>${rows.filter(row=>row.round===round).map(row=>`<label style="display:flex;flex-direction:row;align-items:flex-start"><input type="checkbox" data-exercise="${row.key}" style="width:22px;flex:0 0 22px"><span><strong>${htmlText(row.exercise)}</strong><br>${htmlText(row.repsTime)}${row.rest ? " · Nghỉ " + htmlText(row.rest) : ""}${row.note ? "<br>" + htmlText(row.note) : ""}</span></label>`).join("")}</fieldset>`).join("")}
        <label>Thời gian thực tế (phút)<input name="minutes" type="number" min="0.1" step="0.1" required></label>
        ${type !== "calisthenics" ? `<label>Quãng đường thực tế (${type === "swimming" ? "m" : "km"})<input name="amount" type="number" min="0.1" step="0.1" required></label>` : '<label>Ghi chú<textarea name="note"></textarea></label>'}
        <button id="finishSession" type="submit" ${rows.length ? "disabled" : ""}>Lưu hoàn thành</button><p id="sessionError" role="alert"></p></form><button id="backSession" type="button">Về Home</button><p class="local-status">Kết quả lưu trên máy, chưa đồng bộ Sheet.</p></section>`;
        const form = document.getElementById("sessionForm");
        const checks = [...form.querySelectorAll("[data-exercise]")];
        checks.forEach(check=>check.addEventListener("change",()=>{
            const count = checks.filter(c=>c.checked).length, percent = Math.round(count/rows.length*100);
            document.getElementById("sessionBar").style.width=percent+"%";
            document.getElementById("sessionProgress").setAttribute("aria-valuenow",percent);
            document.getElementById("sessionCount").textContent=count+"/"+rows.length+" bài hoàn thành";
            document.getElementById("finishSession").disabled=count!==rows.length;
        }));
        let saved = false;
        form.addEventListener("submit",event=>{
            event.preventDefault();
            try {
                if (!active() || saved) throw new Error("Phiên tập đã kết thúc hoặc nhân vật/ngày đã đổi.");
                if (checks.some(c=>!c.checked)) throw new Error("Hãy hoàn thành từng bài trước khi lưu.");
                saveWorkoutEntry(type,form.elements.minutes.value,type === "calisthenics" ? rounds.length : form.elements.amount.value,type === "calisthenics" ? form.elements.note.value : "",item.target,item);
                saved=true;
                showHome();
            } catch(error) { document.getElementById("sessionError").textContent=error.message; }
        });
        document.getElementById("backSession").onclick=showHome;
    } catch(error) {
        if (!active()) return;
        app.innerHTML=`<section class="card"><h2>Không mở được bài tập</h2><p>${htmlText(error.message)}</p><p>Calisthenics cần API getWorkoutLibrary đã triển khai. Không dùng danh sách bài cố định thay thế.</p><button id="backSession">Về Home</button></section>`;
        document.getElementById("backSession").onclick=showHome;
    }
}

function htmlText(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function habitState(today) {
    return today.habits || { waterMl: 0, waterEntries: [], sleepHours: 0, steps: 0 };
}

function scheduledWorkout(plan) {
    return plan.some(item => resolveWorkoutType(item) !== null);
}

function homeProgress(today, plan) {
    const habits = habitState(today);
    const targets=getHabitTargets(today.userId);
    const achieved = ["waterMl","sleepHours","steps"].reduce((sum,key)=>sum+Number(targets[key]>0 && habits[key]>=targets[key]),0);
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
    today.habitEdited = {...(today.habitEdited || {}), [kind]:true};
    if (kind === "waterMl") {
        today.habits.waterMl += number;
        today.habits.waterEntries.push({ amountMl: number, at: new Date().toISOString() });
    } else today.habits[kind] = number;
    today.completedDay = homeProgress(today, getTodayPlan()) === 100;
    saveTodayData(today);
}

function saveWorkoutEntry(type, minutes, amount, note, targetOverride, source = {}) {
    if (!Object.hasOwn(WORKOUT_TYPES, type)) throw new Error("Hoạt động không hợp lệ.");
    const duration = Number(minutes), quantity = Number(amount);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Thời gian và kết quả phải lớn hơn 0.");
    if (type === "calisthenics" && !Number.isInteger(quantity)) throw new Error("Số vòng phải là số nguyên.");
    const today = getTodayData();
    const entry = { id: Date.now() + "-" + Math.random().toString(36).slice(2), type,
        minutes: duration, distance: type === "calisthenics" ? null : quantity,
        distanceUnit: type === "swimming" ? "m" : "km", rounds: type === "calisthenics" ? quantity : null,
        note: String(note || ""), target: targetOverride ?? getTodayPlan().filter(item=>resolveWorkoutType(item) === type).map(item=>item.target).join("; "), workoutId:source.workoutId || source.personalWorkoutId || '',planKey:source.planKey || '',completed: true, at: new Date().toISOString() };
    today.workoutEntries = [...(today.workoutEntries || []), entry];
    today.completedDay = homeProgress(today, getTodayPlan()) === 100;
    saveTodayData(today);
}

// Named fields only: column mapping/unit conversion must be confirmed before connecting.
function prepareHomeSheetPayloads() {
    return { dailyLog: { sheet: "Daily Log", ...syncDayPayload(getTodayData()) } };
}

function showHome() {
    if (!getCurrentUserId()) return showUserSelector();
    if (!document.getElementById("homeV2Styles")) {
        const style = document.createElement("style");
        style.id = "homeV2Styles";
        style.textContent = `.habit-item{padding:16px 0;border-bottom:1px solid #e5e7eb}.habit-item:last-child{border-bottom:0}.habit-item h3{margin:0 0 10px;font-size:18px}.app form label{display:flex;flex-direction:column;gap:8px;margin:12px 0}.app form input,.app form select,.app form textarea{box-sizing:border-box;width:100%;min-width:0;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;background:#fff;color:#111827}.app form [hidden]{display:none!important}.app .form-error{color:#b91c1c;margin:8px 0}.local-status{font-size:13px;line-height:1.5;color:#6b7280}.app details{padding:12px 0}.app .progress-bar{height:12px;overflow:hidden;border-radius:999px;background:#e5e7eb}.app article p{overflow-wrap:anywhere}@media(max-width:600px){.app{padding:20px 14px!important}.app .card{padding:20px!important;border-radius:20px!important}.app h1{font-size:30px!important}.app h2{font-size:20px!important}}`;
        style.textContent += `.app button{width:auto;max-width:100%;min-height:40px;padding:9px 16px;margin-top:8px;border-radius:10px;font-size:14px;line-height:1.4}.app .replacement-workout{border-top:1px solid #e5e7eb;margin-top:16px;padding-top:16px}.app .replacement-workout h3{font-size:18px;margin:0 0 12px}.app .workout-actions{display:flex;flex-wrap:wrap;gap:8px}.app .replacement-workout input,.app .replacement-workout select,.app .replacement-workout textarea{padding:10px}.app .replacement-workout textarea{min-height:64px}`;
        style.textContent += `.app .habit-target-line{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:12px 0;color:#64748b}.app .habit-target-line button[data-edit-target]{display:inline-flex;align-items:center;gap:5px;min-height:32px;margin:0;padding:5px 10px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-weight:500;line-height:1.4;box-shadow:none}.app .habit-target-line button[data-edit-target]:hover{background:#eef2f6;border-color:#cbd5e1;color:#0f172a}.app button[data-edit-target]:focus-visible{outline:2px solid #64748b;outline-offset:3px}.app form[data-target-form]{padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin:8px 0 14px}.app form[data-target-form][hidden]{display:none!important}.app form[data-target-form] label{margin-top:0;font-size:14px}`;
        document.head.appendChild(style);
    }
    const app = document.querySelector(".app");
    if (!app) return;
    app.workoutToken = null;
    if (app.stopWorkoutTimer) app.stopWorkoutTimer();
    const today = getTodayData(), habits = habitState(today), plan = getTodayPlan();
    const percent = homeProgress(today, plan);
    const targets=getHabitTargets();
    const displayTarget=kind=>targets[kind]>0 ? (kind==="waterMl" ? targets[kind]/1000 : targets[kind]) : "Chưa đặt";
    const habitCard = (kind, title, unit, label, step) => `<article class="habit-item">
        <h3>${title}</h3><p class="habit-target-line"><span>Mục tiêu: ${displayTarget(kind)} ${unit}</span><button type="button" data-edit-target="${kind}"><span aria-hidden="true">✎</span> Sửa mục tiêu</button></p>
        <form data-target-form="${kind}" hidden><label>Mục tiêu (${unit})<input name="targetValue" type="number" min="${step}" step="${step}" value="${targets[kind]>0 ? displayTarget(kind) : ""}" required></label><button type="submit">Lưu mục tiêu</button><p role="alert"></p></form>
        <p>Thực tế: <strong>${kind === "waterMl" ? Number((habits[kind]/1000).toFixed(3)) : habits[kind]} ${unit}</strong> · ${targets[kind]>0 && habits[kind]>=targets[kind] ? "✅ Đạt" + (habits[kind]>targets[kind] ? " · Dư " + Number(((habits[kind]-targets[kind])/(kind==="waterMl"?1000:1)).toFixed(3)) + " " + unit : "") : "Chưa đạt"}</p>
        <form data-habit="${kind}"><label>${kind === "waterMl" ? "Thêm nước (L)" : "Tổng hôm nay (" + unit + ")"}<input name="value" type="number" inputmode="decimal" min="${kind === "waterMl" ? 0.001 : 0}" step="${step}" ${kind === "sleepHours" ? 'max="24"' : ''} required></label>
        <button type="submit">${label}</button><p class="form-error" role="alert"></p></form></article>`;
    app.innerHTML = `<header class="header"><h1>Fitness Tracker</h1><p>${htmlText(getCurrentUserName())}</p><p>${new Date().toLocaleDateString("vi-VN",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"})}</p></header>
        <section class="card"><h2>🔥 Streak</h2><p>Chuỗi hiện tại: <strong>${calculateCurrentStreak()} ngày</strong></p><p>Kỷ lục cao nhất: <strong>${calculateBestStreak()} ngày</strong></p></section>
        <section class="card"><h2>📊 Tiến độ hôm nay</h2><div class="progress-bar" role="progressbar" aria-label="Tiến độ hôm nay" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div style="width:${percent}%;height:100%;background:#111827"></div></div><p><strong>${percent}% hoàn thành</strong></p></section>
        <section class="card"><h2>📝 Thói quen hàng ngày</h2>
        ${habitCard("waterMl","💧 Uống nước","L","+ Nhập nước",0.001)}
        <details><summary>Lịch sử uống nước · ${Number((habits.waterMl/1000).toFixed(3))}/${displayTarget("waterMl")} L</summary>${habits.waterEntries.map(e=>`<p>${new Date(e.at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})} +${Number((e.amountMl/1000).toFixed(3))} L</p>`).join("") || '<p>Chưa có lần nhập nào.</p>'}</details>
        ${habitCard("sleepHours","💤 Giấc ngủ","giờ","Nhập giờ ngủ",0.1)}
        ${habitCard("steps","🚶 Số bước","bước","Nhập bước",1)}</section>
        <section class="card"><h2>📝 Cơ thể &amp; Ăn uống</h2><form id="bodyForm"><label>⚖️ Cân nặng (kg)<input name="weight" type="number" min="0.1" step="0.1" value="${htmlText(today.weight ?? "")}" placeholder="Không bắt buộc"></label><button type="submit">Lưu cân nặng</button><p role="alert"></p></form><label><input id="foodControlled" type="checkbox" ${today.foodControlled ? "checked" : ""}> Ăn uống có kiểm soát</label></section>
        <section class="card"><h2>🎯 Hôm nay tập gì?</h2>${plan.map((item,index)=>`<article class="habit-item"><h3>${htmlText(item.activity)}</h3><p>Mục tiêu: ${htmlText(item.duration)} · ${htmlText(item.target)}</p><p>Giờ dự kiến: ${htmlText(item.time)}</p>${isPlannedWorkoutComplete(item, today) ? '<p role="status" style="color:#15803d;font-weight:600">✅ Đã hoàn thành bài tập hôm nay</p>' : resolveWorkoutType(item) ? `<button type="button" data-start-workout="${index}">Bắt đầu tập</button>` : ""}</article>`).join("") || '<p>Chưa có kế hoạch cho hôm nay trong Weekly Plan.</p>'}
        <div class="replacement-workout"><h3>Workout thay thế</h3><label for="actualWorkoutType">Hoạt động</label><select id="actualWorkoutType" style="width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit">${Object.entries(WORKOUT_TYPES).map(([id,label])=>`<option value="${id}">${label}</option>`).join("")}</select>
        <div class="workout-actions"><button id="startReplacement" type="button">Bắt đầu bài thay thế</button><button id="personalWorkouts" type="button">Bài tập của tôi · + Tạo bài</button></div>
        ${(today.workoutEntries || []).map(e=>`<p>✅ ${WORKOUT_TYPES[e.type]} · ${e.minutes} phút · ${e.rounds === null ? e.distance + " " + e.distanceUnit : e.rounds + " vòng"}${e.note ? " · " + htmlText(e.note) : ""}</p>`).join("")}
        <p class="local-status">${pendingFitnessDays(getCurrentUserId()).length ? "Có dữ liệu trên máy chưa đồng bộ." : "Dữ liệu đã gửi sẽ được giữ lại trên máy."}</p><button id="syncFitnessButton" type="button" ${fitnessSyncBusy ? "disabled" : ""}>${fitnessSyncBusy ? "Đang đồng bộ…" : "Đồng bộ Google Sheet"}</button><p role="status" class="local-status">${htmlText(fitnessSyncMessages[getCurrentUserId()] || "Đồng bộ thói quen, cơ thể và tổng kết workout vào Daily Log.")}</p></div></section>`;
    document.getElementById("syncFitnessButton").onclick=syncFitnessToSheet;
    document.getElementById("personalWorkouts").onclick=showPersonalWorkouts;
    const selected = CURRENT_USER, date = getDateKey();
    app.querySelectorAll("[data-start-workout]").forEach(button=>button.onclick=()=>beginWorkout(plan[Number(button.dataset.startWorkout)]));
    document.getElementById("startReplacement").onclick=()=>{
        const type=document.getElementById("actualWorkoutType").value;
        if(type==='calisthenics'){showPersonalWorkouts();return;}
        beginWorkout({type,activity:WORKOUT_TYPES[type]});
    };
    const guard = () => { if (CURRENT_USER !== selected || getDateKey() !== date) throw new Error("Nhân vật hoặc ngày đã đổi. Hãy tải lại trang."); };
    app.querySelectorAll("[data-edit-target]").forEach(button=>button.onclick=()=>{const form=app.querySelector('[data-target-form="'+button.dataset.editTarget+'"]');form.hidden=!form.hidden;});
    app.querySelectorAll("[data-target-form]").forEach(form=>form.onsubmit=event=>{event.preventDefault();try{guard();saveHabitTarget(form.dataset.targetForm,form.elements.targetValue.value);showHome();}catch(error){form.querySelector('[role="alert"]').textContent=error.message;}});
    document.getElementById("bodyForm").onsubmit=event=>{event.preventDefault();try{guard();saveBodyData(event.currentTarget.elements.weight.value,null);showHome();}catch(error){event.currentTarget.querySelector('[role="alert"]').textContent=error.message;}};
    document.getElementById("foodControlled").onchange=event=>{guard();saveBodyData(null,event.target.checked);};
    app.querySelectorAll("[data-habit]").forEach(form => form.addEventListener("submit", event => {
        event.preventDefault();
        try { guard(); const value = form.elements.value.value; saveHabitValue(form.dataset.habit, form.dataset.habit === "waterMl" && value.trim() !== "" ? Math.round(Number(value)*1000) : value); showHome(); }
        catch (error) { form.querySelector(".form-error").textContent = error.message; }
    }));
}

 // ============================================================
// FITNESS TRACKER - APP.JS
// ============================================================

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxAyqJEJXcwqI35taptXmhtd315b0ppGGHYG3c79KIVNX64USazYxANYgZ2B8sad3hVSw/exec";

const PLAN_START_DATE = "2026-09-21";

const STORAGE_KEY = "fitness_tracker_v5";


let CURRENT_USER = {
    userId: "",
    userName: ""
};

let TODAY_WORKOUT = null;
let CURRENT_USER_PLAN = [];
async function loadUsers() {

    const response =
        await fetch(
            WEB_APP_URL +
            "?action=getUsers"
        );


    const result =
        await response.json();
    console.log("USER RESULT:", result);
    if(!result.success){

        console.error(
            result.error
        );

        return [];

    }


    return (Array.isArray(result.data) ? result.data : []).map(user => ({
        ...user,
        userId: String(user.userId ?? user.User_ID ?? "").trim(),
        userName: user.userName ?? user.User_Name ?? ""
    })).filter(user => user.userId);

}
async function showUserSelector(){
    CURRENT_USER_PLAN = [];
    CURRENT_USER = { userId: "", userName: "" };
    TODAY_WORKOUT = null;
    currentActivity = null;

    const users = await loadUsers();

    const box =
    document.getElementById("app");

    if(!box) return;


    box.innerHTML = `

    <style>
      #app .profile-picker{max-width:440px;margin:clamp(16px,7vh,72px) auto;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 12px 36px rgba(15,23,42,.06)}
      #app .profile-mark{width:52px;height:52px;display:grid;place-items:center;background:#ecfdf5;border-radius:16px;font-size:26px;margin-bottom:20px}
      #app .profile-brand{font-size:12px;letter-spacing:1.5px;color:#6b7280;font-weight:700;margin:0 0 10px}
      #app .profile-picker h2{font-size:28px;margin:0 0 10px;letter-spacing:-.5px}
      #app .profile-intro{font-size:15px;line-height:1.6;color:#6b7280;margin:0 0 24px}
      #app .profile-label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}
      #app #userDropdown{width:100%;min-height:50px;padding:12px 14px;border:1px solid #d1d5db;border-radius:12px;background:#f9fafb;color:#111827;font:inherit;font-size:16px;cursor:pointer}
      #app #userDropdown:focus-visible,#app #createUserBtn:focus-visible{outline:3px solid #6ee7b7;outline-offset:3px}
      #app .profile-divider{height:1px;background:#f0f1f3;margin:24px 0 18px}
      #app #createUserBtn{display:inline-flex;align-items:center;justify-content:center;width:auto;max-width:100%;min-height:44px;padding:10px 16px;margin:0;border:1px solid #d1d5db;border-radius:10px;background:#fff;color:#111827;font-size:14px;font-weight:600;cursor:pointer}
      #app #createUserBtn:hover{background:#f3f4f6}
      #app .profile-note{font-size:12px;line-height:1.5;color:#6b7280;margin:18px 0 0}
      @media(max-width:480px){#app .profile-picker{padding:24px;margin:16px auto}#app .profile-picker h2{font-size:26px}}
    </style>
    <section class="profile-picker" aria-labelledby="profileTitle">
    <div class="profile-mark" aria-hidden="true">💪</div>
    <p class="profile-brand">FITNESS TRACKER</p>
    <h2 id="profileTitle">Bạn là ai?</h2>
    <p class="profile-intro">Chọn nhân vật để bắt đầu buổi tập hôm nay.</p>
    <label class="profile-label" for="userDropdown">Nhân vật của bạn</label>


    <select id="userDropdown">

        <option value="">
            ▼ Chọn nhân vật
        </option>

    </select>


    <div class="profile-divider"></div>


    <button id="createUserBtn">
        ➕ Tạo nhân vật mới
    </button>
    <p class="profile-note">Tiến độ và kết quả được lưu riêng cho từng nhân vật.</p>
    </section>

    `;


    const dropdown =
    document.getElementById("userDropdown");


    users.forEach(user=>{

        const option =
        document.createElement("option");


        option.value =
        user.userId;


        option.textContent =
        `${user.avatar || "💪"} ${user.userName}`;


        dropdown.appendChild(option);


    });



    dropdown.onchange = function(){

        const user =
        users.find(
            x=>x.userId === this.value
        );


        if(user){

            selectUser(user);

        }

    };



    document
    .getElementById("createUserBtn")
    .onclick=function(){

        showCreateUser();

    };


}
function ownsCurrentUser(row) {
    const id = getCurrentUserId();
    if (!id || !row) return false;
    const ids = [row.User_ID, row.userId].filter(value => value != null);
    return ids.length > 0 && ids.every(value => String(value).trim() === id);
}

function filterCurrentUserRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(ownsCurrentUser);
}

function requireCurrentUser() {
    if (!getCurrentUserId()) throw new Error("Vui lòng chọn nhân vật trước.");
}
async function loadTodayWorkout(){
    CURRENT_USER_PLAN = [];
    requireCurrentUser();
    const requestedUser = CURRENT_USER;
    TODAY_WORKOUT = null;


    const response =
        await fetch(

            WEB_APP_URL +
            "?action=getTodayWorkout" +
            "&userId=" +
            encodeURIComponent(requestedUser.userId)

        );


    const result =
        await response.json();



    if(!result.success){

        console.error(
            result.error
        );

        throw new Error(result.error || "Không tải được kế hoạch của nhân vật.");

    }


    if (CURRENT_USER !== requestedUser) return;
    CURRENT_USER_PLAN = filterCurrentUserRows(Array.isArray(result.workouts)
        ? result.workouts : (Array.isArray(result.data) ? result.data : [result.data]));
    TODAY_WORKOUT = filterCurrentUserRows(
        Array.isArray(result.data) ? result.data : [result.data]
    )[0] || null;


    renderTodayWorkout();

}
function renderTodayWorkout(){
    if (!TODAY_WORKOUT) return;


    const box =
        document.getElementById(
            "todayWorkout"
        );


    if(!box) return;



    box.innerHTML =

    `
    <h2>
    🎯 Hôm nay phải làm gì?
    </h2>


    <h1>
    ${TODAY_WORKOUT.activity}
    </h1>


    <p>
    ⏱ ${TODAY_WORKOUT.duration}
    </p>


    <p>
    🎯 ${TODAY_WORKOUT.target}
    </p>


    <button onclick="startWorkout()">
    Bắt đầu tập
    </button>

    `;


}


// ============================================================
// DAILY CHECK
// ============================================================

const DAILY_CHECKS = [
    {
        id: "steps",
        name: "🚶 8.000 bước"
    },
    {
        id: "water",
        name: "💧 Uống đủ nước"
    },
    {
        id: "sleep",
        name: "😴 Ngủ đủ giấc"
    },
    {
        id: "food",
        name: "🍚 Ăn uống đúng mục tiêu"
    }
];


// ============================================================
// CALISTHENICS
// ============================================================

const CALISTHENICS_EXERCISES = [
    {
        name: "Squat",
        target: "15 reps"
    },
    {
        name: "Push Up",
        target: "10 reps"
    },
    {
        name: "Lunges",
        target: "10 reps mỗi chân"
    },
    {
        name: "Glute Bridge",
        target: "15 reps"
    },
    {
        name: "Plank",
        target: "45 giây"
    }
];


let weeklyPlan = [];
let currentActivity = null;
let currentRound = 1;
let currentTargetRounds = 3;


// ============================================================
// START
// ============================================================

document.addEventListener("DOMContentLoaded", async function () {

    try {

        await initializeApp();

    } catch (error) {

        console.error(error);

        const app = document.querySelector(".app");

        if (app) {
            app.innerHTML = `
                <section class="card">
                    <h2>⚠️ Không tải được ứng dụng</h2>
                    <p>${error.message}</p>
                </section>
            `;
        }

    }

    window.dispatchEvent(
        new Event("fitnessAppReady")
    );

});


// ============================================================
// INITIALIZE
// ============================================================

async function initializeApp() {
    CURRENT_USER = { userId: "", userName: "" };
    TODAY_WORKOUT = null;

    if (
        !WEB_APP_URL ||
        WEB_APP_URL.includes("DÁN_URL_WEB_APP")
    ) {

        showUrlError();
        return;

    }


    await loadWeeklyPlan();


    await showUserSelector();

}
// ============================================================
// URL ERROR
// ============================================================

function showUrlError() {

    const app =
        document.querySelector(".app");

    if (!app) return;

    app.innerHTML = `
        <section class="card">
            <h2>⚠️ Chưa có Web App URL</h2>
            <p>
                Hãy dán URL Google Apps Script
                vào biến WEB_APP_URL trong app.js.
            </p>
        </section>
    `;

}


// ============================================================
// LOAD WEEKLY PLAN
// ============================================================

async function loadWeeklyPlan() {
    const selected=CURRENT_USER, userId=getCurrentUserId();
    if(!userId){weeklyPlan=[];return;}

    try {

        const response = await fetch(
            WEB_APP_URL +
            "?action=weeklyPlan&userId=" + encodeURIComponent(userId) + "&_=" + Date.now(),
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error(
                "HTTP " + response.status
            );
        }

        const result =
            await response.json();

        if (!result.success) {
            throw new Error(
                result.error ||
                "Không đọc được Weekly Plan"
            );
        }

        if(CURRENT_USER!==selected)return;
        if(result.planSchemaVersion!==3 || result.userId!==userId || !Array.isArray(result.data))throw new Error('Cần triển khai backend lịch cá nhân mới (User ID + Workout ID).');
        result.data=result.data.filter(item=>item.userId===userId);
        CURRENT_USER.hasAssignedPlan=result.data.length>0;
        weeklyPlan =
            Array.isArray(result.data)
                ? result.data
                : [];

        console.log(
            "Weekly Plan:",
            weeklyPlan
        );

    } catch (error) {

        if(CURRENT_USER!==selected)return;
        weeklyPlan = [];
        throw error;

    }

}


// ============================================================
// DATE
// ============================================================

function getTodayDate() {

    const now = new Date();

    return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );

}


function getDateKey(
    date = getTodayDate()
) {

    const y =
        date.getFullYear();

    const m =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const d =
        String(
            date.getDate()
        ).padStart(2, "0");

    return `${y}-${m}-${d}`;

}


// ============================================================
// WEEK
// ============================================================

function getCurrentWeek() {

    const today =
        getTodayDate();

    const start =
        new Date(
            PLAN_START_DATE +
            "T00:00:00"
        );

    const difference =
        today.getTime() -
        start.getTime();

    const days =
        Math.floor(
            difference /
            (
                1000 *
                60 *
                60 *
                24
            )
        );

    if (days < 0) {
        return 1;
    }

    return Math.floor(
        days / 7
    ) + 1;

}


// ============================================================
// DAY
// ============================================================

function getDayName(
    date = getTodayDate()
) {

    const map = {
        0: "CN",
        1: "T2",
        2: "T3",
        3: "T4",
        4: "T5",
        5: "T6",
        6: "T7"
    };

    return map[
        date.getDay()
    ];

}


// ============================================================
// TEXT NORMALIZE
// ============================================================

function normalizeText(value) {

    return String(
        value ?? ""
    )
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        );

}


// ============================================================
// WEEK NUMBER
// ============================================================

function parseWeekNumber(value) {

    const match =
        String(
            value ?? ""
        ).match(/(\d+)/);

    if (!match) {
        return null;
    }

    return Number(match[1]);

}


// ============================================================
// DAY NORMALIZE
// ============================================================

function normalizeDay(day) {

    if(!day) return "";


    const text =
        String(day)
        .toLowerCase()
        .trim()
        .replace("ứ","u")
        .replace("ă","a");


    const map = {

        "thu 2":"T2",
        "thu2":"T2",
        "t2":"T2",

        "thu 3":"T3",
        "thu3":"T3",
        "t3":"T3",

        "thu 4":"T4",
        "thu4":"T4",
        "t4":"T4",

        "thu 5":"T5",
        "thu5":"T5",
        "t5":"T5",

        "thu 6":"T6",
        "thu6":"T6",
        "t6":"T6",

        "thu 7":"T7",
        "thu7":"T7",
        "t7":"T7",

        "chu nhat":"CN",
        "cn":"CN"

    };


    return map[text] || text;

}

// ============================================================
// TODAY PLAN
// ============================================================

function getTodayPlan() {
    if (!getCurrentUserId()) return [];
    const week = getCurrentWeek();
    const dayNo = getTodayDate().getDay() || 7;
    return weeklyPlan.filter(item =>
        item.userId === getCurrentUserId() &&
        parseWeekNumber(item.week) === week &&
        (item.dayNo != null && item.dayNo !== ""
            ? Number(item.dayNo) === dayNo
            : normalizeDay(item.day) === getDayName())
    );
}

// ============================================================
// LOCAL STORAGE
// ============================================================

function loadLocalData() {

    try {

        const raw =
            localStorage.getItem(
                STORAGE_KEY
            );

        return raw
            ? JSON.parse(raw)
            : {};

    } catch (error) {

        return {};

    }

}


function saveLocalData(data) {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
    );

}


// ============================================================
// USER
// ============================================================

function getCurrentUserId() {
    return String(CURRENT_USER.userId || "").trim();

}


function getCurrentUserName() {
    return CURRENT_USER.userName || "";

}


// ============================================================
// TODAY DATA
// ============================================================

function getTodayData() {
    requireCurrentUser();

    const all =
        loadLocalData();

    const key =
        getCurrentUserId() +
        "_" +
        getDateKey();

    if (!ownsCurrentUser(all[key])) {

        all[key] = {

            userId:
                getCurrentUserId(),

            date:
                getDateKey(),

            activities: {},

            checks: {},

            results: {},

            completedDay: false,

            quickLogSaved: false

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

    const all =
        loadLocalData();

    const key =
        getCurrentUserId() +
        "_" +
        getDateKey();

    all[key] = data;

    saveLocalData(all);

}


// ============================================================
// HOME
// ============================================================

function showLegacyHome() {
    if (!getCurrentUserId()) return showUserSelector();

    const app =
        document.querySelector(".app");

    if (!app) return;


    const todayPlan =
        getTodayPlan();


    app.innerHTML = `

        <header class="header">

            <h1>
                Fitness Tracker
            </h1>

            <p>
                ${getCurrentUserName()}
            </p>

            <p>
                ${new Date().toLocaleDateString(
                    "vi-VN",
                    {
                        weekday: "long",
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric"
                    }
                )}
            </p>

        </header>


        <section class="card">

            <div class="card-title">
                🔥 Chuỗi hoàn thành
            </div>

            <div id="streakBox"></div>

        </section>


        <section class="card">

            <div class="card-title">
                📅 Tiến độ hôm nay
            </div>

            <div class="progress-bar">

                <div
                    id="dayProgress"
                    style="width:0%"
                ></div>

            </div>

            <p>
                <strong>
                    <span id="dayProgressText">
                        0
                    </span>%
                </strong>
            </p>

        </section>


        <section class="card">

            <div class="card-title">
                🎯 Hôm nay phải làm gì?
            </div>

            <div id="todayTasks"></div>

        </section>


        <section class="card">

            <div class="card-title">
                📋 Daily Check
            </div>

            <div id="dailyCheck"></div>

        </section>


        <section class="card">

            <div class="card-title">
                📊 Tổng kết hôm nay
            </div>

            <div id="todaySummary"></div>

        </section>


        <section class="card">

            <div class="card-title">
                ⚖️ Ghi nhận hôm nay
            </div>

            <div class="grid2">

                <label>
                    Cân nặng (kg)

                    <input
                        id="homeWeight"
                        type="number"
                        step="0.1"
                    >
                </label>


                <label>
                    Giấc ngủ (giờ)

                    <input
                        id="homeSleep"
                        type="number"
                        step="0.5"
                    >
                </label>


                <label>
                    Nước (L)

                    <input
                        id="homeWater"
                        type="number"
                        step="0.1"
                    >
                </label>


                <label>
                    Số bước

                    <input
                        id="homeSteps"
                        type="number"
                    >
                </label>

            </div>


            <button
                id="saveQuickBtn"
                type="button"
            >
                Lưu hôm nay
            </button>


            <button
                id="resetTestBtn"
                type="button"
                style="
                    margin-top:10px;
                    background:#6b7280;
                "
            >
                🧪 Reset hôm nay (TEST)
            </button>


            <p
                id="saveStatus"
                class="status"
            ></p>

        </section>

    `;


    renderStreak();

    renderTodayTasks(
        todayPlan
    );

    renderDailyChecks();

    renderSummary();

    updateDayProgress();


    const saveButton =
        document.getElementById(
            "saveQuickBtn"
        );


    saveButton.addEventListener(
        "click",
        saveQuickLog
    );


    document
        .getElementById(
            "resetTestBtn"
        )
        .addEventListener(
            "click",
            resetTodayForTest
        );


    const today =
        getTodayData();


    if (
        today.quickLogSaved
    ) {

        saveButton.disabled =
            true;

        saveButton.textContent =
            "✅ Đã lưu hôm nay";

        saveButton.style.opacity =
            "0.6";

        document.getElementById(
            "saveStatus"
        ).textContent =
            "Dữ liệu hôm nay đã được lưu.";

    }

}


// ============================================================
// TODAY TASKS
// ============================================================

function renderTodayTasks(plan) {

    const container =
        document.getElementById(
            "todayTasks"
        );

    if (!container) return;


    const today =
        getTodayData();


    const unfinished =
        plan.filter(
            activity => {

                const id =
                    getActivityId(
                        activity
                    );

                return !today.activities[id];

            }
        );


    if (
        unfinished.length === 0
    ) {

        if (!plan.length) {
            container.textContent = "Chưa có lịch tập cho hôm nay trong Weekly Plan.";
            return;
        }
        container.innerHTML = `
            <p>
                🎉 Đã hoàn thành tất cả
                bài tập hôm nay.
            </p>
        `;

        return;

    }


    unfinished.forEach(
        activity => {

            const box =
                document.createElement(
                    "div"
                );

            box.className =
                "activity-item";


            box.innerHTML = `

                <div>

                    <strong>
                        ${getActivityIcon(
                            activity.activity
                        )}

                        ${activity.activity}
                    </strong>

                    <p>
                        Mục tiêu:
                        ${activity.target || "-"}
                    </p>

                    ${
                        activity.time
                        ? `
                            <p>
                                🕐 ${activity.time}
                            </p>
                        `
                        : ""
                    }

                    ${
                        activity.duration
                        ? `
                            <p>
                                ⏱ ${activity.duration}
                            </p>
                        `
                        : ""
                    }

                </div>


                <button
                    class="activity-button"
                    type="button"
                >
                    Mở
                </button>

            `;


            box.querySelector(
                ".activity-button"
            ).addEventListener(
                "click",
                () => openActivity(activity)
            );


            container.appendChild(
                box
            );

        }
    );

}


// ============================================================
// ACTIVITY TYPE
// ============================================================

function getActivityId(activity) {

    return getActivityType(
        activity.activity
    );

}


function getActivityType(name) {

    const text =
        normalizeText(name);


    if (
        text.includes("calis")
    ) {
        return "calisthenics";
    }


    if (
        text.includes("boi")
    ) {
        return "swimming";
    }


    if (
        text.includes("dap xe") ||
        text.includes("cycling")
    ) {
        return "cycling";
    }


    return text.replace(
        /\s+/g,
        "_"
    );

}


function getActivityIcon(name) {

    const type =
        getActivityType(name);


    if (
        type === "calisthenics"
    ) {
        return "🏋️";
    }


    if (
        type === "swimming"
    ) {
        return "🏊";
    }


    if (
        type === "cycling"
    ) {
        return "🚴";
    }


    return "🎯";

}


// ============================================================
// OPEN ACTIVITY
// ============================================================

function openActivity(activity) {

    currentActivity =
        activity;


    const type =
        getActivityType(
            activity.activity
        );


    if (
        type === "calisthenics"
    ) {

        startCalisthenics(
            activity
        );

        return;

    }


    if (
        type === "swimming"
    ) {

        startSwimming(
            activity
        );

        return;

    }


    if (
        type === "cycling"
    ) {

        startCycling(
            activity
        );

        return;

    }


    alert(
        "Hoạt động này chưa có giao diện nhập dữ liệu."
    );

}


// ============================================================
// CALISTHENICS
// ============================================================

function getTargetRounds(target) {

    const match =
        String(
            target ?? ""
        ).match(
            /(\d+)\s*(vòng|round|rounds)/i
        );


    return match
        ? Number(match[1])
        : 3;

}


function startCalisthenics(activity) {

    currentTargetRounds =
        getTargetRounds(
            activity.target
        );

    currentRound = 1;


    const app =
        document.querySelector(".app");


    app.innerHTML = `

        <header class="header">

            <h1>
                🏋️ Calisthenics
            </h1>

            <p>
                Mục tiêu:
                ${activity.target || "-"}
            </p>

            <p>
                ⏱ ${activity.duration || "-"}
            </p>

        </header>


        <section class="progress-box">

            <div class="progress-text">

                Vòng
                <span id="roundNumber">
                    1
                </span>
                /
                ${currentTargetRounds}

            </div>

            <div class="progress-bar">

                <div
                    id="workoutProgressFill"
                    style="width:0%"
                ></div>

            </div>

        </section>


        <div id="workout"></div>

    `;


    showCalisthenicsRound();

}


function showCalisthenicsRound() {

    const workout =
        document.getElementById(
            "workout"
        );


    workout.innerHTML = `

        <section class="card">

            <div class="card-title">

                Vòng
                ${currentRound}
                /
                ${currentTargetRounds}

            </div>

        </section>

    `;


    CALISTHENICS_EXERCISES.forEach(
        exercise => {

            const label =
                document.createElement(
                    "label"
                );


            label.className =
                "exercise";


            label.innerHTML = `

                <input
                    type="checkbox"
                >

                <span
                    class="exercise-text"
                >

                    <strong>
                        ${exercise.name}
                    </strong>

                    <br>

                    ${exercise.target}

                </span>

            `;


            label.querySelector(
                "input"
            ).addEventListener(
                "change",
                updateCalisthenicsProgress
            );


            workout.appendChild(
                label
            );

        }
    );

}


function updateCalisthenicsProgress() {

    const checks =
        document.querySelectorAll(
            "#workout input"
        );


    const completed =
        [
            ...checks
        ].filter(
            item =>
                item.checked
        ).length;


    const total =
        CALISTHENICS_EXERCISES.length;


    const percent =
        Math.round(
            (
                (
                    (
                        currentRound - 1
                    ) *
                    total +
                    completed
                )
                /
                (
                    currentTargetRounds *
                    total
                )
            ) *
            100
        );


    const bar =
        document.getElementById(
            "workoutProgressFill"
        );


    if (bar) {

        bar.style.width =
            percent + "%";

    }


    if (
        completed === total
    ) {

        if (
            currentRound <
            currentTargetRounds
        ) {

            setTimeout(
                () => {

                    currentRound++;

                    const roundNumber =
                        document.getElementById(
                            "roundNumber"
                        );

                    if (roundNumber) {
                        roundNumber.textContent =
                            currentRound;
                    }

                    showCalisthenicsRound();

                },
                350
            );

        } else {

            finishCalisthenics();

        }

    }

}


function finishCalisthenics() {

    const today =
        getTodayData();


    const id =
        getActivityId(
            currentActivity
        );


    today.activities[id] =
        true;


    today.results[id] = {

        rounds:
            currentTargetRounds,

        completedAt:
            new Date().toISOString()

    };


    saveTodayData(today);

    checkDayComplete();


    const app =
        document.querySelector(".app");


    app.innerHTML = `

        <header class="header">

            <h1>
                🎉 Hoàn thành
            </h1>

        </header>


        <section class="card">

            <h2>
                🏋️ Calisthenics
            </h2>

            <p>
                ${currentTargetRounds}
                /
                ${currentTargetRounds}
                vòng
            </p>

            <p>
                ✅ Đã chuyển vào Tổng kết hôm nay.
            </p>

            <button
                id="backHome"
                type="button"
            >
                Về trang chính
            </button>

        </section>

    `;


    document
        .getElementById("backHome")
        .addEventListener(
            "click",
            showHome
        );

}


// ============================================================
// SWIMMING
// ============================================================

function startSwimming(activity) {

    const app =
        document.querySelector(".app");


    app.innerHTML = `

        <header class="header">

            <h1>
                🏊 Bơi
            </h1>

            <p>
                Mục tiêu:
                ${activity.target || "-"}
            </p>

        </header>


        <section class="card">

            <label>

                Thời gian bơi (phút)

                <input
                    id="swimTime"
                    type="number"
                    min="0"
                >

            </label>

            <br>


            <label>

                Số lượt hồ

                <input
                    id="swimLaps"
                    type="number"
                    min="0"
                >

            </label>

            <br>


            <label>

                Chiều dài hồ (m)

                <input
                    id="swimPoolLength"
                    type="number"
                    min="1"
                    value="50"
                >

            </label>


            <p>

                Tổng quãng đường:

                <strong>
                    <span id="swimDistance">
                        0
                    </span>
                    m
                </strong>

            </p>


            <button
                id="completeSwimming"
                type="button"
            >
                ☑ Hoàn thành
            </button>


            <br><br>


            <button
                id="cancelSwimming"
                type="button"
            >
                Quay lại
            </button>

        </section>

    `;


    function updateSwimming() {

        const laps =
            Number(
                document.getElementById(
                    "swimLaps"
                ).value
            ) || 0;


        const length =
            Number(
                document.getElementById(
                    "swimPoolLength"
                ).value
            ) || 0;


        document.getElementById(
            "swimDistance"
        ).textContent =
            laps * length;

    }


    document
        .getElementById("swimLaps")
        .addEventListener(
            "input",
            updateSwimming
        );


    document
        .getElementById("swimPoolLength")
        .addEventListener(
            "input",
            updateSwimming
        );


    document
        .getElementById("completeSwimming")
        .addEventListener(
            "click",
            function () {

                const time =
                    Number(
                        document.getElementById(
                            "swimTime"
                        ).value
                    ) || 0;


                const laps =
                    Number(
                        document.getElementById(
                            "swimLaps"
                        ).value
                    ) || 0;


                const length =
                    Number(
                        document.getElementById(
                            "swimPoolLength"
                        ).value
                    ) || 0;


                if (
                    time <= 0 ||
                    laps <= 0 ||
                    length <= 0
                ) {

                    alert(
                        "Vui lòng nhập đầy đủ thông tin."
                    );

                    return;

                }


                const today =
                    getTodayData();


                const id =
                    getActivityId(
                        activity
                    );


                today.activities[id] =
                    true;


                today.results[id] = {

                    time,
                    laps,
                    poolLength:
                        length,

                    distance:
                        laps * length,

                    target:
                        activity.target,

                    completedAt:
                        new Date().toISOString()

                };


                saveTodayData(today);

                checkDayComplete();

                showHome();

            }
        );


    document
        .getElementById("cancelSwimming")
        .addEventListener(
            "click",
            showHome
        );

}


// ============================================================
// CYCLING
// ============================================================

function startCycling(activity) {

    const app =
        document.querySelector(".app");


    app.innerHTML = `

        <header class="header">

            <h1>
                🚴 Đạp xe
            </h1>

            <p>
                Mục tiêu:
                ${activity.target || "-"}
            </p>

        </header>


        <section class="card">

            <h3>
                Lượt đi
            </h3>

            <div class="grid2">

                <label>
                    Quãng đường km

                    <input
                        id="cycleGoKm"
                        type="number"
                        step="0.1"
                        min="0"
                    >
                </label>


                <label>
                    Thời gian phút

                    <input
                        id="cycleGoTime"
                        type="number"
                        min="0"
                    >
                </label>

            </div>


            <h3>
                Ở lại / chơi
            </h3>

            <div class="grid2">

                <label>
                    Giờ

                    <input
                        id="cycleStayHour"
                        type="number"
                        min="0"
                    >
                </label>


                <label>
                    Phút

                    <input
                        id="cycleStayMinute"
                        type="number"
                        min="0"
                    >
                </label>

            </div>


            <h3>
                Lượt về
            </h3>

            <div class="grid2">

                <label>
                    Quãng đường km

                    <input
                        id="cycleBackKm"
                        type="number"
                        step="0.1"
                        min="0"
                    >
                </label>


                <label>
                    Thời gian phút

                    <input
                        id="cycleBackTime"
                        type="number"
                        min="0"
                    >
                </label>

            </div>


            <div class="card">

                <p>
                    Tổng quãng đường:

                    <strong>
                        <span id="cycleTotalKm">
                            0
                        </span>
                        km
                    </strong>
                </p>


                <p>
                    Tổng thời gian đạp:

                    <strong>
                        <span id="cycleTotalRideTime">
                            0
                        </span>
                        phút
                    </strong>
                </p>


                <p>
                    Tổng thời gian chuyến:

                    <strong>
                        <span id="cycleTotalTripTime">
                            0
                        </span>
                        phút
                    </strong>
                </p>

            </div>


            <button
                id="completeCycling"
                type="button"
            >
                ☑ Hoàn thành
            </button>


            <br><br>


            <button
                id="cancelCycling"
                type="button"
            >
                Quay lại
            </button>

        </section>

    `;


    function updateCycling() {

        const goKm =
            Number(
                document.getElementById(
                    "cycleGoKm"
                ).value
            ) || 0;


        const backKm =
            Number(
                document.getElementById(
                    "cycleBackKm"
                ).value
            ) || 0;


        const goTime =
            Number(
                document.getElementById(
                    "cycleGoTime"
                ).value
            ) || 0;


        const backTime =
            Number(
                document.getElementById(
                    "cycleBackTime"
                ).value
            ) || 0;


        const stayHour =
            Number(
                document.getElementById(
                    "cycleStayHour"
                ).value
            ) || 0;


        const stayMinute =
            Number(
                document.getElementById(
                    "cycleStayMinute"
                ).value
            ) || 0;


        const totalKm =
            goKm + backKm;


        const totalRideTime =
            goTime + backTime;


        const totalTripTime =
            totalRideTime +
            stayHour * 60 +
            stayMinute;


        document.getElementById(
            "cycleTotalKm"
        ).textContent =
            totalKm.toFixed(1);


        document.getElementById(
            "cycleTotalRideTime"
        ).textContent =
            totalRideTime;


        document.getElementById(
            "cycleTotalTripTime"
        ).textContent =
            totalTripTime;

    }


    document
        .querySelectorAll(
            "#cycleGoKm," +
            "#cycleGoTime," +
            "#cycleStayHour," +
            "#cycleStayMinute," +
            "#cycleBackKm," +
            "#cycleBackTime"
        )
        .forEach(
            input =>
                input.addEventListener(
                    "input",
                    updateCycling
                )
        );


    document
        .getElementById("completeCycling")
        .addEventListener(
            "click",
            function () {

                const goKm =
                    Number(
                        document.getElementById(
                            "cycleGoKm"
                        ).value
                    ) || 0;


                const goTime =
                    Number(
                        document.getElementById(
                            "cycleGoTime"
                        ).value
                    ) || 0;


                const stayHour =
                    Number(
                        document.getElementById(
                            "cycleStayHour"
                        ).value
                    ) || 0;


                const stayMinute =
                    Number(
                        document.getElementById(
                            "cycleStayMinute"
                        ).value
                    ) || 0;


                const backKm =
                    Number(
                        document.getElementById(
                            "cycleBackKm"
                        ).value
                    ) || 0;


                const backTime =
                    Number(
                        document.getElementById(
                            "cycleBackTime"
                        ).value
                    ) || 0;


                if (
                    goKm <= 0 &&
                    backKm <= 0
                ) {

                    alert(
                        "Vui lòng nhập quãng đường."
                    );

                    return;

                }


                const today =
                    getTodayData();


                const id =
                    getActivityId(
                        activity
                    );


                today.activities[id] =
                    true;


                today.results[id] = {

                    goKm,
                    goTime,

                    stayHour,
                    stayMinute,

                    backKm,
                    backTime,

                    totalKm:
                        goKm + backKm,

                    totalRideTime:
                        goTime + backTime,

                    totalTripTime:
                        goTime +
                        backTime +
                        stayHour * 60 +
                        stayMinute,

                    target:
                        activity.target,

                    completedAt:
                        new Date().toISOString()

                };


                saveTodayData(today);

                checkDayComplete();

                showHome();

            }
        );


    document
        .getElementById("cancelCycling")
        .addEventListener(
            "click",
            showHome
        );

}


// ============================================================
// DAILY CHECK
// ============================================================

function renderDailyChecks() {

    const container =
        document.getElementById(
            "dailyCheck"
        );

    if (!container) return;


    const today =
        getTodayData();


    container.innerHTML = "";


    DAILY_CHECKS.forEach(
        item => {

            if (
                today.checks[item.id]
            ) {

                return;

            }


            const label =
                document.createElement(
                    "label"
                );


            label.className =
                "check-row";


            label.innerHTML = `

                <input
                    type="checkbox"
                >

                <span>
                    ${item.name}
                </span>

            `;


            label
                .querySelector("input")
                .addEventListener(
                    "change",
                    function () {

                        if (
                            this.checked
                        ) {

                            today.checks[
                                item.id
                            ] = true;

                            saveTodayData(
                                today
                            );

                            checkDayComplete();

                            showHome();

                        }

                    }
                );


            container.appendChild(
                label
            );

        }
    );


    if (
        container.children.length === 0
    ) {

        container.innerHTML = `
            <p>
                ✅ Daily Check đã hoàn thành.
            </p>
        `;

    }

}


// ============================================================
// SUMMARY
// ============================================================

function renderSummary() {

    const container =
        document.getElementById(
            "todaySummary"
        );

    if (!container) return;


    const today =
        getTodayData();


    let html = "";


    Object.entries(
        today.results
    ).forEach(
        ([id, result]) => {

            if (
                id === "calisthenics"
            ) {

                html += `
                    <div class="summary-item">

                        <strong>
                            🏋️ Calisthenics
                        </strong>

                        <span>
                            ${result.rounds}
                            vòng · ✅
                        </span>

                    </div>
                `;

            }


            if (
                id === "swimming"
            ) {

                html += `
                    <div class="summary-item">

                        <strong>
                            🏊 Bơi
                        </strong>

                        <span>
                            ${result.distance} m ·
                            ${result.time} phút ·
                            ${result.laps} lượt hồ · ✅
                        </span>

                    </div>
                `;

            }


            if (
                id === "cycling"
            ) {

                html += `
                    <div class="summary-item">

                        <strong>
                            🚴 Đạp xe
                        </strong>

                        <span>
                            ${result.totalKm.toFixed(1)}
                            km ·
                            ${result.totalRideTime}
                            phút đạp ·
                            ${result.stayHour}
                            giờ
                            ${result.stayMinute}
                            phút nghỉ · ✅
                        </span>

                    </div>
                `;

            }

        }
    );


    DAILY_CHECKS.forEach(
        item => {

            if (
                today.checks[item.id]
            ) {

                html += `
                    <div class="summary-item">

                        <strong>
                            ${item.name}
                        </strong>

                        <span>
                            ✅
                        </span>

                    </div>
                `;

            }

        }
    );


    container.innerHTML =
        html ||
        `
            <p>
                Chưa có mục nào
                hoàn thành hôm nay.
            </p>
        `;

}


// ============================================================
// DAY PROGRESS
// ============================================================

function updateDayProgress() {

    const today =
        getTodayData();


    const plan =
        getTodayPlan();


    const total =
        plan.length +
        DAILY_CHECKS.length;


    let completed = 0;


    plan.forEach(
        activity => {

            const id =
                getActivityId(
                    activity
                );

            if (
                today.activities[id]
            ) {

                completed++;

            }

        }
    );


    DAILY_CHECKS.forEach(
        item => {

            if (
                today.checks[item.id]
            ) {

                completed++;

            }

        }
    );


    const percent =
        total === 0
            ? 0
            : Math.round(
                (
                    completed /
                    total
                ) * 100
            );


    const bar =
        document.getElementById(
            "dayProgress"
        );


    const text =
        document.getElementById(
            "dayProgressText"
        );


    if (bar) {
        bar.style.width =
            percent + "%";
    }


    if (text) {
        text.textContent =
            percent;
    }

}


// ============================================================
// COMPLETE DAY
// ============================================================

function checkDayComplete() {

    const today =
        getTodayData();


    const plan =
        getTodayPlan();


    const activitiesDone =
        plan.every(
            activity => {

                const id =
                    getActivityId(
                        activity
                    );

                return Boolean(
                    today.activities[id]
                );

            }
        );


    const checksDone =
        DAILY_CHECKS.every(
            item =>
                Boolean(
                    today.checks[
                        item.id
                    ]
                )
        );


    if (
        activitiesDone &&
        checksDone
    ) {

        today.completedDay =
            true;

        saveTodayData(
            today
        );

    }

}


// ============================================================
// STREAK
// ============================================================

function calculateCurrentStreak() {

    const all =
        loadLocalData();


    const userId =
        getCurrentUserId();


    let streak = 0;


    let date =
        getTodayDate();


    while (true) {

        const key =
            userId +
            "_" +
            getDateKey(date);


        if (
            ownsCurrentUser(all[key]) &&
            all[key].completedDay
        ) {

            streak++;

            date.setDate(
                date.getDate() - 1
            );

        } else {

            break;

        }

    }


    return streak;

}


function calculateBestStreak() {

    const all =
        loadLocalData();


    const userId =
        getCurrentUserId();


    const dates =
        Object.keys(all)
            .filter(
                key =>
                    ownsCurrentUser(all[key]) && key.startsWith(
                        userId + "_"
                    )
            )
            .map(
                key =>
                    key.replace(
                        userId + "_",
                        ""
                    )
            )
            .sort();


    let best = 0;
    let current = 0;
    let previous = null;


    dates.forEach(
        date => {

            const key =
                userId +
                "_" +
                date;


            if (
                !all[key].completedDay
            ) {

                current = 0;
                previous = null;

                return;

            }


            if (
                previous &&
                isNextDate(
                    previous,
                    date
                )
            ) {

                current++;

            } else {

                current = 1;

            }


            best =
                Math.max(
                    best,
                    current
                );


            previous =
                date;

        }
    );


    return best;

}


function isNextDate(
    first,
    second
) {

    const a =
        new Date(
            first +
            "T00:00:00"
        );


    const b =
        new Date(
            second +
            "T00:00:00"
        );


    return (
        (
            b.getTime() -
            a.getTime()
        )
        /
        (
            1000 *
            60 *
            60 *
            24
        )
    ) === 1;

}


function renderStreak() {

    const container =
        document.getElementById(
            "streakBox"
        );


    if (!container) return;


    const current =
        calculateCurrentStreak();


    const best =
        calculateBestStreak();


    container.innerHTML = `

        <div
            style="
                font-size:32px;
                font-weight:700;
                margin-bottom:8px;
            "
        >
            🔥 ${current} ngày
        </div>

        <div>
            🏆 Kỷ lục: ${best} ngày
        </div>

    `;

}


// ============================================================
// GET INPUT
// ============================================================

function getValue(id) {

    const element =
        document.getElementById(id);

    return element
        ? element.value
        : "";

}


// ============================================================
// SAVE TODAY
// CHỈ ĐƯỢC 1 LẦN / NGÀY
// ============================================================

function saveQuickLog() {

    const today =
        getTodayData();


    if (
        today.quickLogSaved
    ) {

        alert(
            "Hôm nay đã lưu dữ liệu rồi."
        );

        return;

    }


    const button =
        document.getElementById(
            "saveQuickBtn"
        );


    const status =
        document.getElementById(
            "saveStatus"
        );


    if (button) {

        button.disabled =
            true;

        button.textContent =
            "⏳ Đang lưu...";

        button.style.opacity =
            "0.6";

    }


    const data = {

        userId:
            getCurrentUserId(),

        userName:
            getCurrentUserName(),

        date:
            getDateKey(),

        weight:
            getValue("homeWeight"),

        sleep:
            getValue("homeSleep"),

        water:
            getValue("homeWater"),

        steps:
            getValue("homeSteps"),

        food:
            today.checks.food
                ? "Đạt"
                : "",

        workout:
            today.activities
                .calisthenics
                ? "Hoàn thành"
                : "",

        swimming:
            today.activities
                .swimming
                ? "Hoàn thành"
                : "",

        cycling:
            today.activities
                .cycling
                ? "Hoàn thành"
                : "",

        note:
            ""

    };


    today.quickLogSaved =
        true;


    saveTodayData(
        today
    );


    sendToGoogleSheet(
        data
    );


    if (status) {

        status.textContent =
            "✅ Đã lưu dữ liệu hôm nay.";

    }


    if (button) {

        button.textContent =
            "✅ Đã lưu hôm nay";

        button.disabled =
            true;

    }

}


// ============================================================
// SEND TO GOOGLE SHEET
// ============================================================

function sendToGoogleSheet(data) {
    requireCurrentUser();
    if (!ownsCurrentUser(data)) throw new Error("User ID không khớp nhân vật đang chọn.");

    const params = new URLSearchParams();

    params.append(
        "action",
        "saveDailyLog"
    );

    params.append(
        "userId",
        getCurrentUserId()
    );

    params.append(
        "userName",
        getCurrentUserName()
    );

    params.append(
        "weight",
        data.weight || ""
    );

    params.append(
        "sleep",
        data.sleep || ""
    );

    params.append(
        "sleepTime",
        data.sleepTime || ""
    );

    params.append(
        "wakeTime",
        data.wakeTime || ""
    );

    params.append(
        "water",
        data.water || ""
    );

    params.append(
        "steps",
        data.steps || ""
    );

    params.append(
        "food",
        data.food || ""
    );

    params.append(
        "workout",
        data.workout || ""
    );

    params.append(
        "swimming",
        data.swimming || ""
    );

    params.append(
        "cycling",
        data.cycling || ""
    );

    params.append(
        "note",
        data.note || ""
    );


    return fetch(
        WEB_APP_URL +
        "?" +
        params.toString()
    )

    .then(function(response){

        return response.json();

    })

    .then(function(result){

        console.log(
            "Google Sheet:",
            result
        );


        if (!result.success) {

            throw new Error(
                result.error ||
                "Lưu thất bại"
            );

        }


        return result;

    });

}


// ============================================================
// RESET TODAY - TEST ONLY
// ============================================================

function resetTodayForTest() {

    const confirmReset =
        confirm(
            "Reset toàn bộ dữ liệu hôm nay để test?"
        );


    if (!confirmReset) {
        return;
    }


    const all =
        loadLocalData();


    const key =
        getCurrentUserId() +
        "_" +
        getDateKey();


    delete all[key];


    saveLocalData(all);


    location.reload();

}


// ============================================================
// DEBUG
// ============================================================

console.log(
    "Fitness Tracker loaded."
);

console.log(
    "User:",
    getCurrentUserName()
);

console.log(
    "User ID:",
    getCurrentUserId()
);

console.log(
    "Week:",
    getCurrentWeek()
);

console.log(
    "Today:",
    getDayName()
);
// ============================================================
// USER SYSTEM V8
// ============================================================
async function initUserSystem() {

    if (CURRENT_USER.userId) {

        await loadTodayWorkout();

    } else {

        await renderUserSelector();

    }

}


// ============================================================
// LOAD USERS
// ============================================================

async function getUsersAPI() {

    const res = await fetch(
        WEB_APP_URL +
        "?action=getUsers"
    );

    const json =
        await res.json();

    return json.data || [];

}



// ============================================================
// SHOW USER SELECT
// ============================================================

async function renderUserSelector() {


    const users =
        await getUsersAPI();


    const app =
        document.getElementById("app");


    app.innerHTML = `

        <div class="card">

            <h2>
            👤 Bạn là ai?
            </h2>

            <div id="userList"></div>

        </div>

    `;


    const list =
        document.getElementById(
            "userList"
        );


    users.forEach(user => {


        const btn =
            document.createElement(
                "button"
            );


        btn.style.marginBottom =
            "12px";


        btn.innerHTML =

        `
        ${user.avatar || "👤"}
        ${user.userName}
        `;


        btn.onclick =
            function(){

                selectUser(
                    user
                );

            };


        list.appendChild(btn);


    });


}



// ============================================================
// SELECT USER
// ============================================================

async function selectUser(user){
    const userId = String(user && (user.userId ?? user.User_ID) || "").trim();
    if (!userId) throw new Error("Nhân vật không có User ID hợp lệ.");
    CURRENT_USER = { ...user, userId, userName: user.userName || user.User_Name || "", hasAssignedPlan: false };
    TODAY_WORKOUT = null;
    currentActivity = null;
    currentRound = 1;
    currentTargetRounds = 3;
    CURRENT_USER_PLAN = [];
    const selectedUser = CURRENT_USER;
    weeklyPlan=[];
    try {
        await loadWeeklyPlan();
    } catch (error) {
        if (CURRENT_USER !== selectedUser) return;
        alert("Không tải được lịch tập: " + error.message);
    }
    if (CURRENT_USER !== selectedUser) return;


    showHome();

}
