/* 데이터 적재 규칙 전환 (1회) — docs/DATA-ID-RULES.md §7
 *  1) kv 전체 백업 JSON 저장 (backup/kv-backup-{시각}.json)
 *  2) 옛 미러 컬렉션 삭제 (materials 옛 ID, finishedGoods, purchaseOrders, productMappings, billOfMaterials …)
 *  3) 동기화 엔진(앱과 같은 코드)으로 업무 데이터를 코드 ID 문서로 등록 — 그룹 안에서는 옛 번호 순서대로 1부터
 *     meta/seq_{그룹} 을 쓴 번호로 맞추고, 앱 상태는 appstate 로 복사
 *  4) 검증: 문서 수·ID 형식·id 필드
 * kv 컬렉션 삭제는 사이트 배포 후 `node convert-to-rules.js --drop-kv` 로 따로 한다.
 * 사용법: node convert-to-rules.js [--dry] | --drop-kv */
const fs = require('fs');
const path = require('path');
const R = require('./fs-rest.js');
const IDC = require('../bltech-purchase/idcodes.js');
const { createEngine } = require('../bltech-purchase/sync-engine.js');

const DRY = process.argv.includes('--dry');
const OLD_MIRRORS = ['materials', 'finishedGoods', 'purchaseOrders', 'issueSlips', 'itemCodes', 'purchaseOrderForms', 'productMappings', 'billOfMaterials'];

async function dropCollection(col) {
  const docs = await R.listAll(col, 'id');
  if (docs.length && !DRY) await R.commit(docs.map((d) => ({ delete: d.name })), col + ' 삭제');
  return docs.length;
}

async function main() {
  if (process.argv.includes('--drop-kv')) {
    const kvNow = await R.readStateCollection('kv', IDC.stateLocalKey);
    const app = await R.readStateCollection('appstate', (id) => id);
    // 전환 기록보다 늦은 kv 변경 = 전환 뒤 옛 코드가 쓴 것 → 지우지 않고 멈춘다
    const mig = app.migrationInfo ? JSON.parse(app.migrationInfo.v) : {};
    const late = Object.keys(kvNow).filter((k) => !mig[k] || kvNow[k].u > mig[k]);
    if (late.length) {
      console.log('⚠️ 전환 뒤 kv 에 새로 쓰인 키:', late.join(', '), '— kv 를 지우지 않고 중단 (수동 확인 필요)');
      process.exit(2);
    }
    console.log('kv 삭제:', await dropCollection('kv'), '건 — 전환 뒤 늦은 변경 없음');
    return;
  }
  // 1) 백업
  const kv = await R.readStateCollection('kv', IDC.stateLocalKey);
  if (!Object.keys(kv).length) throw new Error('kv 가 비어 있습니다 — 이미 전환했는지 확인');
  fs.mkdirSync(path.join(__dirname, 'backup'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bfile = path.join(__dirname, 'backup', `kv-backup-${stamp}.json`);
  fs.writeFileSync(bfile, JSON.stringify(kv));
  console.log(`[1/4] 백업 저장: ${path.basename(bfile)} (${(fs.statSync(bfile).size / 1024 / 1024).toFixed(1)}MB, ${Object.keys(kv).length}개 키)`);

  // 2) 옛 미러 삭제 (새 규칙 ID가 아닌 문서만 — 이미 전환된 코드 ID 문서는 건드리지 않음)
  console.log('[2/4] 옛 미러 컬렉션 삭제' + (DRY ? ' (미리보기)' : ''));
  for (const c of OLD_MIRRORS) {
    const docs = (await R.listAll(c, 'id')).filter((d) => !(IDC.ID_RE[c] && IDC.ID_RE[c].test(R.idOf(d))));
    if (docs.length && !DRY) await R.commit(docs.map((d) => ({ delete: d.name })), c + ' 삭제');
    if (docs.length) console.log(`  ${c}: ${docs.length}건`);
  }

  // 3) 엔진으로 등록 (메모리 localStorage + REST 입출력, 번호는 메모리에서 발급 후 카운터 기록)
  console.log('[3/4] 코드 ID 문서 등록' + (DRY ? ' (미리보기)' : ''));
  const store = new Map();
  Object.keys(kv).forEach((k) => store.set(k, kv[k].v));
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), key: (i) => [...store.keys()][i], get length() { return store.size; } };
  const seq = {};
  const counts = {};
  const io = {
    // 전환은 항상 빈 상태에서 시작한 것으로 본다 — 중간에 멈춘 흔적이 있어도 ID가 결정적(옛 번호 순)이라 같은 ID로 덮어쓴다
    listDocs: async () => [],
    commit: async (ops) => {
      ops.forEach((o) => { counts[o.col] = (counts[o.col] || 0) + (o.t === 'set' ? 1 : 0); });
      if (DRY) return;
      await R.commit(ops.map((o) => (o.t === 'set'
        ? { update: { name: R.docName(o.col, o.id), fields: R.toFs(o.data).mapValue.fields } }
        : { delete: R.docName(o.col, o.id) })), 'commit');
    },
    reserve: async (g, n) => { const cur = seq[g] || 0; seq[g] = cur + n; return cur + 1; },
    listState: async () => [],
    setState: async (ws) => {
      counts.appstate = (counts.appstate || 0) + ws.length;
      if (DRY) return;
      await R.commit(ws.map((w) => ({ update: { name: R.docName('appstate', w.id), fields: R.toFs(w.data).mapValue.fields } })), 'appstate');
    },
  };
  const engine = createEngine({ io, storage, user: { uid: 'purchase-migration', email: null } });
  await engine.startup();
  const now = new Date().toISOString();
  const metaWrites = Object.keys(seq).map((g) => ({ update: { name: R.docName('meta', 'seq_' + g), fields: R.toFs({ n: seq[g], group: g, updatedAt: now }).mapValue.fields } }));
  // 전환 기록: 키별 원본 시각 — 옛 동기화에서 넘어오는 기기가 자기 미저장 변경을 지킬지 판단하는 기준
  const migU = {};
  Object.keys(kv).forEach((k) => { migU[k] = kv[k].u; });
  metaWrites.push({ update: { name: R.docName('appstate', 'migrationInfo'), fields: R.toFs({ u: now, c: 0, v: JSON.stringify(migU) }).mapValue.fields } });
  if (!DRY) await R.commit(metaWrites, 'meta');
  Object.keys(counts).forEach((c) => console.log(`  ${c}: ${counts[c]}건`));
  console.log(`  meta/seq_*: ${metaWrites.length}개 그룹`);

  // 4) 검증
  if (DRY) { console.log('[4/4] 미리보기라 검증 생략'); return; }
  console.log('[4/4] 검증');
  let bad = 0;
  for (const name of Object.keys(IDC.COLS)) {
    const def = IDC.COLS[name];
    const want = kv[def.localKey] ? IDC.extract(def, kv[def.localKey].v).length : 0;
    const docs = await R.listAll(def.col, 'id');
    const wrongId = docs.filter((d) => !IDC.ID_RE[name].test(R.idOf(d)) || (d.fields && d.fields.id && d.fields.id.stringValue !== R.idOf(d))).length;
    const ok = docs.length === want && !wrongId;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${def.col.padEnd(15)} 원본 ${want} → 문서 ${docs.length}${wrongId ? ` · ID이상 ${wrongId}` : ''}`);
  }
  console.log(bad ? `❌ 검증 실패 ${bad}` : '✅ 전환 완료');
  if (bad) process.exit(1);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
