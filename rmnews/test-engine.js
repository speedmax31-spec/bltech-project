/* 동기화 엔진 시나리오 테스트 (메모리 DB · 메모리 localStorage) */
const path = require('path');
const IDC = require(path.join(__dirname, '..', 'bltech-purchase', 'idcodes.js'));
const { createEngine } = require(path.join(__dirname, '..', 'bltech-purchase', 'sync-engine.js'));

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i], get length() { return m.size; }, _m: m,
  };
}
function memDb() {
  const cols = {}, meta = {}, state = {};
  let writes = 0;
  return {
    cols, meta, state, get writes() { return writes; },
    io: {
      listDocs: async (c) => Object.entries(cols[c] || {}).map(([id, data]) => ({ id, data: JSON.parse(JSON.stringify(data)) })),
      commit: async (ops) => ops.forEach((o) => {
        writes++;
        cols[o.col] = cols[o.col] || {};
        if (o.t === 'set') {
          if (!IDC.ID_RE[o.col].test(o.id)) throw new Error('규칙 위반 ID ' + o.id);
          if (o.data.id !== o.id) throw new Error('id 필드 불일치 ' + o.id);
          cols[o.col][o.id] = JSON.parse(JSON.stringify(o.data));
        } else delete cols[o.col][o.id];
      }),
      reserve: async (g, n) => { const cur = meta['seq_' + g] || 0; meta['seq_' + g] = cur + n; return cur + 1; },
      listState: async () => Object.entries(state).map(([id, data]) => ({ id, data })),
      setState: async (ws) => ws.forEach((w) => { state[w.id] = w.data; }),
    },
  };
}
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ❌', msg); } }
const U1 = { uid: 'u1', email: 'a@bl-tech.co.kr' }, U2 = { uid: 'u2', email: 'b@bl-tech.co.kr' };
const K = (c) => IDC.COLS[c].localKey;

