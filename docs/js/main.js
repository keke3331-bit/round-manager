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
  scheduled:         'ラウンド予定',
  on_round:          'ラウンド中',
  at_customer:       '目的地滞在中',
  departed_customer: '帰途中',
  completed:         '完了',
};

const PLANNERS = ['井戸', '関根', '柴', '片桐', '渡辺', '入江', '金', '新田', '玉井', '菊池'];

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
function isOverdue(r) {
  return r.status === 'on_round' && r.expectedReturnTime && getNow() > r.expectedReturnTime;
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

/* ─── Notifications ─── */
const notifiedScheduled = new Set();
const notifiedOverdue   = new Set();

async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

function showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, lang: 'ja' });
}

function notifyStatusChange(r, toStatus) {
  const name = r.planner;
  const dest = r.destination || '目的地';
  if (toStatus === 'on_round')               showNotification('ラウンド出発', `${name}さんがBASEを出発しました（戻り予定：${r.expectedReturnTime}）`);
  else if (toStatus === 'at_customer')        showNotification('目的地到着',   `${name}さんが${dest}に到着しました`);
  else if (toStatus === 'departed_customer')  showNotification('目的地出発',   `${name}さんが${dest}を出発しました`);
  else if (toStatus === 'completed')          showNotification('BASE到着',     `${name}さんがBASEに到着しました`);
}

