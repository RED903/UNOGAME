// ═══════════════════════════════════════════════════
// 로컬 모의 데이터베이스 (Mock Realtime Database Engine)
// Firebase Realtime Database SDK의 핵심 API를 브라우저 로컬 환경
// (인메모리 + localStorage + BroadcastChannel)에서 100% 완벽 호환 구현
// ═══════════════════════════════════════════════════

const STORAGE_KEY = 'uno_local_mock_db_v1';
const BROADCAST_CHANNEL_NAME = 'uno_local_db_channel';

// 1. 메모리 저장소
let store = {};

// localStorage에서 초기 데이터 로드
function loadStoreFromStorage() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('[LocalDB] 저장소 로드 실패:', err);
    return {};
  }
}

store = loadStoreFromStorage();

// 저장소 영속화
function persistStore() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('[LocalDB] 저장소 저장 실패:', err);
  }
}

// 2. 브라우저 탭 간 실시간 통신 (BroadcastChannel)
let broadcastChannel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'SYNC_STORE') {
        store = event.data.store || {};
        notifyAllListeners();
      }
    };
  } catch (e) {
    console.warn('[LocalDB] BroadcastChannel 지원 안 됨:', e);
  }
}

// storage 이벤트 백업 (BroadcastChannel 미지원 브라우저 호환)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        store = JSON.parse(e.newValue);
        notifyAllListeners();
      } catch (err) {}
    }
  });
}

function broadcastSync() {
  persistStore();
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'SYNC_STORE',
        store: store,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('[LocalDB] 브로드캐스트 전송 오류:', err);
    }
  }
}

// 3. 리스너 관리
const listeners = [];

function notifyAllListeners() {
  listeners.forEach(entry => {
    try {
      const val = getValueAtPath(store, entry.path);
      const snapshot = new MockDataSnapshot(entry.key, val);
      entry.callback(snapshot);
    } catch (err) {
      console.error('[LocalDB] 리스너 호출 오류:', err);
    }
  });
}

function notifySubtree(pathStr) {
  const norm = normalizePath(pathStr);
  listeners.forEach(entry => {
    // entry.path가 변경된 경로의 상위, 동일, 또는 하위인 경우 모두 알림
    if (
      entry.path === norm ||
      entry.path === '' ||
      norm === '' ||
      entry.path.startsWith(norm + '/') ||
      norm.startsWith(entry.path + '/')
    ) {
      try {
        const val = getValueAtPath(store, entry.path);
        const snapshot = new MockDataSnapshot(entry.key, val);
        entry.callback(snapshot);
      } catch (err) {
        console.error('[LocalDB] 리스너 호출 오류:', err);
      }
    }
  });
}

// 4. 경로 정규화 및 탐색 도우미
function normalizePath(path) {
  if (!path) return '';
  return String(path)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/+/g, '/');
}

function deepClone(val) {
  if (val === undefined || val === null) return val;
  try {
    return JSON.parse(JSON.stringify(val));
  } catch (err) {
    return val;
  }
}

function getValueAtPath(rootObj, pathStr) {
  const norm = normalizePath(pathStr);
  if (!norm) return deepClone(rootObj);

  const parts = norm.split('/');
  let curr = rootObj;
  for (const p of parts) {
    if (!curr || typeof curr !== 'object' || !(p in curr)) {
      return null;
    }
    curr = curr[p];
  }
  return deepClone(curr);
}

function setValueAtPath(rootObj, pathStr, value) {
  const norm = normalizePath(pathStr);
  if (!norm) {
    if (value && typeof value === 'object') {
      // 루트 교체
      for (const k in rootObj) delete rootObj[k];
      Object.assign(rootObj, deepClone(value));
    }
    return;
  }

  const parts = norm.split('/');
  let curr = rootObj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr[p] || typeof curr[p] !== 'object') {
      curr[p] = {};
    }
    curr = curr[p];
  }

  const lastKey = parts[parts.length - 1];
  if (value === null || value === undefined) {
    delete curr[lastKey];
  } else {
    curr[lastKey] = deepClone(value);
  }
}

// 5. Snapshot 클래스 (Firebase DataSnapshot 호환)
class MockDataSnapshot {
  constructor(key, value) {
    this._key = key;
    this._value = value;
  }

