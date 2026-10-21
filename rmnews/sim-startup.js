/* 사용자 브라우저 재현: 전환 전 데이터(백업)+옛 동기화 기록을 가진 기기가 새 코드로 처음 접속 — 실DB 읽기, 쓰기는 기록만 */
const fs = require('fs');
const path = require('path');
const R = require('./fs-rest.js');
const { createEngine } = require('../bltech-purchase/sync-engine.js');
const file = path.join(__dirname, 'backup', fs.readdirSync(path.join(__dirname, 'backup')).filter((f) => f.endsWith('.json')).sort().pop());
const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
const store = new Map();
Object.keys(bk).forEach((k) => store.set(k, bk[k].v));
const legacy = {}; Object.keys(bk).forEach((k) => { legacy[k] = bk[k].u; });
if (process.argv[2] !== 'fresh') store.set('__blsync_u', JSON.stringify(legacy));
const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; } };
const ops = {}; let states = 0; let reserves = [];
const conv = (d) => ({ id: R.idOf(d), data: R.fromFs({ mapValue: { fields: d.fields || {} } }) });
const io = {
  listDocs: async (c) => (await R.listAll(c)).map(conv),
  commit: async (o) => o.forEach((x) => { ops[x.col] = (ops[x.col] || 0) + 1; }),
  reserve: async (g, n) => { reserves.push(g + '×' + n); return 9000; },
  listState: async () => (await R.listAll('appstate')).map(conv),
  setState: async (w) => { states += w.length; },
};
(async () => {
  const e = createEngine({ io, storage, user: { uid: 'sim', email: 'sim@test' }, exclude: [] });
  const t = Date.now();
  const changed = await e.startup();
  let total = 0; store.forEach((v, k) => { total += k.length + v.length; });
  console.log('모드:', process.argv[2] === 'fresh' ? '새 기기' : '옛 동기화 기기(업그레이드)', '| 화면변경:', changed, '| 소요', ((Date.now() - t) / 1000).toFixed(1) + 's');
  console.log('쓰기 예정(문서):', JSON.stringify(ops), '| appstate 쓰기:', states, '| 번호예약:', reserves.slice(0, 5).join(', ') + (reserves.length > 5 ? ` 외 ${reserves.length - 5}` : ''));
  console.log('localStorage 총 글자수:', total.toLocaleString(), '(크롬 한도 약 5,242,880자) | 동기화상태 크기:', (store.get('__blsync_v2') || '').length.toLocaleString());
  const rm = JSON.parse(store.get('bl-purchase-rmnews') || '{"days":[]}');
  console.log('뉴스 날짜:', rm.days.map((d) => d.date).join(', '));
})().catch((err) => { console.log('❌ 시작 오류:', err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err); process.exit(1); });
