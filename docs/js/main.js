import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCVpNsLGXG3jiXA-qJOA7srTwyvsvJAA7s",
  authDomain: "apo-dashboard.firebaseapp.com",
  databaseURL: "https://apo-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "apo-dashboard",
  storageBucket: "apo-dashboard.firebasestorage.app",
  messagingSenderId: "609387249406",
  appId: "1:609387249406:web:d196a510ebec4868256faf"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

const STATUS_LABEL = {
  on_round:          'ラウンド中',
  at_customer:       'お客様宅滞在中',
  departed_customer: '帰途中',
  completed:         '完了',
};

let cachedData = {};

/* ─── Date helpers ─── */
function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseISO(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function getNow() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
function getWeekStart(date) {
  const d = new Date(date); d.setDate(d.getDate() - d.getDay()); return d;
}
function getWeekDates(ws) {
  return Array.from({length: 7}, (_, i) => {
    const d = new Date(ws); d.setDate(d.getDate() + i); return toISO(d);
  });
}
function getMonthDates(y, m) {
  const days = new Date(y, m, 0).getDate();
  return Array.from({length: days}, (_, i) =>
    `${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`
  );
}

/* ─── Toast ─── */
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

/* ─── Hamburger ─── */
function initHamburger() {
  const btn = document.querySelector('.hamburger');
  const nav = document.querySelector('.header__nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    btn.classList.toggle('open');
    nav.classList.toggle('open');
  });
}

/* ─── Dashboard ─── */
function initDashboard() {
  if (!document.getElementById('active-rounds')) return;

  let periodType  = 'daily';
  let currentDate = new Date();

  const periodSelect = document.getElementById('period-select');
  const dateInput    = document.getElementById('date-input');
  const btnPrev      = document.getElementById('btn-prev');
  const btnNext      = document.getElementById('btn-next');
  dateInput.value    = toISO(currentDate);
  updatePeriodLabel();

  function getDates() {
    if (periodType === 'daily')   return [toISO(currentDate)];
    if (periodType === 'weekly')  return getWeekDates(getWeekStart(currentDate));
    return getMonthDates(currentDate.getFullYear(), currentDate.getMonth() + 1);
  }
  function updatePeriodLabel() {
    const label = document.getElementById('period-label');
    if (!label) return;
    if (periodType === 'daily')  { label.textContent = toISO(currentDate); return; }
    if (periodType === 'weekly') {
      const ws = getWeekStart(currentDate);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      label.textContent = `${toISO(ws)} 〜 ${toISO(we)}`; return;
    }
    label.textContent = `${currentDate.getFullYear()}年${currentDate.getMonth()+1}月`;
  }
  function move(dir) {
    if (periodType === 'daily')   currentDate.setDate(currentDate.getDate() + dir);
    if (periodType === 'weekly')  currentDate.setDate(currentDate.getDate() + dir * 7);
    if (periodType === 'monthly') currentDate.setMonth(currentDate.getMonth() + dir);
    dateInput.value = toISO(currentDate);
    updatePeriodLabel();
    renderHistory(cachedData, getDates());
  }

  periodSelect.addEventListener('change', e => { periodType = e.target.value; updatePeriodLabel(); renderHistory(cachedData, getDates()); });
  dateInput.addEventListener('change',    e => { currentDate = parseISO(e.target.value); updatePeriodLabel(); renderHistory(cachedData, getDates()); });
  btnPrev.addEventListener('click', () => move(-1));
  btnNext.addEventListener('click', () => move(1));

  onValue(ref(db, 'round_data'), snapshot => {
    cachedData = snapshot.val() || {};
    renderActiveRounds(cachedData);
    renderHistory(cachedData, getDates());
  });
}

