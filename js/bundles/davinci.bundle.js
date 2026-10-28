// ─── DAVINCI BUNDLE (Non-module Standalone) ───
(function() {

// ─── [번들 내장] 로컬 모의 DB 엔진 ───
const __LOCAL_KEY = 'uno_local_mock_db_v1';
let __mockStore = {};
try {
  const saved = localStorage.getItem(__LOCAL_KEY);
  if (saved) __mockStore = JSON.parse(saved);
} catch (e) {}

let __bc = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    __bc = new BroadcastChannel('uno_local_db_channel');
    __bc.onmessage = (e) => {
      if (e.data && e.data.type === 'SYNC') {
        __mockStore = e.data.store || {};
        __triggerListeners();
      }
    };
  } catch(e) {}
}

function __syncStore() {
  try { localStorage.setItem(__LOCAL_KEY, JSON.stringify(__mockStore)); } catch(e) {}
  if (__bc) {
    try { __bc.postMessage({ type: 'SYNC', store: __mockStore }); } catch(e) {}
  }
}

const __listeners = [];
function __triggerListeners() {
  __listeners.forEach(l => {
    try {
      const val = __getPathVal(__mockStore, l.path);
      l.callback({
        key: l.path ? l.path.split('/').pop() : null,
        exists: () => val !== null && val !== undefined,
        val: () => __deepClone(val)
      });
    } catch(e) {}
  });
}

function __deepClone(v) {
  if (v === null || v === undefined) return v;
  try { return JSON.parse(JSON.stringify(v)); } catch(e) { return v; }
}
function __normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function __getPathVal(root, path) {
  const n = __normPath(path);
  if (!n) return __deepClone(root);
  const parts = n.split('/');
  let cur = root;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return null;
    cur = cur[p];
  }
  return __deepClone(cur);
}
function __setPathVal(root, path, val) {
  const n = __normPath(path);
  if (!n) {
    for (const k in root) delete root[k];
    if (val && typeof val === 'object') Object.assign(root, __deepClone(val));
    return;
  }
  const parts = n.split('/');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (val === null || val === undefined) {
    delete cur[last];
  } else {
    cur[last] = __deepClone(val);
  }
}

const database = { _isLocalBundle: true };
function ref(db, path = '') { return { path: __normPath(path), key: __normPath(path).split('/').pop() }; }
function get(r) {
  return Promise.resolve({
    key: r.key,
    exists: () => __getPathVal(__mockStore, r.path) !== null,
    val: () => __getPathVal(__mockStore, r.path)
  });
}
function set(r, val) {
  __setPathVal(__mockStore, r.path, val);
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function update(r, updates) {
  const base = r && r.path ? r.path : '';
  for (const [k, v] of Object.entries(updates || {})) {
    const target = base ? (k.startsWith('/') ? k : `${base}/${k}`) : k;
    __setPathVal(__mockStore, target, v);
  }
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function remove(r) {
  __setPathVal(__mockStore, r.path, null);
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function push(r, val) {
  const autoKey = '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const childPath = r.path ? `${r.path}/${autoKey}` : autoKey;
  const childRef = { path: childPath, key: autoKey };
  if (val !== undefined) set(childRef, val);
  return childRef;
}
function onValue(r, cb) {
  const entry = { path: r.path, callback: cb };
  __listeners.push(entry);
  setTimeout(() => {
    const val = __getPathVal(__mockStore, r.path);
    cb({
      key: r.key,
      exists: () => val !== null && val !== undefined,
      val: () => __deepClone(val)
    });
  }, 0);
  return () => {
    const idx = __listeners.indexOf(entry);
    if (idx !== -1) __listeners.splice(idx, 1);
  };
}
function off(r, cb) {
  for (let i = __listeners.length - 1; i >= 0; i--) {
    if (__listeners[i].path === r.path) {
      if (!cb || __listeners[i].callback === cb) __listeners.splice(i, 1);
    }
  }
}
function serverTimestamp() { return Date.now(); }
function runTransaction(r, fn) {
  const cur = __getPathVal(__mockStore, r.path);
  const n = fn(__deepClone(cur));
  if (n !== undefined) set(r, n);
  return Promise.resolve({ committed: true, snapshot: { val: () => __getPathVal(__mockStore, r.path) } });
}


// ─── Dependency: sound.js ───

// ═══════════════════════════════════════════════════
// Web Audio API 기반 효과음 시스템
// 외부 파일 없이 프로그래밍 방식으로 고품질 효과음 생성
// ═══════════════════════════════════════════════════

let audioCtx = null;

// AudioContext 지연 초기화 (사용자 상호작용 후)
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * 기본 음 생성 헬퍼
 * @param {number} frequency - Hz
 * @param {number} duration - 초
 * @param {string} type - 'sine' | 'square' | 'sawtooth' | 'triangle'
 * @param {number} volume - 0~1
 * @param {number} delay - 지연 시작 (초)
 */
function playTone(frequency, duration, type = 'sine', volume = 0.3, delay = 0) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);

    // 부드러운 페이드 인/아웃
    gainNode.gain.setValueAtTime(0, ctx.currentTime + delay);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);
  } catch (e) {
    // 오디오 미지원 브라우저 대비 무시
  }
}

