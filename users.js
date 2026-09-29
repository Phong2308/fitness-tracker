"use strict";

// users — extracted from the working app; public function names preserved.

async function loadUsers() {
  const result = await personalWorkoutRequest({action:"getUsers"});
  return (Array.isArray(result.data) ? result.data : []).map(user => ({
    ...user,
    userId: String(user.userId ?? user.User_ID ?? "").trim(),
    userName: user.userName ?? user.User_Name ?? ""
  })).filter(user => user.userId);
}
async function showUserSelector() {
  CURRENT_USER = {
    userId: "",
    userName: ""
  };
  const users = await loadUsers();
  const box = document.getElementById("app");
  if (!box) return;
  box.innerHTML = `

    
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
  const dropdown = document.getElementById("userDropdown");
  users.forEach(user => {
    const option = document.createElement("option");
    option.value = user.userId;
    option.textContent = `${user.avatar || "💪"} ${user.userName}`;
    dropdown.appendChild(option);
  });
  dropdown.onchange = function () {
    const user = users.find(x => x.userId === this.value);
    if (user) {
      selectUser(user);
    }
  };
  document.getElementById("createUserBtn").onclick = function () {
    showCreateUser();
  };
}
function showCreateUser() {
  const app = document.getElementById('app');
  if (!app) return;
  if (app.stopWorkoutTimer) app.stopWorkoutTimer();
  const token = {};
  app.workoutToken = token;
  let requestId = '',
    previousSignature = '',
    busy = false;
  app.innerHTML = `<section class="new-profile"><h2>➕ Tạo nhân vật mới</h2><p>User ID tự tăng: P003, P004… Bạn không cần nhập mã.</p>
    <form id="createProfileForm"><label>Tên nhân vật<input name="userName" maxlength="100" autocomplete="nickname" required></label>
    <label>Icon<select name="avatar"><option>💪</option><option>🏃</option><option>🏋️</option><option>🏊</option><option>🚴</option><option>🧘</option><option>⭐</option><option>🐼</option></select></label>
    <label>Chiều cao (cm)<input name="height" type="number" min="0.1" max="300" step="0.1" inputmode="decimal" required></label>
    <label>Cân nặng hiện tại (kg)<input name="weight" type="number" min="0.1" max="500" step="0.1" inputmode="decimal" required></label>
    <div class="profile-actions"><button id="saveNewProfile" type="submit">Lưu nhân vật</button><button id="cancelNewProfile" type="button" class="secondary">Quay lại</button></div><p id="createProfileStatus" role="status" aria-live="polite"></p></form></section>`;
  const form = document.getElementById('createProfileForm'),
    status = document.getElementById('createProfileStatus');
  const active = () => app.workoutToken === token && document.getElementById('createProfileForm') === form;
  document.getElementById('cancelNewProfile').onclick = () => {
    if (!busy) {
      app.workoutToken = null;
      showUserSelector();
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || !active()) return;
    const data = {
      userName: form.elements.userName.value.trim(),
      avatar: form.elements.avatar.value,
      height: Number(form.elements.height.value),
      weight: Number(form.elements.weight.value)
    };
    if (!data.userName || data.userName.length > 100 || !Number.isFinite(data.height) || data.height <= 0 || data.height > 300 || !Number.isFinite(data.weight) || data.weight <= 0 || data.weight > 500) {
      status.textContent = 'Hãy nhập tên, chiều cao và cân nặng hợp lệ.';
      return;
    }
    const signature = JSON.stringify(data);
    if (signature !== previousSignature) {
      requestId = crypto.randomUUID();
      previousSignature = signature;
    }
    busy = true;
    [...form.elements].forEach(el => el.disabled = true);
    status.textContent = 'Đang lưu vào User Master…';
    try {
      const result = await personalWorkoutRequest({
        action: 'createUser',
        requestId,
        ...data
      }, true);
      if (result.requestId !== requestId || !/^P\d{3,}$/.test(result.data?.userId || '') || result.data.userName !== data.userName) throw new Error('Chưa xác nhận đúng nhân vật. Kiểm tra User Master và phiên bản Apps Script.');
      if (!active()) return;
      form.innerHTML = `<p role="status">✅ Đã tạo <strong>${htmlText(result.data.userId)} · ${htmlText(result.data.avatar)} ${htmlText(result.data.userName)}</strong> trong User Master.</p><p>Nhân vật mới chưa có lịch hoặc kết quả tập. Không sao chép dữ liệu người khác.</p><button id="newProfileDone" type="button">Về chọn nhân vật</button>`;
      document.getElementById('newProfileDone').onclick = () => {
        app.workoutToken = null;
        showUserSelector();
      };
    } catch (error) {
      if (active()) {
        status.textContent = error.name === 'AbortError' ? 'Chưa nhận được xác nhận. Có thể bấm Lưu lại với cùng thông tin; backend mới sẽ không tạo trùng.' : 'Chưa xác nhận lưu: ' + error.message;
        [...form.elements].forEach(el => el.disabled = false);
      }
    } finally {
      busy = false;
    }
  };
}
function ownsCurrentUser(row) {
  const id = getCurrentUserId();
  if (!id || !row) return false;
  const ids = [row.User_ID, row.userId].filter(value => value != null);
  return ids.length > 0 && ids.every(value => String(value).trim() === id);
}
function requireCurrentUser() {
  if (!getCurrentUserId()) throw new Error("Vui lòng chọn nhân vật trước.");
}
function getCurrentUserId() {
  return String(CURRENT_USER.userId || "").trim();
}
function getCurrentUserName() {
  return CURRENT_USER.userName || "";
}
async function selectUser(user) {
  const userId = String(user && (user.userId ?? user.User_ID) || "").trim();
  if (!userId) throw new Error("Nhân vật không có User ID hợp lệ.");
  CURRENT_USER = {
    ...user,
    userId,
    userName: user.userName || user.User_Name || "",
    hasAssignedPlan: false
  };
  const selectedUser = CURRENT_USER;
  weeklyPlan = [];
  await loadHabitTargetsFromSheet(userId);
  if (CURRENT_USER !== selectedUser) return;
  await restoreTodayHabits();
  if (CURRENT_USER !== selectedUser) return;
  await loadStreakHistory();
  if (CURRENT_USER !== selectedUser) return;
  try {
    await loadWeeklyPlan();
  } catch (error) {
    if (CURRENT_USER !== selectedUser) return;
    alert("Không tải được lịch tập: " + error.message);
  }
  if (CURRENT_USER !== selectedUser) return;
  showHome();
}
