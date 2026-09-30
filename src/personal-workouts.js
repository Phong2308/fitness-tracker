"use strict";

// Personal routines are stored in Workout Library, not in daily exercise logs.
function showPersonalSchedule(workout) {
  requireCurrentUser();
  const user = CURRENT_USER,
    app = document.querySelector('.app'),
    token = {};
  app.workoutToken = token;
  const active = () => CURRENT_USER === user && app.workoutToken === token;
  const day = getTodayDate().getDay() || 7;
  app.innerHTML = `<section class="card"><h2>Xếp vào lịch</h2><p>${htmlText(workout.name)} · ${htmlText(getCurrentUserName())}</p><p>Tuần 1 bắt đầu ngày 21/09/2026. Chỉ thêm lịch cho nhân vật này; không sửa lịch người khác.</p><form id="personalScheduleForm"><label>Tuần<input name="week" type="number" min="1" max="520" step="1" value="${Math.max(1, getCurrentWeek())}" required></label><label>Ngày tập<select name="dayNo">${Array.from({
    length: 7
  }, (_, i) => `<option value="${i + 1}" ${day === i + 1 ? 'selected' : ''}>${i === 6 ? 'Chủ nhật' : 'Thứ ' + (i + 2)}</option>`).join('')}</select></label><label>Giờ dự kiến<input name="time" type="time" value="19:00" required></label><label>Thời lượng (phút)<input name="minutes" type="number" min="0.1" max="1440" step="0.1" value="40" required></label><label>Số vòng<input name="rounds" type="number" min="1" max="100" step="1" value="3" required></label><button type="submit">Lưu vào Weekly Plan</button> <button id="scheduleBack" type="button">Quay lại</button><p id="scheduleMessage" role="status"></p></form></section>`;
  document.getElementById('scheduleBack').onclick = showPersonalWorkouts;
  const form = document.getElementById('personalScheduleForm');
  form.onsubmit = async event => {
    event.preventDefault();
    if (!active()) return;
    const message = document.getElementById('scheduleMessage');
    const payload = {
      action: 'schedulePersonalWorkout',
      userId: user.userId,
      workoutId: workout.id,
      time: form.elements.time.value
    };
    for (const key of ['week', 'dayNo', 'rounds', 'minutes']) payload[key] = Number(form.elements[key].value);
    [...form.elements].forEach(el => el.disabled = true);
    message.textContent = 'Đang lưu lịch…';
    let saved = false;
    try {
      const result = await personalWorkoutRequest(payload, true);
      if (result.userId !== user.userId || result.workoutId !== workout.id) throw new Error('Phản hồi lịch không khớp nhân vật/bài tập.');
      saved = true;
      if (!active()) return;
      await loadWeeklyPlan();
      if (active()) showHome();
    } catch (e) {
      if (active()) {
        message.textContent = (saved ? 'Đã lưu lịch nhưng chưa tải lại được: ' : 'Chưa xác nhận lưu lịch: ') + e.message;
        [...form.elements].forEach(el => el.disabled = false);
      }
    }
  };
}
async function showPersonalWorkouts() {
  requireCurrentUser();
  const user = CURRENT_USER,
    app = document.querySelector('.app'),
    token = {};
  if (app.stopWorkoutTimer) app.stopWorkoutTimer();
  app.workoutToken = token;
  const active = () => CURRENT_USER === user && app.workoutToken === token;
  app.innerHTML = `<section class="card"><h2>Bài tập của tôi</h2><p>${htmlText(getCurrentUserName())}</p><button id="personalCreate">+ Tạo bài tập</button> <button id="personalCopy">Sao chép bài mẫu</button><div id="personalList" role="status">Đang tải…</div><button id="personalBack">Về Home</button></section>`;
  document.getElementById('personalBack').onclick = showHome;
  document.getElementById('personalCreate').onclick = () => showPersonalWorkoutEditor();
  document.getElementById('personalCopy').onclick = async () => {
    try {
      const sample = await loadSessionExercises({});
      if (active()) showPersonalWorkoutEditor({
        name: 'Bản sao Full Body',
        rows: sample.rows,
        restSeconds: 60
      });
    } catch (e) {
      if (active()) document.getElementById('personalList').textContent = e.message;
    }
  };
  try {
    const result = await personalWorkoutRequest({
      action: 'getPersonalWorkouts',
      userId: user.userId
    });
    if (!active()) return;
    if (result.userId !== user.userId || !Array.isArray(result.data)) throw new Error('Thư viện trả về sai nhân vật.');
    const list = document.getElementById('personalList');
    list.innerHTML = result.data.map((item, i) => `<article class="habit-item"><h3>${htmlText(item.name)}</h3><p style="overflow-wrap:anywhere">${htmlText(item.id)} · ${item.rows.length} động tác · Số vòng đặt trong lịch</p><button data-personal-schedule="${i}">Xếp vào lịch</button> <button data-personal-start="${i}">Tập thay thế</button> <button data-personal-copy="${i}">Sao chép để chỉnh</button></article>`).join('') || '<p>Chưa có bài riêng. Tạo bài mới hoặc sao chép bài mẫu.</p>';
    list.querySelectorAll('[data-personal-schedule]').forEach(button => button.onclick = () => showPersonalSchedule(result.data[Number(button.dataset.personalSchedule)]));
    list.querySelectorAll('[data-personal-start]').forEach(button => button.onclick = () => {
      const item = result.data[Number(button.dataset.personalStart)];
      const count = prompt('Số vòng cho lần tập thay thế này (không sửa Weekly Plan):', '1');
      if (count === null) return;
      if (!/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 100) {
        alert('Nhập số vòng từ 1 đến 100.');
        return;
      }
      beginWorkout({
        type: 'calisthenics',
        activity: item.name,
        personalWorkoutId: item.id,
        personalUserId: user.userId,
        target: Number(count) + ' vòng'
      });
    });
    list.querySelectorAll('[data-personal-copy]').forEach(button => button.onclick = () => showPersonalWorkoutEditor({
      ...result.data[Number(button.dataset.personalCopy)],
      name: 'Bản sao ' + result.data[Number(button.dataset.personalCopy)].name
    }));
  } catch (e) {
    if (active()) document.getElementById('personalList').textContent = e.message + ' Nếu action chưa được hỗ trợ, cần triển khai Apps Script mới.';
  }
}
function showPersonalWorkoutEditor(sample = {}) {
  requireCurrentUser();
  const user = CURRENT_USER,
    app = document.querySelector('.app'),
    token = {};
  app.workoutToken = token;
  const active = () => CURRENT_USER === user && app.workoutToken === token;
  const source = sample.rows || [{
    round: 1,
    order: 1,
    exercise: '',
    repsTime: '',
    rest: '',
    note: ''
  }];
  const first = Math.min(...source.map(r => Number(r.round) || 1));
  let rows = source.filter(r => (Number(r.round) || 1) === first).map(r => ({
    ...r
  }));
  let requestId = null,
    savedPayload = null;
  app.innerHTML = `<section class="card"><h2>Tạo bài tập riêng</h2><p>Lưu cho ${htmlText(getCurrentUserName())}. Lưu xong chọn “Xếp vào lịch”.</p><form id="personalForm"><label>Tên bài tập<input name="workoutName" maxlength="100" required value="${htmlText(sample.name || '')}"></label><label>Nghỉ giữa vòng (giây)<input name="restSeconds" type="number" min="0" max="3600" step="1" value="${sample.restSeconds ?? 60}" required></label><p>Thư viện chỉ lưu danh sách động tác. Số vòng lấy từ Mục tiêu trong Weekly Plan.</p><div id="personalRows"></div><button type="button" id="personalAdd">+ Động tác</button><p id="personalError" role="alert"></p><button id="personalSave" type="submit">Lưu bài tập</button> <button id="personalCancel" type="button">Quay lại</button></form></section>`;
  const form = document.getElementById('personalForm');
  function collect() {
    form.querySelectorAll('[data-personal-row]').forEach(el => {
      const input=el.querySelector('[data-field="repsTime"]');
      input.value = formatExerciseUnit(input.value, el.querySelector('[data-reps-unit]').value);
    });
    rows = [...form.querySelectorAll('[data-personal-row]')].map(el => Object.fromEntries([...el.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value])));
  }
  function renderRows() {
    document.getElementById('personalRows').innerHTML = rows.map((r, i) => `<fieldset data-personal-row style="border:1px solid #e2e8f0;border-radius:12px;margin:12px 0;padding:12px"><legend>Động tác ${i + 1}</legend><label>Tên động tác<input data-field="exercise" maxlength="160" required value="${htmlText(r.exercise)}"></label><label>Số lần / thời gian<input data-field="repsTime" maxlength="100" required placeholder="15 reps hoặc 45 giây" value="${htmlText(r.repsTime)}"></label><label>Nghỉ sau động tác<input data-field="rest" maxlength="60" placeholder="60 giây" value="${htmlText(r.rest)}"></label><label>Ghi chú<input data-field="note" maxlength="300" value="${htmlText(r.note)}"></label><button type="button" data-remove-row="${i}">Bỏ động tác</button></fieldset>`).join('');
    form.querySelectorAll('[data-personal-row]').forEach(el => {
      const input=el.querySelector('[data-field="repsTime"]');
      const label=document.createElement('label'); label.textContent='Đơn vị';
      const select=document.createElement('select'); select.dataset.repsUnit='';
      select.innerHTML='<option value="reps">reps</option><option value="giây">giây (s)</option><option value="phút">phút</option>';
      const spec=parseExerciseClock(input.value);
      select.value=spec?.mode==='down' ? (/phút|min/i.test(input.value)?'phút':'giây') : 'reps';
      select.onchange=()=>{input.value=formatExerciseUnit(input.value,select.value,true);};
      label.append(select); input.closest('label').after(label);
    });
    form.querySelectorAll('[data-remove-row]').forEach(button => button.onclick = () => {
      collect();
      rows.splice(Number(button.dataset.removeRow), 1);
      renderRows();
    });
  }
  renderRows();
  document.getElementById('personalAdd').onclick = () => {
    collect();
    if (rows.length >= 200) return;
    rows.push({
      round: rows.at(-1)?.round || 1,
      exercise: '',
      repsTime: '',
      rest: '',
      note: ''
    });
    renderRows();
  };
  document.getElementById('personalCancel').onclick = showPersonalWorkouts;
  form.onsubmit = async event => {
    event.preventDefault();
    if (!active()) return;
    const error = document.getElementById('personalError');
    try {
      collect();
      if (!rows.length || rows.length > 200) throw new Error('Cần từ 1 đến 200 động tác.');
      const data = {
        name: form.elements.workoutName.value.trim(),
        restSeconds: Number(form.elements.restSeconds.value),
        rows: rows.map((r, i) => ({
          ...r,
          workout: 'Calisthenics',
          round: 1,
          order: i + 1
        }))
      };
      validateLibrary(data.rows);
      const signature = JSON.stringify(data);
      if (savedPayload !== signature) {
        requestId = crypto.randomUUID();
        savedPayload = signature;
      }
      [...form.elements].forEach(el => el.disabled = true);
      error.textContent = 'Đang lưu vào Workout Library…';
      const result = await personalWorkoutRequest({
        action: 'createPersonalWorkout',
        userId: user.userId,
        requestId,
        ...data
      }, true);
      if (result.userId !== user.userId || result.requestId !== requestId || !result.workoutId) throw new Error('Phản hồi không khớp. Chưa xác nhận lưu.');
      if (active()) showPersonalWorkouts();
    } catch (e) {
      if (active()) {
        error.textContent = e.name === 'AbortError' ? 'Chưa xác nhận được. Bấm lưu lại sẽ không tạo trùng.' : e.message;
        [...form.elements].forEach(el => el.disabled = false);
      }
    }
  };
}
function formatExerciseUnit(value, unit, replace=false) {
  const text=String(value || '').trim();
  if (!['reps','giây','phút'].includes(unit)) return text;
  if (/^\d+(?:[.,]\d+)?$/.test(text)) return text+' '+unit;
  if (replace) return text.replace(/^(\d+(?:[.,]\d+)?)\s*(?:reps?|giây|s|sec|seconds?|phút|min|minutes?)(?=\s|$)/i, '$1 '+unit);
  return text; // Keep legacy text, including “mỗi chân”, unchanged.
}
