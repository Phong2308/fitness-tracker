"use strict";

function scheduleTarget(row, choice) {
  if (choice.workoutId) {
    const rounds = Number(row.rounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 99) throw new Error('Số vòng phải từ 1 đến 99.');
    return rounds + ' vòng';
  }
  const distance = Number(row.distance);
  if (!Number.isFinite(distance) || distance <= 0 || !['m','km'].includes(row.distanceUnit)) throw new Error('Nhập quãng đường lớn hơn 0 và chọn m hoặc km.');
  return distance + ' ' + row.distanceUnit;
}

function scheduleFields(row, choice) {
  if (choice.type === 'rest') return '';
  const time = `<label>Giờ tập<input data-prop="time" type="time" required value="${htmlText(row.time)}"></label>`;
  const duration = `<label>Thời lượng dự kiến (phút)<input data-prop="minutes" type="number" min="1" max="1440" step="1" required value="${htmlText(row.minutes)}"></label>`;
  if (choice.workoutId) return time + `<label>Số vòng<input data-prop="rounds" type="number" inputmode="numeric" min="1" max="99" step="1" required value="${htmlText(row.rounds)}"></label><p>Động tác, reps/time và nghỉ lấy từ Workout Library.</p><details><summary>Thời lượng dự kiến: ${htmlText(row.minutes)} phút</summary>${duration}</details>`;
  return time + duration + `<label>Quãng đường mục tiêu<input data-prop="distance" type="number" inputmode="decimal" min="0.001" step="any" required value="${htmlText(row.distance)}"></label><label>Đơn vị<select data-prop="distanceUnit"><option value="m" ${row.distanceUnit==='m'?'selected':''}>m</option><option value="km" ${row.distanceUnit==='km'?'selected':''}>km</option></select></label>`;
}

