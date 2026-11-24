const $ = (selector, root = document) => root.querySelector(selector);
const STORAGE_KEY = 'assignment-notifier-v2';
const NOTIFICATION_KEY = 'assignment-notifier-notifications';
const DAY = 86_400_000;
const REMINDER_STEPS = [
  { offset: 3 * DAY, label: 'D-3' },
  { offset: DAY, label: 'D-1' },
  { offset: 3 * 60 * 60 * 1000, label: '3시간 전' },
];

function loadTasks() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? localStorage.getItem('assignment-notifier-v1') : null;
    const value = JSON.parse(current ?? legacy ?? '[]');
    const loaded = Array.isArray(value) ? value.filter(task => task && task.id && task.due).map(task => ({
      id: String(task.id), course: String(task.course || '').slice(0, 20),
      title: String(task.title || '과제').slice(0, 50), due: task.due,
      done: Boolean(task.done), created: Number(task.created) || Date.now(),
    })) : [];
    if (legacy !== null) localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    return loaded;
  } catch { return []; }
}

let tasks = loadTasks();
let currentView = 'home';
let currentFilter = 'all';
let selectedCourse = '';
let selectedDeadline = 'tomorrow';
let modalOpen = false;
let notificationEnabled = localStorage.getItem(NOTIFICATION_KEY) === 'true' || localStorage.getItem('assignment-notifications') === 'true';
let toastTimer;
let reminderTimers = [];

function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function dateKey(value) {
  const date = new Date(value);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}