/* ─── Active rounds ─── */
function renderActiveRounds(data) {
  const container = document.getElementById('active-rounds');
  if (!container) return;

  const active = Object.entries(data)
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => r.status !== 'completed')
    .sort((a, b) => (a.departureTime || '').localeCompare(b.departureTime || ''));

  if (!active.length) {
    container.innerHTML = '<p class="no-rounds">現在ラウンド中のプランナーはいません</p>';
    return;
  }

  container.innerHTML = active.map(r => `
    <div class="round-card" data-status="${r.status}" data-id="${r.id}">
      <div class="round-card__header">
        <span class="planner-name">${r.planner}</span>
        <div class="card-header-right">
          <span class="status-badge status-${r.status}">${STATUS_LABEL[r.status] || r.status}</span>
          <button class="btn-icon" data-action="edit" data-id="${r.id}" title="編集">✎</button>
          <button class="btn-icon btn-icon--danger" data-action="delete" data-id="${r.id}" title="削除">×</button>
        </div>
      </div>
      <div class="round-card__body">
        <div class="round-info"><span class="info-label">目的地</span><span class="info-value">${r.destination || '-'}</span></div>
        <div class="round-info"><span class="info-label">出発</span><span class="info-value">${r.departureTime} → 戻り予定 ${r.expectedReturnTime}</span></div>
        ${r.purpose      ? `<div class="round-info"><span class="info-label">目的</span><span class="info-value">${r.purpose}</span></div>` : ''}
        ${r.memberNumber ? `<div class="round-info"><span class="info-label">会員番号</span><span class="info-value member-masked" data-value="${r.memberNumber}">●●●●●●●●</span></div>` : ''}
        ${r.roundPurpose ? `<div class="round-info"><span class="info-label">ラウンド目的</span><span class="info-value">${r.roundPurpose}</span></div>` : ''}
        ${r.arrivedAt    ? `<div class="round-info"><span class="info-label">到着時刻</span><span class="info-value">${r.arrivedAt}</span></div>` : ''}
        ${r.departedCustomerAt ? `<div class="round-info"><span class="info-label">お客様宅出発</span><span class="info-value">${r.departedCustomerAt}</span></div>` : ''}
      </div>
      <div class="round-card__actions">${actionButton(r)}</div>
    </div>
  `).join('');

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => dispatchAction(btn.dataset.action, btn.dataset.id));
  });

  container.querySelectorAll('.member-masked').forEach(el => {
    el.addEventListener('click', () => {
      const hidden = el.textContent.includes('●');
      el.textContent = hidden ? el.dataset.value : '●'.repeat(el.dataset.value.length);
    });
  });
}

function actionButton(r) {
  if (r.status === 'on_round')
    return `<button class="btn btn-arrive" data-action="arrive" data-id="${r.id}">お客様宅到着</button>`;
  if (r.status === 'at_customer')
    return `<button class="btn btn-depart" data-action="depart_customer" data-id="${r.id}">お客様宅出発</button>`;
  if (r.status === 'departed_customer')
    return `<div class="notes-input-wrap">
      <textarea class="notes-input" id="notes-${r.id}" placeholder="備考（任意）" rows="2"></textarea>
      <button class="btn btn-base" data-action="base_arrived" data-id="${r.id}">BASE到着</button>
    </div>`;
  return '';
}

function dispatchAction(action, id) {
  if (action === 'edit')   { openEditModal(id, cachedData[id]); return; }
  if (action === 'delete') { deleteRound(id); return; }
  handleStatusAction(action, id);
}

async function handleStatusAction(action, roundId) {
  const now = getNow();
  const updates = {};
  if (action === 'arrive')          { updates.status = 'at_customer';       updates.arrivedAt = now; }
  else if (action === 'depart_customer') { updates.status = 'departed_customer'; updates.departedCustomerAt = now; }
  else if (action === 'base_arrived') {
    const notesEl = document.getElementById(`notes-${roundId}`);
    updates.status = 'completed'; updates.baseArrivedAt = now;
    updates.notes = notesEl ? notesEl.value.trim() : '';
  }
  try {
    await update(ref(db, `round_data/${roundId}`), updates);
  } catch (err) {
    showToast('⚠️ ' + (err.message || '更新に失敗しました'));
    console.error(err);
  }
}

