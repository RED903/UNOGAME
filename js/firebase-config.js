// ═══════════════════════════════════════════════════
// Firebase 설정 & 로컬 스마트 분기 모듈
// ═══════════════════════════════════════════════════

import * as localDb from './local-db.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref as fbRef,
  set as fbSet,
  get as fbGet,
  push as fbPush,
  onValue as fbOnValue,
  update as fbUpdate,
  remove as fbRemove,
  off as fbOff,
  serverTimestamp as fbServerTimestamp,
  runTransaction as fbRunTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ══════════════════════════════════════════════════
// 🔧 Firebase 원격 설정
// ══════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBZYI7EJZBac29eFaJQLKpDJJp-YwVZr6o",
  authDomain: "uno-game-7f074.firebaseapp.com",
  databaseURL: "https://uno-game-7f074-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "uno-game-7f074",
  storageBucket: "uno-game-7f074.firebasestorage.app",
  messagingSenderId: "364236312896",
  appId: "1:364236312896:web:475600e15fb99d92a4eaa5"
};
// ══════════════════════════════════════════════════

// 로컬 테스트 모드 여부 감지 함수
export function isLocalMode() {
  if (typeof window === 'undefined') return false;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('local') === 'true' || urlParams.get('local') === '1' || urlParams.get('mode') === 'local') {
      return true;
    }
    if (window.location.pathname.includes('-local') || window.location.pathname.includes('index-local.html')) {
      return true;
    }
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('uno_local_mode') === 'true') {
      return true;
    }
  } catch (e) {
    // URLSearchParams 파싱 오류 등 예외 방어
  }
  return false;
}

// Firebase 초기화
let fbApp = null;
let fbDatabase = null;

try {
  fbApp = initializeApp(firebaseConfig);
  fbDatabase = getDatabase(fbApp);
} catch (err) {
  console.warn('[Firebase] 초기화 경고 (로컬 모드에서는 무시 가능):', err);
}

// 활성 데이터베이스 인스턴스 반환
export function getActiveDatabase() {
  return isLocalMode() ? localDb.database : fbDatabase;
}

// 투명한 DB 프록시
export const database = new Proxy({}, {
  get(target, prop) {
    const active = getActiveDatabase();
    return active ? active[prop] : undefined;
  }
});

// ─── 래퍼 API 함수들 ───────────────────────────────

export function ref(db, path = '') {
  if (typeof db === 'string') {
    path = db;
    db = null;
  }
  const activeDb = getActiveDatabase() || fbDatabase;
  if (isLocalMode()) {
    return localDb.ref(activeDb || localDb.database, path);
  }
  return fbRef(activeDb, path);
}

export function get(targetRef) {
  if (isLocalMode()) {
    return localDb.get(targetRef);
  }
  return fbGet(targetRef);
}

export function set(targetRef, val) {
  if (isLocalMode()) {
    return localDb.set(targetRef, val);
  }
  return fbSet(targetRef, val);
}

export function update(targetRef, val) {
  if (isLocalMode()) {
    return localDb.update(targetRef, val);
  }
  return fbUpdate(targetRef, val);
}

export function remove(targetRef) {
  if (isLocalMode()) {
    return localDb.remove(targetRef);
  }
  return fbRemove(targetRef);
}

export function push(targetRef, val) {
  if (isLocalMode()) {
    return localDb.push(targetRef, val);
  }
  return fbPush(targetRef, val);
}

export function onValue(targetRef, cb) {
  if (isLocalMode()) {
    return localDb.onValue(targetRef, cb);
  }
  return fbOnValue(targetRef, cb);
}

export function off(targetRef, cb) {
  if (isLocalMode()) {
    return localDb.off(targetRef, cb);
  }
  return fbOff(targetRef, cb);
}

export function serverTimestamp() {
  if (isLocalMode()) {
    return localDb.serverTimestamp();
  }
  return fbServerTimestamp();
}

export function runTransaction(targetRef, updateFn) {
  if (isLocalMode()) {
    return localDb.runTransaction(targetRef, updateFn);
  }
  return fbRunTransaction(targetRef, updateFn);
}