function daysUntil(value) { return Math.round((dateKey(value) - dateKey(Date.now())) / DAY); }
function dayLabel(value) {
  const days = daysUntil(value);
  if (days < 0) return { text: `D+${Math.abs(days)}`, tone: 'overdue' };
  if (days === 0) return { text: 'D-DAY', tone: 'critical' };
  if (days === 1) return { text: 'D-1', tone: 'critical' };
  if (days <= 3) return { text: `D-${days}`, tone: 'warning' };
  return { text: `D-${days}`, tone: 'calm' };
}
function remainingTime(value) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return '마감이 지났어요';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}분 남음`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분 남음`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}일 ${rest}시간 남음` : `${days}일 남음`;
}
function dateParts(value) {
  const date = new Date(value);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]}) ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function localDateTime(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
function icon(name, size = 20) {
  const paths = {
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2z" transform="translate(-1 -1)"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>',
    spark: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-2-5.8L4 11l6-2.2z"/><path d="m19 14 1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2z"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function header() {
  const now = new Date();
  const weekday = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][now.getDay()];
  return `<header class="topbar"><a class="brand" href="#home" data-view="home" aria-label="과제알림 홈"><span class="brand-mark">${icon('book', 19)}</span><span>과제알림</span><span class="brand-dot">·</span><span class="brand-sub">공강맞춤</span></a><div class="topbar-right"><span class="today-chip">${now.getMonth() + 1}월 ${now.getDate()}일 · ${weekday}</span><button class="icon-button ${currentView === 'settings' ? 'active' : ''}" data-view="settings" aria-label="설정">${icon('settings', 20)}</button></div></header>`;
}

function taskCard(task) {
  const badge = dayLabel(task.due);
  const urgent = !task.done && (badge.tone === 'critical' || new Date(task.due) - Date.now() <= 3 * 60 * 60 * 1000);
  const deadline = new Date(task.due);
  const countdown = deadline > Date.now() ? remainingTime(task.due) : '기한 확인';
  return `<article class="task-card ${urgent ? 'is-urgent' : ''} ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}">
    <button class="task-check ${task.done ? 'checked' : ''}" data-action="toggle" aria-label="${task.done ? '완료 취소' : '과제 완료 처리'}" aria-pressed="${task.done}">${task.done ? icon('check', 17) : ''}</button>
    <div class="task-main"><div class="task-course">${escapeHtml(task.course)}</div><h3 class="task-title">${escapeHtml(task.title)}</h3><div class="task-detail"><span>${icon('calendar', 15)} ${dateParts(task.due)}</span><span>${icon('clock', 14)} ${countdown}</span></div></div>
    <div class="task-side"><span class="dday ${badge.tone}">${badge.text}</span><button class="delete-button" data-action="delete" aria-label="${escapeHtml(task.title)} 삭제">${icon('trash', 16)}</button></div>
  </article>`;
}

function sortedPending() {
  return tasks.filter(task => !task.done).sort((a, b) => new Date(a.due) - new Date(b.due) || b.created - a.created);
}
function homeView() {
  const pending = sortedPending();
  const completed = tasks.filter(task => task.done).sort((a, b) => b.created - a.created);
  const filtered = pending.filter(task => currentFilter === 'all' || (currentFilter === 'today' ? daysUntil(task.due) === 0 : daysUntil(task.due) >= 0 && daysUntil(task.due) <= 7));
  const todayCount = pending.filter(task => daysUntil(task.due) === 0).length;
  const nextTask = pending[0];
  const lead = nextTask ? `<section class="focus-card ${dayLabel(nextTask.due).tone === 'critical' ? 'focus-urgent' : ''}"><div class="focus-copy"><span class="focus-label">${todayCount ? '오늘 마감' : '다음 마감'}</span><strong>${escapeHtml(nextTask.title)}</strong><span>${escapeHtml(nextTask.course)} · ${dateParts(nextTask.due)}</span></div><div class="focus-count"><b>${dayLabel(nextTask.due).text}</b><span>${remainingTime(nextTask.due)}</span></div></section>` : `<section class="welcome-card"><div class="welcome-mark">${icon('spark', 21)}</div><div><span class="focus-label">차근차근, 하나씩</span><strong>마감 걱정은 여기 맡겨요</strong><span>과제를 등록하면 마감 순서와 알림 일정을 한눈에 볼 수 있어요.</span></div></section>`;
  return `<main class="main-content"><div class="page-heading"><div><span class="eyebrow">내 과제</span><h1>놓치지 않게, 한눈에</h1><p>가장 가까운 마감부터 차근차근 확인해요.</p></div><span class="task-count"><b>${pending.length}</b><span>남은 과제</span></span></div>
    ${lead}
    <section class="stats-row" aria-label="과제 요약"><div class="stat-card"><span class="stat-icon blue">${icon('calendar', 17)}</span><div><strong>${pending.length}</strong><span>진행 중</span></div></div><div class="stat-card"><span class="stat-icon orange">${icon('clock', 17)}</span><div><strong>${todayCount}</strong><span>오늘 마감</span></div></div><div class="stat-card"><span class="stat-icon green">${icon('check', 17)}</span><div><strong>${completed.length}</strong><span>완료</span></div></div></section>
    <section class="list-section"><div class="section-heading"><div><span class="eyebrow">DEADLINE TRACKER</span><h2>마감 일정</h2></div><button class="link-button" data-view="notifications">알림 일정 ${icon('arrow', 16)}</button></div>
      <div class="filter-row" role="group" aria-label="과제 필터"><button class="filter-pill ${currentFilter === 'all' ? 'selected' : ''}" data-filter="all">전체 <span>${pending.length}</span></button><button class="filter-pill ${currentFilter === 'today' ? 'selected' : ''}" data-filter="today">오늘 마감</button><button class="filter-pill ${currentFilter === 'week' ? 'selected' : ''}" data-filter="week">이번 주</button></div>
      ${filtered.length ? `<div class="task-list">${filtered.map(taskCard).join('')}</div>` : `<section class="empty-state"><div class="empty-icon">${icon('book', 25)}</div><h3>${pending.length ? '해당하는 과제가 없어요' : '등록된 과제가 없습니다'}</h3><p>${pending.length ? '다른 마감 범위를 확인해 보세요.' : '공강 시간과 마감 기한을 여유롭게 관리해보세요.'}</p><button class="empty-add" data-action="open-add">${icon('plus', 17)} 첫 과제 등록하기</button></section>`}
      ${completed.length ? `<section class="completed-section"><button class="completed-heading" data-action="toggle-completed" aria-expanded="true"><span class="completed-check">${icon('check', 14)}</span><span>완료한 과제</span><span class="completed-count">${completed.length}</span><span class="completed-chevron">⌄</span></button><div class="completed-list">${completed.map(taskCard).join('')}</div></section>` : ''}
    </section></main>`;
}

function reminderRows() {
  const pending = sortedPending();
  if (!pending.length) return `<section class="empty-state"><div class="empty-icon">${icon('bell', 25)}</div><h3>예정된 알림이 없어요</h3><p>과제를 추가하면 D-3, D-1, 3시간 전 알림 일정을 보여드려요.</p><button class="empty-add" data-action="open-add">${icon('plus', 17)} 과제 등록하기</button></section>`;
  return `<div class="reminder-list">${pending.map(task => {
    const reminders = REMINDER_STEPS.map(step => ({ ...step, at: new Date(new Date(task.due).getTime() - step.offset) })).filter(item => item.at > Date.now());
    return `<article class="reminder-card"><div class="reminder-date"><b>${String(new Date(task.due).getDate()).padStart(2, '0')}</b><span>${new Date(task.due).getMonth() + 1}월</span></div><div class="reminder-body"><div class="reminder-title-row"><strong>${escapeHtml(task.title)}</strong><span class="dday ${dayLabel(task.due).tone}">${dayLabel(task.due).text}</span></div><span class="reminder-course">${escapeHtml(task.course)} · ${dateParts(task.due)}</span><div class="reminder-chips">${reminders.length ? reminders.map(item => `<span><b>${item.label}</b>${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(item.at)}</span>`).join('') : '<span>남은 알림 없음</span>'}</div></div></article>`;
  }).join('')}</div>`;
}
function notificationsView() {
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const status = notificationEnabled && permission === 'granted' ? '켜짐' : '꺼짐';
  return `<main class="main-content"><section class="page-heading simple-heading"><div><span class="eyebrow">REMINDERS</span><h1>알림 일정</h1><p>과제별로 미리 챙길 시간을 확인해요.</p></div></section><section class="notification-banner"><span class="notification-icon">${icon('bell', 20)}</span><div><strong>마감 전 단계별 알림</strong><span>D-3 · D-1 · 마감 3시간 전</span></div><span class="status-pill ${status === '켜짐' ? 'enabled' : ''}">${status}</span></section><p class="notice-caption">브라우저 알림을 켜면 이 페이지가 열려 있는 동안 알림을 받을 수 있어요. 브라우저가 닫혀 있거나 기기가 절전 중이면 알림이 오지 않을 수 있습니다.</p><div class="section-heading reminder-heading"><div><span class="eyebrow">UPCOMING</span><h2>예정된 알림</h2></div></div>${reminderRows()}</main>`;
}
function settingsView() {
  const courses = [...new Set(tasks.map(task => task.course))];
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const toggleCopy = permission === 'unsupported' ? '이 브라우저는 알림을 지원하지 않아요' : permission === 'denied' ? '브라우저 설정에서 알림 권한을 허용해 주세요' : '이 페이지가 열려 있을 때 마감 알림을 표시해요';
  return `<main class="main-content"><section class="page-heading simple-heading"><div><span class="eyebrow">PREFERENCES</span><h1>설정</h1><p>과제알림을 나에게 맞게 정리해요.</p></div></section><section class="settings-group"><h2>알림</h2><div class="settings-row"><span class="settings-icon">${icon('bell', 18)}</span><div class="settings-copy"><strong>브라우저 알림</strong><span>${toggleCopy}</span></div><button class="switch ${notificationEnabled && permission === 'granted' ? 'on' : ''}" role="switch" aria-checked="${notificationEnabled && permission === 'granted'}" data-action="notifications-toggle" ${permission === 'unsupported' ? 'disabled' : ''}><span></span></button></div><button class="settings-row settings-link" data-view="notifications"><div class="settings-copy"><strong>마감 알림 일정</strong><span>D-3 · D-1 · 마감 3시간 전</span></div>${icon('arrow', 17)}</button></section><section class="settings-group"><h2>과목</h2><div class="course-cloud">${courses.length ? courses.map(course => `<span class="course-token">${escapeHtml(course)}</span>`).join('') : '<span class="muted-text">과제를 추가하면 과목이 여기에 표시돼요.</span>'}</div></section><section class="settings-group"><h2>데이터</h2><button class="settings-row settings-link" data-action="export"><span class="settings-icon">↗</span><div class="settings-copy"><strong>과제 데이터 내보내기</strong><span>JSON 파일로 백업합니다</span></div>${icon('arrow', 17)}</button><button class="settings-row settings-link danger-row" data-action="clear"><span class="settings-icon danger-icon">${icon('trash', 17)}</span><div class="settings-copy"><strong>모든 과제 삭제</strong><span>이 브라우저에 저장된 과제를 지웁니다</span></div>${icon('arrow', 17)}</button></section><p class="privacy-note">과제와 설정은 이 브라우저에 저장됩니다. 다른 기기와 자동으로 동기화되지는 않아요.</p></main>`;
}

function addModal() {
  const recentCourses = [...new Set(tasks.map(task => task.course))].slice(0, 5);
  const now = new Date();
  const minValue = localDateTime(now);
  const today = new Date(); today.setHours(23, 59, 0, 0);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23, 59, 0, 0);
  const dueValue = selectedDeadline === 'today' ? localDateTime(today) : selectedDeadline === 'tomorrow' ? localDateTime(tomorrow) : localDateTime(new Date(now.getTime() + 60 * 60_000));
  return `<div class="modal-backdrop" data-action="close-modal"><section class="add-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="sheet-handle"></div><div class="sheet-header"><div><span class="eyebrow">QUICK ADD</span><h2 id="modal-title">과제 등록</h2></div><button class="close-button" data-action="close-modal" aria-label="닫기">×</button></div><form id="task-form" novalidate>
    <label class="field-label" for="course-input">과목명 <span>*</span><small>최대 20자</small></label>${recentCourses.length ? `<div class="course-chips" aria-label="최근 과목">${recentCourses.map(course => `<button type="button" class="course-chip ${selectedCourse === course ? 'selected' : ''}" data-course="${escapeHtml(course)}">${escapeHtml(course)}</button>`).join('')}</div>` : ''}<input id="course-input" class="text-input" maxlength="20" placeholder="과목명을 입력해 주세요" value="${escapeHtml(selectedCourse)}" autocomplete="off" required />
    <label class="field-label title-label" for="title-input">과제 제목 <small>선택 · 비워두면 ‘과제’</small></label><input id="title-input" class="text-input title-input" maxlength="50" placeholder="어떤 과제인가요?" autocomplete="off" />
    <label class="field-label deadline-label" for="due-input">마감 일시 <span>*</span></label><div class="deadline-presets"><button type="button" class="preset ${selectedDeadline === 'today' ? 'selected' : ''}" data-deadline="today">오늘 <small>23:59</small></button><button type="button" class="preset ${selectedDeadline === 'tomorrow' ? 'selected' : ''}" data-deadline="tomorrow">내일 <small>23:59</small></button><button type="button" class="preset ${selectedDeadline === 'custom' ? 'selected' : ''}" data-deadline="custom">직접 선택</button></div><input id="due-input" class="text-input date-input ${selectedDeadline === 'custom' ? '' : 'visually-hidden'}" type="datetime-local" value="${dueValue}" min="${minValue}" required />
    <p class="form-hint" id="form-hint">${selectedDeadline === 'today' && today <= now ? '오늘 남은 시간 안에 마감 시간을 직접 선택해 주세요.' : '마감 3일 전, 하루 전, 3시간 전에 알림 일정을 만들어요.'}</p><button class="primary-button save-button" type="submit" disabled>${icon('plus', 18)} 과제 저장하기</button></form></section></div>`;
}

function render() {
  const view = currentView === 'home' ? homeView() : currentView === 'notifications' ? notificationsView() : settingsView();
  $('#app').innerHTML = `${header()}${view}<button class="fab" data-action="open-add" aria-label="과제 등록">${icon('plus', 26)}</button>${modalOpen ? addModal() : ''}`;
  document.body.classList.toggle('modal-open', modalOpen);
  if (modalOpen) validateForm();
  scheduleReminders();
}
function validateForm() {
  const button = $('.save-button');
  if (!button) return;
  const course = $('#course-input').value.trim();
  const due = new Date($('#due-input').value);
  const valid = course.length > 0 && course.length <= 20 && $('#due-input').value && !Number.isNaN(+due) && due > new Date();
  button.disabled = !valid;
  const hint = $('#form-hint');
  if (hint) hint.textContent = course.length > 20 ? '과목명은 20자 이내로 입력해 주세요.' : $('#due-input').value && due <= new Date() ? '마감 일시는 현재 시각보다 이후로 선택해 주세요.' : '마감 3일 전, 하루 전, 3시간 전에 알림 일정을 만들어요.';
}
function openModal() {
  selectedCourse = tasks[0]?.course || '';
  selectedDeadline = 'tomorrow';
  modalOpen = true;
  render();
  requestAnimationFrame(() => $('#course-input')?.focus());
}
function showToast(message) {
  clearTimeout(toastTimer);
  const existing = $('.toast'); existing?.remove();
  const toast = document.createElement('div');
  toast.className = 'toast'; toast.setAttribute('role', 'status'); toast.textContent = message;
  document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 2500);
}
function saveAndRender(message) {
  persist(); render(); if (message) showToast(message);
}
function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!notificationEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const maxDelay = 2_147_000_000;
  for (const task of tasks.filter(item => !item.done)) {
    const due = new Date(task.due).getTime();
    for (const step of REMINDER_STEPS) {
      const fireAt = due - step.offset;
      const delay = fireAt - Date.now();
      if (delay <= 0 || delay > maxDelay) continue;
      const timer = setTimeout(() => {
        if (!tasks.some(item => item.id === task.id && !item.done)) return;
        const notification = new Notification(`${task.course} · ${task.title}`, {
          body: `${step.label} · 마감까지 ${remainingTime(task.due)} 남았습니다.`,
          tag: `${task.id}-${step.label}`,
        });
        notification.onclick = () => { window.focus(); notification.close(); };
      }, delay);
      reminderTimers.push(timer);
    }
  }
}

function setDeadline(type) {
  selectedDeadline = type;
  if (type === 'today') {
    const today = new Date(); today.setHours(23, 59, 0, 0);
    if (today <= new Date()) selectedDeadline = 'custom';
  }
  render();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button, [data-action="close-modal"]');
  if (!target) return;
  if (target.dataset.action === 'open-add') { openModal(); return; }
  if (target.dataset.action === 'close-modal') {
    if (target.classList.contains('modal-backdrop') && event.target.closest('.add-sheet')) return;
    modalOpen = false; render(); return;
  }
  if (target.dataset.view) { currentView = target.dataset.view; render(); return; }
  if (target.dataset.filter) { currentFilter = target.dataset.filter; render(); return; }
  if (target.dataset.course) {
    selectedCourse = target.dataset.course;
    $('#course-input').value = selectedCourse;
    document.querySelectorAll('.course-chip').forEach(chip => chip.classList.toggle('selected', chip.dataset.course === selectedCourse));
    validateForm(); return;
  }
  if (target.dataset.deadline) { setDeadline(target.dataset.deadline); return; }
  if (target.dataset.action === 'toggle' || target.dataset.action === 'delete') {
    const card = target.closest('.task-card');
    const task = tasks.find(item => item.id === card?.dataset.taskId);
    if (!task) return;
    if (target.dataset.action === 'toggle') { task.done = !task.done; saveAndRender(task.done ? '과제를 완료했어요. 수고했어요!' : '완료 상태를 취소했어요.'); }
    else { tasks = tasks.filter(item => item.id !== task.id); saveAndRender('과제를 삭제했어요.'); }
    return;
  }
  if (target.dataset.action === 'toggle-completed') {
    const list = $('.completed-list');
    const collapsed = list.classList.toggle('collapsed');
    target.classList.toggle('collapsed', collapsed); target.setAttribute('aria-expanded', String(!collapsed)); return;
  }
  if (target.dataset.action === 'notifications-toggle') {
    if (!notificationEnabled) {
      if (!('Notification' in window)) { showToast('이 브라우저는 알림을 지원하지 않아요.'); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { showToast(permission === 'denied' ? '브라우저 설정에서 알림을 허용해 주세요.' : '알림 권한을 허용하면 알림을 받을 수 있어요.'); render(); return; }
      notificationEnabled = true;
    } else notificationEnabled = false;
    localStorage.setItem(NOTIFICATION_KEY, String(notificationEnabled)); render();
    showToast(notificationEnabled ? '브라우저 알림을 켰어요.' : '브라우저 알림을 껐어요.'); return;
  }
  if (target.dataset.action === 'export') {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = '과제알림-백업.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('과제 데이터를 저장했어요.'); return;
  }
  if (target.dataset.action === 'clear' && confirm('이 브라우저에 저장된 과제를 모두 삭제할까요?')) {
    tasks = []; saveAndRender('모든 과제를 삭제했어요.');
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'course-input') {
    selectedCourse = event.target.value;
    document.querySelectorAll('.course-chip').forEach(chip => chip.classList.toggle('selected', chip.dataset.course === selectedCourse));
    validateForm();
  }
  if (event.target.id === 'due-input') {
    selectedDeadline = 'custom';
    document.querySelectorAll('.preset').forEach(button => button.classList.toggle('selected', button.dataset.deadline === 'custom'));
    validateForm();
  }
});
document.addEventListener('change', event => { if (event.target.id === 'due-input') validateForm(); });
document.addEventListener('submit', event => {
  if (event.target.id !== 'task-form') return;
  event.preventDefault();
  const course = $('#course-input').value.trim();
  const due = new Date($('#due-input').value);
  if (!course || course.length > 20 || Number.isNaN(+due) || due <= new Date()) { validateForm(); return; }
  tasks.push({ id: crypto.randomUUID(), course, title: $('#title-input').value.trim().slice(0, 50) || '과제', due: due.toISOString(), done: false, created: Date.now() });
  modalOpen = false; currentView = 'home'; currentFilter = 'all'; saveAndRender('과제를 등록했어요. 마감 일정을 함께 챙겨드릴게요.');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modalOpen) { modalOpen = false; render(); }
});
window.addEventListener('focus', scheduleReminders);
render();
