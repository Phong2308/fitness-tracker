"use strict";
const mealMessages = {};
function mealRows(rows = []) {
  if (!Array.isArray(rows)) throw new Error('Danh sách bữa ăn không hợp lệ.');
  return rows.map(m=>{
    if (!m || typeof m.food!=='string' || !m.food.trim() || m.food.length>300 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) throw new Error('Bữa ăn không hợp lệ.');
    return {time:m.time,food:m.food.trim()};
  }).sort((a,b)=>a.time.localeCompare(b.time)||a.food.localeCompare(b.food));
}
function mealSignature(rows) {return JSON.stringify(mealRows(rows));}
// Preserve identical repeated meals, without duplicating a restored snapshot.
function mergeMeals(remote, local) {
  const counts = rows=>{const map=new Map();mealRows(rows).forEach(m=>{const k=JSON.stringify(m);map.set(k,(map.get(k)||0)+1);});return map;};
  const a=counts(remote), b=counts(local);
  b.forEach((n,k)=>a.set(k,Math.max(n,a.get(k)||0)));
  return mealRows([...a].flatMap(([k,n])=>Array.from({length:n},()=>JSON.parse(k))));
}
async function readMealDay(userId,date) {
  const r=await personalWorkoutRequest({action:'getMeals',userId,date});
  if(r.userId!==userId || r.date!==date || typeof r.revision!=='string')throw new Error('Phản hồi bữa ăn sai nhân vật/ngày.');
  return {...r,data:mealRows(r.data)};
}
async function restoreTodayMeals() {
  const selected=CURRENT_USER,id=getCurrentUserId(),date=getDateKey();
  try {
    const r=await readMealDay(id,date);
    if(CURRENT_USER!==selected || getDateKey()!==date)return;
    const day=getTodayData(), pending=day.meals && mealSignature(day.meals)!==day.mealSyncedSignature;
    day.meals=pending?mergeMeals(r.data,day.meals):r.data;
    day.mealSyncedSignature=mealSignature(r.data);
    saveTodayData(day);
    mealMessages[id]='';
  } catch(e) {if(CURRENT_USER===selected)mealMessages[id]='Chưa tải bữa ăn từ Sheet: '+e.message;}
}
async function syncMealsToSheet(selected) {
  const id=selected.userId;
  const pending=Object.entries(loadLocalData()).filter(([key,d])=>d.userId===id && key===id+'_'+d.date && Array.isArray(d.meals) && mealSignature(d.meals)!==d.mealSyncedSignature);
  for(const [key,snapshot] of pending) {
    if(CURRENT_USER!==selected)throw new Error('Đã đổi nhân vật; dừng gửi bữa ăn.');
    const remote=await readMealDay(id,snapshot.date);
    if(CURRENT_USER!==selected)throw new Error('Đã đổi nhân vật.');
    const rows=mergeMeals(remote.data,snapshot.meals);
    const ack=await personalWorkoutRequest({action:'saveMeals',userId:id,date:snapshot.date,revision:remote.revision,meals:rows},true);
    if(ack.userId!==id || ack.date!==snapshot.date || mealSignature(ack.data)!==mealSignature(rows))throw new Error('Sheet chưa xác nhận đúng bữa ăn.');
    const all=loadLocalData(),day=all[key];
    if(day && day.userId===id) {
      day.meals=mergeMeals(rows,day.meals);
      day.mealSyncedSignature=mealSignature(rows);
      saveLocalData(all);
    }
  }
  mealMessages[id]='';
}