// ─── 기본 및 공통 효과음 ─────────────────────────────

/** 카드 내려놓기 */
function playCardPlay() {
  playTone(440, 0.08, 'triangle', 0.2);
  playTone(660, 0.12, 'triangle', 0.15, 0.05);
}

/** 카드 뽑기 */
function playCardDraw() {
  playTone(300, 0.1, 'sawtooth', 0.1);
  playTone(250, 0.1, 'sawtooth', 0.08, 0.08);
}

/** 내 차례 알림 */
function playMyTurn() {
  playTone(523, 0.1, 'sine', 0.25);      // C5
  playTone(659, 0.1, 'sine', 0.25, 0.12); // E5
  playTone(784, 0.2, 'sine', 0.3, 0.24);  // G5
}

/** UNO 선언 */
function playUnoCall() {
  playTone(880, 0.08, 'square', 0.3);
  playTone(1100, 0.08, 'square', 0.3, 0.1);
  playTone(880, 0.15, 'square', 0.35, 0.2);
}

/** 승리 팡파레 */
function playWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    playTone(freq, 0.3, 'sine', 0.3, i * 0.15);
  });
}

/** 패배 */
function playLose() {
  playTone(400, 0.2, 'sawtooth', 0.2);
  playTone(320, 0.2, 'sawtooth', 0.2, 0.2);
  playTone(240, 0.4, 'sawtooth', 0.2, 0.4);
}

/** 와일드 카드 */
function playWild() {
  const colors = [330, 392, 440, 494];
  colors.forEach((freq, i) => {
    playTone(freq, 0.08, 'triangle', 0.2, i * 0.06);
  });
}

/** Draw Two / Wild Draw Four */
function playDrawPenalty() {
  playTone(200, 0.15, 'square', 0.25);
  playTone(180, 0.15, 'square', 0.25, 0.15);
  playTone(160, 0.2, 'square', 0.2, 0.3);
}

/** 방 입장 */
function playJoinRoom() {
  playTone(440, 0.1, 'sine', 0.2);
  playTone(550, 0.15, 'sine', 0.25, 0.1);
}

/** 오류/유효하지 않음 */
function playError() {
  playTone(150, 0.1, 'square', 0.2);
  playTone(130, 0.15, 'square', 0.2, 0.1);
}

/** 채팅 메시지 */
function playChat() {
  playTone(880, 0.05, 'sine', 0.15);
}

/** 버튼 클릭 */
function playButtonClick() {
  playTone(520, 0.04, 'sine', 0.18);
  playTone(780, 0.05, 'sine', 0.14, 0.03);
}

/** 할리갈리 종소리 */
function playBell() {
  playTone(987.77, 0.4, 'sine', 0.35); // B5
  playTone(1318.51, 0.5, 'sine', 0.25, 0.02); // E6
  playTone(1975.53, 0.6, 'sine', 0.15, 0.04); // B6
  playTone(2637.02, 0.7, 'triangle', 0.1, 0.06); // E7
}

// ─── 신규 게임 전용 효과음 ──────────────────────────

/** 주사위 굴리는 소리 (야추 다이스) */
function playDiceRoll() {
  const delays = [0, 0.04, 0.08, 0.13, 0.19, 0.26, 0.35];
  delays.forEach((d, i) => {
    const freq = 200 + Math.random() * 260;
    playTone(freq, 0.05, 'triangle', 0.22 - (i * 0.02), d);
  });
}

/** 주사위 홀드 / 고정 토글 소리 (야추 다이스) */
function playDiceHold() {
  playTone(620, 0.06, 'sine', 0.2);
  playTone(830, 0.08, 'sine', 0.25, 0.04);
}

