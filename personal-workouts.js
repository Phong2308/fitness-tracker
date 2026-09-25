// Personal routines are stored in Workout Library, not in daily exercise logs.
async function personalWorkoutRequest(payload, write = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const url = WEB_APP_URL + (write ? '' : '?' + new URLSearchParams({...payload, _:Date.now()}));
        const response = await fetch(url, write ? {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload), signal:controller.signal} : {cache:'no-store', signal:controller.signal});
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Không kết nối được thư viện bài riêng.');
        return result;
    } finally { clearTimeout(timeout); }
}

async function showPersonalWorkouts() {
    requireCurrentUser();
    const user = CURRENT_USER, app = document.querySelector('.app'), token = {};
    if (app.stopWorkoutTimer) app.stopWorkoutTimer();
    app.workoutToken = token;
    const active = () => CURRENT_USER === user && app.workoutToken === token;
    app.innerHTML = `<section class="card"><h2>Bài tập của tôi</h2><p>${htmlText(getCurrentUserName())}</p><button id="personalCreate">+ Tạo bài tập</button> <button id="personalCopy">Sao chép bài mẫu</button><div id="personalList" role="status">Đang tải…</div><button id="personalBack">Về Home</button></section>`;
    document.getElementById('personalBack').onclick = showHome;
    document.getElementById('personalCreate').onclick = () => showPersonalWorkoutEditor();
    document.getElementById('personalCopy').onclick = async () => {
        try {
            const sample = await loadSessionExercises({});
            if (active()) showPersonalWorkoutEditor({name:'Bản sao Full Body', rows:sample.rows, restSeconds:60});
        } catch (e) { if (active()) document.getElementById('personalList').textContent = e.message; }
    };
    try {
        const result = await personalWorkoutRequest({action:'getPersonalWorkouts', userId:user.userId});
        if (!active()) return;
        if (result.userId !== user.userId || !Array.isArray(result.data)) throw new Error('Thư viện trả về sai nhân vật.');
        const list = document.getElementById('personalList');
        list.innerHTML = result.data.map((item,i) => `<article class="habit-item"><h3>${htmlText(item.name)}</h3><p>${new Set(item.rows.map(r=>r.round)).size} vòng · ${item.rows.length} động tác</p><button data-personal-start="${i}">Bắt đầu tập</button> <button data-personal-copy="${i}">Sao chép để chỉnh</button></article>`).join('') || '<p>Chưa có bài riêng. Tạo bài mới hoặc sao chép bài mẫu.</p>';
        list.querySelectorAll('[data-personal-start]').forEach(button => button.onclick = () => {
            const item = result.data[Number(button.dataset.personalStart)];
            beginWorkout({type:'calisthenics', activity:item.name, personalWorkoutId:item.id, personalUserId:user.userId});
        });
        list.querySelectorAll('[data-personal-copy]').forEach(button => button.onclick = () => showPersonalWorkoutEditor({...result.data[Number(button.dataset.personalCopy)], name:'Bản sao ' + result.data[Number(button.dataset.personalCopy)].name}));
    } catch (e) { if (active()) document.getElementById('personalList').textContent = e.message + ' Nếu action chưa được hỗ trợ, cần triển khai Apps Script mới.'; }
}

