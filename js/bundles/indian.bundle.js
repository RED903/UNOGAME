// ─── INDIAN BUNDLE (Non-module Standalone) ───
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


// ─── Dependency: indian-rules.js ───

/**
 * 인디언 포커 (Indian Poker) 룰 및 베팅 AI
 * 한국어 주석 필수
 */

const INITIAL_CHIPS = 30; // 1인당 기본 시작 칩
const ANTE_CHIPS = 1;     // 라운드 기본 베팅(안티)

// 4개 카드 수트 정의
const SUITS = [
  { name: 'spade', symbol: '♠', color: 'black', priority: 4 },
  { name: 'diamond', symbol: '♦', color: 'red', priority: 3 },
  { name: 'heart', symbol: '♥', color: 'red', priority: 2 },
  { name: 'club', symbol: '♣', color: 'black', priority: 1 }
];

/**
 * 4가지 무늬(♠, ♦, ♥, ♣) × 1~10 숫자 카드 덱 생성 (총 40장, 완전 고유 카드)
 */
function createIndianDeck() {
  const deck = [];

  SUITS.forEach(suit => {
    for (let num = 1; num <= 10; num++) {
      deck.push({
        id: `c_${suit.name}_${num}`,
        value: num,
        suit: suit.name,
        symbol: suit.symbol,
        color: suit.color,
        priority: suit.priority
      });
    }
  });

  // Fisher-Yates 정밀 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/**
 * 봇 AI 베팅 결정 알고리즘
 * 봇은 "자신의 카드는 모르고, 상대방의 카드와 현재 베팅 금액"만을 보고 결정합니다.
 * @param {Object} oppCard - 상대방의 카드 { value: 7, suit: 'heart' }
 * @param {number} currentCallAmount - 콜하기 위해 필요한 추가 칩
 * @param {number} botChips - 봇의 남은 칩
 * @param {number} potSize - 현재 팟에 쌓인 칩 총합
 * @returns {Object} { action: 'check' | 'call' | 'raise' | 'fold', raiseAmount: number }
 */
function botDecideIndianBet(oppCard, currentCallAmount, botChips, potSize) {
  const oppVal = oppCard ? oppCard.value : 5;

  // 1. 상대방 카드가 1~3 (매우 낮은 수): 내가 이길 확률이 높음 -> 공격적 레이즈 또는 콜!
  if (oppVal <= 3) {
    if (Math.random() < 0.75 && botChips >= currentCallAmount + 2) {
      return { action: 'raise', raiseAmount: Math.min(botChips, currentCallAmount + 2) };
    }
    if (currentCallAmount === 0) return { action: 'check' };
    return { action: 'call' };
  }

  // 2. 상대방 카드가 4~6 (중간 수): 신중한 탐색전
  if (oppVal <= 6) {
    if (currentCallAmount === 0) {
      // 30% 확률로 기습 레이즈
      if (Math.random() < 0.3 && botChips >= 2) {
        return { action: 'raise', raiseAmount: 2 };
      }
      return { action: 'check' };
    }
    // 상대가 많이 걸지 않았으면(3 이하) 콜
    if (currentCallAmount <= 3 || Math.random() < 0.6) {
      return { action: 'call' };
    }
    return { action: 'fold' };
  }

  // 3. 상대방 카드가 7~8 (다소 높은 수): 방어적 태세 (단, 가끔 블러핑)
  if (oppVal <= 8) {
    if (currentCallAmount === 0) return { action: 'check' };
    if (currentCallAmount <= 2 && Math.random() < 0.4) {
      return { action: 'call' };
    }
    return { action: 'fold' };
  }

  // 4. 상대방 카드가 9~10 (초강력 패): 내가 질 확률이 매우 높음
  if (currentCallAmount === 0) return { action: 'check' };
  if (Math.random() < 0.15 && currentCallAmount <= 2) {
    return { action: 'call' };
  }
  return { action: 'fold' };
}


// ─── Main: indian.js ───

/**
 * 인디언 포커 (Indian Poker) 실시간 멀티플레이 로직
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
let myAvatar = '🤠';
let playersList = {};
let playerOrder = [];
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// DOM 요소
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const btnLeave = document.getElementById('btn-leave');

let isCodeHidden = false;
function updateRoomCodeText() {
  if (!displayRoomCode) return;
  displayRoomCode.textContent = isCodeHidden ? 'ROOM: •••••• 👁️' : `ROOM: ${myRoomCode} 🔒`;
}

const opponentsRow = document.getElementById('opponents-row');
const potAmount = document.getElementById('pot-amount');
const currentBetInfo = document.getElementById('current-bet-info');
const actionLogTicker = document.getElementById('action-log-ticker');

const myForeheadCard = document.getElementById('my-forehead-card');
const myCardValue = document.getElementById('my-card-value');
const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myChipsEl = document.getElementById('my-chips');

const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const btnRaise = document.getElementById('btn-raise');

const roundResultModal = document.getElementById('round-result-modal');
const modalResultIcon = document.getElementById('modal-result-icon');
const modalResultTitle = document.getElementById('modal-result-title');
const modalResultDesc = document.getElementById('modal-result-desc');
const btnNextRound = document.getElementById('btn-next-round');

const finalGameModal = document.getElementById('final-game-modal');
const finalWinnerTitle = document.getElementById('final-winner-title');
const finalDesc = document.getElementById('final-desc');
const btnFinalLobby = document.getElementById('btn-final-lobby');
const btnFinalRestart = document.getElementById('btn-final-restart');

// ─── 초기화 ─────────────────────────────────────────
async function initIndianGameEntry() {
  updateRoomCodeText();
  displayRoomCode.addEventListener('click', () => {
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
      myAvatar = playersList[myPlayerId].avatar || '🤠';
    }

    myAvatarEl.textContent = myAvatar;
    myNameEl.textContent = myName;

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initIndianGame();
    }

    listenToIndianRoom();

  } catch (err) {
    console.error('인디언 포커 초기화 오류:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIndianGameEntry);
} else {
  initIndianGameEntry();
}

async function initIndianGame() {
  const chips = {};
  playerOrder.forEach(pid => {
    chips[pid] = INITIAL_CHIPS;
  });

  await startNewIndianRound(chips, 1);
}

async function startNewIndianRound(chips, roundNum) {
  const deck = createIndianDeck();
  const cards = {};
  const playerBets = {};
  const folded = [];
  let pot = 0;

  const activePlayers = playerOrder.filter(pid => (chips[pid] || 0) > 0);

  activePlayers.forEach(pid => {
    cards[pid] = deck.pop();
    chips[pid] -= ANTE_CHIPS;
    playerBets[pid] = ANTE_CHIPS;
    pot += ANTE_CHIPS;
  });

  const newGs = {
    round: roundNum,
    chips,
    cards,
    pot,
    currentBet: ANTE_CHIPS,
    playerBets,
    folded,
    turnIndex: 0,
    actionCount: 0,
    phase: 'betting',
    log: `라운드 ${roundNum} 시작! 기본 안티 1칩을 베팅했습니다.`,
    winnerPids: null,
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

function listenToIndianRoom() {
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
    renderIndianTable(gs);

    checkIndianBotAction(gs);
  });
}

function renderIndianTable(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId && gs.phase === 'betting');
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🤠' };

  turnAvatar.textContent = currentPlayer.avatar || '🤠';
  if (isMyTurn) {
    turnText.textContent = '당신의 베팅 차례입니다!';
    turnText.style.color = 'var(--gold)';
  } else {
    turnText.textContent = `${currentPlayer.name} 님의 베팅 차례...`;
    turnText.style.color = '#F0F0FF';
  }

  potAmount.innerHTML = `<span class="chip-coin-icon"></span> ${gs.pot}`;
  const myBet = gs.playerBets[myPlayerId] || 0;
  const toCall = Math.max(0, gs.currentBet - myBet);
  currentBetInfo.textContent = `현재 최고 베팅: ${gs.currentBet} 칩 | 내가 맞출 칩: ${toCall} 칩`;
  actionLogTicker.textContent = gs.log || '';

  renderOpponentsSeat(gs, currentPid);
  renderMySeat(gs);
  updateBettingButtons(gs, isMyTurn, toCall);

  if (gs.phase === 'showdown') {
    renderShowdownModal(gs);
  } else {
    roundResultModal.classList.remove('show');
  }

  if (gs.phase === 'finished') {
    renderFinalGameModal(gs);
  }
}

function renderOpponentsSeat(gs, currentPid) {
  opponentsRow.innerHTML = '';

  playerOrder.forEach(pid => {
    if (pid === myPlayerId) return;
    const p = playersList[pid] || { name: '상대방', avatar: '👤' };
    const pCard = gs.cards?.[pid];
    const pChips = gs.chips?.[pid] || 0;
    const isFolded = gs.folded?.includes(pid);
    const isTheirTurn = (pid === currentPid && gs.phase === 'betting');

    const seat = document.createElement('div');
    seat.className = `player-seat ${isTheirTurn ? 'current-turn' : ''} ${isFolded ? 'folded' : ''}`;

    const cardEl = document.createElement('div');
    if (pCard) {
      const suitColor = pCard.color || 'black';
      cardEl.className = `forehead-card open suit-${suitColor}`;
      cardEl.innerHTML = `
        <div class="card-corner-top">${pCard.symbol}</div>
        <span class="card-num">${pCard.value}</span>
        <span class="card-suit">${pCard.symbol}</span>
        <div class="card-corner-bottom">${pCard.symbol}</div>
      `;
    } else {
      cardEl.className = 'forehead-card open';
      cardEl.innerHTML = `<span class="card-num">-</span>`;
    }

    const info = document.createElement('div');
    info.className = 'player-seat-info';
    info.innerHTML = `
      <span>${p.avatar || '👤'}</span>
      <span>${escapeHtml(p.name)}</span>
      <span class="chips-badge"><span class="chip-coin-icon"></span> ${pChips}</span>
      ${isFolded ? '<span style="color:#FF4757; font-size:0.75rem;">(다이)</span>' : ''}
    `;

    seat.appendChild(cardEl);
    seat.appendChild(info);
    opponentsRow.appendChild(seat);
  });
}

function renderMySeat(gs) {
  const myCard = gs.cards?.[myPlayerId];
  const myChips = gs.chips?.[myPlayerId] || 0;
  myChipsEl.innerHTML = `<span class="chip-coin-icon"></span> ${myChips}`;

  if (gs.phase === 'showdown' && myCard) {
    const myColor = myCard.color || 'black';
    myForeheadCard.className = `forehead-card open suit-${myColor}`;
    myForeheadCard.innerHTML = `
      <div class="card-corner-top">${myCard.symbol}</div>
      <span class="card-num">${myCard.value}</span>
      <span class="card-suit">${myCard.symbol}</span>
      <div class="card-corner-bottom">${myCard.symbol}</div>
    `;
  } else {
    myForeheadCard.className = 'forehead-card secret';
    myForeheadCard.innerHTML = `<span class="card-question">?</span>`;
  }
}

function updateBettingButtons(gs, isMyTurn, toCall) {
  const myChips = gs.chips[myPlayerId] || 0;
  const isFolded = gs.folded?.includes(myPlayerId);

  if (!isMyTurn || isFolded) {
    btnFold.disabled = true;
    btnCheck.disabled = true;
    btnCall.disabled = true;
    btnRaise.disabled = true;
    return;
  }

  btnFold.disabled = false;
  btnCheck.disabled = (toCall > 0);
  btnCall.disabled = (toCall === 0 || myChips < toCall);
  btnCall.textContent = `콜 (${toCall} 칩)`;

  const raiseCost = toCall + 2;
  btnRaise.disabled = (myChips < raiseCost);
  btnRaise.textContent = `레이즈 (+2 칩)`;
}

async function handleBetAction(action) {
  if (!currentGs || currentGs.phase !== 'betting') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playChips();
  await executeIndianBet(myPlayerId, action, 2);
}

async function executeIndianBet(pid, action, raiseAmt = 2) {
  const gs = currentGs;
  const pName = playersList[pid]?.name || '플레이어';
  const myChips = gs.chips[pid] || 0;
  const currentBet = gs.currentBet;
  const myCurrentBet = gs.playerBets[pid] || 0;
  const toCall = Math.max(0, currentBet - myCurrentBet);

  const newChips = { ...gs.chips };
  const newPlayerBets = { ...gs.playerBets };
  const newFolded = [...(gs.folded || [])];
  let newPot = gs.pot;
  let nextBet = currentBet;
  let logText = '';

  if (action === 'fold') {
    newFolded.push(pid);
    logText = `[${pName}] 님이 다이(Fold)했습니다.`;

    const card = gs.cards[pid];
    if (card && card.value === 10) {
      const penalty = Math.min(newChips[pid], 5);
      newChips[pid] -= penalty;
      newPot += penalty;
      logText += ` (⚠️ 10을 들고 다이하여 패널티 ${penalty}칩 지불!)`;
    }

  } else if (action === 'check') {
    logText = `[${pName}] 님이 체크했습니다.`;

  } else if (action === 'call') {
    const pay = Math.min(myChips, toCall);
    newChips[pid] -= pay;
    newPlayerBets[pid] += pay;
    newPot += pay;
    logText = `[${pName}] 님이 ${pay}칩을 콜했습니다.`;

  } else if (action === 'raise') {
    const totalCost = toCall + raiseAmt;
    const pay = Math.min(myChips, totalCost);
    newChips[pid] -= pay;
    newPlayerBets[pid] += pay;
    newPot += pay;
    nextBet = newPlayerBets[pid];
    logText = `[${pName}] 님이 ${raiseAmt}칩을 레이즈했습니다! (총 ${nextBet}칩)`;
  }

  const activeAlivePids = playerOrder.filter(id => (newChips[id] > 0 || (gs.cards[id] && !newFolded.includes(id))) && !newFolded.includes(id));

  if (activeAlivePids.length === 1) {
    const soleWinner = activeAlivePids[0];
    newChips[soleWinner] += newPot;

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      chips: newChips,
      playerBets: newPlayerBets,
      folded: newFolded,
      pot: 0,
      phase: 'showdown',
      winnerPids: [soleWinner],
      log: `${logText} | [${playersList[soleWinner]?.name}] 님이 단독 승리로 ${newPot}칩 획득!`,
      lastActionTime: Date.now()
    });
    return;
  }

  const allBetsEqual = activeAlivePids.every(id => newPlayerBets[id] === nextBet);
  const nextActionCount = gs.actionCount + 1;

  if (allBetsEqual && nextActionCount >= activeAlivePids.length) {
    await judgeShowdown(newChips, newPot, newFolded, newPlayerBets, logText);
    return;
  }

  let nextIndex = gs.turnIndex + 1;
  while (newFolded.includes(playerOrder[nextIndex % playerOrder.length]) || (newChips[playerOrder[nextIndex % playerOrder.length]] <= 0 && !gs.cards[playerOrder[nextIndex % playerOrder.length]])) {
    nextIndex++;
  }

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    chips: newChips,
    playerBets: newPlayerBets,
    folded: newFolded,
    pot: newPot,
    currentBet: nextBet,
    turnIndex: nextIndex,
    actionCount: nextActionCount,
    log: logText,
    lastActionTime: Date.now()
  });

  if (playerOrder[nextIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

async function judgeShowdown(chips, pot, folded, playerBets, logText) {
  const cards = currentGs.cards;
  const alivePids = playerOrder.filter(id => !folded.includes(id));

  let maxVal = -1;
  let winners = [];

  alivePids.forEach(pid => {
    const card = cards[pid];
    if (card) {
      if (card.value > maxVal) {
        maxVal = card.value;
        winners = [pid];
      } else if (card.value === maxVal) {
        winners.push(pid);
      }
    }
  });

  const share = Math.floor(pot / winners.length);
  winners.forEach(w => {
    chips[w] += share;
  });

  const winnerNames = winners.map(w => playersList[w]?.name || '플레이어').join(', ');

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    chips,
    pot: 0,
    folded,
    phase: 'showdown',
    winnerPids: winners,
    log: `${logText} | [${winnerNames}] 님이 승리하여 ${pot}칩 획득! (카드: ${maxVal})`,
    lastActionTime: Date.now()
  });
}

function checkIndianBotAction(gs) {
  if (!isHost) return;

  if (gs.phase === 'betting') {
    const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
    const player = playersList[currentPid];
    if (player && player.isBot) {
      if (botActionTimer) clearTimeout(botActionTimer);
      botActionTimer = setTimeout(async () => {
        const opponentPid = playerOrder.find(id => id !== currentPid && !gs.folded.includes(id));
        const oppCard = opponentPid ? gs.cards[opponentPid] : null;

        const myBet = gs.playerBets[currentPid] || 0;
        const toCall = Math.max(0, gs.currentBet - myBet);
        const botChips = gs.chips[currentPid] || 0;

        const decision = botDecideIndianBet(oppCard, toCall, botChips, gs.pot);
        await executeIndianBet(currentPid, decision.action, decision.raiseAmount || 2);
      }, 1500);
    }
  }

  if (gs.phase === 'showdown') {
    if (botActionTimer) clearTimeout(botActionTimer);
    botActionTimer = setTimeout(async () => {
      await handleNextRoundTrigger(gs);
    }, 4000);
  }
}

function renderShowdownModal(gs) {
  const winners = gs.winnerPids || [];
  const isMeWinner = winners.includes(myPlayerId);

  if (isMeWinner) {
    playWin();
    modalResultIcon.textContent = '🎉';
    modalResultTitle.textContent = '라운드 승리!';
    modalResultTitle.style.color = 'var(--gold)';
  } else {
    playLose();
    modalResultIcon.textContent = '💀';
    modalResultTitle.textContent = '라운드 패배...';
    modalResultTitle.style.color = '#FF4757';
  }

  const summary = playerOrder.map(pid => {
    const p = playersList[pid] || { name: '플레이어' };
    const card = gs.cards?.[pid];
    const isFold = gs.folded?.includes(pid);
    const cardDisplay = card ? `<span style="color:${card.color === 'red' ? '#FF4757' : '#F0F0FF'}">[${card.symbol} ${card.value}]</span>` : '[?]';
    return `<strong>${escapeHtml(p.name)}</strong>: ${isFold ? '<span style="color:#FF6B81;">(다이)</span>' : cardDisplay}`;
  }).join('<br/>');

  modalResultDesc.innerHTML = `${gs.log}<br/><br/>${summary}`;
  btnNextRound.disabled = !isHost;
  btnNextRound.textContent = isHost ? '다음 라운드 시작' : '다음 라운드 대기 중...';
  roundResultModal.classList.add('show');
}

async function handleNextRoundTrigger(gs) {
  roundResultModal.classList.remove('show');

  const solventPlayers = playerOrder.filter(pid => (gs.chips[pid] || 0) > 0);

  if (solventPlayers.length <= 1) {
    const finalWinnerId = solventPlayers[0] || playerOrder[0];
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'finished',
      finalWinnerId
    });
    return;
  }

  await startNewIndianRound(gs.chips, gs.round + 1);
}

function renderFinalGameModal(gs) {
  const winner = playersList[gs.finalWinnerId] || { name: '최종 우승자' };
  const isMe = (gs.finalWinnerId === myPlayerId);

  if (isMe) playWin();
  else playLose();

  finalWinnerTitle.textContent = isMe ? '최종 우승을 차지했습니다! 👑' : `${winner.name} 님의 최종 승리!`;
  finalDesc.textContent = `모든 칩을 획득하고 인디언 포커의 최후의 승자가 되었습니다!`;

  btnFinalRestart.style.display = isHost ? 'block' : 'none';
  finalGameModal.classList.add('show');
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

      if (room.gameState) {
        const folded = [...(room.gameState.folded || [])];
        if (!folded.includes(myPlayerId)) folded.push(myPlayerId);
        updates[`rooms/${myRoomCode}/gameState/folded`] = folded;

        const active = Object.keys(players).filter(id => id !== myPlayerId && !folded.includes(id));
        if (active.length <= 1) {
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'finished';
          updates[`rooms/${myRoomCode}/gameState/finalWinnerId`] = active[0] || humanPlayerIds[0];
        } else if (playerOrder[room.gameState.turnIndex % playerOrder.length] === myPlayerId) {
          updates[`rooms/${myRoomCode}/gameState/turnIndex`] = room.gameState.turnIndex + 1;
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
    console.error('인디언 포커 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnFold.addEventListener('click', () => handleBetAction('fold'));
  btnCheck.addEventListener('click', () => handleBetAction('check'));
  btnCall.addEventListener('click', () => handleBetAction('call'));
  btnRaise.addEventListener('click', () => handleBetAction('raise'));

  btnNextRound.addEventListener('click', () => {
    if (isHost && currentGs) handleNextRoundTrigger(currentGs);
  });

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
  btnFinalLobby.addEventListener('click', async () => {
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

  btnFinalRestart.addEventListener('click', async () => {
    if (!isHost) return;
    finalGameModal.classList.remove('show');
    await initIndianGame();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


})();