(async () => {
  const db = memDb();
  // --- 1) 첫 등록: 로컬 데이터를 코드 ID로 올린다 ---
  const orders = [
    { id: 1, date: '2026-06-08', supplier: '엠텍스', item: '68TEX 3INCH', qty: 10, price: 100, status: '미입고' },
    { id: 2, date: '2026-06-08', supplier: '성산', item: '각캔', qty: 5, price: 50, status: '입고완료', inQty: 5 },
    { id: 3, date: '2026-06-09', supplier: '성산', item: '박스', qty: 1, price: 9 },
  ];
  const mats = [{ id: 1, name: '코어 2INCH', newCode: 'RM-COR-SOL-0020', stock: 64000, category: '원재료' }, { id: 2, name: '미코드 품목', category: '부재료', stock: 3 }];
  const issues = [{ id: 1, no: '20260818-0001', date: '2026-08-18', wh: '춘천', dept: '구매', manager: '차훈', lines: [{ code: 'RM-COR-SOL-0020', name: '코어', unit: 'EA', qty: 3, gubun: '생산투입원재료', note: '' }] }];
  const codes = [{ id: 1, name: '코어', code: 'RM-COR-SOL-0020', spec: '2"', engName: 'CORE', category: '원자재', unit: 'EA', subclass: '코어', status: '사용' }];
  const pos = [{ id: 'PO1727', to: '엠텍스', fax: '02-1', date: '2026-09-30', mgr: '차 훈', items: [{ name: '68TEX', unit: 'M', qty: '100', price: '102', due: '', note: '' }], notes: '* 연락' }];
  const bom = { updatedAt: '2026-08-17', entries: { 'FP-NAC-2F-BL': { n: 'NAC-2F BL', region: '내수', line: 'CAST', customer: '', c: [['RM-COR', '코어', 1, 'EA']] }, 'SF-X': { n: 'X', region: '반제품', line: '배관보수테이프', customer: '', c: [] } } };
  const pmap = { updatedAt: '2026-08-10', rows: [{ region: '해외', customer: 'LCIML', fp: 'FP-A', custCode: 'A1', name: 'A' }, { region: '내수', customer: '', fp: 'FP-B', custCode: '', name: 'B' }] };
  const s1 = memStorage({ [K('purchaseorders')]: JSON.stringify(orders), [K('materials')]: JSON.stringify(mats), [K('materialissues')]: JSON.stringify(issues), [K('itemcodes')]: JSON.stringify(codes), [K('purchaseforms')]: JSON.stringify(pos), [K('boms')]: JSON.stringify(bom), [K('productmap')]: JSON.stringify(pmap), 'bl-purchase-cost': '{"x":1}' });
  const e1 = createEngine({ io: db.io, storage: s1, user: U1 });
  await e1.startup();
  const po = db.cols.purchaseorders;
  ok(po['PUR-20260608-001'] && po['PUR-20260608-002'] && po['PUR-20260609-001'], '발주 ID가 날짜 그룹별 일련번호: ' + Object.keys(po));
  ok(po['PUR-20260608-001'].vendor === '엠텍스' && po['PUR-20260608-001'].materialName === '68TEX 3INCH' && po['PUR-20260608-001'].unitPrice === 100, '변수 사전 이름으로 저장');
  ok(po['PUR-20260608-001'].legacyId === 1 && po['PUR-20260608-001'].createdByEmail === U1.email && po['PUR-20260608-001'].source === 'purchase', '공통 필드');
  ok(db.cols.materials['MAT-RM-0001'] && db.cols.materials['MAT-SM-0001'], '자재 ID 분류 토큰: ' + Object.keys(db.cols.materials));
  ok(db.cols.materialissues['ISS-20260818-001'] && db.cols.materialissues['ISS-20260818-001'].lines[0].issueType === '생산투입원재료', '출고 전표 ID·줄 변수명');
  ok(db.cols.itemcodes['ITM-RM-0001'] && db.cols.itemcodes['ITM-RM-0001'].subCategory === '코어', '품목코드');
  ok(db.cols.purchaseforms['POF-20260930-01'] && db.cols.purchaseforms['POF-20260930-01'].items[0].materialName === '68TEX', '발주서');
  ok(db.cols.boms['BOM-CAST-0001'] && db.cols.boms['BOM-PXRT-0001'] && db.cols.boms['BOM-CAST-0001'].zone === '국내', 'BOM 공정 토큰·zone: ' + Object.keys(db.cols.boms));
  ok(db.cols.productmap['PMP-00001'] && db.cols.productmap['PMP-00002'], '품목매핑 PMP');
  ok(db.meta['seq_PUR-20260608'] === 2 && db.meta['seq_PMP'] === 2, '일련번호 카운터');
  ok(db.state.cost && db.state.cost.v === '{"x":1}', '앱 상태는 appstate/cost');

  // --- 2) 수정: ID 불변, 날짜를 바꿔도 ID 그대로 ---
  let arr = JSON.parse(s1.getItem(K('purchaseorders')));
  arr[0] = Object.assign({}, arr[0], { qty: 20, date: '2026-07-01' });
  s1.setItem(K('purchaseorders'), JSON.stringify(arr));
  const w0 = db.writes;
  await e1.push();
  ok(db.writes - w0 === 1, '수정 1건만 쓰기 (' + (db.writes - w0) + ')');
  ok(po['PUR-20260608-001'].qty === 20 && po['PUR-20260608-001'].date === '2026-07-01' && !po['PUR-20260701-001'], '날짜를 바꿔도 ID 불변');
  ok(po['PUR-20260608-001'].createdByEmail === U1.email && po['PUR-20260608-001'].updatedByEmail === U1.email, '생성자 보존');

  // --- 3) 신규 등록 → 다음 번호 ---
  arr = JSON.parse(s1.getItem(K('purchaseorders')));
  arr.push({ id: 4, date: '2026-06-08', supplier: '새업체', item: '신규', qty: 1 });
  s1.setItem(K('purchaseorders'), JSON.stringify(arr));
  await e1.push();
  ok(po['PUR-20260608-003'] && po['PUR-20260608-003'].legacyId === 4, '신규는 그룹의 다음 번호(003)');

  // --- 4) 삭제 → 번호 재사용 안 함 ---
  arr = JSON.parse(s1.getItem(K('purchaseorders'))).filter((o) => o.id !== 4);
  s1.setItem(K('purchaseorders'), JSON.stringify(arr));
  await e1.push();
  ok(!po['PUR-20260608-003'], '삭제 반영');
  arr.push({ id: 5, date: '2026-06-08', item: '또 신규', qty: 1 });
  s1.setItem(K('purchaseorders'), JSON.stringify(arr));
  await e1.push();
  ok(po['PUR-20260608-004'] && !po['PUR-20260608-003'], '지운 번호는 비워 두고 004 발급');

  // --- 5) 다른 기기(처음 접속): 클라우드가 정본, 쓰기 없음 ---
  const s2 = memStorage({ [K('purchaseorders')]: JSON.stringify([{ id: 1, item: '옛 시드' }]) });
  const e2 = createEngine({ io: db.io, storage: s2, user: U2 });
  const w1 = db.writes;
  const ch = await e2.startup();
  const l2 = JSON.parse(s2.getItem(K('purchaseorders')));
  ok(ch && l2.length === 4 && l2.find((o) => o.id === 1).qty === 20, '새 기기는 클라우드 데이터로 교체');
  ok(db.writes - w1 === 0, '새 기기 첫 접속 시 쓰기 없음 (' + (db.writes - w1) + ')');
  ok(JSON.parse(s2.getItem(K('boms'))).entries['FP-NAC-2F-BL'].c[0][0] === 'RM-COR' && JSON.parse(s2.getItem(K('boms'))).updatedAt === '2026-08-17', 'BOM 복원(부가정보 포함)');
  ok(JSON.parse(s2.getItem(K('productmap'))).rows.length === 2 && JSON.parse(s2.getItem(K('productmap'))).updatedAt === '2026-08-10', '매핑 복원(부가정보 포함)');
  ok(!s2.getItem('bl-purchase-bom-info') && db.state.bomInfo, '부가정보는 appstate/bomInfo 에만');
  ok(s2.getItem('bl-purchase-cost') === '{"x":1}', '앱 상태 복원');

  // --- 6) 기기2 수정 → 기기1 재시작 시 반영, 기기1의 오프라인 수정도 보존 ---
  let a2 = JSON.parse(s2.getItem(K('purchaseorders')));
  a2.find((o) => o.id === 2).note = '기기2 수정';
  s2.setItem(K('purchaseorders'), JSON.stringify(a2));
  await e2.push();
  let a1 = JSON.parse(s1.getItem(K('purchaseorders')));
  a1.find((o) => o.id === 3).note = '기기1 오프라인 수정';
  s1.setItem(K('purchaseorders'), JSON.stringify(a1));
  const e1b = createEngine({ io: db.io, storage: s1, user: U1 });
  await e1b.startup();
  a1 = JSON.parse(s1.getItem(K('purchaseorders')));
  ok(a1.find((o) => o.id === 2).note === '기기2 수정' && a1.find((o) => o.id === 3).note === '기기1 오프라인 수정', '양쪽 수정 모두 보존');
  ok(po['PUR-20260609-001'].note === '기기1 오프라인 수정', '오프라인 수정 업로드');

  // --- 7) 두 기기가 같은 내부 번호로 동시 신규 → 둘 다 보존, 번호 재부여 ---
  a1 = JSON.parse(s1.getItem(K('purchaseorders'))); a1.push({ id: 9, date: '2026-06-10', item: '기기1 신규' }); s1.setItem(K('purchaseorders'), JSON.stringify(a1));
  a2 = JSON.parse(s2.getItem(K('purchaseorders'))); a2.push({ id: 9, date: '2026-06-10', item: '기기2 신규' }); s2.setItem(K('purchaseorders'), JSON.stringify(a2));
  await e1b.push(); await e2.push();
  const e1c = createEngine({ io: db.io, storage: s1, user: U1 });
  await e1c.startup();
  a1 = JSON.parse(s1.getItem(K('purchaseorders')));
  const ids = a1.map((o) => o.id);
  ok(a1.some((o) => o.item === '기기1 신규') && a1.some((o) => o.item === '기기2 신규') && new Set(ids).size === ids.length, '충돌 번호 재부여 후 모두 보존: ' + ids);
  ok(po['PUR-20260610-001'] && po['PUR-20260610-002'], '서로 다른 코드 ID');

  // --- 8) 매핑 재업로드(같은 행) → 새 ID 안 생김 ---
  const beforePmp = Object.keys(db.cols.productmap).length;
  const pm = JSON.parse(s1.getItem(K('productmap')));
  pm.rows = pm.rows.map((r) => Object.assign({}, r)); pm.updatedAt = '2026-09-30';
  s1.setItem(K('productmap'), JSON.stringify(pm));
  await e1c.push();
  ok(Object.keys(db.cols.productmap).length === beforePmp && db.meta['seq_PMP'] === 2, '같은 행 재업로드 시 ID 그대로');
  ok(JSON.parse(db.state.productmapInfo.v).updatedAt === '2026-09-30', '재업로드 날짜 부가정보 업로드');
  const e2b = createEngine({ io: db.io, storage: s2, user: U2 });
  await e2b.startup();
  ok(JSON.parse(s2.getItem(K('productmap'))).updatedAt === '2026-09-30', '다른 기기에 새 업로드 날짜 반영');

  // --- 8b) 옛 동기화에서 넘어오는 기기 (업그레이드 모드) ---
  {
    const dbU = memDb();
    const base = [{ id: 1, date: '2026-06-01', item: '원본', qty: 1 }, { id: 2, date: '2026-06-01', item: '원본2', qty: 2 }];
    // 전환 서버: 옛 kv 원본(시각 T1)으로 등록 + migrationInfo
    const conv = memStorage({ [K('purchaseorders')]: JSON.stringify(base), 'bl-purchase-cost': '"원본"' });
    await createEngine({ io: dbU.io, storage: conv, user: { uid: 'purchase-migration' } }).startup();
    dbU.state.migrationInfo = { u: 'M', c: 0, v: JSON.stringify({ [K('purchaseorders')]: 'T1', 'bl-purchase-cost': 'T1' }) };
    // 최신 기기(마지막 저장 T1) — 전환 뒤 못 올린 수정이 있음
    const fresh = memStorage({
      [K('purchaseorders')]: JSON.stringify([{ id: 1, date: '2026-06-01', item: '원본', qty: 99 }, base[1], { id: 3, date: '2026-06-02', item: '못올린 신규' }]),
      'bl-purchase-cost': '"기기수정"', __blsync_u: JSON.stringify({ [K('purchaseorders')]: 'T1', 'bl-purchase-cost': 'T1' }),
    });
    await createEngine({ io: dbU.io, storage: fresh, user: U1 }).startup();
    const pc = dbU.cols.purchaseorders;
    ok(pc['PUR-20260601-001'].qty === 99 && pc['PUR-20260602-001'] && pc['PUR-20260602-001'].materialName === '못올린 신규', '업그레이드: 최신 기기의 미저장 수정·신규 보존');
    ok(JSON.parse(dbU.state.cost.v) === '기기수정', '업그레이드: 앱 상태 미저장 수정 보존');
    ok(!fresh.getItem('__blsync_u'), '옛 동기화 기록 정리');
    // 오래된 기기(마지막 저장 T0) — 클라우드를 따른다
    const stale = memStorage({
      [K('purchaseorders')]: JSON.stringify([{ id: 1, date: '2026-06-01', item: '아주 옛날값', qty: 5 }]),
      'bl-purchase-cost': '"옛날"', __blsync_u: JSON.stringify({ [K('purchaseorders')]: 'T0', 'bl-purchase-cost': 'T0' }),
    });
    const w = dbU.writes;
    await createEngine({ io: dbU.io, storage: stale, user: U2 }).startup();
    const ls = JSON.parse(stale.getItem(K('purchaseorders')));
    ok(dbU.writes === w && ls.find((o) => o.id === 1).qty === 99 && ls.length === 3 && JSON.parse(stale.getItem('bl-purchase-cost')) === '기기수정', '업그레이드: 오래된 기기는 클라우드를 따르고 덮어쓰지 않음');
    ok(!stale.getItem('bl-purchase-migration-info'), '전환 기록은 화면 데이터로 내려오지 않음');
  }

  // --- 9) 모든 문서 ID 규칙·id 필드 일치 ---
  let bad = 0;
  Object.keys(db.cols).forEach((c) => Object.keys(db.cols[c]).forEach((id) => { if (!IDC.ID_RE[c].test(id) || db.cols[c][id].id !== id) bad++; }));
  ok(bad === 0, '전 문서 ID 규칙 준수');

  console.log(fail ? `❌ ${fail}건 실패 / ${pass}건 통과` : `✅ 시나리오 ${pass}건 전부 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
