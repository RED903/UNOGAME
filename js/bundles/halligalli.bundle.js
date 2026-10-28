// ─── HALLIGALLI BUNDLE (Non-module Standalone) ───
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


// ─── Dependency: halligalli-rules.js ───

/**
 * 할리갈리 룰 엔진
 * 한국어 주석
 */

// 과일 상수
const FRUITS = {
  STRAWBERRY: '🍓',
  BANANA: '🍌',
  LIME: '🍋', // 라임/레몬
  PLUM: '🍇'    // 자두/포도
};

/**
 * 56장의 할리갈리 덱 생성
 * 구성 (과일당 14장씩, 총 56장)
 * - 1개: 5장
 * - 2개: 3장
 * - 3개: 3장
 * - 4개: 2장
 * - 5개: 1장
 */
function createHalliGalliDeck() {
  const deck = [];
  let cardId = 1;

  Object.values(FRUITS).forEach(fruit => {
    // 1개짜리 5장
    for (let i = 0; i < 5; i++) deck.push({ id: `c_${cardId++}`, fruit, count: 1 });
    // 2개짜리 3장
    for (let i = 0; i < 3; i++) deck.push({ id: `c_${cardId++}`, fruit, count: 2 });
    // 3개짜리 3장
    for (let i = 0; i < 3; i++) deck.push({ id: `c_${cardId++}`, fruit, count: 3 });
    // 4개짜리 2장
    for (let i = 0; i < 2; i++) deck.push({ id: `c_${cardId++}`, fruit, count: 4 });
    // 5개짜리 1장
    for (let i = 0; i < 1; i++) deck.push({ id: `c_${cardId++}`, fruit, count: 5 });
  });

  return shuffle(deck);
}

/**
 * 피셔-예이츠 셔플
 */
