/* ===================== 동기화 엔진 (브라우저 · Node 공용, 입출력 분리) =====================
 * 화면(localStorage)과 Firestore를 docs/DATA-ID-RULES.md 규칙대로 주고받는다.
 *  - 업무 데이터: 레코드 1건 = 문서 1개 (코드 ID, 공통 필드). 새 레코드는 meta/seq_{그룹} 에서 번호를 받는다.
 *  - 앱 상태: appstate/{camelCase 키} 에 통째로 {u, c, v} (큰 값은 {키}Part0.. 로 분할)
 * io 는 저장소 어댑터(브라우저=Firebase SDK, 테스트=메모리, 이전=REST)로 주입한다:
 *   io.listDocs(col) → [{id, data}]         io.commit([{t:'set'|'del', col, id, data}])
 *   io.reserve(group, count) → 첫 번호       io.listState() → [{id, data}]    io.setState([{id, data}])
 * storage 는 localStorage 모양(getItem/setItem/key/length). */
(function (root) {
  'use strict';
  var IDC = typeof module !== 'undefined' && module.exports ? require('./idcodes.js') : root.BL_IDCODES;
  var SYNC_KEY = '__blsync_v2';
  var CHUNK = 900000;

  function createEngine(opt) {
    var io = opt.io, storage = opt.storage, user = opt.user || {};
    var EXCLUDE = opt.exclude || [];
    var nowFn = opt.now || function () { return new Date().toISOString(); };
    var log = opt.log || function () { };
    var S = load();
    var stateShadow = {};

    function load() {
      var s;
      try { s = JSON.parse(storage.getItem(SYNC_KEY)); } catch (e) { s = null; }
      s = s || {};
      s.cols = s.cols || {}; s.state = s.state || {}; s.info = s.info || {};
      return s;
    }
    function save() { storage.setItem(SYNC_KEY, JSON.stringify(S)); }
    function allKeys() { var out = []; for (var i = 0; i < storage.length; i++) out.push(storage.key(i)); return out; }
    /* BOM·매핑처럼 객체형 데이터의 부가정보(updatedAt 등)는 appstate/{키}Info 에 둔다 */
    var INFO_IDS = {};
    Object.keys(IDC.COLS).forEach(function (k) { var d = IDC.COLS[k]; if (d.kind !== 'array') INFO_IDS[IDC.stateDocId(d.localKey) + 'Info'] = d; });
    function infoIdOf(def) { return IDC.stateDocId(def.localKey) + 'Info'; }
    var RESERVED = { migrationInfo: 1 }; // 전환 기록(appstate/migrationInfo) — 화면 데이터 아님
    function isStateKey(k) {
      return k && k.indexOf(IDC.PREFIX) === 0 && !IDC.BY_LOCAL[k] && EXCLUDE.indexOf(k) < 0
        && !INFO_IDS[IDC.stateDocId(k)] && !RESERVED[IDC.stateDocId(k)];
    }
    var cloudInfo = {};
    /* 옛 동기화(__blsync_u)에서 넘어온 기기: 전환 시점 이후 이 기기에서 고친 내용은 보존한다.
       전환 당시 원본 시각(migrationInfo)보다 이 기기의 마지막 저장이 같거나 늦으면 = 이 기기가 최신이었음 → 로컬 우선 */
    var LEGACY_KEY = '__blsync_u';
    var legacy = null, mig = null, migTime = '', forcePush = {};
    try { legacy = JSON.parse(storage.getItem(LEGACY_KEY)); } catch (e) { legacy = null; }
    function localWins(localKey) { return !!(legacy && mig && legacy[localKey] && mig[localKey] && legacy[localKey] >= mig[localKey]); }

    /* 비교용 해시: 레코드를 문서 형태로 갔다 온 모양으로 맞춘 뒤 계산 — 문서가 채우는 공통 필드 차이로 인한 오탐 방지 */
    function H(def, key, rec) {
      var r = IDC.fromDoc(def, IDC.toDoc(def, key, rec, 'X', { now: '1970-01-01T00:00:00.000Z' })).rec;
      delete r.createdAt; delete r.updatedAt; // 시각만 다른 것은 변경이 아니다(실제 수정은 다른 값도 바뀜)
      return IDC.hash(r);
    }
    function docData(def, e, docId, now) {
      return IDC.toDoc(def, e.key, e.rec, docId, {
        now: now, createdBy: e.cb || null, createdByEmail: e.ce || null,
        updatedBy: user.uid || null, updatedByEmail: user.email || null,
      });
    }
    /* 새 레코드에 코드 ID 발급 — 그룹별로 필요한 개수만큼 한 번에 예약 */
    async function assignNew(def, fresh, result, ops, now) {
      var groups = {}, order = [];
      fresh.forEach(function (f) {
        var g = def.group(f.rec);
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(f);
      });
      for (var gi = 0; gi < order.length; gi++) {
        var g = order[gi], list = groups[g];
        var start = await io.reserve(g, list.length);
        list.forEach(function (f, i) {
          var id = IDC.formatId(def, g, start + i);
          var e = { key: f.key, rec: f.rec, hash: H(def, f.key, f.rec), cb: user.uid || null, ce: user.email || null };
          result[id] = e;
          ops.push({ t: 'set', col: def.col, id: id, data: docData(def, e, id, now) });
        });
      }
    }
    function snapshot(result) {
      var docs = {};
      Object.keys(result).forEach(function (id) {
        var e = result[id];
        docs[id] = (e.cb || e.ce) ? [e.key, e.hash, e.cb || null, e.ce || null] : [e.key, e.hash];
      });
      return { docs: docs };
    }
    /* 문서들 → 화면 데이터 (배열형은 내부 번호 순, 같은 번호가 둘이면 뒤의 것에 새 번호) */
    function rebuild(def, result, rest, ops, now) {
      var ids = Object.keys(result).sort();
      var recs = [], seen = {};
      if (def.kind === 'array') {
        ids.sort(function (a, b) {
          var ka = Number(result[a].key), kb = Number(result[b].key);
          if (!isNaN(ka) && !isNaN(kb) && ka !== kb) return ka - kb;
          return a < b ? -1 : a > b ? 1 : 0;
        });
        var max = 0;
        ids.forEach(function (id) { var n = Number(result[id].key); if (!isNaN(n) && n > max) max = n; });
        ids.forEach(function (id) {
          var e = result[id];
          if (seen[e.key]) { // 다른 기기에서 같은 내부 번호로 만든 레코드 → 새 번호 부여
            var nid = ++max;
            e.rec = Object.assign({}, e.rec, { id: nid });
            e.key = String(nid);
            e.hash = H(def, e.key, e.rec);
            ops.push({ t: 'set', col: def.col, id: id, data: docData(def, e, id, now) });
          }
          seen[e.key] = 1;
          recs.push(e.rec);
        });
      } else {
        ids.forEach(function (id) {
          var e = result[id];
          if (seen[e.key]) { delete result[id]; ops.push({ t: 'del', col: def.col, id: id }); return; }
          seen[e.key] = 1;
          recs.push(e.rec);
        });
      }
      return IDC.assemble(def, recs, rest);
    }

    /* 업무 컬렉션 1개 맞추기. cloudDocs=null 이면 클라우드를 읽지 않고 로컬 변경분만 올린다(주기 저장). */
    async function syncCol(def, cloudDocs) {
      var now = nowFn();
      var st = S.cols[def.col];
      var raw = storage.getItem(def.localKey);
      var local = raw == null ? [] : IDC.extract(def, raw);
      var rest = raw == null ? null : IDC.restOf(def, raw);
      var ops = [], result = {}, localChanged = false;
      var cloud = null;
      if (cloudDocs) {
        cloud = {};
        cloudDocs.forEach(function (d) {
          var fr = IDC.fromDoc(def, d.data);
          cloud[d.id] = { key: fr.key, rec: fr.rec, hash: H(def, fr.key, fr.rec), cb: d.data.createdBy || null, ce: d.data.createdByEmail || null, ua: d.data.updatedAt || '' };
        });
      }
      var upgrade = false;
      if (!st) {
        if (cloud && Object.keys(cloud).length) {
          result = cloud; // 처음 연결한 기기: 클라우드가 정본
          if (localWins(def.localKey)) { // 옛 동기화에서 넘어온 최신 기기: 로컬에서 다른 레코드는 로컬 우선, 로컬에만 있는 레코드는 신규 등록
            upgrade = true;
            var byKey = {}, freshU = [];
            Object.keys(cloud).forEach(function (id) { byKey[cloud[id].key] = id; });
            local.forEach(function (it) {
              var id = byKey[it.key];
              if (!id) { freshU.push(it); return; }
              var h = H(def, it.key, it.rec);
              if (h !== cloud[id].hash && !(migTime && cloud[id].ua > migTime)) { // 전환 뒤 클라우드에서 바뀐 레코드는 클라우드 우선
                var e = { key: it.key, rec: it.rec, hash: h, cb: cloud[id].cb, ce: cloud[id].ce };
                result[id] = e;
                ops.push({ t: 'set', col: def.col, id: id, data: docData(def, e, id, now) });
              }
            });
            await assignNew(def, freshU, result, ops, now);
          }
        } else if (cloud) await assignNew(def, local, result, ops, now); // 클라우드가 비었음: 로컬 전체 첫 등록
        else return false; // 주기 저장인데 아직 맞춘 적이 없음 → 다음 시작 때 처리
      } else {
        var keyToDoc = {};
        Object.keys(st.docs).forEach(function (id) { keyToDoc[st.docs[id][0]] = id; });
        if (cloud) result = Object.assign({}, cloud);
        else Object.keys(st.docs).forEach(function (id) { var s = st.docs[id]; result[id] = { key: s[0], hash: s[1], cb: s[2] || null, ce: s[3] || null, rec: null }; });
        var present = {}, fresh = [];
        local.forEach(function (it) {
          present[it.key] = 1;
          var id = keyToDoc[it.key];
          if (!id) { fresh.push(it); return; }
          var h = H(def, it.key, it.rec);
          var base = (cloud && cloud[id]) || result[id] || {};
          if (h !== st.docs[id][1]) { // 이 기기에서 고친 레코드 → 올린다(ID 그대로)
            var e = { key: it.key, rec: it.rec, hash: h, cb: base.cb || st.docs[id][2] || null, ce: base.ce || st.docs[id][3] || null };
            result[id] = e;
            ops.push({ t: 'set', col: def.col, id: id, data: docData(def, e, id, now) });
          } else if (!cloud) {
            result[id].rec = it.rec;
          }
        });
        Object.keys(st.docs).forEach(function (id) { // 이 기기에서 지운 레코드 → 문서 삭제(번호는 비워 둠)
          if (!present[st.docs[id][0]]) { delete result[id]; if (!cloud || cloud[id]) ops.push({ t: 'del', col: def.col, id: id }); }
        });
        await assignNew(def, fresh, result, ops, now);
      }
      // 객체형 부가정보: 이 기기에서 안 바꿨으면 클라우드 값, 바꿨으면 올린다
      var infoWrite = null;
      if (def.kind !== 'array') {
        var iid = infoIdOf(def), localInfo = IDC.stable(rest || {});
        var mine = (S.info[def.col] != null && localInfo !== S.info[def.col])
          || (upgrade && raw != null && cloudInfo[iid] != null && localInfo !== IDC.stable(JSON.parse(cloudInfo[iid])));
        if (cloud && cloudInfo[iid] != null && !mine) rest = JSON.parse(cloudInfo[iid]);
        else if (raw != null && (mine || S.info[def.col] == null)) infoWrite = { id: iid, data: { u: now, c: 0, v: JSON.stringify(rest || {}) } };
      }
      if (cloud) { // 클라우드 기준으로 화면 데이터를 다시 만든다
        var next = rebuild(def, result, rest, ops, now);
        var cur = raw == null ? null : JSON.parse(raw);
        if (cur == null || IDC.stable(next) !== IDC.stable(cur)) {
          storage.setItem(def.localKey, JSON.stringify(next));
          localChanged = true;
        }
      }
      if (ops.length) { await io.commit(ops); log(def.col, '문서 ' + ops.length + '건 반영'); }
      if (infoWrite) await io.setState([infoWrite]);
      S.cols[def.col] = snapshot(result);
      if (def.kind !== 'array') S.info[def.col] = IDC.stable(rest || {});
      save();
      return localChanged;
    }

    /* ---------- 앱 상태 (appstate) ---------- */
    async function pullState(docs) {
      docs = docs || await io.listState();
      var metas = {}, chunks = {}, changed = false;
      docs.forEach(function (d) {
        var m = IDC.STATE_CHUNK_RE.exec(d.id);
        if (m) (chunks[m[1]] = chunks[m[1]] || {})[+m[2]] = d.data.v;
        else metas[d.id] = d.data;
      });
      Object.keys(metas).forEach(function (id) {
        var r = metas[id], key = IDC.stateLocalKey(id);
        if (!r.u || !isStateKey(key)) return;
        if (S.state[key] && S.state[key] >= r.u) return;
        var cloudVal = r.c ? null : r.v;
        if (!S.state[key] && localWins(key) && storage.getItem(key) != null && !(migTime && r.u > migTime)
          && (cloudVal == null || storage.getItem(key) !== cloudVal)) { // 옛 동기화의 최신 기기 + 전환 뒤 클라우드 그대로 + 값이 다름 → 로컬 값을 올린다
          S.state[key] = r.u; forcePush[key] = 1; return;
        }
        var v = r.v;
        if (r.c) { v = ''; for (var i = 0; i < r.c; i++) v += (chunks[id] && chunks[id][i]) || ''; }
        if (v == null) return;
        if (storage.getItem(key) !== v) { storage.setItem(key, v); changed = true; }
        S.state[key] = r.u;
      });
      save();
      return changed;
    }
    var statePulled = false;
    async function pushState(force) {
      if (!statePulled) return 0;
      var writes = [], did = [];
      allKeys().filter(isStateKey).forEach(function (k) {
        var v = storage.getItem(k);
        var must = force || forcePush[k];
        if (!must && stateShadow[k] === v) return;
        if (stateShadow[k] === undefined && S.state[k] && !must) { stateShadow[k] = v; return; } // 시작 기준점
        delete forcePush[k];
        var u = nowFn(), id = IDC.stateDocId(k);
        if (v.length <= CHUNK) writes.push({ id: id, data: { u: u, c: 0, v: v } });
        else {
          var n = Math.ceil(v.length / CHUNK);
          for (var i = 0; i < n; i++) writes.push({ id: id + 'Part' + i, data: { v: v.slice(i * CHUNK, (i + 1) * CHUNK) } });
          writes.push({ id: id, data: { u: u, c: n } });
        }
        did.push([k, v, u]);
      });
      if (writes.length) await io.setState(writes);
      did.forEach(function (x) { stateShadow[x[0]] = x[1]; S.state[x[0]] = x[2]; });
      if (did.length) save();
      return did.length;
    }

    var DEFS = Object.keys(IDC.COLS).map(function (k) { return IDC.COLS[k]; });
    var lastRaw = {};
    return {
      S: function () { return S; },
      /* 시작 시: 클라우드와 맞춘다. 화면 데이터가 바뀌었으면 true */
      startup: async function () {
        var changed = false, errors = [], stateDocs = [];
        var errText = function (err) { return (err && (err.code || err.message)) || String(err); };
        var stateOk = false;
        try { stateDocs = await io.listState(); stateOk = true; } catch (err) { errors.push('appstate 읽기: ' + errText(err)); }
        cloudInfo = {};
        stateDocs.forEach(function (d) {
          if (INFO_IDS[d.id]) cloudInfo[d.id] = d.data.v;
          if (d.id === 'migrationInfo') { try { mig = JSON.parse(d.data.v); migTime = d.data.u || ''; } catch (e) { mig = null; } }
        });
        for (var i = 0; i < DEFS.length; i++) {
          var def = DEFS[i];
          try {
            if (await syncCol(def, await io.listDocs(def.col))) changed = true;
            lastRaw[def.localKey] = storage.getItem(def.localKey);
          } catch (err) { errors.push(def.col + ': ' + errText(err)); }
        }
        if (stateOk) { try { if (await pullState(stateDocs)) changed = true; } catch (err) { stateOk = false; errors.push('appstate: ' + errText(err)); } }
        allKeys().filter(isStateKey).forEach(function (k) { if (S.state[k] && !forcePush[k]) stateShadow[k] = storage.getItem(k); });
        statePulled = stateOk; // 클라우드 앱 상태를 못 읽었으면 절대 올리지 않는다(옛 값으로 덮어쓰기 방지)
        if (stateOk) { try { await pushState(false); } catch (err) { errors.push('appstate 저장: ' + errText(err)); } }
        if (!errors.length && legacy && storage.removeItem) { storage.removeItem(LEGACY_KEY); legacy = null; } // 옛 동기화 기록은 성공했을 때만 정리
        this.errors = errors;
        return changed;
      },
      /* 주기 저장: 바뀐 것만 올린다. 올린 건수 반환 */
      push: async function () {
        var n = 0;
        for (var i = 0; i < DEFS.length; i++) {
          var def = DEFS[i], raw = storage.getItem(def.localKey);
          if (raw === lastRaw[def.localKey]) continue;
          await syncCol(def, null);
          lastRaw[def.localKey] = raw;
          n++;
        }
        n += await pushState(false);
        return n;
      },
      syncCol: syncCol,
    };
  }

  var api = { createEngine: createEngine, SYNC_KEY: SYNC_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BL_SYNC = api;
})(this);
