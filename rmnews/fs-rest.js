/* Firestore REST 공용 도우미 (firebase-tools 로그인 토큰 사용 — 관리자 권한, 이 PC 전용) */
const fs = require('fs');
const PROJECT = 'bltech-ch-project';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${ROOT}`;

let _tok = null, _tokAt = 0;
async function token() {
  if (_tok && Date.now() - _tokAt < 45 * 60 * 1000) return _tok;
  const cfg = JSON.parse(fs.readFileSync(process.env.USERPROFILE + '/.config/configstore/firebase-tools.json', 'utf8'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
      refresh_token: cfg.tokens.refresh_token, grant_type: 'refresh_token',
    }),
  }).then((x) => x.json());
  if (!r.access_token) throw new Error('토큰 발급 실패');
  _tok = r.access_token; _tokAt = Date.now();
  return _tok;
}
async function H() { return { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' }; }

/* JSON ↔ Firestore Value */
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; Object.keys(v).forEach((k) => { if (v[k] !== undefined) f[k] = toFs(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fromFs(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) { const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = fromFs(x); }); return o; }
  return null;
}
const docName = (col, id) => `${ROOT}/${col}/${id}`;
const idOf = (d) => decodeURIComponent(d.name.split('/').pop());

async function listAll(col, fieldMask) {
  const out = [];
  let pt = '';
  do {
    const q = `pageSize=300${fieldMask ? '&mask.fieldPaths=' + fieldMask : ''}${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`;
    const j = await fetch(`${BASE}/${encodeURIComponent(col)}?${q}`, { headers: await H() }).then((r) => r.json());
    if (j.error) throw new Error(col + ' 목록 실패: ' + j.error.message);
    (j.documents || []).forEach((d) => out.push(d));
    pt = j.nextPageToken || '';
  } while (pt);
  return out;
}
async function commit(writes, label) {
  for (let i = 0; i < writes.length; i += 400) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
      method: 'POST', headers: await H(), body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
    });
    if (!res.ok) throw new Error((label || 'commit') + ' 실패 ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
}
/* 옛 kv 또는 새 appstate 의 {u,c,v} 문서들을 localStorage 키 기준 값으로 모두 읽기 */
async function readStateCollection(col, toLocalKey) {
  const docs = await listAll(col);
  const metas = {}, chunks = {};
  docs.forEach((d) => {
    const id = idOf(d), m = /^(.+)Part(\d+)$/.exec(id);
    if (m) (chunks[m[1]] = chunks[m[1]] || {})[+m[2]] = d.fields.v.stringValue;
    else metas[id] = d.fields;
  });
  const out = {};
  Object.keys(metas).forEach((id) => {
    const f = metas[id];
    let v;
    if (f.v) v = f.v.stringValue;
    else { v = ''; for (let i = 0; i < Number(f.c ? f.c.integerValue : 0); i++) v += (chunks[id] || {})[i] || ''; }
    out[toLocalKey(id)] = { v, u: f.u ? f.u.stringValue : '' };
  });
  return out;
}
async function readKvAll() {
  const IDC = require('../bltech-purchase/idcodes.js');
  const all = await readStateCollection('kv', IDC.stateLocalKey);
  const o = {};
  Object.keys(all).forEach((k) => { o[k] = all[k].v; });
  return o;
}

module.exports = { PROJECT, ROOT, BASE, token, H, toFs, fromFs, docName, idOf, listAll, commit, readStateCollection, readKvAll };
