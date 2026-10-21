/* 빠진 수집 날짜 찾기 — 오늘(한국시간) 포함 최근 N일 중 appstate/rmnews 에 없는 날짜를 오래된 순으로 출력
 * 사용법: node missing-days.js [최근일수=7] [최대개수=6]
 * 출력 마지막 줄: MISSING=YYYY-MM-DD,YYYY-MM-DD,...  (없으면 MISSING=) */
const R = require('./fs-rest.js');
const WINDOW = Number(process.argv[2] || 7);
const MAX = Number(process.argv[3] || 6);

function kstDate(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
(async () => {
  const H = await R.H();
  const j = await fetch(R.BASE + '/appstate/rmnews', { headers: H }).then((r) => r.json());
  const have = new Set();
  if (j.fields && j.fields.v) JSON.parse(j.fields.v.stringValue).days.forEach((d) => have.add(d.date));
  const missing = [];
  for (let i = WINDOW - 1; i >= 0; i--) { const d = kstDate(i); if (!have.has(d)) missing.push(d); }
  const pick = missing.slice(-MAX); // 너무 많으면 최근 것부터 MAX개
  console.log(`최근 ${WINDOW}일 중 수집된 날짜: ${[...have].filter((d) => d >= kstDate(WINDOW - 1)).sort().join(', ') || '없음'}`);
  console.log(`빠진 날짜: ${missing.join(', ') || '없음'}${missing.length > pick.length ? ` (최근 ${MAX}개만 수집)` : ''}`);
  console.log('MISSING=' + pick.join(','));
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