function showPersonalWorkoutEditor(sample = {}) {
    requireCurrentUser();
    const user = CURRENT_USER, app = document.querySelector('.app'), token = {};
    app.workoutToken = token;
    const active = () => CURRENT_USER === user && app.workoutToken === token;
    let rows = (sample.rows || [{round:1, order:1, exercise:'', repsTime:'', rest:'', note:''}]).map(r=>({...r}));
    let requestId = null, savedPayload = null;
    app.innerHTML = `<section class="card"><h2>Tạo bài tập riêng</h2><p>Lưu cho ${htmlText(getCurrentUserName())} · không đổi lịch Weekly Plan.</p><form id="personalForm"><label>Tên bài tập<input name="workoutName" maxlength="100" required value="${htmlText(sample.name || '')}"></label><label>Nghỉ giữa vòng (giây)<input name="restSeconds" type="number" min="0" max="3600" step="1" value="${sample.restSeconds ?? 60}" required></label><p>Đặt số vòng cho từng động tác. Muốn lặp lại, dùng “Sao chép vòng cuối”.</p><div id="personalRows"></div><button type="button" id="personalAdd">+ Động tác</button> <button type="button" id="personalRepeat">Sao chép vòng cuối</button><p id="personalError" role="alert"></p><button id="personalSave" type="submit">Lưu bài tập</button> <button id="personalCancel" type="button">Quay lại</button></form></section>`;
    const form = document.getElementById('personalForm');
    function collect() {
        rows = [...form.querySelectorAll('[data-personal-row]')].map(el => Object.fromEntries([...el.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value])));
    }
    function renderRows() {
        document.getElementById('personalRows').innerHTML = rows.map((r,i) => `<fieldset data-personal-row style="border:1px solid #e2e8f0;border-radius:12px;margin:12px 0;padding:12px"><legend>Động tác ${i+1}</legend><label>Vòng<input data-field="round" type="number" min="1" max="100" step="1" required value="${htmlText(r.round)}"></label><label>Tên động tác<input data-field="exercise" maxlength="160" required value="${htmlText(r.exercise)}"></label><label>Số lần / thời gian<input data-field="repsTime" maxlength="100" required placeholder="15 reps hoặc 45 giây" value="${htmlText(r.repsTime)}"></label><label>Nghỉ sau động tác<input data-field="rest" maxlength="60" placeholder="60 giây" value="${htmlText(r.rest)}"></label><label>Ghi chú<input data-field="note" maxlength="300" value="${htmlText(r.note)}"></label><button type="button" data-remove-row="${i}">Bỏ động tác</button></fieldset>`).join('');
        form.querySelectorAll('[data-remove-row]').forEach(button=>button.onclick=()=>{collect();rows.splice(Number(button.dataset.removeRow),1);renderRows();});
    }
    renderRows();
    document.getElementById('personalAdd').onclick=()=>{collect();if(rows.length>=200)return;rows.push({round:rows.at(-1)?.round || 1,exercise:'',repsTime:'',rest:'',note:''});renderRows();};
    document.getElementById('personalRepeat').onclick=()=>{collect();const last=Math.max(0,...rows.map(r=>Number(r.round)));const copies=rows.filter(r=>Number(r.round)===last);if(last>=100 || rows.length+copies.length>200)return;rows.push(...copies.map(r=>({...r,round:last+1})));renderRows();};
    document.getElementById('personalCancel').onclick=showPersonalWorkouts;
    form.onsubmit=async event=>{
        event.preventDefault();
        if (!active()) return;
        const error = document.getElementById('personalError');
        try {
            collect();
            if (!rows.length || rows.length>200) throw new Error('Cần từ 1 đến 200 động tác.');
            const order = {};
            const data={name:form.elements.workoutName.value.trim(),restSeconds:Number(form.elements.restSeconds.value),rows:rows.map(r=>({...r,workout:'Calisthenics',round:Number(r.round),order:order[r.round]=(order[r.round]||0)+1}))};
            validateLibrary(data.rows);
            const signature=JSON.stringify(data);
            if (savedPayload!==signature) {requestId=crypto.randomUUID();savedPayload=signature;}
            [...form.elements].forEach(el=>el.disabled=true);
            error.textContent='Đang lưu vào Workout Library…';
            const result=await personalWorkoutRequest({action:'createPersonalWorkout',userId:user.userId,workoutId:requestId,...data},true);
            if (result.userId!==user.userId || result.workoutId!==requestId) throw new Error('Phản hồi không khớp. Chưa xác nhận lưu.');
            if(active()) showPersonalWorkouts();
        } catch(e) {if(active()){error.textContent=e.name==='AbortError'?'Chưa xác nhận được. Bấm lưu lại sẽ không tạo trùng.':e.message;[...form.elements].forEach(el=>el.disabled=false);}}
    };
}
