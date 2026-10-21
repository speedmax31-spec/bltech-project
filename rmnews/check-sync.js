/* Firestore 업로드 현황 점검: 컬렉션별 건수·최근 수정 시각, 앱 상태(appstate) 키별 저장 시각 */
const R = require('./fs-rest.js');
const kst = (t) => t ? new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '-';
(async () => {
  for (const col of ['materials', 'finishedstocks', 'purchaseorders', 'materialissues', 'itemcodes', 'purchaseforms', 'boms', 'productmap']) {
    const docs = (await R.listAll(col)).map((d) => R.fromFs({ mapValue: { fields: d.fields || {} } }));
    const last = docs.map((d) => d.updatedAt || d.createdAt || '').sort().pop();
    const who = docs.filter((d) => d.updatedAt === last).map((d) => d.updatedByEmail)[0];
    console.log(`${col.padEnd(15)} ${String(docs.length).padStart(5)}건 · 최근수정 ${kst(last)} ${who || ''}`);
  }
  const st = (await R.listAll('appstate')).map((d) => Object.assign({ id: R.idOf(d) }, R.fromFs({ mapValue: { fields: d.fields || {} } })));
  st.filter((d) => !/Part\d+$/.test(d.id)).sort((a, b) => String(b.u).localeCompare(String(a.u)))
    .forEach((d) => console.log(`appstate/${d.id.padEnd(22)} 저장 ${kst(typeof d.u === 'number' ? d.u : d.u)}${d.c ? ` (분할 ${d.c})` : ''}`));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
