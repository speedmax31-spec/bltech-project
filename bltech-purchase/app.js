/* 구매관리 플랫폼 - 프론트엔드 (원부자재 재고 · 완제품 재고 · 발주내역)
   데이터: localStorage (이 컴퓨터에만 저장). 추후 Firebase 등 공유 DB로 교체 시 db* 함수만 수정하면 됨. */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n, d = 0) => (n == null || n === '' || isNaN(n)) ? '-' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }; // "4,600" 같은 콤마 입력도 안전
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);

/* ===================== 데이터 계층 (localStorage) ===================== */
const DB_PREFIX = 'bl-purchase-';
function dbLoad(col) {
  try { return JSON.parse(localStorage.getItem(DB_PREFIX + col) || '[]'); }
  catch (e) { return []; }
}
function dbSave(col, list) { localStorage.setItem(DB_PREFIX + col, JSON.stringify(list)); }
function dbCreate(col, obj) {
  const list = dbLoad(col);
  const id = list.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const now = new Date().toISOString();
  const rec = Object.assign({}, obj, { id, createdAt: now, updatedAt: now });
  list.push(rec);
  dbSave(col, list);
  return rec;
}
function dbUpdate(col, id, obj) {
  const list = dbLoad(col);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const rec = Object.assign({}, list[i], obj, { id, updatedAt: new Date().toISOString() });
  list[i] = rec;
  dbSave(col, list);
  return rec;
}
function dbRemove(col, id) { dbSave(col, dbLoad(col).filter((r) => r.id !== id)); }
/* 최초 실행 시 seed-data.js의 초기 데이터를 한 번만 심는다.
   (한 번이라도 저장된 적이 있으면 — 전체 삭제 포함 — 다시 심지 않음) */
function dbLoadOrSeed(col) {
  if (localStorage.getItem(DB_PREFIX + col) === null && window.SEED_DATA && SEED_DATA[col]) {
    dbSave(col, SEED_DATA[col]);
    if (col === 'materials' && SEED_DATA.materialsMonth && !localStorage.getItem(DB_PREFIX + 'materials-month')) {
      localStorage.setItem(DB_PREFIX + 'materials-month', SEED_DATA.materialsMonth);
    }
  }
  return dbLoad(col);
}

/* 원부자재 시드 마이그레이션: 시드 데이터 구조가 바뀔 때 1회 교체.
   v2: 조사자 원본값 반영 / v3: 구분(부목·하이드로겔) 필드 추가 */
(function migrateMaterialsSeed() {
  const key = DB_PREFIX + 'materials-seed-ver';
  if (window.SEED_DATA && SEED_DATA.materials && localStorage.getItem(key) !== '3') {
    dbSave('materials', SEED_DATA.materials);
    if (SEED_DATA.materialsMonth) localStorage.setItem(DB_PREFIX + 'materials-month', SEED_DATA.materialsMonth);
    localStorage.setItem(key, '3');
  }
})();

let MATERIALS = dbLoadOrSeed('materials');   // 원부자재 재고
let FINISHED = dbLoadOrSeed('finished');     // 완제품 재고 (내수/수출)
let ORDERS = dbLoadOrSeed('orders');         // 발주내역
let ISSUES = dbLoadOrSeed('issues');         // 일일출고 전표
let CODES = dbLoadOrSeed('codes');           // 품목 코드 마스터
const reloadAll = () => { MATERIALS = dbLoad('materials'); FINISHED = dbLoad('finished'); ORDERS = dbLoad('orders'); ISSUES = dbLoad('issues'); CODES = dbLoad('codes'); };

/* ===================== 네비게이션 ===================== */
/* 각 탭 제목 옆 오늘 날짜 표시 (자정 넘김 대비 탭 이동 시마다 갱신) */
function fillTodayLabels() {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const s = `📅 ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]}) 기준`;
  $$('.today-label').forEach((el) => (el.textContent = s));
}

/* ===================== 열린 화면 탭 바 (ERP 방식) ===================== */
const PAGE_TITLES = {
  materials: '원부자재 재고 현황', finished: '완제품 재고 현황', orders: '발주내역',
  receive: '자재 발주·입고', inquiry: '입고 조회', issue: '자재 일일출고', issuelist: '출고 조회',
  bom: 'BOM·자재명세서', codes: '품목 코드', check: '생산 가능 체크', analytics: '분석', alert: '발주 알림',
  po: '발주서 작성', rmissues: '원부자재 이슈', cost: '제조원가',
};
const TABS_KEY = 'bl-purchase-open-tabs';
let OPEN_TABS = (() => { try { return (JSON.parse(localStorage.getItem(TABS_KEY)) || []).filter((p) => PAGE_TITLES[p]); } catch (e) { return []; } })();
const tabsSave = () => localStorage.setItem(TABS_KEY, JSON.stringify(OPEN_TABS));
function renderTabBar(active) {
  const bar = $('#tab-bar');
  if (!bar) return;
  bar.hidden = !OPEN_TABS.length;
  bar.innerHTML = OPEN_TABS.map((p) =>
    `<span class="ptab${p === active ? ' active' : ''}" data-tab="${p}" draggable="true" title="끌어서 순서 변경">${PAGE_TITLES[p]} <span class="ptab-x" data-tab-close="${p}" title="닫기">✕</span></span>`).join('');
}
/* 탭 드래그로 순서 조정 (capture 단계에서 처리해 페이지의 엑셀 드롭존과 충돌 방지) */
let TAB_DRAG = null;
document.addEventListener('dragstart', (e) => {
  const t = e.target.closest && e.target.closest('.ptab[data-tab]');
  if (!t) return;
  TAB_DRAG = t.dataset.tab;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', TAB_DRAG); } catch (err) { }
});
document.addEventListener('dragend', () => {
  TAB_DRAG = null;
  $$('.ptab.drag-over').forEach((el) => el.classList.remove('drag-over'));
});
document.addEventListener('dragover', (e) => {
  if (!TAB_DRAG) return;
  e.stopPropagation(); // 엑셀 드롭존의 drop-active 표시 차단
  const t = e.target.closest && e.target.closest('.ptab[data-tab]');
  $$('.ptab.drag-over').forEach((el) => { if (el !== t) el.classList.remove('drag-over'); });
  if (t && t.dataset.tab !== TAB_DRAG) { e.preventDefault(); t.classList.add('drag-over'); }
}, true);
document.addEventListener('drop', (e) => {
  if (!TAB_DRAG) return;
  e.stopPropagation();
  e.preventDefault();
  const t = e.target.closest && e.target.closest('.ptab[data-tab]');
  if (t && t.dataset.tab !== TAB_DRAG) {
    const from = OPEN_TABS.indexOf(TAB_DRAG);
    let to = OPEN_TABS.indexOf(t.dataset.tab);
    OPEN_TABS.splice(from, 1);
    to = OPEN_TABS.indexOf(t.dataset.tab);
    OPEN_TABS.splice(from < to + 1 ? to + 1 : to, 0, TAB_DRAG); // 앞→뒤는 대상 뒤에, 뒤→앞은 대상 앞에
    tabsSave();
    const cur = $('.nav-btn.active');
    renderTabBar(cur ? cur.dataset.page : null);
  }
  TAB_DRAG = null;
}, true);
document.addEventListener('click', (e) => {
  const x = e.target.closest('[data-tab-close]');
  if (x) {
    const p = x.dataset.tabClose;
    OPEN_TABS = OPEN_TABS.filter((t) => t !== p);
    tabsSave();
    const cur = $('.nav-btn.active');
    if (cur && cur.dataset.page === p) showPage(OPEN_TABS[OPEN_TABS.length - 1] || 'home');
    else renderTabBar(cur ? cur.dataset.page : null);
    return;
  }
  const t = e.target.closest('.ptab[data-tab]');
  if (t) showPage(t.dataset.tab);
});

function showPage(page, opts) {
  fillTodayLabels();
  if (PAGE_TITLES[page] && !OPEN_TABS.includes(page)) { OPEN_TABS.push(page); tabsSave(); }
  renderTabBar(PAGE_TITLES[page] ? page : null);
  // 브라우저 히스토리 연동: 뒤로/앞으로 버튼·마우스 제스처(웨일 내장, 크롬 확장)로 화면 간 이동 가능
  if (!(opts && opts.fromHistory)) {
    const hash = '#' + page;
    if (location.hash !== hash) history.pushState({ page }, '', hash);
  }
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => (p.hidden = p.id !== 'page-' + page));
  const render = { materials: renderMaterials, finished: renderFinished, orders: renderOrders, bom: renderBom, check: renderCheck, receive: renderReceive, inquiry: renderInquiry, issue: renderIssue, issuelist: renderIssueList, codes: renderCodes, analytics: renderAnalytics, alert: renderAlert, po: renderPo, rmissues: renderRmIssues, cost: renderCost, home: renderHomeBrief }[page];
  if (render) render();
}
function refreshCurrentPage() {
  const cur = $('.nav-btn.active');
  showPage(cur ? cur.dataset.page : 'home');
}
$$('.nav-btn').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page)));
document.addEventListener('click', (e) => { const c = e.target.closest('.hub-card[data-goto]'); if (c) showPage(c.dataset.goto); });
/* 사이드바 대분류 접기/펴기 (상태 저장) */
(() => {
  const KEY = 'bl-purchase-nav-collapsed';
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { }
  const apply = () => $$('.nav-cat').forEach((c) => {
    const on = collapsed.includes(c.dataset.cat);
    c.classList.toggle('collapsed', on);
    const sub = $(`.nav-sub[data-sub="${c.dataset.cat}"]`);
    if (sub) sub.classList.toggle('collapsed', on);
  });
  apply();
  $$('.nav-cat').forEach((c) => c.addEventListener('click', () => {
    const k = c.dataset.cat;
    collapsed = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k];
    localStorage.setItem(KEY, JSON.stringify(collapsed));
    apply();
  }));
})();

/* ===================== 공통 표시 요소 ===================== */
/* 재고율 배지: 현재고 ÷ 안전재고 (안전재고 미설정 시 '-') */
function stockBadge(stock, safety) {
  if (!num(safety)) return '<span class="badge plain">-</span>';
  const r = num(stock) / num(safety) * 100;
  const cls = r >= 100 ? 'ok' : r >= 50 ? 'warn' : 'bad';
  return `<span class="badge ${cls}">${r.toFixed(0)}%</span>`;
}
function orderStatusBadge(s) {
  const cls = { '입고완료': 'ok', '부분입고': 'warn', '미입고': 'bad' }[s] || 'plain';
  return `<span class="badge ${cls}">${esc(s || '미입고')}</span>`;
}
/* 색상 코드 → 표시 색 (통합보드와 동일) */
const FIN_COLORS = { BL: '#2D6FB8', GR: '#3B8C5A', PN: '#D98AB0', WH: '#D9D9D9', SB: '#7FA8D0', PP: '#8B6FB0', OR: '#E08A3C', YL: '#E0C03C', RD: '#C8503C' };
function colorCell(c) {
  const v = String(c || '').trim();
  if (!v || v === '-') return '<span class="muted">—</span>';
  const dot = `<span class="color-dot" style="background:${FIN_COLORS[v.toUpperCase()] || '#B0B0B0'}"></span>`;
  return dot + esc(v);
}
/* 표 안 즉시수정 입력칸 (콤마 표시 — 저장 시 자동 제거) */
const cellEdit = (col, id, field, val) =>
  `<input class="cell-edit" type="text" inputmode="decimal" value="${val == null || val === '' ? '' : Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}" data-col="${col}" data-id="${id}" data-field="${field}">`;
/* 토스트 알림 */
let _toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
/* select 옵션 채우기 (현재 선택 유지) */
function fillSelectOptions(sel, values, allLabel) {
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('');
  if (values.includes(cur)) sel.value = cur;
}
/* 엑셀(.xlsx) 내보내기 */
function downloadXlsx(filename, sheetName, headers, rows) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
/* CSV 내보내기 */
function downloadCsv(filename, headers, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===================== 원부자재 재고 현황 =====================
   기본 양식: '재고 코드수정본' 엑셀의 최신 월("NN년 NN월재고") 시트에서 당월 재고·단가·금액만 사용.
   메인 표시: 품목명 · 신규이름 · 신규코드 · 당월 재고 · 당월 단가 · 당월 금액 · 조사자(차훈) */
let MAT_CAT = ''; // 대분류 칩 필터 ('' = 전체)
let MAT_DIV = '부목'; // 구분 토글: 부목 / 하이드로겔 (엑셀 '구분'에 hydrogel 표기된 것만 하이드로겔)
const MAT_INSPECTOR = '차훈'; // 현재 이 조사자 담당분만 표시 (데이터에는 전체 조사자 보존)
const myMaterials = () => MATERIALS.filter((m) => (m.inspector || '') === MAT_INSPECTOR && (m.division || '부목') === MAT_DIV);
function setMatDiv(div) {
  MAT_DIV = div;
  MAT_CAT = '';
  $$('#mat-div-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.div === div));
  renderMaterials();
}
const matAmount = (m) => (m.amount != null && m.amount !== '') ? num(m.amount) : num(m.stock) * num(m.price);
function matMonthLabel() {
  const el = $('#mat-month');
  if (el) el.textContent = (localStorage.getItem(DB_PREFIX + 'materials-month') || '') + ' 기준';
}
function matUpdatedLabel() {
  const el = $('#mat-updated');
  if (!el) return;
  const ts = localStorage.getItem(DB_PREFIX + 'materials-xlsx-at');
  if (!ts) { el.textContent = ''; return; }
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  el.textContent = `· 엑셀 업로드 ${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function filteredMaterials() {
  let rows = myMaterials(); // 조사자 '차훈' 담당분만
  const q = $('#m-search').value.trim().toLowerCase();
  if (MAT_CAT) rows = rows.filter((m) => (m.category || '') === MAT_CAT);
  if (q) rows = rows.filter((m) => [m.name, m.newName, m.newCode, m.note].some((v) => String(v || '').toLowerCase().includes(q)));
  return rows; // 엑셀 원본 순서 유지
}
/* 적정재고: 최근 6개월 입고 내역(발주내역·입고조회)의 월평균 입고량 × 1.5 */
function matAdequateMap() {
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s\r\n"']/g, '');
  const cutoff = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();
  const byKey = {};
  iqReceipts().forEach((o) => {
    const d = iqDate(o);
    if (!d || d < cutoff) return;
    const q = iqQty(o);
    if (o.spec) byKey['C' + norm(o.spec)] = (byKey['C' + norm(o.spec)] || 0) + q;
    if (o.item) byKey['N' + norm(o.item)] = (byKey['N' + norm(o.item)] || 0) + q;
  });
  return (m) => {
    const c = m.newCode != null && m.newCode !== '' ? byKey['C' + norm(m.newCode)] : null;
    const t = c != null ? c : byKey['N' + norm(m.name)];
    return t == null ? null : Math.round(t / 6 * 1.5); // 월평균 × 1.5
  };
}
function renderMaterials() {
  matMonthLabel();
  matUpdatedLabel();
  const mine = myMaterials();
  // 대분류 칩 (차훈 담당분 기준 동적 생성, 현재 선택 유지)
  const cats = [...new Set(mine.map((m) => m.category).filter(Boolean))];
  if (MAT_CAT && !cats.includes(MAT_CAT)) MAT_CAT = '';
  $('#m-cats').innerHTML = `<button class="chip${MAT_CAT === '' ? ' active' : ''}" data-cat="">전체</button>`
    + cats.map((c) => `<button class="chip${MAT_CAT === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');

  const rows = filteredMaterials();
  const totalAmt = mine.reduce((a, m) => a + matAmount(m), 0);
  const catSubs = cats.map((c) => `${c} ${mine.filter((m) => m.category === c).length}`).join(' · ');
  // 대분류별 당월 금액 타일 (요청 순서 고정, 없는 분류는 0원 — 표 배지와 같은 색)
  const CAT_TILE = { '원재료': 'ca-blue', '부재료': 'ca-green', '반제품': 'ca-amber', '완제품': 'ca-purple' };
  const catAmtTiles = ['원재료', '부재료', '반제품', '완제품'].map((c) => {
    const amt = mine.filter((m) => m.category === c).reduce((a, m) => a + matAmount(m), 0);
    return `<div class="cat-amt ${CAT_TILE[c]}"><span class="ca-label">${c}</span><span class="ca-val">${fmt(Math.round(amt))}원</span></div>`;
  }).join('');
  // 담당 전체(부목+하이드로겔) 총 합계 — 구분 토글과 무관하게 항상 표시
  const allMine = MATERIALS.filter((m) => (m.inspector || '') === MAT_INSPECTOR);
  const divLine = ['부목', '하이드로겔'].map((d) => {
    const amt = allMine.filter((m) => (m.division || '부목') === d).reduce((a, m) => a + matAmount(m), 0);
    return `${d} ${fmt(Math.round(amt))}원`;
  }).join(' · ');
  const totalAll = allMine.reduce((a, m) => a + matAmount(m), 0);
  $('#mat-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">${MAT_DIV} 담당 품목 (조사자 ${MAT_INSPECTOR})</div><div class="k-value">${fmt(mine.length)}<small>종</small></div><div class="k-sub">${catSubs || '등록 기준'}</div></div>
    <div class="kpi"><div class="k-label">${MAT_DIV} 당월 재고 금액 합계</div><div class="k-value">${fmt(Math.round(totalAmt))}<small>원</small></div><div class="cat-amt-grid">${catAmtTiles}</div></div>
    <div class="kpi green"><div class="k-label">담당 전체 총 합계 (부목+하이드로겔)</div><div class="k-value">${fmt(Math.round(totalAll))}<small>원</small></div><div class="k-sub">${divLine}</div></div>
    <div class="kpi"><div class="k-label">신규코드 등록</div><div class="k-value">${fmt(mine.filter((m) => m.newCode).length)}<small>종</small></div><div class="k-sub">미등록 ${fmt(mine.filter((m) => !m.newCode).length)}종</div></div>
    <div class="kpi"><div class="k-label">전체 데이터</div><div class="k-value">${fmt(MATERIALS.length)}<small>종</small></div><div class="k-sub">전체 조사자·구분 합계 (표시는 ${MAT_INSPECTOR} · ${MAT_DIV}만)</div></div>`;

  if (!rows.length) { $('#materials-table').innerHTML = '<div class="empty">표시할 자재가 없습니다. [＋ 자재 등록] 또는 엑셀 업로드로 추가하세요.</div>'; return; }
  const catBadge = (c) => {
    if (!c) return '<span class="badge plain">-</span>';
    const cls = { '원재료': 'neal', '부재료': 'ok', '반제품': 'warn', '완제품': 'oem' }[c] || 'plain';
    return `<span class="badge ${cls}">${esc(c)}</span>`;
  };
  const adequate = matAdequateMap();
  const body = rows.map((m) => {
    const adq = adequate(m);
    const low = adq != null && num(m.stock) < adq;
    return `<tr data-material-id="${m.id}">
    <td>${catBadge(m.category)}</td>
    <td><b>${esc(m.name)}</b></td>
    <td>${esc(m.newName ?? '')}</td>
    <td>${m.newCode ? esc(m.newCode) : '<span class="muted">—</span>'}</td>
    <td>${esc(m.unit ?? '')}</td>
    <td class="num">${adq != null ? (low ? `<b style="color:var(--danger)" title="당월 재고가 적정재고보다 적습니다">${fmt(adq)}</b>` : fmt(adq)) : '<span class="muted">—</span>'}</td>
    <td class="num">${cellEdit('materials', m.id, 'stock', m.stock)}</td>
    <td class="num">${cellEdit('materials', m.id, 'price', m.price)}</td>
    <td class="num">${matAmount(m) ? fmt(Math.round(matAmount(m))) : '-'}</td>
    <td>${esc(m.inspector || '차훈')}</td>
  </tr>`;
  }).join('');
  $('#materials-table').innerHTML = `<table><thead><tr>
    <th>대분류</th><th>품목명</th><th>신규이름</th><th>신규코드</th><th>단위</th>
    <th class="num" title="최근 6개월 월평균 입고량 × 1.5">적정재고</th><th class="num">당월 재고</th><th class="num">당월 단가</th><th class="num">당월 금액</th><th>조사자</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

/* ===================== 완제품 재고 현황 (내수/수출) ===================== */
let FIN_SCOPE = 'dom'; // 서브탭: dom(내수) / exp(수출)
let FIN_GROUP = '';    // 내수 제품군 칩 필터 ('' = 전체)
/* 엑셀 업로드 기준 시각 표시 */
function finUpdatedLabel() {
  const el = $('#fin-updated');
  if (!el) return;
  const ts = localStorage.getItem(DB_PREFIX + 'finished-xlsx-at');
  if (!ts) { el.textContent = ''; return; }
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  el.textContent = `엑셀 업로드 기준 ${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const isFinShort = (f) => num(f.safety) > 0 && num(f.qty) < num(f.safety);
function setFinScope(scope) {
  FIN_SCOPE = scope;
  $$('#fin-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.fin === scope));
  $('#fin-dom-filter').hidden = scope !== 'dom';
  $('#fin-exp-filter').hidden = scope !== 'exp';
  renderFinished();
}
function renderFinished() {
  const scopeKo = FIN_SCOPE === 'dom' ? '내수' : '수출';
  let rows = FINISHED.filter((f) => (f.scope || '내수') === scopeKo);
  const all = rows;

  finUpdatedLabel();
  if (FIN_SCOPE === 'dom') {
    const q = $('#fd-search').value.trim().toLowerCase();
    if (FIN_GROUP) rows = rows.filter((f) => f.group === FIN_GROUP);
    if (q) rows = rows.filter((f) => [f.code, f.brand, f.type, f.color].some((v) => String(v || '').toLowerCase().includes(q)));
    if ($('#fd-short').checked) rows = rows.filter(isFinShort);
    rows.sort((a, b) => a.id - b.id); // 원본(통합보드) 등록 순서 유지
    // KPI (통합보드와 동일 항목): 총 SKU · 총 재고 · 안전재고 합 · 부족 SKU · 부족 합계 · 충족률
    const total = all.reduce((a, f) => a + num(f.qty), 0);
    const safeSum = all.reduce((a, f) => a + num(f.safety), 0);
    const shortCnt = all.filter(isFinShort).length;
    const shortSum = all.reduce((a, f) => a + Math.min(0, num(f.qty) - num(f.safety)), 0);
    const fulfill = all.length ? Math.round((all.length - shortCnt) / all.length * 100) : 0;
    $('#fin-kpi').innerHTML = `
      <div class="kpi accent"><div class="k-label">총 SKU</div><div class="k-value">${fmt(all.length)}<small>종</small></div><div class="k-sub">내수 등록 기준</div></div>
      <div class="kpi"><div class="k-label">총 재고</div><div class="k-value">${fmt(total)}</div><div class="k-sub">내수 합계</div></div>
      <div class="kpi"><div class="k-label">안전재고 합</div><div class="k-value">${fmt(safeSum)}</div><div class="k-sub">기준 수량</div></div>
      <div class="kpi ${shortCnt ? 'red' : 'green'}"><div class="k-label">부족 SKU</div><div class="k-value">${fmt(shortCnt)}<small>종</small></div><div class="k-sub">재고 &lt; 안전재고</div></div>
      <div class="kpi ${shortSum < 0 ? 'red' : 'green'}"><div class="k-label">부족 합계</div><div class="k-value">${fmt(shortSum)}</div><div class="k-sub">부족분 수량 합</div></div>
      <div class="kpi ${fulfill >= 80 ? 'green' : fulfill >= 50 ? '' : 'red'}"><div class="k-label">충족률</div><div class="k-value">${fulfill}%</div><div class="k-sub">충족 SKU ÷ 전체 SKU</div></div>`;
    if (!rows.length) { $('#finished-table').innerHTML = '<div class="empty">표시할 내수 재고가 없습니다. [＋ 재고 등록]으로 추가하세요.</div>'; return; }
    let lastGroup = null;
    const body = rows.map((f) => {
      const gap = num(f.qty) - num(f.safety);
      const st = !num(f.safety) ? '<span class="badge plain">-</span>' : (gap >= 0 ? '<span class="badge ok">충분</span>' : '<span class="badge bad">부족</span>');
      let head = '';
      if ((f.group || '') !== lastGroup) {
        lastGroup = f.group || '';
        const cnt = rows.filter((x) => (x.group || '') === lastGroup).length;
        head = `<tr class="grp-row no-click"><td colspan="10">${esc(lastGroup || '기타')} · ${cnt}종</td></tr>`;
      }
      return `${head}<tr data-fin-id="${f.id}">
        <td>${esc(f.group ?? '')}</td><td>${esc(f.brand ?? '')}</td><td>${esc(f.type ?? '')}</td><td>${colorCell(f.color)}</td>
        <td><b>${esc(f.code)}</b></td>
        <td class="num">${cellEdit('finished', f.id, 'qty', f.qty)}</td><td class="num">${cellEdit('finished', f.id, 'safety', f.safety)}</td>
        <td>${stockBadge(f.qty, f.safety)}</td>
        <td class="num">${num(f.safety) ? (gap >= 0 ? '+' : '') + fmt(gap, 2) : '-'}</td>
        <td>${st}</td>
      </tr>`;
    }).join('');
    $('#finished-table').innerHTML = `<table><thead><tr>
      <th>제품군</th><th>브랜드</th><th>Type</th><th>Color</th><th>제품코드</th>
      <th class="num">현재고</th><th class="num">안전재고</th><th>재고율</th><th class="num">과부족</th><th>상태</th>
    </tr></thead><tbody>${body}</tbody></table>`;
  } else {
    fillSelectOptions($('#fe-sup'), [...new Set(all.map((f) => f.supplier).filter(Boolean))].sort(), '전체');
    const sup = $('#fe-sup').value, q = $('#fe-search').value.trim().toLowerCase();
    if (sup) rows = rows.filter((f) => f.supplier === sup);
    if (q) rows = rows.filter((f) => [f.code, f.type, f.base].some((v) => String(v || '').toLowerCase().includes(q)));
    rows.sort((a, b) => a.id - b.id); // 원본(통합보드) 등록 순서 유지 (거래처별로 이미 묶여 있음)
    $('#fin-kpi').innerHTML = `
      <div class="kpi accent"><div class="k-label">수출 SKU</div><div class="k-value">${fmt(all.length)}<small>종</small></div><div class="k-sub">등록 기준</div></div>
      <div class="kpi"><div class="k-label">총 재고수량</div><div class="k-value">${fmt(all.reduce((a, f) => a + num(f.qty), 0))}</div><div class="k-sub">수출 합계</div></div>
      <div class="kpi"><div class="k-label">해외거래처</div><div class="k-value">${fmt(new Set(all.map((f) => f.supplier).filter(Boolean)).size)}<small>곳</small></div><div class="k-sub">※ 업체별 출고 기준 · 안전재고 미적용</div></div>`;
    if (!rows.length) { $('#finished-table').innerHTML = '<div class="empty">표시할 수출 재고가 없습니다. [＋ 재고 등록]으로 추가하세요.</div>'; return; }
    let lastSup = null;
    const body = rows.map((f) => {
      let head = '';
      if ((f.supplier || '') !== lastSup) {
        lastSup = f.supplier || '';
        const grp = rows.filter((x) => (x.supplier || '') === lastSup);
        const sum = grp.reduce((a, x) => a + num(x.qty), 0);
        head = `<tr class="grp-row no-click"><td colspan="8">${esc(lastSup || '기타')} · ${grp.length}종 · 합계 ${fmt(sum)}</td></tr>`;
      }
      return `${head}<tr data-fin-id="${f.id}">
        <td>${esc(f.supplier ?? '')}</td><td>${esc(f.lot ?? '')}</td><td>${esc(f.group ?? '')}</td><td>${esc(f.type ?? '')}</td>
        <td>${esc(f.base ?? '')}</td><td>${colorCell(f.color)}</td><td><b>${esc(f.code)}</b></td>
        <td class="num">${cellEdit('finished', f.id, 'qty', f.qty)}</td>
      </tr>`;
    }).join('');
    $('#finished-table').innerHTML = `<table><thead><tr>
      <th>해외거래처</th><th>차수/비고</th><th>제품군</th><th>Type</th><th>기재</th><th>Color</th><th>제품코드</th><th class="num">수량</th>
    </tr></thead><tbody>${body}</tbody></table>`;
  }
}

/* ===================== 발주내역 ===================== */
/* 금액: 입력값이 있으면 그대로, 없으면 수량 × 단가 (통합보드 데이터에 금액≠수량×단가 행이 있어 별도 보존) */
const orderAmount = (o) => (o.amount != null && o.amount !== '') ? num(o.amount) : num(o.qty) * num(o.price);
const ORD_LIMIT = 300; // 표시 상한 (통합보드와 동일) — 필터로 좁히면 전체 탐색 가능
function filteredOrders() {
  let rows = ORDERS.slice();
  const from = $('#o-from').value, to = $('#o-to').value;
  const sup = $('#o-sup').value, st = $('#o-state').value;
  const q = $('#o-search').value.trim().toLowerCase();
  if (from) rows = rows.filter((o) => (o.date || '') >= from);
  if (to) rows = rows.filter((o) => (o.date || '') <= to);
  if (sup) rows = rows.filter((o) => o.supplier === sup);
  if (st) rows = rows.filter((o) => (o.status || '미입고') === st);
  if (q) rows = rows.filter((o) => [o.item, o.spec, o.note].some((v) => String(v || '').toLowerCase().includes(q)));
  rows.sort((a, b) => (a.date === b.date ? b.id - a.id : (a.date || '') < (b.date || '') ? 1 : -1));
  return rows;
}
function renderOrders() {
  ordUpdatedLabel();
  fillSelectOptions($('#o-sup'), [...new Set(ORDERS.map((o) => o.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), '전체');
  const rows = filteredOrders();
  // KPI (통합보드와 동일 항목, 전체 기록 기준): 전체 발주 기록 · 미입고 · 이번 달 발주 · 거래처
  const years = [...new Set(ORDERS.map((o) => String(o.date || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort();
  const open = ORDERS.filter((o) => (o.status || '미입고') !== '입고완료');
  const openAmt = open.reduce((a, o) => a + orderAmount(o), 0);
  const ym = todayStr().slice(0, 7);
  const mon = ORDERS.filter((o) => String(o.date || '').startsWith(ym));
  const monAmt = mon.reduce((a, o) => a + orderAmount(o), 0);
  const supCnt = new Set(ORDERS.map((o) => o.supplier).filter(Boolean)).size;
  $('#ord-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">전체 발주 기록</div><div class="k-value">${fmt(ORDERS.length)}<small>건</small></div><div class="k-sub">${years.length ? years[0] + ' ~ ' + years[years.length - 1] : '등록 기준'}</div></div>
    <div class="kpi ${open.length ? 'red' : 'green'}"><div class="k-label">미입고 · 부분입고</div><div class="k-value">${fmt(open.length)}<small>건</small></div><div class="k-sub">${fmt(Math.round(openAmt))}원 · 입고 추적 필요</div></div>
    <div class="kpi"><div class="k-label">이번 달 발주</div><div class="k-value">${fmt(mon.length)}<small>건</small></div><div class="k-sub">${fmt(Math.round(monAmt))}원</div></div>
    <div class="kpi"><div class="k-label">거래처</div><div class="k-value">${fmt(supCnt)}<small>곳</small></div><div class="k-sub">누적 기준</div></div>`;

  if (!rows.length) { $('#orders-table').innerHTML = '<div class="empty">표시할 발주 기록이 없습니다. [＋ 발주 등록]으로 추가하세요.</div>'; return; }
  const shown = rows.slice(0, ORD_LIMIT);
  const body = shown.map((o) => `<tr data-order-id="${o.id}">
    <td>${esc(o.date ?? '')}</td><td>${esc(o.supplier ?? '')}</td><td><b>${esc(o.item)}</b></td>
    <td>${esc(o.spec ?? '')}</td><td>${esc(o.unit ?? '')}</td>
    <td class="num">${fmt(o.qty, 2)}</td><td class="num">${fmt(o.price)}</td><td class="num">${orderAmount(o) ? fmt(orderAmount(o)) : '-'}</td>
    <td>${esc(o.due ?? '')}</td><td>${esc(o.inDate ?? '')}</td><td class="num">${fmt(o.inQty, 2)}</td>
    <td>${orderStatusBadge(o.status)}</td><td>${esc(o.note ?? '')}</td>
  </tr>`).join('');
  const foot = `<p class="muted" style="margin-top:8px">표시 ${fmt(shown.length)}건 · 조건일치 ${fmt(rows.length)}건 · 전체 ${fmt(ORDERS.length)}건${rows.length > ORD_LIMIT ? ' — 더 보려면 기간/거래처/검색으로 좁혀주세요' : ''}</p>`;
  $('#orders-table').innerHTML = `<table><thead><tr>
    <th>발주일</th><th>거래처</th><th>품명</th><th>규격</th><th>단위</th>
    <th class="num">수량</th><th class="num">단가</th><th class="num">금액</th>
    <th>납기</th><th>입고일</th><th class="num">입고수량</th><th>상태</th><th>비고</th>
  </tr></thead><tbody>${body}</tbody></table>` + foot;
}
/* 발주내역 엑셀 업로드 기준 시각 */
function ordUpdatedLabel() {
  const el = $('#ord-updated');
  if (!el) return;
  const ts = localStorage.getItem(DB_PREFIX + 'orders-xlsx-at');
  if (!ts) { el.textContent = ''; return; }
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  el.textContent = `· 엑셀 업로드 기준 ${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ===================== 등록/수정 모달 공통 ===================== */
function wireModal(cfg) {
  const form = $(cfg.form);
  const modal = $(cfg.modal);
  let editingId = null;
  const open = (id = null) => {
    editingId = id;
    form.reset();
    $(cfg.title).textContent = id ? cfg.labels[1] : cfg.labels[0];
    $(cfg.del).hidden = !id;
    if (id) {
      const rec = cfg.list().find((x) => x.id === id);
      if (!rec) return;
      [...form.elements].forEach((el) => { if (el.name && rec[el.name] != null) el.value = rec[el.name]; });
    } else if (cfg.init) cfg.init(form);
    modal.hidden = false;
  };
  $(cfg.newBtn).addEventListener('click', () => open());
  $(cfg.close).addEventListener('click', () => (modal.hidden = true));
  $(cfg.cancel).addEventListener('click', () => (modal.hidden = true));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const rec = {};
    [...form.elements].forEach((el) => {
      if (!el.name) return;
      rec[el.name] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : (el.value || null);
    });
    if (editingId) dbUpdate(cfg.col, editingId, rec);
    else dbCreate(cfg.col, rec);
    reloadAll();
    modal.hidden = true;
    refreshCurrentPage();
  });
  $(cfg.del).addEventListener('click', () => {
    if (!editingId || !confirm(cfg.confirmDel)) return;
    dbRemove(cfg.col, editingId);
    reloadAll();
    modal.hidden = true;
    refreshCurrentPage();
  });
  return open;
}

const openMaterialModal = wireModal({
  col: 'materials', form: '#material-form', modal: '#material-modal', title: '#material-modal-title',
  newBtn: '#btn-new-material', close: '#material-modal-close', cancel: '#material-cancel', del: '#material-delete',
  labels: ['자재 등록', '자재 수정'], confirmDel: '이 자재를 삭제하시겠습니까?',
  list: () => MATERIALS,
  init: (form) => { form.elements.division.value = MAT_DIV; },
});
const openFinModal = wireModal({
  col: 'finished', form: '#fin-form', modal: '#fin-modal', title: '#fin-modal-title',
  newBtn: '#btn-new-fin', close: '#fin-modal-close', cancel: '#fin-cancel', del: '#fin-delete',
  labels: ['완제품 재고 등록', '완제품 재고 수정'], confirmDel: '이 재고 항목을 삭제하시겠습니까?',
  list: () => FINISHED,
  init: (form) => { form.elements.scope.value = FIN_SCOPE === 'exp' ? '수출' : '내수'; },
});
const openOrderModal = wireModal({
  col: 'orders', form: '#order-form', modal: '#order-modal', title: '#order-modal-title',
  newBtn: '#btn-new-order', close: '#order-modal-close', cancel: '#order-cancel', del: '#order-delete',
  labels: ['발주 등록', '발주 수정'], confirmDel: '이 발주 기록을 삭제하시겠습니까?',
  list: () => ORDERS,
  init: (form) => { form.elements.date.value = todayStr(); },
});

/* 표 안 즉시수정: 값 바꾸고 포커스가 빠지면 자동 저장 */
document.addEventListener('change', (e) => {
  const inp = e.target.closest('.cell-edit');
  if (!inp) return;
  const { col, field } = inp.dataset;
  const id = Number(inp.dataset.id);
  const raw = inp.value.replace(/,/g, '').trim();
  if (raw !== '' && isNaN(Number(raw))) { toast('숫자만 입력할 수 있습니다'); refreshCurrentPage(); return; }
  const val = raw === '' ? null : Number(raw);
  const patch = { [field]: val };
  // 원부자재: 재고/단가를 고치면 당월 금액도 재계산해 저장
  if (col === 'materials' && (field === 'stock' || field === 'price')) {
    const cur = MATERIALS.find((m) => m.id === id) || {};
    const stock = field === 'stock' ? val : cur.stock;
    const price = field === 'price' ? val : cur.price;
    patch.amount = (stock != null && price != null) ? Math.round(stock * price * 100) / 100 : null;
  }
  dbUpdate(col, id, patch);
  reloadAll();
  refreshCurrentPage(); // 금액·KPI 즉시 갱신
});

/* 행 클릭 → 수정 모달 (즉시수정 입력칸 클릭은 제외) */
document.addEventListener('click', (e) => {
  if (e.target.closest('.cell-edit')) return;
  const mt = e.target.closest('tr[data-material-id]');
  if (mt) { openMaterialModal(Number(mt.dataset.materialId)); return; }
  const ft = e.target.closest('tr[data-fin-id]');
  if (ft) { openFinModal(Number(ft.dataset.finId)); return; }
  const ot = e.target.closest('tr[data-order-id]');
  if (ot) openOrderModal(Number(ot.dataset.orderId));
});

/* ===================== 엑셀 업로드 (완제품 재고 갱신) =====================
   통합보드와 같은 엑셀 양식을 그대로 읽는다:
   - '내수 재고현황' 시트: 제품군/브랜드/Type/기재/Color/제품코드/요약(현재고)/안전재고 (병합셀 forward-fill)
   - '해외 재고현황' 시트: 해외거래처/비고/제품군/Type/기재/Color/제품코드/요약(수량) (계층 forward-fill, 소계행 제외)
   읽힌 시트의 범위(내수/수출)만 통째로 교체된다. */
function parseNaesuWB(wb) {
  const ws = wb.Sheets['내수 재고현황'];
  if (!ws) throw new Error("'내수 재고현황' 시트를 찾을 수 없습니다");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const rr = (rows[i] || []).map((c) => c == null ? '' : String(c).trim());
    if (rr.includes('제품코드') && rr.includes('안전재고')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('헤더(제품코드/안전재고)를 찾을 수 없습니다');
  const H = {};
  (rows[hi] || []).forEach((c, idx) => { const s = c == null ? '' : String(c).trim(); if (s && H[s] == null) H[s] = idx; });
  const ci = { grp: H['제품군'], brand: H['브랜드'], type: H['Type'], base: H['기재'], color: H['Color'], code: H['제품코드'], cur: (H['요약'] != null ? H['요약'] : H['현재고']), safe: H['안전재고'] };
  if (ci.code == null || ci.cur == null || ci.safe == null) throw new Error('필요 컬럼(제품코드/요약·현재고/안전재고)을 못 찾았습니다');
  const gcols = [ci.grp, ci.brand, ci.type, ci.base, ci.color], ff = ['', '', '', '', ''], out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    gcols.forEach((gc, k) => { if (gc != null) { const v = r[gc] == null ? '' : String(r[gc]).trim(); if (v) ff[k] = v; } });
    const code = r[ci.code] == null ? '' : String(r[ci.code]).trim();
    if (!code || r[ci.cur] == null || r[ci.cur] === '') continue;
    const cur = Number(r[ci.cur]);
    if (!isFinite(cur)) continue;
    const safe = Number(r[ci.safe]);
    out.push({ scope: '내수', group: ff[0], brand: ff[1], type: ff[2], base: ff[3], color: ff[4] === '-' ? '' : ff[4], code, qty: Math.round(cur), safety: isFinite(safe) ? Math.round(safe) : 0 });
  }
  return out;
}
function parseHaewoeWB(wb) {
  const ws = wb.Sheets['해외 재고현황'];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const rr = (rows[i] || []).map((c) => c == null ? '' : String(c).trim());
    if (rr.includes('해외거래처') && rr.includes('제품코드')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('해외 시트 헤더(해외거래처/제품코드)를 찾을 수 없습니다');
  const H = {};
  (rows[hi] || []).forEach((c, idx) => { const t = c == null ? '' : String(c).trim(); if (t && H[t] == null) H[t] = idx; });
  const lv = [H['해외거래처'], H['비고'], H['제품군'], H['Type'], H['기재'], H['Color']];
  const ciCode = H['제품코드'], ciQty = (H['요약'] != null ? H['요약'] : H['수량']);
  if (ciCode == null || ciQty == null) throw new Error('해외 시트 컬럼(제품코드/요약·수량)을 못 찾았습니다');
  const g = (r, idx) => idx == null || r[idx] == null ? '' : String(r[idx]).trim();
  const skip = (v) => v.includes('요약') || v.includes('총합계');
  const ff = ['', '', '', '', '', ''], out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    let top = -1;
    for (let k = 0; k < 6; k++) { const v = g(r, lv[k]); if (v && !skip(v)) { top = k; break; } }
    if (top >= 0) { for (let m = top + 1; m < 6; m++) ff[m] = ''; }
    for (let k = 0; k < 6; k++) { const v = g(r, lv[k]); if (v && !skip(v)) ff[k] = v; }
    const code = g(r, ciCode);
    if (!code) continue;
    const q = Number(r[ciQty]);
    if (!isFinite(q)) continue;
    out.push({ scope: '수출', supplier: ff[0], lot: ff[1], group: ff[2], type: ff[3], base: ff[4], color: ff[5] === '-' ? '' : ff[5], code, qty: Math.round(q) });
  }
  return out;
}
function uploadFinishedXlsx(file) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const r = new FileReader();
  r.onload = () => {
    let wb;
    try { wb = XLSX.read(new Uint8Array(r.result), { type: 'array' }); }
    catch (e) { toast('엑셀 파일을 읽지 못했습니다: ' + e.message); return; }
    let dom = null, exp = null;
    const errs = [];
    try { dom = parseNaesuWB(wb); } catch (e) { errs.push('내수: ' + e.message); }
    try { exp = parseHaewoeWB(wb); } catch (e) { errs.push('수출: ' + e.message); }
    if ((!dom || !dom.length) && (!exp || !exp.length)) { toast('읽을 시트가 없습니다 — ' + (errs.join(' / ') || '형식을 확인하세요')); return; }
    let list = dbLoad('finished');
    let nextId = list.reduce((m, x) => Math.max(m, x.id || 0), 0);
    const now = new Date().toISOString();
    const msgs = [];
    if (dom && dom.length) {
      list = list.filter((f) => (f.scope || '내수') !== '내수').concat(dom.map((f) => Object.assign(f, { id: ++nextId, createdAt: now, updatedAt: now })));
      msgs.push(`내수 ${dom.length} SKU`);
    }
    if (exp && exp.length) {
      list = list.filter((f) => (f.scope || '내수') !== '수출').concat(exp.map((f) => Object.assign(f, { id: ++nextId, createdAt: now, updatedAt: now })));
      msgs.push(`수출 ${exp.length}행`);
    }
    dbSave('finished', list);
    localStorage.setItem(DB_PREFIX + 'finished-xlsx-at', new Date().toISOString());
    reloadAll();
    refreshCurrentPage();
    toast('재고 반영·자동저장: ' + msgs.join(' · '));
  };
  r.onerror = () => toast('파일을 읽지 못했습니다');
  r.readAsArrayBuffer(file);
}
$('#btn-xlsx-fin').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = () => { if (inp.files[0]) uploadFinishedXlsx(inp.files[0]); };
  inp.click();
});
/* 완제품 화면에 엑셀 끌어다 놓기 */
(() => {
  const zone = $('#page-finished');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.xlsx?$/i.test(f.name)) uploadFinishedXlsx(f);
    else if (f) toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();

/* ===================== 엑셀 업로드 (발주내역 갱신) =====================
   통합보드와 같은 엑셀 양식: 헤더에 '발주일자/거래처/품명'이 있는 시트를 자동으로 찾아
   발주일자·거래처·품명·단위·수량·단가·금액·납기 요청일·입고일자·입고 수량·입고여부·비고를 읽는다.
   전체 교체 방식(통합보드와 동일). */
function xlsDateStr(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000); // 23:59 파싱 밀림 보정(반일)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return String(v).trim().slice(0, 10).replace(/[./]/g, '-');
}
function hdrMap(rows, mustHave) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const rr = (rows[i] || []).map((c) => c == null ? '' : String(c).trim());
    if (mustHave.every((h) => rr.includes(h))) {
      const H = {};
      rr.forEach((c, idx) => { if (c && H[c] == null) H[c] = idx; });
      return { H, hi: i };
    }
  }
  return null;
}
function parseOrdersWB(wb) {
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    const m = hdrMap(rows, ['발주일자', '거래처', '품명']);
    if (!m) continue;
    const H = m.H;
    const g = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
    const gd = (r, k) => H[k] == null ? '' : xlsDateStr(r[H[k]]);
    const gn = (r, k) => { if (H[k] == null) return null; const n = Number(r[H[k]]); return isFinite(n) && r[H[k]] !== null && r[H[k]] !== '' ? Math.round(n) : null; };
    const out = [];
    let empty = 0;
    for (let i = m.hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = g(r, '품명'), sup = g(r, '거래처');
      if (!name && !sup) { if (++empty > 50) break; continue; }
      empty = 0;
      const inQty = gn(r, '입고 수량');
      const stateRaw = g(r, '입고여부');
      out.push({
        date: gd(r, '발주일자'), supplier: sup, item: name, unit: g(r, '단위'),
        qty: gn(r, '수량'), price: gn(r, '단가'), amount: gn(r, '금액'),
        due: gd(r, '납기 요청일'), inDate: gd(r, '입고일자'), inQty,
        status: /完|완료|완/.test(stateRaw) ? '입고완료' : (inQty > 0 ? '부분입고' : '미입고'),
        note: g(r, '비고'),
      });
    }
    if (out.length) return out;
  }
  throw new Error("발주내역 시트(발주일자/거래처/품명 헤더)를 찾을 수 없습니다");
}
function uploadOrdersXlsx(file) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const r = new FileReader();
  r.onload = () => {
    let out;
    try { out = parseOrdersWB(XLSX.read(new Uint8Array(r.result), { type: 'array', cellDates: true })); }
    catch (e) { toast('엑셀 오류: ' + e.message); return; }
    const now = new Date().toISOString();
    dbSave('orders', out.map((o, i) => Object.assign(o, { id: i + 1, createdAt: now, updatedAt: now })));
    localStorage.setItem(DB_PREFIX + 'orders-xlsx-at', now);
    reloadAll();
    refreshCurrentPage();
    toast(`발주 기록 ${out.length.toLocaleString()}건 반영·자동저장 (엑셀)`);
  };
  r.onerror = () => toast('파일을 읽지 못했습니다');
  r.readAsArrayBuffer(file);
}
$('#btn-xlsx-ord').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = () => { if (inp.files[0]) uploadOrdersXlsx(inp.files[0]); };
  inp.click();
});
/* 발주내역 화면에 엑셀 끌어다 놓기 */
(() => {
  const zone = $('#page-orders');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.xlsx?$/i.test(f.name)) uploadOrdersXlsx(f);
    else if (f) toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();

/* ===================== 엑셀 업로드 (원부자재 재고 갱신) =====================
   기본 양식: '재고 코드수정본' 엑셀. "NN년 NN월재고" 시트 중 가장 최신 월을 자동 선택해
   품목명·신규이름·신규코드·단위·당월(그 달) 재고/단가/금액·대분류·장소·비고를 읽는다.
   조사자는 요청에 따라 현재 전원 '차훈'으로 넣는다. 전체 교체 방식. */
function parseMaterialsWB(wb) {
  const normH = (s) => String(s ?? '').replace(/[\s\r\n]+/g, '');
  // 1) 최신 월 시트 선택
  let best = null;
  for (const sn of wb.SheetNames) {
    const m = normH(sn).match(/^(\d{2})년(\d{1,2})월재고/);
    if (!m) continue;
    const key = +m[1] * 100 + +m[2];
    if (!best || key > best.key) best = { sn, y: +m[1], m: +m[2], key };
  }
  if (!best) throw new Error('"NN년 NN월재고" 시트를 찾을 수 없습니다');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[best.sn], { header: 1, raw: true, defval: null });
  // 2) 헤더 행(품목명 포함) 탐색 후 컬럼 매핑
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if ((rows[i] || []).some((c) => normH(c) === '품목명')) { hi = i; break; }
  }
  if (hi < 0) throw new Error("헤더(품목명)를 찾을 수 없습니다");
  const H = {};
  (rows[hi] || []).forEach((c, idx) => { const t = normH(c); if (t && H[t] == null) H[t] = idx; });
  // 3) 당월 재고/단가/금액 컬럼 (제로패딩 유무 허용, 없으면 시트 내 최신 월로 폴백)
  const monthCol = (kind) => {
    for (const c of [`${best.y}년${String(best.m).padStart(2, '0')}월${kind}`, `${best.y}년${best.m}월${kind}`]) {
      if (H[c] != null) return H[c];
    }
    let bk = null;
    for (const t of Object.keys(H)) {
      const m = t.match(new RegExp(`^(\\d{2})년0?(\\d{1,2})월${kind}$`));
      if (m) { const key = +m[1] * 100 + +m[2]; if (!bk || key > bk.key) bk = { col: H[t], key }; }
    }
    return bk ? bk.col : null;
  };
  const cStock = monthCol('재고'), cPrice = monthCol('단가'), cAmt = monthCol('금액');
  if (cStock == null) throw new Error(`당월 재고 컬럼(${best.y}년${String(best.m).padStart(2, '0')}월재고)을 찾을 수 없습니다`);
  const numOr = (v) => { const n = Number(v); return (v == null || v === '' || !isFinite(n)) ? null : Math.round(n * 100) / 100; };
  const gs = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = r[H['품목명']] == null ? '' : String(r[H['품목명']]).trim();
    if (!name) continue;
    out.push({
      name, newName: gs(r, '신규이름'), newCode: gs(r, '신규코드'), unit: gs(r, '단위'),
      stock: numOr(r[cStock]), price: cPrice != null ? numOr(r[cPrice]) : null, amount: cAmt != null ? numOr(r[cAmt]) : null,
      category: gs(r, '대분류'), place: gs(r, '장소'),
      division: /hydrogel/i.test(gs(r, '구분')) ? '하이드로겔' : '부목',
      inspector: gs(r, '조사자'), note: gs(r, '비고'),
    });
  }
  if (!out.length) throw new Error('품목 데이터가 없습니다');
  return { month: `${best.y}년 ${String(best.m).padStart(2, '0')}월`, items: out };
}
function uploadMaterialsXlsx(file) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const r = new FileReader();
  r.onload = () => {
    let res;
    try { res = parseMaterialsWB(XLSX.read(new Uint8Array(r.result), { type: 'array' })); }
    catch (e) { toast('엑셀 오류: ' + e.message); return; }
    const now = new Date().toISOString();
    dbSave('materials', res.items.map((m, i) => Object.assign(m, { id: i + 1, createdAt: now, updatedAt: now })));
    localStorage.setItem(DB_PREFIX + 'materials-month', res.month);
    localStorage.setItem(DB_PREFIX + 'materials-xlsx-at', now);
    reloadAll();
    refreshCurrentPage();
    toast(`원부자재 ${res.items.length.toLocaleString()}품목 반영·자동저장 (${res.month} 기준)`);
  };
  r.onerror = () => toast('파일을 읽지 못했습니다');
  r.readAsArrayBuffer(file);
}
$('#btn-xlsx-mat').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = () => { if (inp.files[0]) uploadMaterialsXlsx(inp.files[0]); };
  inp.click();
});
/* 원부자재 화면에 엑셀 끌어다 놓기 */
(() => {
  const zone = $('#page-materials');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.xlsx?$/i.test(f.name)) uploadMaterialsXlsx(f);
    else if (f) toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();

/* ===================== 입고 조회 (구매입고 품목 조회) =====================
   발주내역 중 입고 기록(입고완료·부분입고)만 필터해 ERP 조회화면처럼 표시.
   입고금액 = 입고수량 × 단가 (단가 없으면 발주 금액). */
const IQ_LIMIT = 300;
const iqReceipts = () => ORDERS.filter((o) => {
  const st = o.status || '미입고';
  return st === '입고완료' || st === '부분입고' || o.inDate || num(o.inQty) > 0;
});
const iqQty = (o) => (o.inQty != null && o.inQty !== '') ? num(o.inQty) : num(o.qty);
const iqAmt = (o) => num(o.price) ? iqQty(o) * num(o.price) : orderAmount(o);
const iqDate = (o) => o.inDate || o.date || '';
function filteredInquiry() {
  let rows = iqReceipts();
  const from = $('#iq-from').value, to = $('#iq-to').value;
  const sup = $('#iq-sup').value, st = $('#iq-state').value;
  const q = $('#iq-search').value.trim().toLowerCase();
  if (from) rows = rows.filter((o) => iqDate(o) >= from);
  if (to) rows = rows.filter((o) => iqDate(o) <= to);
  if (sup) rows = rows.filter((o) => o.supplier === sup);
  if (st) rows = rows.filter((o) => (o.status || '') === st);
  if (q) rows = rows.filter((o) => [o.item, o.spec, o.note].some((v) => String(v || '').toLowerCase().includes(q)));
  rows.sort((a, b) => (iqDate(a) === iqDate(b) ? b.id - a.id : iqDate(a) < iqDate(b) ? 1 : -1));
  return rows;
}
function renderInquiry() {
  fillSelectOptions($('#iq-sup'), [...new Set(iqReceipts().map((o) => o.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), '전체');
  const rows = filteredInquiry();
  const totQty = rows.reduce((a, o) => a + iqQty(o), 0);
  const totAmt = rows.reduce((a, o) => a + iqAmt(o), 0);
  const ym = todayStr().slice(0, 7);
  const mon = iqReceipts().filter((o) => String(iqDate(o)).startsWith(ym));
  $('#iq-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">조회 결과</div><div class="k-value">${fmt(rows.length)}<small>건</small></div><div class="k-sub">전체 입고 기록 ${fmt(iqReceipts().length)}건</div></div>
    <div class="kpi"><div class="k-label">입고수량 합계</div><div class="k-value">${fmt(totQty)}</div><div class="k-sub">필터 적용 기준</div></div>
    <div class="kpi"><div class="k-label">입고금액 합계</div><div class="k-value">${fmt(Math.round(totAmt))}<small>원</small></div><div class="k-sub">필터 적용 기준</div></div>
    <div class="kpi"><div class="k-label">이번 달 입고</div><div class="k-value">${fmt(mon.length)}<small>건</small></div><div class="k-sub">${fmt(Math.round(mon.reduce((a, o) => a + iqAmt(o), 0)))}원</div></div>`;
  if (!rows.length) { $('#inquiry-table').innerHTML = '<div class="empty">조건에 맞는 입고 기록이 없습니다.</div>'; return; }
  const shown = rows.slice(0, IQ_LIMIT);
  const body = shown.map((o) => `<tr data-order-id="${o.id}">
    <td>${esc(iqDate(o))}</td><td>${esc(o.supplier ?? '')}</td><td><b>${esc(o.item)}</b></td>
    <td>${esc(o.spec ?? '')}</td><td>${esc(o.unit ?? '')}</td>
    <td class="num">${fmt(o.price)}</td><td class="num">${fmt(iqQty(o), 2)}</td><td class="num">${iqAmt(o) ? fmt(Math.round(iqAmt(o))) : '-'}</td>
    <td>${orderStatusBadge(o.status)}</td><td>${esc(o.note ?? '')}</td>
  </tr>`).join('');
  const totalRow = `<tr class="no-click iq-total"><td colspan="6"><b>TOTAL</b> — 조건일치 ${fmt(rows.length)}건</td>
    <td class="num"><b>${fmt(totQty, 2)}</b></td><td class="num"><b>${fmt(Math.round(totAmt))}</b></td><td colspan="2"></td></tr>`;
  const foot = `<p class="muted" style="margin-top:8px">표시 ${fmt(shown.length)}건 · 조건일치 ${fmt(rows.length)}건${rows.length > IQ_LIMIT ? ' — 더 보려면 기간/거래처/검색으로 좁혀주세요' : ''} · 행을 누르면 발주 기록을 수정할 수 있습니다</p>`;
  $('#inquiry-table').innerHTML = `<table><thead><tr>
    <th>입고일</th><th>거래처</th><th>품명</th><th>품번/규격</th><th>단위</th>
    <th class="num">단가</th><th class="num">입고수량</th><th class="num">입고금액</th><th>상태</th><th>비고</th>
  </tr></thead><tbody>${totalRow}${body}</tbody></table>` + foot;
}
['iq-from', 'iq-to', 'iq-sup', 'iq-state', 'iq-search'].forEach((id) => $('#' + id).addEventListener('input', renderInquiry));
$('#iq-reset').addEventListener('click', () => { ['iq-from', 'iq-to', 'iq-sup', 'iq-state', 'iq-search'].forEach((id) => ($('#' + id).value = '')); renderInquiry(); });
$('#btn-csv-inquiry').addEventListener('click', () => {
  const rows = filteredInquiry();
  if (!rows.length) { toast('내보낼 입고 기록이 없습니다'); return; }
  const data = rows.map((o) => [iqDate(o), o.supplier, o.item, o.spec, o.unit, o.price != null ? num(o.price) : '', iqQty(o), Math.round(iqAmt(o)) || '', o.status || '', o.note]);
  data.unshift(['TOTAL', '', '', '', '', '', rows.reduce((a, o) => a + iqQty(o), 0), Math.round(rows.reduce((a, o) => a + iqAmt(o), 0)), '', '']);
  downloadXlsx(`입고조회_${todayStr()}.xlsx`, '입고조회',
    ['입고일', '거래처', '품명', '품번/규격', '단위', '단가', '입고수량', '입고금액', '상태', '비고'], data);
});
/* 입고 엑셀 업로드: ERP 구매입고 조회 내보내기 양식(입고일/거래처/품명/품번/단위/단가/입고수량) → 입고완료 기록 추가.
   기록만 추가하며 원부자재 현재고는 바꾸지 않는다 (현재고는 월 재고 엑셀 기준). */
function parseInquiryWB(wb) {
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    for (let hi = 0; hi < Math.min(rows.length, 6); hi++) {
      const hdr = (rows[hi] || []).map((c) => c == null ? '' : String(c).trim());
      const H = {};
      hdr.forEach((c, i) => { if (c && H[c] == null) H[c] = i; });
      if (H['입고일'] == null || H['품명'] == null || H['입고수량'] == null) continue;
      const g = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
      const gn = (r, k) => { if (H[k] == null) return null; const n = Number(r[H[k]]); return isFinite(n) && r[H[k]] !== null && r[H[k]] !== '' ? n : null; };
      const out = [];
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const item = g(r, '품명');
        const first = r[0] == null ? '' : String(r[0]).trim();
        if (!item || /^TOTAL$/i.test(item) || /^TOTAL$/i.test(first)) continue;
        const inQty = gn(r, '입고수량');
        if (inQty == null || inQty <= 0) continue;
        const date = xlsDateStr(H['입고일'] == null ? null : r[H['입고일']]);
        out.push({
          date, supplier: g(r, '거래처'), item, spec: g(r, '품번') || g(r, '품번/규격') || g(r, '규격'),
          unit: g(r, '단위'), qty: inQty, price: gn(r, '단가'), amount: gn(r, '입고금액'),
          due: null, inDate: date, inQty, status: '입고완료',
          note: [g(r, '입고번호'), g(r, '입고담당자'), g(r, '비고')].filter(Boolean).join(' · '),
        });
      }
      if (out.length) return out;
    }
  }
  throw new Error("입고 헤더(입고일/품명/입고수량)를 찾을 수 없습니다");
}
async function importInquiryFile(f) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  let out;
  try { out = parseInquiryWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true })); }
  catch (e) { toast('엑셀 오류: ' + e.message); return; }
  // 대량 추가 (id 일괄 부여)
  const list = dbLoad('orders');
  let nextId = list.reduce((m, x) => Math.max(m, x.id || 0), 0);
  const now = new Date().toISOString();
  out.forEach((o) => list.push(Object.assign(o, { id: ++nextId, createdAt: now, updatedAt: now })));
  dbSave('orders', list);
  reloadAll();
  refreshCurrentPage();
  toast(`입고 기록 ${out.length.toLocaleString()}건 추가·자동저장 (재고는 변경하지 않음)`);
}
$('#iq-xlsx-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = () => { if (inp.files[0]) importInquiryFile(inp.files[0]); };
  inp.click();
});
/* 입고 조회 화면에 엑셀 끌어다 놓기 */
(() => {
  const zone = $('#page-inquiry');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /\.xlsx?$/i.test(f.name)) importInquiryFile(f);
    else if (f) toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();

/* ===================== BOM · 자재명세서 =====================
   구조: { entries: { 모품목번호: { n:품명, region:내수|해외|반제품, line:CAST|PRE-CUT|SPLINT|기타,
                                    c:[[하위품번, 하위품명, 소요량, 단위], ...] } }, updatedAt }
   하위품번이 다른 모품목이면 계층(트리)으로 이어진다. 엑셀: 'BOM일괄업로드' 시트(ItemNo/SubItemNo). */
const BOM_KEY = DB_PREFIX + 'bom';
function bomLoad() {
  try { const v = JSON.parse(localStorage.getItem(BOM_KEY)); if (v && v.entries) return v; } catch (e) { }
  return { entries: {}, updatedAt: null };
}
function bomSave(d) { localStorage.setItem(BOM_KEY, JSON.stringify(d)); }
let BOMD = (function () {
  // 시드 v2: 반제품 BOM(5개 파일) 추가분 반영 — 버전이 다르면 시드로 1회 교체
  const verKey = DB_PREFIX + 'bom-seed-ver';
  if (window.SEED_DATA && SEED_DATA.bom && (localStorage.getItem(BOM_KEY) === null || localStorage.getItem(verKey) !== '4')) {
    bomSave(SEED_DATA.bom); // v4: PXRT→배관보수테이프, HYBRID/하이브리드 재분류
    localStorage.setItem(verKey, '4');
  }
  return bomLoad();
})();

let BOM_REGION = '내수', BOM_LINE = '', BOM_TYPE = '', BOM_CUST = '';
const BOM_PREF = { RM: { l: '원자재', b: 'neal' }, SM: { l: '부자재', b: 'warn' }, SF: { l: '반제품', b: 'oem' }, FP: { l: '완제품', b: 'ok' } };
const BOM_SORT = { RM: 1, SF: 2, SM: 3, FP: 4 };
const bomPrefOf = (c) => (String(c).split('-')[0] || '').toUpperCase();
const bomBadge = (code) => {
  const m = BOM_PREF[bomPrefOf(code)];
  return `<span class="badge ${m ? m.b : 'plain'}">${m ? m.l : '기타'}</span>`;
};
const fmtQty = (q) => {
  q = +q || 0;
  if (!q) return '0';
  if (Math.abs(q) < 0.001) return q.toExponential(2);
  return (Math.round(q * 100000) / 100000).toLocaleString('ko-KR', { maximumFractionDigits: 5 });
};
const bomRegionKeys = () => Object.keys(BOMD.entries).filter((k) => (BOMD.entries[k].region || '내수') === BOM_REGION);

function renderBom() {
  const upd = $('#bom-updated');
  if (upd) upd.textContent = BOMD.updatedAt ? `· 등록 기준 ${BOMD.updatedAt}` : '';
  const regionKeys = bomRegionKeys();
  // 라인 칩 · 구분(접두어) 칩 — 데이터 기준 동적 생성
  const lines = [...new Set(regionKeys.map((k) => BOMD.entries[k].line || '기타'))].sort();
  if (BOM_LINE && !lines.includes(BOM_LINE)) BOM_LINE = '';
  $('#bom-lines').innerHTML = `<button class="chip${BOM_LINE === '' ? ' active' : ''}" data-line="">전체</button>`
    + lines.map((l) => `<button class="chip${BOM_LINE === l ? ' active' : ''}" data-line="${esc(l)}">${esc(l)}</button>`).join('');
  // 업체 필터 (해외처럼 customer가 있는 구분에서만 노출)
  const customers = [...new Set(regionKeys.map((k) => BOMD.entries[k].customer).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const custWrap = $('#bom-cust-wrap');
  if (custWrap) {
    custWrap.hidden = !customers.length;
    if (customers.length) {
      const cs = $('#bom-customer');
      if (BOM_CUST && !customers.includes(BOM_CUST)) BOM_CUST = '';
      cs.innerHTML = '<option value="">전체</option>' + customers.map((c) => `<option${c === BOM_CUST ? ' selected' : ''}>${esc(c)}</option>`).join('');
    } else BOM_CUST = '';
  }
  let keys = BOM_LINE ? regionKeys.filter((k) => (BOMD.entries[k].line || '기타') === BOM_LINE) : regionKeys;
  if (BOM_CUST) keys = keys.filter((k) => BOMD.entries[k].customer === BOM_CUST);
  const types = [...new Set(keys.map(bomPrefOf))].sort((a, b) => (BOM_SORT[a] || 9) - (BOM_SORT[b] || 9));
  if (BOM_TYPE && !types.includes(BOM_TYPE)) BOM_TYPE = '';
  $('#bom-types').innerHTML = `<button class="chip${BOM_TYPE === '' ? ' active' : ''}" data-type="">전체</button>`
    + types.map((t) => `<button class="chip${BOM_TYPE === t ? ' active' : ''}" data-type="${t}">${(BOM_PREF[t] || {}).l || t}</button>`).join('');
  if (BOM_TYPE) keys = keys.filter((k) => bomPrefOf(k) === BOM_TYPE);
  const q = $('#bom-search').value.trim().toUpperCase();
  if (q) keys = keys.filter((k) => (k + ' ' + (BOMD.entries[k].n || '')).toUpperCase().includes(q));
  keys.sort();
  // KPI
  const fp = regionKeys.filter((k) => bomPrefOf(k) === 'FP').length;
  const sf = regionKeys.filter((k) => bomPrefOf(k) === 'SF').length;
  const lineCnt = regionKeys.reduce((a, k) => a + BOMD.entries[k].c.length, 0);
  const lineSubs = lines.map((l) => `${l} ${regionKeys.filter((k) => (BOMD.entries[k].line || '기타') === l).length}`).join(' · ');
  $('#bom-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">${BOM_REGION} 모품목</div><div class="k-value">${fmt(regionKeys.length)}<small>종</small></div><div class="k-sub">${lineSubs || '등록 기준'}</div></div>
    <div class="kpi"><div class="k-label">완제품 / 반제품</div><div class="k-value">${fmt(fp)} / ${fmt(sf)}</div><div class="k-sub">FP · SF 모품목</div></div>
    <div class="kpi"><div class="k-label">BOM 라인</div><div class="k-value">${fmt(lineCnt)}<small>행</small></div><div class="k-sub">${BOM_REGION} 기준</div></div>
    ${customers.length ? `<div class="kpi"><div class="k-label">거래 업체</div><div class="k-value">${fmt(customers.length)}<small>곳</small></div><div class="k-sub">${BOM_REGION} · 업체별 BOM</div></div>` : ''}
    <div class="kpi"><div class="k-label">전체 등록</div><div class="k-value">${fmt(Object.keys(BOMD.entries).length)}<small>종</small></div><div class="k-sub">내수 · 해외 · 반제품 합계</div></div>`;
  // 제품 select (선택 유지)
  const sel = $('#bom-sku'), prev = sel.value;
  sel.innerHTML = keys.length ? keys.map((k) => `<option value="${esc(k)}">${esc(BOMD.entries[k].n || k)} — ${esc(k)}</option>`).join('') : '<option value="">(등록된 BOM 없음)</option>';
  if (keys.includes(prev)) sel.value = prev;
  renderBomDetail();
}
function bomTreeRow(level, code, name, qty, unit) {
  return `<tr>
    <td class="muted">${level}</td>
    <td style="padding-left:${10 + level * 16}px"><b>${esc(code)}</b></td>
    <td>${esc(name)}</td>
    <td class="num">${fmtQty(qty)}</td>
    <td>${esc(unit)}</td>
    <td>${bomBadge(code)}</td>
  </tr>`;
}
function bomTreeRows(code, level, out, seen) {
  const node = BOMD.entries[code];
  if (!node || seen.has(code)) return; // 순환 참조 방지
  seen.add(code);
  node.c.forEach(([sc, sn, q, u]) => {
    out.push(bomTreeRow(level, sc, sn, q, u));
    if (BOMD.entries[sc]) bomTreeRows(sc, level + 1, out, seen);
  });
  seen.delete(code);
}
function bomFlatten(code, mult, acc, seen) {
  const node = BOMD.entries[code];
  if (!node || seen.has(code)) return;
  seen.add(code);
  node.c.forEach(([sc, sn, q, u]) => {
    if (BOMD.entries[sc]) bomFlatten(sc, mult * q, acc, seen);
    else {
      const key = sc + '|' + u;
      if (!acc[key]) acc[key] = { code: sc, name: sn, unit: u, qty: 0 };
      acc[key].qty += q * mult;
    }
  });
  seen.delete(code);
}
function renderBomDetail() {
  const code = $('#bom-sku').value;
  const out = [];
  if (code && BOMD.entries[code]) {
    out.push(bomTreeRow(0, code, BOMD.entries[code].n, 1, 'EA'));
    bomTreeRows(code, 1, out, new Set());
  }
  $('#bom-tree').innerHTML = out.length ? out.join('') : '<tr class="no-click"><td colspan="6" class="empty">제품을 선택하세요</td></tr>';
  const acc = {};
  if (code && BOMD.entries[code]) bomFlatten(code, 1, acc, new Set());
  const rows = Object.values(acc).sort((a, b) => (BOM_SORT[bomPrefOf(a.code)] || 9) - (BOM_SORT[bomPrefOf(b.code)] || 9) || a.code.localeCompare(b.code));
  $('#bom-flat').innerHTML = rows.length
    ? rows.map((x) => `<tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td><td class="num">${fmtQty(x.qty)}</td><td>${esc(x.unit)}</td><td>${bomBadge(x.code)}</td></tr>`).join('')
    : '<tr class="no-click"><td colspan="5" class="empty">제품을 선택하세요</td></tr>';
}
/* --- BOM 엑셀 업로드 ('BOM일괄업로드' 시트, 여러 파일 가능, 같은 구분·라인 통째 교체) --- */
const bomLineFromName = (name) => {
  const n = String(name || '').toUpperCase();
  if (n.includes('RESIN') || n.includes('수지')) return 'RESIN';
  if (n.includes('HYBRID')) return 'HYBRID';
  if (n.includes('CAST')) return 'CAST';
  if (n.includes('SPLINT')) return 'SPLINT';
  if (n.replace(/[-_ ]/g, '').includes('PRECUT')) return 'PRE-CUT';
  return '기타';
};
/* 해외 BOM 파일명 BOM_{라인}_{업체}.xlsx → 업체명 */
const bomCustomerFromName = (name) => {
  const parts = String(name || '').replace(/\.xlsx?$/i, '').split('_');
  if ((parts[0] || '').toUpperCase() === 'BOM') parts.shift();
  parts.shift();
  return parts.join('_') || '';
};
const bomRegionFromName = (name) => {
  const n = String(name || '').toUpperCase().replace(/[-_ ]/g, '');
  if (n.includes('KOREA') || n.includes('내수')) return '내수';
  if (n.includes('EXPORT') || n.includes('OVERSEA') || n.includes('해외')) return '해외';
  if (n.includes('SEMI') || n.includes('반제품')) return '반제품';
  return null;
};
function parseBomFileWB(wb, region, line) {
  const sn = wb.SheetNames.find((s) => s.includes('BOM')) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
  const m = hdrMap(rows, ['ItemNo', 'SubItemNo']);
  if (!m) throw new Error("BOM 헤더(ItemNo/SubItemNo)를 찾을 수 없습니다");
  const H = m.H;
  const g = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
  const nm = (r, k) => { const v = H[k] == null ? null : r[H[k]]; const n = Number(v); return isFinite(n) ? n : null; };
  const d = {};
  for (let i = m.hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const itemno = g(r, 'ItemNo'), sub = g(r, 'SubItemNo');
    if (!itemno || !sub) continue;
    if (itemno === '모품목번호' || itemno === '제품품번호') continue;
    const n1 = nm(r, 'NeedQtyNumerator'), n2 = nm(r, 'NeedQtyDenominator');
    const qty = (n1 != null && n2) ? Math.round(n1 / n2 * 1e8) / 1e8 : (n1 != null ? n1 : 0);
    (d[itemno] = d[itemno] || { n: g(r, 'ItemName'), region, line, c: [] }).c.push([sub, g(r, 'SubItemName'), qty, g(r, 'SubUnitName')]);
  }
  if (!Object.keys(d).length) throw new Error('BOM 데이터가 없습니다');
  // 모품목 코드·이름 기준 재분류: PXRT → 배관보수테이프, HYBRID/하이브리드 → HYBRID (파일명 분류보다 우선)
  for (const k of Object.keys(d)) {
    const t = (k + ' ' + (d[k].n || '')).toUpperCase();
    if (t.includes('PXRT')) d[k].line = '배관보수테이프';
    else if (t.includes('HYBRID') || t.includes('하이브리드')) d[k].line = 'HYBRID';
  }
  return d;
}
async function uploadBomFiles(files) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const parts = [];
  const errs = [];
  for (const f of files) {
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
      const region = bomRegionFromName(f.name) || BOM_REGION;
      const line = bomLineFromName(f.name);
      const customer = region === '해외' ? bomCustomerFromName(f.name) : '';
      const d = parseBomFileWB(wb, region, line);
      Object.values(d).forEach((e) => (e.customer = customer));
      parts.push({ region, line, customer, d, name: f.name });
    } catch (e) { errs.push(f.name + ': ' + e.message); }
  }
  if (!parts.length) { toast('등록할 BOM이 없습니다' + (errs.length ? ' — ' + errs.join(' / ') : '')); return; }
  // 이번 업로드에 포함된 (구분·라인·업체)는 통째로 교체 (한 번만 삭제 후 전체 병합)
  const groups = new Set(parts.map((p) => p.region + '|' + p.line + '|' + p.customer));
  for (const k of Object.keys(BOMD.entries)) {
    const e = BOMD.entries[k];
    if (groups.has((e.region || '내수') + '|' + (e.line || '기타') + '|' + (e.customer || ''))) delete BOMD.entries[k];
  }
  parts.forEach((p) => Object.assign(BOMD.entries, p.d));
  BOMD.updatedAt = todayStr();
  bomSave(BOMD);
  const msgs = parts.map((p) => `${p.region} ${p.line}${p.customer ? ' ' + p.customer : ''} ${Object.keys(p.d).length}품목`);
  refreshCurrentPage();
  toast('BOM 등록·자동저장: ' + msgs.join(' / ') + (errs.length ? ' · 실패 ' + errs.length + '건' : ''));
  if (errs.length) console.warn('BOM 업로드 실패:', errs);
}
$('#btn-xlsx-bom').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) uploadBomFiles([...inp.files]); };
  inp.click();
});
(() => {
  const zone = $('#page-bom');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const fl = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => /\.xlsx?$/i.test(f.name));
    if (fl.length) uploadBomFiles(fl);
    else toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();
/* BOM 화면 이벤트 */
$$('#bom-region-toggle button').forEach((b) => b.addEventListener('click', () => {
  BOM_REGION = b.dataset.region;
  BOM_LINE = '';
  BOM_TYPE = '';
  BOM_CUST = '';
  $$('#bom-region-toggle button').forEach((c) => c.classList.toggle('active', c === b));
  renderBom();
}));
$('#bom-customer').addEventListener('input', () => { BOM_CUST = $('#bom-customer').value; renderBom(); });
$('#bom-lines').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { BOM_LINE = b.dataset.line; renderBom(); } });
$('#bom-types').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { BOM_TYPE = b.dataset.type; renderBom(); } });
$('#bom-sku').addEventListener('input', renderBomDetail);
$('#bom-search').addEventListener('input', renderBom);

/* ===================== 자재 발주·입고 (ERP 구매발주입력 방식) =====================
   품번(신규코드/품목명)으로 원부자재를 골라 여러 행 입력 → 금액·부가세(10%)·총계 자동 계산.
   [발주 등록] = 발주내역(orders)에 미입고 기록 / [발주 + 즉시 입고] = 입고완료 기록 + 원부자재 현재고 증가. */
const RECV_KEY = DB_PREFIX + 'recv-draft';
let RECV = (() => {
  try { const v = JSON.parse(localStorage.getItem(RECV_KEY)); if (v && v.lines) return v; } catch (e) { }
  return { date: '', supplier: '', manager: '차훈', note: '', lines: [{}, {}, {}] };
})();
const recvSave = () => localStorage.setItem(RECV_KEY, JSON.stringify(RECV));
/* 품번·품목명으로 원부자재 찾기 */
function rcFindMat(v) {
  const t = String(v || '').trim().toUpperCase();
  if (!t) return null;
  return MATERIALS.find((m) => String(m.newCode || '').toUpperCase() === t)
    || MATERIALS.find((m) => String(m.name || '').toUpperCase() === t)
    || null;
}
const rcAmt = (l) => num(l.qty) * num(l.price);
const rcVat = (l) => Math.round(rcAmt(l) * 0.1);
function renderReceive() {
  // 헤더
  $('#rc-date').value = RECV.date || todayStr();
  $('#rc-supplier').value = RECV.supplier || '';
  $('#rc-manager').value = RECV.manager || '차훈';
  $('#rc-note').value = RECV.note || '';
  $('#dl-rc-sup').innerHTML = [...new Set(ORDERS.map((o) => o.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')).map((s) => `<option value="${esc(s)}">`).join('');
  // 품번 자동완성 (신규코드 우선, 없으면 품목명)
  $('#dl-rc-mat').innerHTML = MATERIALS.map((m) => m.newCode
    ? `<option value="${esc(m.newCode)}">${esc(m.name)}</option>`
    : `<option value="${esc(m.name)}"></option>`).join('');
  // 라인 표
  const rows = RECV.lines.map((l, i) => {
    const m = rcFindMat(l.code);
    return `<tr class="no-click">
      <td><input class="cell-edit" style="width:180px;text-align:left" type="text" list="dl-rc-mat" value="${esc(l.code ?? '')}" data-rc="${i}" data-f="code" placeholder="신규코드/품목명"></td>
      <td>${m ? esc(m.name) : '<span class="muted">—</span>'}</td>
      <td>${m ? esc(m.unit || '') : ''}</td>
      <td class="num">${m ? fmt(m.stock, 2) : '-'}</td>
      <td class="num"><input class="cell-edit" type="text" inputmode="decimal" value="${l.qty != null ? Number(l.qty).toLocaleString('ko-KR') : ''}" data-rc="${i}" data-f="qty" placeholder="수량"></td>
      <td class="num"><input class="cell-edit" type="text" inputmode="decimal" value="${l.price != null ? Number(l.price).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : ''}" data-rc="${i}" data-f="price" placeholder="단가"></td>
      <td class="num">${rcAmt(l) ? fmt(rcAmt(l)) : '-'}</td>
      <td class="num">${rcAmt(l) ? fmt(rcVat(l)) : '-'}</td>
      <td class="num">${rcAmt(l) ? fmt(rcAmt(l) + rcVat(l)) : '-'}</td>
      <td><button class="btn small danger" data-rc-del="${i}">✕</button></td>
    </tr>`;
  }).join('');
  $('#recv-table').innerHTML = `<table><thead><tr>
    <th>품번 (신규코드)</th><th>품명</th><th>단위</th><th class="num">현재고</th>
    <th class="num">발주수량</th><th class="num">단가</th><th class="num">금액</th><th class="num">부가세(10%)</th><th class="num">금액계</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  // 합계
  const valid = RECV.lines.filter((l) => rcAmt(l) > 0);
  const amt = valid.reduce((a, l) => a + rcAmt(l), 0);
  const vat = valid.reduce((a, l) => a + rcVat(l), 0);
  $('#rc-totals').innerHTML = `
    <div class="kpi"><div class="k-label">금액계</div><div class="k-value">${fmt(amt)}<small>원</small></div><div class="k-sub">${valid.length}개 품목</div></div>
    <div class="kpi"><div class="k-label">부가세계</div><div class="k-value">${fmt(vat)}<small>원</small></div><div class="k-sub">부가세율 10%</div></div>
    <div class="kpi accent"><div class="k-label">금액총계</div><div class="k-value">${fmt(amt + vat)}<small>원</small></div><div class="k-sub">금액 + 부가세</div></div>`;
}
/* 헤더 입력 저장 */
['rc-date', 'rc-supplier', 'rc-manager', 'rc-note'].forEach((id) => $('#' + id).addEventListener('change', () => {
  RECV.date = $('#rc-date').value;
  RECV.supplier = $('#rc-supplier').value.trim();
  RECV.manager = $('#rc-manager').value.trim();
  RECV.note = $('#rc-note').value.trim();
  recvSave();
}));
/* 라인 입력 저장 (품번/수량/단가) */
document.addEventListener('change', (e) => {
  const inp = e.target.closest('input[data-rc]');
  if (!inp) return;
  const i = Number(inp.dataset.rc), f = inp.dataset.f;
  const l = RECV.lines[i];
  if (!l) return;
  if (f === 'code') {
    l.code = inp.value.trim();
    const m = rcFindMat(l.code);
    if (m && (l.price == null || l.price === '')) l.price = m.price; // 당월 단가 자동
  } else {
    const raw = inp.value.replace(/,/g, '').trim();
    if (raw !== '' && isNaN(Number(raw))) { toast('숫자만 입력할 수 있습니다'); renderReceive(); return; }
    l[f] = raw === '' ? null : Number(raw);
  }
  recvSave();
  renderReceive();
});
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-rc-del]');
  if (!del) return;
  RECV.lines.splice(Number(del.dataset.rcDel), 1);
  if (!RECV.lines.length) RECV.lines.push({});
  recvSave();
  renderReceive();
});
$('#rc-addrow').addEventListener('click', () => { RECV.lines.push({}); recvSave(); renderReceive(); });
/* 발주 등록 / 발주+입고 공통 */
function rcSubmit(receiveNow) {
  const valid = RECV.lines.map((l) => ({ l, m: rcFindMat(l.code) })).filter((x) => x.l.code && num(x.l.qty) > 0);
  if (!valid.length) { toast('품번과 발주수량을 입력하세요'); return; }
  if (!RECV.supplier) { toast('구매거래처를 입력하세요'); return; }
  const date = RECV.date || todayStr();
  const noteBase = [RECV.note, '담당 ' + (RECV.manager || '차훈')].filter(Boolean).join(' · ');
  const unmatched = [];
  valid.forEach(({ l, m }) => {
    dbCreate('orders', {
      date, supplier: RECV.supplier, item: m ? m.name : l.code, spec: m ? (m.newCode || '') : '',
      unit: m ? (m.unit || '') : '', qty: num(l.qty), price: l.price != null ? num(l.price) : null,
      amount: rcAmt(l) || null,
      due: null, inDate: receiveNow ? date : null, inQty: receiveNow ? num(l.qty) : null,
      status: receiveNow ? '입고완료' : '미입고', note: noteBase,
    });
    if (receiveNow) {
      if (m) {
        const stock = num(m.stock) + num(l.qty);
        const patch = { stock };
        if (m.price != null) patch.amount = Math.round(stock * num(m.price) * 100) / 100;
        dbUpdate('materials', m.id, patch);
      } else unmatched.push(l.code);
    }
  });
  reloadAll();
  RECV = { date: '', supplier: '', manager: RECV.manager || '차훈', note: '', lines: [{}, {}, {}] };
  recvSave();
  renderReceive();
  toast((receiveNow ? '입고 완료 — 발주내역 기록 + 재고 반영: ' : '발주 등록 완료 (미입고): ') + valid.length + '개 품목'
    + (unmatched.length ? ' · 재고 미반영(품번 미매칭) ' + unmatched.length + '건' : ''));
  if (unmatched.length) console.warn('재고 미반영:', unmatched);
}
$('#rc-order').addEventListener('click', () => rcSubmit(false));
$('#rc-receive').addEventListener('click', () => { if (confirm('발주 등록과 동시에 입고 처리하여 원부자재 현재고에 반영합니다. 진행할까요?')) rcSubmit(true); });
/* 발주·입고 시트 엑셀 불러오기: 헤더에 품번(또는 품명)·수량이 있는 시트를 읽어 라인 자동 작성 */
function parseRecvWB(wb) {
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    for (let hi = 0; hi < Math.min(rows.length, 6); hi++) {
      const hdr = (rows[hi] || []).map((c) => c == null ? '' : String(c).trim());
      const H = {};
      hdr.forEach((c, i) => { if (c && H[c] == null) H[c] = i; });
      const codeCol = H['품번'] != null ? H['품번'] : H['신규코드'];
      const nameCol = H['품명'] != null ? H['품명'] : H['품목명'];
      const qtyCol = H['수량'] != null ? H['수량'] : H['발주수량'];
      if ((codeCol == null && nameCol == null) || qtyCol == null) continue;
      const priceCol = H['단가'], supCol = H['거래처'];
      const lines = [];
      let supplier = '';
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const code = String((codeCol != null && r[codeCol] != null ? r[codeCol] : (nameCol != null ? r[nameCol] : '')) ?? '').trim();
        if (!code || /^TOTAL$/i.test(code)) continue;
        const qty = Number(r[qtyCol]);
        if (!isFinite(qty) || qty <= 0) continue;
        const price = priceCol != null && r[priceCol] != null && isFinite(Number(r[priceCol])) ? Number(r[priceCol]) : null;
        if (!supplier && supCol != null && r[supCol] != null) supplier = String(r[supCol]).trim();
        lines.push({ code, qty, price });
      }
      if (lines.length) return { lines, supplier };
    }
  }
  throw new Error("헤더(품번/품명 + 수량)를 찾을 수 없습니다");
}
$('#rc-xlsx-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
    try {
      const res = parseRecvWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' }));
      // 단가 비어 있으면 당월 단가 자동
      res.lines.forEach((l) => { if (l.price == null) { const m = rcFindMat(l.code); if (m) l.price = m.price; } });
      RECV.lines = res.lines;
      if (res.supplier && !RECV.supplier) RECV.supplier = res.supplier;
      recvSave();
      renderReceive();
      const matched = res.lines.filter((l) => rcFindMat(l.code)).length;
      toast(`엑셀 ${res.lines.length}행 불러옴 · 품번 매칭 ${matched}건${matched < res.lines.length ? ' (미매칭 ' + (res.lines.length - matched) + '건 확인 필요)' : ''}`);
    } catch (e) { toast('엑셀 오류: ' + e.message); }
  };
  inp.click();
});
$('#rc-xlsx-out').addEventListener('click', () => {
  const valid = RECV.lines.filter((l) => l.code);
  if (!valid.length) { toast('내보낼 품목이 없습니다'); return; }
  const rows = valid.map((l) => {
    const m = rcFindMat(l.code);
    return [l.code, m ? m.name : '', m ? (m.unit || '') : '', num(l.qty) || '', l.price != null ? num(l.price) : '', rcAmt(l) || '', rcVat(l) || '', rcAmt(l) ? rcAmt(l) + rcVat(l) : ''];
  });
  const amt = valid.reduce((a, l) => a + rcAmt(l), 0), vat = valid.reduce((a, l) => a + rcVat(l), 0);
  rows.push(['TOTAL', '', '', '', '', amt, vat, amt + vat]);
  downloadXlsx(`발주서_${RECV.supplier || '거래처미정'}_${RECV.date || todayStr()}.xlsx`, '발주서',
    ['품번', '품명', '단위', '발주수량', '단가', '금액', '부가세(10%)', '금액계'], rows);
});
/* 발주·입고 시트에 엑셀 끌어다 놓기 */
(() => {
  const zone = $('#page-receive');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', async (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.xlsx?$/i.test(f.name)) { if (f) toast('엑셀 파일(.xlsx)만 지원합니다'); return; }
    try {
      const res = parseRecvWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' }));
      res.lines.forEach((l) => { if (l.price == null) { const m = rcFindMat(l.code); if (m) l.price = m.price; } });
      RECV.lines = res.lines;
      if (res.supplier && !RECV.supplier) RECV.supplier = res.supplier;
      recvSave();
      renderReceive();
      toast(`엑셀 ${res.lines.length}행 불러옴`);
    } catch (err) { toast('엑셀 오류: ' + err.message); }
  });
})();

/* ===================== 자재 일일출고 (ERP 자재기타출고입력·조회 방식) =====================
   출고 전표(issues): {id, no(출고번호 YYYYMMDD-NNNN), date, wh(출고창고), dept, manager, note, deducted,
                       lines:[{code, name, unit, qty, gubun, note}]}
   [출고 등록] = 기록만 / [출고 + 재고 차감] = 원부자재 현재고에서 수량 차감. */
const ISSUE_KEY = DB_PREFIX + 'issue-draft';
let ISD = (() => {
  try { const v = JSON.parse(localStorage.getItem(ISSUE_KEY)); if (v && v.lines) return v; } catch (e) { }
  return { date: '', wh: '춘천-원부자재창고', dept: '구매출고파트', manager: '차훈', note: '', lines: [{}, {}, {}] };
})();
const isdSave = () => localStorage.setItem(ISSUE_KEY, JSON.stringify(ISD));
/* 출고구분: 품번 앞머리로 자동 판정 */
const issueGubun = (code) => ({ RM: '생산투입원재료', SM: '생산투입부재료', SF: '생산투입반제품' }[bomPrefOf(code)] || '생산투입자재');
function renderIssue() {
  $('#is-date').value = ISD.date || todayStr();
  $('#is-wh').value = ISD.wh || '춘천-원부자재창고';
  $('#is-dept').value = ISD.dept || '구매출고파트';
  $('#is-manager').value = ISD.manager || '차훈';
  $('#is-note').value = ISD.note || '';
  $('#dl-rc-mat').innerHTML = MATERIALS.map((m) => m.newCode
    ? `<option value="${esc(m.newCode)}">${esc(m.name)}</option>`
    : `<option value="${esc(m.name)}"></option>`).join('');
  const rows = ISD.lines.map((l, i) => {
    const m = rcFindMat(l.code);
    const over = m && num(l.qty) > num(m.stock);
    return `<tr class="no-click${over ? ' ck-short' : ''}">
      <td><input class="cell-edit" style="width:180px;text-align:left" type="text" list="dl-rc-mat" value="${esc(l.code ?? '')}" data-is="${i}" data-f="code" placeholder="신규코드/품목명"></td>
      <td>${m ? esc(m.name) : '<span class="muted">—</span>'}</td>
      <td>${m ? esc(m.unit || '') : ''}</td>
      <td class="num">${m ? fmt(m.stock, 2) : '-'}</td>
      <td class="num"><input class="cell-edit" type="text" inputmode="decimal" value="${l.qty != null ? Number(l.qty).toLocaleString('ko-KR') : ''}" data-is="${i}" data-f="qty" placeholder="수량"></td>
      <td>${l.code ? issueGubun(l.code) : ''}</td>
      <td><input class="cell-edit" style="width:110px;text-align:left" type="text" value="${esc(l.note ?? '')}" data-is="${i}" data-f="note" placeholder="CAST/SPLINT..."></td>
      <td><button class="btn small danger" data-is-del="${i}">✕</button></td>
    </tr>`;
  }).join('');
  $('#issue-table').innerHTML = `<table><thead><tr>
    <th>품번 (신규코드)</th><th>품명</th><th>단위</th><th class="num">현재고</th>
    <th class="num">출고수량</th><th>출고구분</th><th>특이사항</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;
  const valid = ISD.lines.filter((l) => l.code && num(l.qty) > 0);
  const overCnt = valid.filter((l) => { const m = rcFindMat(l.code); return m && num(l.qty) > num(m.stock); }).length;
  $('#is-totals').innerHTML = `
    <div class="kpi accent"><div class="k-label">출고 품목</div><div class="k-value">${fmt(valid.length)}<small>종</small></div><div class="k-sub">총 수량 ${fmt(valid.reduce((a, l) => a + num(l.qty), 0), 2)}</div></div>
    <div class="kpi ${overCnt ? 'red' : 'green'}"><div class="k-label">재고 초과 출고</div><div class="k-value">${fmt(overCnt)}<small>건</small></div><div class="k-sub">출고수량 &gt; 현재고 (빨간 행)</div></div>`;
}
['is-date', 'is-wh', 'is-dept', 'is-manager', 'is-note'].forEach((id) => $('#' + id).addEventListener('change', () => {
  ISD.date = $('#is-date').value;
  ISD.wh = $('#is-wh').value.trim();
  ISD.dept = $('#is-dept').value.trim();
  ISD.manager = $('#is-manager').value.trim();
  ISD.note = $('#is-note').value.trim();
  isdSave();
}));
document.addEventListener('change', (e) => {
  const inp = e.target.closest('input[data-is]');
  if (!inp) return;
  const i = Number(inp.dataset.is), f = inp.dataset.f;
  const l = ISD.lines[i];
  if (!l) return;
  if (f === 'code' || f === 'note') l[f] = inp.value.trim();
  else {
    const raw = inp.value.replace(/,/g, '').trim();
    if (raw !== '' && isNaN(Number(raw))) { toast('숫자만 입력할 수 있습니다'); renderIssue(); return; }
    l[f] = raw === '' ? null : Number(raw);
  }
  isdSave();
  renderIssue();
});
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-is-del]');
  if (!del) return;
  ISD.lines.splice(Number(del.dataset.isDel), 1);
  if (!ISD.lines.length) ISD.lines.push({});
  isdSave();
  renderIssue();
});
$('#is-addrow').addEventListener('click', () => { ISD.lines.push({}); isdSave(); renderIssue(); });
/* 출고번호: YYYYMMDD-NNNN (같은 날짜 전표 수 + 1) */
const issueNo = (date) => date.replace(/-/g, '') + '-' + String(ISSUES.filter((s) => s.date === date).length + 1).padStart(4, '0');
function issueSubmit(deduct) {
  const valid = ISD.lines.map((l) => ({ l, m: rcFindMat(l.code) })).filter((x) => x.l.code && num(x.l.qty) > 0);
  if (!valid.length) { toast('품번과 출고수량을 입력하세요'); return; }
  const date = ISD.date || todayStr();
  const rec = dbCreate('issues', {
    no: issueNo(date), date, wh: ISD.wh || '춘천-원부자재창고', dept: ISD.dept || '구매출고파트',
    manager: ISD.manager || '차훈', note: ISD.note || '', deducted: !!deduct,
    lines: valid.map(({ l, m }) => ({
      code: m ? (m.newCode || m.name) : l.code, name: m ? m.name : l.code,
      unit: m ? (m.unit || '') : '', qty: num(l.qty), gubun: issueGubun(l.code), note: l.note || '',
    })),
  });
  const unmatched = [];
  if (deduct) {
    valid.forEach(({ l, m }) => {
      if (!m) { unmatched.push(l.code); return; }
      const stock = num(m.stock) - num(l.qty);
      const patch = { stock };
      if (m.price != null) patch.amount = Math.round(stock * num(m.price) * 100) / 100;
      dbUpdate('materials', m.id, patch);
    });
  }
  reloadAll();
  ISD = { date: '', wh: ISD.wh, dept: ISD.dept, manager: ISD.manager, note: '', lines: [{}, {}, {}] };
  isdSave();
  renderIssue();
  toast(`출고 전표 ${rec.no} 등록${deduct ? ' + 재고 차감' : ''}: ${valid.length}개 품목`
    + (unmatched.length ? ' · 재고 미반영(품번 미매칭) ' + unmatched.length + '건' : ''));
}
$('#is-save').addEventListener('click', () => issueSubmit(false));
$('#is-deduct').addEventListener('click', () => { if (confirm('출고 등록과 동시에 원부자재 현재고에서 수량을 차감합니다. 진행할까요?')) issueSubmit(true); });
/* 출고 시트 엑셀 불러오기/다운로드 (품번+수량 양식 공용) */
$('#is-xlsx-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 잠시 후 다시 시도하세요'); return; }
    try {
      const res = parseRecvWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' }));
      ISD.lines = res.lines.map((l) => ({ code: l.code, qty: l.qty, note: '' }));
      isdSave();
      renderIssue();
      toast(`엑셀 ${res.lines.length}행 불러옴`);
    } catch (e) { toast('엑셀 오류: ' + e.message); }
  };
  inp.click();
});
$('#is-xlsx-out').addEventListener('click', () => {
  const valid = ISD.lines.filter((l) => l.code);
  if (!valid.length) { toast('내보낼 품목이 없습니다'); return; }
  const rows = valid.map((l) => {
    const m = rcFindMat(l.code);
    return [l.code, m ? m.name : '', m ? (m.unit || '') : '', num(l.qty) || '', issueGubun(l.code), l.note || ''];
  });
  rows.push(['TOTAL', '', '', valid.reduce((a, l) => a + num(l.qty), 0), '', '']);
  downloadXlsx(`출고내역서_${ISD.date || todayStr()}.xlsx`, '출고내역',
    ['품번', '품명', '단위', '출고수량', '출고구분', '특이사항'], rows);
});
(() => {
  const zone = $('#page-issue');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', async (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !/\.xlsx?$/i.test(f.name)) { if (f) toast('엑셀 파일(.xlsx)만 지원합니다'); return; }
    try {
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
      // 일별재고 현황 파일이면 자동으로 일별 반영, 아니면 품번+수량 양식으로 불러오기
      if (wb.SheetNames.some((sn) => /\(\d{2}년\s*\d{1,2}월\)?/.test(sn))) { await importDailyXlsx(f); return; }
      const res = parseRecvWB(wb);
      ISD.lines = res.lines.map((l) => ({ code: l.code, qty: l.qty, note: '' }));
      isdSave();
      renderIssue();
      toast(`엑셀 ${res.lines.length}행 불러옴`);
    } catch (err) { toast('엑셀 오류: ' + err.message); }
  });
})();

/* --- 일별재고 엑셀 반영 ('2026년일별주요자재현황' 양식) ---
   월별 POUCH/원단·원재료/BOX 시트에서 최신 월을 골라, 일자별 '출고' 열의 수량을 읽어
   날짜당 전표 1건으로 생성한다. 품목은 브랜드·모델·인치로 원부자재 품명과 자동 매칭(유일할 때만).
   기록만 남기며 재고는 차감하지 않는다(현재고는 이 파일·월 재고 기준이므로 이중 차감 방지).
   같은 월을 다시 올리면 이전 반영분(src=daily)은 교체된다. */
function parseDailyIssuesWB(wb) {
  const normT = (s) => String(s || '').toUpperCase().replace(/[\s\r\n"']/g, '');
  let best = null;
  for (const sn of wb.SheetNames) {
    const m = sn.match(/\((\d{2})년\s*(\d{1,2})월\)?/);
    if (!m) continue;
    const key = +m[1] * 100 + +m[2];
    if (!best || key > best.key) best = { key, y: +m[1], mo: +m[2] };
  }
  if (!best) throw new Error('"(NN년 NN월)" 형식의 시트를 찾을 수 없습니다');
  const month = `20${best.y}-${String(best.mo).padStart(2, '0')}`;
  const sheets = wb.SheetNames.filter((sn) => {
    const m = sn.match(/\((\d{2})년\s*(\d{1,2})월\)?/);
    return m && +m[1] === best.y && +m[2] === best.mo;
  });
  const matIdx = MATERIALS.map((m) => ({ m, n: normT(m.name) }));
  // 토큰이 숫자로 시작하면(인치 등) 바로 앞이 숫자가 아닌 위치에서만 인정 (1INCH가 11INCH에 걸리지 않게)
  const tokenHit = (n, tk) => {
    if (!/^\d/.test(tk)) return n.includes(tk);
    const re = new RegExp('(^|[^0-9.])' + tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return re.test(n);
  };
  const candidatesOf = (tokens) => {
    const t = tokens.filter(Boolean);
    if (!t.length) return [];
    const c = matIdx.filter((x) => t.every((tk) => tokenHit(x.n, tk)));
    // 같은 품목이 조사자별로 중복 등록된 경우: 신규코드 있는 후보 우선
    const withCode = c.filter((x) => x.m.newCode);
    return withCode.length ? withCode : c;
  };
  const findMat = (tokens) => {
    const pool = candidatesOf(tokens);
    const uniq = [...new Set(pool.map((x) => x.m.newCode || normT(x.m.name)))];
    return uniq.length === 1 ? pool[0].m : null;
  };
  // 최후순위: 후보가 여럿이면 이름이 가장 단순한(짧은) 것 선택 — 일반형 vs (엠텍스) 같은 변형 구분용
  const findMatLoose = (tokens) => {
    let pool = candidatesOf(tokens);
    if (!pool.length) return null;
    // 코드 기준 중복 제거 후 이름 길이 비교
    const seen = new Set();
    pool = pool.filter((x) => { const k = x.m.newCode || x.n; if (seen.has(k)) return false; seen.add(k); return true; });
    pool.sort((a, b) => a.n.length - b.n.length);
    return (pool.length === 1 || pool[0].n.length < pool[1].n.length) ? pool[0].m : null;
  };
  const wordsOf = (s) => String(s || '').split(/[^A-Za-z0-9가-힣.]+/).filter(Boolean).map(normT);
  const daysMap = {};
  const seenItems = { matched: new Set(), unmatched: new Set() };
  for (const sn of sheets) {
    const kind = /POUCH/i.test(sn) ? 'POUCH' : /BOX/i.test(sn) ? 'BOX' : 'FAB';
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    let hi = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      if ((rows[i] || []).some((c) => String(c || '').trim() === '인치')) { hi = i; break; }
    }
    if (hi < 1) continue;
    const dayRow = rows[hi - 1] || [], labRow = rows[hi] || [];
    const H = {};
    labRow.forEach((c, idx) => { const t = String(c || '').replace(/[\s\r\n]/g, ''); if (t && H[t] == null) H[t] = idx; });
    // 일자별 '출고' 열 매핑 (일 숫자 → 바로 뒤 출고 열)
    const outCols = [];
    let cur = null;
    const width = Math.max(dayRow.length, labRow.length);
    for (let j = 0; j < width; j++) {
      const dv = dayRow[j];
      if (typeof dv === 'number' && Number.isInteger(dv) && dv >= 1 && dv <= 31) cur = dv;
      if (String(labRow[j] || '').replace(/\s/g, '') === '출고' && cur != null) outCols.push({ day: cur, col: j });
    }
    if (!outCols.length) continue;
    const colBrand = H['브랜드'], colModel = H['모델'], colForm = H['박스형태'], colInch = H['인치'], colUnit = H['단위'];
    const colMat = kind === 'FAB' && colInch != null ? colInch - 1 : null; // 원단: 인치 왼쪽 열 = 소재명
    const ff = {};
    let emptyStreak = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const set = (col, key) => { if (col != null && r[col] != null && String(r[col]).trim()) ff[key] = String(r[col]).trim(); };
      set(colBrand, 'brand'); set(colModel, 'model'); set(colForm, 'form'); set(colMat, 'mat');
      const inch = colInch != null ? r[colInch] : null;
      if (inch == null || inch === '') { if (++emptyStreak > 10) break; continue; }
      emptyStreak = 0;
      const inchS = String(inch).trim();
      const inchN = inchS.replace(/["']/g, '');
      // 인치 토큰 후보: 숫자면 'NINCH'와 'N' 둘 다, 아니면 문자열 그대로 (L/S, 2/3, 2012 등)
      const inchToks = /^\d+(\.\d+)?$/.test(inchN) ? [normT(inchN) + 'INCH', normT(inchN)] : [normT(inchN)];
      const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();
      let sets = [], disp = '';
      if (kind === 'POUCH') {
        for (const it of inchToks) {
          sets.push([normT(ff.model), 'POUCH', normT(ff.brand), it]); // 표준 구역 (브랜드=NEAL 등)
          sets.push([normT(ff.brand), it]);                            // 하단 구역 (브랜드 칸에 품명 전체)
          sets.push([...wordsOf(ff.brand), it]);                       // 단어 분해 (줄바꿈·괄호 변형 대응)
        }
        disp = /POUCH/i.test(ff.brand || '') ? `${clean(ff.brand)} ${inchN}` : `${ff.model || ''} POUCH(${ff.brand || ''}) ${inchN}INCH`;
      } else if (kind === 'BOX') {
        const io = /아웃/.test(ff.form || '') ? 'OUTBOX' : 'INBOX';
        const fb = (ff.form || '').match(/\(([^)]+)\)/);
        for (const it of [inchS.includes('/') ? normT(inchS) : null, ...inchToks].filter(Boolean)) {
          sets.push([normT(ff.model), io, fb ? normT(fb[1]) : null, it]);
          sets.push([normT(ff.form), normT(ff.model), it]); // 박스형태 칸에 품명이 들어있는 구역
          sets.push([normT(ff.form), it]);
          sets.push([...wordsOf(ff.form), ...wordsOf(ff.model), it]);
        }
        disp = `${ff.model || ''} ${io === 'INBOX' ? 'IN BOX' : 'OUT BOX'}${fb ? '(' + fb[1] + ')' : ''} ${inchS}`;
      } else {
        for (const it of inchToks) {
          sets.push([normT(ff.mat), it]);
          sets.push([...wordsOf(ff.mat), it]);
        }
        sets.push([normT(ff.mat), normT(inchS)]);
        disp = `${clean(ff.mat)} ${inchS}`;
      }
      let mat = null;
      for (const s of sets) { mat = findMat(s); if (mat) break; }
      if (!mat) for (const s of sets) { mat = findMatLoose(s); if (mat) break; }
      (mat ? seenItems.matched : seenItems.unmatched).add(disp);
      const unit = colUnit != null && r[colUnit] ? String(r[colUnit]).trim() : (mat ? mat.unit || '' : '');
      outCols.forEach(({ day, col }) => {
        const q = Number(r[col]);
        if (!isFinite(q) || q <= 0) return;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        (daysMap[date] = daysMap[date] || []).push({
          code: mat ? (mat.newCode || '') : '', name: mat ? mat.name : disp, unit,
          qty: q, gubun: mat && mat.newCode ? issueGubun(mat.newCode) : '생산투입자재',
          note: kind === 'FAB' ? '원단·원재료' : kind,
        });
      });
    }
  }
  return { month, daysMap, matchedCnt: seenItems.matched.size, unmatchedList: [...seenItems.unmatched] };
}
async function importDailyXlsx(file) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  let res;
  try { res = parseDailyIssuesWB(XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })); }
  catch (e) { toast('엑셀 오류: ' + e.message); return; }
  const dates = Object.keys(res.daysMap).sort();
  if (!dates.length) { toast(`${res.month}에 출고 수량이 있는 날짜가 없습니다`); return; }
  // 같은 월의 이전 반영분 교체
  let list = dbLoad('issues').filter((s) => !(s.src === 'daily' && String(s.date || '').startsWith(res.month)));
  let nid = list.reduce((m, x) => Math.max(m, x.id || 0), 0);
  const now = new Date().toISOString();
  dates.forEach((date) => {
    const no = date.replace(/-/g, '') + '-' + String(list.filter((s) => s.date === date).length + 1).padStart(4, '0');
    list.push({
      id: ++nid, no, date, wh: '춘천-원부자재창고', dept: '구매출고파트', manager: '차훈',
      note: '일별재고 엑셀 반영', deducted: false, src: 'daily',
      lines: res.daysMap[date], createdAt: now, updatedAt: now,
    });
  });
  dbSave('issues', list);
  reloadAll();
  refreshCurrentPage();
  toast(`일별재고 반영 (${res.month}): 전표 ${dates.length}건 · 품목 매칭 ${res.matchedCnt}종`
    + (res.unmatchedList.length ? ` · 미매칭 ${res.unmatchedList.length}종(품명 그대로 기록)` : '') + ' · 재고는 차감하지 않음');
  if (res.unmatchedList.length) console.warn('일별재고 미매칭 품목:', res.unmatchedList);
}
$('#is-daily-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = () => { if (inp.files[0]) importDailyXlsx(inp.files[0]); };
  inp.click();
});

/* --- 출고 조회 (전표 목록 → 클릭 시 일일출고 현황) --- */
let IV_ID = null; // 열려 있는 전표 id
function filteredIssues() {
  let rows = ISSUES.slice();
  const from = $('#il-from').value, to = $('#il-to').value;
  const mgr = $('#il-manager').value;
  const q = $('#il-search').value.trim().toLowerCase();
  if (from) rows = rows.filter((s) => (s.date || '') >= from);
  if (to) rows = rows.filter((s) => (s.date || '') <= to);
  if (mgr) rows = rows.filter((s) => s.manager === mgr);
  if (q) rows = rows.filter((s) => [s.no, s.note, ...(s.lines || []).flatMap((l) => [l.name, l.code, l.note])].some((v) => String(v || '').toLowerCase().includes(q)));
  rows.sort((a, b) => (a.date === b.date ? b.id - a.id : (a.date || '') < (b.date || '') ? 1 : -1));
  return rows;
}
const issueQty = (s) => (s.lines || []).reduce((a, l) => a + num(l.qty), 0);
function renderIssueList() {
  fillSelectOptions($('#il-manager'), [...new Set(ISSUES.map((s) => s.manager).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), '전체');
  const rows = filteredIssues();
  const ym = todayStr().slice(0, 7);
  $('#il-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">조회 결과</div><div class="k-value">${fmt(rows.length)}<small>건</small></div><div class="k-sub">전체 전표 ${fmt(ISSUES.length)}건</div></div>
    <div class="kpi"><div class="k-label">출고수량 합계</div><div class="k-value">${fmt(rows.reduce((a, s) => a + issueQty(s), 0), 2)}</div><div class="k-sub">필터 적용 기준</div></div>
    <div class="kpi"><div class="k-label">이번 달 전표</div><div class="k-value">${fmt(ISSUES.filter((s) => String(s.date || '').startsWith(ym)).length)}<small>건</small></div><div class="k-sub">${ym}</div></div>
    <div class="kpi"><div class="k-label">재고 차감 전표</div><div class="k-value">${fmt(ISSUES.filter((s) => s.deducted).length)}<small>건</small></div><div class="k-sub">기록만 ${fmt(ISSUES.filter((s) => !s.deducted).length)}건</div></div>`;
  if (!rows.length) { $('#issuelist-table').innerHTML = '<div class="empty">출고 전표가 없습니다. [자재 일일출고] 화면에서 등록하세요.</div>'; return; }
  const body = rows.map((s) => `<tr data-issue-id="${s.id}">
    <td><b>${esc(s.no)}</b></td><td>${esc(s.date)}</td><td>${esc(s.dept ?? '')}</td><td>${esc(s.manager ?? '')}</td>
    <td>${esc(s.wh ?? '')}</td><td class="num">${fmt((s.lines || []).length)}</td><td class="num">${fmt(issueQty(s), 2)}</td>
    <td>${s.deducted ? '<span class="badge ok">차감 반영</span>' : '<span class="badge plain">기록만</span>'}</td>
    <td>${esc(s.note ?? '')}</td>
  </tr>`).join('');
  $('#issuelist-table').innerHTML = `<table><thead><tr>
    <th>출고번호</th><th>출고일</th><th>처리부서</th><th>담당자</th><th>출고창고</th>
    <th class="num">품목 수</th><th class="num">총 수량</th><th>재고 반영</th><th>특이사항</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}
function openIssueView(id) {
  const s = ISSUES.find((x) => x.id === id);
  if (!s) return;
  IV_ID = id;
  $('#iv-title').textContent = `일일출고 현황 — ${s.no}`;
  $('#iv-head').innerHTML = `출고일 <b>${esc(s.date)}</b> · 출고창고 <b>${esc(s.wh || '')}</b> · 처리부서 <b>${esc(s.dept || '')}</b> · 담당자 <b>${esc(s.manager || '')}</b>`
    + ` · ${s.deducted ? '<span class="badge ok">재고 차감 반영</span>' : '<span class="badge plain">기록만 (재고 미반영)</span>'}`
    + (s.note ? `<br>특이사항: ${esc(s.note)}` : '');
  $('#iv-lines').innerHTML = `<table><thead><tr>
    <th>품명</th><th>품번</th><th>단위</th><th class="num">수량</th><th>출고구분</th><th>특이사항</th>
  </tr></thead><tbody>${(s.lines || []).map((l) => `<tr class="no-click">
    <td><b>${esc(l.name)}</b></td><td>${esc(l.code)}</td><td>${esc(l.unit)}</td>
    <td class="num">${fmt(l.qty, 2)}</td><td>${esc(l.gubun)}</td><td>${esc(l.note ?? '')}</td>
  </tr>`).join('')}<tr class="no-click iq-total"><td colspan="3"><b>TOTAL</b> — ${(s.lines || []).length}개 품목</td><td class="num"><b>${fmt(issueQty(s), 2)}</b></td><td colspan="2"></td></tr></tbody></table>`;
  $('#issue-view-modal').hidden = false;
}
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-issue-id]');
  if (tr) openIssueView(Number(tr.dataset.issueId));
});
$('#iv-close').addEventListener('click', () => ($('#issue-view-modal').hidden = true));
$('#iv-close2').addEventListener('click', () => ($('#issue-view-modal').hidden = true));
$('#issue-view-modal').addEventListener('click', (e) => { if (e.target === $('#issue-view-modal')) $('#issue-view-modal').hidden = true; });
$('#iv-delete').addEventListener('click', () => {
  const s = ISSUES.find((x) => x.id === IV_ID);
  if (!s) return;
  if (!confirm(`전표 ${s.no}를 삭제하시겠습니까?${s.deducted ? '\n(재고 차감분은 현재고에 다시 더해집니다)' : ''}`)) return;
  if (s.deducted) {
    (s.lines || []).forEach((l) => {
      const m = rcFindMat(l.code);
      if (!m) return;
      const stock = num(m.stock) + num(l.qty);
      const patch = { stock };
      if (m.price != null) patch.amount = Math.round(stock * num(m.price) * 100) / 100;
      dbUpdate('materials', m.id, patch);
    });
  }
  dbRemove('issues', IV_ID);
  reloadAll();
  $('#issue-view-modal').hidden = true;
  refreshCurrentPage();
  toast('전표를 삭제했습니다' + (s.deducted ? ' (재고 복구됨)' : ''));
});
['il-from', 'il-to', 'il-manager', 'il-search'].forEach((id) => $('#' + id).addEventListener('input', renderIssueList));
$('#il-reset').addEventListener('click', () => { ['il-from', 'il-to', 'il-manager', 'il-search'].forEach((id) => ($('#' + id).value = '')); renderIssueList(); });
$('#il-xlsx-out').addEventListener('click', () => {
  const rows = filteredIssues();
  if (!rows.length) { toast('내보낼 전표가 없습니다'); return; }
  const data = rows.flatMap((s) => (s.lines || []).map((l) => [s.no, s.date, s.dept, s.manager, s.wh, l.code, l.name, l.unit, num(l.qty), l.gubun, l.note || '', s.deducted ? '차감 반영' : '기록만', s.note || '']));
  downloadXlsx(`출고조회_${todayStr()}.xlsx`, '출고조회',
    ['출고번호', '출고일', '처리부서', '담당자', '출고창고', '품번', '품명', '단위', '수량', '출고구분', '품목 특이사항', '재고 반영', '전표 특이사항'], data);
});

/* ===================== 품목 코드 =====================
   ERP 품번 목록 엑셀(품명/품번/규격/영문명/품목자산분류/기준단위/품목소분류/품목상태)을 업로드해
   원자재·부자재·반제품·완제품으로 나눠 조회. 신규 코드가 계속 추가되는 마스터. */
let CD_CAT = '';
const CD_LIMIT = 300;
const CD_CATS = ['원자재', '부자재', '반제품', '완제품', '기타'];
/* 품목자산분류 정규화: 제품→완제품, 원재료→원자재 등 */
function cdNormCat(v) {
  const t = String(v || '').trim();
  if (/원자재|원재료/.test(t)) return '원자재';
  if (/부자재|부재료/.test(t)) return '부자재';
  if (/반제품/.test(t)) return '반제품';
  if (/제품|완제품|상품/.test(t)) return '완제품';
  return '기타';
}
const cdCatBadge = (c) => {
  const cls = { '원자재': 'neal', '부자재': 'ok', '반제품': 'warn', '완제품': 'oem' }[c] || 'plain';
  return `<span class="badge ${cls}">${esc(c || '기타')}</span>`;
};
function filteredCodes() {
  let rows = CODES.slice();
  if (CD_CAT) rows = rows.filter((c) => (c.category || '기타') === CD_CAT);
  const sub = $('#cd-sub').value;
  if (sub) rows = rows.filter((c) => (c.subclass || '') === sub);
  if ($('#cd-active').checked) rows = rows.filter((c) => (c.status || '사용') === '사용');
  const q = $('#cd-search').value.trim().toLowerCase();
  if (q) rows = rows.filter((c) => [c.name, c.code, c.spec, c.engName, c.subclass].some((v) => String(v || '').toLowerCase().includes(q)));
  return rows;
}
function renderCodes() {
  const upd = $('#cd-updated');
  if (upd) {
    const ts = localStorage.getItem(DB_PREFIX + 'codes-xlsx-at');
    upd.textContent = ts ? `· 엑셀 등록 기준 ${ts.slice(0, 10)}` : '';
  }
  const cnt = (c) => CODES.filter((x) => (x.category || '기타') === c).length;
  $('#cd-cats').innerHTML = `<button class="chip${CD_CAT === '' ? ' active' : ''}" data-cat="">전체</button>`
    + CD_CATS.filter((c) => c !== '기타' || cnt('기타')).map((c) => `<button class="chip${CD_CAT === c ? ' active' : ''}" data-cat="${c}">${c}${cnt(c) ? ' ' + fmt(cnt(c)) : ''}</button>`).join('');
  // 소분류 (선택된 분류 내 동적, 선택 유지)
  const base = CD_CAT ? CODES.filter((c) => (c.category || '기타') === CD_CAT) : CODES;
  fillSelectOptions($('#cd-sub'), [...new Set(base.map((c) => c.subclass).filter(Boolean))].sort(), '전체');
  const rows = filteredCodes();
  $('#cd-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">전체 코드</div><div class="k-value">${fmt(CODES.length)}<small>건</small></div><div class="k-sub">${CD_CATS.filter((c) => cnt(c)).map((c) => `${c} ${fmt(cnt(c))}`).join(' · ') || '엑셀로 등록하세요'}</div></div>
    <div class="kpi"><div class="k-label">사용 코드</div><div class="k-value">${fmt(CODES.filter((c) => (c.status || '사용') === '사용').length)}<small>건</small></div><div class="k-sub">미사용 ${fmt(CODES.filter((c) => (c.status || '사용') !== '사용').length)}건</div></div>
    <div class="kpi"><div class="k-label">조회 결과</div><div class="k-value">${fmt(rows.length)}<small>건</small></div><div class="k-sub">필터 적용 기준</div></div>`;
  if (!rows.length) { $('#codes-table').innerHTML = '<div class="empty">등록된 코드가 없습니다. [📄 엑셀로 코드 등록] 또는 [＋ 코드 등록]으로 추가하세요.</div>'; return; }
  const shown = rows.slice(0, CD_LIMIT);
  const body = shown.map((c) => `<tr data-code-id="${c.id}">
    <td>${cdCatBadge(c.category)}</td>
    <td><b>${esc(c.name)}</b></td>
    <td>${esc(c.code)}</td>
    <td>${esc(c.spec ?? '')}</td>
    <td>${esc(c.engName ?? '')}</td>
    <td>${esc(c.unit ?? '')}</td>
    <td>${esc(c.subclass ?? '')}</td>
    <td>${(c.status || '사용') === '사용' ? '<span class="badge ok">사용</span>' : '<span class="badge plain">미사용</span>'}</td>
  </tr>`).join('');
  const foot = `<p class="muted" style="margin-top:8px">표시 ${fmt(shown.length)}건 · 조건일치 ${fmt(rows.length)}건 · 전체 ${fmt(CODES.length)}건${rows.length > CD_LIMIT ? ' — 더 보려면 분류/소분류/검색으로 좁혀주세요' : ''}</p>`;
  $('#codes-table').innerHTML = `<table><thead><tr>
    <th>분류</th><th>품명</th><th>품번</th><th>규격</th><th>영문명</th><th>단위</th><th>품목소분류</th><th>상태</th>
  </tr></thead><tbody>${body}</tbody></table>` + foot;
}
/* 엑셀 등록 (품명/품번/품목자산분류 헤더 자동 탐색, 전체 교체) */
function parseCodesWB(wb) {
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    for (let hi = 0; hi < Math.min(rows.length, 6); hi++) {
      const hdr = (rows[hi] || []).map((c) => c == null ? '' : String(c).trim());
      const H = {};
      hdr.forEach((c, i) => { if (c && H[c] == null) H[c] = i; });
      if (H['품명'] == null || H['품번'] == null) continue;
      const g = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
      const out = [];
      for (let i = hi + 1; i < rows.length; i++) {
        const r = rows[i] || [];
        const name = g(r, '품명'), code = g(r, '품번');
        if (!name && !code) continue;
        out.push({
          name, code: code || name, spec: g(r, '규격'), engName: g(r, '영문명'),
          category: cdNormCat(g(r, '품목자산분류') || g(r, '품목자산분') || g(r, '분류')),
          unit: g(r, '기준단위') || g(r, '단위'), subclass: g(r, '품목소분류'),
          status: g(r, '품목상태') || '사용',
        });
      }
      if (out.length) return out;
    }
  }
  throw new Error("코드 헤더(품명/품번)를 찾을 수 없습니다");
}
async function uploadCodesXlsx(files) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  // 여러 파일 병합 파싱 (원부자재 파일 + 완제품·반제품 파일 등)
  let combined = [];
  const errs = [];
  for (const f of files) {
    try { combined = combined.concat(parseCodesWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' }))); }
    catch (e) { errs.push(f.name + ': ' + e.message); }
  }
  if (!combined.length) { toast('읽을 코드가 없습니다' + (errs.length ? ' — ' + errs.join(' / ') : '')); return; }
  // 같은 품번이 겹치면 뒤 파일 우선
  const byCode = {};
  combined.forEach((c) => (byCode[c.code.toUpperCase()] = c));
  combined = Object.values(byCode);
  // 업로드된 파일에 들어있는 분류만 교체 — 다른 분류의 기존 코드는 유지
  const cats = new Set(combined.map((c) => c.category));
  const kept = CODES.filter((c) => !cats.has(c.category || '기타'));
  const now = new Date().toISOString();
  let nid = 0;
  dbSave('codes', kept.concat(combined).map((c) => Object.assign({}, c, { id: ++nid, updatedAt: now, createdAt: c.createdAt || now })));
  localStorage.setItem(DB_PREFIX + 'codes-xlsx-at', now);
  reloadAll();
  refreshCurrentPage();
  const byCat = {};
  combined.forEach((c) => (byCat[c.category] = (byCat[c.category] || 0) + 1));
  toast(`품목 코드 ${combined.length.toLocaleString()}건 반영 (${Object.keys(byCat).map((k) => k + ' ' + byCat[k]).join(' · ')})`
    + (kept.length ? ` · 다른 분류 ${fmt(kept.length)}건 유지` : '') + (errs.length ? ' · 실패 ' + errs.length + '건' : ''));
}
$('#cd-xlsx-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) uploadCodesXlsx([...inp.files]); };
  inp.click();
});
(() => {
  const zone = $('#page-codes');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', (e) => {
    const fl = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => /\.xlsx?$/i.test(f.name));
    if (fl.length) uploadCodesXlsx(fl);
    else toast('엑셀 파일(.xlsx)만 지원합니다');
  });
})();
$('#cd-xlsx-out').addEventListener('click', () => {
  const rows = filteredCodes();
  if (!rows.length) { toast('내보낼 코드가 없습니다'); return; }
  downloadXlsx(`품목코드_${CD_CAT || '전체'}_${todayStr()}.xlsx`, '품목코드',
    ['품명', '품번', '규격', '영문명', '품목자산분류', '기준단위', '품목소분류', '품목상태'],
    rows.map((c) => [c.name, c.code, c.spec, c.engName, c.category, c.unit, c.subclass, c.status || '사용']));
});
$('#cd-cats').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  CD_CAT = b.dataset.cat;
  $('#cd-sub').value = '';
  renderCodes();
});
['cd-sub', 'cd-search', 'cd-active'].forEach((id) => $('#' + id).addEventListener('input', renderCodes));
$('#cd-reset').addEventListener('click', () => { CD_CAT = ''; $('#cd-sub').value = ''; $('#cd-search').value = ''; $('#cd-active').checked = true; renderCodes(); });
const openCodeModal = wireModal({
  col: 'codes', form: '#code-form', modal: '#code-modal', title: '#code-modal-title',
  newBtn: '#btn-new-code', close: '#code-modal-close', cancel: '#code-cancel', del: '#code-delete',
  labels: ['코드 등록', '코드 수정'], confirmDel: '이 코드를 삭제하시겠습니까?',
  list: () => CODES,
  init: (form) => { if (CD_CAT && CD_CAT !== '기타') form.elements.category.value = CD_CAT; },
});
document.addEventListener('click', (e) => {
  if (e.target.closest('.cell-edit')) return;
  const tr = e.target.closest('tr[data-code-id]');
  if (tr) openCodeModal(Number(tr.dataset.codeId));
});

/* 구매 분석 이벤트 */
$$('#an-basis button').forEach((b) => b.addEventListener('click', () => { ANF.basis = b.dataset.b; renderAnalytics(); }));
$('#an-ranges').addEventListener('click', (e) => { const c = e.target.closest('[data-an-range]'); if (c) { ANF.range = c.dataset.anRange; renderAnalytics(); } });
$('#an-subs').addEventListener('click', (e) => { const c = e.target.closest('[data-an-sub]'); if (c) { ANF.sub = c.dataset.anSub; renderAnalytics(); } });
$('#an-sup').addEventListener('input', () => { ANF.sup = $('#an-sup').value; renderAnalytics(); });
$$('#an-tabs button').forEach((b) => b.addEventListener('click', () => { ANF.tab = b.dataset.t; renderAnalytics(); }));
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'an-item') { ANF.item = e.target.value; renderAnalytics(); } });
$('#an-xlsx-out').addEventListener('click', () => {
  let recs = anRangeFilter(anAllRecords());
  if (ANF.sup) recs = recs.filter((r) => r.sup === ANF.sup);
  if (ANF.sub) recs = recs.filter((r) => alSubOf(r.code) === ANF.sub);
  if (!recs.length) { toast('내보낼 구매 내역이 없습니다'); return; }
  recs.sort((a, b) => (a.date < b.date ? 1 : -1));
  downloadXlsx(`구매내역_${ANF.basis === 'in' ? '입고일' : '발주일'}기준_${todayStr()}.xlsx`, '구매내역',
    [ANF.basis === 'in' ? '입고일' : '발주일', '거래처', '품명', '품번', '분류', '수량', '금액'],
    recs.map((r) => [r.date, r.sup, r.item, r.code, alSubOf(r.code), r.qty, Math.round(r.amt)]));
});

/* ===================== 발주 알림 (재주문 실시간 현황) =====================
   최근 6개월 입고(발주내역의 입고 기록)와 일일출고를 품목별로 집계해 월평균 입고량·사용량을 산정하고,
   원부자재 현재고와 비교해 긴급 발주 / 준비 필요 / 여유를 판정한다.
   분류: 품번 앞머리(RM 원자재 / SM 부자재 / SF 반제품), 소분류: 품번 중간 토큰(FAB 원단, COR 코어, POU 파우치...). */
let AL_CAT = '';
const AL_MONTHS = 6;
const AL_SUBMAP = { FAB: '원단', COR: '코어', REG: '수지·약품', TON: '토너', POU: '파우치', BOX: '박스', CLI: '클립', HYD: '하이드로겔', LAB: '라벨', SPL: '원단', ECT: '기타' };
const alCatOf = (code) => ({ RM: '원자재', SM: '부자재', SF: '반제품' }[bomPrefOf(code)] || '기타');
const alSubOf = (code) => {
  const t = (String(code || '').split('-')[1] || '').toUpperCase();
  return AL_SUBMAP[t] || (t ? t : '기타');
};
function alertRows() {
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s\r\n"']/g, ''); // 공백·따옴표 무시 (품명 표기 차이 대응)
  const cutoff = (() => { const d = new Date(); d.setMonth(d.getMonth() - AL_MONTHS); return d.toISOString().slice(0, 10); })();
  // 원부자재 인덱스: 신규코드 → 재고합, 품명 → 재고합 (중복 등록 대응, 자재 대분류 보존)
  const byCode = {}, byName = {};
  MATERIALS.forEach((m) => {
    if (m.newCode) {
      const k = norm(m.newCode);
      if (!byCode[k]) byCode[k] = { stock: 0, name: m.name, code: m.newCode, unit: m.unit || '', matCat: m.category || '', price: null };
      byCode[k].stock += num(m.stock);
      if (byCode[k].price == null && m.price != null) byCode[k].price = num(m.price);
    }
    const nk = norm(m.name);
    if (!byName[nk]) byName[nk] = { stock: 0, name: m.name, code: m.newCode || '', unit: m.unit || '', matCat: m.category || '', price: null };
    else {
      if (!byName[nk].code && m.newCode) byName[nk].code = m.newCode;
      if (!byName[nk].matCat && m.category) byName[nk].matCat = m.category;
    }
    byName[nk].stock += num(m.stock);
    if (byName[nk].price == null && m.price != null) byName[nk].price = num(m.price);
  });
  const agg = {}; // key → {name, code, unit, stock, matCat, inQty, useQty, lastIn}
  const entryFor = (mat, fallbackName, fallbackCode, fallbackUnit) => {
    const key = mat ? 'M|' + norm(mat.code || mat.name) : 'N|' + norm(fallbackName);
    if (!agg[key]) {
      agg[key] = mat
        ? { name: mat.name, code: mat.code, unit: mat.unit, stock: mat.stock, matCat: mat.matCat || '', price: mat.price ?? null, inQty: 0, useQty: 0, lastIn: '' }
        : { name: fallbackName, code: fallbackCode || '', unit: fallbackUnit || '', stock: null, matCat: '', price: null, inQty: 0, useQty: 0, lastIn: '' };
    }
    return agg[key];
  };
  // 입고 집계
  iqReceipts().forEach((o) => {
    const d = iqDate(o);
    if (!d || d < cutoff) return;
    const mat = (o.spec && byCode[norm(o.spec)]) || byName[norm(o.item)] || null;
    const e = entryFor(mat, o.item, o.spec, o.unit);
    e.inQty += iqQty(o);
    if (d > e.lastIn) e.lastIn = d;
  });
  // 사용량(출고) 집계
  ISSUES.forEach((s) => {
    if (!s.date || s.date < cutoff) return;
    (s.lines || []).forEach((l) => {
      const mat = (l.code && byCode[norm(l.code)]) || byName[norm(l.name)] || null;
      const e = entryFor(mat, l.name || l.code, l.code, l.unit);
      e.useQty += num(l.qty);
    });
  });
  return Object.values(agg).map((e) => {
    const avgIn = e.inQty / AL_MONTHS;
    const useEst = e.useQty <= 0; // 출고 기록 없으면 입고량으로 사용량 추정
    const avgUse = useEst ? avgIn : e.useQty / AL_MONTHS;
    const cover = (e.stock != null && avgUse > 0) ? e.stock / avgUse : null;
    const state = e.stock == null ? '재고 미확인' : cover == null ? '여유' : cover < 1 ? '긴급 발주' : cover < 2 ? '준비 필요' : '여유';
    // 분류: 품번 앞머리 우선, 없으면 자재의 대분류(원재료→원자재 등)로 판정
    let cat = alCatOf(e.code);
    if (cat === '기타' && e.matCat) cat = { '원재료': '원자재', '부재료': '부자재', '반제품': '반제품', '완제품': '완제품' }[e.matCat] || '기타';
    return Object.assign(e, {
      avgIn, avgUse, useEst, cover, state,
      cat, sub: alSubOf(e.code),
    });
  });
}
function filteredAlert(rows) {
  const sub = $('#al-sub').value, st = $('#al-state').value;
  const q = $('#al-search').value.trim().toLowerCase();
  let out = rows;
  if (AL_CAT) out = out.filter((r) => r.cat === AL_CAT);
  if (sub) out = out.filter((r) => r.sub === sub);
  if (st) out = out.filter((r) => r.state === st);
  if (q) out = out.filter((r) => [r.name, r.code].some((v) => String(v || '').toLowerCase().includes(q)));
  const order = { '긴급 발주': 0, '준비 필요': 1, '재고 미확인': 2, '여유': 3 };
  out.sort((a, b) => order[a.state] - order[b.state] || (a.cover ?? 99) - (b.cover ?? 99) || b.avgUse - a.avgUse);
  return out;
}
function renderAlert() {
  const all = alertRows();
  // 분류 칩 · 소분류 (전체 데이터 기준 동적)
  const cats = ['원자재', '부자재', '반제품', '기타'].filter((c) => all.some((r) => r.cat === c));
  if (AL_CAT && !cats.includes(AL_CAT)) AL_CAT = '';
  const cnt = (c) => all.filter((r) => r.cat === c).length;
  $('#al-cats').innerHTML = `<button class="chip${AL_CAT === '' ? ' active' : ''}" data-cat="">전체</button>`
    + cats.map((c) => `<button class="chip${AL_CAT === c ? ' active' : ''}" data-cat="${c}">${c} ${cnt(c)}</button>`).join('');
  const base = AL_CAT ? all.filter((r) => r.cat === AL_CAT) : all;
  fillSelectOptions($('#al-sub'), [...new Set(base.map((r) => r.sub))].sort(), '전체');
  const urgent = all.filter((r) => r.state === '긴급 발주');
  const prep = all.filter((r) => r.state === '준비 필요');
  $('#al-kpi').innerHTML = `
    <div class="kpi ${urgent.length ? 'red' : 'green'}"><div class="k-label">🔴 긴급 발주</div><div class="k-value">${fmt(urgent.length)}<small>품목</small></div><div class="k-sub">재고 여유 1개월 미만</div></div>
    <div class="kpi ${prep.length ? '' : 'green'}"><div class="k-label">🟡 준비 필요</div><div class="k-value">${fmt(prep.length)}<small>품목</small></div><div class="k-sub">재고 여유 2개월 미만</div></div>
    <div class="kpi green"><div class="k-label">🟢 여유</div><div class="k-value">${fmt(all.filter((r) => r.state === '여유').length)}<small>품목</small></div><div class="k-sub">2개월 이상</div></div>
    <div class="kpi"><div class="k-label">분석 대상</div><div class="k-value">${fmt(all.length)}<small>품목</small></div><div class="k-sub">최근 ${AL_MONTHS}개월 입고·출고 발생 기준${all.filter((r) => r.state === '재고 미확인').length ? ' · 재고 미확인 ' + all.filter((r) => r.state === '재고 미확인').length : ''}</div></div>`;
  const rows = filteredAlert(all);
  if (!rows.length) { $('#alert-table').innerHTML = '<div class="empty">조건에 맞는 품목이 없습니다. 최근 6개월 내 입고·출고 기록이 있는 품목만 분석 대상입니다.</div>'; return; }
  const stBadge = { '긴급 발주': '<span class="badge bad">🔴 긴급 발주</span>', '준비 필요': '<span class="badge warn">🟡 준비 필요</span>', '여유': '<span class="badge ok">🟢 여유</span>', '재고 미확인': '<span class="badge plain">재고 미확인</span>' };
  const catBadge = (c) => `<span class="badge ${{ '원자재': 'neal', '부자재': 'ok', '반제품': 'warn' }[c] || 'plain'}">${c}</span>`;
  $('#alert-table').innerHTML = `<table><thead><tr>
    <th>상태</th><th>분류</th><th>소분류</th><th>품명</th><th>품번</th><th>단위</th>
    <th class="num">현재고</th><th class="num">월평균 입고량</th><th class="num">월평균 사용량</th><th class="num">재고 여유</th><th>마지막 입고</th>
  </tr></thead><tbody>${rows.map((r) => `<tr class="no-click${r.state === '긴급 발주' ? ' ck-short' : ''}">
    <td>${stBadge[r.state]}</td><td>${catBadge(r.cat)}</td><td>${esc(r.sub)}</td>
    <td><b>${esc(r.name)}</b></td><td>${esc(r.code || '')}</td><td>${esc(r.unit || '')}</td>
    <td class="num">${r.stock != null ? fmt(r.stock, 2) : '-'}</td>
    <td class="num">${fmt(Math.round(r.avgIn * 10) / 10, 1)}</td>
    <td class="num">${fmt(Math.round(r.avgUse * 10) / 10, 1)}${r.useEst ? ' <span class="muted" title="출고 기록이 없어 입고량으로 추정">*</span>' : ''}</td>
    <td class="num">${r.cover != null ? (r.cover >= 12 ? '12개월+' : r.cover.toFixed(1) + '개월') : '-'}</td>
    <td>${esc(r.lastIn || '-')}</td>
  </tr>`).join('')}</tbody></table>
  <p class="muted" style="margin-top:8px">* 표시는 출고 기록이 없어 입고량으로 사용량을 추정한 품목입니다. 일일출고를 쓰기 시작하면 실제 사용량 기준으로 바뀝니다.</p>`;
}
$('#al-cats').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { AL_CAT = b.dataset.cat; $('#al-sub').value = ''; renderAlert(); } });
['al-sub', 'al-state', 'al-search'].forEach((id) => $('#' + id).addEventListener('input', renderAlert));
$('#al-reset').addEventListener('click', () => { AL_CAT = ''; ['al-sub', 'al-state', 'al-search'].forEach((id) => ($('#' + id).value = '')); renderAlert(); });
$('#al-xlsx-out').addEventListener('click', () => {
  const rows = filteredAlert(alertRows());
  if (!rows.length) { toast('내보낼 품목이 없습니다'); return; }
  downloadXlsx(`발주알림_${todayStr()}.xlsx`, '발주알림',
    ['상태', '분류', '소분류', '품명', '품번', '단위', '현재고', '월평균 입고량', '월평균 사용량', '사용량 추정', '재고 여유(개월)', '마지막 입고'],
    rows.map((r) => [r.state, r.cat, r.sub, r.name, r.code, r.unit, r.stock ?? '', Math.round(r.avgIn * 10) / 10, Math.round(r.avgUse * 10) / 10, r.useEst ? '입고 기준 추정' : '출고 기록', r.cover != null ? Math.round(r.cover * 10) / 10 : '', r.lastIn]));
});

/* ===================== 분석 대시보드 =====================
   발주(orders)·자재(materials)·완제품(finished)·출고(issues)를 집계해 차트로 표시. */
/* 세로 막대 차트 (SVG, jds 스타일) */
function vbarSVG(items, valueFmt) {
  if (!items.length || !items.some((x) => x.value > 0)) return '<div class="empty">데이터가 없습니다</div>';
  const W = 660, H = 210, top = 22, bottom = 30;
  const max = Math.max(...items.map((x) => x.value), 1);
  const bw = Math.min(46, (W - 20) / items.length - 8);
  const step = (W - 20) / items.length;
  const bars = items.map((x, i) => {
    const h = Math.round((H - top - bottom) * x.value / max);
    const cx = 10 + step * i + step / 2;
    return `<rect class="bar" x="${(cx - bw / 2).toFixed(1)}" y="${H - bottom - h}" width="${bw.toFixed(1)}" height="${h}" rx="3"></rect>
      <text class="bar-value" x="${cx.toFixed(1)}" y="${H - bottom - h - 5}" text-anchor="middle">${x.value ? (valueFmt ? valueFmt(x.value) : fmt(x.value)) : ''}</text>
      <text class="axis-label" x="${cx.toFixed(1)}" y="${H - bottom + 14}" text-anchor="middle">${esc(x.label)}</text>`;
  }).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}
/* 가로 막대 목록 */
function hbarHTML(items, valueFmt) {
  if (!items.length || !items.some((x) => x.value > 0)) return '<div class="empty">데이터가 없습니다</div>';
  const max = Math.max(...items.map((x) => x.value), 1);
  return '<div class="hbar-list">' + items.map((x) => `<div class="hbar-row">
    <span class="hbar-label" title="${esc(x.label)}">${esc(x.label)}</span>
    <span class="hbar-track"><span class="hbar-fill${x.cls ? ' ' + x.cls : ''}" style="width:${Math.max(2, Math.round(x.value / max * 100))}%"></span></span>
    <span class="hbar-val">${valueFmt ? valueFmt(x.value) : fmt(x.value)}</span>
  </div>`).join('') + '</div>';
}
const last12Months = () => {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};
const manwon = (v) => fmt(Math.round(v)) + '원'; // 금액은 항상 원 단위 전체 표기

/* --- 구매 분석 상태 --- */
let ANF = { basis: 'in', range: '12m', sub: '', sup: '', tab: 'trend', item: '' };
/* 기준(입고일/발주일)에 따른 매입 레코드 (품번 없으면 재고 품명으로 신규코드 보완) */
function anAllRecords() {
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s\r\n"']/g, '');
  const nameToCode = {};
  MATERIALS.forEach((m) => { if (m.newCode) { const k = norm(m.name); if (!nameToCode[k]) nameToCode[k] = m.newCode; } });
  const src = ANF.basis === 'in' ? iqReceipts() : ORDERS;
  return src.map((o) => {
    const date = ANF.basis === 'in' ? iqDate(o) : (o.date || '');
    return {
      date, sup: o.supplier || '', item: o.item || '',
      code: o.spec || nameToCode[norm(o.item)] || '',
      qty: ANF.basis === 'in' ? iqQty(o) : num(o.qty),
      amt: ANF.basis === 'in' ? iqAmt(o) : orderAmount(o),
    };
  }).filter((r) => r.date && r.date >= '2015-01-01' && r.date <= (new Date().getFullYear() + 1) + '-12-31'); // 날짜 오타(3204년 등) 제외
}
function anRangeFilter(recs) {
  if (ANF.range === 'all') return recs;
  if (/^\d{4}$/.test(ANF.range)) return recs.filter((r) => r.date.startsWith(ANF.range));
  const m = ANF.range === '6m' ? 6 : 12;
  const d = new Date(); d.setMonth(d.getMonth() - m);
  const cutoff = d.toISOString().slice(0, 10);
  return recs.filter((r) => r.date >= cutoff);
}
function renderAnalytics() {
  const all = anAllRecords();
  // 기간 칩 (6/12개월·전체·데이터에 있는 연도)
  const years = [...new Set(all.map((r) => r.date.slice(0, 4)))].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
  $('#an-ranges').innerHTML = [['6m', '6개월'], ['12m', '12개월'], ['all', '전체'], ...years.map((y) => [y, y + '년'])]
    .map(([v, l]) => `<button class="chip${ANF.range === v ? ' active' : ''}" data-an-range="${v}">${l}</button>`).join('');
  $$('#an-basis button').forEach((b) => b.classList.toggle('active', b.dataset.b === ANF.basis));
  // 기간·거래처 필터 적용 (분류 칩 카운트용)
  let base = anRangeFilter(all);
  if (ANF.sup) base = base.filter((r) => r.sup === ANF.sup);
  fillSelectOptions($('#an-sup'), [...new Set(anRangeFilter(all).map((r) => r.sup).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), '전체 거래처');
  if (ANF.sup) $('#an-sup').value = ANF.sup;
  // 분류 칩 (품번 중간 토큰 소분류)
  const subCnt = {};
  base.forEach((r) => { const s = alSubOf(r.code); subCnt[s] = (subCnt[s] || 0) + 1; });
  const subs = Object.entries(subCnt).sort((a, b) => b[1] - a[1]);
  if (ANF.sub && !subCnt[ANF.sub]) ANF.sub = '';
  $('#an-subs').innerHTML = `<button class="chip${ANF.sub === '' ? ' active' : ''}" data-an-sub="">전체 ${fmt(base.length)}</button>`
    + subs.map(([s, c]) => `<button class="chip${ANF.sub === s ? ' active' : ''}" data-an-sub="${esc(s)}">${esc(s)} ${fmt(c)}</button>`).join('');
  const recs = ANF.sub ? base.filter((r) => alSubOf(r.code) === ANF.sub) : base;
  // KPI: 이번 달 · 전월 대비 · 선택기간 합계 · 거래처 · 품목
  const ym = todayStr().slice(0, 7);
  const prevYm = (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const allSubSup = ANF.sub ? (ANF.sup ? all.filter((r) => r.sup === ANF.sup) : all).filter((r) => alSubOf(r.code) === ANF.sub) : (ANF.sup ? all.filter((r) => r.sup === ANF.sup) : all);
  const monAmt = allSubSup.filter((r) => r.date.startsWith(ym)).reduce((a, r) => a + r.amt, 0);
  const prevAmt = allSubSup.filter((r) => r.date.startsWith(prevYm)).reduce((a, r) => a + r.amt, 0);
  const delta = prevAmt > 0 ? Math.round((monAmt - prevAmt) / prevAmt * 100) : null;
  $('#an-kpi').innerHTML = `
    <div class="kpi accent"><div class="k-label">이번 달 구매액</div><div class="k-value">${fmt(Math.round(monAmt))}<small>원</small></div><div class="k-sub">${ym}</div></div>
    <div class="kpi ${delta == null ? '' : delta > 0 ? 'red' : 'green'}"><div class="k-label">전월 대비</div><div class="k-value">${delta == null ? '-' : (delta > 0 ? '▲ ' : '▼ ') + Math.abs(delta) + '%'}</div><div class="k-sub">전월 ${fmt(Math.round(prevAmt))}원</div></div>
    <div class="kpi"><div class="k-label">선택기간 합계</div><div class="k-value">${fmt(Math.round(recs.reduce((a, r) => a + r.amt, 0)))}<small>원</small></div><div class="k-sub">${{ '6m': '최근 6개월', '12m': '최근 12개월', 'all': '전체 기간' }[ANF.range] || ANF.range + '년'} · ${ANF.basis === 'in' ? '입고일' : '발주일'} 기준</div></div>
    <div class="kpi"><div class="k-label">거래처</div><div class="k-value">${fmt(new Set(recs.map((r) => r.sup).filter(Boolean)).size)}<small>곳</small></div><div class="k-sub">선택 조건 기준</div></div>
    <div class="kpi"><div class="k-label">품목</div><div class="k-value">${fmt(new Set(recs.map((r) => r.item).filter(Boolean)).size)}<small>개</small></div><div class="k-sub">${fmt(recs.length)}건 거래</div></div>`;
  // 하위 탭
  $$('#an-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === ANF.tab));
  const body = $('#an-body');
  if (ANF.tab === 'trend') {
    const byM = {};
    recs.forEach((r) => { const m = r.date.slice(0, 7); byM[m] = (byM[m] || 0) + r.amt; });
    const ms = Object.keys(byM).sort().slice(-24);
    body.innerHTML = vbarSVG(ms.map((m) => ({ label: m.slice(2).replace('-', '.'), value: byM[m] })), manwon)
      + `<p class="muted" style="margin-top:6px">월별 매입 금액 (최근 ${ms.length}개월 표시)</p>`;
  } else if (ANF.tab === 'sup') {
    const by = {};
    recs.forEach((r) => { if (r.sup) by[r.sup] = (by[r.sup] || 0) + r.amt; });
    body.innerHTML = hbarHTML(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([l, v]) => ({ label: l, value: v })), manwon);
  } else if (ANF.tab === 'item') {
    const by = {};
    recs.forEach((r) => { if (r.item) by[r.item] = (by[r.item] || 0) + r.amt; });
    body.innerHTML = hbarHTML(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([l, v]) => ({ label: l, value: v })), manwon);
  } else if (ANF.tab === 'price') {
    // 단가 추이 (협상 근거): 품목 선택 → 월별 평균 단가(금액÷수량)
    const cnt = {};
    recs.forEach((r) => { if (r.item && r.qty > 0 && r.amt > 0) cnt[r.item] = (cnt[r.item] || 0) + 1; });
    const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([i]) => i);
    if (!items.includes(ANF.item)) ANF.item = items[0] || '';
    const byM = {};
    recs.filter((r) => r.item === ANF.item && r.qty > 0 && r.amt > 0).forEach((r) => {
      const m = r.date.slice(0, 7);
      (byM[m] = byM[m] || { q: 0, a: 0 }); byM[m].q += r.qty; byM[m].a += r.amt;
    });
    const ms = Object.keys(byM).sort().slice(-18);
    body.innerHTML = `<div class="filter-bar" style="padding:0 0 12px">
      <label>품목 <select id="an-item" style="max-width:340px">${items.map((i) => `<option${i === ANF.item ? ' selected' : ''}>${esc(i)}</option>`).join('')}</select></label>
      <span class="muted" style="font-size:12px">월평균 단가 = 매입 금액 ÷ 수량 — 단가 협상 근거로 활용</span></div>`
      + vbarSVG(ms.map((m) => ({ label: m.slice(2).replace('-', '.'), value: Math.round(byM[m].a / byM[m].q) })), (v) => fmt(v) + '원');
  } else {
    const list = recs.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 100);
    body.innerHTML = `<div class="table-wrap" style="max-height:480px;overflow-y:auto"><table><thead><tr>
      <th>${ANF.basis === 'in' ? '입고일' : '발주일'}</th><th>거래처</th><th>품명</th><th>품번</th><th class="num">수량</th><th class="num">금액</th>
      </tr></thead><tbody>${list.map((r) => `<tr class="no-click"><td>${esc(r.date)}</td><td>${esc(r.sup)}</td><td><b>${esc(r.item)}</b></td><td>${esc(r.code)}</td><td class="num">${fmt(r.qty, 2)}</td><td class="num">${fmt(Math.round(r.amt))}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="margin-top:8px">최근 ${fmt(list.length)}건 표시 · 조건일치 ${fmt(recs.length)}건 — 전체는 [⬇ 구매 내역 엑셀]로 내려받으세요</p>`;
  }
  renderStockCharts();
}
/* 재고·출고 현황 (하단 고정 차트) */
function renderStockCharts() {
  const months = last12Months();
  const ym = todayStr().slice(0, 7);
  // --- 원부자재 ---
  const matTotal = MATERIALS.reduce((a, m) => a + matAmount(m), 0);
  const matRows = [];
  ['부목', '하이드로겔'].forEach((d) => ['원재료', '부재료', '반제품', '완제품'].forEach((c) => {
    const v = MATERIALS.filter((m) => (m.division || '부목') === d && m.category === c).reduce((a, m) => a + matAmount(m), 0);
    if (v > 0) matRows.push({ label: `${d} · ${c}`, value: v, cls: { '원재료': 'hb-blue', '부재료': 'hb-green', '반제품': 'hb-amber', '완제품': 'hb-purple' }[c] });
  }));
  $('#an-mat').innerHTML = hbarHTML(matRows.sort((a, b) => b.value - a.value), manwon);
  $('#an-mat-top').innerHTML = hbarHTML(MATERIALS.slice().sort((a, b) => matAmount(b) - matAmount(a)).slice(0, 10)
    .map((m) => ({ label: m.name, value: matAmount(m) })), manwon);
  // --- 완제품 ---
  const dom = FINISHED.filter((f) => (f.scope || '내수') === '내수');
  const domShort = dom.filter((f) => num(f.safety) > 0 && num(f.qty) < num(f.safety)).length;
  const byGroup = {};
  dom.forEach((f) => { const g = f.group || '기타'; byGroup[g] = (byGroup[g] || 0) + num(f.qty); });
  $('#an-fin').innerHTML = vbarSVG(Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v })));
  const exp = FINISHED.filter((f) => f.scope === '수출');
  const byExpSup = {};
  exp.forEach((f) => { if (f.supplier) byExpSup[f.supplier] = (byExpSup[f.supplier] || 0) + num(f.qty); });
  $('#an-fin-exp').innerHTML = hbarHTML(Object.entries(byExpSup).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, v]) => ({ label: l, value: v })));
  // --- 출고 ---
  $('#an-issue-month').innerHTML = vbarSVG(months.map((m) => ({
    label: m.slice(2).replace('-', '.'),
    value: ISSUES.filter((s) => String(s.date || '').startsWith(m)).reduce((a, s) => a + issueQty(s), 0),
  })));
  const byItem = {};
  ISSUES.forEach((s) => (s.lines || []).forEach((l) => { byItem[l.name || l.code] = (byItem[l.name || l.code] || 0) + num(l.qty); }));
  $('#an-issue-top').innerHTML = hbarHTML(Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, v]) => ({ label: l, value: v })));
}

/* ===================== 생산 가능 체크 =====================
   임시 수동 입력(추후 영업팀 수주내역 시트 연동 예정): 제품+수량 목록 → BOM을 원부자재 단위까지
   전개해 소요량 합산 → 원부자재 재고(신규코드 대조, 조사자 무관 전체)와 비교해 가능/부족 판정. */
const CHECK_KEY = DB_PREFIX + 'check-items';
let CHECK_ITEMS = (() => { try { return JSON.parse(localStorage.getItem(CHECK_KEY)) || []; } catch (e) { return []; } })();
const checkSave = () => localStorage.setItem(CHECK_KEY, JSON.stringify(CHECK_ITEMS));
let CK_REGION = '내수', CK_LINE = '', CK_TYPE = '';

/* --- 영업팀 품목 매핑 (해외 마스터 + 국내 매핑) ---
   {rows:[{region, customer, brand, category, custCode(외부 품명), name(내부 품명/BL Code), fp, sf, bom(BOM 모품목 키)}], updatedAt} */
const PMAP_KEY = DB_PREFIX + 'productmap';
function pmapLoad() {
  try { const v = JSON.parse(localStorage.getItem(PMAP_KEY)); if (v && v.rows) return v; } catch (e) { }
  return { rows: [], updatedAt: null };
}
let PMAP = (function () {
  const verKey = DB_PREFIX + 'productmap-seed-ver';
  if (window.SEED_DATA && SEED_DATA.productMap && (localStorage.getItem(PMAP_KEY) === null || localStorage.getItem(verKey) !== '1')) {
    localStorage.setItem(PMAP_KEY, JSON.stringify(SEED_DATA.productMap));
    localStorage.setItem(verKey, '1');
  }
  return pmapLoad();
})();
/* 매핑 → BOM 모품목별 검색 별칭 (외부 품명·내부 품명·업체·브랜드·고객코드로도 제품을 찾도록) */
function pmapAliasMap() {
  const norm = (s) => String(s || '').trim().toUpperCase();
  const bomByNorm = {};
  Object.keys(BOMD.entries).forEach((k) => (bomByNorm[norm(k)] = k));
  const map = {};
  PMAP.rows.forEach((x) => {
    const k = bomByNorm[norm(x.fp)] || bomByNorm[norm(x.sf)];
    if (!k) return;
    const alias = [x.custCode, x.name, x.customer, x.brand, x.category].filter(Boolean).join(' ');
    map[k] = (map[k] ? map[k] + ' ' : '') + alias.toUpperCase();
  });
  return map;
}

function ckFillSku() {
  const q = $('#ck-search').value.trim().toUpperCase();
  const regionKeys = Object.keys(BOMD.entries).filter((k) => (BOMD.entries[k].region || '내수') === CK_REGION);
  // 라인 칩: 표준 세트는 항상 표시 + 데이터에만 있는 라인은 추가 (라인별 건수 함께 표시)
  const STD_LINES = ['CAST', 'PRE-CUT', 'SPLINT', 'HYBRID', 'RESIN', '배관보수테이프'];
  const dataLines = [...new Set(regionKeys.map((k) => BOMD.entries[k].line || '기타'))];
  const lines = STD_LINES.concat(dataLines.filter((l) => !STD_LINES.includes(l)).sort());
  const lineCnt = (l) => regionKeys.filter((k) => (BOMD.entries[k].line || '기타') === l).length;
  $('#ck-lines').innerHTML = `<button class="chip${CK_LINE === '' ? ' active' : ''}" data-line="">전체</button>`
    + lines.map((l) => `<button class="chip${CK_LINE === l ? ' active' : ''}" data-line="${esc(l)}">${esc(l)}${lineCnt(l) ? ' ' + lineCnt(l) : ''}</button>`).join('');
  let keys = CK_LINE ? regionKeys.filter((k) => (BOMD.entries[k].line || '기타') === CK_LINE) : regionKeys;
  // 완제품(FP)/반제품(SF) 구분 칩 (라인 필터 반영된 건수 표시)
  const typeCnt = (p) => keys.filter((k) => bomPrefOf(k) === p).length;
  $('#ck-types').innerHTML = `<button class="chip${CK_TYPE === '' ? ' active' : ''}" data-type="">전체</button>`
    + `<button class="chip${CK_TYPE === 'FP' ? ' active' : ''}" data-type="FP">완제품${typeCnt('FP') ? ' ' + typeCnt('FP') : ''}</button>`
    + `<button class="chip${CK_TYPE === 'SF' ? ' active' : ''}" data-type="SF">반제품${typeCnt('SF') ? ' ' + typeCnt('SF') : ''}</button>`;
  if (CK_TYPE) keys = keys.filter((k) => bomPrefOf(k) === CK_TYPE);
  if (q) {
    const alias = pmapAliasMap(); // 영업팀 매핑의 외부 품명·업체·브랜드로도 검색
    keys = keys.filter((k) => (k + ' ' + (BOMD.entries[k].n || '') + ' ' + (alias[k] || '')).toUpperCase().includes(q));
  }
  keys.sort();
  const sel = $('#ck-sku'), prev = sel.value;
  sel.innerHTML = keys.length ? keys.map((k) => `<option value="${esc(k)}">${esc(BOMD.entries[k].n || k)} — ${esc(k)}</option>`).join('') : '<option value="">(검색 결과 없음)</option>';
  if (keys.includes(prev)) sel.value = prev;
}
/* 원부자재 재고 맵: 신규코드(대문자) → {stock 합계, name, unit} */
function ckStockMap() {
  const map = {};
  MATERIALS.forEach((m) => {
    const code = String(m.newCode || '').trim().toUpperCase();
    if (!code) return;
    if (!map[code]) map[code] = { stock: 0, name: m.name, unit: m.unit || '' };
    map[code].stock += num(m.stock);
  });
  return map;
}
function renderCheck() {
  ckFillSku();
  const src = localStorage.getItem(DB_PREFIX + 'check-src');
  const srcEl = $('#ck-src');
  if (srcEl) srcEl.textContent = src ? `(${src})` : '(수동 입력)';
  const pi = $('#pmap-info');
  if (pi) {
    const linked = Object.keys(pmapAliasMap()).length;
    pi.textContent = PMAP.rows.length
      ? `영업팀 품목 매핑 ${fmt(PMAP.rows.length)}건 등록 (${PMAP.updatedAt || '-'} 기준 · BOM 연결 ${fmt(linked)}품목)`
      : '영업팀 품목 매핑이 아직 등록되지 않았습니다';
  }
  const stockMap = ckStockMap();
  // 품목별 판정: 목록 순서대로 재고를 배정. 자재가 모자란 품목은 '생산계획 제외'로 표시하고
  // 재고를 소모하지 않는다 (제외된 품목의 자재는 다음 품목이 쓸 수 있음).
  const remain = {};
  Object.keys(stockMap).forEach((k) => (remain[k] = stockMap[k].stock));
  const itemStates = CHECK_ITEMS.map((it) => {
    if (!BOMD.entries[it.code]) return { state: 'nobom', shorts: [] };
    const need = {};
    bomFlatten(it.code, num(it.qty), need, new Set());
    const shorts = [];
    Object.values(need).forEach((x) => {
      const key = String(x.code).trim().toUpperCase();
      if (remain[key] == null || remain[key] < x.qty) shorts.push(x.code);
    });
    if (shorts.length) return { state: 'short', shorts };
    Object.values(need).forEach((x) => { remain[String(x.code).trim().toUpperCase()] -= x.qty; });
    return { state: 'ok', shorts: [] };
  });
  const okCnt = itemStates.filter((s) => s.state === 'ok').length;
  const shortItemCnt = itemStates.filter((s) => s.state === 'short').length;
  // 체크 목록 (품목별 상태 표시)
  if (!CHECK_ITEMS.length) {
    $('#check-items').innerHTML = '<div class="empty">위에서 제품과 수량을 추가하세요.<br>나중에 영업팀 수주내역 시트를 불러오는 방식으로 바뀔 예정입니다.</div>';
  } else {
    const stCell = (s) => s.state === 'ok' ? '<span class="badge ok">✅ 가능</span>'
      : s.state === 'short' ? `<span class="badge bad" title="부족 자재: ${esc(s.shorts.join(', '))}">⚠️ 부족 — 계획 제외</span>`
      : '<span class="badge plain">BOM 없음</span>';
    const body = CHECK_ITEMS.map((it, i) => `<tr class="no-click${itemStates[i].state === 'short' ? ' ck-short' : ''}">
      <td><b>${esc(it.code)}</b></td>
      <td>${esc(it.name)}</td>
      <td class="num"><input class="cell-edit" type="text" inputmode="decimal" value="${Number(it.qty).toLocaleString('ko-KR')}" data-ck-qty="${i}"></td>
      <td>${stCell(itemStates[i])}</td>
      <td><button class="btn small danger" data-ck-del="${i}">삭제</button></td>
    </tr>`).join('');
    $('#check-items').innerHTML = `<table><thead><tr><th>제품코드</th><th>품명</th><th class="num">수량</th><th>판정</th><th></th></tr></thead><tbody>${body}</tbody></table>`
      + (shortItemCnt ? `<p class="muted" style="margin-top:8px">⚠️ 표시 품목은 자재 부족으로 <b>생산계획에서 제외</b>해야 합니다. 부족 자재는 판정 배지에 마우스를 올리거나 오른쪽 대조표에서 확인하세요.</p>` : '');
  }
  // BOM 전개 소요량 합산 (전체 수요 기준 — 무엇이 얼마나 모자란지 보기 위함)
  const acc = {};
  const noBom = [];
  CHECK_ITEMS.forEach((it) => {
    if (BOMD.entries[it.code]) bomFlatten(it.code, num(it.qty), acc, new Set());
    else noBom.push(it.code);
  });
  const rows = Object.values(acc).map((x) => {
    const st = stockMap[String(x.code).trim().toUpperCase()];
    const stock = st ? st.stock : null;
    const gap = stock == null ? null : stock - x.qty;
    return Object.assign({}, x, { stock, gap, state: stock == null ? '미등록' : (gap >= 0 ? '충분' : '부족') });
  });
  const order = { '부족': 0, '미등록': 1, '충분': 2 };
  rows.sort((a, b) => order[a.state] - order[b.state] || String(a.code).localeCompare(String(b.code)));
  const shortCnt = rows.filter((r) => r.state === '부족').length;
  const missCnt = rows.filter((r) => r.state === '미등록').length;
  // 판정 배너 (품목별 결과 기준)
  let banner = '';
  if (CHECK_ITEMS.length) {
    if (shortItemCnt) banner = `<div class="verdict bad">⚠️ ${shortItemCnt}개 품목 자재 부족 — 생산계획에서 제외 필요 (가능 ${okCnt}개 · 부족 자재 ${shortCnt}종${missCnt ? ` · 재고 미등록 ${missCnt}종` : ''}) <button class="btn small" id="ck-po-btn" style="margin-left:10px">📝 발주서 작성</button></div>`;
    else if (missCnt) banner = `<div class="verdict warn">△ 판정 보류 — 부족 자재는 없지만 재고 미등록 자재 ${missCnt}종은 확인 불가</div>`;
    else banner = `<div class="verdict ok">✅ 전체 생산 가능 — ${okCnt}개 품목 모두 자재가 충분합니다</div>`;
  }
  $('#check-verdict').innerHTML = banner;
  // KPI
  $('#check-kpi').innerHTML = CHECK_ITEMS.length ? `
    <div class="kpi accent"><div class="k-label">체크 품목</div><div class="k-value">${fmt(CHECK_ITEMS.length)}<small>종</small></div><div class="k-sub">총 수량 ${fmt(CHECK_ITEMS.reduce((a, x) => a + num(x.qty), 0))}${noBom.length ? ' · BOM 없음 ' + noBom.length + '종' : ''}</div></div>
    <div class="kpi ${okCnt ? 'green' : ''}"><div class="k-label">생산 가능 품목</div><div class="k-value">${fmt(okCnt)}<small>개</small></div><div class="k-sub">목록 순서로 재고 배정</div></div>
    <div class="kpi ${shortItemCnt ? 'red' : 'green'}"><div class="k-label">계획 제외 (자재 부족)</div><div class="k-value">${fmt(shortItemCnt)}<small>개</small></div><div class="k-sub">부족 자재 ${fmt(shortCnt)}종</div></div>
    <div class="kpi ${missCnt ? '' : 'green'}"><div class="k-label">재고 미등록</div><div class="k-value">${fmt(missCnt)}<small>종</small></div><div class="k-sub">신규코드 매칭 실패</div></div>` : '';
  // 대조 테이블
  if (!rows.length) {
    $('#check-result').innerHTML = '<div class="empty">체크 목록을 추가하면 소요 자재가 여기에 표시됩니다.</div>';
    return;
  }
  const stBadge = { '충분': '<span class="badge ok">충분</span>', '부족': '<span class="badge bad">부족</span>', '미등록': '<span class="badge plain">재고 미등록</span>' };
  $('#check-result').innerHTML = `<table><thead><tr>
    <th>자재코드</th><th>품명</th><th>단위</th><th class="num">소요량</th><th class="num">현재고</th><th class="num">과부족</th><th>상태</th>
  </tr></thead><tbody>${rows.map((r) => `<tr class="no-click">
    <td><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${esc(r.unit)}</td>
    <td class="num">${fmtQty(r.qty)}</td>
    <td class="num">${r.stock == null ? '-' : fmt(r.stock, 2)}</td>
    <td class="num">${r.gap == null ? '-' : (r.gap >= 0 ? '+' : '') + fmt(r.gap, 2)}</td>
    <td>${stBadge[r.state]}</td>
  </tr>`).join('')}</tbody></table>`;
}
/* --- 매핑 엑셀 업로드 (해외 마스터 / 국내 매핑 자동 인식, 해당 구분 통째 교체) --- */
function parsePmapWB(wb) {
  const got = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
    for (let hi = 0; hi < Math.min(rows.length, 4); hi++) {
      const hdr = (rows[hi] || []).map((c) => c == null ? '' : String(c).trim());
      const H = {};
      hdr.forEach((c, i) => { if (c && H[c] == null) H[c] = i; });
      const g = (r, k) => H[k] == null || r[H[k]] == null ? '' : String(r[H[k]]).trim();
      if (H['품번-완제품'] != null && H['업체'] != null) { // 해외 마스터
        for (let i = hi + 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const fp = g(r, '품번-완제품');
          if (!fp) continue;
          got.push({ region: '해외', customer: g(r, '업체'), brand: '', category: g(r, 'Category'), custCode: g(r, 'Customer Code'), name: g(r, 'BL Code'), fp, sf: g(r, '품번-반제품') });
        }
        return { region: '해외', rows: got };
      }
      if (H['내부 품번(BL CODE)'] != null) { // 국내 매핑
        for (let i = hi + 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const fp = g(r, '내부 품번(BL CODE)');
          if (!fp) continue;
          got.push({ region: '내수', customer: g(r, '취급 업체명'), brand: g(r, '브랜드'), category: g(r, '품명 대분류'), custCode: g(r, '외부 품명(CUSTOMER CODE)'), name: g(r, '내부 품명(BL CODE)'), fp, sf: '' });
        }
        return { region: '내수', rows: got };
      }
    }
  }
  throw new Error("매핑 헤더를 찾을 수 없습니다 (해외: '품번-완제품'+'업체' / 국내: '내부 품번(BL CODE)')");
}
async function importPmapFiles(files) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  const msgs = [], errs = [];
  for (const f of files) {
    try {
      const res = parsePmapWB(XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' }));
      PMAP.rows = PMAP.rows.filter((x) => x.region !== res.region).concat(res.rows);
      msgs.push(`${res.region} ${res.rows.length}건`);
    } catch (e) { errs.push(f.name + ': ' + e.message); }
  }
  if (msgs.length) {
    PMAP.updatedAt = todayStr();
    localStorage.setItem(PMAP_KEY, JSON.stringify(PMAP));
    refreshCurrentPage();
    toast('매핑 갱신·자동저장: ' + msgs.join(' / ') + (errs.length ? ' · 실패 ' + errs.length + '건' : ''));
  } else toast('매핑을 읽지 못했습니다 — ' + errs.join(' / '));
}
$('#btn-xlsx-pmap').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) importPmapFiles([...inp.files]); };
  inp.click();
});
/* 생산 가능 체크 화면에 엑셀 끌어다 놓기: 생산계획('계획표' 시트)은 계획 체크로, 그 외는 매핑으로 자동 라우팅 */
(() => {
  const zone = $('#page-check');
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drop-active'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && zone.contains(e.relatedTarget)) return; zone.classList.remove('drop-active'); }));
  zone.addEventListener('drop', async (e) => {
    const fl = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => /\.xls[xb]?$/i.test(f.name));
    if (!fl.length) { toast('엑셀 파일(.xlsx/.xlsb)만 지원합니다'); return; }
    const pmapFiles = [];
    for (const f of fl) {
      let isPlan = false;
      try {
        const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', bookSheets: true });
        isPlan = wb.SheetNames.some((s) => s.includes('계획표'));
      } catch (err) { }
      if (isPlan) await importPlanXlsx(f);
      else pmapFiles.push(f);
    }
    if (pmapFiles.length) importPmapFiles(pmapFiles);
  });
})();
/* --- 생산계획 엑셀 체크 ('계획표' 시트) ---
   오늘 필요한 자재는 어제 챙기므로, 내일부터 다다음주 화요일까지의 계획 행을 읽어
   제품명+칼라+업체명으로 BOM 완제품을 찾아 체크 목록을 자동 구성한다. */
function ckPlanWindow() {
  const today = new Date();
  const tmr = new Date(today); tmr.setDate(today.getDate() + 1);
  const day = today.getDay();
  const nextMon = new Date(today); nextMon.setDate(today.getDate() + (((8 - day) % 7) || 7));
  const tue2 = new Date(nextMon); tue2.setDate(nextMon.getDate() + 8); // 다다음주 화요일
  const ds = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: ds(tmr), to: ds(tue2) };
}
/* 계획서의 한글 업체명 → BOM 업체 코드 별칭 */
const CK_CUST_ALIAS = {
  '글로브메드': 'GLOBEMED', '시그맥스': 'SIGMAX', '하치코': 'HACHIKO', '크레비': 'KREWI', '오셔': 'OSSUR',
  '스마일': 'SMILE', '나저메드': 'NAGERMED', '바일코리아': 'BAILKOREA', '알힐알': 'ALHILAL', '비엣케어': 'VIETCARE',
  '캐스캐이드': 'CASCADE', '큐로실': 'CUROSIL', '예스메디칼': 'YESMEDICAL', '이노코르': 'INNOCORR',
  '데프로메드': 'DEPROMED', '호라이즌': 'HORIZON', '라이프메드': 'LIFEMED', '오소테이프': 'ORTHOTAPE',
  '요반스': 'YOVANNS', '하이고': 'HIGH-GO', '비에스엔': 'BSN', '에이엠에스': 'AMS',
};
function ckMatchPlanBom(prod, color, sup) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s\r\n"']/g, '');
  const token = norm(color ? prod + '-' + color : prod); // SPLINT 계획서는 칼라 컬럼 없음
  const guard = new RegExp('(^|[^A-Z0-9])' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9])');
  let cands = Object.keys(BOMD.entries).filter((k) => guard.test(norm(k)));
  if (!cands.length) return null;
  const fp = cands.filter((k) => k.startsWith('FP'));
  if (fp.length) cands = fp;
  if (cands.length === 1) return cands[0];
  // 업체명 토큰: 괄호 안 영문 / 괄호 제외 / 전체 / 한글 별칭
  const s = String(sup || '').trim();
  const toks = [];
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) toks.push(norm(paren[1]));
  toks.push(norm(s.replace(/\([^)]*\)/g, '')), norm(s));
  Object.keys(CK_CUST_ALIAS).forEach((ko) => { if (s.replace(/\s/g, '').includes(ko)) toks.push(norm(CK_CUST_ALIAS[ko])); });
  const narrowed = cands.filter((k) => {
    const kn = norm(k), cn = norm(BOMD.entries[k].customer || '');
    return toks.some((t) => t.length >= 2 && (kn.includes(t) || (cn && (cn.includes(t) || t.includes(cn)))));
  });
  if (narrowed.length === 1) return narrowed[0];
  if (!narrowed.length) {
    const dom = cands.filter((k) => norm(k).includes('내수'));
    if (dom.length === 1) return dom[0];
  }
  return null;
}
async function importPlanXlsx(file) {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중 — 인터넷 연결을 확인하고 잠시 후 다시 시도하세요'); return; }
  let wb;
  try { wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' }); }
  catch (e) { toast('엑셀 오류: ' + e.message); return; }
  const sn = wb.SheetNames.find((x) => x.includes('계획표'));
  if (!sn) { toast("'계획표' 시트를 찾을 수 없습니다"); return; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    const rr = (rows[i] || []).map((c) => c == null ? '' : String(c).replace(/[\s\r\n]/g, ''));
    if ((rr.includes('계획일') || rr.includes('날짜')) && rr.includes('제품명')) hi = i; // 헤더가 2행 반복 → 마지막 것 (CAST: 계획일 / SPLINT: 날짜)
    if (hi >= 0 && i > hi + 2) break;
  }
  if (hi < 0) { toast('계획표 헤더(계획일·날짜/제품명)를 찾을 수 없습니다'); return; }
  const H = {};
  (rows[hi] || []).forEach((c, idx) => { const t = c == null ? '' : String(c).replace(/[\s\r\n]/g, ''); if (t && H[t] == null) H[t] = idx; });
  const cDate = H['계획일'] != null ? H['계획일'] : H['날짜'];
  const cSup = H['업체명'] != null ? H['업체명'] : H['업체'];
  const cProd = H['제품명'], cColor = H['칼라'], cQty = H['계획수량'];
  if (cDate == null || cProd == null || cQty == null) { toast('필요 컬럼(계획일/제품명/계획수량)을 찾을 수 없습니다'); return; }
  const win = ckPlanWindow();
  const ff = {};
  const agg = {}; // bom key → qty
  const unmatched = {}; // disp → qty
  let rowsInWin = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r[cDate] != null && r[cDate] !== '') ff.date = xlsDateStr(r[cDate]);
    if (cSup != null && r[cSup] != null && String(r[cSup]).trim()) ff.sup = String(r[cSup]).trim();
    const prod = r[cProd] == null ? '' : String(r[cProd]).trim();
    const qty = Number(r[cQty]);
    if (!prod || prod === '제품명' || !isFinite(qty) || qty <= 0) continue;
    if (!ff.date || ff.date < win.from || ff.date > win.to) continue;
    rowsInWin++;
    const color = cColor != null && r[cColor] != null ? String(r[cColor]).trim() : '';
    const key = ckMatchPlanBom(prod, color, ff.sup);
    if (key) agg[key] = (agg[key] || 0) + qty;
    else {
      const d = `${prod}${color ? '-' + color : ''} (${ff.sup || '업체?'})`;
      unmatched[d] = (unmatched[d] || 0) + qty;
    }
  }
  if (!rowsInWin) { toast(`${win.from} ~ ${win.to} 기간에 계획 행이 없습니다`); return; }
  const newItems = Object.entries(agg).map(([code, qty]) => ({ code, name: BOMD.entries[code].n || code, qty }))
    .concat(Object.entries(unmatched).map(([d, qty]) => ({ code: d, name: d, qty })));
  // CAST/SPLINT 계획을 구분별로 따로 저장하고 항상 합쳐서 체크 목록을 구성.
  // 같은 구분을 다시 올리면 그 구분만 교체되고 다른 구분은 유지된다.
  const fname = String(file.name || '').toUpperCase();
  const kind = fname.includes('SPLINT') ? 'SPLINT' : fname.includes('CAST') ? 'CAST'
    : (cColor != null ? 'CAST' : 'SPLINT'); // 파일명에 없으면 칼라 컬럼 유무로 판정
  let plans = {};
  try { plans = JSON.parse(localStorage.getItem(DB_PREFIX + 'check-plans')) || {}; } catch (e) { }
  plans[kind] = { items: newItems, rows: rowsInWin, win };
  localStorage.setItem(DB_PREFIX + 'check-plans', JSON.stringify(plans));
  // 모든 구분 합산 (같은 제품코드는 수량 합침)
  const mergedMap = {};
  Object.values(plans).forEach((p) => (p.items || []).forEach((it) => {
    if (!mergedMap[it.code]) mergedMap[it.code] = { code: it.code, name: it.name, qty: 0 };
    mergedMap[it.code].qty += num(it.qty);
  }));
  CHECK_ITEMS = Object.values(mergedMap);
  checkSave();
  const kinds = Object.keys(plans);
  localStorage.setItem(DB_PREFIX + 'check-src',
    `생산계획 ${win.from.slice(5).replace('-', '/')}~${win.to.slice(5).replace('-', '/')} · ` + kinds.map((k) => `${k} ${plans[k].rows}행`).join(' + '));
  renderCheck();
  const um = Object.keys(unmatched).length;
  toast(`${kind} 생산계획 반영 (${win.from} ~ ${win.to}): ${rowsInWin}행 → ${Object.keys(agg).length}종${um ? ` · BOM 미매칭 ${um}종` : ' · 전부 매칭'} — 체크 목록 ${CHECK_ITEMS.length}종 (${Object.keys(plans).join('+')})`);
  if (um) console.warn('생산계획 BOM 미매칭:', unmatched);
}
$('#ck-plan-in').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls,.xlsb';
  inp.onchange = () => { if (inp.files[0]) importPlanXlsx(inp.files[0]); };
  inp.click();
});
/* 체크 화면 이벤트 */
$('#ck-region').addEventListener('input', () => { CK_REGION = $('#ck-region').value; CK_LINE = ''; CK_TYPE = ''; ckFillSku(); });
$('#ck-search').addEventListener('input', ckFillSku);
$('#ck-lines').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { CK_LINE = b.dataset.line; ckFillSku(); } });
$('#ck-types').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { CK_TYPE = b.dataset.type; ckFillSku(); } });
$('#ck-add').addEventListener('click', () => {
  const code = $('#ck-sku').value;
  if (!code || !BOMD.entries[code]) { toast('제품을 선택하세요'); return; }
  const qty = Number($('#ck-qty').value.replace(/,/g, '').trim());
  if (!qty || qty <= 0 || isNaN(qty)) { toast('수량을 입력하세요'); return; }
  const dup = CHECK_ITEMS.find((x) => x.code === code);
  if (dup) dup.qty = num(dup.qty) + qty; // 같은 제품은 수량 합산
  else CHECK_ITEMS.push({ code, name: BOMD.entries[code].n || code, qty });
  $('#ck-qty').value = '';
  checkSave();
  renderCheck();
});
$('#check-clear').addEventListener('click', () => {
  if (!CHECK_ITEMS.length || !confirm('체크 목록을 모두 비우시겠습니까?')) return;
  CHECK_ITEMS = [];
  checkSave();
  localStorage.removeItem(DB_PREFIX + 'check-src');
  localStorage.removeItem(DB_PREFIX + 'check-plans');
  renderCheck();
});
document.addEventListener('change', (e) => {
  const inp = e.target.closest('input[data-ck-qty]');
  if (!inp) return;
  const i = Number(inp.dataset.ckQty);
  const v = Number(inp.value.replace(/,/g, '').trim());
  if (!v || v <= 0 || isNaN(v)) { toast('숫자만 입력할 수 있습니다'); renderCheck(); return; }
  CHECK_ITEMS[i].qty = v;
  checkSave();
  renderCheck();
});
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-ck-del]');
  if (!del) return;
  CHECK_ITEMS.splice(Number(del.dataset.ckDel), 1);
  checkSave();
  renderCheck();
});
$('#btn-csv-check').addEventListener('click', () => {
  const acc = {};
  CHECK_ITEMS.forEach((it) => { if (BOMD.entries[it.code]) bomFlatten(it.code, num(it.qty), acc, new Set()); });
  const stockMap = ckStockMap();
  const rows = Object.values(acc).map((x) => {
    const st = stockMap[String(x.code).trim().toUpperCase()];
    return { code: x.code, name: x.name, unit: x.unit, need: x.qty, stock: st ? st.stock : null };
  }).filter((r) => r.stock == null || r.stock < r.need);
  if (!rows.length) { toast('부족하거나 미등록인 자재가 없습니다'); return; }
  downloadCsv(`부족자재_${todayStr()}.csv`,
    ['자재코드', '품명', '단위', '소요량', '현재고', '부족량', '상태'],
    rows.map((r) => [r.code, r.name, r.unit, r.need, r.stock ?? '', r.stock == null ? '' : Math.max(0, r.need - r.stock), r.stock == null ? '재고 미등록' : '부족']));
});

/* ===================== 발주서 작성 (구매 발주서 양식 F-ET-007) =====================
   생산 가능 체크의 부족 자재·발주 알림의 긴급 품목을 버튼 한 번으로 발주서에 담고,
   원본 엑셀 양식(po-template.xlsx)의 셀에 값을 채워 서식·로고 그대로 다운로드한다. */
const PO_KEY = DB_PREFIX + 'pos';
// 담당자 연락처(개인 정보)는 company-info.js(window.BL_COMPANY)에서 — GitHub 제외 파일
const PO_NOTES_DEFAULT = '* 특이사항 발생시 즉시 연락 바랍니다.\n* 거래명세서 동봉 및 단가 표시 부탁 드립니다.'
  + ((window.BL_COMPANY || {}).poContact ? '\n* ' + window.BL_COMPANY.poContact : '');
function poListLoad() { try { return JSON.parse(localStorage.getItem(PO_KEY)) || []; } catch (e) { return []; } }
function poListSave(l) { localStorage.setItem(PO_KEY, JSON.stringify(l)); }
const poEmptyItem = () => ({ name: '', unit: '', qty: '', price: '', due: '', note: '' });
function poBlank() { return { id: null, to: '', fax: '', date: todayStr(), mgr: '차 훈', items: [], notes: PO_NOTES_DEFAULT }; }
let PO_CUR = null;
function poNew(items, msg) {
  PO_CUR = poBlank();
  if (items && items.length) PO_CUR.items = items.map((x) => Object.assign(poEmptyItem(), x));
  while (PO_CUR.items.length < 5) PO_CUR.items.push(poEmptyItem());
  showPage('po');
  if (msg) toast(msg);
}
const poAmt = (it) => num(it.qty) * num(it.price);
const poTotal = (po) => po.items.reduce((a, it) => a + poAmt(it), 0);
function renderPo() {
  if (!PO_CUR) { PO_CUR = poBlank(); while (PO_CUR.items.length < 5) PO_CUR.items.push(poEmptyItem()); }
  $('#po-to').value = PO_CUR.to || '';
  $('#po-fax').value = PO_CUR.fax || '';
  $('#po-date').value = PO_CUR.date || todayStr();
  $('#po-mgr').value = PO_CUR.mgr || '';
  $('#po-notes').value = PO_CUR.notes != null ? PO_CUR.notes : PO_NOTES_DEFAULT;
  poRenderItems();
  poRenderList();
}
function poRenderItems() {
  const inp = (i, f, v, ph, isNum) => {
    const disp = isNum && v !== '' && v != null && isFinite(num(v)) && String(v).trim() !== ''
      ? num(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : (v == null ? '' : v);
    return `<input class="cell-edit" type="text" ${isNum ? 'inputmode="decimal"' : ''} value="${esc(disp)}" data-po="${i}" data-f="${f}" placeholder="${ph || ''}">`;
  };
  $('#po-items').innerHTML = `<table><thead><tr>
    <th style="width:36px">No</th><th>품명</th><th style="width:64px">단위</th><th class="num" style="width:86px">수량</th><th class="num" style="width:104px">단가</th><th class="num" style="width:120px">금액</th><th style="width:116px">납기요청일</th><th>비고</th><th style="width:40px"></th>
  </tr></thead><tbody>${PO_CUR.items.map((it, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td>${inp(i, 'name', it.name, '품명')}</td>
    <td>${inp(i, 'unit', it.unit)}</td>
    <td class="num">${inp(i, 'qty', it.qty, '', 1)}</td>
    <td class="num">${inp(i, 'price', it.price, '', 1)}</td>
    <td class="num" id="po-amt-${i}">${poAmt(it) ? fmt(Math.round(poAmt(it))) + '원' : '-'}</td>
    <td>${inp(i, 'due', it.due, 'YYYY-MM-DD')}</td>
    <td>${inp(i, 'note', it.note)}</td>
    <td><button class="btn small danger" data-po-del="${i}" title="행 삭제">✕</button></td>
  </tr>`).join('')}</tbody></table>`;
  $('#po-total').textContent = fmt(Math.round(poTotal(PO_CUR))) + '원';
}
function poRenderList() {
  const list = poListLoad();
  $('#po-list').innerHTML = list.length ? list.slice().reverse().map((p) => `
    <div class="po-item${PO_CUR && PO_CUR.id === p.id ? ' active' : ''}" data-po-open="${p.id}">
      <div><b>${esc(p.to || '(수신 미입력)')}</b> <span class="muted">${esc(p.date || '')}</span></div>
      <div class="muted" style="font-size:12px">품목 ${p.items.filter((it) => String(it.name).trim()).length}종 · ${fmt(Math.round(poTotal(p)))}원</div>
      <button class="btn small danger" data-po-remove="${p.id}" title="삭제">✕</button>
    </div>`).join('') : '<div class="empty">저장된 발주서가 없습니다.<br>작성 후 💾 저장을 누르면 목록에 쌓입니다.</div>';
}
$('#po-items').addEventListener('input', (e) => {
  const t = e.target;
  if (!t.dataset || t.dataset.po == null) return;
  const i = +t.dataset.po, f = t.dataset.f;
  PO_CUR.items[i][f] = t.value;
  if (f === 'qty' || f === 'price') {
    const a = poAmt(PO_CUR.items[i]);
    $('#po-amt-' + i).textContent = a ? fmt(Math.round(a)) + '원' : '-';
    $('#po-total').textContent = fmt(Math.round(poTotal(PO_CUR))) + '원';
  }
});
$('#po-items').addEventListener('click', (e) => {
  const del = e.target.closest('[data-po-del]');
  if (!del) return;
  PO_CUR.items.splice(+del.dataset.poDel, 1);
  if (!PO_CUR.items.length) PO_CUR.items.push(poEmptyItem());
  poRenderItems();
});
['po-to', 'po-fax', 'po-date', 'po-mgr', 'po-notes'].forEach((id) => {
  $('#' + id).addEventListener('input', () => {
    PO_CUR.to = $('#po-to').value; PO_CUR.fax = $('#po-fax').value;
    PO_CUR.date = $('#po-date').value; PO_CUR.mgr = $('#po-mgr').value;
    PO_CUR.notes = $('#po-notes').value;
  });
});
$('#po-add-row').addEventListener('click', () => { PO_CUR.items.push(poEmptyItem()); poRenderItems(); });
$('#po-new').addEventListener('click', () => poNew());
$('#po-save').addEventListener('click', () => {
  const list = poListLoad();
  if (!PO_CUR.id) PO_CUR.id = 'PO' + Date.now();
  const snap = JSON.parse(JSON.stringify(PO_CUR));
  const i = list.findIndex((p) => p.id === PO_CUR.id);
  if (i >= 0) list[i] = snap; else list.push(snap);
  poListSave(list);
  poRenderList();
  toast('발주서 저장 완료 — 오른쪽 목록에서 다시 열 수 있습니다');
});
$('#po-list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-po-remove]');
  if (rm) {
    poListSave(poListLoad().filter((p) => p.id !== rm.dataset.poRemove));
    poRenderList();
    toast('발주서를 삭제했습니다');
    return;
  }
  const open = e.target.closest('[data-po-open]');
  if (open) {
    const p = poListLoad().find((x) => x.id === open.dataset.poOpen);
    if (p) { PO_CUR = JSON.parse(JSON.stringify(p)); renderPo(); }
  }
});
/* 엑셀 다운로드: 원본 양식 xlsx(zip) 안의 셀 XML에 값을 심어 테두리·로고·서식을 그대로 유지 */
const poEscXml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function poDownloadXlsx() {
  const items = PO_CUR ? PO_CUR.items.filter((it) => String(it.name).trim() || num(it.qty)) : [];
  if (!items.length) { toast('품명이 입력된 행이 없습니다'); return; }
  const fname = `발주서_${(PO_CUR.to || '미지정').replace(/[\\/:*?"<>|]/g, '')}_${PO_CUR.date || todayStr()}.xlsx`;
  try {
    if (items.length > 15) throw new Error('16행 이상 — 기본 양식으로 생성');
    if (typeof JSZip === 'undefined') throw new Error('JSZip 미로딩');
    const buf = await (await fetch('po-template.xlsx')).arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    let xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const setCell = (addr, val, isNum) => {
      const re = new RegExp(`<c r="${addr}"( s="\\d+")?[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
      if (val == null || val === '' || (isNum && !isFinite(Number(val)))) {
        xml = xml.replace(re, `<c r="${addr}"$1/>`);
        return;
      }
      xml = xml.replace(re, isNum
        ? `<c r="${addr}"$1><v>${Number(val)}</v></c>`
        : `<c r="${addr}"$1 t="inlineStr"><is><t xml:space="preserve">${poEscXml(val)}</t></is></c>`);
    };
    setCell('D8', PO_CUR.to); setCell('I8', PO_CUR.date || todayStr());
    setCell('D9', PO_CUR.fax); setCell('I9', PO_CUR.mgr);
    for (let i = 0; i < 15; i++) {
      const r = 12 + i, it = items[i];
      setCell('C' + r, it ? it.name : ''); setCell('E' + r, it ? it.unit : '');
      setCell('F' + r, it ? num(it.qty) || '' : '', true); setCell('G' + r, it ? num(it.price) || '' : '', true);
      setCell('H' + r, it ? Math.round(poAmt(it)) || '' : '', true);
      setCell('I' + r, it ? it.due : ''); setCell('J' + r, it ? it.note : '');
    }
    // 계(H27): SUM 수식은 유지하고 캐시 값만 갱신해 열자마자 합계가 보이게
    xml = xml.replace(/(<c r="H27"[^>]*>)<f>SUM\(H12:H26\)<\/f><v>[^<]*<\/v>(<\/c>)/,
      `$1<f>SUM(H12:H26)</f><v>${Math.round(poTotal(PO_CUR))}</v>$2`);
    const notes = String(PO_CUR.notes || '').split('\n');
    for (let i = 0; i < 3; i++) setCell('D' + (29 + i), notes[i] || '');
    zip.file('xl/worksheets/sheet1.xml', xml);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('발주서 엑셀 다운로드 — 회사 양식 그대로 출력했습니다');
  } catch (err) {
    console.warn('[발주서] 양식 채우기 실패 — 기본 양식으로 대체', err);
    poXlsxFallback(items, fname);
  }
}
/* 예비 생성기: 양식 파일을 읽지 못하거나 품목이 15행을 넘을 때 같은 배치로 새로 그린다 */
function poXlsxFallback(items, fname) {
  const n = Math.max(items.length, 15);
  const aoa = [];
  aoa[0] = [, , , '구  매  발  주  서'];
  aoa[2] = [, '강원도 춘천시 퇴계농공로 84 비엘테크 주식회사  TEL 033-264-2686 / FAX 033-264-2682'];
  aoa[3] = [, '귀사의 일익 번창하심을 기원합니다.'];
  aoa[4] = [, '하기와 같이 발주하오니 납기일을 준수하여 입고 바랍니다.'];
  aoa[6] = [, '수신', PO_CUR.to, , , '발주일자', PO_CUR.date || todayStr()];
  aoa[7] = [, '팩스수신번호', PO_CUR.fax, , , '담당자', PO_CUR.mgr];
  aoa[9] = [, 'No', '품명', '단위', '수량', '단가', '금액', '납기요청일', '비고'];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    aoa[10 + i] = it
      ? [, i + 1, it.name, it.unit, num(it.qty) || '', num(it.price) || '', Math.round(poAmt(it)) || '', it.due, it.note]
      : [, i + 1];
  }
  aoa[10 + n] = [, '계', , , , , Math.round(poTotal(PO_CUR))];
  aoa[11 + n] = [, '특이사항'];
  String(PO_CUR.notes || '').split('\n').forEach((ln, i) => { aoa[12 + n + i] = [, , ln]; });
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r || []));
  ws['!cols'] = [{ wch: 2 }, { wch: 8 }, { wch: 34 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '발주서');
  XLSX.writeFile(wb, fname);
  toast('발주서 엑셀 다운로드 (기본 양식)');
}
$('#po-xlsx').addEventListener('click', poDownloadXlsx);
/* 생산 가능 체크의 부족·미등록 자재 → 발주 품목 (수량 = 부족량 올림, 단가 = 당월 단가) */
function ckShortItems() {
  const acc = {};
  CHECK_ITEMS.forEach((it) => { if (BOMD.entries[it.code]) bomFlatten(it.code, num(it.qty), acc, new Set()); });
  const stockMap = ckStockMap();
  const priceOf = {};
  MATERIALS.forEach((m) => {
    const k = String(m.newCode || '').trim().toUpperCase();
    if (k && priceOf[k] == null && m.price != null && m.price !== '') priceOf[k] = num(m.price);
  });
  return Object.values(acc).map((x) => {
    const key = String(x.code).trim().toUpperCase();
    const st = stockMap[key];
    return { code: x.code, name: x.name, unit: x.unit, need: x.qty, stock: st ? st.stock : null, price: priceOf[key] };
  }).filter((r) => r.stock == null || r.stock < r.need)
    .map((r) => ({
      name: r.name || r.code, unit: r.unit || '',
      qty: Math.ceil(r.stock == null ? r.need : r.need - r.stock),
      price: r.price != null ? r.price : '',
      due: '', note: String(r.code) + (r.stock == null ? ' · 재고 미등록' : ' · 부족'),
    }));
}
function poFromCheck() {
  const items = ckShortItems();
  if (!items.length) { toast('부족하거나 미등록인 자재가 없습니다'); return; }
  poNew(items, `부족 자재 ${items.length}종을 발주서에 담았습니다 — 수신·단가·납기를 확인하세요`);
}
$('#btn-po-check').addEventListener('click', poFromCheck);
document.addEventListener('click', (e) => { if (e.target.closest('#ck-po-btn')) poFromCheck(); });
/* 발주 알림·종합 현황의 긴급·준비 품목 → 발주 품목 (수량 = 2개월분을 채우는 제안치) */
function poFromAlertRows(rows, emptyMsg) {
  const need = rows.filter((r) => r.state === '긴급 발주' || r.state === '준비 필요');
  if (!need.length) { toast(emptyMsg); return; }
  const items = need.map((r) => ({
    name: r.name || r.code, unit: r.unit || '',
    qty: Math.ceil(Math.max(r.avgUse * 2 - num(r.stock), r.avgUse)) || '',
    price: r.price != null ? r.price : '',
    due: '', note: (r.code ? r.code + ' · ' : '') + r.state,
  }));
  poNew(items, `발주 필요 ${items.length}종을 담았습니다 — 수량은 2개월분 제안치이니 조정하세요`);
}
$('#al-po').addEventListener('click', () =>
  poFromAlertRows(filteredAlert(alertRows()), '긴급 발주·준비 필요 품목이 없습니다 (현재 필터 기준)'));
/* 종합 현황 '발주가 필요한 품목' 행의 버튼 — capture 단계에서 처리해 행 클릭 이동을 막는다 */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#home-po-btn')) return;
  e.stopPropagation();
  poFromAlertRows(alertRows(), '긴급 발주·준비 필요 품목이 없습니다');
}, true);

/* ===================== 원부자재 이슈 (AI 뉴스봇 2종) =====================
   매일 오전 08:20 예약 작업(Claude 데스크톱)이 국내·해외 뉴스를 수집·번역해
   클라우드 kv 'bl-purchase-rmnews'로 올리면, 접속 시 동기화로 내려와 표시된다.
   데이터: {days:[{date, glass:[{t,s,src,url,region}], market:[...]}], updatedAt} */
const RMI_KEY = DB_PREFIX + 'rmnews';
/* 봇 5종 구성 — 원자재(원단·원사 / 수지 원료), 시장(CAST·SPLINT), 부자재(파우치 / 박스).
   keys: 그 봇이 읽는 데이터 키(과거 3봇 형식 glass/materials도 매핑해 이력 유지) */
const RMI_BOTS = [
  { group: '🧱 원자재' },
  { id: 'rmi-fabric', kind: 'fabric', no: 1, icon: '🧵', title: '1번 봇 — 원단·원사', desc: 'E-GLASS · G-GLASS 유리섬유 원사, POLY 300D 폴리에스터 시장', keys: ['fabric', 'glass'] },
  { id: 'rmi-resin', kind: 'resin', no: 2, icon: '🧪', title: '2번 봇 — 수지 원료', desc: 'MDI · 폴리올 등 폴리우레탄 수지 원료 가격·수급', keys: ['resin', 'materials'] },
  { group: '🦴 캐스트 · 스프린트 시장' },
  { id: 'rmi-market', kind: 'market', no: 3, icon: '🦴', title: '3번 봇 — CAST·SPLINT 시장', desc: '정형외과 캐스트·스플린트 시장 동향·경쟁사·수출입', keys: ['market'] },
  { group: '📦 부자재' },
  { id: 'rmi-pouch', kind: 'pouch', no: 4, icon: '🛍️', title: '4번 봇 — 파우치', desc: '나일론 필름 · 알루미늄박 · LLDPE 포장 필름 시장', keys: ['pouch'] },
  { id: 'rmi-box', kind: 'box', no: 5, icon: '📦', title: '5번 봇 — 박스', desc: '골판지 원지(K·KLB·SC) · 박스 가격·수급', keys: ['box'] },
];
const RMI_SEL = {}; // 봇별 선택 날짜 (kind → date)
const RMI_NONE_RE = /새로운 이슈가 없습니다|새 이슈 없음|이슈 없음/; // 수집봇이 넣는 '소식 없음' 자리표시
const rmiItemsOf = (container, keys) => keys.flatMap((k) => (container && container[k]) || []);
const rmiIsNewFmt = (day) => ['fabric', 'resin', 'pouch', 'box'].some((k) => Array.isArray(day[k]));
const RMI_OLD_ADV = { 1: [1], 2: [3], 3: [2], 4: [], 5: [] }; // 과거 3봇 advice 번호 매핑
function rmiData() { try { return JSON.parse(localStorage.getItem(RMI_KEY)) || { days: [] }; } catch (e) { return { days: [] }; } }
/* 제안(advice)의 mats 키워드 → 우리 자재 매칭: 발주알림 집계(사용량·여유 포함) 우선, 없으면 재고 목록 */
function rmiAdvRows(mats) {
  const NN = (s) => String(s || '').toUpperCase().replace(/\s/g, '');
  const match = (name, code) => mats.some((k) => tokenAltsHit(String(k), NN(name) + '|' + NN(code)));
  const rows = alertRows().filter((r) => match(r.name, r.code));
  if (rows.length) return rows;
  return MATERIALS.filter((m) => match(m.name, m.newCode)).slice(0, 20)
    .map((m) => ({ name: m.name, code: m.newCode || '', unit: m.unit || '', stock: num(m.stock), avgUse: 0, cover: null, price: m.price != null ? num(m.price) : null }));
}
/* 제안 mats와 매칭되는 최근 발주 거래처 (업체 변경 검토 시 현재 상황 파악용) */
function rmiAdvSuppliers(mats) {
  const NN = (s) => String(s || '').toUpperCase().replace(/\s/g, '');
  const seen = {};
  ORDERS.filter((o) => mats.some((k) => tokenAltsHit(String(k), NN(o.item) + '|' + NN(o.spec))))
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1))
    .forEach((o) => {
      const s = (o.supplier || '').trim();
      if (!s || seen[s]) return;
      seen[s] = { sup: s, date: o.date || '', price: o.price };
    });
  return Object.values(seen).slice(0, 3);
}
function rmiBotHtml(cfg) {
  const { kind, keys, icon, title, desc } = cfg;
  const data = rmiData();
  const days = (data.days || []).slice()
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  const sel = RMI_SEL[kind] && days.some((d) => d.date === RMI_SEL[kind]) ? RMI_SEL[kind] : (days[0] && days[0].date);
  const day = days.find((d) => d.date === sel);
  const chips = days.slice(0, 10).map((d) =>
    `<button class="chip${d.date === sel ? ' active' : ''}" data-rmi-day="${d.date}" data-rmi-kind="${kind}">${d.date.slice(5).replace('-', '/')}</button>`).join('');
  // 수집 엔진 2원화: 기본(Claude 자동수집) + gpt(GPT 웹검색) — 같은 날을 나란히 비교
  const gp = day && day.gpt;
  const engClaude = (day && day.engine) || 'Claude 자동수집';
  const engGpt = gp && (gp.engine || 'GPT');
  // 💡 오늘의 제안: 두 AI의 제안을 합쳐 표시 (과거 3봇 형식의 번호는 매핑)
  const advNos = day ? (rmiIsNewFmt(day) ? [cfg.no] : RMI_OLD_ADV[cfg.no] || []) : [];
  const advs = day ? [
    ...(day.advice || []).map((a) => Object.assign({ eng: engClaude }, a)),
    ...((gp && gp.advice) || []).map((a) => Object.assign({ eng: engGpt }, a)),
  ].filter((a) => advNos.includes(a.bot)) : [];
  const advHtml = advs.length ? `<div class="rmi-adv-head">💡 오늘의 제안</div>` + advs.map((a) => {
    let dataLine = '', supLine = '';
    if (a.mats && a.mats.length) {
      const rows = rmiAdvRows(a.mats);
      if (rows.length) {
        const stock = rows.reduce((x, r) => x + num(r.stock), 0);
        const covs = rows.filter((r) => r.cover != null).map((r) => r.cover);
        dataLine = `<div class="rmi-adv-data">📊 우리 데이터: 관련 자재 <b>${fmt(rows.length)}종</b> · 현재고 합계 <b>${fmt(stock, 1)}</b>${covs.length ? ` · 최소 여유 <b>${Math.min(...covs).toFixed(1)}개월</b>` : ''}
          <button class="btn small primary" data-adv-mats="${esc(a.mats.join('|'))}">📝 발주서 작성</button></div>`;
      }
      const sup = rmiAdvSuppliers(a.mats);
      if (sup.length) supLine = `<div class="rmi-adv-data">🏭 현재 거래처: ${sup.map((s) => `<b>${esc(s.sup)}</b>${s.date ? ` <span class="muted">(최근 ${esc(s.date)}${s.price != null ? ' · ' + fmt(s.price) + '원' : ''})</span>` : ''}`).join(' · ')} <span class="muted">— 업체 변경 검토 시 비교 기준</span></div>`;
    }
    // 🔎 알아볼 곳: 수집 AI가 조사한 대체 업체·문의처
    const srcLine = (a.sourcing && a.sourcing.length) ? `<div class="rmi-adv-src">🔎 <b>알아볼 곳</b><br>${a.sourcing.map((s) => {
      const url = /^https?:\/\//.test(s.url || '') ? s.url : '';
      return `· ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : `<b>${esc(s.name)}</b>`}${s.why ? ` <span class="muted">— ${esc(s.why)}</span>` : ''}`;
    }).join('<br>')}</div>` : '';
    const lv = a.level || '정보';
    const cls = lv === '기회' ? 'ok' : lv === '주의' ? 'bad' : 'plain';
    return `<div class="rmi-adv"><span class="badge ${cls}">${esc(lv)}</span>
      <div class="rmi-adv-body"><b>${esc(a.t)}</b> <span class="rmi-model">${esc(a.eng)}</span><div class="rmi-sum">${esc(a.s)}</div>${dataLine}${supLine}${srcLine}</div></div>`;
  }).join('') : '';
  const itemHtml = (it) => {
    const url = /^https?:\/\//.test(it.url || '') ? it.url : '';
    return `
    <div class="rmi-msg">
      <div class="rmi-msg-head">
        <span class="badge ${/국내/.test(it.region || '') ? 'ok' : 'plain'}">${esc(it.region || '해외')}</span>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="rmi-title">${esc(it.t)}</a>` : `<span class="rmi-title">${esc(it.t)}</span>`}
      </div>
      <div class="rmi-sum">${esc(it.s || '')}</div>
      <div class="rmi-src">${esc(it.src || '')}${url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener">원문 보기 ↗</a>' : ''}</div>
    </div>`;
  };
  const groups = [];
  const real = (arr) => arr.filter((it) => it && it.t && !RMI_NONE_RE.test(it.t));
  if (day) {
    groups.push({ eng: '🟣 ' + engClaude, arr: real(rmiItemsOf(day, keys)) });
    const gArr = real(rmiItemsOf(gp, keys));
    if (gArr.length) groups.push({ eng: '🟢 ' + engGpt, arr: gArr });
  }
  const items = groups.filter((g) => g.arr.length).map((g) =>
    (groups.length > 1 ? `<div class="rmi-eng-head">${esc(g.eng)} 수집</div>` : '') + g.arr.map(itemHtml).join('')).join('');
  const engineLabel = day ? (engClaude + (engGpt ? ' + ' + engGpt : '')) : 'AI 자동수집';
  return `<div class="card rmi-bot" id="${cfg.id}">
    <div class="rmi-head"><span class="rmi-avatar">${icon}</span>
      <div><b>${title}</b> <span class="rmi-model" title="이 봇의 내용을 만든 AI (매일 08:20 자동수집, Claude와 GPT가 각각 수집)">${esc(engineLabel)}</span><div class="muted" style="font-size:12px">${desc}</div></div>
    </div>
    ${days.length ? `<div class="rmi-days">${chips}</div>` : ''}
    ${advHtml}
    <div class="rmi-msgs">${items || (day ? `<div class="rmi-none">📭 <b>새 이슈 없음</b><div class="muted" style="font-size:12.5px;margin-top:4px">${esc(day.date.slice(5).replace('-', '/'))} 기준 이 분야에 새로 나온 소식이 없습니다.</div></div>` : '') || `<div class="empty">아직 수집된 이슈가 없습니다.<br>매일 오전 08:20에 자동으로 수집·번역됩니다.<br><span class="muted" style="font-size:12px">(PC와 Claude 앱이 켜져 있어야 하며, 꺼져 있었다면 다음 실행 때 올라옵니다)</span></div>`}</div></div>`;
}
/* 제안의 [발주서 작성]: 관련 자재를 2개월분 제안 수량으로 발주서에 담는다 */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-adv-mats]');
  if (!b) return;
  const rows = rmiAdvRows(b.dataset.advMats.split('|'));
  if (!rows.length) { toast('관련 자재를 재고 목록에서 찾지 못했습니다'); return; }
  const items = rows.map((r) => ({
    name: r.name || r.code, unit: r.unit || '',
    qty: Math.ceil(Math.max(num(r.avgUse) * 2 - num(r.stock), num(r.avgUse))) || '',
    price: r.price != null ? r.price : '',
    due: '', note: (r.code ? r.code + ' · ' : '') + '이슈 대응 선발주',
  }));
  poNew(items, `제안 자재 ${items.length}종을 발주서에 담았습니다 — 수량(2개월분 제안치)과 단가를 확인하세요`);
});
function renderRmIssues() {
  const data = rmiData();
  $('#rmi-updated').textContent = data.updatedAt ? `마지막 수집: ${data.updatedAt}` : '';
  $('#rmi-wrap').innerHTML = RMI_BOTS.map((cfg) =>
    cfg.group ? `<div class="rmi-group-label">${esc(cfg.group)}</div>` : rmiBotHtml(cfg)).join('');
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-rmi-day]');
  if (!c) return;
  RMI_SEL[c.dataset.rmiKind] = c.dataset.rmiDay;
  renderRmIssues();
});

/* ===================== 제조원가 (공정분류 엑셀 기반 계산기) =====================
   기본값은 cost-seed.js(공정분류(26년).xlsx 추출). 흰 입력칸을 고치면 파란 계산칸이
   즉시 재계산된다. 수정값은 저장·동기화되며 [기본값 복원]으로 엑셀 원본에 되돌린다.
   계산식: 총비용=단가×수량, 합계=항목 합, Loss가=합계×1.1, 생산원가총합=Loss가+포장비 */
const COST_KEY = DB_PREFIX + 'cost';
let COST = null;
let COST_TAB = 'resin';
function costLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(COST_KEY));
    if (d && d.resinMaterials && d.cast) {
      // 원료명 변경 마이그레이션: LL → MDI (기존 저장분도 자동 반영)
      d.resinMaterials.forEach((m) => { if (m.n === 'LL') m.n = 'MDI'; });
      (d.variants || []).forEach((v) => { if (v.mat === 'LL') v.mat = 'MDI'; });
      // 정리 마이그레이션: 임시로 추가됐던 NHR-2000/NSR-200 수지 제거 (한겹은 기존 NSR-2000 사용)
      d.resinKinds = d.resinKinds.filter((k) => k.key !== 'nhr2000' && k.key !== 'nsr200');
      d.resinMaterials.forEach((m) => { delete m.mix.nhr2000; delete m.mix.nsr200; });
      if (d.resinLink && d.resinLink.splint) {
        Object.keys(d.resinLink.splint).forEach((g) => {
          if (d.resinLink.splint[g] === 'nhr2000' || d.resinLink.splint[g] === 'nsr200') d.resinLink.splint[g] = 'nsr2000';
        });
      }
      return d;
    }
  } catch (e) { }
  return JSON.parse(JSON.stringify(window.COST_SEED || { resinKinds: [], resinMaterials: [], cast: [], splint: [], precut: [] }));
}
/* 수지단가 실시간 연동: 수지 탭 합계(kg당 원가)를 CAST/SPLINT 그룹의 수지단가로 자동 사용.
   그룹별로 수지 종류 선택, ''(수동 입력)으로 끄면 저장된 숫자를 그대로 쓴다. */
function resinLinkKind(tab, gname) {
  if (!COST.resinLink) COST.resinLink = { cast: {}, splint: {} };
  if (!COST.resinLink[tab]) COST.resinLink[tab] = {};
  const t = COST.resinLink[tab];
  if (gname in t) return t[gname];
  if (tab === 'cast') return 'nhr4000';
  // SPLINT 기본: SP·NW·한겹 유리는 NSR-2000, 68TEX는 NHR-1000
  if (/한겹/.test(gname)) return 'nsr2000';
  return /68/.test(gname) ? 'nhr1000' : 'nsr2000';
}
function effRow(tab, gname, r) {
  if (tab !== 'cast' && tab !== 'splint') return r;
  const k = resinLinkKind(tab, gname);
  return k ? Object.assign({}, r, { resinP: resinTotal(k) }) : r;
}
/* 탭별로 선택 가능한 수지: CAST는 캐스트용 3종, SPLINT는 스프린트용 2종만 */
const RESIN_CHOICES = { cast: ['nhr4000', 'alpha', 'soft'], splint: ['nhr1000', 'nsr2000'] };
function resinLinkSelHtml(tab, gname) {
  const k = resinLinkKind(tab, gname);
  const kinds = COST.resinKinds.filter((x) => (RESIN_CHOICES[tab] || []).includes(x.key));
  const cur = kinds.find((x) => x.key === k);
  return `<span class="muted" style="font-size:12px;font-weight:400">수지 기준:</span>
    <select class="cost-rlink" data-rt="${tab}" data-rg="${esc(gname)}" title="이 그룹의 수지단가로 쓸 수지를 선택 — 수지 탭 합계가 실시간 반영됩니다">
      ${kinds.map((x) => `<option value="${x.key}"${x.key === k ? ' selected' : ''}>${esc(x.label)} (${esc(x.sub)})</option>`).join('')}
      <option value=""${k === '' ? ' selected' : ''}>수동 입력</option>
    </select>${cur ? ` <span class="cost-drv" style="padding:3px 8px" title="수지 탭에서 원료 단가를 바꾸면 여기도 즉시 반영">🔗 ${esc(cur.label)} ${cfN(resinTotal(k), 0)}원/kg</span>` : ''}`;
}
/* 대체 원료 시나리오: 특정 원료 단가만 바꿨을 때의 수지 kg당 원가 */
function resinTotalWith(key, matName, altPrice) {
  return COST.resinMaterials.reduce((a, m) => a + (m.n === matName ? altPrice : m.p) * (m.mix[key] || 0), 0);
}
function costSave() { localStorage.setItem(COST_KEY, JSON.stringify(COST)); }
const cfN = (v, d) => fmt(Math.round(v * 100) / 100, d == null ? 2 : d);
const cIn = (path, v, w) => `<input class="cell-edit cost-in" type="text" inputmode="decimal" style="width:${w || 72}px" value="${v == null || v === '' ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 6 })}" data-cp="${path}">`;
const cDrv = (v, d) => `<td class="num cost-drv">${cfN(v, d)}</td>`;
/* 행별 파생 계산 — 기본은 원부자재 원가(Loss 10% 포함)만, 인건비·생산비·포장비는 켤 때만 더한다.
   엑셀 원본은 인건비·생산비도 Loss 10% 대상이라 ×1.1 로 더하고, 포장비(설명서·박스·포장인건비)는
   CAST/SPLINT 에선 Loss 뒤에, PRECUT 에선 Loss 대상으로 더한다 → 세 가지를 모두 켜면 엑셀 생산원가총합과 같다. */
const COST_ADDONS = [['labor', '인건비'], ['prod', '생산비'], ['pack', '포장비']];
function costAddons() {
  if (!COST.addons) COST.addons = { labor: false, prod: false, pack: false };
  return COST.addons;
}
function costPick(c) {
  const a = costAddons();
  c.extra = (a.labor ? c.laborA : 0) + (a.prod ? c.prodA : 0) + (a.pack ? c.packA : 0);
  c.total = c.matLoss + c.extra;
  c.full = c.matLoss + c.laborA + c.prodA + c.packA;
  return c;
}
function castCalc(r) {
  const fabT = r.fab * r.need, resT = r.resinP * r.resinQ;
  const mat = fabT + resT + r.core + r.pouch;
  return costPick({ fabT, resT, mat, matLoss: mat * 1.1, laborA: r.labor * 1.1, prodA: r.prod * 1.1, packA: r.manual + r.inbox + r.outbox + r.packLabor });
}
function splintCalc(r) {
  const fabT = r.fab * r.need, resT = r.resinP * r.resinQ, padT = (r.padU + r.padD) * r.padN, pouchT = r.pouchP * r.pouchN;
  const mat = fabT + resT + padT + r.tape + pouchT;
  const c = costPick({ fabT, resT, padT, pouchT, mat, matLoss: mat * 1.1, laborA: r.labor * 1.1, prodA: r.prod * 1.1, packA: r.inbox + r.brown + r.outbox + r.manual + r.packLabor });
  const a = costAddons(); // M당가격 = 포장 전 원가 ÷ 필요량 (켠 인건비·생산비만 포함)
  c.perM = r.need ? (c.matLoss + (a.labor ? c.laborA : 0) + (a.prod ? c.prodA : 0)) / r.need : 0;
  return c;
}
function precutCalc(r) {
  const unit = r.need * r.mPrice, boxPer = r.inboxN ? r.inboxP / r.inboxN : 0, outPer = r.outboxN ? r.outboxP / r.outboxN : 0;
  const mat = unit + r.pouch;
  return costPick({ unit, boxPer, outPer, mat, matLoss: mat * 1.1, laborA: r.labor * 1.1, prodA: r.prod * 1.1, packA: (boxPer + outPer + r.manual) * 1.1 });
}
/* 추가 비용 칸: 꺼져 있으면 흐리게 */
const cAddTd = (k, inner) => `<td class="num cost-add${costAddons()[k] ? '' : ' cost-off'}">${inner}</td>`;
const cAddTh = (k, label) => `<th class="num cost-add${costAddons()[k] ? '' : ' cost-off'}">${label}</th>`;
const cFinal = (c) => `<td class="num cost-total">${cfN(c.total)}${c.extra >= 0.005 ? `<br><small class="cost-up">+${cfN(c.extra)}</small>` : ''}</td>`;
/* 상단 토글 바: 인건비·생산비·포장비를 켜면 얼마가 더해지는지 */
function costAddonBarHtml(tab) {
  const a = costAddons();
  const calc = { cast: castCalc, splint: splintCalc, precut: precutCalc }[tab];
  const all = [];
  COST[tab].forEach((gp) => gp.rows.forEach((r0) => all.push(calc(effRow(tab, gp.name, r0)))));
  if (tab === 'cast') { const bl = castBlendRows(); if (bl) bl.rows.forEach((r) => all.push(castCalc(r))); }
  const rng = (f) => { const v = all.map(f); const lo = Math.min(...v), hi = Math.max(...v); return Math.abs(hi - lo) < 0.5 ? `+${cfN(lo, 0)}원` : `+${cfN(lo, 0)}~${cfN(hi, 0)}원`; };
  const KEY = { labor: 'laborA', prod: 'prodA', pack: 'packA' };
  const packDesc = tab === 'precut' ? '설명서·인박스·아웃박스' : tab === 'splint' ? '인박스·브라운박스·아웃박스·설명서·포장인건비' : '설명서·인박스·아웃박스·포장인건비';
  const on = COST_ADDONS.filter(([k]) => a[k]).map(([, l]) => l);
  return `<div class="card cost-addbar">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13.5px">원가 기준:</b> <span class="cost-drv" style="padding:3px 8px">원부자재 원가 (Loss 10%)</span>
      ${COST_ADDONS.map(([k, l]) => `<button class="chip${a[k] ? ' active' : ''}" data-caddon="${k}" title="${k === 'pack' ? packDesc : l} — 켜면 원가에 더해집니다">${a[k] ? '✓' : '＋'} ${l} <small>${rng((c) => c[KEY[k]])}</small></button>`).join('')}
      <span class="spacer"></span>
      <button class="btn small" data-caddon="all">${on.length === 3 ? '모두 끄기' : '모두 켜기 (= 엑셀 생산원가총합)'}</button>
    </div>
    <p class="muted" style="margin-top:6px;font-size:12px">현재 표시: <b>원부자재${on.length ? ' + ' + on.join(' + ') : '만'}</b> · 추가 금액은 엑셀과 같이 인건비·생산비${tab === 'precut' ? '·포장비' : ''}에 Loss 10%를 붙여 계산 · 포장비 = ${packDesc}. 표의 흐린 칸은 아직 반영 안 된 항목(값은 그대로 수정 가능).</p>
  </div>`;
}
const resinTotal = (key) => COST.resinMaterials.reduce((a, m) => a + m.p * (m.mix[key] || 0), 0);
function renderCost() {
  if (!COST) COST = costLoad();
  $$('#page-cost [data-cost-tab]').forEach((c) => c.classList.toggle('active', c.dataset.costTab === COST_TAB));
  const kpi = $('#cost-kpi'), body = $('#cost-body'), note = $('#cost-note');
  if (COST_TAB === 'resin') {
    note.textContent = '시트: 수지 제조(신규_인상)2609 — 원료 단가·배합비(kg) 수정 가능';
    kpi.innerHTML = COST.resinKinds.map((k) => `
      <div class="kpi accent"><div class="k-label">${esc(k.label)} <small>${esc(k.sub)}</small></div><div class="k-value">${cfN(resinTotal(k.key), 0)}<small>원/kg</small></div><div class="k-sub">배합합 ${cfN(COST.resinMaterials.reduce((a, m) => a + (m.mix[k.key] || 0), 0), 4)}kg</div></div>`).join('');
    body.innerHTML = `<div class="card"><div class="table-wrap"><table><thead><tr>
      <th>원료</th><th class="num">단가 (원/kg)</th>${COST.resinKinds.map((k) => `<th class="num">${esc(k.label)}<br><small class="muted">배합(kg) · 금액</small></th>`).join('')}
    </tr></thead><tbody>
      ${COST.resinMaterials.map((m, i) => `<tr class="no-click">
        <td style="white-space:nowrap"><input class="cell-edit cost-mname" style="width:96px;text-align:left;font-weight:700" type="text" value="${esc(m.n)}" data-mi="${i}" title="원료명 수정"> <button class="btn small danger" data-mdel="${i}" title="원료 삭제">✕</button></td>
        <td class="num">${cIn(`resinMaterials.${i}.p`, m.p, 84)}</td>
        ${COST.resinKinds.map((k) => { const v = m.mix[k.key] || 0; return `<td class="num${v ? '' : ' cost-zero'}">${cIn(`resinMaterials.${i}.mix.${k.key}`, v, 70)} <span class="cost-drv">${v ? cfN(m.p * v) : '—'}</span></td>`; }).join('')}
      </tr>`).join('')}
      <tr class="iq-total"><td><b>합계 (원/kg)</b></td><td></td>${COST.resinKinds.map((k) => `<td class="num"><b>${cfN(resinTotal(k.key))}</b></td>`).join('')}</tr>
    </tbody></table></div>
    <button class="btn small" id="cost-mat-add" style="margin-top:8px">＋ 원료 추가</button>
    <p class="muted" style="margin-top:8px">💡 원료명은 칸을 클릭해 바로 고칠 수 있고, ✕로 삭제·[＋ 원료 추가]로 새 원료를 넣을 수 있습니다. 단가가 인상되면 해당 칸만 고치세요 — 5개 수지의 kg당 원가가 바로 재계산됩니다.</p></div>`
    + costVariantsHtml();
  } else if (COST_TAB === 'cast') {
    note.textContent = '시트: CAST제조 — 1~6인치 × 원단 3종 · 기본은 원부자재 원가, 인건비·생산비·포장비는 아래에서 켜서 추가';
    kpi.innerHTML = COST.cast.map((gp) => costKpiHtml(gp.name, gp.rows.map((r) => castCalc(effRow('cast', gp.name, r))), `1~${gp.rows.length}인치`)).join('') + (() => {
      const bl = castBlendRows();
      if (!bl) return '';
      return costKpiHtml(`🧵 합사 ${cfN(bl.r68, 0)}:${cfN(100 - bl.r68, 0)}`, bl.rows.map((r) => castCalc(r)), '68TEX+300D', 'green');
    })();
    body.innerHTML = costAddonBarHtml('cast') + COST.cast.map((gp, gi) => `<div class="card"><h3 style="margin-bottom:8px">${esc(gp.name)} <small class="muted">원단 기준</small> ${resinLinkSelHtml('cast', gp.name)}</h3>
      <div class="table-wrap"><table><thead>
        <tr class="cost-hgrp"><th colspan="11">원부자재</th><th colspan="6" class="cost-add">추가 비용 (선택)</th><th></th></tr>
        <tr>
        <th>인치</th><th class="num">원단단가</th><th class="num">필요량(M)</th><th class="num">원단비</th>
        <th class="num">수지단가</th><th class="num">수지량(kg)</th><th class="num">수지비</th>
        <th class="num">코어</th><th class="num">파우치</th>
        <th class="num">원부자재 합계</th><th class="num">원부자재 원가<br><small>Loss 10%</small></th>
        ${cAddTh('labor', '인건비')}${cAddTh('prod', '생산비')}${cAddTh('pack', '설명서')}${cAddTh('pack', '인박스')}${cAddTh('pack', '아웃박스')}${cAddTh('pack', '포장인건비')}
        <th class="num">반영 원가</th>
      </tr></thead><tbody>${gp.rows.map((r, ri) => { const er = effRow('cast', gp.name, r); const linked = er !== r; const c = castCalc(er); const P = `cast.${gi}.rows.${ri}`; return `<tr class="no-click">
        <td><b>${r.size}"</b></td>
        <td class="num">${cIn(P + '.fab', r.fab)}</td><td class="num">${cIn(P + '.need', r.need, 56)}</td>${cDrv(c.fabT)}
        <td class="num">${linked ? `<span class="cost-drv" title="수지 탭 합계 연동 — 그룹 제목의 선택을 '수동 입력'으로 바꾸면 직접 입력">🔗${cfN(er.resinP, 0)}</span>` : cIn(P + '.resinP', r.resinP, 84)}</td><td class="num">${cIn(P + '.resinQ', r.resinQ, 66)}</td>${cDrv(c.resT)}
        <td class="num">${cIn(P + '.core', r.core, 56)}</td><td class="num">${cIn(P + '.pouch', r.pouch, 56)}</td>
        ${cDrv(c.mat)}<td class="num cost-mat">${cfN(c.matLoss)}</td>
        ${cAddTd('labor', cIn(P + '.labor', r.labor, 56))}${cAddTd('prod', cIn(P + '.prod', r.prod, 66))}
        ${cAddTd('pack', cIn(P + '.manual', r.manual, 52))}${cAddTd('pack', cIn(P + '.inbox', r.inbox, 52))}${cAddTd('pack', cIn(P + '.outbox', r.outbox, 52))}${cAddTd('pack', cIn(P + '.packLabor', r.packLabor, 52))}
        ${cFinal(c)}
      </tr>`; }).join('')}</tbody></table></div></div>`).join('') + castBlendHtml() + costCompareHtml('cast');
  } else if (COST_TAB === 'splint') {
    note.textContent = '시트: SPLINT제조 — 1~6인치 × 원단 4종 (롤 기준) · 기본은 원부자재 원가, 인건비·생산비·포장비는 아래에서 켜서 추가';
    kpi.innerHTML = COST.splint.map((gp) => costKpiHtml(gp.name, gp.rows.map((r) => splintCalc(effRow('splint', gp.name, r))), '롤')).join('');
    body.innerHTML = costAddonBarHtml('splint') + COST.splint.map((gp, gi) => `<div class="card"><h3 style="margin-bottom:8px">${esc(gp.name)} ${resinLinkSelHtml('splint', gp.name)}</h3>
      <div class="table-wrap"><table><thead>
        <tr class="cost-hgrp"><th colspan="18">원부자재</th><th colspan="7" class="cost-add">추가 비용 (선택)</th><th></th></tr>
        <tr>
        <th>인치</th><th class="num">원단단가</th><th class="num">필요량(M)</th><th class="num">원단비</th>
        <th class="num">수지단가</th><th class="num">수지량(kg)</th><th class="num">수지비</th>
        <th class="num">패드 상</th><th class="num">패드 하</th><th class="num">패드량</th><th class="num">패드비</th>
        <th class="num">양면테이프</th><th class="num">파우치단가</th><th class="num">파우치량</th><th class="num">파우치비</th>
        <th class="num">원부자재 합계</th><th class="num">원부자재 원가<br><small>Loss 10%</small></th><th class="num">M당가격</th>
        ${cAddTh('labor', '인건비')}${cAddTh('prod', '생산비')}${cAddTh('pack', '인박스')}${cAddTh('pack', '브라운박스')}${cAddTh('pack', '아웃박스')}${cAddTh('pack', '설명서')}${cAddTh('pack', '포장인건비')}
        <th class="num">반영 원가</th>
      </tr></thead><tbody>${gp.rows.map((r, ri) => { const er = effRow('splint', gp.name, r); const linked = er !== r; const c = splintCalc(er); const P = `splint.${gi}.rows.${ri}`; return `<tr class="no-click">
        <td><b>${r.size}"</b></td>
        <td class="num">${cIn(P + '.fab', r.fab)}</td><td class="num">${cIn(P + '.need', r.need, 52)}</td>${cDrv(c.fabT)}
        <td class="num">${linked ? `<span class="cost-drv" title="수지 탭 합계 연동 — 그룹 제목의 선택을 '수동 입력'으로 바꾸면 직접 입력">🔗${cfN(er.resinP, 0)}</span>` : cIn(P + '.resinP', r.resinP, 84)}</td><td class="num">${cIn(P + '.resinQ', r.resinQ, 66)}</td>${cDrv(c.resT)}
        <td class="num">${cIn(P + '.padU', r.padU, 62)}</td><td class="num">${cIn(P + '.padD', r.padD, 62)}</td><td class="num">${cIn(P + '.padN', r.padN, 48)}</td>${cDrv(c.padT)}
        <td class="num">${cIn(P + '.tape', r.tape, 58)}</td><td class="num">${cIn(P + '.pouchP', r.pouchP, 58)}</td><td class="num">${cIn(P + '.pouchN', r.pouchN, 48)}</td>${cDrv(c.pouchT)}
        ${cDrv(c.mat)}<td class="num cost-mat">${cfN(c.matLoss)}</td>${cDrv(c.perM)}
        ${cAddTd('labor', cIn(P + '.labor', r.labor, 58))}${cAddTd('prod', cIn(P + '.prod', r.prod, 68))}
        ${cAddTd('pack', cIn(P + '.inbox', r.inbox, 56))}${cAddTd('pack', cIn(P + '.brown', r.brown, 56))}${cAddTd('pack', cIn(P + '.outbox', r.outbox, 56))}${cAddTd('pack', cIn(P + '.manual', r.manual, 52))}${cAddTd('pack', cIn(P + '.packLabor', r.packLabor, 52))}
        ${cFinal(c)}
      </tr>`; }).join('')}</tbody></table></div></div>`).join('') + costCompareHtml('splint');
  } else {
    note.textContent = '시트: PRECUT제조 — 규격 9종 × 원단 3종 (수지단가는 m당 가격에 포함된 구조라 별도 연동 칸이 없습니다) · 기본은 원부자재 원가';
    kpi.innerHTML = COST.precut.map((gp) => costKpiHtml(gp.name, gp.rows.map((r) => precutCalc(r)), '규격별')).join('');
    body.innerHTML = costAddonBarHtml('precut') + COST.precut.map((gp, gi) => `<div class="card"><h3 style="margin-bottom:8px">${esc(gp.name)}</h3>
      <div class="table-wrap"><table><thead>
        <tr class="cost-hgrp"><th colspan="7">원부자재</th><th colspan="9" class="cost-add">추가 비용 (선택)</th><th></th></tr>
        <tr>
        <th>규격</th><th class="num">필요량(m)</th><th class="num">m당 가격</th><th class="num">제품당 원가</th>
        <th class="num">파우치</th><th class="num">원부자재 합계</th><th class="num">원부자재 원가<br><small>Loss 10%</small></th>
        ${cAddTh('labor', '인건비')}${cAddTh('prod', '생산비')}
        ${cAddTh('pack', '인박스가')}${cAddTh('pack', '박스당 개수')}${cAddTh('pack', '박스비/개')}
        ${cAddTh('pack', '아웃박스가')}${cAddTh('pack', '아웃박스 개수')}${cAddTh('pack', '아웃박스비/개')}${cAddTh('pack', '설명서')}
        <th class="num">반영 원가</th>
      </tr></thead><tbody>${gp.rows.map((r, ri) => { const c = precutCalc(r); const P = `precut.${gi}.rows.${ri}`; return `<tr class="no-click">
        <td><b>${r.size}</b></td>
        <td class="num">${cIn(P + '.need', r.need, 52)}</td><td class="num">${cIn(P + '.mPrice', r.mPrice, 84)}</td>${cDrv(c.unit)}
        <td class="num">${cIn(P + '.pouch', r.pouch, 56)}</td>${cDrv(c.mat)}<td class="num cost-mat">${cfN(c.matLoss)}</td>
        ${cAddTd('labor', cIn(P + '.labor', r.labor, 56))}${cAddTd('prod', cIn(P + '.prod', r.prod, 64))}
        ${cAddTd('pack', cIn(P + '.inboxP', r.inboxP, 60))}${cAddTd('pack', cIn(P + '.inboxN', r.inboxN, 48))}${cAddTd('pack', `<span class="cost-drv">${cfN(c.boxPer)}</span>`)}
        ${cAddTd('pack', cIn(P + '.outboxP', r.outboxP, 60))}${cAddTd('pack', cIn(P + '.outboxN', r.outboxN, 48))}${cAddTd('pack', `<span class="cost-drv">${cfN(c.outPer)}</span>`)}${cAddTd('pack', cIn(P + '.manual', r.manual, 52))}
        ${cFinal(c)}
      </tr>`; }).join('')}</tbody></table></div></div>`).join('') + costCompareHtml('precut');
  }
}
/* KPI: 원부자재 원가 범위 + (추가 비용을 켰으면) 반영 원가 범위 */
function costKpiHtml(label, cs, unit, cls) {
  const rg = (v) => { const lo = Math.min(...v), hi = Math.max(...v); return `${cfN(lo, 0)}~${cfN(hi, 0)}`; };
  const anyOn = cs.some((c) => c.extra >= 0.005);
  return `<div class="kpi ${cls || 'accent'}"><div class="k-label">${esc(label)}</div><div class="k-value">${rg(cs.map((c) => c.total))}<small>원</small></div><div class="k-sub">${anyOn ? `원부자재만 ${rg(cs.map((c) => c.matLoss))}원 · 추가 +${rg(cs.map((c) => c.extra))}` : `${unit} 원부자재 원가 (Loss 10%)`}</div></div>`;
}
/* CAST 합사(68TEX+300D): 혼합 비율대로 원단단가·수지 흡수량을 섞어 인치별 원가 산출.
   코어·파우치·인건비 등 공통 항목은 68TEX 행 값을 그대로 쓰고, 본표(68TEX·300D)를 고치면 합사도 따라간다. */
function castBlendRows() {
  const g68 = COST.cast.find((g) => /68/.test(g.name));
  const g3 = COST.cast.find((g) => /300/.test(g.name));
  if (!g68 || !g3) return null;
  const r68 = Math.min(100, Math.max(0, num((COST.castBlend || {}).r68 ?? 50)));
  const w68 = r68 / 100, w3 = 1 - w68;
  const resinKind = (COST.castBlend || {}).resin || 'nhr4000'; // 합사 수지 기준 (기본 NHR-4000)
  const resinP = resinTotal(resinKind);
  return {
    r68, resinKind, resinP,
    rows: g68.rows.map((a0) => {
      const a = effRow('cast', g68.name, a0);
      const b0 = g3.rows.find((x) => x.size === a0.size) || a0;
      const b = effRow('cast', g3.name, b0);
      return Object.assign({}, a, {
        fab: a.fab * w68 + b.fab * w3,
        resinQ: a.resinQ * w68 + b.resinQ * w3,
        resinP,
      });
    }),
  };
}
function castBlendHtml() {
  if (!COST.castBlend) COST.castBlend = { r68: 50 };
  const bl = castBlendRows();
  if (!bl) return '';
  return `<div class="card"><h3 style="margin-bottom:4px">🧵 68TEX + 300D 합사</h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <span class="muted" style="font-size:13px">혼합 비율:</span>
      <b>68TEX</b> ${cIn('castBlend.r68', bl.r68, 56)} <span class="muted">%</span>
      <span class="muted">+</span> <b>300D</b> <span class="cost-drv" style="padding:4px 8px">${cfN(100 - bl.r68, 1)}%</span>
      <span class="muted" style="margin-left:8px;font-size:12px">수지 기준:</span>
      <select class="cost-blresin" title="합사에 쓸 수지 — 수지 탭 합계가 실시간 반영됩니다">
        ${COST.resinKinds.filter((x) => RESIN_CHOICES.cast.includes(x.key)).map((x) => `<option value="${x.key}"${x.key === bl.resinKind ? ' selected' : ''}>${esc(x.label)} (${esc(x.sub)})</option>`).join('')}
      </select>
      <span class="cost-drv" style="padding:3px 8px">🔗 ${cfN(bl.resinP, 0)}원/kg</span>
      <span class="muted" style="font-size:12px">— 원단단가·수지 흡수량이 비율대로 섞여 계산됩니다. 코어·파우치·인건비 등은 68TEX 기준.</span>
    </div>
    <div class="table-wrap"><table><thead>
      <tr class="cost-hgrp"><th colspan="11">원부자재</th><th colspan="3" class="cost-add">추가 비용 (선택)</th><th></th></tr>
      <tr>
      <th>인치</th><th class="num">합사 원단단가</th><th class="num">필요량(M)</th><th class="num">원단비</th>
      <th class="num">수지단가</th><th class="num">합사 수지량(kg)</th><th class="num">수지비</th>
      <th class="num">코어</th><th class="num">파우치</th>
      <th class="num">원부자재 합계</th><th class="num">원부자재 원가<br><small>Loss 10%</small></th>
      ${cAddTh('labor', '인건비')}${cAddTh('prod', '생산비')}${cAddTh('pack', '포장비')}
      <th class="num">반영 원가</th>
    </tr></thead><tbody>${bl.rows.map((r) => { const c = castCalc(r); const pack = r.manual + r.inbox + r.outbox + r.packLabor; return `<tr class="no-click">
      <td><b>${r.size}"</b></td>
      ${cDrv(r.fab)}<td class="num">${cfN(r.need, 1)}</td>${cDrv(c.fabT)}
      <td class="num">${cfN(r.resinP, 0)}</td>${cDrv(r.resinQ, 4)}${cDrv(c.resT)}
      <td class="num">${cfN(r.core, 1)}</td><td class="num">${cfN(r.pouch, 0)}</td>
      ${cDrv(c.mat)}<td class="num cost-mat">${cfN(c.matLoss)}</td>
      ${cAddTd('labor', cfN(r.labor, 0))}${cAddTd('prod', cfN(r.prod))}${cAddTd('pack', cfN(pack))}
      ${cFinal(c)}
    </tr>`; }).join('')}</tbody></table></div>
    <p class="muted" style="margin-top:8px">💡 68TEX·300D 본표의 단가를 고치면 합사 원가도 자동으로 따라갑니다. 비율을 바꿔가며(예: 70:30, 50:50, 30:70) 원가를 비교해 보세요.</p></div>`;
}
/* CAST/SPLINT/PRECUT 원가 변동 비교: 항목별 %·원 증감 시나리오 → 전 사이즈 원가 변화 비교 */
const COST_FIELDS = {
  cast: [['fab', '원단단가'], ['resinP', '수지단가'], ['core', '코어'], ['pouch', '파우치'], ['labor', '인건비'], ['inbox', '인박스'], ['outbox', '아웃박스']],
  splint: [['fab', '원단단가'], ['resinP', '수지단가'], ['padU', '패드 상'], ['padD', '패드 하'], ['tape', '양면테이프'], ['pouchP', '파우치단가'], ['labor', '인건비'], ['inbox', '인박스'], ['brown', '브라운박스'], ['outbox', '아웃박스']],
  precut: [['mPrice', 'm당 가격'], ['pouch', '파우치'], ['inboxP', '인박스가'], ['outboxP', '아웃박스가'], ['labor', '인건비'], ['manual', '설명서']],
};
const COST_CALC = { cast: (r) => castCalc(r).total, splint: (r) => splintCalc(r).total, precut: (r) => precutCalc(r).total };
function costCompareHtml(tab) {
  if (!COST.cvars) COST.cvars = {};
  if (!COST.cvars[tab]) COST.cvars[tab] = [];
  const groups = COST[tab];
  const fields = COST_FIELDS[tab];
  const calc = COST_CALC[tab];
  const rows = COST.cvars[tab].map((v, i) => {
    const fl = (fields.find((f) => f[0] === v.f) || fields[0])[1];
    const targets = v.g === '전체' ? groups : groups.filter((gp) => gp.name === v.g);
    const mini = targets.map((gp) => `<div class="table-wrap" style="margin-top:6px"><table><thead><tr>
        <th>${esc(gp.name)}</th>${gp.rows.map((r) => `<th class="num">${esc(String(r.size))}${tab === 'precut' ? '' : '"'}</th>`).join('')}
      </tr></thead><tbody>
        <tr class="no-click"><td class="muted">현재</td>${gp.rows.map((r0) => `<td class="num">${cfN(calc(effRow(tab, gp.name, r0)), 0)}</td>`).join('')}</tr>
        <tr class="no-click"><td><b>변경 후</b></td>${gp.rows.map((r0) => {
          const r = effRow(tab, gp.name, r0);
          const p = Object.assign({}, r);
          p[v.f] = v.mode === 'pct' ? num(r[v.f]) * (1 + num(v.v) / 100) : num(r[v.f]) + num(v.v);
          const alt = calc(p), d = alt - calc(r);
          return `<td class="num"><b>${cfN(alt, 0)}</b><br>${Math.abs(d) < 0.5 ? '<span class="muted">±0</span>' : d > 0 ? `<span class="cost-up">▲${cfN(d, 0)}</span>` : `<span class="cost-down">▼${cfN(-d, 0)}</span>`}</td>`;
        }).join('')}</tr>
      </tbody></table></div>`).join('');
    return `<div class="cost-cvar">
      <div class="cost-cvar-def">
        <select class="cost-cvsel" data-ct="${tab}" data-ci="${i}" data-ck="g"><option${v.g === '전체' ? ' selected' : ''}>전체</option>${groups.map((gp) => `<option${gp.name === v.g ? ' selected' : ''}>${esc(gp.name)}</option>`).join('')}</select>
        <select class="cost-cvsel" data-ct="${tab}" data-ci="${i}" data-ck="f">${fields.map((f) => `<option value="${f[0]}"${f[0] === v.f ? ' selected' : ''}>${f[1]}</option>`).join('')}</select>
        <select class="cost-cvsel" data-ct="${tab}" data-ci="${i}" data-ck="mode"><option value="pct"${v.mode === 'pct' ? ' selected' : ''}>% 증감</option><option value="abs"${v.mode !== 'pct' ? ' selected' : ''}>원 증감</option></select>
        ${cIn(`cvars.${tab}.${i}.v`, v.v, 76)} <span class="muted">${v.mode === 'pct' ? '% (인하는 −)' : '원 (인하는 −)'}</span>
        <span class="spacer"></span>
        <span style="font-size:12.5px"><b>${esc(v.g)}</b> · ${esc(fl)} ${num(v.v) >= 0 ? '+' : ''}${fmt(num(v.v))}${v.mode === 'pct' ? '%' : '원'}</span>
        <button class="btn small danger" data-cvdel="${tab}|${i}">✕</button>
      </div>${mini}</div>`;
  }).join('');
  return `<div class="card"><h3 style="margin-bottom:4px">🔁 원가 변동 비교</h3>
    <p class="muted" style="margin-bottom:8px">원사·원료 가격이 출렁일 때 — "원단단가 +10%", "파우치 +30원"처럼 시나리오를 등록하면
    전 사이즈의 반영 원가(위 원가 기준 그대로) 변화가 바로 비교됩니다. 인건비·포장 항목 시나리오는 해당 비용을 켜야 반영됩니다. (본표 값은 바뀌지 않습니다)</p>
    ${rows || '<p class="muted">아직 시나리오가 없습니다 — [＋ 시나리오 추가]를 눌러 등록하세요.</p>'}
    <button class="btn small" data-cvadd="${tab}" style="margin-top:8px">＋ 시나리오 추가</button></div>`;
}
document.addEventListener('click', (e) => {
  const ad = e.target.closest('[data-caddon]');
  if (ad) { // 인건비·생산비·포장비 반영 토글
    const a = costAddons(), k = ad.dataset.caddon;
    if (k === 'all') { const v = !COST_ADDONS.every(([x]) => a[x]); COST_ADDONS.forEach(([x]) => { a[x] = v; }); }
    else a[k] = !a[k];
    costSave(); renderCost(); return;
  }
  const add = e.target.closest('[data-cvadd]');
  if (add) {
    const tab = add.dataset.cvadd;
    if (!COST.cvars) COST.cvars = {};
    if (!COST.cvars[tab]) COST.cvars[tab] = [];
    COST.cvars[tab].push({ g: '전체', f: COST_FIELDS[tab][0][0], mode: 'pct', v: 10 });
    costSave(); renderCost(); return;
  }
  const del = e.target.closest('[data-cvdel]');
  if (del) {
    const [tab, i] = del.dataset.cvdel.split('|');
    COST.cvars[tab].splice(+i, 1);
    costSave(); renderCost();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains('cost-blresin')) { // 합사 수지 기준 선택
    if (!COST.castBlend) COST.castBlend = { r68: 50 };
    COST.castBlend.resin = t.value;
    costSave(); renderCost(); return;
  }
  if (t.classList && t.classList.contains('cost-rlink')) { // 수지단가 연동 선택
    if (!COST.resinLink) COST.resinLink = { cast: {}, splint: {} };
    if (!COST.resinLink[t.dataset.rt]) COST.resinLink[t.dataset.rt] = {};
    COST.resinLink[t.dataset.rt][t.dataset.rg] = t.value;
    costSave(); renderCost(); return;
  }
  if (!t.classList || !t.classList.contains('cost-cvsel')) return;
  const v = COST.cvars[t.dataset.ct][+t.dataset.ci];
  v[t.dataset.ck] = t.value;
  costSave(); renderCost();
});
/* 대체 원료 비교: LL→LL1/LL2/LL3처럼 단가가 다른 대체안을 등록해 수지 원가를 나란히 비교 */
function costVariantsHtml() {
  if (!COST.variants) COST.variants = [];
  const kinds = COST.resinKinds;
  const rows = COST.variants.map((v, i) => {
    const base = COST.resinMaterials.find((m) => m.n === v.mat);
    const cells = kinds.map((k) => {
      if (!base || !(base.mix[k.key] > 0)) return `<td class="num cost-zero">—</td>`;
      const cur = resinTotal(k.key);
      const alt = resinTotalWith(k.key, v.mat, num(v.p));
      const d = alt - cur;
      const badge = Math.abs(d) < 0.005 ? '<span class="muted">±0</span>'
        : d > 0 ? `<span class="cost-up">▲${cfN(d)}</span>` : `<span class="cost-down">▼${cfN(-d)}</span>`;
      return `<td class="num"><b>${cfN(alt)}</b><br>${badge}</td>`;
    }).join('');
    return `<tr class="no-click">
      <td><select class="cost-vmat" data-vi="${i}">${COST.resinMaterials.map((m) => `<option${m.n === v.mat ? ' selected' : ''}>${esc(m.n)}</option>`).join('')}</select></td>
      <td><input class="cell-edit cost-vname" style="width:90px;text-align:left" type="text" value="${esc(v.name || '')}" data-vi="${i}" placeholder="예: LL1"></td>
      <td class="num">${cIn(`variants.${i}.p`, v.p, 84)}<br><span class="muted" style="font-size:11px">현재 ${base ? fmt(base.p) : '-'}원</span></td>
      ${cells}
      <td style="white-space:nowrap"><button class="btn small primary" data-vapply="${i}" title="이 단가를 본표에 반영">적용</button> <button class="btn small danger" data-vdel="${i}">✕</button></td>
    </tr>`;
  }).join('');
  return `<div class="card"><h3 style="margin-bottom:4px">🔁 대체 원료 비교</h3>
    <p class="muted" style="margin-bottom:10px">원료·원사 가격이 일정하지 않을 때 — 같은 원료의 대체 단가(예: LL → LL1, LL2, LL3)를 등록하면
    그 단가로 바꿨을 때의 수지 kg당 원가와 현재 대비 차이를 나란히 비교합니다. 마음에 드는 안은 [적용]으로 본표에 반영하세요.</p>
    <div class="table-wrap"><table><thead><tr>
      <th>대상 원료</th><th>대체안 이름</th><th class="num">대체 단가</th>
      ${kinds.map((k) => `<th class="num">${esc(k.label)}<br><small class="muted">kg당 원가 · 증감</small></th>`).join('')}<th></th>
    </tr></thead><tbody>
      <tr class="iq-total"><td colspan="2"><b>현재 기준</b></td><td></td>${kinds.map((k) => `<td class="num"><b>${cfN(resinTotal(k.key))}</b></td>`).join('')}<td></td></tr>
      ${rows || `<tr><td colspan="${4 + kinds.length}" class="muted" style="padding:14px">아직 대체안이 없습니다 — 아래 [＋ 대체안 추가]를 눌러 등록하세요.</td></tr>`}
    </tbody></table></div>
    <button class="btn small" id="cost-var-add" style="margin-top:8px">＋ 대체안 추가</button></div>`;
}
/* 원료 이름 수정 · 추가 · 삭제 */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('cost-mname')) return;
  const m = COST.resinMaterials[+t.dataset.mi];
  const old = m.n, nw = t.value.trim();
  if (!nw) { toast('원료명은 비울 수 없습니다'); renderCost(); return; }
  m.n = nw;
  (COST.variants || []).forEach((v) => { if (v.mat === old) v.mat = nw; }); // 대체안 연결 유지
  costSave(); renderCost();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#cost-mat-add')) {
    const mix = {};
    COST.resinKinds.forEach((k) => { mix[k.key] = 0; });
    COST.resinMaterials.push({ n: '새 원료', p: 0, mix });
    costSave(); renderCost();
    toast('원료를 추가했습니다 — 이름·단가·배합비를 입력하세요');
    return;
  }
  const md = e.target.closest('[data-mdel]');
  if (md) {
    const i = +md.dataset.mdel;
    const m = COST.resinMaterials[i];
    COST.resinMaterials.splice(i, 1);
    COST.variants = (COST.variants || []).filter((v) => v.mat !== m.n);
    costSave(); renderCost();
    toast(`원료 "${m.n}"을(를) 삭제했습니다 — 되돌리려면 [기본값 복원]`);
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#cost-var-add')) {
    if (!COST.variants) COST.variants = [];
    const first = COST.resinMaterials[0];
    COST.variants.push({ mat: first ? first.n : '', name: '', p: first ? first.p : 0 });
    costSave(); renderCost(); return;
  }
  const del = e.target.closest('[data-vdel]');
  if (del) { COST.variants.splice(+del.dataset.vdel, 1); costSave(); renderCost(); return; }
  const ap = e.target.closest('[data-vapply]');
  if (ap) {
    const v = COST.variants[+ap.dataset.vapply];
    const m = COST.resinMaterials.find((x) => x.n === v.mat);
    if (!m) { toast('대상 원료를 찾지 못했습니다'); return; }
    m.p = num(v.p);
    costSave(); renderCost();
    toast(`${v.mat} 단가를 ${fmt(num(v.p))}원(${v.name || '대체안'})으로 본표에 반영했습니다`);
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains('cost-vmat')) {
    COST.variants[+t.dataset.vi].mat = t.value;
    costSave(); renderCost(); return;
  }
  if (t.classList && t.classList.contains('cost-vname')) {
    COST.variants[+t.dataset.vi].name = t.value;
    costSave(); return;
  }
});
/* 입력 반영: blur/enter 시 저장 + 재계산 */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('cost-in')) return;
  const seg = t.dataset.cp.split('.');
  let o = COST;
  for (let i = 0; i < seg.length - 1; i++) o = o[seg[i]];
  const v = Number(String(t.value).replace(/,/g, ''));
  o[seg[seg.length - 1]] = isFinite(v) ? v : 0;
  costSave();
  renderCost();
});
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-cost-tab]');
  if (tab) { COST_TAB = tab.dataset.costTab; renderCost(); }
});
$('#cost-reset').addEventListener('click', () => {
  localStorage.removeItem(COST_KEY);
  COST = null;
  renderCost();
  toast('제조원가를 엑셀 원본 기본값으로 복원했습니다');
});
$('#cost-xlsx-out').addEventListener('click', () => {
  if (typeof XLSX === 'undefined') { toast('엑셀 모듈 로딩 중'); return; }
  const wb = XLSX.utils.book_new();
  const r2 = (v) => Math.round(v * 100) / 100;
  // 수지
  const rz = [['원료', '단가(원/kg)'].concat(COST.resinKinds.flatMap((k) => [k.label + ' 배합', k.label + ' 금액']))];
  COST.resinMaterials.forEach((m) => rz.push([m.n, m.p].concat(COST.resinKinds.flatMap((k) => [m.mix[k.key] || 0, r2(m.p * (m.mix[k.key] || 0))]))));
  rz.push(['합계', ''].concat(COST.resinKinds.flatMap((k) => ['', r2(resinTotal(k.key))])));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rz), '수지');
  // 원가 기준 표시 (켠 추가 비용) — 원부자재 원가 → 추가 비용 → 반영 원가 / 전체 포함(=엑셀 생산원가총합)
  const on = COST_ADDONS.filter(([k]) => costAddons()[k]).map(([, l]) => l).join('+') || '원부자재만';
  const TAIL = ['인건비추가', '생산비추가', '포장비추가', `반영원가(${on})`, '생산원가총합(전체포함)'];
  const tail = (c) => [r2(c.laborA), r2(c.prodA), r2(c.packA), r2(c.total), r2(c.full)];
  // CAST
  const ca = [['원단', '인치', '원단단가', '필요량', '원단비', '수지단가', '수지량', '수지비', '코어', '파우치', '원부자재합계', '원부자재원가(Loss10%)', '인건비', '생산비', '설명서', '인박스', '아웃박스', '포장인건비'].concat(TAIL)];
  COST.cast.forEach((gp) => gp.rows.forEach((r0) => { const r = effRow('cast', gp.name, r0); const c = castCalc(r); ca.push([gp.name, r.size, r.fab, r.need, r2(c.fabT), r2(r.resinP), r.resinQ, r2(c.resT), r.core, r.pouch, r2(c.mat), r2(c.matLoss), r.labor, r.prod, r.manual, r.inbox, r.outbox, r.packLabor].concat(tail(c))); }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ca), 'CAST제조');
  // SPLINT
  const sp = [['원단', '인치', '원단단가', '필요량', '원단비', '수지단가', '수지량', '수지비', '패드상', '패드하', '패드량', '패드비', '양면테이프', '파우치단가', '파우치량', '파우치비', '원부자재합계', '원부자재원가(Loss10%)', 'M당가격', '인건비', '생산비', '인박스', '브라운박스', '아웃박스', '설명서', '포장인건비'].concat(TAIL)];
  COST.splint.forEach((gp) => gp.rows.forEach((r0) => { const r = effRow('splint', gp.name, r0); const c = splintCalc(r); sp.push([gp.name, r.size, r.fab, r.need, r2(c.fabT), r2(r.resinP), r.resinQ, r2(c.resT), r.padU, r.padD, r.padN, r2(c.padT), r.tape, r.pouchP, r.pouchN, r2(c.pouchT), r2(c.mat), r2(c.matLoss), r2(c.perM), r.labor, r.prod, r.inbox, r.brown, r.outbox, r.manual, r.packLabor].concat(tail(c))); }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sp), 'SPLINT제조');
  // PRECUT
  const pc = [['원단', '규격', '필요량', 'm당가격', '제품당원가', '파우치', '원부자재합계', '원부자재원가(Loss10%)', '인건비', '생산비', '인박스가', '박스당개수', '박스비/개', '아웃박스가', '아웃박스개수', '아웃박스비/개', '설명서'].concat(TAIL)];
  COST.precut.forEach((gp) => gp.rows.forEach((r) => { const c = precutCalc(r); pc.push([gp.name, r.size, r.need, r.mPrice, r2(c.unit), r.pouch, r2(c.mat), r2(c.matLoss), r.labor, r.prod, r.inboxP, r.inboxN, r2(c.boxPer), r.outboxP, r.outboxN, r2(c.outPer), r.manual].concat(tail(c))); }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pc), 'PRECUT제조');
  XLSX.writeFile(wb, `제조원가_${todayStr()}.xlsx`);
});

/* ===================== CSV 내보내기 ===================== */
$('#btn-csv-materials').addEventListener('click', () => {
  const adequate = matAdequateMap();
  downloadCsv(`원부자재재고_${MAT_DIV}_${todayStr()}.csv`,
    ['구분', '대분류', '품목명', '신규이름', '신규코드', '단위', '적정재고', '당월 재고', '당월 단가', '당월 금액', '장소', '조사자', '비고'],
    filteredMaterials().map((m) => [m.division || '부목', m.category, m.name, m.newName, m.newCode, m.unit, adequate(m) ?? '', m.stock, m.price, matAmount(m) || '', m.place, m.inspector || '차훈', m.note]));
});
$('#btn-csv-finished').addEventListener('click', () => {
  const scopeKo = FIN_SCOPE === 'dom' ? '내수' : '수출';
  const rows = FINISHED.filter((f) => (f.scope || '내수') === scopeKo);
  if (FIN_SCOPE === 'dom') {
    downloadCsv(`완제품재고_내수_${todayStr()}.csv`,
      ['제품군', '브랜드', 'Type', '기재', 'Color', '제품코드', '현재고', '안전재고', '과부족'],
      rows.map((f) => [f.group, f.brand, f.type, f.base, f.color, f.code, f.qty, f.safety, num(f.safety) ? num(f.qty) - num(f.safety) : '']));
  } else {
    downloadCsv(`완제품재고_수출_${todayStr()}.csv`,
      ['해외거래처', '차수/비고', '제품군', 'Type', '기재', 'Color', '제품코드', '수량'],
      rows.map((f) => [f.supplier, f.lot, f.group, f.type, f.base, f.color, f.code, f.qty]));
  }
});
$('#btn-csv-orders').addEventListener('click', () => {
  downloadCsv(`발주내역_${todayStr()}.csv`,
    ['발주일', '거래처', '품명', '규격', '단위', '수량', '단가', '금액', '납기', '입고일', '입고수량', '입고상태', '비고'],
    filteredOrders().map((o) => [o.date, o.supplier, o.item, o.spec, o.unit, o.qty, o.price, orderAmount(o) || '', o.due, o.inDate, o.inQty, o.status || '미입고', o.note]));
});

/* ===================== 필터 · 서브탭 이벤트 ===================== */
$$('#fin-toggle button').forEach((b) => b.addEventListener('click', () => setFinScope(b.dataset.fin)));
$('#m-search').addEventListener('input', renderMaterials);
$$('#mat-div-toggle button').forEach((b) => b.addEventListener('click', () => setMatDiv(b.dataset.div)));
/* 대분류 칩 (동적 생성 → 위임) */
$('#m-cats').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  MAT_CAT = b.dataset.cat;
  renderMaterials();
});
['fd-search', 'fd-short', 'fe-sup', 'fe-search'].forEach((id) => $('#' + id).addEventListener('input', renderFinished));
/* 제품군 칩 (한눈에 클릭) */
$$('#fd-groups .chip').forEach((b) => b.addEventListener('click', () => {
  FIN_GROUP = b.dataset.g;
  $$('#fd-groups .chip').forEach((c) => c.classList.toggle('active', c === b));
  renderFinished();
}));
['o-from', 'o-to', 'o-sup', 'o-state', 'o-search'].forEach((id) => $('#' + id).addEventListener('input', renderOrders));
$('#m-reset').addEventListener('click', () => { MAT_CAT = ''; $('#m-search').value = ''; renderMaterials(); });
$('#fd-reset').addEventListener('click', () => {
  FIN_GROUP = '';
  $$('#fd-groups .chip').forEach((c) => c.classList.toggle('active', c.dataset.g === ''));
  $('#fd-search').value = '';
  $('#fd-short').checked = false;
  renderFinished();
});
$('#fe-reset').addEventListener('click', () => { ['fe-sup', 'fe-search'].forEach((id) => ($('#' + id).value = '')); renderFinished(); });
$('#o-reset').addEventListener('click', () => { ['o-from', 'o-to', 'o-sup', 'o-state', 'o-search'].forEach((id) => ($('#' + id).value = '')); renderOrders(); });

/* ===================== 홈: 구매 종합 현황 브리핑 =====================
   발주 알림·발주내역·입고·출고 데이터를 모아 접속하자마자 처리할 일을 보여주는 대시보드.
   제안 발주량 = 월평균 사용량 × 2개월 − 현재고, 제안 금액 = 제안량 × 당월 단가. */
function renderHomeBrief() {
  const el = $('#home-brief');
  if (!el) return;
  fetchFx();
  const rows = alertRows();
  const urgent = rows.filter((r) => r.state === '긴급 발주');
  const prep = rows.filter((r) => r.state === '준비 필요');
  // 제안 발주 금액 (긴급 품목: 2개월 커버 기준)
  let sugAmt = 0;
  urgent.forEach((r) => {
    const need = Math.max(0, Math.ceil(r.avgUse * 2 - (r.stock || 0)));
    if (r.price != null) sugAmt += need * r.price;
  });
  const today = todayStr();
  const tmrD = new Date(); tmrD.setDate(tmrD.getDate() + 1);
  const tmr = `${tmrD.getFullYear()}-${String(tmrD.getMonth() + 1).padStart(2, '0')}-${String(tmrD.getDate()).padStart(2, '0')}`;
  const open = ORDERS.filter((o) => (o.status || '미입고') !== '입고완료');
  const overdue = open.filter((o) => o.due && o.due < today);
  const oldestDays = overdue.length ? Math.round((Date.parse(today) - Math.min(...overdue.map((o) => Date.parse(o.due)))) / 86400000) : 0;
  const dueToday = open.filter((o) => o.due === today);
  const dueTmr = open.filter((o) => o.due === tmr);
  const ym = today.slice(0, 7);
  const monthIn = iqReceipts().filter((o) => String(iqDate(o)).startsWith(ym)).length;
  const monthOut = ISSUES.filter((s) => String(s.date || '').startsWith(ym)).length;
  const matTotal = MATERIALS.reduce((a, m) => a + matAmount(m), 0);
  const domShort = FINISHED.filter((f) => (f.scope || '내수') === '내수' && num(f.safety) > 0 && num(f.qty) < num(f.safety)).length;
  // 처리할 일 목록
  const tasks = [];
  if (urgent.length) tasks.push({
    badge: 'now', icon: '🛒', goto: 'alert',
    title: `발주가 필요한 품목 ${fmt(urgent.length)}건`,
    desc: `제안 발주 금액 약 ${fmt(Math.round(sugAmt))}원 (2개월 커버 기준). 상위: ${urgent.slice(0, 3).map((r) => esc(r.name)).join(', ')}${urgent.length > 3 ? ' 외' : ''}`,
    action: '<button class="btn small primary" id="home-po-btn" style="margin-top:6px">📝 발주서 작성</button>',
  });
  if (overdue.length) tasks.push({
    badge: 'now', icon: '⏰', goto: 'orders',
    title: `입고 예정일이 지난 발주 ${fmt(overdue.length)}건`,
    desc: `가장 오래된 건은 ${fmt(oldestDays)}일 지났습니다. 거래처에 확인하거나 납기·상태를 고쳐주세요.`,
  });
  if (dueToday.length + dueTmr.length) tasks.push({
    badge: 'soon', icon: '🚚', goto: 'orders',
    title: `오늘·내일 입고 예정 ${fmt(dueToday.length + dueTmr.length)}건`,
    desc: `오늘 ${fmt(dueToday.length)}건 · 내일 ${fmt(dueTmr.length)}건. ${[...dueToday, ...dueTmr].slice(0, 3).map((o) => esc(o.item)).join(', ')}${dueToday.length + dueTmr.length > 3 ? ' 외' : ''}`,
  });
  if (prep.length) tasks.push({
    badge: 'soon', icon: '📋', goto: 'alert',
    title: `준비 필요 품목 ${fmt(prep.length)}건`,
    desc: `재고 여유 2개월 미만 — 다음 발주 때 함께 챙기세요.`,
  });
  const nowCnt = tasks.filter((t) => t.badge === 'now').length;
  const headline = tasks.length
    ? `지금 손봐야 할 일이 <mark>${nowCnt || tasks.length}가지</mark> 있습니다. <b>${tasks[0].title}</b>부터 처리하세요.`
    : '지금 급하게 처리할 일이 없습니다. 👍';
  el.innerHTML = `
  <div class="brief">
    <div class="brief-top">🤖 업무 비서 <span class="badge plain">앱 데이터로 계산</span></div>
    <div class="brief-search">
      <input type="text" id="home-q" placeholder="🔍 구매팀 통합 검색 — 품명, 품번, 거래처, BOM... (예: 코어, CASCADE, NPC-2F)">
      <button class="btn primary" id="home-q-btn">검색</button>
    </div>
    <div id="home-q-result"></div>
    <div class="brief-head">${headline}</div>
    <div class="brief-chips">
      <span>📦 미입고 ${fmt(open.length)}건</span>
      <span>🚚 오늘 입고예정 ${fmt(dueToday.length)}건</span>
      <span>📅 이번 달 입고 ${fmt(monthIn)}건 · 출고 ${fmt(monthOut)}건</span>
    </div>
    ${tasks.map((t) => `<div class="brief-row" data-ai-goto="${t.goto}">
      <span class="brief-badge ${t.badge}">${t.badge === 'now' ? '지금' : '곧'}</span>
      <span>${t.icon}</span>
      <span class="brief-body"><span class="brief-title">${t.title}</span><div class="brief-desc">${t.desc}</div>${t.action || ''}</span>
      <span class="brief-arrow">›</span>
    </div>`).join('') || '<div class="brief-ok">✅ 모든 항목이 정상 범위입니다</div>'}
  </div>
  <div class="brief-section">📌 할 일</div>
  <div class="kpi-grid">
    <div class="kpi ${urgent.length ? 'red' : 'green'}" data-ai-goto="alert" style="cursor:pointer"><div class="k-label">🛒 발주점 도달</div><div class="k-value">${fmt(urgent.length)}<small>건</small></div><div class="k-sub">긴급 발주 필요 품목</div></div>
    <div class="kpi ${overdue.length ? 'red' : 'green'}" data-ai-goto="orders" style="cursor:pointer"><div class="k-label">⏰ 납기 경과</div><div class="k-value">${fmt(overdue.length)}<small>건</small></div><div class="k-sub">${overdue.length ? '최장 ' + fmt(oldestDays) + '일 경과' : '경과 없음'}</div></div>
    <div class="kpi" data-ai-goto="orders" style="cursor:pointer"><div class="k-label">🚚 오늘 입고예정</div><div class="k-value">${fmt(dueToday.length)}<small>건</small></div><div class="k-sub">내일 ${fmt(dueTmr.length)}건</div></div>
    <div class="kpi" data-ai-goto="inquiry" style="cursor:pointer"><div class="k-label">📋 이번 달 입고</div><div class="k-value">${fmt(monthIn)}<small>건</small></div><div class="k-sub">입고 조회 기준</div></div>
    <div class="kpi" data-ai-goto="issuelist" style="cursor:pointer"><div class="k-label">📤 이번 달 출고</div><div class="k-value">${fmt(monthOut)}<small>전표</small></div><div class="k-sub">출고 조회 기준</div></div>
  </div>
  <div class="brief-section">💊 재고 건강도</div>
  <div class="kpi-grid">
    <div class="kpi accent" data-ai-goto="materials" style="cursor:pointer"><div class="k-label">총 재고 금액 (원부자재)</div><div class="k-value">${fmt(Math.round(matTotal))}<small>원</small></div><div class="k-sub">전체 ${fmt(MATERIALS.length)}품목</div></div>
    <div class="kpi ${urgent.length + prep.length ? 'red' : 'green'}" data-ai-goto="alert" style="cursor:pointer"><div class="k-label">발주점 이하 품목</div><div class="k-value">${fmt(urgent.length + prep.length)}<small>개</small></div><div class="k-sub">긴급 ${fmt(urgent.length)} · 준비 ${fmt(prep.length)}</div></div>
    <div class="kpi ${domShort ? 'red' : 'green'}" data-ai-goto="finished" style="cursor:pointer"><div class="k-label">완제품 부족 SKU</div><div class="k-value">${fmt(domShort)}<small>종</small></div><div class="k-sub">내수 안전재고 기준</div></div>
    <div class="kpi" data-ai-goto="analytics" style="cursor:pointer"><div class="k-label">이번 달 입고 / 출고</div><div class="k-value">${fmt(monthIn)} / ${fmt(monthOut)}</div><div class="k-sub">${ym} 기준 · 분석 보기</div></div>
  </div>
  ${renderHomeWidgets(open, today)}`;
}
/* 홈 하단 위젯: 월별 구매금액 · 소진 빠른 품목 · 이번 주 입고 예정 · 거래처별 진행 현황 */
function renderHomeWidgets(open, today) {
  // 1) 월별 구매금액 (입고일 기준, 최근 6개월)
  const months = last12Months().slice(-6);
  const receipts = iqReceipts();
  const monthChart = vbarSVG(months.map((m) => ({
    label: m.slice(2).replace('-', '.'),
    value: receipts.filter((o) => String(iqDate(o)).startsWith(m)).reduce((a, o) => a + iqAmt(o), 0),
  })), manwon);
  // 2) 소진 빠른 품목 Top 5 (현재고 ÷ 적정재고)
  const adequate = matAdequateMap();
  const seen = new Set();
  const fast = [];
  MATERIALS.forEach((m) => {
    const key = (m.newCode || m.name || '').toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    const adq = adequate(m);
    if (adq == null || adq <= 0) return;
    fast.push({ name: m.name, ratio: Math.max(0, Math.round(num(m.stock) / adq * 100)) });
  });
  fast.sort((a, b) => a.ratio - b.ratio);
  const fastHtml = fast.slice(0, 5).map((x) => {
    const cls = x.ratio < 20 ? 'bad' : x.ratio < 50 ? 'warn' : 'ok';
    return `<div class="fast-row"><span class="fast-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="badge ${cls}">${x.ratio}%</span></div>`;
  }).join('') || '<div class="empty">적정재고가 산정된 품목이 없습니다</div>';
  // 3) 이번 주 입고 예정 (월~일)
  const base = new Date();
  const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];
  const weekHtml = dayNames.map((dn, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const due = open.filter((o) => o.due === ds);
    const rm = due.filter((o) => String(o.spec || '').toUpperCase().startsWith('RM')).length;
    const sm = due.filter((o) => String(o.spec || '').toUpperCase().startsWith('SM')).length;
    const done = receipts.filter((o) => o.inDate === ds).length;
    return `<div class="week-day${ds === today ? ' today' : ''}">
      <div class="wd-name">${dn} <span class="muted">${d.getDate()}</span></div>
      <div class="wd-cnt${due.length ? '' : ' muted'}">${due.length}</div>
      <div class="wd-chips">${rm ? `<span class="badge neal">원${rm}</span>` : ''}${sm ? `<span class="badge ok">부${sm}</span>` : ''}${done ? `<span class="badge plain">✓${done}</span>` : ''}</div>
    </div>`;
  }).join('');
  // 4) 거래처별 진행 현황 (미입고 발주 기준)
  const bySup = {};
  open.forEach((o) => {
    if (!o.supplier) return;
    if (!bySup[o.supplier]) bySup[o.supplier] = { open: 0, late: 0 };
    bySup[o.supplier].open++;
    if (o.due && o.due < today) bySup[o.supplier].late++;
  });
  const sups = Object.entries(bySup).sort((a, b) => b[1].late - a[1].late || b[1].open - a[1].open).slice(0, 6);
  const supHtml = sups.length ? `<table><thead><tr><th>거래처</th><th class="num">발주중</th><th>상태</th></tr></thead><tbody>
    ${sups.map(([s, v]) => `<tr class="no-click"><td>${esc(s)}</td><td class="num">${fmt(v.open)}건</td>
      <td>${v.late ? `<span class="badge bad">지연 ${v.late}</span>` : '<span class="badge ok">정상</span>'}</td></tr>`).join('')}
  </tbody></table>` : '<div class="empty">진행 중인 발주가 없습니다</div>';
  return `
  <div class="grid-2" style="margin-top:16px;text-align:left">
    <div class="card"><div class="card-head-row"><h3>📊 월별 구매금액 <span class="muted" style="font-weight:400">입고일 기준</span></h3><button class="btn small" data-ai-goto="analytics">구매 분석 ›</button></div>${monthChart}</div>
    <div class="card"><div class="card-head-row"><h3>⚡ 소진 빠른 품목 Top 5</h3><button class="btn small" data-ai-goto="materials">재고 현황 ›</button></div>${fastHtml}
      <p class="muted" style="margin-top:8px;font-size:11px">산식 = 현재고 ÷ 적정재고 · <span class="badge bad">20% 미만</span> <span class="badge warn">50% 미만</span></p></div>
    <div class="card"><div class="card-head-row"><h3>🗓 이번 주 입고 예정</h3><button class="btn small" data-ai-goto="orders">발주내역 ›</button></div>
      <div class="week-grid">${weekHtml}</div>
      <p class="muted" style="margin-top:8px;font-size:11px">납기 기준 · <span class="badge neal">원</span>=원자재 <span class="badge ok">부</span>=부자재 · ✓=입고 완료 건</p></div>
    <div class="card"><div class="card-head-row"><h3>🤝 거래처별 진행 현황</h3><button class="btn small" data-ai-goto="inquiry">입고 조회 ›</button></div>
      <div class="table-wrap">${supHtml}</div>
      <p class="muted" style="margin-top:8px;font-size:11px">미입고 발주 기준 · 지연 = 입고 예정일이 오늘보다 지난 발주</p></div>
  </div>`;
}

/* --- 일별 환율 (달러 · 엔화 100엔, open.er-api.com — 키 불필요) --- */
const FX_KEY = 'bl-purchase-fx';
function fxRender(fx) {
  const el = $('#fx-bar');
  if (!el || !fx) return;
  const pill = (label, cur, prev) => {
    if (cur == null) return '';
    let arrow = '';
    if (prev != null && Math.abs(cur - prev) >= 0.05) {
      const up = cur > prev;
      arrow = ` <span style="color:${up ? 'var(--danger)' : '#1a7de0'};font-weight:800">${up ? '▲' : '▼'}${Math.abs(cur - prev).toFixed(1)}</span>`;
    }
    return `<span class="fx-pill">${label} <b>${cur.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}원</b>${arrow}</span>`;
  };
  el.innerHTML = pill('💵 USD', fx.usd, fx.prev && fx.prev.usd) + pill('💴 JPY 100', fx.jpy100, fx.prev && fx.prev.jpy100)
    + `<span class="fx-date" title="일일 기준환율 (open.er-api.com)">${(fx.date || '').slice(5)} 기준</span>`;
}
async function fetchFx() {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(FX_KEY)); } catch (e) { }
  if (cache) fxRender(cache);
  // 6시간 이내면 재요청 안 함
  if (cache && Date.now() - (cache.t || 0) < 6 * 3600 * 1000) return;
  try {
    const j = await fetch('https://open.er-api.com/v6/latest/USD').then((r) => r.json());
    if (!j || !j.rates || !j.rates.KRW) return;
    const usd = j.rates.KRW;
    const jpy100 = j.rates.JPY ? j.rates.KRW / j.rates.JPY * 100 : null;
    const date = (j.time_last_update_utc ? new Date(j.time_last_update_utc) : new Date()).toISOString().slice(0, 10);
    const fx = { t: Date.now(), date, usd, jpy100, prev: cache ? (cache.date !== date ? { usd: cache.usd, jpy100: cache.jpy100 } : cache.prev) : null };
    localStorage.setItem(FX_KEY, JSON.stringify(fx));
    fxRender(fx);
  } catch (e) { console.warn('환율 조회 실패', e); }
}

/* --- 구매팀 통합 검색 (업무 비서 검색창) --- */
function homeSearch() {
  const inp = $('#home-q');
  const box = $('#home-q-result');
  if (!inp || !box) return;
  const q = inp.value.trim();
  if (!q) { box.innerHTML = ''; return; }
  // 자연어 질문 해석: 수식어 자동 제외 + 내수/수출 필터 분리
  const { tokens, dropped, scope } = prepareSearch(q);
  if (!tokens.length) {
    box.innerHTML = `<div class="qres"><div class="empty">품명이나 코드를 함께 입력해 주세요. 예: <b>코어 2인치 얼마나 있어?</b>${dropped.length ? `<br><span class="muted" style="font-size:12px">입력한 단어(${esc(dropped.join(', '))})가 등록된 품명·코드에 없습니다 — 표기를 확인해 보세요.</span>` : ''}</div></div>`;
    return;
  }
  const hit = (...vals) => tokenMatchAll(tokens, ...vals);
  const qShort = (scope ? scope + ' ' : '') + tokens.join(' ');
  const gotoBtn = (page, label) => `<button class="btn small" data-qgoto="${page}" data-q="${esc(tokens.join(' '))}">${label} 탭에서 모두 보기 →</button>`;
  const secs = {};
  // 원부자재
  const mats = MATERIALS.filter((m) => hit(m.name, m.newCode, m.newName, m.category, m.division));
  if (mats.length) secs.mats = `<div class="qres-group"><h4>🧱 원부자재 ${fmt(mats.length)}건</h4>
    <div class="table-wrap"><table><thead><tr><th>품목명</th><th>신규코드</th><th class="num">현재고</th><th>단위</th></tr></thead><tbody>
    ${mats.slice(0, 5).map((m) => `<tr data-material-id="${m.id}"><td><b>${esc(m.name)}</b></td><td>${esc(m.newCode || '')}</td><td class="num">${fmt(m.stock, 2)}</td><td>${esc(m.unit || '')}</td></tr>`).join('')}
    </tbody></table></div>${gotoBtn('materials', '원부자재')}</div>`;
  // 완제품 (내수/수출 필터 적용)
  const fins = FINISHED.filter((f) => (!scope || (f.scope || '내수') === scope) && hit(f.code, f.brand, f.group, f.supplier, f.color));
  if (fins.length) secs.fins = `<div class="qres-group"><h4>📦 완제품 ${fmt(fins.length)}건${scope ? ` <span class="badge plain">${scope}만</span>` : ''}</h4>
    <div class="table-wrap"><table><thead><tr><th>제품코드</th><th>구분</th><th class="num">현재고</th><th class="num">안전재고</th></tr></thead><tbody>
    ${fins.slice(0, 5).map((f) => `<tr data-fin-id="${f.id}"><td><b>${esc(f.code)}</b></td><td>${esc(f.scope || '내수')}</td><td class="num">${fmt(f.qty)}</td><td class="num">${fmt(f.safety)}</td></tr>`).join('')}
    </tbody></table></div>${gotoBtn('finished', '완제품')}</div>`;
  // 발주내역
  const ords = ORDERS.filter((o) => hit(o.item, o.supplier, o.spec, o.note)).sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  if (ords.length) secs.ords = `<div class="qres-group"><h4>🧾 발주내역 ${fmt(ords.length)}건 <span class="muted" style="font-weight:400">최신순</span></h4>
    <div class="table-wrap"><table><thead><tr><th>발주일</th><th>거래처</th><th>품명</th><th class="num">수량</th><th>상태</th></tr></thead><tbody>
    ${ords.slice(0, 5).map((o) => `<tr data-order-id="${o.id}"><td>${esc(o.date || '')}</td><td>${esc(o.supplier || '')}</td><td><b>${esc(o.item)}</b></td><td class="num">${fmt(o.qty)}</td><td>${orderStatusBadge(o.status)}</td></tr>`).join('')}
    </tbody></table></div>${gotoBtn('orders', '발주내역')}</div>`;
  // 출고 전표
  const iss = [];
  ISSUES.forEach((s) => (s.lines || []).forEach((l) => { if (hit(l.name, l.code)) iss.push({ s, l }); }));
  iss.sort((a, b) => ((a.s.date || '') < (b.s.date || '') ? 1 : -1));
  if (iss.length) secs.iss = `<div class="qres-group"><h4>📤 출고 기록 ${fmt(iss.length)}건 <span class="muted" style="font-weight:400">최신순</span></h4>
    <div class="table-wrap"><table><thead><tr><th>출고일</th><th>전표</th><th>품명</th><th class="num">수량</th></tr></thead><tbody>
    ${iss.slice(0, 5).map((x) => `<tr class="no-click"><td>${esc(x.s.date || '')}</td><td>${esc(x.s.no || '')}</td><td><b>${esc(x.l.name || x.l.code)}</b></td><td class="num">${fmt(x.l.qty, 1)}</td></tr>`).join('')}
    </tbody></table></div>${gotoBtn('issuelist', '출고 조회')}</div>`;
  // BOM
  const boms = Object.keys(BOMD.entries).filter((k) => hit(k, BOMD.entries[k].n, BOMD.entries[k].customer));
  if (boms.length) secs.boms = `<div class="qres-group"><h4>📚 BOM 모품목 ${fmt(boms.length)}건</h4>
    <div class="brief-desc">${boms.slice(0, 5).map((k) => `${esc(BOMD.entries[k].n || k)} — ${esc(k)}`).join('<br>')}${boms.length > 5 ? '<br>외 ' + fmt(boms.length - 5) + '건' : ''}</div>
    ${gotoBtn('bom', 'BOM')}</div>`;
  // 품목 코드
  const cds = CODES.filter((c) => hit(c.name, c.code, c.engName, c.category, c.sub));
  if (cds.length) secs.cds = `<div class="qres-group"><h4>🔖 품목 코드 ${fmt(cds.length)}건</h4>
    <div class="table-wrap"><table><thead><tr><th>품명</th><th>품번</th><th>분류</th></tr></thead><tbody>
    ${cds.slice(0, 5).map((c) => `<tr data-code-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.code)}</td><td>${esc(c.category || '')}</td></tr>`).join('')}
    </tbody></table></div>${gotoBtn('codes', '품목 코드')}</div>`;
  // 질문 의도에 따라 관련 섹션을 먼저 (완제품/출고/발주·입고 언급 시)
  let order = ['mats', 'fins', 'ords', 'iss', 'boms', 'cds'];
  if (/완제품/.test(q) || scope) order = ['fins', 'mats', 'ords', 'iss', 'boms', 'cds'];
  else if (/출고/.test(q)) order = ['iss', 'mats', 'fins', 'ords', 'boms', 'cds'];
  else if (/발주|입고|거래처|언제/.test(q)) order = ['ords', 'mats', 'fins', 'iss', 'boms', 'cds'];
  else if (/BOM|자재명세|들어가/i.test(q)) order = ['boms', 'mats', 'fins', 'ords', 'iss', 'cds'];
  const sections = order.map((k) => secs[k]).filter(Boolean);
  // 재고 질문이면 표 위에 요약 답변 한 줄
  let answer = '';
  if (isStockQuestion(q) && (mats.length || fins.length)) {
    const parts = [];
    if (fins.length) parts.push(`완제품${scope ? '(' + scope + ')' : ''} ${fmt(fins.length)}개 품목 · 현재고 합계 <b>${fmt(fins.reduce((a, f) => a + num(f.qty), 0))}</b>`);
    if (mats.length) parts.push(`원부자재 ${fmt(mats.length)}개 품목 · 현재고 합계 <b>${(() => { const units = [...new Set(mats.map((m) => m.unit).filter(Boolean))]; return fmt(mats.reduce((a, m) => a + num(m.stock), 0), 2) + (units.length === 1 ? ' ' + esc(units[0]) : ''); })()}</b>`);
    if (!(/완제품/.test(q) || scope)) parts.reverse(); // 기본은 원부자재 먼저
    answer = `<div class="qres-answer">💬 <b>${esc(qShort)}</b> — ${parts.join(' / ')}</div>`;
  }
  const droppedNote = dropped.length ? `<div class="muted" style="font-size:12px;margin-bottom:8px">검색에서 제외한 단어: ${esc(dropped.join(', '))} (등록된 품명·코드에 없음)</div>` : '';
  box.innerHTML = sections.length
    ? `<div class="qres">${answer}${droppedNote}${sections.join('')}<div style="text-align:right;margin-top:6px"><button class="btn small" id="home-q-clear">✕ 결과 닫기</button></div></div>`
    : `<div class="qres"><div class="empty">"${esc(q)}"에 대한 결과가 없습니다.${qShort !== q ? `<br><span class="muted" style="font-size:12px">이렇게 해석했어요: <b>${esc(qShort)}</b> — 품명·코드 표기를 확인해 보세요.</span>` : ''}</div></div>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#home-q-btn')) { homeSearch(); return; }
  if (e.target.closest('#home-q-clear')) { const b = $('#home-q-result'); if (b) b.innerHTML = ''; const i = $('#home-q'); if (i) i.value = ''; return; }
  const g = e.target.closest('[data-qgoto]');
  if (g) {
    const page = g.dataset.qgoto, q = g.dataset.q;
    showPage(page);
    const map = { materials: '#m-search', finished: '#fd-search', orders: '#o-search', bom: '#bom-search', codes: '#cd-search' };
    const inp = $(map[page]);
    if (inp) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'home-q') homeSearch(); });

/* ===================== 구매 어시스턴트 (챗봇) =====================
   외부 서버 없이 플랫폼 데이터(발주 알림·재고·발주·출고)로 즉시 답하는 규칙 기반 어시스턴트.
   접속 시 발주해야 하는 목록을 자동으로 보여준다. */
function aiPush(role, html) {
  const box = $('#ai-msgs');
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  div.innerHTML = html;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
const aiGotoBtn = (page, label) => `<button class="btn small primary" data-ai-goto="${page}">${label}</button>`;
function aiAlertTable(rows, limit) {
  const shown = rows.slice(0, limit);
  return `<div class="table-wrap"><table><thead><tr><th>품명</th><th class="num">현재고</th><th class="num">월사용</th><th class="num">여유</th></tr></thead><tbody>`
    + shown.map((r) => `<tr class="no-click"><td>${esc(r.name)}</td><td class="num">${r.stock != null ? fmt(r.stock, 1) : '-'}</td><td class="num">${fmt(Math.round(r.avgUse))}</td><td class="num">${r.cover != null ? r.cover.toFixed(1) + '개월' : '-'}</td></tr>`).join('')
    + `</tbody></table></div>${rows.length > limit ? `<div class="muted" style="margin-top:4px">외 ${fmt(rows.length - limit)}품목 더 있음</div>` : ''}`;
}
function aiUrgentAnswer() {
  const rows = alertRows();
  const urgent = rows.filter((r) => r.state === '긴급 발주');
  const prep = rows.filter((r) => r.state === '준비 필요');
  if (!urgent.length) return `지금 <b>긴급 발주가 필요한 품목은 없습니다.</b> 🟢${prep.length ? `<br>다만 준비 필요 품목이 ${prep.length}개 있습니다 — "준비 필요"라고 물어보세요.` : ''}`;
  return `🔴 <b>긴급 발주 필요 — ${fmt(urgent.length)}품목</b> (재고 여유 1개월 미만)`
    + aiAlertTable(urgent, 8)
    + (prep.length ? `<div style="margin-top:6px">🟡 준비 필요 품목도 ${fmt(prep.length)}개 있습니다.</div>` : '')
    + '<br>' + aiGotoBtn('alert', '🚨 발주 알림 전체 보기');
}
function aiPrepAnswer() {
  const prep = alertRows().filter((r) => r.state === '준비 필요');
  if (!prep.length) return '🟡 준비 필요 단계(재고 여유 2개월 미만)의 품목이 없습니다.';
  return `🟡 <b>준비 필요 — ${fmt(prep.length)}품목</b> (재고 여유 2개월 미만)` + aiAlertTable(prep, 8) + '<br>' + aiGotoBtn('alert', '🚨 발주 알림 전체 보기');
}
const AI_SYNONYM = {
  '코어': ['CORE'], '파우치': ['POUCH'], '박스': ['BOX'], '클립': ['CLIP'], '라벨': ['LABEL'],
  '원단': ['FIBERGLASS', 'TEX'], '수지': ['RESIN', 'NHR'], '토너': ['TONER', 'BLUE', 'GREEN', 'PINK'], '촉매': ['DMDEE', 'CAT'],
  '인치': ['INCH'], '유리섬유': ['FIBERGLASS', 'FGL'], '부직포': ['NW'], '폴리': ['POLY'],
};
/* 자연어 질문 → 검색 토큰: "지금 우리 CORE 2INCH 가 얼마나 있어?" → ['CORE','2INCH']
   의문어·조사를 걷어내 품명·코드 토큰만 남기고, 모든 토큰이 들어간 품목을 찾는다. */
const Q_STOPWORD = /^(지금|현재|오늘|우리|우리가|우리회사|회사|저희|혹시|좀|그럼|근데|그리고|재고|재고량|수량|현황|얼마나|얼마|얼마쯤|대략|정도|약|몇개|몇개나|몇개야|몇개지|몇개인지|몇|개나|개야|개지|개수|총|전체|알려줘|알려줘요|알려주세요|보여줘|보여줘요|보여주세요|검색|조회|확인|찾아줘|찾아봐|찾아|있어|있어요|있나|있나요|있냐|있지|있음|있는지|남았어|남았나|남았지|남은|남아|얼마야|뭐야|어때|제품|품목|은|는|이|가|을|를|의|도|만)$/;
function extractQueryTokens(q) {
  const toks = [];
  String(q || '').replace(/[?!.,·~]/g, ' ').split(/\s+/).forEach((w) => {
    if (!w) return;
    w = w.replace(/([0-9]+(?:\.[0-9]+)?)\s*인치/g, '$1INCH'); // 2인치 → 2INCH
    if (/^[A-Za-z0-9\-_/."']+[가-힣]+$/.test(w)) w = w.replace(/[가-힣]+$/, ''); // CORE가, 2INCH는 → 조사 제거
    else if (/^[가-힣]+$/.test(w)) {
      if (Q_STOPWORD.test(w)) return;
      const st = w.replace(/(이라고|이라는|으로|로|까지|부터|에서|한테|에게|이나|처럼|마다|은|는|이|가|을|를|의|도|만|랑|과|와)$/, '');
      w = st || w;
      if (!w || Q_STOPWORD.test(w)) return;
    }
    if (w) toks.push(w);
  });
  return toks;
}
function tokenAltsHit(tk, hay) { // hay: 정규화(대문자·공백제거)된 문자열
  const NN = (s) => String(s || '').toUpperCase().replace(/\s/g, '');
  const alts = [tk, ...(AI_SYNONYM[tk] || [])].map(NN).filter(Boolean);
  return alts.some((a) => /^\d/.test(a) // 숫자 시작 토큰: '2INCH'가 '12INCH'에 걸리지 않게
    ? new RegExp('(^|[^0-9])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay)
    : hay.includes(a));
}
function tokenMatchAll(tokens, ...vals) {
  const N = (s) => String(s || '').toUpperCase().replace(/\s/g, '');
  const hay = vals.map(N).join('|');
  return tokens.length > 0 && tokens.every((tk) => tokenAltsHit(tk, hay));
}
const isStockQuestion = (q) => /얼마나|몇\s*개|몇개|있어|있나|있냐|남았|재고|수량|현황/.test(q);
/* 질문 해석: 토큰 추출 → 내수/수출 필터 분리 → 데이터 어디에도 없는 수식어는 자동 제외.
   예) "NHC-3F-GR 내수용 재고 몇개나 있어?" → tokens ['NHC-3F-GR'], scope '내수' */
function queryHaystack() {
  const N = (s) => String(s || '').toUpperCase().replace(/\s/g, '');
  const parts = [];
  MATERIALS.forEach((m) => parts.push(N(m.name), N(m.newCode), N(m.newName), N(m.category), N(m.division)));
  FINISHED.forEach((f) => parts.push(N(f.code), N(f.brand), N(f.group), N(f.supplier), N(f.color)));
  ORDERS.forEach((o) => parts.push(N(o.item), N(o.supplier), N(o.spec)));
  Object.keys(BOMD.entries).forEach((k) => parts.push(N(k), N(BOMD.entries[k].n), N(BOMD.entries[k].customer)));
  CODES.forEach((c) => parts.push(N(c.name), N(c.code), N(c.engName), N(c.category), N(c.sub)));
  ISSUES.forEach((s) => (s.lines || []).forEach((l) => parts.push(N(l.name), N(l.code))));
  return parts.join('|');
}
function prepareSearch(q) {
  let scope = null;
  const t0 = extractQueryTokens(q).filter((t) => {
    if (/^(내수|내수용|국내용|국내)$/.test(t)) { scope = '내수'; return false; }
    if (/^(수출|수출용|해외용|해외)$/.test(t)) { scope = '수출'; return false; }
    return true;
  });
  const hay = queryHaystack();
  const tokens = [], dropped = [];
  t0.forEach((tk) => (tokenAltsHit(tk, hay) ? tokens : dropped).push(tk));
  return { tokens, dropped, scope };
}
function aiStockAnswer(q) {
  const { tokens, dropped, scope } = prepareSearch(q);
  if (!tokens.length) return `찾을 품명이나 코드를 함께 입력해 주세요. 예: <b>재고 코어</b>, <b>코어 2인치 얼마나 있어?</b>${dropped.length ? `<br><span class="muted">입력한 단어(${esc(dropped.join(', '))})는 등록된 품명·코드에 없습니다.</span>` : ''}`;
  const hit = (...v) => tokenMatchAll(tokens, ...v);
  const matsAll = MATERIALS.filter((m) => hit(m.name, m.newCode, m.newName, m.category, m.division));
  const mats = matsAll.slice(0, 6);
  const finsAll = FINISHED.filter((f) => (!scope || (f.scope || '내수') === scope) && hit(f.code, f.brand, f.group, f.supplier));
  const fins = finsAll.slice(0, 6);
  if (!mats.length && !fins.length) return `"${esc((scope ? scope + ' ' : '') + tokens.join(' '))}"에 해당하는 품목을 찾지 못했습니다.`;
  let html = '';
  if (isStockQuestion(q)) { // "얼마나 있어?" 류 질문이면 합계부터 답한다
    const parts = [];
    if (matsAll.length) {
      const tot = matsAll.reduce((a, m) => a + num(m.stock), 0);
      const units = [...new Set(matsAll.map((m) => m.unit).filter(Boolean))];
      parts.push(`원부자재 현재고 합계 <b>${fmt(tot, 2)}${units.length === 1 ? ' ' + esc(units[0]) : ''}</b> (${fmt(matsAll.length)}개 품목)`);
    }
    if (finsAll.length) parts.push(`완제품${scope ? '(' + scope + ')' : ''} 합계 <b>${fmt(finsAll.reduce((a, f) => a + num(f.qty), 0))}</b> (${fmt(finsAll.length)}개 품목)`);
    html += `💬 <b>${esc((scope ? scope + ' ' : '') + tokens.join(' '))}</b> — ${parts.join(' · ')}<br>`;
  }
  if (mats.length) {
    html += `<b>원부자재</b><div class="table-wrap"><table><thead><tr><th>품명</th><th class="num">현재고</th><th>단위</th></tr></thead><tbody>`
      + mats.map((m) => `<tr class="no-click"><td>${esc(m.name)}</td><td class="num">${fmt(m.stock, 2)}</td><td>${esc(m.unit || '')}</td></tr>`).join('') + '</tbody></table></div>';
  }
  if (fins.length) {
    html += `<b>완제품</b><div class="table-wrap"><table><thead><tr><th>제품코드</th><th class="num">현재고</th><th class="num">안전재고</th></tr></thead><tbody>`
      + fins.map((f) => `<tr class="no-click"><td>${esc(f.code)}</td><td class="num">${fmt(f.qty)}</td><td class="num">${fmt(f.safety)}</td></tr>`).join('') + '</tbody></table></div>';
  }
  return html;
}
function aiOpenOrdersAnswer() {
  const open = ORDERS.filter((o) => (o.status || '미입고') !== '입고완료')
    .sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  if (!open.length) return '미입고 발주가 없습니다. ✅';
  const amt = open.reduce((a, o) => a + orderAmount(o), 0);
  return `📦 <b>미입고 · 부분입고 ${fmt(open.length)}건</b> (${fmt(Math.round(amt))}원)`
    + `<div class="table-wrap"><table><thead><tr><th>발주일</th><th>품명</th><th class="num">수량</th></tr></thead><tbody>`
    + open.slice(0, 6).map((o) => `<tr class="no-click"><td>${esc(o.date)}</td><td>${esc(o.item)}</td><td class="num">${fmt(o.qty)}</td></tr>`).join('')
    + '</tbody></table></div><br>' + aiGotoBtn('orders', '🧾 발주내역 열기');
}
const AI_HELP = `이런 걸 물어볼 수 있어요:<br>
· <b>긴급 발주</b> — 지금 발주해야 하는 품목<br>
· <b>준비 필요</b> — 미리 준비할 품목<br>
· <b>재고 (품명/코드)</b> — 예: 재고 코어, 재고 NAC-2F<br>
· <b>미입고</b> — 아직 입고 안 된 발주<br>
· <b>출고</b> — 최근 출고 전표`;
function aiAnswer(text) {
  const t = text.trim();
  if (/^(도움|도움말|help)\s*\??$/i.test(t)) return AI_HELP;
  if (/긴급|급한|발주.*(필요|목록|해야)|주문.*필요/.test(t)) return aiUrgentAnswer();
  if (/준비/.test(t)) return aiPrepAnswer();
  if (/미입고|입고.*안/.test(t)) return aiOpenOrdersAnswer();
  if (/^재고/.test(t)) return aiStockAnswer(t.replace(/^재고/, '').trim());
  if (/출고/.test(t)) {
    const recent = ISSUES.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)).slice(0, 3);
    if (!recent.length) return '아직 출고 전표가 없습니다. [자재 일일출고]에서 등록할 수 있어요.';
    return '📤 <b>최근 출고 전표</b><br>' + recent.map((s) => `· ${esc(s.no)} (${esc(s.date)}) — ${(s.lines || []).length}품목, ${fmt(issueQty(s), 1)}`).join('<br>') + '<br>' + aiGotoBtn('issuelist', '📑 출고 조회 열기');
  }
  // 그 외 입력은 품명 검색으로 처리
  const found = aiStockAnswer(t);
  return found.includes('찾지 못했') ? found + '<br><br>' + AI_HELP : found;
}
function aiSend(text) {
  const t = String(text || '').trim();
  if (!t && !AI_ATTACH) return;
  aiPush('user', esc(t || '📎 첨부 문서'));
  // 첨부 파일이 있으면 무조건 AI(비전)로 — 영수증·거래명세서 읽기
  if (AI_ATTACH) {
    const attach = AI_ATTACH;
    AI_ATTACH = null;
    $('#ai-attach-bar').hidden = true;
    if (!aiKey()) { aiPush('bot', '⚠️ 첨부를 읽으려면 AI 키가 필요합니다. ⚙ 버튼에서 설정해 주세요.'); return; }
    const div = aiPush('bot', '🤖 문서를 읽는 중…');
    aiAskGpt(t || '이 문서를 읽고 내용을 정리해줘. 영수증·거래명세서라면 거래처/날짜/품목/수량/단가/금액을 표로 정리하고 합계를 검산해줘.', attach)
      .then((r) => { div.innerHTML = r; $('#ai-msgs').scrollTop = $('#ai-msgs').scrollHeight; });
    return;
  }
  const ans = aiAnswer(t);
  // AI(GPT)로 넘기는 경우: ① 조언·설명형 질문(방법/전략/추천/요약 등) ② 규칙 기반이 답을 못 찾은 질문
  const advisory = /방법|어떻게|왜|전략|추천|제안|정리해|요약|비교|어떨까|할까|해야\s*(하|할|되)|의견|생각|팁|주의사항|설명/.test(t)
    && !/긴급|준비 필요|미입고|^재고|도움/.test(t);
  const miss = /찾지 못했습니다|찾을 품명이나/.test(ans);
  if (aiKey() && (advisory || miss)) {
    const div = aiPush('bot', '🤖 AI가 생각 중…');
    aiAskGpt(t).then((r) => { div.innerHTML = r; $('#ai-msgs').scrollTop = $('#ai-msgs').scrollHeight; });
    return;
  }
  aiPush('bot', ans);
}
/* ===================== AI(OpenAI) 연동 — 키는 이 기기(localStorage)에만 저장 =====================
   공개 사이트 코드에 키를 넣으면 누구나 훔쳐 쓸 수 있으므로, ⚙ 설정에서 기기별로 입력한다.
   규칙 기반이 답하지 못하는 질문만 AI로 넘기며, 질문과 관련된 우리 데이터 요약을 함께 보낸다. */
const AI_KEY_LS = DB_PREFIX + 'aikey';
/* 키 우선순위: env.js(window.BL_ENV, 이 PC 전용·배포 제외) → ⚙ 설정으로 저장한 키 */
function aiKey() {
  const envKey = window.BL_ENV && window.BL_ENV.OPENAI_API_KEY;
  if (envKey && /^sk-/.test(envKey)) return envKey;
  return localStorage.getItem(AI_KEY_LS) || '';
}
function aiKeySettingsMsg() {
  const k = aiKey();
  aiPush('bot', `<b>⚙ AI 연결 설정</b><br>
    OpenAI API 키를 넣으면, 제가 규칙으로 답 못하는 질문을 AI가 우리 재고·발주 데이터를 보고 대답해줍니다.<br>
    <span class="muted">키는 <b>이 컴퓨터에만</b> 저장되고 클라우드로 동기화되지 않습니다. 키는 sk- 로 시작합니다.</span>
    <div style="display:flex;gap:6px;margin-top:8px">
      <input type="password" id="ai-key-input" placeholder="sk-..." style="flex:1;padding:7px 9px;border:1px solid var(--line);border-radius:6px" value="">
      <button class="btn small primary" id="ai-key-save">저장</button>
      ${k ? '<button class="btn small danger" id="ai-key-del">삭제</button>' : ''}
    </div>
    <div class="muted" style="margin-top:6px">현재 상태: ${k ? '🟢 키 등록됨 (' + esc(k.slice(0, 7)) + '···)' + (window.BL_ENV && window.BL_ENV.OPENAI_API_KEY ? ' — env.js 파일의 키 사용 중' : '') : '⚪ 미등록 — 규칙 기반으로만 동작'}</div>`);
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#ai-key-btn')) { aiKeySettingsMsg(); return; }
  if (e.target.closest('#ai-key-save')) {
    const v = ($('#ai-key-input') && $('#ai-key-input').value || '').trim();
    if (!v) { toast('키를 입력해 주세요'); return; }
    if (!/^sk-/.test(v)) { toast('OpenAI 키는 sk- 로 시작합니다 — 키 "값"(secret)을 복사했는지 확인하세요'); return; }
    localStorage.setItem(AI_KEY_LS, v);
    aiPush('bot', '🟢 AI 키를 저장했습니다. 이제 제가 모르는 질문은 AI가 대신 답해드릴게요.');
    aiUpdateModelLabel();
    return;
  }
  if (e.target.closest('#ai-key-del')) {
    localStorage.removeItem(AI_KEY_LS);
    aiPush('bot', '⚪ AI 키를 삭제했습니다.');
    aiUpdateModelLabel();
  }
});
/* 질문과 관련된 우리 데이터 요약 (AI에게 근거로 전달) */
function aiContext(q) {
  const lines = [];
  const { tokens, scope } = prepareSearch(q);
  if (tokens.length) {
    const hit = (...v) => tokenMatchAll(tokens, ...v);
    const mats = MATERIALS.filter((m) => hit(m.name, m.newCode, m.newName)).slice(0, 12);
    if (mats.length) lines.push('[원부자재 재고] ' + mats.map((m) => `${m.name}(${m.newCode || '-'}): ${fmt(m.stock, 1)}${m.unit || ''}${m.price ? ' 단가' + fmt(m.price) + '원' : ''}`).join(' / '));
    const fins = FINISHED.filter((f) => (!scope || (f.scope || '내수') === scope) && hit(f.code, f.brand, f.group, f.supplier)).slice(0, 12);
    if (fins.length) lines.push('[완제품 재고] ' + fins.map((f) => `${f.code}(${f.scope || '내수'}): ${fmt(f.qty)}개 안전${fmt(f.safety)}`).join(' / '));
    const ords = ORDERS.filter((o) => hit(o.item, o.supplier, o.spec)).sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)).slice(0, 6);
    if (ords.length) lines.push('[최근 발주] ' + ords.map((o) => `${o.date} ${o.item} ${fmt(o.qty)} ${o.supplier || ''} ${o.status || '미입고'}`).join(' / '));
  }
  const urgent = alertRows().filter((r) => r.state === '긴급 발주').slice(0, 8);
  if (urgent.length) lines.push('[긴급 발주 필요] ' + urgent.map((r) => `${r.name}: 재고${r.stock != null ? fmt(r.stock, 1) : '-'} 월사용${fmt(Math.round(r.avgUse))}`).join(' / '));
  try {
    const fx = JSON.parse(localStorage.getItem('bl-purchase-fx') || 'null');
    if (fx && fx.usd) lines.push(`[환율] USD ${fx.usd}원 / JPY100 ${fx.jpy}원 (${fx.date || ''})`);
  } catch (err) { }
  return lines.join('\n');
}
/* 모델 선택: env의 OPENAI_MODEL이 'auto'(기본)면 OpenAI 모델 목록에서 최신 GPT 본계열
   (gpt-5, gpt-5.5, gpt-6, ...)을 자동 선택해 하루 캐시 — 새 버전이 나오면 자동 전환된다 */
const AI_MODEL_CACHE = DB_PREFIX + 'aimodel';
let AI_MODEL_USED = ''; // 마지막으로 실제 사용한 모델 (표시용)
async function aiResolveModel() {
  const conf = (window.BL_ENV && window.BL_ENV.OPENAI_MODEL) || 'auto';
  if (conf && conf !== 'auto' && conf !== 'latest') return conf;
  try {
    const c = JSON.parse(localStorage.getItem(AI_MODEL_CACHE) || 'null');
    if (c && c.m && Date.now() - c.t < 86400000) return c.m;
  } catch (e) { }
  try {
    const j = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + aiKey() } }).then((r) => r.json());
    let best = null, bv = -1;
    (j.data || []).forEach((m) => {
      const mm = /^gpt-(\d+(?:\.\d+)?)$/.exec(m.id); // 본계열만 (mini/nano/codex/pro/search 제외)
      if (mm && parseFloat(mm[1]) > bv) { bv = parseFloat(mm[1]); best = m.id; }
    });
    if (best) { localStorage.setItem(AI_MODEL_CACHE, JSON.stringify({ m: best, t: Date.now() })); return best; }
  } catch (e) { }
  return 'gpt-5.5';
}
/* 헤더의 모델 표시: 키 있으면 현재 자동 선택된 모델명, 없으면 '규칙 기반' */
function aiUpdateModelLabel() {
  const el = $('#ai-model-label');
  if (!el) return;
  if (!aiKey()) { el.textContent = '규칙 기반'; el.title = 'AI 키 미등록 — ⚙에서 설정하면 GPT가 연결됩니다'; return; }
  el.textContent = AI_MODEL_USED || '…';
  aiResolveModel().then((m) => {
    AI_MODEL_USED = m;
    el.textContent = m;
    const conf = (window.BL_ENV && window.BL_ENV.OPENAI_MODEL) || 'auto';
    el.title = conf === 'auto' || conf === 'latest' ? 'AI 모델 (auto: 항상 최신 GPT 자동 선택)' : 'AI 모델 (env.js에서 고정)';
  });
}
async function aiAskGpt(question, attach) {
  try {
    const model = await aiResolveModel();
    AI_MODEL_USED = model;
    aiUpdateModelLabel();
    const ctx = aiContext(question);
    // 첨부(이미지/PDF)가 있으면 비전 입력으로 함께 전달
    let userContent = question;
    if (attach) {
      const part = attach.type === 'application/pdf'
        ? { type: 'file', file: { filename: attach.name, file_data: attach.dataUrl } }
        : { type: 'image_url', image_url: { url: attach.dataUrl } };
      userContent = [{ type: 'text', text: question }, part];
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aiKey() },
      body: JSON.stringify(Object.assign({
        model: model,
        // 추론형 모델은 생각(추론) 토큰도 한도에 포함되므로 넉넉히 잡는다
        max_completion_tokens: attach ? 4000 : 1600,
      }, /^gpt-[5-9]/.test(model) ? { reasoning_effort: 'low' } : {}, {
        messages: [
          { role: 'system', content: '당신은 비엘테크(정형외과용 캐스트·스플린트 제조사) 구매팀의 어시스턴트다. 아래 회사 실데이터를 근거로 한국어로 간결하게 답하라. 데이터에 없는 내용은 지어내지 말고 모른다고 말하라. 금액은 원 단위 콤마로 쓴다. 영수증·거래명세서 등 문서 이미지가 첨부되면 거래처/날짜/품목/수량/단가/금액을 표로 정리하고 합계를 검산하라.\n\n' + (ctx || '(질문과 일치하는 사내 데이터 없음)') },
          { role: 'user', content: userContent },
        ],
      })),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) return '🔑 AI 키가 올바르지 않습니다. ⚙ 설정에서 sk- 로 시작하는 <b>키 값(secret)</b>을 다시 넣어주세요.';
      if (res.status === 429) return '⏳ AI 사용량 한도에 걸렸습니다 (요금제/크레딧 확인 필요).';
      return 'AI 응답 실패: ' + esc((err.error && err.error.message) || res.status);
    }
    const j = await res.json();
    const out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
    return '🤖 ' + aiMd(out) + '<div class="muted" style="margin-top:6px;font-size:11px">AI(' + esc(model) + ') 답변 — 중요한 결정 전 원본 확인</div>';
  } catch (err) {
    return 'AI 연결 실패: ' + esc(err.message) + ' (인터넷 연결 확인)';
  }
}
/* AI 답변의 간단 마크다운(표·굵게)을 HTML로 */
function aiMd(out) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const lines = String(out).split('\n');
  let html = '', tbl = null;
  const flush = () => { if (tbl != null) { html += '<div class="table-wrap"><table>' + tbl + '</table></div>'; tbl = null; } };
  lines.forEach((ln) => {
    const t = ln.trim();
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // 헤더 구분선
      const tag = tbl == null ? 'th' : 'td';
      if (tbl == null) tbl = '';
      tbl += '<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>';
      return;
    }
    flush();
    if (t) html += inline(t.replace(/^[-·•]\s*/, '· ').replace(/^#+\s*/, '')) + '<br>';
  });
  flush();
  return html;
}
/* --- 파일·이미지 첨부 (영수증, 거래명세서 등 → AI가 읽고 정리) --- */
let AI_ATTACH = null; // {name, type, dataUrl}
function aiSetAttach(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && file.type !== 'application/pdf') { toast('이미지 또는 PDF만 첨부할 수 있습니다'); return; }
  if (file.size > 15 * 1024 * 1024) { toast('15MB 이하 파일만 첨부할 수 있습니다'); return; }
  const rd = new FileReader();
  rd.onload = () => {
    AI_ATTACH = { name: file.name, type: file.type, dataUrl: rd.result };
    $('#ai-attach-name').textContent = (file.type === 'application/pdf' ? '📄 ' : '🖼 ') + file.name;
    $('#ai-attach-bar').hidden = false;
    if (!aiKey()) aiPush('bot', '⚠️ 첨부를 읽으려면 AI 키가 필요합니다. ⚙ 버튼에서 설정해 주세요.');
    else aiPush('bot', `첨부 확인: <b>${esc(file.name)}</b><br>무엇을 할지 입력하고 전송하세요. 그냥 전송하면 문서 내용을 표로 정리해 드립니다.`);
  };
  rd.readAsDataURL(file);
}
$('#ai-attach-btn').addEventListener('click', () => $('#ai-file').click());
$('#ai-file').addEventListener('change', () => { if ($('#ai-file').files[0]) aiSetAttach($('#ai-file').files[0]); $('#ai-file').value = ''; });
$('#ai-attach-del').addEventListener('click', () => { AI_ATTACH = null; $('#ai-attach-bar').hidden = true; });
/* 챗봇 창에 파일 끌어다 놓기 */
(() => {
  const d = $('#ai-dock');
  ['dragenter', 'dragover'].forEach((ev) => d.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }));
  d.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) aiSetAttach(f);
  });
})();
/* 크기 조절 · 접기 · 최대화 (상태는 저장되어 다음에도 유지) */
const AI_UI_KEY = DB_PREFIX + 'ai-ui';
function aiUiLoad() { try { return JSON.parse(localStorage.getItem(AI_UI_KEY)) || {}; } catch (e) { return {}; } }
function aiUiSave(patch) { localStorage.setItem(AI_UI_KEY, JSON.stringify(Object.assign(aiUiLoad(), patch))); }
function aiApplyUi() {
  const d = $('#ai-dock');
  const ui = aiUiLoad();
  if (ui.max) {
    d.style.width = 'min(760px, calc(100vw - 44px))';
    d.style.height = 'calc(100vh - 120px)';
  } else {
    d.style.width = ui.w ? ui.w + 'px' : '';
    d.style.height = ui.h ? ui.h + 'px' : '';
  }
  // 위치: 끌어서 옮긴 좌표가 있으면 그 위치로, 최대화 시엔 기본 위치(우하단)로
  if (!ui.max && ui.x != null && ui.y != null && window.innerWidth > 860) {
    const r = d.getBoundingClientRect();
    const x = Math.min(Math.max(ui.x, 0), Math.max(0, window.innerWidth - 80));
    const y = Math.min(Math.max(ui.y, 0), Math.max(0, window.innerHeight - 60));
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.right = 'auto';
    d.style.bottom = 'auto';
  } else {
    d.style.left = '';
    d.style.top = '';
    d.style.right = '';
    d.style.bottom = '';
  }
  d.classList.toggle('ai-min', !!ui.min);
  d.style.maxHeight = ui.max || ui.h ? 'calc(100vh - 110px)' : '';
}
/* 헤더를 잡고 끌어서 창 이동 (위치 저장) */
(() => {
  const d = $('#ai-dock');
  const head = d.querySelector('.ai-head');
  let mv = null;
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return; // 버튼 클릭은 제외
    const r = d.getBoundingClientRect();
    mv = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!mv) return;
    const x = Math.min(Math.max(e.clientX - mv.dx, 0), Math.max(0, window.innerWidth - mv.w));
    const y = Math.min(Math.max(e.clientY - mv.dy, 0), Math.max(0, window.innerHeight - 48));
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.right = 'auto';
    d.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!mv) return;
    const r = d.getBoundingClientRect();
    aiUiSave({ x: Math.round(r.left), y: Math.round(r.top), max: false });
    mv = null;
  });
})();
$('#ai-home').addEventListener('click', () => {
  $('#ai-msgs').innerHTML = '';
  aiUiSave({ min: false });
  aiApplyUi();
  aiGreet();
});
$('#ai-min').addEventListener('click', () => { aiUiSave({ min: !aiUiLoad().min }); aiApplyUi(); });
$('#ai-max').addEventListener('click', () => { aiUiSave({ max: !aiUiLoad().max, min: false }); aiApplyUi(); });
/* 좌상단 모서리 드래그로 크기 조절 (우하단 고정) */
(() => {
  const d = $('#ai-dock');
  let drag = null;
  $('#ai-resize').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const r = d.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, rt: r.right, bt: r.bottom, moved: d.style.left !== '' && d.style.left !== 'auto' };
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const w = Math.min(Math.max(drag.w + (drag.x - e.clientX), 300), window.innerWidth - 44);
    const h = Math.min(Math.max(drag.h + (drag.y - e.clientY), 320), window.innerHeight - 110);
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    d.style.maxHeight = 'calc(100vh - 110px)';
    if (drag.moved) { // 위치를 옮긴 상태면 우하단 모서리를 고정한 채 좌상단이 늘어나게
      d.style.left = Math.max(0, drag.rt - w) + 'px';
      d.style.top = Math.max(0, drag.bt - h) + 'px';
    }
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const r = d.getBoundingClientRect();
    const patch = { w: Math.round(r.width), h: Math.round(r.height), max: false };
    if (drag.moved) { patch.x = Math.round(r.left); patch.y = Math.round(r.top); }
    aiUiSave(patch);
    drag = null;
  });
})();
/* 열기/닫기 + 이벤트 */
$('#ai-fab').addEventListener('click', () => {
  const d = $('#ai-dock');
  d.hidden = !d.hidden;
  if (!d.hidden) {
    aiApplyUi();
    aiUpdateModelLabel();
    if (!$('#ai-msgs').children.length) aiGreet();
  }
});
$('#ai-close').addEventListener('click', () => ($('#ai-dock').hidden = true));
$('#ai-send').addEventListener('click', () => { aiSend($('#ai-text').value); $('#ai-text').value = ''; });
$('#ai-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { aiSend($('#ai-text').value); $('#ai-text').value = ''; } });
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-ai-goto]');
  if (g) { showPage(g.dataset.aiGoto); return; }
  const q = e.target.closest('[data-ai-q]');
  if (q) aiSend(q.dataset.aiQ);
});
/* 오늘의 유머 한마디 (날짜 기준으로 매일 하나씩) */
const AI_HUMOR = [
  '재고가 없으면 걱정, 많아도 걱정… 그래서 오늘도 우리는 "적정"을 찾아 떠납니다. 🧭',
  '발주서가 제일 좋아하는 계절은? 봄! 자꾸 "발주(발조)"하니까요. 🌸',
  '창고 정리의 제1법칙: 찾는 물건은 항상 맨 아래 박스에 있다. 📦',
  '납기일이 다가올수록 전화벨은 커진다 — 구매팀 상대성 이론. ☎️',
  '오늘의 명언: 미리 발주한 자, 야근을 면하리라. 🌙',
  '재고조사 하다 발견한 것: 먼지, 추억, 그리고 작년의 나의 실수. 😅',
  '거래처 사장님이 "곧 됩니다"라고 하면… 곧의 단위는 주(週)입니다. ⏳',
  '파우치가 파업하면? 포장 불가! 그래서 오늘도 재고를 챙깁니다. 💪',
  '구매팀의 초능력: 견적서만 봐도 단가 인상이 느껴진다. 🔮',
  '엑셀이 멈추는 순간, 심장도 같이 멈춘다 — 저장은 습관처럼! 💾',
  '월요일의 재고는 금요일보다 무겁다. 기분 탓이 아닙니다. 🏋️',
  '"단가 조금만 내려주세요"는 구매팀의 아침 인사입니다. 🙇',
  '원단은 미터로 재지만, 우리의 인내심은 무한대로 잽니다. 📏',
  '오늘 입고 예정이 진짜 오늘 오면… 그날은 회식각. 🎉',
  '박스는 쌓이고, 경험치도 쌓인다 — 우리는 매일 레벨업 중. 🎮',
  '적정재고의 "적정"은 사장님과 창고지기의 생각이 다르다. 🤝',
  'BOM을 알면 자재가 보이고, 자재가 보이면 야근이 줄어든다. 👀',
  '전화 한 통으로 납기를 당기는 사람, 그가 진정한 협상왕. 👑',
  '재고 실사 날의 만보기: 평소의 3배. 운동은 창고에서. 👟',
  '"이거 어디 있지?"의 답은 언제나 방금 지나친 그 선반. 🗄️',
  '견적 비교 3사는 기본, 마음의 평화는 덤. 🧘',
  '창고의 계절은 둘뿐이다 — 바쁨과 매우 바쁨. 🌦️',
  '오늘도 무사고 입고! 지게차 아저씨께 커피 한 잔. ☕',
  '컨테이너가 도착하면 다이어트 시작 — 어차피 다 나른다. 📦',
  '단가표는 외우는 게 아니라 몸이 기억하는 것. 🧠',
  '발주 넣고 기도하기 — 구매팀의 전통 의식. 🙏',
  '"내일 아침 일찍 보내드릴게요"의 아침은 오후 4시. 🕓',
  '재고가 딱 맞아떨어진 날은 로또를 사야 하는 날. 🍀',
  '구매팀 좌우명: 싸게, 빠르게, 그러나 정확하게. 🎯',
  '오늘 챙긴 자재가 내일의 생산을 만든다 — 우리 모두 파이팅! 🔥',
];
const aiTodayHumor = () => {
  const d = new Date();
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return AI_HUMOR[dayOfYear % AI_HUMOR.length];
};
/* 접속 시: 배지 표시 + 긴급 품목이 있으면 자동으로 열어 첫 화면 안내 (브라우저 세션당 1회) */
function aiGreet() {
  aiPush('bot', `안녕하세요, 구매 어시스턴트입니다. 👋<br><br>😄 <b>오늘의 한마디</b><br>${aiTodayHumor()}`);
  const urgent = alertRows().filter((r) => r.state === '긴급 발주').length;
  if (urgent) aiPush('bot', `참, 오늘 🔴 긴급 발주 필요 품목이 <b>${fmt(urgent)}건</b> 있어요. <button class="btn small" data-ai-q="긴급 발주">목록 보기</button>`);
}
(function aiInit() {
  try {
    const urgent = alertRows().filter((r) => r.state === '긴급 발주').length;
    const badge = $('#ai-badge');
    if (urgent > 0) {
      badge.textContent = urgent > 99 ? '99+' : urgent;
      badge.hidden = false;
    }
    if (urgent > 0 && !sessionStorage.getItem('ai-greeted')) {
      sessionStorage.setItem('ai-greeted', '1');
      $('#ai-dock').hidden = false;
      aiApplyUi();
      aiGreet();
    }
  } catch (e) { console.warn('어시스턴트 초기화 실패', e); }
})();

/* 뒤로/앞으로 (마우스 제스처 포함) → 화면 전환 */
window.addEventListener('popstate', (e) => {
  const page = (e.state && e.state.page) || location.hash.replace('#', '') || 'home';
  showPage(PAGE_TITLES[page] || page === 'home' ? page : 'home', { fromHistory: true });
});

/* 시작 화면: 주소의 #페이지 우선, 없으면 홈 */
const __initPage = location.hash.replace('#', '');
showPage(PAGE_TITLES[__initPage] ? __initPage : 'home', { fromHistory: true });
history.replaceState({ page: PAGE_TITLES[__initPage] ? __initPage : 'home' }, '', location.hash || '#home');