function shuffle(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * 바닥에 공개된 카드들의 과일 합 계산하여 '정확히 5개' 여부 판정
 * @param {Object} openCards 플레이어별 현재 오픈된 최신 카드 정보 { playerId: { id, fruit, count } }
 * @returns {boolean} 과일 중 하나라도 합이 정확히 5개인 경우 true
 */
function checkFiveFruits(openCards) {
  if (!openCards) return false;

  const totals = {};
  Object.values(FRUITS).forEach(f => {
    totals[f] = 0;
  });

  let hasCard = false;
  Object.values(openCards).forEach(card => {
    if (card && card.fruit && card.count) {
      totals[card.fruit] += card.count;
      hasCard = true;
    }
  });

  if (!hasCard) return false;

  // 어떤 과일이든 합이 정확히 5개인지 검사
  return Object.values(totals).some(count => count === 5);
}


// ─── Main: halligalli.js ───

/**
 * 할리갈리 (Halli Galli) 실시간 게임 로직
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
let myAvatar = '🦊';
let gs = null; // 게임 상태
let playersList = {}; // { pid: { name, avatar, isBot } }
const unsubList = [];

// 봇 타이머 리스트
let botActionTimers = [];

// DOM 요소들
const displayRoomCode = document.getElementById('display-room-code');
const turnStatus = document.getElementById('turn-status');
const btnLeave = document.getElementById('btn-leave');
const btnBell = document.getElementById('btn-bell');
const btnFlip = document.getElementById('btn-flip');
const opponentsArea = document.getElementById('opponents-area');
const penaltyNotice = document.getElementById('penalty-notice');
const actionLog = document.getElementById('action-log');

const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myDeckCount = document.getElementById('my-deck-count');
const myOpenCardSlot = document.getElementById('my-open-card-slot');

const gameOverOverlay = document.getElementById('game-over-overlay');
const winnerNameEl = document.getElementById('winner-name');
const playersRankingEl = document.getElementById('players-ranking');
const btnBackLobby = document.getElementById('btn-back-lobby');
const btnRestart = document.getElementById('btn-restart');
const btnOverlayLeave = document.getElementById('btn-overlay-leave');

// ─── 초기화 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  displayRoomCode.textContent = myRoomCode;
  initEmotePanel();

  try {
    // 1. 방 정보 취득
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
    myNameEl.textContent = myName;
    document.querySelector('.my-status-card')?.setAttribute('data-pid', myPlayerId);

    // 2. 방장 주도의 카드 게임 상태 초기화
    if (isHost && !room.gameState) {
      await initHalliGalliGame(room);
    }

    // 3. 실시간 리스너 작동
    subscribeToRoom();

  } catch (err) {
    console.error('할리갈리 초기화 실패:', err);
  }
});

// ─── 방장: 게임 최초 초기화 ────────────────────────────
async function initHalliGalliGame(room) {
  const pids = Object.keys(room.players || {});
  
  // 56장 덱 생성 및 공평 배분
  const fullDeck = createHalliGalliDeck();
  const decks = {};
  pids.forEach(pid => { decks[pid] = []; });

  fullDeck.forEach((card, idx) => {
    const targetPid = pids[idx % pids.length];
    decks[targetPid].push(card);
  });

  const playersOut = {};
  pids.forEach(pid => {
    playersOut[pid] = false;
  });

  const gameState = {
    status: 'playing',
    turn: pids[0], // 첫 턴
    playerOrder: pids,
    bellRungPid: '',
    bellRungTime: 0,
    decks,
    // faceUpPile: 각 플레이어의 앞면 쌓인 더미 (배열). 카드를 뒤집을수록 쌓임.
    // 종 성공 시 전체 수거, 오발 시 그대로 유지.
    faceUpPile: {},
    playersOut,
    roundCount: 1,
    bellRungResult: {
      status: 'none',
      winnerId: '',
      ts: 0
    }
  };

  // faceUpPile 초기화 (빈 배열)
  pids.forEach(pid => {
    gameState.faceUpPile[pid] = [];
  });

  await update(ref(database, `rooms/${myRoomCode}/gameState`), gameState);
}

// ─── Firebase 실시간 구독 ─────────────────────────────────
function subscribeToRoom() {
  const gsRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const unsub = onValue(gsRef, (snapshot) => {
    if (!snapshot.exists()) {
      // 방 파괴 시 로비로
      cleanup();
      window.location.href = 'index.html';
      return;
    }

    gs = snapshot.val();
    updateUI();

    // 봇 AI 구동
    handleBotAI();
  });
  unsubList.push(unsub);

  // 로비 정보 업데이트에 대응하여 나갈 때 분기
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const unsubRoom = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const room = snapshot.val();
    if (room.status === 'waiting') {
      // 대기실로 방이 환원된 경우
      cleanup();
      window.location.href = 'index.html';
    }
  });
  unsubList.push(unsubRoom);

  // 실시간 감정표현 리스너
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  const unsubEmote = onValue(emoteRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const emotes = snapshot.val();
    Object.entries(emotes).forEach(([pid, data]) => {
      if (pid !== myPlayerId && data && data.emote) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });
  unsubList.push(unsubEmote);
}

// ─── UI 실시간 갱신 ──────────────────────────────────────
function updateUI() {
  if (!gs) return;

  const currentTurnPid = gs.turn;
  const isMyTurn = (currentTurnPid === myPlayerId);

  // 1. 내 카드덱 수량 및 오픈 카드 슬롯 렌더링
  const myDeck = gs.decks?.[myPlayerId] || [];
  myDeckCount.textContent = myDeck.length;
  
  // faceUpPile의 가장 위 카드(최신 카드)를 표시
  const myPile = gs.faceUpPile?.[myPlayerId] || [];
  const myTopCard = myPile.length > 0 ? myPile[myPile.length - 1] : null;
  renderCard(myTopCard, myOpenCardSlot);

  // 2. 카드 뒤집기 버튼 활성 조건
  // 내 턴이고, 내 덱에 카드가 남아있으며, 아직 종이 울린 결과 판정 중이 아닐 때
  const bellLocked = gs.bellRungPid !== '' && gs.bellRungPid !== undefined;
  if (isMyTurn && myDeck.length > 0 && !bellLocked && !gs.playersOut?.[myPlayerId]) {
    btnFlip.disabled = false;
  } else {
    btnFlip.disabled = true;
  }

  // 3. 턴 상태 뱃지 업데이트
  if (gs.playersOut?.[myPlayerId]) {
    turnStatus.textContent = '❌ 파산 (아웃됨)';
    turnStatus.className = 'turn-status-badge';
    turnStatus.style.color = '#ef4444';
  } else if (isMyTurn) {
    turnStatus.textContent = '👉 내 차례! 카드를 뒤집으세요!';
    turnStatus.className = 'turn-status-badge my-turn';
    turnStatus.style.color = '#10b981';
  } else {
    const turnPlayerName = playersList[currentTurnPid]?.name || '상대';
    turnStatus.textContent = `⏳ ${turnPlayerName}의 차례`;
    turnStatus.className = 'turn-status-badge';
    turnStatus.style.color = 'rgba(240,240,255,0.6)';
  }

  // 4. 상대방 영역 DOM 캐싱 방식으로 업데이트 (매번 초기화하면 깜빡임 발생)
  const order = gs.playerOrder || [];
  const renderedPids = new Set();

  order.forEach(pid => {
    if (pid === myPlayerId) return; // 나는 제외
    renderedPids.add(pid);

    const pInfo = playersList[pid] || { name: '컴퓨터', avatar: '🤖' };
    const pDeck = gs.decks?.[pid] || [];
    // faceUpPile 최상위 카드를 오픈 카드로 표시
    const pPile = gs.faceUpPile?.[pid] || [];
    const pOpenCard = pPile.length > 0 ? pPile[pPile.length - 1] : null;
    const isHisTurn = (gs.turn === pid);
    const isOut = gs.playersOut?.[pid];

    // 이미 DOM에 있는 노드는 재사용, 없으면 새로 생성
    let cardDiv = opponentsArea.querySelector(`[data-opponent-pid="${pid}"]`);
    if (!cardDiv) {
      cardDiv = document.createElement('div');
      cardDiv.dataset.opponentPid = pid;
      cardDiv.dataset.pid = pid;
      cardDiv.innerHTML = `
        <div class="opponent-profile">
          <span class="opponent-avatar">${pInfo.avatar || '🤖'}</span>
          <span class="opponent-name">${pInfo.name}</span>
        </div>
        <div class="opponent-deck-info">
          <div class="mini-card-back"></div>
          <span class="mini-deck-count">${pDeck.length}</span>
        </div>
        <div class="opponent-open-card-slot" id="open-slot-${pid}"></div>
      `;
      opponentsArea.appendChild(cardDiv);
    } else {
      // 덱 카운트만 갱신 (DOM 재생성 없이)
      const countEl = cardDiv.querySelector('.mini-deck-count');
      if (countEl) countEl.textContent = pDeck.length;
    }

    // 액티브 턴 클래스 갱신
    cardDiv.className = `opponent-card ${isHisTurn ? 'active-turn' : ''} ${isOut ? 'out' : ''}`;

    // 오픈 카드 슬롯 렌더링 (변경 시에만 flip 애니메이션 발동)
    const slot = document.getElementById(`open-slot-${pid}`);
    renderCard(pOpenCard, slot);
  });

  // 게임에서 떠난 플레이어 노드 제거
  opponentsArea.querySelectorAll('[data-opponent-pid]').forEach(el => {
    if (!renderedPids.has(el.dataset.opponentPid)) {
      opponentsArea.removeChild(el);
    }
  });

  // 5. 종 울림 사운드 및 모션
  if (gs.bellRungPid) {
    btnBell.classList.add('pressed', 'ring-anim');
    playBell();
    setTimeout(() => {
      btnBell.classList.remove('pressed', 'ring-anim');
    }, 400);

    // 방장인 경우 즉시 결과 판정 트랙 진입
    if (isHost) {
      setTimeout(() => {
        judgeBellRing(gs.bellRungPid);
      }, 300);
    }
  }

  // 6. 판정 결과 메시지 로그 및 말풍선 처리
  handleBellResultMessages();

  // 7. 게임 승패 오버레이 표시 여부 검사
  checkGameOver();
}

// ─── 카드 렌더러 ───
// 카드 ID가 변경되었을 때만 DOM을 갱신하고, 새 카드일 때만 flip 애니메이션 적용
function renderCard(card, targetEl) {
  if (!targetEl) return;

  const currentCardId = targetEl.dataset.cardId || '';
  const newCardId = card ? card.id : '';

  // 동일한 카드 → 렌더링 완전 스킵 (깜빡임 방지)
  if (currentCardId === newCardId) {
    return;
  }

  targetEl.dataset.cardId = newCardId;
  targetEl.innerHTML = '';

  if (!card) {
    targetEl.style.border = '2px dashed rgba(255,255,255,0.15)';
    targetEl.style.background = 'rgba(0,0,0,0.2)';
    return;
  }

  targetEl.style.border = 'none';
  targetEl.style.background = 'transparent';

  const cardContainer = document.createElement('div');
  // 카드가 실제로 바뀐 경우에만 flip-in 애니메이션 클래스 적용
  cardContainer.className = 'hg-card hg-card--flip-in';
  // 애니메이션 재사용을 위해 강제 reflow 후 클래스 제거
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cardContainer.classList.remove('hg-card--flip-in');
    });
  });

  const pattern = document.createElement('div');
  pattern.className = 'hg-card-pattern';
  pattern.dataset.count = card.count;

  for (let i = 0; i < card.count; i++) {
    const item = document.createElement('span');
    item.className = 'hg-card-item';
    item.textContent = card.fruit;
    pattern.appendChild(item);
  }

  cardContainer.appendChild(pattern);
  targetEl.appendChild(cardContainer);
}

// ─── 카드 뒤집기 액션 (내 턴일 때) ───────────────────────
btnFlip.addEventListener('click', async () => {
  if (!gs || gs.turn !== myPlayerId || gs.playersOut?.[myPlayerId]) return;

  btnFlip.disabled = true; // 중복 방지
  playCardPlay();

  try {
    const myDeck = [...(gs.decks?.[myPlayerId] || [])];
    if (myDeck.length === 0) return;

    const flippedCard = myDeck.shift(); // 덱 맨위 1장 제거

    // 다음 턴 플레이어 검색 (파산 안 당했고 덱이 있는 사람)
    const order = gs.playerOrder || [];
    let nextIdx = (order.indexOf(myPlayerId) + 1) % order.length;
    let nextTurnPid = order[nextIdx];

    // 살아있고 뒤집을 카드(덱)가 있는 사람 찾을 때까지 루프
    let attempts = 0;
    while ((gs.playersOut?.[nextTurnPid] || (gs.decks?.[nextTurnPid] || []).length === 0) && attempts < order.length) {
      nextIdx = (nextIdx + 1) % order.length;
      nextTurnPid = order[nextIdx];
      attempts++;
    }

    const updates = {
      [`rooms/${myRoomCode}/gameState/decks/${myPlayerId}`]: myDeck,
      // faceUpPile 배열에 새 카드를 추가 (기존 카드는 보존 - 증발 버그 수정)
      [`rooms/${myRoomCode}/gameState/faceUpPile/${myPlayerId}`]: [
        ...(gs.faceUpPile?.[myPlayerId] || []),
        flippedCard
      ],
      [`rooms/${myRoomCode}/gameState/turn`]: nextTurnPid
    };

    await update(ref(database), updates);

    // 카드 뒤집음 로그 추가
    addLocalLog(`${myName}님이 카드를 뒤집었습니다.`);

  } catch (err) {
    console.error('카드 뒤집기 실패:', err);
    btnFlip.disabled = false;
  }
});

// ─── 종 치기 경쟁 (Transaction) ─────────────────────────
btnBell.addEventListener('click', () => {
  triggerBellRing(myPlayerId);
});

async function triggerBellRing(pid) {
  if (!gs) return;
  if (gs.bellRungPid !== '' && gs.bellRungPid !== undefined) return; // 이미 누군가 침

  const bellRungRef = ref(database, `rooms/${myRoomCode}/gameState/bellRungPid`);

  try {
    const result = await runTransaction(bellRungRef, (currentVal) => {
      if (currentVal === "" || !currentVal) {
        return pid; // 내가 선점
      }
      return; // 트랜잭션 거부 (이미 상대가 선점)
    });

    if (result.committed) {
      // 종치기 전송 완료
      await update(ref(database, {
        [`rooms/${myRoomCode}/gameState/bellRungTime`]: Date.now()
      }));
    }
  } catch (err) {
    console.error('타종 트랜잭션 에러:', err);
  }
}

// ─── 방장 전용: 타종 판정 연산 ────────────────────────────
async function judgeBellRing(ringerId) {
  if (!isHost || !gs) return;

  // faceUpPile에서 각 플레이어의 최상위 카드만 추출하여 5개 판정
  const pileSnapshot = gs.faceUpPile || {};
  const topCards = {};
  Object.keys(pileSnapshot).forEach(pid => {
    const pile = pileSnapshot[pid] || [];
    topCards[pid] = pile.length > 0 ? pile[pile.length - 1] : null;
  });

  const isFive = checkFiveFruits(topCards);
  const ringerName = playersList[ringerId]?.name || '상대';

  const decks = { ...gs.decks };
  const playersOut = { ...gs.playersOut };
  // faceUpPile을 깊은 복사
  const faceUpPile = {};
  Object.keys(pileSnapshot).forEach(pid => {
    faceUpPile[pid] = [...(pileSnapshot[pid] || [])];
  });

  let status = 'none';

  if (isFive) {
    // 1. 성공! 모든 플레이어의 faceUpPile을 전부 수거하여 종 친 사람 덱 하단으로
    status = 'success';
    const collectedCards = [];

    Object.keys(faceUpPile).forEach(pid => {
      const pile = faceUpPile[pid];
      if (pile && pile.length > 0) {
        collectedCards.push(...pile); // 더미 전체 수거
        faceUpPile[pid] = [];         // 더미 클리어
      }
    });

    // 수거한 카드를 종 친 사람 덱 맨 밑에 추가
    decks[ringerId] = [...(decks[ringerId] || []), ...collectedCards];

    // 아웃당해있던 사람이 성공했으면 구활
    if (playersOut[ringerId]) {
      playersOut[ringerId] = false;
    }

    // 다음 턴은 종 친 사람으로 변경
    gs.turn = ringerId;

  } else {
    // 2. 오발! 종 친 사람이 자신의 덱 카드를 다른 살아있는 사람들에게 1장씩 분배
    // (faceUpPile은 그대로 유지 - 오발 시 바닥 카드는 건드리지 않음)
    status = 'penalty';
    const activePlayers = gs.playerOrder.filter(pid => pid !== ringerId && !playersOut[pid]);
    const ringerDeck = [...(decks[ringerId] || [])];

    activePlayers.forEach(pid => {
      if (ringerDeck.length > 0) {
        const penaltyCard = ringerDeck.pop();
        decks[pid] = [...(decks[pid] || []), penaltyCard];
        
        // 벌칙 카드를 받아 덱이 생겼으면 구활
        if (playersOut[pid]) {
          playersOut[pid] = false;
        }
      }
    });

    decks[ringerId] = ringerDeck;
  }

  // 3. 카드 수급 후, 덱도 없고 faceUpPile도 없는 플레이어는 영구 아웃(패배) 판정
  gs.playerOrder.forEach(pid => {
    const dLen = decks[pid]?.length || 0;
    const pileLen = faceUpPile[pid]?.length || 0;
    if (dLen === 0 && pileLen === 0) {
      playersOut[pid] = true;
    }
  });

  // 4. Firebase 원자적 업데이트
  const updates = {
    [`rooms/${myRoomCode}/gameState/decks`]: decks,
    [`rooms/${myRoomCode}/gameState/faceUpPile`]: faceUpPile,
    [`rooms/${myRoomCode}/gameState/playersOut`]: playersOut,
    [`rooms/${myRoomCode}/gameState/turn`]: gs.turn,
    [`rooms/${myRoomCode}/gameState/bellRungPid`]: '', // 종 초기화
    [`rooms/${myRoomCode}/gameState/bellRungTime`]: 0,
    [`rooms/${myRoomCode}/gameState/bellRungResult`]: {
      status,
      winnerId: ringerId,
      ts: Date.now()
    }
  };

  await update(ref(database), updates);
}

// ─── 종 결과 처리 텍스트 & 토스트 및 피드백 ───────────────────
let lastResultTs = 0;
function handleBellResultMessages() {
  const res = gs.bellRungResult;
  if (!res || res.ts === lastResultTs || res.status === 'none') return;
  lastResultTs = res.ts;

  const winnerName = playersList[res.winnerId]?.name || '상대';
  
  if (res.status === 'success') {
    // 성공 알림
    showToast(`🔔 성공! ${winnerName}님이 바닥 카드를 모두 획득했습니다!`);
    addLocalLog(`[타종] ${winnerName}님 종치기 성공! 카드 싹쓸이.`);
    
    // 이펙트 효과음
    if (res.winnerId === myPlayerId) {
      playWin();
    }
  } else if (res.status === 'penalty') {
    // 오발 벌칙 알림
    showToast(`⚠️ 오발! ${winnerName}님이 잘못 종을 쳐 벌칙 카드를 돌렸습니다.`);
    addLocalLog(`[오발] ${winnerName}님 오타종! 벌칙 카드 분배.`);
    
    // 벌칙 경고 말풍선 띄우기
    penaltyNotice.textContent = `❌ 오발! 벌칙 1장씩!`;
    penaltyNotice.classList.add('show');
    playError();
    setTimeout(() => {
      penaltyNotice.classList.remove('show');
    }, 2000);
  }
}

// ─── 봇 AI 실시간 핸들러 ────────────────────────────────
function handleBotAI() {
  if (!gs || gs.status !== 'playing') return;

  // 0. [방장 전용] 현재 턴 플레이어의 덱이 0장이면 자동으로 턴을 건너뜀 (소프트락 방지)
  if (isHost) {
    const curTurnPid = gs.turn;
    const curDeck = gs.decks?.[curTurnPid] || [];
    if (curDeck.length === 0 && !gs.playersOut?.[curTurnPid]) {
      const order = gs.playerOrder || [];
      let nextIdx = (order.indexOf(curTurnPid) + 1) % order.length;
      let nextTurnPid = order[nextIdx];

      let attempts = 0;
      while ((gs.playersOut?.[nextTurnPid] || (gs.decks?.[nextTurnPid] || []).length === 0) && attempts < order.length) {
        nextIdx = (nextIdx + 1) % order.length;
        nextTurnPid = order[nextIdx];
        attempts++;
      }

      if (nextTurnPid !== curTurnPid) {
        update(ref(database, `rooms/${myRoomCode}/gameState`), { turn: nextTurnPid });
        addLocalLog(`${playersList[curTurnPid]?.name || '상대'}님이 덱에 카드가 없어 턴을 패스합니다.`);
        return;
      }
    }
  }

  // 기존 실행 대기 중인 모든 타이머 폭파
  botActionTimers.forEach(t => clearTimeout(t));
  botActionTimers = [];

  // 종이 이미 눌려있으면 대기
  if (gs.bellRungPid) return;

  const faceUpPile = gs.faceUpPile || {};
  // 각 플레이어의 최상위 카드만 추출하여 5개 판정
  const topCards = {};
  Object.keys(faceUpPile).forEach(pid => {
    const pile = faceUpPile[pid] || [];
    topCards[pid] = pile.length > 0 ? pile[pile.length - 1] : null;
  });
  const isFive = checkFiveFruits(topCards);

  // 1. 과일의 합이 정확히 5개일 때 경쟁 타종
  if (isFive) {
    const order = gs.playerOrder || [];
    order.forEach(pid => {
      const pInfo = playersList[pid];
      if (pInfo?.isBot && !gs.playersOut?.[pid]) {
        // 0.8초 ~ 1.5초 사이의 난수 타이머 가동
        const speed = 800 + Math.random() * 700;
        const timer = setTimeout(() => {
          triggerBellRing(pid);
        }, speed);
        botActionTimers.push(timer);
      }
    });
  } 
  // 2. 과일의 합이 5가 아닐 때, 5%의 낮은 확률로 실수 종치기 유도
  else {
    const order = gs.playerOrder || [];
    order.forEach(pid => {
      const pInfo = playersList[pid];
      if (pInfo?.isBot && !gs.playersOut?.[pid]) {
        // 5% 확률
        if (Math.random() < 0.05) {
          // 1.2초 ~ 2.0초 후 실수
          const speed = 1200 + Math.random() * 800;
          const timer = setTimeout(() => {
            triggerBellRing(pid);
          }, speed);
          botActionTimers.push(timer);
        }
      }
    });
  }

  // 3. 봇의 턴인 경우 자동으로 카드 뒤집기 작동
  const curTurnPid = gs.turn;
  const curTurnBot = playersList[curTurnPid];
  if (curTurnBot?.isBot && !gs.playersOut?.[curTurnPid]) {
    // 봇 덱 장수 확인
    const botDeck = gs.decks?.[curTurnPid] || [];
    if (botDeck.length > 0) {
      // 1.0초 ~ 1.8초 대기 후 카드 뒤집기
      const timer = setTimeout(async () => {
        // 뒤집을 때 남들 뒤집는 것 감시하고 중복 막기 위해 방장 또는 봇 자신이 대행
        // 봇의 액션은 방장이 트랙 진행 대행 처리 가능
        if (isHost) {
          const freshDeck = [...botDeck];
          const flipped = freshDeck.shift();
          
          const order = gs.playerOrder || [];
          let nextIdx = (order.indexOf(curTurnPid) + 1) % order.length;
          let nextTurnPid = order[nextIdx];

          let attempts = 0;
          while ((gs.playersOut?.[nextTurnPid] || (gs.decks?.[nextTurnPid] || []).length === 0) && attempts < order.length) {
            nextIdx = (nextIdx + 1) % order.length;
            nextTurnPid = order[nextIdx];
            attempts++;
          }

          const updates = {
            [`rooms/${myRoomCode}/gameState/decks/${curTurnPid}`]: freshDeck,
            // faceUpPile 배열에 push (기존 카드 보존)
            [`rooms/${myRoomCode}/gameState/faceUpPile/${curTurnPid}`]: [
              ...(gs.faceUpPile?.[curTurnPid] || []),
              flipped
            ],
            [`rooms/${myRoomCode}/gameState/turn`]: nextTurnPid
          };
          
          playCardPlay();
          await update(ref(database), updates);
          addLocalLog(`${curTurnBot.name}이 카드를 뒤집었습니다.`);
        }
      }, 1000 + Math.random() * 800);
      botActionTimers.push(timer);
    } else {
      // 봇이 뒤집을 카드가 없으면 턴 패스
      if (isHost) {
        const order = gs.playerOrder || [];
        let nextIdx = (order.indexOf(curTurnPid) + 1) % order.length;
        let nextTurnPid = order[nextIdx];

        let attempts = 0;
        while ((gs.playersOut?.[nextTurnPid] || (gs.decks?.[nextTurnPid] || []).length === 0) && attempts < order.length) {
          nextIdx = (nextIdx + 1) % order.length;
          nextTurnPid = order[nextIdx];
          attempts++;
        }
        update(ref(database, `rooms/${myRoomCode}/gameState`), { turn: nextTurnPid });
      }
    }
  }
}

// ─── 게임 최종 종료 검증 ────────────────────────────────
function checkGameOver() {
  if (!gs || gs.status === 'gameover') return;

  const order = gs.playerOrder || [];
  const activePlayers = order.filter(pid => !gs.playersOut?.[pid]);

  // 생존자가 1명 이하이면 게임 오버!
  if (activePlayers.length <= 1) {
    const winnerId = activePlayers[0] || order[0];
    const winnerName = playersList[winnerId]?.name || '상대';

    gs.status = 'gameover';
    gs.roundWinner = winnerId;

    // 최종 순위표: 남은 덱 + faceUpPile 합산 장수 기준 정렬
    const ranking = order.map(pid => {
      const pDeck = gs.decks?.[pid] || [];
      const pPile = gs.faceUpPile?.[pid] || [];
      const isOut = gs.playersOut?.[pid];
      const totalCards = isOut ? 0 : pDeck.length + pPile.length;
      return {
        pid,
        name: playersList[pid]?.name || '상대',
        avatar: playersList[pid]?.avatar || '🤖',
        deckCount: totalCards,
        isOut
      };
    }).sort((a, b) => {
      if (a.isOut !== b.isOut) return a.isOut ? 1 : -1;
      return b.deckCount - a.deckCount;
    });

    // UI 출력
    winnerNameEl.textContent = `🏆 최종 승자: ${winnerName}`;
    playersRankingEl.innerHTML = ranking.map((rank, idx) => `
      <div class="rank-item ${idx === 0 ? 'rank-1' : ''}">
        <span class="rank-num">${idx + 1}등</span>
        <span class="rank-player">${rank.avatar} ${rank.name}</span>
        <span class="rank-cards">${rank.deckCount}장 보유 ${rank.isOut ? '(파산)' : ''}</span>
      </div>
    `).join('');

    // [★ 수정] 방장이든 참가자든 대기실 복귀 단추를 활성화하여 안전하게 대기실로 복귀 가능
    btnRestart.style.display = isHost ? 'block' : 'none';
    btnBackLobby.style.display = 'block';

    gameOverOverlay.style.display = 'flex';

    if (winnerId === myPlayerId) {
      playWin();
    } else {
      playLose();
    }
  }
}

// ─── 다음 라운드 리스타트 (방장용) ───────────────────────────
btnRestart.addEventListener('click', async () => {
  if (!isHost) return;
  gameOverOverlay.style.display = 'none';

  // 카드 초기화 및 다시 분배
  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (roomSnap.exists()) {
    await initHalliGalliGame(roomSnap.val());
  }
});

// ─── 대기실 복귀 (방장 및 참가자 공통 안전 복귀) ───────────────
btnBackLobby.addEventListener('click', async () => {
  try {
    // 방 상태를 waiting으로 동기화하면 모든 클라이언트가 index.html 대기실로 안전 이동
    await update(ref(database, `rooms/${myRoomCode}`), {
      status: 'waiting'
    });
    await remove(ref(database, `rooms/${myRoomCode}/gameState`));
    await remove(ref(database, `rooms/${myRoomCode}/emotes`));
  } catch (err) {
    console.error('대기실 복귀 에러:', err);
  }
  cleanup();
  window.location.href = 'index.html';
});

// ─── 게임 나가기 (다른 게임들과 동일: 방장은 대기실로, 참가자는 퇴장) ───
btnLeave.addEventListener('click', handleLeave);
btnOverlayLeave.addEventListener('click', handleLeave);

async function handleLeave() {
  if (confirm('정말로 게임에서 나가시겠습니까?')) {
    cleanup();
    
    try {
      if (isHost) {
        // 방장이 나가면 방 상태를 'waiting'으로 되돌려 모든 플레이어를 대기실로 복귀시킴
        await update(ref(database, `rooms/${myRoomCode}`), {
          status: 'waiting'
        });
        // 게임 상태 초기화 (봇 플레이어 포함)
        await remove(ref(database, `rooms/${myRoomCode}/gameState`));
        await remove(ref(database, `rooms/${myRoomCode}/emotes`));
        // 봇 플레이어는 대기실에서 제거
        const pids = Object.keys(playersList);
        for (const pid of pids) {
          if (playersList[pid]?.isBot) {
            await remove(ref(database, `rooms/${myRoomCode}/players/${pid}`));
          }
        }
      } else {
        // 일반 유저는 자신만 플레이어 목록에서 삭제
        await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
        if (gs) {
          await remove(ref(database, `rooms/${myRoomCode}/gameState/decks/${myPlayerId}`));
          await remove(ref(database, `rooms/${myRoomCode}/gameState/openCards/${myPlayerId}`));
        }
      }
    } catch (err) {
      console.error('방 퇴장 처리 에러:', err);
    }

    window.location.href = 'index.html';
  }
}

// ─── 로그 및 텍스트 ───
function addLocalLog(msg) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  if (msg.includes('종치기')) entry.classList.add('log-bell');
  else if (msg.includes('카드')) entry.classList.add('log-flip');
  else if (msg.includes('아웃')) entry.classList.add('log-out');

  entry.textContent = `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`;
  actionLog.appendChild(entry);
  actionLog.scrollTop = actionLog.scrollHeight;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

function cleanup() {
  botActionTimers.forEach(t => clearTimeout(t));
  unsubList.forEach(unsub => unsub());
}

// ─── 감정표현 ────────────────────────────────────
const EMOTES = ['😂', '👍', '😤', '🔥', '😭', '🤯', '😮', '😜', '🤔', '🤮', '😡', '🤦‍♂️', '👎'];
let isEmoteCooldown = false;
const shownEmoteTimestamps = new Set();

function initEmotePanel() {
  const listEl = document.getElementById('emote-list');
  const toggleBtn = document.getElementById('btn-emote-toggle');

  if (!listEl || !toggleBtn) return;

  // 이모지 버튼 생성
  listEl.innerHTML = EMOTES.map(e =>
    `<button class="emote-btn" data-emote="${e}" title="${e}">${e}</button>`
  ).join('');

  // 개별 이모지 클릭
  listEl.querySelectorAll('.emote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.dataset.emote;
      sendEmote(emote);
    });
  });

  // 토글 버튼
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    listEl.classList.toggle('open');
  });

  // 문서 클릭 시 이모지 패널 닫기
  document.addEventListener('click', () => {
    listEl.classList.remove('open');
  });
  listEl.addEventListener('click', (e) => e.stopPropagation());
  toggleBtn.addEventListener('click', (e) => e.stopPropagation());
}

async function sendEmote(emote) {
  if (isEmoteCooldown) return;
  isEmoteCooldown = true;

  const toggleBtn = document.getElementById('btn-emote-toggle');
  const listEl = document.getElementById('emote-list');

  if (toggleBtn) toggleBtn.classList.add('cooldown');
  if (listEl) {
    listEl.querySelectorAll('.emote-btn').forEach(btn => {
      btn.classList.add('cooldown');
      btn.disabled = true;
    });
  }

  try {
    await update(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`), {
      emote,
      senderName: myName,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('감정표현 전송 실패:', e);
  }

  showEmotePopup(myPlayerId, emote, Date.now());

  setTimeout(() => {
    isEmoteCooldown = false;
    if (toggleBtn) toggleBtn.classList.remove('cooldown');
    if (listEl) {
      listEl.querySelectorAll('.emote-btn').forEach(btn => {
        btn.classList.remove('cooldown');
        btn.disabled = false;
      });
    }
  }, 1000);
}

function showEmotePopup(playerId, emote, timestamp) {
  const key = `${playerId}_${timestamp}`;
  if (shownEmoteTimestamps.has(key)) return;
  shownEmoteTimestamps.add(key);

  if (shownEmoteTimestamps.size > 50) {
    const first = shownEmoteTimestamps.values().next().value;
    shownEmoteTimestamps.delete(first);
  }

  const playerEl = document.querySelector(`[data-pid="${playerId}"]`);
  if (!playerEl) return;

  const rect = playerEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  popup.textContent = emote;
  
  // 플레이어 패널 하단 중앙에서 아래로 떨어지게 세팅
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.bottom + 10}px`;
  popup.style.transform = 'translateX(-50%)';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 2900);
}



})();