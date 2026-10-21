/* ===================== 구매관리 플랫폼 — 데이터 적재 규칙 구현 (브라우저 · Node 공용) =====================
 * 정본: docs/DATA-ID-RULES.md. 이 파일은 그 문서를 그대로 구현한다 — 어긋나면 문서에 맞춰 이 파일을 고친다.
 *
 * - 업무 컬렉션 문서 ID = `{접두어}-{토큰}-{일련}` 코드 (예: PUR-20260608-001). 한 번 정해지면 바뀌지 않는다.
 * - 일련번호는 meta/seq_{그룹} 카운터를 트랜잭션으로 +1 해서 받는다. 지운 번호는 다시 쓰지 않는다.
 * - 문서 필드명은 영어 camelCase(변수 사전), 값은 사람이 읽는 한글 그대로.
 * - 문서 안 `id` = 문서 이름, `legacyId` = 화면(localStorage)의 내부 번호/키.
 * - 업무 데이터가 아닌 앱 상태(설정·뉴스·원가 모델 등)는 appstate/{camelCase 키} 에 저장한다(규칙 예외). */
(function (root) {
  'use strict';
  var PREFIX = 'bl-purchase-';

  /* ---------- 앱 상태(appstate) 문서 이름: 'bl-purchase-check-plans' ↔ 'checkPlans' ---------- */
  function stateDocId(localKey) {
    return localKey.slice(PREFIX.length).replace(/-([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
  }
  function stateLocalKey(docId) {
    return PREFIX + docId.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }
  var STATE_CHUNK_RE = /^(.+)Part(\d+)$/;

  /* ---------- 토큰 ---------- */
  var PART = { 'PRE-CUT': 'PRECUT', PRECUT: 'PRECUT', '프리컷': 'PRECUT', HYBRID: 'HYBRID', '하이브리드': 'HYBRID',
    CAST: 'CAST', '캐스트': 'CAST', SPLINT: 'SPLINT', '스프린트': 'SPLINT', RESIN: 'RESIN', '수지': 'RESIN',
    '배관보수테이프': 'PXRT', PXRT: 'PXRT' };
  function partToken(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return 'NA';
    var u = s.toUpperCase();
    if (PART[u]) return PART[u];
    if (PART[s]) return PART[s];
    var a = u.replace(/[^A-Z0-9]/g, '');
    return a || 'NA';
  }
  function dateToken(v) {
    var s = String(v == null ? '' : v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).replace(/-/g, '') : '00000000';
  }
  var CLASS = { '원재료': 'RM', '원자재': 'RM', '부재료': 'SM', '부자재': 'SM', '반제품': 'SF', '완제품': 'FP', '제품': 'FP' };
  function classToken(code, category) {
    var m = /^(RM|SM|SF|FP)-/i.exec(String(code || '').trim());
    if (m) return m[1].toUpperCase();
    return CLASS[String(category || '').trim()] || 'NA';
  }
  function zoneToken(v) {
    var s = String(v || '').trim();
    if (s === '내수' || s === '국내') return 'DOM';
    if (s === '수출' || s === '해외') return 'EXP';
    return 'NA';
  }
  function pad(n, d) { var s = String(n); while (s.length < d) s = '0' + s; return s; }

  /* ---------- 업무 컬렉션 정의 ----------
   * localKey: 화면이 쓰는 localStorage 키 / col: Firestore 컬렉션 / kind: array(레코드 배열) | entries(BOM 객체) | rows(매핑 객체)
   * group(r): 일련번호 그룹 / digits: 일련 최소 자릿수 / rename: 화면 필드명 → 변수 사전명
   * values: 변수별 값 변환(화면값 → 문서값), lines: 배열 필드 안의 이름 변환 */
  var COLS = {
    materials: {
      localKey: PREFIX + 'materials', col: 'materials', prefix: 'MAT', digits: 4, kind: 'array', label: '원부자재 재고',
      group: function (r) { return 'MAT-' + classToken(r.newCode, r.category); },
      rename: { name: 'materialName', newName: 'materialNewName', newCode: 'materialCode', stock: 'stockQty', price: 'unitPrice', place: 'location' },
    },
    finishedstocks: {
      localKey: PREFIX + 'finished', col: 'finishedstocks', prefix: 'FGS', digits: 4, kind: 'array', label: '완제품 재고',
      group: function (r) { return 'FGS-' + zoneToken(r.scope); },
      rename: { scope: 'zone', group: 'productGroup', type: 'productType', base: 'baseType', code: 'productCode', qty: 'stockQty', safety: 'safetyQty', supplier: 'customer', lot: 'lotNo' },
      values: { zone: { '내수': '국내', '수출': '해외' } },
    },
    purchaseorders: {
      localKey: PREFIX + 'orders', col: 'purchaseorders', prefix: 'PUR', digits: 3, kind: 'array', label: '발주·입고',
      group: function (r) { return 'PUR-' + dateToken(r.date); },
      rename: { supplier: 'vendor', item: 'materialName', spec: 'materialCode', price: 'unitPrice', due: 'dueDate', inDate: 'receivedDate', inQty: 'receivedQty' },
    },
    materialissues: {
      localKey: PREFIX + 'issues', col: 'materialissues', prefix: 'ISS', digits: 3, kind: 'array', label: '자재 출고 전표',
      group: function (r) { return 'ISS-' + dateToken(r.date); },
      rename: { no: 'slipNo', wh: 'warehouse', dept: 'department' },
      lines: { lines: { code: 'materialCode', name: 'materialName', gubun: 'issueType' } },
    },
    itemcodes: {
      localKey: PREFIX + 'codes', col: 'itemcodes', prefix: 'ITM', digits: 4, kind: 'array', label: '품목 코드',
      group: function (r) { return 'ITM-' + classToken(r.code, r.category); },
      rename: { code: 'itemCode', name: 'itemName', engName: 'itemNameEn', subclass: 'subCategory' },
    },
    purchaseforms: {
      localKey: PREFIX + 'pos', col: 'purchaseforms', prefix: 'POF', digits: 2, kind: 'array', label: '발주서',
      group: function (r) { return 'POF-' + dateToken(r.date); },
      rename: { to: 'vendor', fax: 'faxNo', mgr: 'manager', notes: 'remarks' },
      lines: { items: { name: 'materialName', price: 'unitPrice', due: 'dueDate' } },
    },
    boms: {
      localKey: PREFIX + 'bom', col: 'boms', prefix: 'BOM', digits: 4, kind: 'entries', label: 'BOM·자재명세서',
      group: function (r) { return 'BOM-' + partToken(r.line); },
      rename: { code: 'productCode', n: 'product', region: 'zone', line: 'part' },
      values: { zone: { '내수': '국내' } },
    },
    productmap: {
      localKey: PREFIX + 'productmap', col: 'productmap', prefix: 'PMP', digits: 5, kind: 'rows', label: '영업 품목 매핑',
      group: function () { return 'PMP'; },
      rename: { region: 'zone', category: 'part', name: 'product', fp: 'productCode', sf: 'semiProductCode', bom: 'bomCode' },
      values: { zone: { '내수': '국내' } },
    },
  };
  var BY_LOCAL = {};
  Object.keys(COLS).forEach(function (k) { COLS[k].name = k; BY_LOCAL[COLS[k].localKey] = COLS[k]; });

  /* 문서 ID 형식 검사(보안 규칙과 같은 정규식) */
  var ID_RE = {
    materials: /^MAT-[A-Z]{2}-\d{4,}$/, finishedstocks: /^FGS-(DOM|EXP|NA)-\d{4,}$/, purchaseorders: /^PUR-\d{8}-\d{3,}$/,
    materialissues: /^ISS-\d{8}-\d{3,}$/, itemcodes: /^ITM-[A-Z]{2}-\d{4,}$/, purchaseforms: /^POF-\d{8}-\d{2,}$/,
    boms: /^BOM-[A-Z0-9]+-\d{4,}$/, productmap: /^PMP-\d{5,}$/,
  };
  function formatId(def, group, n) { return group + '-' + pad(n, def.digits); }

  /* 공통 필드 (자동) */
  var COMMON = ['id', 'legacyId', 'source', 'createdAt', 'createdBy', 'createdByEmail', 'updatedAt', 'updatedBy', 'updatedByEmail'];
  var SOURCE = 'purchase';

  function invert(o) { var r = {}; Object.keys(o || {}).forEach(function (k) { r[o[k]] = k; }); return r; }
  function mapKeys(obj, ren) {
    var out = {};
    Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) out[ren[k] || k] = obj[k]; });
    return out;
  }
  function mapValues(obj, vals, reverse) {
    Object.keys(vals || {}).forEach(function (f) {
      if (!(f in obj)) return;
      var m = reverse ? invert(vals[f]) : vals[f];
      if (Object.prototype.hasOwnProperty.call(m, obj[f])) obj[f] = m[obj[f]];
    });
    return obj;
  }
  function mapLines(obj, lines, reverse) {
    Object.keys(lines || {}).forEach(function (f) {
      if (!Array.isArray(obj[f])) return;
      var ren = reverse ? invert(lines[f]) : lines[f];
      obj[f] = obj[f].map(function (l) { return l && typeof l === 'object' ? mapKeys(l, ren) : l; });
    });
    return obj;
  }

  /* ---------- 화면 데이터 ↔ 레코드 목록 ---------- */
  /* localStorage 값 → [{key, rec}] (key = legacyId, 레코드 식별 기준) */
  function extract(def, raw) {
    var d = typeof raw === 'string' ? JSON.parse(raw || (def.kind === 'array' ? '[]' : '{}')) : raw;
    var out = [];
    if (def.kind === 'array') {
      (Array.isArray(d) ? d : []).forEach(function (r) { if (r && r.id != null) out.push({ key: String(r.id), rec: r }); });
    } else if (def.kind === 'entries') {
      var ent = (d && d.entries) || {};
      Object.keys(ent).forEach(function (code) {
        var e = ent[code] || {};
        out.push({ key: code, rec: { code: code, n: e.n, region: e.region, line: e.line, customer: e.customer, c: e.c } });
      });
    } else { // rows: 매핑 행에는 번호가 없어 내용으로 키를 만든다 (같은 행은 다시 올려도 같은 문서)
      var seen = {};
      ((d && d.rows) || []).forEach(function (r) {
        var k = [r.region, r.customer, r.fp, r.custCode].map(function (x) { return String(x == null ? '' : x); }).join('|');
        var n = seen[k] = (seen[k] || 0) + 1;
        out.push({ key: n > 1 ? k + '#' + n : k, rec: r });
      });
    }
    return out;
  }
  /* 레코드 목록 + 화면 부가정보(rest) → localStorage 값 */
  function assemble(def, recs, rest) {
    if (def.kind === 'array') return recs;
    if (def.kind === 'entries') {
      var ent = {};
      recs.forEach(function (r) {
        var e = { n: r.n, region: r.region, line: r.line, customer: r.customer, c: r.c };
        Object.keys(e).forEach(function (k) { if (e[k] === undefined) delete e[k]; });
        ent[r.code] = e;
      });
      return Object.assign({}, rest || {}, { entries: ent });
    }
    return Object.assign({}, rest || {}, { rows: recs });
  }
  /* 객체형(BOM·매핑)에서 레코드가 아닌 부가정보(updatedAt 등) */
  function restOf(def, raw) {
    if (def.kind === 'array') return null;
    var d = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    var r = {};
    Object.keys(d || {}).forEach(function (k) { if (k !== 'entries' && k !== 'rows') r[k] = d[k]; });
    return r;
  }

  /* ---------- 레코드 ↔ Firestore 문서 ---------- */
  function toDoc(def, key, rec, docId, meta) {
    var src = Object.assign({}, rec);
    if (def.kind === 'entries') { // BOM 하위품목 [[코드,품명,소요량,단위]] → 객체 배열 (Firestore는 중첩 배열 불가)
      src.components = (src.c || []).map(function (c) { return { itemCode: c[0], itemName: c[1], qty: c[2], unit: c[3] }; });
      delete src.c;
    }
    delete src.id;
    var doc = mapKeys(src, def.rename);
    mapValues(doc, def.values, false);
    mapLines(doc, def.lines, false);
    var now = meta.now || new Date().toISOString();
    doc.id = docId;
    doc.legacyId = def.kind === 'array' && /^\d+$/.test(key) ? Number(key) : key;
    doc.source = SOURCE;
    doc.createdAt = rec.createdAt || meta.createdAt || rec.updatedAt || now;
    doc.createdBy = meta.createdBy || null;
    doc.createdByEmail = meta.createdByEmail || null;
    doc.updatedAt = rec.updatedAt || now;
    doc.updatedBy = meta.updatedBy || null;
    doc.updatedByEmail = meta.updatedByEmail || null;
    return doc;
  }
  function fromDoc(def, doc) {
    var d = Object.assign({}, doc);
    var legacy = d.legacyId;
    var keepTimes = def.kind === 'array';
    var ca = d.createdAt, ua = d.updatedAt;
    COMMON.forEach(function (k) { delete d[k]; });
    mapLines(d, def.lines, true);
    mapValues(d, def.values, true);
    var rec = mapKeys(d, invert(def.rename));
    if (def.kind === 'entries') {
      rec.c = (rec.components || []).map(function (c) { return [c.itemCode, c.itemName, c.qty, c.unit]; });
      delete rec.components;
    }
    if (def.kind === 'array') {
      rec.id = legacy;
      if (keepTimes) { if (ca != null) rec.createdAt = ca; if (ua != null) rec.updatedAt = ua; }
    }
    return { key: String(legacy), rec: rec };
  }

  /* ---------- 변경 판정용 해시 (키 순서 무관) ---------- */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function hash(v) {
    var s = stable(v), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length.toString(36);
  }

  var api = {
    PREFIX: PREFIX, COLS: COLS, BY_LOCAL: BY_LOCAL, ID_RE: ID_RE, COMMON: COMMON, SOURCE: SOURCE,
    stateDocId: stateDocId, stateLocalKey: stateLocalKey, STATE_CHUNK_RE: STATE_CHUNK_RE,
    partToken: partToken, dateToken: dateToken, classToken: classToken, zoneToken: zoneToken, pad: pad, formatId: formatId,
    extract: extract, assemble: assemble, restOf: restOf, toDoc: toDoc, fromDoc: fromDoc, stable: stable, hash: hash,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BL_IDCODES = api;
})(this);
