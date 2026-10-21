/* idcodes.js 검증: 실데이터 전수 왕복(화면→문서→화면) · 필드명 camelCase · 중첩배열 · ID 형식 */
const fs = require('fs');
const path = require('path');
const IDC = require(path.join(__dirname, '..', 'bltech-purchase', 'idcodes.js'));
const { readKvAll } = require('./fs-rest.js');

(async () => {
  const kv = await readKvAll();
  const camel = /^[a-z][a-zA-Z0-9]*$/;
  let fail = 0;
  for (const name of Object.keys(IDC.COLS)) {
    const def = IDC.COLS[name];
    const raw = kv[def.localKey];
    if (raw == null) { console.log(`${name.padEnd(15)} (데이터 없음)`); continue; }
    const items = IDC.extract(def, raw);
    let rt = 0, badField = new Set(), nested = 0, keyDup = 0;
    const keys = new Set();
    items.forEach(({ key, rec }, i) => {
      if (keys.has(key)) keyDup++;
      keys.add(key);
      const group = def.group(rec);
      const docId = IDC.formatId(def, group, i + 1);
      if (!IDC.ID_RE[name].test(docId)) { fail++; console.log('  ID형식 위반', docId); }
      const doc = IDC.toDoc(def, key, rec, docId, { now: '2026-09-30T00:00:00.000Z', createdBy: 'test' });
      (function walk(o, p) {
        if (Array.isArray(o)) { o.forEach((x) => { if (Array.isArray(x)) nested++; walk(x, p); }); return; }
        if (o && typeof o === 'object') Object.keys(o).forEach((k) => { if (!camel.test(k)) badField.add(p + k); walk(o[k], p + k + '.'); });
      })(doc, '');
      const back = IDC.fromDoc(def, doc);
      // 원본에 없던 createdAt/updatedAt 이 채워지는 것은 허용(문서 공통 필드 규칙)
      const want = Object.assign({}, rec);
      if (def.kind === 'array') { if (!('createdAt' in want)) want.createdAt = back.rec.createdAt; if (!('updatedAt' in want)) want.updatedAt = back.rec.updatedAt; }
      Object.keys(want).forEach((k) => { if (want[k] === undefined) delete want[k]; });
      if (IDC.stable(want) !== IDC.stable(back.rec) || back.key !== key) {
        rt++;
        if (rt <= 2) console.log('  왕복 불일치 예:', key, '\n   원본', IDC.stable(want).slice(0, 300), '\n   복원', IDC.stable(back.rec).slice(0, 300));
      }
    });
    // 조립까지 왕복
    const rebuilt = IDC.assemble(def, items.map((x) => x.rec), IDC.restOf(def, raw));
    const sameWhole = IDC.stable(rebuilt) === IDC.stable(JSON.parse(raw));
    fail += rt + badField.size + nested + keyDup + (sameWhole ? 0 : 1);
    console.log(`${name.padEnd(15)} ${String(items.length).padStart(5)}건 | 왕복불일치 ${rt} | 비카멜필드 ${badField.size}${badField.size ? ' ' + [...badField].slice(0, 5).join(',') : ''} | 중첩배열 ${nested} | 키중복 ${keyDup} | 전체재조립 ${sameWhole ? 'OK' : '불일치'}`);
  }
  // appstate 이름 왕복
  Object.keys(kv).filter((k) => !IDC.BY_LOCAL[k]).forEach((k) => {
    const id = IDC.stateDocId(k);
    if (IDC.stateLocalKey(id) !== k || !camel.test(id)) { fail++; console.log('  appstate 이름 왕복 실패', k, id); }
  });
  console.log(fail ? `❌ 실패 ${fail}건` : '✅ 전 항목 통과');
  process.exit(fail ? 1 : 0);
})();