function checkReminders(data) {
  const now = getNow();
  const [nowH, nowM] = now.split(':').map(Number);
  const nowTotal = nowH * 60 + nowM;

  Object.entries(data).forEach(([id, r]) => {
    if (r.status === 'scheduled' && r.departureTime && !notifiedScheduled.has(id)) {
      const [dH, dM] = r.departureTime.split(':').map(Number);
      const diff = dH * 60 + dM - nowTotal;
      if (diff > 0 && diff <= 10) {
        notifiedScheduled.add(id);
        showNotification('ラウンド予定', `${r.planner}さんのラウンド出発まで${diff}分です（${r.departureTime}出発）`);
      }
    }

    if (r.status === 'on_round' && r.expectedReturnTime && !notifiedOverdue.has(id)) {
      if (now > r.expectedReturnTime) {
        notifiedOverdue.add(id);
        showNotification('戻り予定超過', `${r.planner}さんが戻り予定時刻（${r.expectedReturnTime}）を過ぎています`);
      }
    }
  });
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

  requestNotificationPermission();

  let prevData    = null;
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
  document.getElementById('btn-print-report')?.addEventListener('click', () => {
    printMonthlyReport(currentDate.getFullYear(), currentDate.getMonth() + 1, cachedData);
  });

  onValue(ref(db, 'round_data'), snapshot => {
    const newData = snapshot.val() || {};

    if (prevData !== null) {
      Object.entries(newData).forEach(([id, r]) => {
        const prev = prevData[id];
        if (prev && prev.status !== r.status) {
          notifyStatusChange(r, r.status);
        }
      });
    }
    prevData   = newData;
    cachedData = newData;
    checkReminders(cachedData);
    renderActiveRounds(cachedData);
    renderHistory(cachedData, getDates());
  });

  setInterval(() => checkReminders(cachedData), 60 * 1000);
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
    <div class="round-card" data-status="${r.status}" data-overdue="${isOverdue(r)}" data-id="${r.id}">
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
        ${r.vehicle ? `<div class="round-info"><span class="info-label">使用車両</span><span class="info-value">${r.vehicle}</span></div>` : ''}
        <div class="round-info"><span class="info-label">出発</span><span class="info-value">${r.departureTime} → 戻り予定 ${r.expectedReturnTime}</span></div>
        ${r.purpose      ? `<div class="round-info"><span class="info-label">外出理由</span><span class="info-value">${r.purpose}</span></div>` : ''}
        ${r.memberNumber ? `<div class="round-info"><span class="info-label">会員番号</span><span class="info-value member-masked">${r.memberNumber}</span></div>` : ''}
        ${r.roundPurpose ? `<div class="round-info"><span class="info-label">ラウンド目的</span><span class="info-value">${r.roundPurpose}</span></div>` : ''}
        ${r.arrivedAt    ? `<div class="round-info"><span class="info-label">目的地到着</span><span class="info-value">${r.arrivedAt}</span></div>` : ''}
        ${r.departedCustomerAt ? `<div class="round-info"><span class="info-label">目的地出発</span><span class="info-value">${r.departedCustomerAt}</span></div>` : ''}
      </div>
      <div class="round-card__actions">${actionButton(r)}</div>
    </div>
  `).join('');

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => dispatchAction(btn.dataset.action, btn.dataset.id));
  });

  container.querySelectorAll('.member-masked').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('revealed'));
  });
}

function actionButton(r) {
  if (r.status === 'scheduled')
    return `<button class="btn btn-scheduled" data-action="base_departure" data-id="${r.id}">BASE出発</button>`;
  if (r.status === 'on_round')
    return `<button class="btn btn-arrive" data-action="arrive" data-id="${r.id}">目的地到着</button>`;
  if (r.status === 'at_customer')
    return `<button class="btn btn-depart" data-action="depart_customer" data-id="${r.id}">目的地出発</button>`;
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
  if (action === 'base_departure') {
    const r = cachedData[roundId];
    if (r?.purpose !== '外出') {
      const doubleChecker = await showDepartureChecklist(r?.planner || '');
      if (!doubleChecker) return;
      updates.doubleChecker = doubleChecker;
    }
    updates.status = 'on_round'; updates.departureTime = now;
  } else if (action === 'arrive') {
    updates.status = 'at_customer'; updates.arrivedAt = now;
  } else if (action === 'depart_customer') {
    updates.status = 'departed_customer'; updates.departedCustomerAt = now;
  } else if (action === 'base_arrived') {
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
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:#9CA3AF;padding:20px">データがありません</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="date-link" data-id="${r.id}">${r.date}</td>
      <td>${r.planner}</td>
      <td>${r.destination || '-'}</td>
      <td>${r.vehicle || '-'}</td>
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

  tbody.querySelectorAll('.date-link').forEach(td => {
    td.addEventListener('click', () => showRoundDetail({ id: td.dataset.id, ...cachedData[td.dataset.id] }));
  });
}

/* ─── Monthly report (print window) ─── */
function printMonthlyReport(year, month, data) {
  const dates   = getMonthDates(year, month);
  const dateSet = new Set(dates);
  const rounds  = Object.entries(data)
    .map(([id, r]) => ({ id, ...r }))
    .filter(r => dateSet.has(r.date))
    .sort((a, b) => a.date !== b.date
      ? a.date.localeCompare(b.date)
      : (a.departureTime || '').localeCompare(b.departureTime || ''));

  const title  = `${year}年${month}月 ラウンドレポート`;
  const today  = toISO(new Date());
  const labels = { scheduled:'ラウンド予定', on_round:'ラウンド中', at_customer:'目的地滞在中', departed_customer:'帰途中', completed:'完了' };

  const summaryRows = rounds.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.planner}</td>
      <td>${r.vehicle || '-'}</td>
      <td>${r.purpose || '-'}</td>
      <td>${r.destination || '-'}</td>
      <td>${r.departureTime || '-'}</td>
      <td>${r.expectedReturnTime || '-'}</td>
      <td>${r.baseArrivedAt || '-'}</td>
      <td>${r.doubleChecker || '-'}</td>
      <td><span class="pill pill--${r.status}">${labels[r.status] || r.status}</span></td>
    </tr>`).join('');

  const detailCards = rounds.map((r, i) => {
    const row = (label, val, full) => val
      ? `<div class="field${full ? ' full' : ''}"><dt>${label}</dt><dd>${val}</dd></div>` : '';
    return `
    <div class="card">
      <div class="card-head">
        <span class="card-head-left">${i + 1}. ${r.date}　${r.planner}</span>
        <span class="card-head-right">${r.vehicle || ''}</span>
      </div>
      <dl class="card-body">
        ${row('外出理由', r.purpose)}
        ${row('目的地', r.destination)}
        ${row('出発', r.departureTime)}
        ${row('戻り予定', r.expectedReturnTime)}
        ${row('目的地到着', r.arrivedAt)}
        ${row('目的地出発', r.departedCustomerAt)}
        ${row('BASE到着', r.baseArrivedAt)}
        ${row('ダブルチェック担当者', r.doubleChecker)}
        ${row('会員番号', r.memberNumber)}
        ${row('目的', r.roundPurpose, true)}
        ${row('見込み成果物', r.expectedDeliverable, true)}
        ${row('備考', r.notes, true)}
        ${row('ステータス', labels[r.status] || r.status)}
      </dl>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Yu Gothic','Hiragino Sans',sans-serif;font-size:12px;color:#1E293B;padding:20px}
h1{font-size:17px;margin-bottom:4px}
.meta{font-size:11px;color:#64748B;margin-bottom:16px}
.btn-row{display:flex;gap:8px;margin-bottom:20px}
button{padding:7px 16px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid #CBD5E1;font-family:inherit}
.btn-print{background:#1E293B;color:#fff;border-color:#1E293B}
.section-label{font-size:12px;font-weight:700;margin:20px 0 10px;padding-bottom:5px;border-bottom:2px solid #1E293B}
/* summary */
table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}
th,td{border:1px solid #CBD5E1;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#F1F5F9;font-weight:600;white-space:nowrap}
.pill{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600}
.pill--completed{background:#F1F5F9;color:#475569}
.pill--on_round,.pill--at_customer,.pill--departed_customer{background:#D1FAE5;color:#065F46}
.pill--scheduled{background:#FEF3C7;color:#92400E}
/* detail cards */
.card{border:1px solid #CBD5E1;border-radius:5px;margin-bottom:10px;page-break-inside:avoid}
.card-head{background:#F1F5F9;padding:7px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:5px 5px 0 0}
.card-head-left{font-weight:700;font-size:12px}
.card-head-right{font-size:11px;color:#64748B}
.card-body{padding:8px 12px;display:grid;grid-template-columns:1fr 1fr;gap:2px 16px}
.field{display:flex;gap:6px;padding:3px 0;font-size:11px}
.field.full{grid-column:1/-1}
.field dt{color:#64748B;min-width:100px;flex-shrink:0}
.field dd{color:#1E293B;word-break:break-all}
.empty{color:#9CA3AF;text-align:center;padding:40px}
@media print{
  .no-print{display:none!important}
  body{padding:8mm}
  @page{margin:8mm}
}
</style>
</head>
<body>
<h1>${title}</h1>
<p class="meta">出力日：${today}　全${rounds.length}ラウンド</p>
<div class="btn-row no-print">
  <button class="btn-print" onclick="window.print()">印刷</button>
  <button onclick="window.close()">閉じる</button>
</div>
${rounds.length === 0 ? '<p class="empty">該当月のデータがありません</p>' : `
<p class="section-label">概要一覧</p>
<table>
  <thead><tr>
    <th>日付</th><th>プランナー</th><th>使用車両</th><th>外出理由</th><th>目的地</th>
    <th>出発</th><th>戻り予定</th><th>BASE到着</th><th>ダブルチェック</th><th>ステータス</th>
  </tr></thead>
  <tbody>${summaryRows}</tbody>
</table>
<p class="section-label">詳細</p>
${detailCards}
`}
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

/* ─── Round detail modal ─── */
function showRoundDetail(r) {
  if (!r) return;
  const existing = document.getElementById('detail-modal');
  if (existing) existing.remove();

  const fields = [
    ['プランナー',           r.planner],
    ['使用車両',             r.vehicle],
    ['ダブルチェック担当者', r.doubleChecker],
    ['外出理由',             r.purpose],
    ['目的地',               r.destination],
    ['出発',                 r.departureTime],
    ['戻り予定',             r.expectedReturnTime],
    ['会員番号',             r.memberNumber],
    ['目的',                 r.roundPurpose],
    ['見込み成果物',         r.expectedDeliverable],
    ['目的地到着',           r.arrivedAt],
    ['目的地出発',           r.departedCustomerAt],
    ['BASE到着',             r.baseArrivedAt],
    ['備考',                 r.notes],
    ['ステータス',           STATUS_LABEL[r.status] || r.status],
  ].filter(([, v]) => v);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'detail-modal';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal__header">
        <h2 class="modal__title">${r.date}｜${r.planner}さんのラウンド</h2>
        <button class="modal__close" id="detail-close">×</button>
      </div>
      <dl class="detail-list">
        ${fields.map(([k, v]) => `<div class="detail-row"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </dl>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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
  document.getElementById('edit-vehicle').value          = data.vehicle || '';
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
      vehicle:             document.getElementById('edit-vehicle').value,
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

/* ─── Departure checklist modal ─── */
function showDepartureChecklist(planner) {
  return new Promise(resolve => {
    const existing = document.getElementById('checklist-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'checklist-modal';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal__header">
          <h2 class="modal__title">出発前確認</h2>
        </div>
        <p class="checklist-sub">${planner}さんの出発前に確認してください</p>
        <div class="checklist">
          <label class="check-item">
            <input type="checkbox" id="chk-license">
            <span>免許証を携帯していますか？</span>
          </label>
          <label class="check-item">
            <input type="checkbox" id="chk-belongings">
            <span>持ち物を確認しましたか？</span>
          </label>
          <label class="check-item">
            <input type="checkbox" id="chk-documents">
            <span>書類を持ちましたか？</span>
          </label>
        </div>
        <div class="form-group" style="margin-top:20px">
          <label for="chk-double">ダブルチェック担当者（${planner}さんを除く）</label>
          <select id="chk-double">
            <option value="">選択してください</option>
            ${PLANNERS.filter(p => p !== planner).map(p => `<option value="${p}">${p}</option>`).join('')}
          </select>
        </div>
        <div class="btn-group">
          <button type="button" id="chk-confirm" class="btn btn-primary" disabled>確認完了・出発</button>
          <button type="button" id="chk-cancel" class="btn btn-secondary">キャンセル</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const licenseChk    = overlay.querySelector('#chk-license');
    const belongingsChk = overlay.querySelector('#chk-belongings');
    const documentsChk  = overlay.querySelector('#chk-documents');
    const doubleSelect  = overlay.querySelector('#chk-double');
    const confirmBtn    = overlay.querySelector('#chk-confirm');
    const cancelBtn     = overlay.querySelector('#chk-cancel');

    function updateBtn() {
      confirmBtn.disabled = !(licenseChk.checked && belongingsChk.checked && documentsChk.checked && doubleSelect.value);
    }
    licenseChk.addEventListener('change', updateBtn);
    belongingsChk.addEventListener('change', updateBtn);
    documentsChk.addEventListener('change', updateBtn);
    doubleSelect.addEventListener('change', updateBtn);

    confirmBtn.addEventListener('click', () => { overlay.remove(); resolve(doubleSelect.value); });
    cancelBtn.addEventListener('click',  () => { overlay.remove(); resolve(null); });
  });
}

/* ─── Postal code lookup ─── */
async function lookupPostalCode(zip) {
  const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
  const json = await res.json();
  if (json.results && json.results.length > 0) {
    const r = json.results[0];
    return r.address1 + r.address2;
  }
  return null;
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

  const postalInput  = document.getElementById('postal-code');
  const postalStatus = document.getElementById('postal-status');
  postalInput?.addEventListener('input', async () => {
    const val = postalInput.value.trim();
    if (!/^\d{7}$/.test(val)) { postalStatus.textContent = ''; return; }
    postalStatus.textContent = '検索中…';
    try {
      const city = await lookupPostalCode(val);
      if (city) {
        document.getElementById('destination').value = city;
        postalStatus.textContent = '✓';
      } else {
        postalStatus.textContent = '見つかりません';
      }
    } catch {
      postalStatus.textContent = 'エラー';
    }
  });

  const memberInput = document.getElementById('member-number');
  const memberError = document.getElementById('member-error');
  memberInput?.addEventListener('input', () => {
    const val = memberInput.value.trim();
    memberError.textContent = val && val.length !== 8 ? '会員番号は8桁で入力してください' : '';
  });

  document.getElementById('btn-clear')?.addEventListener('click', () => {
    form.reset(); memberError.textContent = ''; postalStatus.textContent = ''; setDefaultTimes();
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const planner     = document.getElementById('planner-select').value;
    const destination = document.getElementById('destination').value.trim();
    const vehicle     = document.getElementById('vehicle').value;
    const memberVal   = document.getElementById('member-number').value.trim();
    if (!planner)     { showToast('プランナーを選択してください'); return; }
    if (!destination) { showToast('目的地を入力してください'); return; }
    if (!vehicle)     { showToast('使用車両を選択してください'); return; }
    if (memberVal && memberVal.length !== 8) { memberError.textContent = '会員番号は8桁で入力してください'; return; }

    const depTime = `${document.getElementById('dep-hour').value}:${document.getElementById('dep-min').value}`;
    const status  = depTime > getNow() ? 'scheduled' : 'on_round';

    const purpose = document.getElementById('purpose').value;
    let doubleChecker = '';
    if (status === 'on_round' && purpose !== '外出') {
      doubleChecker = await showDepartureChecklist(planner);
      if (!doubleChecker) return;
    }

    const roundData = {
      planner,
      vehicle,
      doubleChecker,
      purpose:             document.getElementById('purpose').value.trim(),
      departureTime:       depTime,
      expectedReturnTime:  `${document.getElementById('ret-hour').value}:${document.getElementById('ret-min').value}`,
      memberNumber:        memberVal,
      destination,
      roundPurpose:        document.getElementById('round-purpose').value.trim(),
      expectedDeliverable: document.getElementById('expected-deliverable').value.trim(),
      date:      toISO(new Date()),
      status,
      arrivedAt: '', departedCustomerAt: '', baseArrivedAt: '', notes: '',
      timestamp: Date.now(),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = '登録中…'; submitBtn.disabled = true;
    try {
      await push(ref(db, 'round_data'), roundData);
      showToast(status === 'scheduled' ? '✅ ラウンドを予定登録しました' : '✅ ラウンドを開始しました');
      form.reset(); memberError.textContent = ''; postalStatus.textContent = ''; setDefaultTimes();
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