  get key() {
    return this._key;
  }

  exists() {
    return this._value !== null && this._value !== undefined;
  }

  val() {
    return deepClone(this._value);
  }

  forEach(action) {
    if (!this._value || typeof this._value !== 'object') return false;
    const keys = Object.keys(this._value);
    for (const k of keys) {
      const childSnap = new MockDataSnapshot(k, this._value[k]);
      if (action(childSnap) === true) return true;
    }
    return false;
  }
}

// 6. Ref 클래스 (Firebase DatabaseReference 호환)
class MockDatabaseReference {
  constructor(pathStr) {
    this.path = normalizePath(pathStr);
    const parts = this.path ? this.path.split('/') : [];
    this.key = parts.length > 0 ? parts[parts.length - 1] : null;
  }

  toString() {
    return `mockdb://${this.path}`;
  }
}

// 7. 가짜 Database 인스턴스
const database = {
  _isMock: true,
  _store: store,
  clearAll() {
    store = {};
    persistStore();
    broadcastSync();
    notifyAllListeners();
  }
};

// 8. Firebase RTDB API 구현 함수들

export function ref(db, path = '') {
  return new MockDatabaseReference(path);
}

export function get(mockRef) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const val = getValueAtPath(store, mockRef.path);
      const snapshot = new MockDataSnapshot(mockRef.key, val);
      resolve(snapshot);
    }, 10);
  });
}

export function set(mockRef, value) {
  return new Promise((resolve) => {
    setValueAtPath(store, mockRef.path, value);
    broadcastSync();
    notifySubtree(mockRef.path);
    resolve();
  });
}

export function update(mockRef, updates) {
  return new Promise((resolve) => {
    if (!updates || typeof updates !== 'object') {
      resolve();
      return;
    }

    const basePath = mockRef ? mockRef.path : '';

    for (const [key, val] of Object.entries(updates)) {
      let targetPath = '';
      if (key.startsWith('/')) {
        targetPath = normalizePath(key);
      } else if (basePath) {
        targetPath = normalizePath(`${basePath}/${key}`);
      } else {
        targetPath = normalizePath(key);
      }

      setValueAtPath(store, targetPath, val);
    }

    broadcastSync();
    notifySubtree(basePath);
    resolve();
  });
}

export function remove(mockRef) {
  return set(mockRef, null);
}

export function push(mockRef, value) {
  const autoKey = '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const childPath = mockRef.path ? `${mockRef.path}/${autoKey}` : autoKey;
  const childRef = new MockDatabaseReference(childPath);

  if (value !== undefined) {
    set(childRef, value);
  }
  return childRef;
}

export function onValue(mockRef, callback) {
  const entry = {
    path: mockRef.path,
    key: mockRef.key,
    callback
  };
  listeners.push(entry);

  // 등록 즉시 1회 초기 호출 (비동기로 전달)
  setTimeout(() => {
    const val = getValueAtPath(store, mockRef.path);
    const snapshot = new MockDataSnapshot(mockRef.key, val);
    try {
      callback(snapshot);
    } catch (err) {
      console.error('[LocalDB] onValue 초기 콜백 오류:', err);
    }
  }, 0);

  // unsubscribe 함수 반환
  return () => {
    const idx = listeners.indexOf(entry);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function off(mockRef, callback) {
  const targetPath = mockRef.path;
  for (let i = listeners.length - 1; i >= 0; i--) {
    if (listeners[i].path === targetPath) {
      if (!callback || listeners[i].callback === callback) {
        listeners.splice(i, 1);
      }
    }
  }
}

export function serverTimestamp() {
  return Date.now();
}

export function runTransaction(mockRef, transactionUpdate) {
  return new Promise((resolve) => {
    const currentVal = getValueAtPath(store, mockRef.path);
    const newVal = transactionUpdate(deepClone(currentVal));
    if (newVal !== undefined) {
      setValueAtPath(store, mockRef.path, newVal);
      broadcastSync();
      notifySubtree(mockRef.path);
    }
    const finalVal = getValueAtPath(store, mockRef.path);
    const snapshot = new MockDataSnapshot(mockRef.key, finalVal);
    resolve({ committed: true, snapshot });
  });
}

export { database };

