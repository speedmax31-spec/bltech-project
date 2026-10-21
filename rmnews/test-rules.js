/* firestore.rules 검증 — Firebase Rules 테스트 API(실제 규칙 엔진)로 허용/거절 판정 */
const fs = require('fs');
const path = require('path');
const { token, PROJECT } = require('./fs-rest.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'bltech-purchase', 'firestore.rules'), 'utf8');
const P = (p) => `/databases/(default)/documents/${p}`;
const AUTH = { uid: 'u1', token: { email: 'a@bl-tech.co.kr' } };
const cases = [
  // [기대, 설명, method, path, auth, 새 데이터(id), 기존 데이터(id)]
  ['ALLOW', '코드 ID 발주 생성', 'create', 'purchaseorders/PUR-20260608-001', AUTH, 'PUR-20260608-001'],
  ['DENY', '번호 ID 생성 거절', 'create', 'purchaseorders/123', AUTH, '123'],
  ['DENY', '한글 ID 거절', 'create', 'purchaseorders/발주_1', AUTH, '발주_1'],
  ['DENY', 'id 필드 불일치 거절', 'create', 'purchaseorders/PUR-20260608-002', AUTH, 'PUR-20260608-999'],
  ['DENY', '로그인 없이 거절', 'create', 'purchaseorders/PUR-20260608-003', null, 'PUR-20260608-003'],
  ['DENY', '다른 컬렉션 접두어 거절', 'create', 'materials/PUR-20260608-001', AUTH, 'PUR-20260608-001'],
  ['ALLOW', '자재 MAT-RM', 'create', 'materials/MAT-RM-0001', AUTH, 'MAT-RM-0001'],
  ['ALLOW', '완제품 FGS-DOM', 'create', 'finishedstocks/FGS-DOM-0001', AUTH, 'FGS-DOM-0001'],
  ['ALLOW', '출고 ISS', 'create', 'materialissues/ISS-20260818-001', AUTH, 'ISS-20260818-001'],
  ['ALLOW', '품목코드 ITM', 'create', 'itemcodes/ITM-NA-0001', AUTH, 'ITM-NA-0001'],
  ['ALLOW', '발주서 POF', 'create', 'purchaseforms/POF-20260930-01', AUTH, 'POF-20260930-01'],
  ['ALLOW', 'BOM', 'create', 'boms/BOM-PXRT-0001', AUTH, 'BOM-PXRT-0001'],
  ['ALLOW', '매핑 PMP', 'create', 'productmap/PMP-00001', AUTH, 'PMP-00001'],
  ['ALLOW', '자릿수 넘침 허용(1000)', 'create', 'purchaseorders/PUR-20260608-1000', AUTH, 'PUR-20260608-1000'],
  ['ALLOW', '수정(ID 동일)', 'update', 'purchaseorders/PUR-20260608-001', AUTH, 'PUR-20260608-001', 'PUR-20260608-001'],
  ['DENY', '수정으로 id 바꾸기 거절', 'update', 'purchaseorders/PUR-20260608-001', AUTH, 'PUR-20260608-777', 'PUR-20260608-001'],
  ['ALLOW', '삭제', 'delete', 'purchaseorders/PUR-20260608-001', AUTH, null, 'PUR-20260608-001'],
  ['ALLOW', '읽기', 'get', 'purchaseorders/PUR-20260608-001', AUTH, null, 'PUR-20260608-001'],
  ['DENY', '미등록 컬렉션 쓰기 거절', 'create', 'kv/materials', AUTH, 'materials'],
  ['DENY', '옛 한글 컬렉션 거절', 'create', '원부자재/x', AUTH, 'x'],
  ['ALLOW', '카운터 meta/seq', 'update', 'meta/seq_PUR-20260608', AUTH, null, null],
  ['ALLOW', '카운터 PMP', 'create', 'meta/seq_PMP', AUTH, null],
  ['DENY', 'meta 다른 문서 거절', 'create', 'meta/counters', AUTH, null],
  ['ALLOW', '앱 상태 appstate', 'create', 'appstate/checkPlans', AUTH, null],
  ['DENY', 'appstate 이름 규칙 위반 거절', 'create', 'appstate/check-plans', AUTH, null],
];
(async () => {
  const testCases = cases.map(([exp, , method, p, auth, newId, oldId]) => {
    const request = { path: P(p), method, time: '2026-09-30T00:00:00Z' };
    if (auth) request.auth = auth;
    if (newId !== undefined && newId !== null) request.resource = { data: { id: newId, source: 'purchase' } };
    else if (method === 'create' || method === 'update') request.resource = { data: { n: 1 } };
    const tc = { expectation: exp, request };
    if (oldId) tc.resource = { data: { id: oldId } };
    else if (method === 'update' && p.startsWith('meta/')) tc.resource = { data: { n: 1 } };
    return tc;
  });
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases } }),
  }).then((r) => r.json());
  if (res.error) { console.log('API 오류', JSON.stringify(res.error).slice(0, 400)); process.exit(1); }
  if (res.issues && res.issues.length) console.log('규칙 경고:', JSON.stringify(res.issues).slice(0, 400));
  let fail = 0;
  (res.testResults || []).forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) { fail++; console.log(`  ❌ ${cases[i][1]} — 기대 ${cases[i][0]}`, (r.debugMessages || []).join(' ').slice(0, 200)); }
  });
  console.log(fail ? `❌ ${fail}건 실패 / ${cases.length}` : `✅ 보안 규칙 ${cases.length}건 전부 기대대로 판정`);
  process.exit(fail ? 1 : 0);
})();
