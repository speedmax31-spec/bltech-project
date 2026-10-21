/* Firestore 전체 내려받기 — 모든 컬렉션을 JSON 과 CSV 로 저장
 * 사용법: node export-firestore.js [출력폴더]
 *   기본 출력: BLTECH_PROJECT/firestore-export/{YYYY-MM-DD}/
 *   json/{컬렉션}.json        문서 배열 [{ id필드 포함 원본 그대로 }]  (가져오기 스크립트가 읽는 정본)
 *   json/_all.json            { 컬렉션: [문서…] } 한 파일
 *   json/appstate-decoded/    앱 상태 값을 풀어 쓴 것(분할 저장분 합침, JSON 이면 파싱)
 *   csv/{컬렉션}.csv          엑셀용(UTF-8 BOM). 배열·객체 칸은 JSON 문자열
 *   manifest.json             컬렉션별 건수·필드 목록·내려받은 시각 */
const fs = require('fs');
const path = require('path');
const R = require('./fs-rest.js');

const COMMON_LAST = ['legacyId', 'source', 'createdAt', 'createdBy', 'createdByEmail', 'updatedAt', 'updatedBy', 'updatedByEmail'];
const kstDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(docs) {
  const seen = new Set();
  docs.forEach((d) => Object.keys(d).forEach((k) => seen.add(k)));
  // 열 순서: id → 업무 필드(가나다/알파벳) → 공통 필드
  const body = [...seen].filter((k) => k !== 'id' && k !== '_docId' && !COMMON_LAST.includes(k)).sort();
  const cols = ['_docId'].concat(seen.has('id') ? ['id'] : [], body, COMMON_LAST.filter((k) => seen.has(k)));
  const lines = [cols.join(',')];
  docs.forEach((d) => lines.push(cols.map((c) => csvCell(d[c])).join(',')));
  return { text: '﻿' + lines.join('\r\n') + '\r\n', cols };
}

(async () => {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'firestore-export', kstDate()));
  fs.mkdirSync(path.join(out, 'json', 'appstate-decoded'), { recursive: true });
  fs.mkdirSync(path.join(out, 'csv'), { recursive: true });
  const H = await R.H();
  const c = await fetch(`https://firestore.googleapis.com/v1/projects/${R.PROJECT}/databases/(default)/documents:listCollectionIds`, { method: 'POST', headers: H, body: '{}' }).then((r) => r.json());
  const cols = (c.collectionIds || []).sort();
  const all = {}, manifest = { project: R.PROJECT, exportedAt: new Date().toISOString(), collections: {} };
  for (const col of cols) {
    const raw = await R.listAll(col);
    // _docId = Firestore 문서 이름. 업무 문서는 규칙상 id 필드와 같다
    const docs = raw.map((d) => Object.assign({ _docId: R.idOf(d) }, R.fromFs({ mapValue: { fields: d.fields || {} } })))
      .sort((a, b) => (a._docId < b._docId ? -1 : a._docId > b._docId ? 1 : 0));
    all[col] = docs;
    fs.writeFileSync(path.join(out, 'json', col + '.json'), JSON.stringify(docs, null, 1));
    const csv = toCsv(docs);
    fs.writeFileSync(path.join(out, 'csv', col + '.csv'), csv.text);
    const mismatch = docs.filter((d) => 'id' in d && d.id !== d._docId).length;
    manifest.collections[col] = { count: docs.length, fields: csv.cols, idMismatch: mismatch };
    console.log(`${col.padEnd(15)} ${String(docs.length).padStart(6)}건 → json/${col}.json · csv/${col}.csv (열 ${csv.cols.length}개)`);
  }
  fs.writeFileSync(path.join(out, 'json', '_all.json'), JSON.stringify(all));
  // 앱 상태 풀어 쓰기: {키}Part0.. 분할분 합치고, 값이 JSON 이면 파싱
  if (all.appstate) {
    const metas = {}, chunks = {};
    all.appstate.forEach((d) => {
      const m = /^(.+)Part(\d+)$/.exec(d._docId);
      if (m) (chunks[m[1]] = chunks[m[1]] || {})[+m[2]] = d.v;
      else metas[d._docId] = d;
    });
    Object.keys(metas).forEach((id) => {
      const d = metas[id];
      let v = d.v;
      if (d.c) { v = ''; for (let i = 0; i < d.c; i++) v += (chunks[id] || {})[i] || ''; }
      let val = v;
      try { val = JSON.parse(v); } catch (e) { /* 문자열 값 그대로 */ }
      fs.writeFileSync(path.join(out, 'json', 'appstate-decoded', id + '.json'), JSON.stringify({ key: id, savedAt: d.u || null, value: val }, null, 1));
    });
    manifest.appstateKeys = Object.keys(metas).sort();
    console.log(`appstate 풀어쓰기 ${Object.keys(metas).length}개 → json/appstate-decoded/`);
  }
  manifest.total = Object.values(manifest.collections).reduce((a, x) => a + x.count, 0);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`합계 ${manifest.total}건 · 출력 폴더: ${out}`);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
