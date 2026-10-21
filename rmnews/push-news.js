/* 원부자재 이슈 뉴스 → 구매관리 플랫폼 클라우드(Firestore appstate/rmnews) 업로드
 * 사용법: node push-news.js <오늘자JSON파일>
 * 입력 JSON: { date:'YYYY-MM-DD', updatedAt:'YYYY-MM-DD HH:mm', engine,
 *              fabric/resin/market/pouch/box:[{t,s,src,url,region}], advice:[...] }
 * 동작: 기존 문서를 읽어 같은 날짜를 교체하며 맨 앞에 추가, 최근 30일만 유지.
 * 뉴스는 업무 데이터가 아닌 앱 상태라 appstate/{camelCase 키}({u,c:0,v}) 에 둔다(docs/DATA-ID-RULES.md) — 사이트 접속 시 자동 반영. */
const fs = require('fs');

const PROJECT = 'bltech-ch-project';
const KEY = require('../bltech-purchase/idcodes.js').stateDocId('bl-purchase-rmnews'); // → 'rmnews'
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/appstate/${KEY}`;

async function getToken() {
  const cfg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  const refresh = cfg.tokens && cfg.tokens.refresh_token;
  if (!refresh) throw new Error('firebase-tools 로그인 토큰이 없습니다. `npx firebase-tools login` 필요');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  }).then((x) => x.json());
  if (!r.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(r).slice(0, 200));
  return r.access_token;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('사용법: node push-news.js <오늘자JSON파일>');
  const day = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 5봇 형식(fabric/resin/market/pouch/box) + 과거 3봇 형식(glass/materials) 모두 통과
  const KINDS = ['fabric', 'resin', 'market', 'pouch', 'box', 'glass', 'materials'];
  if (!day.date || !KINDS.some((k) => Array.isArray(day[k]))) {
    throw new Error('JSON에 date와 봇 데이터 배열(fabric/resin/market/pouch/box)이 필요합니다');
  }
  const token = await getToken();
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 기존 문서 읽기 (없으면 새로 시작)
  let data = { days: [] };
  const cur = await fetch(DOC_URL, { headers: H });
  if (cur.ok) {
    try {
      const j = await cur.json();
      const v = j.fields && j.fields.v && j.fields.v.stringValue;
      if (v) data = JSON.parse(v);
    } catch (e) { /* 손상 시 새로 시작 */ }
  }
  if (!Array.isArray(data.days)) data.days = [];

  // 같은 날짜 교체 + 맨 앞 추가 + 30일 유지
  data.days = data.days.filter((d) => d.date !== day.date);
  const entry = { date: day.date, advice: day.advice || [], engine: day.engine || '', gpt: day.gpt || null };
  ['fabric', 'resin', 'market', 'pouch', 'box', 'glass', 'materials'].forEach((k) => { if (Array.isArray(day[k])) entry[k] = day[k]; });
  data.days.push(entry);
  // 날짜 최신순 정렬 — 밀린 날짜를 나중에 올려도 화면 날짜 칩 순서가 맞게
  data.days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  data.days = data.days.slice(0, 30);
  data.updatedAt = day.updatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ');

  const v = JSON.stringify(data);
  if (v.length > 850000) { // 900KB 청크 한도 접근 시 오래된 날짜부터 축소
    while (JSON.stringify(data).length > 850000 && data.days.length > 5) data.days.pop();
  }
  const body = JSON.stringify({
    fields: {
      u: { stringValue: new Date().toISOString() },
      c: { integerValue: '0' },
      v: { stringValue: JSON.stringify(data) },
    },
  });
  const w = await fetch(DOC_URL, { method: 'PATCH', headers: H, body });
  if (!w.ok) throw new Error('업로드 실패 ' + w.status + ': ' + (await w.text()).slice(0, 200));
  const cnt = (k) => (day[k] || []).length;
  console.log(`OK — ${day.date} 원단·원사 ${cnt('fabric') + cnt('glass')}건 · 수지 ${cnt('resin') + cnt('materials')}건 · 시장 ${cnt('market')}건 · 파우치 ${cnt('pouch')}건 · 박스 ${cnt('box')}건 · 제안 ${(day.advice || []).length}건 업로드 (보관 ${data.days.length}일)`);
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
