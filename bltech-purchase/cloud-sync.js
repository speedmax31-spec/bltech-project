/* ===================== 클라우드 동기화 (Firestore) =====================
 * 데이터 적재 규칙(docs/DATA-ID-RULES.md)을 따른다 — 규칙 구현은 idcodes.js, 동기화 로직은 sync-engine.js.
 * - 업무 데이터: 레코드 1건 = 문서 1개, 코드 ID(PUR-20260608-001 …), 일련번호는 meta/seq_{그룹} 트랜잭션
 * - 앱 상태(설정·뉴스·원가 모델 등): appstate/{camelCase 키}
 * - 접속 시 클라우드와 맞추고(화면 데이터가 바뀌면 1회 새로고침), 이후 4초마다 바뀐 레코드만 올린다
 * - 오프라인/차단 시: 로컬 저장만으로 계속 동작하고 다음 접속 때 맞춘다
 * 기기별 UI 상태(열린 탭, 챗봇 창 크기, 메뉴 접힘, AI 키 등)는 동기화하지 않는다. */
(function () {
  'use strict';
  var statusEl = null;
  function setStatus(txt, err) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (statusEl) {
      statusEl.textContent = txt;
      statusEl.style.color = err ? '#ff9d9d' : '';
    }
  }
  if (!window.firebase || !window.firebaseConfig || !window.BL_SYNC || !window.BL_IDCODES) {
    setStatus('⚠️ 클라우드 미연결 (로컬 저장)', true);
    return;
  }
  var db, auth;
  try {
    firebase.initializeApp(window.firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
  } catch (e) {
    console.warn('[sync] Firebase 초기화 실패', e);
    return;
  }

  /* --- 구글 로그인 게이트 --- */
  var loginScreen = document.getElementById('login-screen');
  var loginErr = document.getElementById('login-error');
  var loginBtn = document.getElementById('google-login');
  var userEl = document.getElementById('login-user');
  var logoutBtn = document.getElementById('logout-btn');
  if (loginBtn) loginBtn.addEventListener('click', function () {
    loginErr.textContent = '';
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request')) {
        auth.signInWithRedirect(provider);
        return;
      }
      loginErr.textContent = '로그인 실패: ' + (e && e.code === 'auth/operation-not-allowed'
        ? 'Firebase 콘솔에서 Google 로그인이 아직 활성화되지 않았습니다.'
        : (e && e.message) || '다시 시도해 주세요.');
    });
  });
  if (logoutBtn) logoutBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    auth.signOut().then(function () { location.reload(); });
  });

  var EXCLUDE = ['bl-purchase-open-tabs', 'bl-purchase-ai-ui', 'bl-purchase-nav-collapsed', 'bl-purchase-fx', 'bl-purchase-aikey', 'bl-purchase-aimodel'];

  /* Firestore 입출력 어댑터 (sync-engine 이 쓰는 io 인터페이스) */
  var io = {
    listDocs: function (col) {
      return db.collection(col).get().then(function (snap) {
        var out = [];
        snap.forEach(function (d) { out.push({ id: d.id, data: d.data() }); });
        return out;
      });
    },
    commit: async function (ops) {
      for (var i = 0; i < ops.length; i += 400) {
        var batch = db.batch();
        ops.slice(i, i + 400).forEach(function (o) {
          var ref = db.collection(o.col).doc(o.id);
          if (o.t === 'set') batch.set(ref, o.data); else batch.delete(ref);
        });
        await batch.commit();
      }
    },
    /* 일련번호 예약: meta/seq_{그룹}.n 을 트랜잭션으로 count 만큼 올리고 첫 번호를 돌려준다 */
    reserve: function (group, count) {
      var ref = db.collection('meta').doc('seq_' + group);
      return db.runTransaction(function (t) {
        return t.get(ref).then(function (snap) {
          var n = snap.exists ? (snap.data().n || 0) : 0;
          t.set(ref, { n: n + count, group: group, updatedAt: new Date().toISOString() });
          return n + 1;
        });
      });
    },
    listState: function () { return io.listDocs('appstate'); },
    setState: async function (writes) {
      for (var i = 0; i < writes.length; i += 400) {
        var batch = db.batch();
        writes.slice(i, i + 400).forEach(function (w) { batch.set(db.collection('appstate').doc(w.id), w.data); });
        await batch.commit();
      }
    },
  };

  var engine = null, busy = false;
  async function pushChanged() {
    if (!engine || busy || !navigator.onLine) return;
    busy = true;
    try {
      var n = await engine.push();
      if (n) setStatus('☁️ 동기화됨 ' + new Date().toTimeString().slice(0, 5));
    } catch (e) {
      console.warn('[sync] 업로드 실패', e);
      setStatus('⚠️ 동기화 오류 — 로컬에는 저장됨', true);
    }
    busy = false;
  }

  var syncStarted = false;
  async function startSync(user) {
    if (syncStarted) return;
    syncStarted = true;
    engine = BL_SYNC.createEngine({
      io: io, storage: localStorage, exclude: EXCLUDE,
      user: { uid: user.uid, email: user.email || null },
      log: function (col, msg) { console.log('[sync]', col, msg); },
    });
    try {
      setStatus('☁️ 클라우드 확인 중…');
      busy = true;
      var changed = await engine.startup();
      busy = false;
      if (changed && !sessionStorage.getItem('blsync-reloaded')) {
        sessionStorage.setItem('blsync-reloaded', '1');
        location.reload();
        return;
      }
      sessionStorage.removeItem('blsync-reloaded');
      if (engine.errors && engine.errors.length) { // 일부만 실패: 나머지는 정상 동작, 원인을 그대로 보여준다
        console.warn('[sync] 일부 동기화 실패', engine.errors);
        setStatus('⚠️ 일부 동기화 실패 — ' + engine.errors[0], true);
      } else setStatus('☁️ 동기화됨');
      setInterval(pushChanged, 4000);
    } catch (e) {
      busy = false;
      console.warn('[sync] 초기화 실패', e);
      setStatus(navigator.onLine ? '⚠️ 동기화 실패 — ' + ((e && (e.code || e.message)) || e) : '⚠️ 오프라인 — 로컬 저장만 동작', true);
    }
  }

  /* 로그인 상태에 따라: 미로그인 = 게이트 표시, 로그인 = 앱 진입 + 동기화 시작 */
  auth.onAuthStateChanged(function (user) {
    if (!user) {
      if (loginScreen) loginScreen.hidden = false;
      if (userEl) userEl.textContent = '';
      if (logoutBtn) logoutBtn.style.display = 'none';
      setStatus('🔒 로그인 필요', true);
      return;
    }
    if (loginScreen) loginScreen.hidden = true;
    if (userEl) userEl.textContent = '👤 ' + (user.displayName || user.email || '');
    if (logoutBtn) logoutBtn.style.display = 'inline';
    startSync(user);
  });
})();