/* ─── History ─── */
function renderHistory(data, dates) {
  const tbody = document.getElementById('history-body');
  if (!tbody) return;

  const dateSet = new Set(dates);
  const rows = Object.entries(data)
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => dateSet.has(r.date))
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.departureTime || '').localeCompare(a.departureTime || '');
    });

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#9CA3AF;padding:20px">データがありません</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.planner}</td>
      <td>${r.destination || '-'}</td>
      <td>${r.departureTime || '-'}</td>
      <td>${r.expectedReturnTime || '-'}</td>
      <td>${r.arrivedAt || '-'}</td>
      <td>${r.departedCustomerAt || '-'}</td>
      <td>${r.baseArrivedAt || '-'}</td>
      <td><span class="status-badge status-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
      <td>${r.notes || '-'}</td>
      <td>
        <div class="action-btns">
          <button class="btn-sm btn-sm--edit"   data-action="edit"   data-id="${r.id}">編集</button>
          <button class="btn-sm btn-sm--delete" data-action="delete" data-id="${r.id}">削除</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => dispatchAction(btn.dataset.action, btn.dataset.id));
  });
}

/* ─── Delete ─── */
async function deleteRound(roundId) {
  if (!confirm('このラウンドを削除しますか？')) return;
  try {
    await remove(ref(db, `round_data/${roundId}`));
    showToast('✅ 削除しました');
  } catch (err) {
    showToast('⚠️ ' + (err.message || '削除に失敗しました'));
    console.error(err);
  }
}

/* ─── Edit modal ─── */
function openEditModal(roundId, data) {
  if (!data) return;
  const modal = document.getElementById('edit-modal');
  if (!modal) return;

  document.getElementById('edit-id').value               = roundId;
  document.getElementById('edit-planner').value          = data.planner || '';
  document.getElementById('edit-purpose').value          = data.purpose || '';
  document.getElementById('edit-dep-time').value         = data.departureTime || '';
  document.getElementById('edit-ret-time').value         = data.expectedReturnTime || '';
  document.getElementById('edit-destination').value      = data.destination || '';
  document.getElementById('edit-member').value           = data.memberNumber || '';
  document.getElementById('edit-round-purpose').value    = data.roundPurpose || '';
  document.getElementById('edit-deliverable').value      = data.expectedDeliverable || '';
  document.getElementById('edit-arrived').value          = data.arrivedAt || '';
  document.getElementById('edit-departed').value         = data.departedCustomerAt || '';
  document.getElementById('edit-base').value             = data.baseArrivedAt || '';
  document.getElementById('edit-notes').value            = data.notes || '';
  document.getElementById('edit-member-error').textContent = '';

  modal.classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal')?.classList.remove('open');
}

function initEditModal() {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;

  document.getElementById('modal-close')?.addEventListener('click', closeEditModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeEditModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditModal(); });

  const memberInput = document.getElementById('edit-member');
  const memberError = document.getElementById('edit-member-error');
  memberInput?.addEventListener('input', () => {
    const val = memberInput.value.trim();
    memberError.textContent = val && val.length !== 8 ? '会員番号は8桁で入力してください' : '';
  });

  document.getElementById('edit-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const roundId  = document.getElementById('edit-id').value;
    const memberVal = document.getElementById('edit-member').value.trim();
    if (memberVal && memberVal.length !== 8) {
      memberError.textContent = '会員番号は8桁で入力してください'; return;
    }
    const updates = {
      planner:             document.getElementById('edit-planner').value,
      purpose:             document.getElementById('edit-purpose').value.trim(),
      departureTime:       document.getElementById('edit-dep-time').value,
      expectedReturnTime:  document.getElementById('edit-ret-time').value,
      destination:         document.getElementById('edit-destination').value.trim(),
      memberNumber:        memberVal,
      roundPurpose:        document.getElementById('edit-round-purpose').value.trim(),
      expectedDeliverable: document.getElementById('edit-deliverable').value.trim(),
      arrivedAt:           document.getElementById('edit-arrived').value,
      departedCustomerAt:  document.getElementById('edit-departed').value,
      baseArrivedAt:       document.getElementById('edit-base').value,
      notes:               document.getElementById('edit-notes').value.trim(),
    };
    try {
      await update(ref(db, `round_data/${roundId}`), updates);
      showToast('✅ 保存しました');
      closeEditModal();
    } catch (err) {
      showToast('⚠️ ' + (err.message || '保存に失敗しました'));
      console.error(err);
    }
  });
}