async function showNextWeekSchedule() {
  requireCurrentUser();
  const user = CURRENT_USER, app = document.querySelector('.app'), token = {};
  if (app.stopWorkoutTimer) app.stopWorkoutTimer();
  app.workoutToken = token;
  const active = () => CURRENT_USER === user && app.workoutToken === token;
  app.innerHTML = '<section class="card"><h2>Tạo lịch tuần sau</h2><p role="status">Đang tải bài tập…</p><button id="scheduleExit">Về Home</button></section>';
  document.getElementById('scheduleExit').onclick = showHome;
  try {
    const result = await personalWorkoutRequest({action:'getPersonalWorkouts',userId:user.userId});
    if (!active()) return;
    if (result.userId !== user.userId || !Array.isArray(result.data) || result.data.some(w => !w.id || !w.name)) throw new Error('Thư viện phải trả đúng User ID và Workout ID.');
    const choices = [{key:'rest',name:'Nghỉ',type:'rest'}, ...result.data.map(w => ({key:'workout:'+w.id,name:w.name,type:'calisthenics',workoutId:w.id})), ...Object.entries(WORKOUT_TYPES).filter(([k]) => k !== 'calisthenics').map(([type,name]) => ({key:type,name,type}))];
    const options = selected => ['<option value="rest">Nghỉ</option>', '<optgroup label="Workout">'+choices.filter(c=>c.workoutId).map(c=>`<option value="${htmlText(c.key)}" ${c.key===selected?'selected':''}>${htmlText(c.name)}</option>`).join('')+'</optgroup>', '<optgroup label="Cardio">'+choices.filter(c=>!c.workoutId && c.type!=='rest').map(c=>`<option value="${c.key}" ${c.key===selected?'selected':''}>${htmlText(c.name)}</option>`).join('')+'</optgroup>'].join('');
    const days = ['T2','T3','T4','T5','T6','T7','CN'];
    let draft = days.map((_,i)=>({dayNo:i+1,key:'rest',time:'19:00',minutes:40,rounds:3,distance:'',distanceUnit:'km'}));
    let pending = null;
    app.innerHTML = `<section class="card"><h2>Tạo lịch tuần sau</h2><p>${htmlText(user.userName)} · ${htmlText(user.userId)}</p><form id="weekBuilder"><label>Tuần cần lưu<input name="week" type="number" min="1" max="520" step="1" required value="${getCurrentWeek()+1}"></label><p>Gợi ý theo tuần đang chạy của app. Có thể chỉnh tuần trước khi lưu.</p><fieldset><legend>Chọn nhiều ngày</legend>${days.map((d,i)=>`<label style="display:inline-block;margin:8px"><input type="checkbox" data-day="${i}"> ${d}</label>`).join('')}</fieldset><label>Hoạt động<select id="batchActivity">${options('rest')}</select></label><button type="button" id="applyDays">Áp dụng</button><h3>Xem lại lịch</h3><p>Chọn Nghỉ để bỏ buổi tập. Workout: mục tiêu ví dụ 3 vòng; cardio: ví dụ 1000m.</p><div id="weekReview"></div><button type="submit">Lưu Weekly Plan</button> <button type="button" id="weekCancel">Về Home</button><p id="weekMessage" role="status"></p></form></section>`;
    const form = document.getElementById('weekBuilder'), message = document.getElementById('weekMessage');
    form.closest('section').classList.add('schedule-screen');
    form.querySelector('fieldset').classList.add('schedule-days');
    form.querySelector('h3').nextElementSibling.textContent = 'Chọn bài và số vòng, hoặc đặt mục tiêu cardio cho từng ngày.';
    const actions = document.createElement('div');
    actions.className = 'schedule-actions';
    const saveButton = form.querySelector('[type="submit"]');
    saveButton.textContent = 'Lưu lịch tuần';
    saveButton.before(actions);
    actions.append(saveButton, document.getElementById('weekCancel'));
    const collect = () => form.querySelectorAll('[data-review]').forEach(el => {
      const row = draft[Number(el.dataset.review)];
      el.querySelectorAll('[data-prop]').forEach(input => row[input.dataset.prop] = input.value);
    });
    const render = () => {
      document.getElementById('weekReview').innerHTML = draft.map((r,i)=>`<fieldset data-review="${i}"><legend>${days[i]}</legend><label>Hoạt động<select data-prop="key">${options(r.key)}</select></label>${scheduleFields(r,choices.find(c=>c.key===r.key))}${r.key==='rest'?'':`<button type="button" data-clear="${i}">Xóa buổi</button>`}</fieldset>`).join('');
      form.querySelectorAll('[data-prop="key"]').forEach(select=>select.onchange=()=>{collect();render();});
      form.querySelectorAll('[data-review]').forEach(el=>{
        const row = draft[Number(el.dataset.review)];
        el.dataset.kind = row.key==='rest'?'rest':row.key.startsWith('workout:')?'workout':'cardio';
        el.querySelector('legend').textContent = days[row.dayNo-1] + ' · ' + (el.dataset.kind==='rest'?'Nghỉ ngơi':el.dataset.kind==='workout'?'Workout':'Cardio');
      });
      form.querySelectorAll('details input').forEach(input=>{
        input.oninvalid=()=>{input.closest('details').open=true;};
        input.oninput=()=>{input.closest('details').querySelector('summary').textContent='Thời lượng dự kiến: '+input.value+' phút';};
      });
      form.querySelectorAll('[data-clear]').forEach(b=>b.onclick=()=>{collect();draft[Number(b.dataset.clear)].key='rest';render();});
    };
    render();
    document.getElementById('applyDays').onclick = () => {collect();form.querySelectorAll('[data-day]:checked').forEach(el=>{draft[Number(el.dataset.day)].key=document.getElementById('batchActivity').value;});render();};
    document.getElementById('weekCancel').onclick = showHome;
    form.onsubmit = async e => {
      e.preventDefault(); if (!active()) return;
      collect();
      let rows;
      try {
        rows = draft.filter(r=>r.key!=='rest').map(r=>{const c=choices.find(c=>c.key===r.key);return {dayNo:r.dayNo,activity:c.name,type:c.type,workoutId:c.workoutId||'',time:r.time,minutes:Number(r.minutes),target:scheduleTarget(r,c)};});
      } catch(error) {message.textContent=error.message;return;}
      if (!rows.length) {message.textContent='Chọn ít nhất một buổi tập.';return;}
      const data = {userId:user.userId,week:Number(form.elements.week.value),rows};
      const signature = JSON.stringify(data);
      if (!pending || pending.signature!==signature) pending={signature,id:crypto.randomUUID()};
      [...form.elements].forEach(el=>el.disabled=true);
      message.textContent='Đang lưu…';
      let saved=false;
      try {
        const ack=await personalWorkoutRequest({action:'saveNextWeekSchedule',...data,requestId:pending.id},true);
        if(ack.userId!==user.userId || ack.requestId!==pending.id || ack.week!==data.week) throw new Error('Phản hồi lưu không khớp.');
        saved=true;
        if(!active())return;
        await loadWeeklyPlan();
        if(active()) {message.textContent='Đã lưu tuần '+data.week+' vào Weekly Plan. Về Home để xem lịch đúng ngày.';document.getElementById('weekCancel').disabled=false;}
      } catch(error) {if(active()){message.textContent=(saved?'Đã lưu nhưng chưa tải lại lịch: ':'Chưa xác nhận lưu: ')+error.message;[...form.elements].forEach(el=>el.disabled=false);}}
    };
  } catch(error) {if(active()) app.querySelector('[role="status"]').textContent=error.message;}
}