/** 칩 짤랑거리는 베팅 소리 (인디언 포커) */
function playChips() {
  playTone(1200, 0.04, 'triangle', 0.18);
  playTone(1500, 0.05, 'triangle', 0.15, 0.03);
  playTone(950, 0.06, 'triangle', 0.12, 0.07);
}

/** 타일 내려놓기 / 딸깍 소리 (다빈치 코드 & 루미큐브) */
function playTilePlace() {
  playTone(380, 0.05, 'triangle', 0.25);
  playTone(520, 0.04, 'sine', 0.15, 0.02);
}

/** 추리 성공 / 정답 소리 (다빈치 코드 & 라이어 게임) */
function playCorrect() {
  playTone(587.33, 0.12, 'sine', 0.25); // D5
  playTone(880, 0.2, 'sine', 0.3, 0.1);  // A5
  playTone(1174.66, 0.35, 'triangle', 0.35, 0.2); // D6
}

/** 추리 실패 / 오답 소리 */
function playWrong() {
  playTone(220, 0.15, 'sawtooth', 0.25);
  playTone(174.61, 0.25, 'sawtooth', 0.25, 0.12);
}

/** 투표 제출 소리 (라이어 게임) */
function playVote() {
  playTone(440, 0.08, 'sine', 0.2);
  playTone(659.25, 0.12, 'sine', 0.25, 0.07);
}


// ─── Dependency: davinci-rules.js ───

/**
 * 다빈치 코드 (Da Vinci Code) 타일 룰 및 소거법 추리 AI
 * 한국어 주석 필수
 */

// 타일 색상 및 숫자 정의
const TILE_COLORS = ['black', 'white']; // 검은색, 흰색
const TILE_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * 신규 24개 타일 풀 생성
 * { id: 'b_0', color: 'black', value: 0, isOpen: false }
 */
function createTilePool() {
  const pool = [];
  TILE_COLORS.forEach(color => {
    TILE_NUMBERS.forEach(val => {
      pool.push({
        id: `${color[0]}_${val}`,
        color, // 'black' | 'white'
        value: val,
        isOpen: false // 공개 여부
      });
    });
  });

  // 셔플
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

/**
 * 다빈치 코드 고유 정렬 규칙:
 * 1. 숫자가 작은 것이 왼쪽 (오름차순)
 * 2. 숫자가 같을 경우 검은색(black)이 흰색(white)보다 무조건 왼쪽!
 */
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => {
    if (a.value !== b.value) {
      return a.value - b.value;
    }
    // 같은 숫자일 때 검은색이 먼저
    if (a.color === 'black' && b.color === 'white') return -1;
    if (a.color === 'white' && b.color === 'black') return 1;
    return 0;
  });
}

/**
 * 봇 AI: 논리적 소거법 기반 상대방 타일 추리
 * @param {Object} targetTile - 추리 대상 타일 { id, color, isOpen }
 * @param {Array} targetTilesAll - 상대방의 전체 타일 배열 (순서대로 정렬되어 있음)
 * @param {Array} botTiles - 봇 자신의 손패 타일 배열
 * @param {Array} allOpenTiles - 보드 전체에서 이미 공개된 타일들
 * @returns {number} 추리할 숫자 (0~11)
 */