/* ─── Input page ─── */
function buildTimeOptions(selectId, isHour) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const max = isHour ? 24 : 60;
  const step = isHour ? 1 : 5;
  for (let v = 0; v < max; v += step) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = String(v).padStart(2, '0');
    el.appendChild(opt);
  }
}

function setDefaultTimes() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0');
  const ret = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const rh  = String(ret.getHours()).padStart(2, '0');
  const rm  = String(Math.floor(ret.getMinutes() / 5) * 5).padStart(2, '0');
  if (document.getElementById('dep-hour')) document.getElementById('dep-hour').value = h;
  if (document.getElementById('dep-min'))  document.getElementById('dep-min').value  = m;
  if (document.getElementById('ret-hour')) document.getElementById('ret-hour').value = rh;
  if (document.getElementById('ret-min'))  document.getElementById('ret-min').value  = rm;
}

function initInput() {
  const form = document.getElementById('round-form');
  if (!form) return;

  const dateDisplay = document.getElementById('date-display');
  if (dateDisplay) dateDisplay.textContent = toISO(new Date());

  buildTimeOptions('dep-hour', true);  buildTimeOptions('dep-min',  false);
  buildTimeOptions('ret-hour', true);  buildTimeOptions('ret-min',  false);
  setDefaultTimes();

  const memberInput = document.getElementById('member-number');
  const memberError = document.getElementById('member-error');
  memberInput?.addEventListener('input', () => {
    const val = memberInput.value.trim();
    memberError.textContent = val && val.length !== 8 ? '会員番号は8桁で入力してください' : '';
  });

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    form.reset(); memberError.textContent = ''; setDefaultTimes();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const planner     = document.getElementById('planner-select').value;
    const destination = document.getElementById('destination').value.trim();
    const memberVal   = document.getElementById('member-number').value.trim();
    if (!planner)     { showToast('プランナーを選択してください'); return; }
    if (!destination) { showToast('目的地を入力してください'); return; }
    if (memberVal && memberVal.length !== 8) { memberError.textContent = '会員番号は8桁で入力してください'; return; }

    const roundData = {
      planner,
      purpose:             document.getElementById('purpose').value.trim(),
      departureTime:       `${document.getElementById('dep-hour').value}:${document.getElementById('dep-min').value}`,
      expectedReturnTime:  `${document.getElementById('ret-hour').value}:${document.getElementById('ret-min').value}`,
      memberNumber:        memberVal,
      destination,
      roundPurpose:        document.getElementById('round-purpose').value.trim(),
      expectedDeliverable: document.getElementById('expected-deliverable').value.trim(),
      date:      toISO(new Date()),
      status:    'on_round',
      arrivedAt: '', departedCustomerAt: '', baseArrivedAt: '', notes: '',
      timestamp: Date.now(),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = '登録中…'; submitBtn.disabled = true;
    try {
      await push(ref(db, 'round_data'), roundData);
      showToast('✅ ラウンドを開始しました');
      form.reset(); memberError.textContent = ''; setDefaultTimes();
      dateDisplay.textContent = toISO(new Date());
    } catch (err) {
      showToast('⚠️ ' + (err.message || '登録に失敗しました'));
      console.error(err);
    } finally {
      submitBtn.textContent = 'ラウンド開始'; submitBtn.disabled = false;
    }
  });
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', () => {
  initHamburger();
  initDashboard();
  initEditModal();
  initInput();
});