function botDeduceTileValue(targetTile, targetTilesAll, botTiles, allOpenTiles) {
  // 1. 이미 세상에 존재가 확인된 타일 집합 (봇 손패 + 전체 공개 타일)
  const knownTiles = new Set();
  botTiles.forEach(t => knownTiles.add(`${t.color}_${t.value}`));
  allOpenTiles.forEach(t => knownTiles.add(`${t.color}_${t.value}`));

  // 2. 상대방 배열에서 targetTile의 인덱스 확인
  const idx = targetTilesAll.findIndex(t => t.id === targetTile.id);
  if (idx === -1) return Math.floor(Math.random() * 12);

  // 3. 왼쪽과 오른쪽 타일의 숫자 경계선 파악
  let minVal = 0;
  let maxVal = 11;

  // 왼쪽에서 가장 가까운 공개 타일 탐색
  for (let i = idx - 1; i >= 0; i--) {
    const leftT = targetTilesAll[i];
    if (leftT.isOpen) {
      // 같은 색이면 왼쪽보다 무조건 커야 함, 검은색-흰색 관계 고려
      minVal = Math.max(minVal, leftT.value);
      if (leftT.color === targetTile.color) minVal = Math.max(minVal, leftT.value + 1);
      break;
    }
  }

  // 오른쪽에서 가장 가까운 공개 타일 탐색
  for (let i = idx + 1; i < targetTilesAll.length; i++) {
    const rightT = targetTilesAll[i];
    if (rightT.isOpen) {
      maxVal = Math.min(maxVal, rightT.value);
      if (rightT.color === targetTile.color) maxVal = Math.min(maxVal, rightT.value - 1);
      break;
    }
  }

  // 4. minVal ~ maxVal 범위 내에서 아직 미공개된 후보 숫자 목록 필터링
  const candidates = [];
  for (let v = minVal; v <= maxVal; v++) {
    const key = `${targetTile.color}_${v}`;
    if (!knownTiles.has(key)) {
      candidates.push(v);
    }
  }

  // 5. 후보가 있으면 후보 중 하나 선택, 없으면 범위 내 랜덤
  if (candidates.length > 0) {
    // 중앙값 또는 랜덤 선택
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return Math.min(11, Math.max(0, minVal));
}



// ─── Main: davinci.js ───

/**
 * 다빈치 코드 (Da Vinci Code) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

// [import removed]
// [import removed]
// [import removed]

// URL 파라미터 파싱
const urlParams = new URLSearchParams(window.location.search);
const myRoomCode = urlParams.get('room');
const myPlayerId = urlParams.get('player');

if (!myRoomCode || !myPlayerId) {
  alert('방 코드 또는 플레이어 ID가 올바르지 않습니다.');
  window.location.href = 'index.html';
}

// ─── 상태 변수 ─────────────────────────────────────
let isHost = false;
let myName = '';
let myAvatar = '🔢';
let playersList = {};
let playerOrder = [];
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// 추리 선택 상태
let selectedTargetPid = null;
let selectedTargetTileId = null;

// DOM 요소
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const btnLeave = document.getElementById('btn-leave');

let isCodeHidden = false;
function updateRoomCodeText() {
  if (!displayRoomCode) return;
  displayRoomCode.textContent = isCodeHidden ? 'ROOM: •••••• 👁️' : `ROOM: ${myRoomCode} 🔒`;
  displayRoomCode.style.cursor = 'pointer';
  displayRoomCode.title = '클릭하여 방 코드 숨기기/보기';
}

const opponentsZone = document.getElementById('opponents-zone');
const poolTitle = document.getElementById('pool-title');
const btnDrawBlack = document.getElementById('btn-draw-black');
const btnDrawWhite = document.getElementById('btn-draw-white');
const labelBlackCount = document.getElementById('label-black-count');
const labelWhiteCount = document.getElementById('label-white-count');
const drawHint = document.getElementById('draw-hint');

const myRackZone = document.getElementById('my-rack-zone');
const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myTilesStand = document.getElementById('my-tiles-stand');

const guessModal = document.getElementById('guess-modal');
const guessTargetDesc = document.getElementById('guess-target-desc');
const btnCancelGuess = document.getElementById('btn-cancel-guess');

const continueModal = document.getElementById('continue-modal');
const btnChoiceContinue = document.getElementById('btn-choice-continue');
const btnChoicePass = document.getElementById('btn-choice-pass');

const resultModal = document.getElementById('result-modal');
const resultTrophy = document.getElementById('result-trophy');
const resultWinnerTitle = document.getElementById('result-winner-title');
const resultDesc = document.getElementById('result-desc');
const btnModalLobby = document.getElementById('btn-modal-lobby');
const btnModalRestart = document.getElementById('btn-modal-restart');

// ─── 초기화 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateRoomCodeText();
  displayRoomCode?.addEventListener('click', () => {
    isCodeHidden = !isCodeHidden;
    updateRoomCodeText();
  });
  bindUiEvents();

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!roomSnap.exists()) {
      alert('존재하지 않는 방입니다.');
      window.location.href = 'index.html';
      return;
    }

    const room = roomSnap.val();
    playersList = room.players || {};
    isHost = (room.host === myPlayerId);

    if (playersList[myPlayerId]) {
      myName = playersList[myPlayerId].name;
      myAvatar = playersList[myPlayerId].avatar || '🦊';
    }

    myAvatarEl.textContent = myAvatar;
    myNameEl.textContent = `${myName}의 타일`;

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initDavinciGameState();
    }

    listenToDavinciRoom();

  } catch (err) {
    console.error('다빈치 코드 초기화 실패:', err);
  }
});

async function initDavinciGameState() {
  const pool = createTilePool();
  const hands = {};
  const initialTileCount = playerOrder.length === 2 ? 4 : 3;

  playerOrder.forEach(pid => {
    const playerTiles = [];
    for (let i = 0; i < initialTileCount; i++) {
      if (pool.length > 0) {
        playerTiles.push(pool.pop());
      }
    }
    hands[pid] = sortTiles(playerTiles);
  });

  const newGs = {
    pool,
    hands,
    turnIndex: 0,
    phase: 'draw',
    newDrawnTileId: null,
    eliminated: [],
    winnerId: null,
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

function listenToDavinciRoom() {
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  roomListener = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      alert('방이 종료되었습니다.');
      window.location.href = 'index.html';
      return;
    }

    const room = snapshot.val();
    playersList = room.players || {};

    // [★ 핵심] 방 상태가 waiting으로 환원되면 모든 유저가 함께 대기실로 이동
    if (room.status === 'waiting') {
      isNavigatingToLobby = true;
      window.location.href = 'index.html';
      return;
    }

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    const gs = room.gameState;
    if (!gs) return;

    currentGs = gs;
    renderDavinciBoard(gs);

    checkDavinciBotAction(gs);
  });
}

function renderDavinciBoard(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId);
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🔢' };

  turnAvatar.textContent = currentPlayer.avatar || '🔢';
  if (isMyTurn) {
    turnText.textContent = gs.phase === 'draw' ? '타일을 1장 뽑으세요!' : '상대방 타일을 추리하세요!';
    turnText.style.color = 'var(--gold)';
  } else {
    turnText.textContent = `${currentPlayer.name} 님의 차례...`;
    turnText.style.color = '#F0F0FF';
  }

  renderTilePool(gs.pool || [], isMyTurn && gs.phase === 'draw');
  renderOpponents(gs, isMyTurn && gs.phase === 'guess');
  renderMyRack(gs, isMyTurn);

  if (isMyTurn && gs.phase === 'decide') {
    continueModal.classList.add('show');
  } else {
    continueModal.classList.remove('show');
  }

  if (gs.phase === 'finished') {
    renderResult(gs);
  }
}

function renderTilePool(pool, canDraw) {
  const blackCount = pool.filter(t => t.color === 'black').length;
  const whiteCount = pool.filter(t => t.color === 'white').length;
  const totalCount = pool.length;

  poolTitle.textContent = `중앙 타일 더미 (남은 타일: ${totalCount}개)`;
  labelBlackCount.textContent = `검은색 (${blackCount})`;
  labelWhiteCount.textContent = `흰색 (${whiteCount})`;

  btnDrawBlack.disabled = !canDraw || blackCount === 0;
  btnDrawWhite.disabled = !canDraw || whiteCount === 0;

  if (canDraw) {
    drawHint.textContent = '원하는 색상의 타일을 1장 뽑아 턴을 시작하세요!';
    drawHint.style.color = 'var(--gold)';
  } else {
    drawHint.textContent = '중앙 더미에서 타일을 가져올 수 없습니다.';
    drawHint.style.color = 'rgba(240,240,255,0.45)';
  }
}

function renderOpponents(gs, canSelectTile) {
  opponentsZone.innerHTML = '';
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];

  playerOrder.forEach(pid => {
    if (pid === myPlayerId) return;
    const p = playersList[pid] || { name: '상대방', avatar: '👤' };
    const pTiles = gs.hands?.[pid] || [];
    const isEliminated = (gs.eliminated || []).includes(pid);
    const isTheirTurn = (pid === currentPid);

    const card = document.createElement('div');
    card.className = `player-rack-card ${isTheirTurn ? 'active-turn' : ''} ${isEliminated ? 'eliminated' : ''}`;

    const header = document.createElement('div');
    header.className = 'rack-header';
    header.innerHTML = `
      <div class="rack-user-info">
        <span>${p.avatar || '👤'}</span>
        <span>${escapeHtml(p.name)}</span>
        ${isEliminated ? '<span style="color:#EB3B5A; font-size:0.75rem;">(탈락)</span>' : ''}
      </div>
      <div style="font-size:0.8rem; color:rgba(240,240,255,0.5);">타일 ${pTiles.length}개</div>
    `;
    card.appendChild(header);

    const stand = document.createElement('div');
    stand.className = 'tiles-stand';

    pTiles.forEach(tile => {
      const tileEl = document.createElement('div');
      const isSelectable = canSelectTile && !tile.isOpen && !isEliminated;

      tileEl.className = `tile-item ${tile.color} ${tile.isOpen ? '' : 'secret'} ${isSelectable ? 'selectable' : ''} ${tile.id === gs.newDrawnTileId ? 'new-drawn' : ''}`;
      
      if (tile.isOpen) {
        tileEl.textContent = tile.value;
      } else {
        tileEl.textContent = '?';
      }

      if (isSelectable) {
        tileEl.addEventListener('click', () => {
          openGuessModal(pid, p.name, tile);
        });
      }

      stand.appendChild(tileEl);
    });

    card.appendChild(stand);
    opponentsZone.appendChild(card);
  });
}

function renderMyRack(gs, isMyTurn) {
  myTilesStand.innerHTML = '';
  const myTiles = gs.hands?.[myPlayerId] || [];

  if (isMyTurn) myRackZone.classList.add('active-turn');
  else myRackZone.classList.remove('active-turn');

  myTiles.forEach(tile => {
    const tileEl = document.createElement('div');
    tileEl.className = `tile-item ${tile.color} ${tile.id === gs.newDrawnTileId ? 'new-drawn' : ''}`;
    tileEl.textContent = tile.value;

    if (!tile.isOpen) {
      const lockBadge = document.createElement('span');
      lockBadge.style.cssText = 'position:absolute; bottom:2px; font-size:0.65rem; opacity:0.6;';
      lockBadge.textContent = '🔒';
      tileEl.appendChild(lockBadge);
    }

    myTilesStand.appendChild(tileEl);
  });
}

async function handleDrawTile(color) {
  if (!currentGs || currentGs.phase !== 'draw') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playTilePlace();

  const pool = [...currentGs.pool];
  const targetIndex = pool.findIndex(t => t.color === color);
  if (targetIndex === -1) return;

  const drawnTile = pool.splice(targetIndex, 1)[0];
  const myHand = [...(currentGs.hands[myPlayerId] || []), drawnTile];
  const sortedHand = sortTiles(myHand);

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    pool,
    [`hands/${myPlayerId}`]: sortedHand,
    phase: 'guess',
    newDrawnTileId: drawnTile.id,
    lastActionTime: Date.now()
  });
}

function openGuessModal(targetPid, targetName, targetTile) {
  selectedTargetPid = targetPid;
  selectedTargetTileId = targetTile.id;

  guessTargetDesc.innerHTML = `<strong>${escapeHtml(targetName)}</strong> 님의 <span style="color:${targetTile.color === 'white' ? '#fff' : '#aaa'}; font-weight:800;">[${targetTile.color === 'white' ? '흰색' : '검은색'}]</span> 타일의 숫자를 맞추세요!`;
  guessModal.classList.add('show');
}

async function handleGuessNumber(guessedNumber) {
  guessModal.classList.remove('show');
  if (!currentGs || currentGs.phase !== 'guess') return;

  const targetPid = selectedTargetPid;
  const tileId = selectedTargetTileId;
  const targetHand = currentGs.hands[targetPid] || [];
  const targetTileIndex = targetHand.findIndex(t => t.id === tileId);

  if (targetTileIndex === -1) return;

  const targetTile = targetHand[targetTileIndex];
  const isCorrect = (targetTile.value === guessedNumber);

  if (isCorrect) {
    playCorrect();
    const updatedTargetHand = [...targetHand];
    updatedTargetHand[targetTileIndex] = { ...targetTile, isOpen: true };

    const isTargetEliminated = updatedTargetHand.every(t => t.isOpen);
    const updatedEliminated = [...(currentGs.eliminated || [])];
    if (isTargetEliminated && !updatedEliminated.includes(targetPid)) {
      updatedEliminated.push(targetPid);
    }

    const activePlayers = playerOrder.filter(pid => !updatedEliminated.includes(pid));
    if (activePlayers.length === 1) {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        [`hands/${targetPid}`]: updatedTargetHand,
        eliminated: updatedEliminated,
        phase: 'finished',
        winnerId: activePlayers[0],
        lastActionTime: Date.now()
      });
      return;
    }

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      [`hands/${targetPid}`]: updatedTargetHand,
      eliminated: updatedEliminated,
      phase: 'decide',
      lastActionTime: Date.now()
    });

  } else {
    playWrong();
    
    const myHand = currentGs.hands[myPlayerId] || [];
    const updatedMyHand = myHand.map(t => {
      if (t.id === currentGs.newDrawnTileId) {
        return { ...t, isOpen: true };
      }
      return t;
    });

    await passTurnToNext(updatedMyHand);
  }
}

async function handlePassTurn() {
  continueModal.classList.remove('show');
  playButtonClick();
  await passTurnToNext(currentGs.hands[myPlayerId]);
}

async function handleContinueGuess() {
  continueModal.classList.remove('show');
  playButtonClick();
  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'guess',
    lastActionTime: Date.now()
  });
}

async function passTurnToNext(updatedCurrentPlayerHand = null) {
  const eliminated = currentGs.eliminated || [];
  let nextIndex = currentGs.turnIndex + 1;

  while (eliminated.includes(playerOrder[nextIndex % playerOrder.length])) {
    nextIndex++;
  }

  const updates = {
    turnIndex: nextIndex,
    phase: 'draw',
    newDrawnTileId: null,
    lastActionTime: Date.now()
  };

  if (updatedCurrentPlayerHand) {
    updates[`hands/${playerOrder[currentGs.turnIndex % playerOrder.length]}`] = updatedCurrentPlayerHand;
  }

  await update(ref(database, `rooms/${myRoomCode}/gameState`), updates);

  if (playerOrder[nextIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

function checkDavinciBotAction(gs) {
  if (!isHost || gs.phase === 'finished') return;

  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const player = playersList[currentPid];
  if (!player || !player.isBot) return;

  if (botActionTimer) clearTimeout(botActionTimer);

  botActionTimer = setTimeout(async () => {
    await runDavinciBotTurn(currentPid, gs);
  }, 1400);
}

async function runDavinciBotTurn(botId, gs) {
  if (gs.phase === 'draw') {
    const pool = gs.pool || [];
    if (pool.length === 0) {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        phase: 'guess',
        newDrawnTileId: null
      });
      return;
    }

    const hasBlack = pool.some(t => t.color === 'black');
    const hasWhite = pool.some(t => t.color === 'white');
    const chosenColor = (hasBlack && hasWhite) ? (Math.random() < 0.5 ? 'black' : 'white') : (hasBlack ? 'black' : 'white');

    const nextPool = [...pool];
    const idx = nextPool.findIndex(t => t.color === chosenColor);
    const drawn = nextPool.splice(idx, 1)[0];

    const botHand = sortTiles([...(gs.hands[botId] || []), drawn]);

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      pool: nextPool,
      [`hands/${botId}`]: botHand,
      phase: 'guess',
      newDrawnTileId: drawn.id,
      lastActionTime: Date.now()
    });
    return;
  }

  if (gs.phase === 'guess') {
    const eliminated = gs.eliminated || [];
    const targets = playerOrder.filter(pid => pid !== botId && !eliminated.includes(pid));
    if (targets.length === 0) return;

    const targetPid = targets[Math.floor(Math.random() * targets.length)];
    const targetHand = gs.hands[targetPid] || [];
    const secretTiles = targetHand.filter(t => !t.isOpen);

    if (secretTiles.length === 0) return;
    const targetTile = secretTiles[Math.floor(Math.random() * secretTiles.length)];

    const allOpen = [];
    Object.values(gs.hands || {}).forEach(h => {
      h.filter(t => t.isOpen).forEach(ot => allOpen.push(ot));
    });

    const guessVal = botDeduceTileValue(targetTile, targetHand, gs.hands[botId] || [], allOpen);
    const isCorrect = (targetTile.value === guessVal);
    const tIdx = targetHand.findIndex(t => t.id === targetTile.id);

    if (isCorrect) {
      playCorrect();
      const newTargetHand = [...targetHand];
      newTargetHand[tIdx] = { ...targetTile, isOpen: true };

      const isTargetEliminated = newTargetHand.every(t => t.isOpen);
      const updatedEliminated = [...eliminated];
      if (isTargetEliminated && !updatedEliminated.includes(targetPid)) {
        updatedEliminated.push(targetPid);
      }

      const activePlayers = playerOrder.filter(pid => !updatedEliminated.includes(pid));
      if (activePlayers.length === 1) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          [`hands/${targetPid}`]: newTargetHand,
          eliminated: updatedEliminated,
          phase: 'finished',
          winnerId: activePlayers[0]
        });
        return;
      }

      if (Math.random() < 0.5) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          [`hands/${targetPid}`]: newTargetHand,
          eliminated: updatedEliminated,
          phase: 'guess'
        });
      } else {
        await passTurnToNext();
      }

    } else {
      playWrong();
      const botHand = (gs.hands[botId] || []).map(t => {
        if (t.id === gs.newDrawnTileId) return { ...t, isOpen: true };
        return t;
      });
      await passTurnToNext(botHand);
    }
  }

  if (gs.phase === 'decide') {
    await passTurnToNext();
  }
}

function renderResult(gs) {
  const winner = playersList[gs.winnerId] || { name: '승리자', avatar: '🏆' };
  const isMe = (gs.winnerId === myPlayerId);

  if (isMe) {
    playWin();
    resultTrophy.textContent = '🏆';
    resultWinnerTitle.textContent = '승리하였습니다!';
    resultWinnerTitle.style.color = 'var(--gold)';
    resultDesc.textContent = '모든 상대방의 비밀 타일을 간파하고 승리했습니다!';
  } else {
    playLose();
    resultTrophy.textContent = '💀';
    resultWinnerTitle.textContent = `${winner.name} 님의 승리!`;
    resultWinnerTitle.style.color = '#EB3B5A';
    resultDesc.textContent = `${winner.name} 님이 끝까지 살아남아 우승을 차지했습니다.`;
  }

  btnModalRestart.style.display = isHost ? 'block' : 'none';
  resultModal.classList.add('show');
}

// ─── 중간 이탈 및 안전 종료 처리 ─────────────────────
async function handleLeaveGameSafely() {
  if (isNavigatingToLobby) return;
  isNavigatingToLobby = true;

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!roomSnap.exists()) {
      window.location.href = 'index.html';
      return;
    }

    const room = roomSnap.val();
    const players = room.players || {};
    const humanPlayerIds = Object.keys(players).filter(id => !id.startsWith('bot_') && id !== myPlayerId);

    if (humanPlayerIds.length === 0) {
      await remove(ref(database, `rooms/${myRoomCode}`));
    } else {
      const updates = {};
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      
      // 내 타일 모두 오픈 및 탈락 처리
      if (room.gameState) {
        const myHand = (room.gameState.hands?.[myPlayerId] || []).map(t => ({ ...t, isOpen: true }));
        updates[`rooms/${myRoomCode}/gameState/hands/${myPlayerId}`] = myHand;
        
        const eliminated = [...(room.gameState.eliminated || [])];
        if (!eliminated.includes(myPlayerId)) eliminated.push(myPlayerId);
        updates[`rooms/${myRoomCode}/gameState/eliminated`] = eliminated;

        // 남은 생존자 검사
        const active = Object.keys(players).filter(id => id !== myPlayerId && !eliminated.includes(id));
        if (active.length === 1) {
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'finished';
          updates[`rooms/${myRoomCode}/gameState/winnerId`] = active[0];
        } else if (playerOrder[room.gameState.turnIndex % playerOrder.length] === myPlayerId) {
          updates[`rooms/${myRoomCode}/gameState/turnIndex`] = room.gameState.turnIndex + 1;
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'draw';
          updates[`rooms/${myRoomCode}/gameState/newDrawnTileId`] = null;
        }
      }

      if (room.host === myPlayerId) {
        const nextHost = humanPlayerIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

      await update(ref(database), updates);
    }
  } catch (err) {
    console.error('다빈치 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnDrawBlack.addEventListener('click', () => handleDrawTile('black'));
  btnDrawWhite.addEventListener('click', () => handleDrawTile('white'));

  document.querySelectorAll('.btn-num-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const num = parseInt(btn.dataset.num, 10);
      handleGuessNumber(num);
    });
  });

  btnCancelGuess.addEventListener('click', () => {
    guessModal.classList.remove('show');
  });

  btnChoicePass.addEventListener('click', handlePassTurn);
  btnChoiceContinue.addEventListener('click', handleContinueGuess);

  btnLeave.addEventListener('click', () => {
    if (confirm('게임을 나가시겠습니까? 다른 플레이어들은 계속 진행됩니다.')) {
      handleLeaveGameSafely();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (!isNavigatingToLobby) {
      handleLeaveGameSafely();
    }
  });

  // [★ 핵심 해결: 대기실 복귀 버튼]
  btnModalLobby.addEventListener('click', async () => {
    isNavigatingToLobby = true;
    try {
      await update(ref(database, `rooms/${myRoomCode}`), {
        status: 'waiting',
        gameState: null
      });
    } catch (e) {
      console.error(e);
    }
    window.location.href = 'index.html';
  });

  btnModalRestart.addEventListener('click', async () => {
    if (!isHost) return;
    resultModal.classList.remove('show');
    await initDavinciGameState();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


})();