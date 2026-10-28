// ─── GAME BUNDLE (Non-module Standalone) ───
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


// ─── Dependency: uno-rules.js ───

// ═══════════════════════════════════════════════════
// UNO 규칙 엔진
// 카드 생성, 덱 섞기, 유효성 검사, 게임 로직 담당
// ═══════════════════════════════════════════════════

// 카드 색상
const COLORS = ['red', 'blue', 'green', 'yellow'];

// 카드 타입
const CARD_TYPES = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  DRAW_TWO: 'draw_two',
  WILD: 'wild',
  WILD_DRAW_FOUR: 'wild_draw_four'
};

// 카드 값에 따른 점수
const CARD_POINTS = {
  'skip': 20,
  'reverse': 20,
  'draw_two': 20,
  'wild': 50,
  'wild_draw_four': 50
};

/**
 * 고유 ID를 가진 UNO 카드 객체 생성
 */
function createCard(color, type, value = null) {
  return {
    id: `${color}_${type}_${value !== null ? value : ''}_${Math.random().toString(36).substr(2, 9)}`,
    color,   // 'red' | 'blue' | 'green' | 'yellow' | 'wild'
    type,    // CARD_TYPES 중 하나
    value    // 숫자 카드의 경우 0-9
  };
}

/**
 * UNO 표준 108장 덱 생성
 */
function createDeck() {
  const deck = [];

  // 각 색상별 카드 생성
  for (const color of COLORS) {
    // 0은 각 색상당 1장
    deck.push(createCard(color, CARD_TYPES.NUMBER, 0));

    // 1-9는 각 색상당 2장
    for (let i = 1; i <= 9; i++) {
      deck.push(createCard(color, CARD_TYPES.NUMBER, i));
      deck.push(createCard(color, CARD_TYPES.NUMBER, i));
    }

    // 액션 카드 각 2장
    deck.push(createCard(color, CARD_TYPES.SKIP));
    deck.push(createCard(color, CARD_TYPES.SKIP));
    deck.push(createCard(color, CARD_TYPES.REVERSE));
    deck.push(createCard(color, CARD_TYPES.REVERSE));
    deck.push(createCard(color, CARD_TYPES.DRAW_TWO));
    deck.push(createCard(color, CARD_TYPES.DRAW_TWO));
  }

  // 와일드 카드 각 4장
  for (let i = 0; i < 4; i++) {
    deck.push(createCard('wild', CARD_TYPES.WILD));
    deck.push(createCard('wild', CARD_TYPES.WILD_DRAW_FOUR));
  }

  return deck;
}

/**
 * Fisher-Yates 알고리즘으로 덱 섞기
 */
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * 카드를 낼 수 있는지 검사
 * @param {Object} card - 내려는 카드
 * @param {Object} topCard - 현재 더미 위 카드
 * @param {string} currentColor - 와일드 카드 후 선택된 색상
 * @param {number} drawCount - 현재 드로우 누적 스택 카운트
 */
function isValidPlay(card, topCard, currentColor, drawCount = 0) {
  // 1. 드로우 패널티 스택이 활성화되어 있을 때 (drawCount > 0)
  if (drawCount > 0) {
    // A) Wild Draw Four (+4)는 언제나 낼 수 있음
    if (card.type === CARD_TYPES.WILD_DRAW_FOUR) {
      return true;
    }

    // B) Draw Two (+2)는 탑 카드가 WILD_DRAW_FOUR가 아닐 때 낼 수 있음
    if (card.type === CARD_TYPES.DRAW_TWO) {
      if (topCard.type !== CARD_TYPES.WILD_DRAW_FOUR) {
        return true;
      }
    }

    // C) Reverse (방향바꾸기)는 낼 수 있는 색상이 맞거나 탑 카드가 Reverse인 경우 스택 유지를 위해 허용
    if (card.type === CARD_TYPES.REVERSE) {
      const matchColor = currentColor || topCard.color;
      if (card.color === matchColor || topCard.type === CARD_TYPES.REVERSE) {
        return true;
      }
    }

    // D) Skip (스킵)은 낼 수 있는 색상이 맞거나 탑 카드가 Skip인 경우 스택 유지를 위해 허용
    if (card.type === CARD_TYPES.SKIP) {
      const matchColor = currentColor || topCard.color;
      if (card.color === matchColor || topCard.type === CARD_TYPES.SKIP) {
        return true;
      }
    }

    // 그 외 일반 카드(숫자 카드, 일반 와일드 카드 등)는 낼 수 없음!
    return false;
  }

  // 2. 일반 상황 (드로우 스택이 없을 때) 기존 룰 적용
  // 와일드 카드는 항상 낼 수 있음
  if (card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR) {
    return true;
  }

  // 현재 색상과 일치
  const matchColor = currentColor || topCard.color;
  if (card.color === matchColor) return true;

  // 같은 타입의 액션 카드
  if (card.type !== CARD_TYPES.NUMBER && card.type === topCard.type) return true;

  // 숫자가 같은 경우
  if (card.type === CARD_TYPES.NUMBER &&
      topCard.type === CARD_TYPES.NUMBER &&
      card.value === topCard.value) return true;

  return false;
}

/**
 * 카드 낸 후 게임 상태 업데이트
 * @returns {Object} - 업데이트된 게임 상태 변화
 */
function processCardPlay(card, gameState, playerId, playerIds) {
  const changes = {
    skipNext: false,
    drawCount: 0,
    reverseDirection: false,
    needColorPick: false,
    nextPlayer: null
  };

  const currentIndex = playerIds.indexOf(playerId);
  const direction = gameState.direction || 1;

  switch (card.type) {
    case CARD_TYPES.SKIP:
      // 다음 플레이어를 건너뜀
      changes.skipNext = true;
      changes.drawCount = gameState.drawCount || 0; // 드로우 스택 유지
      const skipIndex = (currentIndex + direction * 2 + playerIds.length) % playerIds.length;
      changes.nextPlayer = playerIds[skipIndex];
      break;

    case CARD_TYPES.REVERSE:
      // 방향 반전
      changes.reverseDirection = true;
      changes.drawCount = gameState.drawCount || 0; // 드로우 스택 유지
      const newDir = -direction;
      
      if (playerIds.length === 2) {
        // [★ 핵심 룰] 1대1(2명) 게임 시에는 방향 바꾸기를 내면 다시 본인 순서가 됩니다 (Skip 효과와 동일)
        changes.nextPlayer = playerId;
      } else {
        // 3명 이상일 때는 정상적으로 방향 전환 후 다음 플레이어 계산
        const revIndex = (currentIndex + newDir + playerIds.length) % playerIds.length;
        changes.nextPlayer = playerIds[revIndex];
      }
      break;

    case CARD_TYPES.DRAW_TWO:
      // 다음 플레이어 +2
      changes.drawCount = (gameState.drawCount || 0) + 2;
      const d2Index = (currentIndex + direction + playerIds.length) % playerIds.length;
      changes.nextPlayer = playerIds[d2Index];
      break;

    case CARD_TYPES.WILD:
      // 색상 선택 필요
      changes.needColorPick = true;
      const wildIndex = (currentIndex + direction + playerIds.length) % playerIds.length;
      changes.nextPlayer = playerIds[wildIndex];
      break;

    case CARD_TYPES.WILD_DRAW_FOUR:
      // 색상 선택 + 다음 플레이어 +4
      changes.needColorPick = true;
      changes.drawCount = (gameState.drawCount || 0) + 4;
      const wdf4Index = (currentIndex + direction + playerIds.length) % playerIds.length;
      changes.nextPlayer = playerIds[wdf4Index];
      break;

    default:
      // 일반 숫자 카드
      const nextIndex = (currentIndex + direction + playerIds.length) % playerIds.length;
      changes.nextPlayer = playerIds[nextIndex];
      break;
  }

  return changes;
}

/**
 * 게임 초기화 - 카드 배분
 * @param {string[]} playerIds - 플레이어 ID 배열
 * @param {number} cardsPerPlayer - 인당 카드 수 (기본 7)
 */
function initializeGame(playerIds, cardsPerPlayer = 7) {
  const deck = shuffleDeck(createDeck());
  const hands = {};

  // 각 플레이어에게 카드 배분
  playerIds.forEach(id => {
    hands[id] = deck.splice(0, cardsPerPlayer);
  });

  // 첫 버린 카드 설정 (와일드로 시작하면 다시 뽑음)
  let firstCard;
  do {
    firstCard = deck.splice(0, 1)[0];
  } while (firstCard.type === CARD_TYPES.WILD_DRAW_FOUR);

  // 첫 카드가 Wild면 색상 랜덤 선택
  let initialColor = firstCard.color;
  if (firstCard.type === CARD_TYPES.WILD) {
    initialColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  return {
    deck,
    hands,
    discardPile: [firstCard],
    currentColor: initialColor,
    currentPlayer: playerIds[0],
    direction: 1,
    drawCount: 0,
    unoCalledBy: null,
    started: true,
    finished: false,
    winner: null
  };
}

/**
 * 점수 계산 - 다른 플레이어의 손패 합산
 */
function calculateScore(hands, winnerId) {
  let total = 0;
  for (const [playerId, hand] of Object.entries(hands)) {
    if (playerId === winnerId) continue;
    for (const card of hand) {
      if (card.type === CARD_TYPES.NUMBER) {
        total += card.value;
      } else {
        total += CARD_POINTS[card.type] || 0;
      }
    }
  }
  return total;
}


// ─── Dependency: card-renderer.js ───

// ═══════════════════════════════════════════════════
// SVG 카드 렌더러
// 모든 UNO 카드를 SVG로 동적 생성 (개선된 디자인)
// ═══════════════════════════════════════════════════

// 색상 팔레트 (공식 UNO 색상 참조)
const COLOR_PALETTE = {
  red:    { main: '#E8003D', dark: '#A00028', light: '#FF4070', gradient: ['#FF1744', '#B71C1C'] },
  blue:   { main: '#0065BD', dark: '#004A8F', light: '#4090E0', gradient: ['#1E88E5', '#0D47A1'] },
  green:  { main: '#1B9E3E', dark: '#0F6B28', light: '#4CC870', gradient: ['#43A047', '#1B5E20'] },
  yellow: { main: '#FFD900', dark: '#E0B800', light: '#FFE94D', gradient: ['#FDD835', '#F57F17'] },
  wild:   { main: '#111111', dark: '#000000', light: '#333333', gradient: ['#212121', '#000000'] }
};

// 액션 아이콘 SVG 경로
const ACTION_ICONS = {
  skip: `<g transform="translate(35,35)">
    <circle cx="0" cy="0" r="22" fill="none" stroke="white" stroke-width="4.5" opacity="0.95"/>
    <line x1="-14" y1="-14" x2="14" y2="14" stroke="white" stroke-width="4.5" stroke-linecap="round" opacity="0.95"/>
  </g>`,

  reverse: `<g transform="translate(35,35)">
    <path d="M-18,-8 A20,20 0 0,1 18,-8" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M18,8 A20,20 0 0,1 -18,8" fill="none" stroke="white" stroke-width="4.5" stroke-linecap="round"/>
    <polygon points="-18,-8 -10,-18 -10,2" fill="white"/>
    <polygon points="18,8 10,18 10,-2" fill="white"/>
  </g>`,

  draw_two: `<g transform="translate(35,35)">
    <rect x="-16" y="-22" width="24" height="32" rx="4" fill="white" opacity="0.3" transform="rotate(-12)"/>
    <rect x="-6" y="-16" width="24" height="32" rx="4" fill="white" opacity="0.95"/>
    <text x="6" y="14" font-size="18" font-weight="900" fill="#222" text-anchor="middle" font-family="Arial Black">+2</text>
  </g>`,

  wild: `<g transform="translate(35,35)">
    <ellipse cx="0" cy="0" rx="22" ry="22" fill="#E8003D" transform="rotate(-45)"/>
    <ellipse cx="0" cy="0" rx="22" ry="22" fill="#1B9E3E" transform="rotate(45)"/>
    <ellipse cx="0" cy="0" rx="14" ry="14" fill="#FFD900"/>
    <ellipse cx="0" cy="0" rx="14" ry="14" fill="#0065BD" transform="rotate(90)"/>
    <circle cx="0" cy="0" r="6" fill="rgba(0,0,0,0.3)"/>
  </g>`,

  wild_draw_four: `<g transform="translate(35,35)">
    <ellipse cx="0" cy="0" rx="22" ry="22" fill="#E8003D" transform="rotate(-45)"/>
    <ellipse cx="0" cy="0" rx="22" ry="22" fill="#1B9E3E" transform="rotate(45)"/>
    <ellipse cx="0" cy="0" rx="14" ry="14" fill="#FFD900"/>
    <ellipse cx="0" cy="0" rx="14" ry="14" fill="#0065BD" transform="rotate(90)"/>
    <text x="0" y="7" font-size="14" font-weight="900" fill="white" text-anchor="middle" font-family="Arial Black"
      stroke="rgba(0,0,0,0.5)" stroke-width="1">+4</text>
  </g>`
};

/**
 * UNO 카드 SVG 문자열 생성
 * @param {Object} card - 카드 객체
 * @param {Object} options - { width, height, selected, playable }
 */
function renderCardSVG(card, options = {}) {
  const {
    width = 90,
    height = 130,
    selected = false,
    playable = true,
    isBack = false
  } = options;

  if (isBack) {
    return renderCardBack(width, height);
  }

  const palette = COLOR_PALETTE[card.color] || COLOR_PALETTE.wild;
  const w = width;
  const h = height;

  // 카드 내용 생성
  let centerContent = '';
  let cornerText = '';
  let cornerTextBot = '';

  if (card.type === 'number') {
    cornerText = String(card.value);
    cornerTextBot = String(card.value);
    const fontSize = Math.round(h * 0.32);
    centerContent = `
      <text x="${w/2}" y="${h/2 + fontSize*0.37}"
        font-size="${fontSize}" font-weight="900"
        fill="white" text-anchor="middle"
        font-family="'Arial Black', Arial, sans-serif"
        filter="url(#textShadow_${card.id})">${card.value}</text>`;
  } else if (card.type === 'skip' || card.type === 'reverse' || card.type === 'draw_two') {
    cornerText = card.type === 'skip' ? '⊘' : card.type === 'reverse' ? '↺' : '+2';
    cornerTextBot = cornerText;
    const scale = Math.min(w, h) / 70;
    centerContent = `<g transform="scale(${scale}) translate(${w/2/scale - 35},${h/2/scale - 35})">${ACTION_ICONS[card.type]}</g>`;
  } else if (card.type === 'wild') {
    cornerText = 'W';
    cornerTextBot = 'W';
    const scale = Math.min(w, h) / 70;
    centerContent = `<g transform="scale(${scale}) translate(${w/2/scale - 35},${h/2/scale - 35})">${ACTION_ICONS.wild}</g>`;
  } else if (card.type === 'wild_draw_four') {
    cornerText = '+4';
    cornerTextBot = '+4';
    const scale = Math.min(w, h) / 70;
    centerContent = `<g transform="scale(${scale}) translate(${w/2/scale - 35},${h/2/scale - 35})">${ACTION_ICONS.wild_draw_four}</g>`;
  }

  const cornerFontSize = Math.round(h * 0.12);
  const cornerPad = Math.round(h * 0.055);
  const ellipseRX = Math.round(w * 0.36);
  const ellipseRY = Math.round(h * 0.3);
  const borderRadius = Math.round(w * 0.12);
  const outlineColor = selected ? '#FFFFFF' : (playable ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.2)');
  const outlineWidth = selected ? 4 : 2;

  const gradId = `cg_${card.id}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${palette.gradient[0]};stop-opacity:1"/>
        <stop offset="100%" style="stop-color:${palette.gradient[1]};stop-opacity:1"/>
      </linearGradient>
      <!-- 광택 그라디언트 -->
      <linearGradient id="shine_${card.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:rgba(255,255,255,0.25);stop-opacity:1"/>
        <stop offset="50%" style="stop-color:rgba(255,255,255,0);stop-opacity:1"/>
      </linearGradient>
      <filter id="textShadow_${card.id}">
        <feDropShadow dx="1.5" dy="1.5" stdDeviation="1.5" flood-color="rgba(0,0,0,0.6)"/>
      </filter>
      <filter id="cardShadow_${card.id}">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.5)"/>
      </filter>
    </defs>

    <!-- 카드 외부 그림자 -->
    <rect x="2" y="4" width="${w-4}" height="${h-4}" rx="${borderRadius}"
      fill="rgba(0,0,0,0.35)" filter="url(#cardShadow_${card.id})"/>

    <!-- 카드 배경 -->
    <rect x="0" y="0" width="${w}" height="${h}" rx="${borderRadius}"
      fill="url(#${gradId})"/>

    <!-- 흰색 내부 테두리 -->
    <rect x="5" y="5" width="${w-10}" height="${h-10}" rx="${borderRadius-3}"
      fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="2.5"/>

    <!-- 카드 외부 테두리 -->
    <rect x="1" y="1" width="${w-2}" height="${h-2}" rx="${borderRadius-1}"
      fill="none" stroke="${outlineColor}" stroke-width="${outlineWidth}"/>

    <!-- 중앙 타원 (밝게) -->
    <ellipse cx="${w/2}" cy="${h/2}" rx="${ellipseRX}" ry="${ellipseRY}"
      fill="rgba(0,0,0,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>

    <!-- 카드 중앙 내용 -->
    ${centerContent}

    <!-- 광택 효과 (상단 하이라이트) -->
    <rect x="5" y="5" width="${w-10}" height="${h/2 - 10}" rx="${borderRadius-3}"
      fill="url(#shine_${card.id})"/>

    <!-- 좌상단 값 -->
    <text x="${cornerPad + 3}" y="${cornerPad + cornerFontSize}"
      font-size="${cornerFontSize}" font-weight="900" fill="white"
      font-family="'Arial Black', Arial, sans-serif"
      filter="url(#textShadow_${card.id})">${cornerText}</text>

    <!-- 우하단 값 (뒤집힘) -->
    <text x="${cornerPad + 3}" y="${cornerPad + cornerFontSize}"
      font-size="${cornerFontSize}" font-weight="900" fill="white"
      font-family="'Arial Black', Arial, sans-serif"
      transform="rotate(180, ${w/2}, ${h/2})"
      filter="url(#textShadow_${card.id})">${cornerTextBot}</text>

    <!-- 선택된 카드 강조 테두리 -->
    ${selected ? `<rect x="2" y="2" width="${w-4}" height="${h-4}" rx="${borderRadius-1}"
      fill="none" stroke="rgba(255,255,100,0.9)" stroke-width="3"/>` : ''}

    <!-- 낼 수 없는 카드 어둡게 -->
    ${!playable ? `<rect x="0" y="0" width="${w}" height="${h}" rx="${borderRadius}"
      fill="rgba(0,0,0,0.5)"/>` : ''}
  </svg>`;
}

/**
 * 카드 뒷면 SVG 생성
 */
function renderCardBack(width, height) {
  const w = width;
  const h = height;
  const borderRadius = Math.round(w * 0.12);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="backGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#1a1a3e"/>
        <stop offset="100%" style="stop-color:#0d0d22"/>
      </linearGradient>
      <pattern id="diag" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(255,255,255,0.06)" stroke-width="2"/>
      </pattern>
    </defs>

    <!-- 카드 배경 -->
    <rect x="0" y="0" width="${w}" height="${h}" rx="${borderRadius}" fill="url(#backGrad)"/>

    <!-- 사선 패턴 -->
    <rect x="0" y="0" width="${w}" height="${h}" rx="${borderRadius}" fill="url(#diag)"/>

    <!-- 내부 테두리 -->
    <rect x="5" y="5" width="${w-10}" height="${h-10}" rx="${borderRadius-3}"
      fill="none" stroke="#E8003D" stroke-width="2" opacity="0.8"/>

    <!-- 외부 테두리 -->
    <rect x="1" y="1" width="${w-2}" height="${h-2}" rx="${borderRadius-1}"
      fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

    <!-- UNO 로고 -->
    <text x="${w/2}" y="${h/2 - 4}"
      font-size="${Math.round(h * 0.18)}" font-weight="900"
      fill="white" text-anchor="middle"
      font-family="'Arial Black', Arial, sans-serif"
      stroke="#E8003D" stroke-width="2">UNO</text>

    <!-- 로고 아래 별 장식 -->
    <text x="${w/2}" y="${h/2 + 18}"
      font-size="10" fill="rgba(255,255,255,0.25)"
      text-anchor="middle">★ ★ ★</text>
  </svg>`;
}

/**
 * 색상 선택기 SVG 생성
 */
function renderColorPicker() {
  const colors = [
    { id: 'red', color: '#E8003D', label: '빨강', emoji: '🔴' },
    { id: 'blue', color: '#0065BD', label: '파랑', emoji: '🔵' },
    { id: 'green', color: '#1B9E3E', label: '초록', emoji: '🟢' },
    { id: 'yellow', color: '#FFD900', label: '노랑', emoji: '🟡' }
  ];

  return colors.map(c => `
    <button class="color-pick-btn" data-color="${c.id}"
      style="background:${c.color}; width:70px; height:70px; border-radius:50%;
             border:3px solid rgba(255,255,255,0.6); cursor:pointer;
             transition:transform 0.2s, box-shadow 0.2s;
             font-size:1.6rem; display:flex; align-items:center; justify-content:center;
             box-shadow: 0 4px 20px ${c.color}80;"
      onmouseover="this.style.transform='scale(1.2)'; this.style.boxShadow='0 0 30px ${c.color}'"
      onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 20px ${c.color}80'"
      title="${c.label}">
    </button>
  `).join('');
}

/**
 * 카드 DOM 요소 생성 (SVG를 innerHTML로 주입)
 */
function createCardElement(card, options = {}) {
  const div = document.createElement('div');
  div.className = `card-wrapper ${options.selected ? 'selected' : ''} ${options.playable ? 'playable' : 'unplayable'}`;
  div.dataset.cardId = card.id;
  div.innerHTML = renderCardSVG(card, options);
  return div;
}

/**
 * 카드 뒷면 DOM 요소 생성
 */
function createCardBackElement(options = {}) {
  const div = document.createElement('div');
  div.className = 'card-wrapper card-back';
  div.innerHTML = renderCardSVG(null, { ...options, isBack: true });
  return div;
}


// ─── Main: game.js ───

// ═══════════════════════════════════════════════════
// 게임 메인 로직
// Firebase 실시간 동기화 + UNO 게임 진행
// ═══════════════════════════════════════════════════

// [import removed]
// [import removed]
// [import removed]
// [import removed]

// ─── 감정표현 목록 ────────────────────────────────
const EMOTES = ['Uno!', '😂', '👍', '😤', '🔥', '😭', '🤯', '😮', '😜', '🤔', '🤮', '😡', '🤦‍♂️', '👎'];

// ─── 게임 상태 ────────────────────────────────────
let myPlayerId = '';
let myRoomCode = '';
let myName = '';
let gameState = null;      // 전체 게임 상태 (Firebase에서)
let myHand = [];           // 내 손패
let selectedCardId = null; // 선택한 카드 ID (와일드용)
let listeners = [];        // 정리용 리스너 목록
let unoCallTimer = null;   // UNO 패널티 자동 카운트다운 타이머
let hasCalledUno = false;  // UNO 선언 여부 (로컬)
let isHost = false;        // 방장 여부
let emoteCooldown = false; // 감정표현 쿨타임 (현재 미사용)
let unoPenaltyTimer = null; // 자동 패널티 타이머 (3초 카운트다운용)
let isHandlingPenalty = false; // 패널티 중복 처리 방지 락 플래그
let isLeaving = false;       // 퇴장 중복 방지 플래그
let isNavigatingToLobby = false; // 대기실 이동 중인지 여부 플래그 (튕김 방지용)
let unoCooldown = false;     // UNO 버튼 쿨타임 상태 플래그
let unoCooldownTimer = null; // 쿨타임 타이머
let lastProcessedPenaltyTimestamp = 0; // 중복 패널티 처리 방지용 타임스탬프

// ─── 초기화 ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  myPlayerId = params.get('player') || sessionStorage.getItem('uno_player_id');
  myRoomCode = params.get('room') || sessionStorage.getItem('uno_room_code');
  myName = sessionStorage.getItem('uno_player_name') || '플레이어';

  if (!myPlayerId || !myRoomCode) {
    alert('잘못된 접근입니다.');
    window.location.href = 'index.html';
    return;
  }

  initEmotePanel();
  bindGameEvents();
  listenToGame();
});

// ─── Firebase 리스닝 ─────────────────────────────

function listenToGame() {
  // 게임 전체 상태 리스닝
  const gameRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const unsubGame = onValue(gameRef, (snapshot) => {
    if (!snapshot.exists()) {
      // 게임 상태 없으면 방장이 초기화할 때까지 대기
      checkIfHostAndInit();
      return;
    }
    gameState = snapshot.val();
    renderGameState();
  });

  // 내 손패 별도 리스닝 (다른 플레이어가 볼 수 없게)
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${myPlayerId}`);
  const unsubHand = onValue(handRef, (snapshot) => {
    if (!snapshot.exists()) {
      myHand = [];
    } else {
      const val = snapshot.val();
      // Firebase는 배열을 객체로 저장할 수 있으므로 양쪽 처리
      myHand = Array.isArray(val) ? val : Object.values(val);
    }
    renderMyHand();
  });

  // 방 상태 (게임 종료, 플레이어 이탈 등)
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const unsubRoom = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      showGameOver({ reason: '방이 닫혔습니다.', winner: null });
      return;
    }
    const room = snapshot.val();
    // 방장 여부 업데이트
    isHost = room.host === myPlayerId;

    if (room.status === 'waiting') {
      isNavigatingToLobby = true; // 대기실 복귀 플래그 설정
      // 대기실 상태로 전환: 리스너 먼저 전부 해제 후 이동 (재초기화 타이밍 버그 방지)
      cleanupListeners();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.location.href = 'index.html';
      return;
    }

    if (room.status === 'finished') {
      handleGameFinished(room);
    } else if (room.status === 'restarting' || room.status === 'playing') {
      // 다시 시작 중이거나 플레이 중이면 게임 종료 모달 닫기
      const modal = document.getElementById('game-over-modal');
      if (modal) modal.style.display = 'none';
    }
    updatePlayerSidebars(room);
  });

  // 감정표현 리스닝
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  const unsubEmote = onValue(emoteRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const emotes = snapshot.val();
    // 내 것 제외하고 표시
    Object.entries(emotes).forEach(([pid, data]) => {
      if (pid !== myPlayerId && data && data.emote) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });

  listeners.push({ ref: gameRef, unsub: unsubGame });
  listeners.push({ ref: handRef, unsub: unsubHand });
  listeners.push({ ref: roomRef, unsub: unsubRoom });
  listeners.push({ ref: emoteRef, unsub: unsubEmote });
}

/** 모든 Firebase 실시간 리스너를 즉시 해제 (중복 실행 방지) */
function cleanupListeners() {
  listeners.forEach(({ unsub }) => {
    try { unsub(); } catch (e) { /* 무시 */ }
  });
  listeners.length = 0; // 배열 비우기
  stopTurnTimeoutTimer(); // 턴 타이머도 초기화 및 제거
}

async function checkIfHostAndInit() {
  const snapshot = await get(ref(database, `rooms/${myRoomCode}`));
  if (!snapshot.exists()) return;

  const room = snapshot.val();
  const gameType = room.gameType || 'uno';
  // 홀덤 방은 holdem.html에서 초기화 — UNO 상태로 덮어쓰지 않음
  if (gameType === 'holdem') return;
  // 오직 방 상태가 'playing'일 때만 자동으로 게임 초기화 실행
  if (room.status === 'playing' && room.host === myPlayerId && !room.gameState) {
    await initNewGame(room);
  }
}

async function initNewGame(room) {
  const rawPlayerIds = Object.keys(room.players || {});
  
  // [★ 요구사항 1] 봇전이든 멀티플레이든 방장(나)의 차례가 무조건 첫 번째가 되도록 playerIds 순서 재정렬
  const hostId = room.host;
  const playerIds = [hostId, ...rawPlayerIds.filter(id => id !== hostId)];

  const initialState = initializeGame(playerIds, 7);

  // 손패는 플레이어별로 분리 저장 (보안)
  const handsUpdate = {};
  for (const [pid, hand] of Object.entries(initialState.hands)) {
    handsUpdate[`rooms/${myRoomCode}/hands/${pid}`] = hand;
  }

  // 게임 상태 저장 (손패 제외)
  const gameStateToSave = {
    deck: initialState.deck,
    discardPile: initialState.discardPile,
    currentColor: initialState.currentColor,
    currentPlayer: initialState.currentPlayer,
    direction: initialState.direction,
    drawCount: initialState.drawCount,
    unoCalledBy: null,
    started: true,
    finished: false,
    winner: null,
    lastAction: { type: 'game_start', timestamp: Date.now() }
  };

  // 플레이어 순서 저장
  const playerOrder = {};
  playerIds.forEach((id, i) => { playerOrder[i] = id; });
  gameStateToSave.playerOrder = playerOrder;
  gameStateToSave.playerCount = playerIds.length;

  // 초기 손패 개수 저장
  const handCounts = {};
  for (const [pid, hand] of Object.entries(initialState.hands)) {
    handCounts[pid] = hand.length;
  }
  gameStateToSave.handCounts = handCounts;

  await update(ref(database), {
    [`rooms/${myRoomCode}/gameState`]: gameStateToSave,
    [`rooms/${myRoomCode}/status`]: 'playing',
    [`rooms/${myRoomCode}/emotes`]: null, // 감정표현 초기화
    ...handsUpdate
  });
}

// ─── 게임 렌더링 ─────────────────────────────────

function renderGameState() {
  if (!gameState) return;

  // 현재 플레이어 강조
  updateCurrentPlayerUI();

  // 버린 카드 더미 표시
  renderDiscardPile();

  // 드로우 더미 (남은 장수)
  renderDrawPile();

  // 현재 색상 표시 (와일드 후)
  renderCurrentColor();

  // 방향 표시 (상하)
  renderDirection();

  // 로그/액션 표시
  renderLastAction();

  // 내 턴 표시
  const isMyTurn = gameState.currentPlayer === myPlayerId;
  document.getElementById('my-turn-indicator')?.classList.toggle('active', isMyTurn);

  if (isMyTurn) {
    playMyTurn();
    startTurnTimeoutTimer(); // 턴 자동 드로우 타이머 시작
  } else {
    stopTurnTimeoutTimer(); // 내 턴이 아니면 즉각 타이머 클리어
  }

  // 패 다시 렌더 (유효성 재계산)
  renderMyHand();

  // UNO 버튼 상태 업데이트
  checkUnoStatus();

  // UNO 패널티 처리 (나이거나 봇 대행)
  handleUnoPenaltyIfTarget();

  // 봇들의 우노 타이머 실시간 동적 청소 (1장이 아니게 되었거나 이미 우노를 외친 봇의 타이머 파괴)
  if (isHost && gameState && gameState.handCounts) {
    for (const [pid, count] of Object.entries(gameState.handCounts)) {
      if (pid.startsWith('bot_')) {
        // 1장이 아니게 되었거나, 누군가에 의해 잡혔거나, 이미 우노를 외쳤다면 대기 중인 타이머 취소
        if (count !== 1 || gameState.unoCalledBy === pid || gameState.unoPenaltyTarget === pid) {
          if (botUnoTimersMap[pid]) {
            clearTimeout(botUnoTimersMap[pid]);
            delete botUnoTimersMap[pid];
            console.log(`[봇 우노 타이머 취소] ${pid} - 손패수: ${count}, unoCalled: ${gameState.unoCalledBy}`);
          }
        }
      }
    }
  }

  // [★ 봇 우노잡기 AI 엔진] 누군가 1장이 되었는데 우노를 안 외쳤다면 봇들이 랜덤 확률/딜레이로 우노잡기를 시도
  if (isHost) {
    checkBotsUnoCatch();
  }

  // [★ AI 대행 엔진] 봇 플레이어가 현재 차례이고 내가 방장(Host)인 경우 봇 턴 대행 연산 실행
  if (gameState.currentPlayer && gameState.currentPlayer.startsWith('bot_') && isHost) {
    triggerBotTurn(gameState.currentPlayer);
  }
}

function renderMyHand() {
  const handEl = document.getElementById('my-hand');
  if (!handEl) return;

  const isMyTurn = gameState?.currentPlayer === myPlayerId;
  const currentColor = gameState?.currentColor;
  const topCard = gameState?.discardPile?.[gameState.discardPile.length - 1];

  handEl.innerHTML = '';

  // 손패 정렬 (색상별)
  const sorted = [...myHand].sort((a, b) => {
    const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
    if (colorOrder[a.color] !== colorOrder[b.color]) return colorOrder[a.color] - colorOrder[b.color];
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.value || 0) - (b.value || 0);
  });

  sorted.forEach((card, idx) => {
    const playable = isMyTurn && topCard && isValidPlay(card, topCard, currentColor, gameState?.drawCount || 0);
    const isWild = card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR;
    const isSelectedWild = selectedCardId === card.id; // 와일드 선택 중

    const wrapper = document.createElement('div');
    wrapper.className = `hand-card ${playable ? 'playable' : 'unplayable'} ${isSelectedWild ? 'selected' : ''}`;
    wrapper.style.setProperty('--card-index', idx);
    wrapper.innerHTML = renderCardSVG(card, { width: 90, height: 130, selected: isSelectedWild, playable });
    wrapper.dataset.cardId = card.id;

    wrapper.addEventListener('click', () => {
      if (!isMyTurn) {
        showFloatMsg('지금은 내 차례가 아닙니다!');
        return;
      }
      if (!playable) {
        // 낼 수 없는 카드 흔들기
        wrapper.classList.remove('shake');
        void wrapper.offsetWidth; // reflow
        wrapper.classList.add('shake');
        playError();
        return;
      }
      handleCardPlay(card);
    });

    handEl.appendChild(wrapper);
  });

  // 패 개수 표시
  const countEl = document.getElementById('my-hand-count');
  if (countEl) countEl.textContent = myHand.length;

  // 내 손패가 2장 이상인데 내가 UNO를 외친 상태로 저장되어 있다면 Firebase 상태 초기화
  if (myHand.length > 1 && gameState && gameState.unoCalledBy === myPlayerId) {
    update(ref(database, `rooms/${myRoomCode}/gameState`), {
      unoCalledBy: null,
      unoTimestamp: null
    }).catch(err => console.error("UNO 외침 초기화 실패:", err));
  }

  // 손패 갱신 시 UNO 버튼 상태 즉시 업데이트
  checkUnoStatus();
}

function renderDiscardPile() {
  const el = document.getElementById('discard-pile');
  if (!el || !gameState?.discardPile?.length) return;

  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile
    : Object.values(gameState.discardPile);

  const topCard = discardArr[discardArr.length - 1];
  const second = discardArr.length > 1 ? discardArr[discardArr.length - 2] : null;

  el.innerHTML = '';

  // 두 번째 카드 (약간 기울어지게)
  if (second) {
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;transform:rotate(-10deg) translateY(3px);opacity:0.65;';
    bg.innerHTML = renderCardSVG(second, { width: 90, height: 130 });
    el.appendChild(bg);
  }

  // 맨 위 카드
  const top = document.createElement('div');
  top.style.cssText = 'position:relative;';
  top.innerHTML = renderCardSVG(topCard, { width: 90, height: 130 });
  el.appendChild(top);
}

function renderDrawPile() {
  const el = document.getElementById('draw-pile');
  if (!el) return;

  const deckData = gameState?.deck;
  let deckSize = 0;
  if (Array.isArray(deckData)) {
    deckSize = deckData.length;
  } else if (deckData && typeof deckData === 'object') {
    deckSize = Object.keys(deckData).length;
  }

  el.innerHTML = '';
  // 스택처럼 보이게 여러 장
  const layers = Math.min(3, Math.ceil(deckSize / 20));
  for (let i = layers; i >= 0; i--) {
    const card = document.createElement('div');
    card.style.cssText = `position:absolute; top:${-i*2}px; left:${-i*2}px;`;
    card.innerHTML = renderCardSVG(null, { width: 90, height: 130, isBack: true });
    el.appendChild(card);
  }

  // 남은 카드 수
  const countEl = document.getElementById('deck-count');
  if (countEl) countEl.textContent = deckSize;
}

function renderCurrentColor() {
  const el = document.getElementById('current-color');
  if (!el || !gameState) return;

  const colorMap = {
    red: '#E8003D', blue: '#0065BD', green: '#1B9E3E', yellow: '#FFD900', wild: '#333'
  };
  const labelMap = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑', wild: '?' };

  const color = colorMap[gameState.currentColor] || '#333';
  el.style.background = color;
  el.style.boxShadow = `0 0 20px ${color}88`;
  el.title = labelMap[gameState.currentColor] || '';
}

function renderDirection() {
  // 방향 표시 상하 ↓/↑
  const dirEl = document.getElementById('direction-indicator');
  if (!dirEl || !gameState) return;
  dirEl.textContent = gameState.direction === 1 ? '↓' : '↑';
}

function renderLastAction() {
  const el = document.getElementById('action-log');
  if (!el || !gameState?.lastAction) return;

  const action = gameState.lastAction;
  let msg = '';

  switch (action.type) {
    case 'game_start': msg = '🎮 게임이 시작되었습니다!'; break;
    case 'play_card': msg = `${action.playerName}가 카드를 냈습니다`; break;
    case 'draw_card': msg = `${action.playerName}가 카드를 뽑았습니다`; break;
    case 'draw_penalty': msg = `${action.playerName}가 ${action.count}장을 받았습니다`; break;
    case 'uno_call': msg = `🔔 ${action.playerName}가 UNO를 외쳤습니다!`; break;
    case 'uno_penalty': msg = `⚠️ ${action.playerName}가 ${action.targetPlayerName || '상대'}의 UNO를 잡았습니다! (+2장 패널티)`; break;
    case 'skip': msg = `⏭️ ${action.playerName}의 차례를 건너뜁니다`; break;
    case 'reverse': msg = `🔄 방향이 바뀌었습니다`; break;
    default: msg = action.message || '';
  }

  // 우노 선언(uno_call) 또는 우노 잡기(uno_penalty) 이벤트 발생 시 자동으로 닉네임 옆에 Uno! 팝업 출력
  if (action.type === 'uno_call' || action.type === 'uno_penalty') {
    if (action.playerId) {
      showEmotePopup(action.playerId, 'Uno!', action.timestamp || Date.now());
    }
  }

  // 페이드 인 애니메이션
  el.style.opacity = '0';
  el.textContent = msg;
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '1';
  });
}

function updatePlayerSidebars(room) {
  const playersEl = document.getElementById('players-sidebar');
  if (!playersEl || !room.players) return;

  const players = room.players;
  const rawOrder = gameState?.playerOrder ? Object.values(gameState.playerOrder) : Object.keys(players);
  // 방장(나)이 무조건 플레이어 사이드바 목록의 최상단에 오도록 배치 순서 정렬
  const hostId = room.host;
  const order = rawOrder.includes(hostId)
    ? [hostId, ...rawOrder.filter(id => id !== hostId)]
    : rawOrder;
  const currentPlayer = gameState?.currentPlayer;

  playersEl.innerHTML = order.map(pid => {
    const player = players[pid];
    if (!player) return '';

    const handCount = gameState?.handCounts?.[pid] ?? '?';
    const isActive = pid === currentPlayer;
    const isMe = pid === myPlayerId;
    // 방향 화살표: 현재 방향(↓/↑)
    const dirArrow = gameState?.direction === 1 ? '↓' : '↑';

    // 1장이면 빨간 강조
    const countClass = handCount === 1 ? 'card-count-badge uno-alert' : 'card-count-badge';

    return `<div class="player-sidebar-item ${isActive ? 'active-player' : ''} ${isMe ? 'is-me' : ''}" data-pid="${pid}">
      <div class="player-sidebar-avatar">${getAvatar(pid, room)}</div>
      <div class="player-sidebar-info">
        <div class="player-sidebar-name">${escapeHtml(player.name)}${isMe ? ' (나)' : ''}${pid === room.host ? ' 👑' : ''}</div>
        <div class="player-sidebar-cards">
          <span class="${countClass}">${handCount}</span>
          <span class="card-count-label">장</span>
        </div>
      </div>
      ${isActive ? `<div class="turn-arrow">${dirArrow}</div>` : ''}
    </div>`;
  }).join('');
}

function updateCurrentPlayerUI() {
  if (!gameState) return;

  const isMyTurn = gameState.currentPlayer === myPlayerId;
  document.body.classList.toggle('my-turn', isMyTurn);

  // DrawCount가 있으면 표시
  const drawEl = document.getElementById('draw-count-badge');
  if (drawEl) {
    if (gameState.drawCount > 0) {
      drawEl.textContent = `+${gameState.drawCount}`;
      drawEl.style.display = 'block';
    } else {
      drawEl.style.display = 'none';
    }
  }
}

// ─── 카드 내기 (클릭 1번) ───────────────────────

function handleCardPlay(card) {
  const isWild = card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR;

  if (isWild) {
    // 와일드 카드는 1번 클릭에 바로 색상 선택 모달 열기
    showColorPicker(card);
    return;
  }

  // 일반 카드: 클릭 1번에 즉시 냄
  selectedCardId = null;
  playCard(card, null);
}

async function playCard(card, chosenColor) {
  if (!gameState || gameState.currentPlayer !== myPlayerId) return;

  stopTurnTimeoutTimer(); // 카드를 냈으므로 턴 타이머 정지

  const playerIds = Object.values(gameState.playerOrder || {});
  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile
    : Object.values(gameState.discardPile);
  const topCard = discardArr[discardArr.length - 1];

  if (!isValidPlay(card, topCard, gameState.currentColor, gameState.drawCount || 0)) {
    showFloatMsg('낼 수 없는 카드입니다!');
    playError();
    return;
  }

  // 내 손패에서 카드 제거
  const newHand = myHand.filter(c => c.id !== card.id);

  // 카드 효과 계산
  const changes = processCardPlay(card, gameState, myPlayerId, playerIds);

  // 새 discard pile
  const newDiscardPile = [...discardArr, card];

  // 색상 결정
  let newColor = chosenColor || card.color;

  // 덱 재섞기 필요 여부
  const deckData = gameState.deck;
  let newDeck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  if (newDeck.length < 5) {
    const reshuffled = shuffleDeck(newDiscardPile.slice(0, -1));
    newDeck = [...newDeck, ...reshuffled];
  }

  // 다음 플레이어
  let nextPlayer = changes.nextPlayer
    || playerIds[(playerIds.indexOf(myPlayerId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  // drawCount 처리
  const newDrawCount = changes.drawCount;

  // 방향 업데이트
  const newDirection = changes.reverseDirection ? -(gameState.direction || 1) : (gameState.direction || 1);

  // 이긴 경우
  const hasWon = newHand.length === 0;

  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[myPlayerId] = newHand.length;

  const updates = {
    [`rooms/${myRoomCode}/hands/${myPlayerId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/discardPile`]: newDiscardPile,
    [`rooms/${myRoomCode}/gameState/deck`]: newDeck,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: hasWon ? myPlayerId : nextPlayer,
    [`rooms/${myRoomCode}/gameState/currentColor`]: newColor,
    [`rooms/${myRoomCode}/gameState/direction`]: newDirection,
    [`rooms/${myRoomCode}/gameState/drawCount`]: newDrawCount,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: 'play_card',
      playerName: myName,
      playerId: myPlayerId,
      card: card,
      timestamp: Date.now()
    }
  };

  // [★ 신규 룰 적용] 유저가 2장에서 1장으로 줄어든 경우 우노잡기 타겟으로 지정, 그 외에는 우노잡기 대상 만료
  if (newHand.length === 1 && !hasWon) {
    updates[`rooms/${myRoomCode}/gameState/unoCatchablePlayer`] = myPlayerId;
  } else {
    updates[`rooms/${myRoomCode}/gameState/unoCatchablePlayer`] = null;
  }

  if (hasWon) {
    // 게임 종료: 방은 삭제하지 않고 상태만 변경 (다시 시작 가능)
    updates[`rooms/${myRoomCode}/gameState/finished`] = true;
    updates[`rooms/${myRoomCode}/gameState/winner`] = myPlayerId;
    updates[`rooms/${myRoomCode}/status`] = 'finished';
    updates[`rooms/${myRoomCode}/winnerName`] = myName;
    updates[`rooms/${myRoomCode}/winnerPlayerId`] = myPlayerId;
  }

  await update(ref(database), updates);

  selectedCardId = null;
  hasCalledUno = false;
  playCardPlay();

  // 특수 카드 효과음
  if (card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR) playWild();
  if (card.type === CARD_TYPES.DRAW_TWO || card.type === CARD_TYPES.WILD_DRAW_FOUR) playDrawPenalty();

  // 이긴 경우
  if (hasWon) playWin();
}

// ─── 카드 뽑기 ───────────────────────────────────

async function handleDrawCard() {
  if (!gameState || gameState.currentPlayer !== myPlayerId) {
    showFloatMsg('지금은 내 차례가 아닙니다!');
    return;
  }

  stopTurnTimeoutTimer(); // 카드를 뽑았으므로 턴 타이머 정지

  const drawCount = gameState.drawCount > 0 ? gameState.drawCount : 1;

  const deckData = gameState.deck;
  let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  const drawn = [];

  for (let i = 0; i < drawCount; i++) {
    if (deck.length === 0) {
      // 버린 더미 재섞기
      const discardArr = Array.isArray(gameState.discardPile)
        ? gameState.discardPile
        : Object.values(gameState.discardPile);
      const reshuffled = shuffleDeck([...discardArr.slice(0, -1)]);
      deck = reshuffled;
    }
    if (deck.length > 0) {
      drawn.push(deck.shift());
    }
  }

  const newHand = [...myHand, ...drawn];
  const playerIds = Object.values(gameState.playerOrder || {});
  const nextPlayer = playerIds[(playerIds.indexOf(myPlayerId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[myPlayerId] = newHand.length;

  await update(ref(database), {
    [`rooms/${myRoomCode}/hands/${myPlayerId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/deck`]: deck,
    [`rooms/${myRoomCode}/gameState/drawCount`]: 0,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: nextPlayer,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/unoCatchablePlayer`]: null, // [★ 신규 룰 적용] 행동을 개시했으므로 이전 우노잡기 대상은 만료됨
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: drawCount > 1 ? 'draw_penalty' : 'draw_card',
      playerName: myName,
      count: drawCount,
      timestamp: Date.now()
    }
  });

  playCardDraw();
  selectedCardId = null;
  hasCalledUno = false;
}

// ─── UNO 시스템 (선언 + 잡기 통합) ────────────────

/**
 * 통합 UNO 버튼 클릭 핸들러
 * - 내가 1장이고 아직 선언 안 했으면 → UNO 선언
 * - 상대가 1장이고 선언 안 했으면 → UNO 잡기 (패널티 부여)
 */
async function handleUnoBtn() {
  if (unoCooldown) return;

  // 클릭 즉시 쿨타임 3초 돌리기 (연타 차단 및 모든 상태에 공유)
  startUnoCooldown();

  // 1) 내가 1장이고 아직 선언 안 한 상태 → 내 UNO 선언
  const myHandCount = myHand.length;
  if (myHandCount === 1 && gameState?.unoCalledBy !== myPlayerId) {
    await doUnoCall();
    return;
  }

  // 2) 잡을 수 있는 상대가 있으면 → UNO 잡기
  const catchTarget = getCatchableTarget();
  if (catchTarget) {
    await doCatchUno(catchTarget);
    return;
  }

  showFloatMsg('지금은 UNO를 외치거나 잡을 수 없습니다!');
}

/** UNO 버튼 2초 쿨타임 처리 */
function startUnoCooldown() {
  unoCooldown = true;
  const unoBtn = document.getElementById('btn-uno');
  if (!unoBtn) return;

  let secondsLeft = 2;
  unoBtn.disabled = true;
  unoBtn.className = 'btn-uno-disabled';
  unoBtn.style.opacity = '0.6';
  unoBtn.style.cursor = 'not-allowed';
  unoBtn.textContent = `⏳ 대기 (${secondsLeft}초)`;

  unoCooldownTimer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(unoCooldownTimer);
      unoCooldown = false;
      unoBtn.disabled = false;
      unoBtn.style.opacity = '1';
      unoBtn.style.cursor = 'pointer';
      checkUnoStatus(); // 쿨타임 해제 후 상태 업데이트
    } else {
      unoBtn.textContent = `⏳ 대기 (${secondsLeft}초)`;
    }
  }, 1000);
}

/** UNO 선언 실행 */
async function doUnoCall() {
  hasCalledUno = true;

  // Firebase runTransaction을 사용한 원자적 UNO 선언
  const gameRef = ref(database, `rooms/${myRoomCode}/gameState`);
  try {
    const result = await runTransaction(gameRef, (currentData) => {
      if (!currentData) return currentData;

      // 이미 다른 사람에게 잡혔거나(penalty) 다른 사람이 먼저 우노를 선언했다면 롤백
      if (currentData.unoPenaltyTarget || currentData.unoCalledBy) {
        return; // 아무것도 변경하지 않고 트랜잭션 중단 (undefined 리턴 시 Abort)
      }

      // 우노 선언 데이터 세팅
      currentData.unoCalledBy = myPlayerId;
      currentData.unoTimestamp = Date.now();
      currentData.unoCatchablePlayer = null; // [★ 신규 룰 적용] 우노를 정상 선언했으므로 우노잡기 대상 만료
      currentData.lastAction = {
        type: 'uno_call',
        playerName: myName,
        playerId: myPlayerId,
        timestamp: Date.now()
      };

      return currentData;
    });

    if (!result.committed) {
      console.warn("[UNO 선언] 찰나의 지연으로 선언에 실패했습니다. (이미 잡혔거나 다른 사람이 먼저 선언함)");
      showFloatMsg('🚨 우노 선언 타이밍을 놓쳤습니다!', 2000);
      hasCalledUno = false;
      checkUnoStatus();
      return;
    }

    playUnoCall();
    showFloatMsg('UNO!! 🔔', 2000);
  } catch (err) {
    console.error("[UNO 선언] 트랜잭션 에러:", err);
  }

  // 버튼 잠시 비활성화 (중복 방지)
  const unoBtn = document.getElementById('btn-uno');
  if (unoBtn) {
    unoBtn.disabled = true;
    setTimeout(() => { unoBtn.disabled = false; checkUnoStatus(); }, 1500);
  }
}

/** UNO 잡기 실행 */
async function doCatchUno(targetPlayerId) {
  const gameRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const targetPlayerName = roomPlayersCache[targetPlayerId]?.name || '상대';
  try {
    const result = await runTransaction(gameRef, (currentData) => {
      if (!currentData) return currentData;

      const handCounts = currentData.handCounts || {};
      const unoCalledBy = currentData.unoCalledBy;

      // 트랜잭션 시점에 이미 대상의 패 개수가 1장이 아니거나, 대상이 이미 우노를 외쳤거나, 이미 다른 사람에 의해 잡힌 상태라면 롤백
      if (handCounts[targetPlayerId] !== 1 || unoCalledBy === targetPlayerId || currentData.unoPenaltyTarget) {
        return; // Abort
      }

      currentData.unoPenaltyTarget = targetPlayerId;
      currentData.unoPenaltyTimestamp = Date.now();
      currentData.unoCalledBy = null;
      currentData.unoTimestamp = null;
      currentData.unoCatchablePlayer = null; // [★ 신규 룰 적용] 우노잡기를 이미 성공했으므로 대상 만료
      currentData.lastAction = {
        type: 'uno_penalty',
        playerName: myName,
        playerId: myPlayerId,
        targetPlayerId,
        targetPlayerName,
        timestamp: Date.now()
      };

      return currentData;
    });

    if (!result.committed) {
      console.warn("[우노 잡기] 이미 상대가 우노를 외쳤거나 다른 플레이어가 먼저 잡았습니다.");
      showFloatMsg('🚨 우노 잡기 선점에 실패했습니다!', 2000);
      checkUnoStatus();
      return;
    }

    showFloatMsg('🚨 UNO 안 외쳤죠?! 패널티 +2장!', 2500);
    playDrawPenalty();
  } catch (err) {
    console.error("[우노 잡기] 트랜잭션 에러:", err);
  }

  // 패널티 대상이 나 자신의 클라이언트에서 카드 뽑기 처리
  // → Firebase 리스너가 unoPenaltyTarget을 보고 해당 플레이어가 직접 처리
  const unoBtn = document.getElementById('btn-uno');
  if (unoBtn) setTimeout(() => { unoBtn.disabled = false; }, 1500);
}

/**
 * UNO 잡기 가능한 상대 플레이어 ID 반환
 * 1장이고, 본인이 UNO 선언하지 않은 플레이어
 */
function getCatchableTarget() {
  if (!gameState) return null;
  const target = gameState.unoCatchablePlayer;
  const unoCalledBy = gameState.unoCalledBy;

  // 1장이 된 직후의 명확한 우노잡기 대상이 존재하고, 그 대상이 내가 아니며, 아직 우노를 선언하지 않은 경우에만 잡기 허용
  if (target && target !== myPlayerId && target !== unoCalledBy) {
    return target;
  }
  return null;
}

/**
 * UNO 버튼 상태 업데이트
 * 매 gameState/handCounts 업데이트마다 호출됨
 */
function checkUnoStatus() {
  if (unoCooldown) return; // 쿨타임 중일 때는 텍스트/상태 업데이트 생략
  if (!gameState) return;
  const unoBtn = document.getElementById('btn-uno');
  if (!unoBtn) return;

  const myCount = myHand.length;
  const handCounts = gameState.handCounts || {};
  const unoCalledBy = gameState.unoCalledBy;

  // 내가 1장이고 아직 UNO 안 외친 상태
  const canCall = myCount === 1 && unoCalledBy !== myPlayerId;
  // 잡을 수 있는 상대가 있는지
  const catchTarget = getCatchableTarget();

  // UNO 버튼은 항상 보이게 설정하며 평소에도 상시 클릭 가능
  unoBtn.style.display = 'inline-flex';
  unoBtn.disabled = false;
  unoBtn.style.opacity = '1';
  unoBtn.style.cursor = 'pointer';

  if (canCall) {
    unoBtn.textContent = '🔔 UNO!';
    unoBtn.className = 'btn-uno-call';
    unoBtn.setAttribute('title', '지금 UNO를 외치세요! 안 외치면 패널티!');
  } else if (catchTarget) {
    unoBtn.textContent = '🚨 UNO 잡기!';
    unoBtn.className = 'btn-uno-catch';
    unoBtn.setAttribute('title', 'UNO를 외치지 않은 상대를 잡으세요!');
  } else {
    unoBtn.textContent = '🔔 UNO';
    unoBtn.className = 'btn-uno-disabled';
    unoBtn.setAttribute('title', 'UNO를 외칠 상황은 아니지만 클릭해 볼 수 있습니다.');
  }
}

/**
 * UNO 패널티 처리 (Firebase에서 unoPenaltyTarget 감지 시)
 * 패널티 대상 플레이어(유저) 본인이 직접 카드를 뽑아 저장하거나,
 * 봇이 대상인 경우 방장(Host)이 대행하여 카드를 드로우하고 저장
 */
async function handleUnoPenaltyIfTarget() {
  if (isHandlingPenalty) return;
  if (!gameState?.unoPenaltyTarget) return;

  const targetId = gameState.unoPenaltyTarget;
  const isTargetBot = targetId.startsWith('bot_');

  // 나 자신도 아니고, 봇인데 방장도 아니라면 패널티 처리 권한 없음
  if (targetId !== myPlayerId && (!isTargetBot || !isHost)) return;

  const penaltyTs = gameState.unoPenaltyTimestamp || 0;
  // 이미 이 타임스탬프의 패널티를 수령 완료했다면 조기 중단 (중복 드로우 차단)
  if (penaltyTs !== 0 && lastProcessedPenaltyTimestamp === penaltyTs) {
    return;
  }

  isHandlingPenalty = true;
  lastProcessedPenaltyTimestamp = penaltyTs; // 로컬 기록 갱신

  try {
    const deckData = gameState.deck;
    let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
    const drawn = [];

    // 2장 뽑기
    for (let i = 0; i < 2; i++) {
      if (deck.length === 0) {
        const discardArr = Array.isArray(gameState.discardPile)
          ? gameState.discardPile : Object.values(gameState.discardPile);
        deck = shuffleDeck([...discardArr.slice(0, -1)]);
      }
      if (deck.length > 0) drawn.push(deck.shift());
    }

    let currentHand = [];
    if (targetId === myPlayerId) {
      currentHand = [...myHand];
    } else {
      // 봇인 경우 Firebase에서 직접 손패를 가져옴
      const handSnap = await get(ref(database, `rooms/${myRoomCode}/hands/${targetId}`));
      if (handSnap.exists()) {
        const val = handSnap.val();
        currentHand = Array.isArray(val) ? val : Object.values(val || {});
      }
    }

    const newHand = [...currentHand, ...drawn];
    const handCounts = { ...(gameState.handCounts || {}) };
    handCounts[targetId] = newHand.length;

    // unoPenaltyTarget, unoPenaltyTimestamp 클리어 + 손패 업데이트
    const updates = {
      [`rooms/${myRoomCode}/hands/${targetId}`]: newHand,
      [`rooms/${myRoomCode}/gameState/deck`]: deck,
      [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
      [`rooms/${myRoomCode}/gameState/unoPenaltyTarget`]: null,
      [`rooms/${myRoomCode}/gameState/unoPenaltyTimestamp`]: null
    };

    // 만약 봇이 패널티를 받아 2장 이상이 되었다면, 기존 봇의 우노 외침 완료 상태를 제거해 주어야 함
    if (gameState.unoCalledBy === targetId) {
      updates[`rooms/${myRoomCode}/gameState/unoCalledBy`] = null;
      updates[`rooms/${myRoomCode}/gameState/unoTimestamp`] = null;
    }

    await update(ref(database), updates);

    if (targetId === myPlayerId) {
      showFloatMsg('패널티! 카드 2장을 받았습니다 😱', 2000);
      playDrawPenalty();
    } else {
      const botName = roomPlayersCache[targetId]?.name || '컴퓨터 봇';
      showFloatMsg(`⚠️ [패널티] ${botName}가 카드를 2장 드로우했습니다!`, 3000);
      playDrawPenalty();
    }
  } catch (error) {
    console.error("UNO 패널티 처리 중 오류 발생:", error);
  } finally {
    isHandlingPenalty = false;
  }
}

// ─── 색상 선택기 ─────────────────────────────────

function showColorPicker(card) {
  const modal = document.getElementById('color-picker-modal');
  if (!modal) return;

  modal.style.display = 'flex';
  const buttonsEl = document.getElementById('color-picker-buttons');
  if (buttonsEl) buttonsEl.innerHTML = renderColorPicker();

  // 색상 선택 이벤트
  buttonsEl.querySelectorAll('.color-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      modal.style.display = 'none';
      selectedCardId = null;
      playCard(card, color);
    });
  });

  // 취소
  const cancelBtn = document.getElementById('btn-cancel-color');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.style.display = 'none';
      selectedCardId = null;
      renderMyHand();
    };
  }
}

// ─── 게임 종료 ───────────────────────────────────

function handleGameFinished(room) {
  const winnerId = gameState?.winner || room.winnerPlayerId;
  const winnerName = room.winnerName || '???';
  const isWinner = winnerId === myPlayerId;

  showGameOver({ isWinner, winnerName });
  if (isWinner) playWin(); else playLose();

  // 다시 시작 버튼 - 방장만 표시
  const restartBtn = document.getElementById('btn-restart-game');
  if (restartBtn) {
    restartBtn.style.display = isHost ? 'inline-flex' : 'none';
  }
}

function showGameOver({ isWinner, winnerName, reason }) {
  const modal = document.getElementById('game-over-modal');
  if (!modal) return;

  // 이미 열려 있으면 다시 열지 않음
  if (modal.style.display === 'flex') return;

  const titleEl = document.getElementById('game-over-title');
  const msgEl = document.getElementById('game-over-msg');
  const emojiEl = document.getElementById('game-over-emoji');

  if (reason) {
    if (emojiEl) emojiEl.textContent = '🚪';
    if (titleEl) titleEl.textContent = '게임 종료';
    if (msgEl) msgEl.textContent = reason;
  } else {
    if (emojiEl) emojiEl.textContent = isWinner ? '🏆' : '😢';
    if (titleEl) titleEl.textContent = isWinner ? '🎉 승리!' : '😢 패배...';
    if (msgEl) msgEl.textContent = isWinner
      ? '축하합니다! UNO 게임에서 이겼습니다!'
      : `${winnerName}님이 먼저 카드를 모두 냈습니다.`;
  }

  modal.style.display = 'flex';
}

// ─── 게임 다시 시작 (방장만) ─────────────────────

async function handleRestartGame() {
  if (!isHost) return;

  // 모달 닫기
  const modal = document.getElementById('game-over-modal');
  if (modal) modal.style.display = 'none';

  try {
    const snap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!snap.exists()) return;

    const room = snap.val();
    const rawPlayerIds = Object.keys(room.players || {});
    const hostId = room.host;
    const playerIds = [hostId, ...rawPlayerIds.filter(id => id !== hostId)];

    const initialState = initializeGame(playerIds, 7);

    // 손패는 플레이어별로 분리 저장 (보안)
    const handsUpdate = {};
    for (const [pid, hand] of Object.entries(initialState.hands)) {
      handsUpdate[`rooms/${myRoomCode}/hands/${pid}`] = hand;
    }

    // 게임 상태 구성 (손패 제외)
    const gameStateToSave = {
      deck: initialState.deck,
      discardPile: initialState.discardPile,
      currentColor: initialState.currentColor,
      currentPlayer: initialState.currentPlayer,
      direction: initialState.direction,
      drawCount: initialState.drawCount,
      unoCalledBy: null,
      started: true,
      finished: false,
      winner: null,
      lastAction: { type: 'game_start', timestamp: Date.now() }
    };

    // 플레이어 순서 저장
    const playerOrder = {};
    playerIds.forEach((id, i) => { playerOrder[i] = id; });
    gameStateToSave.playerOrder = playerOrder;
    gameStateToSave.playerCount = playerIds.length;

    // 초기 손패 개수 저장
    const handCounts = {};
    for (const [pid, hand] of Object.entries(initialState.hands)) {
      handCounts[pid] = hand.length;
    }
    gameStateToSave.handCounts = handCounts;

    // 단일 트랜잭션 업데이트로 모든 방원들이 즉시 갱신되도록 처리
    await update(ref(database), {
      [`rooms/${myRoomCode}/gameState`]: gameStateToSave,
      [`rooms/${myRoomCode}/status`]: 'playing',
      [`rooms/${myRoomCode}/emotes`]: null, // 감정표현 초기화
      ...handsUpdate
    });
  } catch (err) {
    console.error('게임 재시작 실패:', err);
    alert('게임 재시작 중 오류가 발생했습니다.');
  }
}

// ─── 감정표현 ────────────────────────────────────

function initEmotePanel() {
  const listEl = document.getElementById('emote-list');
  const toggleBtn = document.getElementById('btn-emote-toggle');

  if (!listEl || !toggleBtn) return;

  // 이모지 버튼 생성
  listEl.innerHTML = EMOTES.map(e =>
    `<button class="emote-btn" data-emote="${e}" title="${e}">${e}</button>`
  ).join('');

  // 개별 이모지 클릭 (보내도 이모지 창을 닫지 않음)
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

  // 외부 클릭 시 닫는 로직 제거 (수동으로 다시 토글 버튼을 눌러야 닫히게 설정)
}

// 감정표현 쿨타임 추적 변수
let isEmoteCooldown = false;

async function sendEmote(emote) {
  if (isEmoteCooldown) return; // 쿨타임 중이면 전송 무시
  isEmoteCooldown = true;

  const toggleBtn = document.getElementById('btn-emote-toggle');
  const listEl = document.getElementById('emote-list');

  // [★ 요구사항] 토글 버튼은 쿨타임 중에도 절대 비활성화(disabled)되지 않고 상시 창 여닫기가 가능하도록 유지
  if (toggleBtn) {
    toggleBtn.classList.add('cooldown');
  }

  // 대신 이모지 리스트 내부의 개별 이모지 버튼들만 쿨타임으로 비활성화 처리
  if (listEl) {
    listEl.querySelectorAll('.emote-btn').forEach(btn => {
      btn.classList.add('cooldown');
      btn.disabled = true;
    });
  }

  // Firebase에 저장
  try {
    await update(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`), {
      emote,
      senderName: myName,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('감정표현 전송 실패:', e);
  }

  // 내 화면에서도 플레이어 사이드바 내 이름 오른쪽에 이모지가 팝업되도록 설정
  showEmotePopup(myPlayerId, emote, Date.now());

  // 1초(1000ms) 쿨타임 후 상태 원상 복구
  setTimeout(() => {
    isEmoteCooldown = false;
    if (toggleBtn) {
      toggleBtn.classList.remove('cooldown');
    }
    if (listEl) {
      listEl.querySelectorAll('.emote-btn').forEach(btn => {
        btn.classList.remove('cooldown');
        btn.disabled = false;
      });
    }
  }, 1000);
}

// 이미 표시된 감정표현 타임스탬프 추적 (중복 방지)
const shownEmoteTimestamps = new Set();

function showEmotePopup(playerId, emote, timestamp) {
  // 중복 방지
  const key = `${playerId}_${timestamp}`;
  if (shownEmoteTimestamps.has(key)) return;
  shownEmoteTimestamps.add(key);

  // 최신 것만 유지 (메모리 관리)
  if (shownEmoteTimestamps.size > 50) {
    const first = shownEmoteTimestamps.values().next().value;
    shownEmoteTimestamps.delete(first);
  }

  // 플레이어 사이드바 아이템 위치 기준으로 팝업
  const playerEl = document.querySelector(`[data-pid="${playerId}"]`);
  if (!playerEl) return;

  const rect = playerEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  if (emote === 'Uno!') {
    popup.classList.add('uno-text-popup');
  }
  popup.textContent = emote;
  popup.style.left = `${rect.right + 10}px`;
  popup.style.top = `${rect.top}px`;

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 3100);
}

function showEmotePopupSelf(emote) {
  // 자기 자신의 팝업은 화면 중앙 하단에 표시
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  if (emote === 'Uno!') {
    popup.classList.add('uno-text-popup');
  }
  popup.textContent = emote;
  popup.style.left = '50%';
  popup.style.bottom = '220px';
  popup.style.transform = 'translateX(-50%)';
  popup.style.fontSize = '3rem';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 3100);
}

// ─── 이벤트 바인딩 ───────────────────────────────

// 브라우저 닫기/새로고침 시 이탈 처리 핸들러
const handleBeforeUnload = () => {
  if (isNavigatingToLobby) return; // 대기실 복귀 중일 때는 이탈 처리 스킵!
  leaveGameRoom();
};

function bindGameEvents() {
  // 카드 뽑기
  document.getElementById('draw-pile')?.addEventListener('click', handleDrawCard);
  document.getElementById('btn-draw')?.addEventListener('click', handleDrawCard);

  // UNO 선언 / 잡기 통합 버튼
  document.getElementById('btn-uno')?.addEventListener('click', handleUnoBtn);

  // 게임 다시 시작 (방장만)
  document.getElementById('btn-restart-game')?.addEventListener('click', handleRestartGame);

  // 게임 종료 후 대기실 복귀
  document.getElementById('btn-back-lobby')?.addEventListener('click', async () => {
    isNavigatingToLobby = true; // 대기실 복귀 플래그 설정
    // 리스너 먼저 전부 해제 (이후 Firebase 변경이 루프를 일으키지 않도록)
    cleanupListeners();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    try {
      // [★ 버그 수정] 방장이든 참가자든 대기실 복귀 시 방 상태를 waiting으로 동기화하여 모두 함께 복귀
      const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
      const updates = {
        [`rooms/${myRoomCode}/status`]: 'waiting',
        [`rooms/${myRoomCode}/gameState`]: null,
        [`rooms/${myRoomCode}/winnerName`]: null,
        [`rooms/${myRoomCode}/winnerPlayerId`]: null,
        [`rooms/${myRoomCode}/emotes`]: null
      };

      if (roomSnap.exists()) {
        const roomData = roomSnap.val();
        const players = roomData.players || {};
        
        Object.keys(players).forEach(pid => {
          if (pid.startsWith('bot_')) {
            updates[`rooms/${myRoomCode}/players/${pid}`] = null;
            updates[`rooms/${myRoomCode}/hands/${pid}`] = null;
          }
        });
      }

      await update(ref(database), updates);
    } catch (err) {
      console.error("대기실 복귀 처리 실패:", err);
    }
    window.location.href = 'index.html';
  });

  // 게임 나가기
  document.getElementById('btn-leave-game')?.addEventListener('click', () => {
    if (confirm('게임을 나가시겠습니까? 다른 플레이어들은 계속 진행됩니다.')) {
      leaveGameRoom();
    }
  });

  // 브라우저 닫기/새로고침 시 이탈 처리
  window.addEventListener('beforeunload', handleBeforeUnload);
}

// ─── 유틸리티 ────────────────────────────────────

function getAvatar(playerIdOrName, roomData) {
  // 1) 방 데이터에서 커스텀 아바타(이모지) 추출 시도
  if (roomData && roomData.players && roomData.players[playerIdOrName]) {
    const player = roomData.players[playerIdOrName];
    if (player.avatar) return player.avatar;
  }

  // 2) 이모지 문자열 자체가 전달된 경우 바로 반환
  const emojis = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
  if (emojis.includes(playerIdOrName)) return playerIdOrName;

  // 3) 폴백: 문자열 해시 코드를 기반으로 기본 배정
  const nameStr = String(playerIdOrName || '플레이어');
  return emojis[nameStr.charCodeAt(0) % emojis.length] || '🎮';
}

// ─── 중간 이탈자 방출 처리 ────────────────────────
async function leaveGameRoom() {
  if (isLeaving) return;
  isLeaving = true;

  try {
    const roomRef = ref(database, `rooms/${myRoomCode}`);
    const snap = await get(roomRef);
    if (!snap.exists()) {
      redirectToLobby();
      return;
    }

    const room = snap.val();
    const players = room.players || {};
    const playerIds = Object.keys(players);

    // 나를 제외한 남은 플레이어 목록
    const remainingIds = playerIds.filter(id => id !== myPlayerId);

    // 나를 제외한 남은 실제 유저 목록 (봇 제외)
    const remainingHumanIds = remainingIds.filter(id => !id.startsWith('bot_'));

    // 1) 실제 유저가 나 혼자였던 방(싱글 봇전 포함)이면 방 삭제 후 메인으로
    if (remainingHumanIds.length === 0) {
      await remove(roomRef);
      redirectToLobby();
      return;
    }

    const updates = {};

    // 2) 게임 진행 중이었던 경우
    if (room.status === 'playing' && room.gameState) {
      // [★ 2인 이탈] 세션 유지한 채로 대기방으로 함께 이동
      if (playerIds.length === 2) {
        updates[`rooms/${myRoomCode}/status`] = 'waiting';
        updates[`rooms/${myRoomCode}/gameState`] = null;
        updates[`rooms/${myRoomCode}/winnerName`] = null;
        updates[`rooms/${myRoomCode}/winnerPlayerId`] = null;
        updates[`rooms/${myRoomCode}/emotes`] = null;

        // 리스너 전부 해제 후 업데이트 (재초기화 방지)
        cleanupListeners();
        window.removeEventListener('beforeunload', handleBeforeUnload);
        await update(ref(database), updates);

        // 세션(방코드) 유지하여 index.html에서 대기실로 자동 복원
        window.location.href = 'index.html';
        return;
      }

      // 플레이어가 3명 이상일 때 1명이 나가는 경우:
      // 나간 플레이어를 완전히 방에서 삭제하고 세션 파괴, 남은 사람들끼리 진행!
      if (room.host === myPlayerId) {
        updates[`rooms/${myRoomCode}/host`] = remainingIds[0];
      }

      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      updates[`rooms/${myRoomCode}/hands/${myPlayerId}`] = null;
      if (room.emotes && room.emotes[myPlayerId]) {
        updates[`rooms/${myRoomCode}/emotes/${myPlayerId}`] = null;
      }

      const currentGameState = room.gameState;
      const currentOrder = currentGameState.playerOrder ? Object.values(currentGameState.playerOrder) : [];
      const myIndex = currentOrder.indexOf(myPlayerId);

      // 새 playerOrder 구성
      const newOrderList = currentOrder.filter(id => id !== myPlayerId);
      const newPlayerOrder = {};
      newOrderList.forEach((id, i) => {
        newPlayerOrder[i] = id;
      });

      // 현재 턴이 나였다면 다음 생존 플레이어에게 인계
      let nextPlayer = currentGameState.currentPlayer;
      if (currentGameState.currentPlayer === myPlayerId) {
        const dir = currentGameState.direction || 1;
        let nextIdx = (myIndex + dir + currentOrder.length) % currentOrder.length;
        nextPlayer = currentOrder[nextIdx];
        if (!newOrderList.includes(nextPlayer)) {
          nextPlayer = newOrderList[0];
        }
      }

      // handCounts에서 제거
      const newHandCounts = { ...(currentGameState.handCounts || {}) };
      delete newHandCounts[myPlayerId];

      updates[`rooms/${myRoomCode}/gameState/playerOrder`] = newPlayerOrder;
      updates[`rooms/${myRoomCode}/gameState/playerCount`] = newOrderList.length;
      updates[`rooms/${myRoomCode}/gameState/currentPlayer`] = nextPlayer;
      updates[`rooms/${myRoomCode}/gameState/handCounts`] = newHandCounts;
      updates[`rooms/${myRoomCode}/gameState/lastAction`] = {
        type: 'leave',
        playerName: myName,
        message: `🚪 ${myName}님이 게임을 나갔습니다.`,
        timestamp: Date.now()
      };

      await update(ref(database), updates);
      redirectToLobby();
      return;
    }

    // 게임 시작 대기 중이거나 이미 종료된 방에서 나가는 경우
    if (room.host === myPlayerId) {
      await remove(roomRef);
    } else {
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      await update(ref(database), updates);
    }
    redirectToLobby();
  } catch (err) {
    console.error("퇴장 처리 중 오류 발생:", err);
    redirectToLobby();
  }
}

function redirectToLobby(keepSession = false) {
  if (!keepSession) {
    // 완전히 방을 나갈 때는 세션 정리
    sessionStorage.removeItem('uno_room_code');
  }
  window.location.href = 'index.html';
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let floatTimer = null;
function showFloatMsg(text, duration = 1500) {
  let el = document.getElementById('float-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'float-msg';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ─── [★ 유저 잠수 방지 턴 타임아웃 타이머] ────────────────
// 30초간 아무 입력이 없으면 자동으로 카드를 드로우함 (UI에는 아무것도 표시하지 않음)
let turnTimeoutTimer = null;
let turnTimeLeft = 30;

function startTurnTimeoutTimer() {
  // 이미 타이머가 진행 중이라면 중복 시작 방지
  if (turnTimeoutTimer) return;

  turnTimeLeft = 30; // 30초 제한 시간 (화면에는 표시 안함)

  turnTimeoutTimer = setInterval(() => {
    turnTimeLeft--;

    if (turnTimeLeft <= 0) {
      clearInterval(turnTimeoutTimer);
      turnTimeoutTimer = null;
      console.log("[잠수 방지] 30초 제한 시간이 만료되어 자동으로 카드를 드로우합니다.");
      // 조용히 자동으로 카드 드로우 실행 (알림 메시지 없음)
      handleDrawCard();
    }
  }, 1000);
}

function stopTurnTimeoutTimer() {
  if (turnTimeoutTimer) {
    clearInterval(turnTimeoutTimer);
    turnTimeoutTimer = null;
  }
  // 화면에 별도 표시 없음 - 아무것도 바꾸지 않음
}

// updateTurnTimerUI: 화면 미표시 설정으로 빈 함수 유지
function updateTurnTimerUI() {
  // 의도적으로 비워둠 - 남은 시간을 화면에 표시하지 않음
}

// ─── [★ AI 컴퓨터 플레이어 대행 엔진] ────────────────
let activeBotThinkings = {}; // 봇 작동 상태 중복 방지 맵
let botUnoTimersMap = {};    // 봇별 우노 타이머 보관용 맵 { [botId]: timerId }
let botUnoCatchTimer = null; // 봇 우노잡기용 타이머

/** 봇들의 우노잡기 AI 연산 */
function checkBotsUnoCatch() {
  if (!isHost || !gameState || gameState.finished) return;

  // 봇 입장에서 잡을 수 있는 대상(손패가 1장이고 아직 우노를 안 외친 플레이어) 확인
  const catchTarget = getCatchableTargetForBots();
  if (!catchTarget) {
    if (botUnoCatchTimer) {
      clearTimeout(botUnoCatchTimer);
      botUnoCatchTimer = null;
    }
    return;
  }

  // 이미 봇이 우노잡기 실행을 준비 중이라면 중복 타이머 방지
  if (botUnoCatchTimer) return;

  // 봇이 우노잡기 버튼을 누를 때까지의 반응 속도 딜레이 (0.45초 ~ 1.15초로 랜덤 - 50ms 단축)
  // 유저가 이 사이에 먼저 우노 선언을 하거나, 유저가 먼저 우노잡기를 클릭하면 타이머는 무효화됩니다.
  const catchDelay = 450 + Math.random() * 700;

  botUnoCatchTimer = setTimeout(async () => {
    try {
      // 타이머가 동작한 순간, 여전히 상대방이 1장이고 우노를 안 외쳤는지 DB 최신 상태 재조회
      const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
      if (!snap.exists()) return;
      const curState = snap.val();

      const handCounts = curState.handCounts || {};
      const unoCalledBy = curState.unoCalledBy;

      // 여전히 1장인 상태이고 우노가 선언되지 않았는지 체크
      if (handCounts[catchTarget] === 1 && !unoCalledBy && !curState.finished) {
        // 이 방에 있는 봇(컴퓨터) 리스트 가져오기 (단, 잡히는 대상이 봇인 경우 그 봇 자신은 잡기에서 제외)
        const playersRef = ref(database, `rooms/${myRoomCode}/players`);
        const pSnap = await get(playersRef);
        if (!pSnap.exists()) return;
        const players = pSnap.val();

        const botIds = Object.keys(players).filter(id => id.startsWith('bot_') && id !== catchTarget);
        if (botIds.length === 0) return;

        // 살아있는 봇 중 하나가 랜덤하게 우노잡기를 선언한 것으로 처리
        const luckyBotId = botIds[Math.floor(Math.random() * botIds.length)];
        const botName = players[luckyBotId]?.name || '컴퓨터 봇';

        const targetPlayerName = players[catchTarget]?.name || '상대';

        showFloatMsg(`🚨 [우노잡기] 컴퓨터(${botName})가 먼저 잡았습니다! 패널티 +2장!`, 3000);
        playDrawPenalty();

        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          unoPenaltyTarget: catchTarget,
          unoPenaltyTimestamp: Date.now(),
          unoCalledBy: null,
          unoTimestamp: null,
          unoCatchablePlayer: null, // [★ 신규 룰 적용] 봇이 우노잡기를 성공했으므로 대상 만료
          lastAction: {
            type: 'uno_penalty',
            playerName: botName,
            playerId: luckyBotId,
            targetPlayerId: catchTarget,
            targetPlayerName,
            timestamp: Date.now()
          }
        });
      }
    } catch (e) {
      console.error("[AI 우노잡기] 대행 처리 실패:", e);
    } finally {
      botUnoCatchTimer = null;
    }
  }, catchDelay);
}

/** 봇 시점에서의 우노잡기 타겟 검출 */
function getCatchableTargetForBots() {
  if (!gameState) return null;
  const target = gameState.unoCatchablePlayer;
  const unoCalledBy = gameState.unoCalledBy;

  // 1장이 된 직후의 명확한 우노잡기 대상이 존재하고, 아직 우노를 선언하지 않은 경우에만 잡기 허용
  if (target && target !== unoCalledBy) {
    return target;
  }
  return null;
}

function triggerBotTurn(botId) {
  if (!gameState) return;
  const topCard = gameState.discardPile 
    ? (Array.isArray(gameState.discardPile) 
        ? gameState.discardPile[gameState.discardPile.length - 1] 
        : Object.values(gameState.discardPile)[Object.values(gameState.discardPile).length - 1])
    : null;
  const topCardId = topCard ? topCard.id : 'no_card';
  // 봇ID + 버린 더미 탑 카드의 ID + 마지막 액션 타임스탬프를 묶어서 고유 락 키 생성
  const lockKey = `${botId}_${topCardId}_${gameState.lastAction?.timestamp || 0}`;

  // 이미 해당 봇이 이 동일한 게임 상태(턴 및 버린 카드 상태)에서 연산 중이면 무시
  if (activeBotThinkings[lockKey]) return;
  activeBotThinkings[lockKey] = true;

  // 봇의 자연스러운 고민 시간 부여 (2.2초 ~ 4.0초로 느리고 불규칙하게 조절)
  const thinkDelay = 2200 + Math.random() * 1800;

  setTimeout(async () => {
    try {
      await executeBotAction(botId);
    } catch (e) {
      console.error(`[AI ${botId}] 행동 수행 중 에러:`, e);
    } finally {
      // 연산이 완료되거나 실패했을 때 락 해제
      delete activeBotThinkings[lockKey];
    }
  }, thinkDelay);
}

async function executeBotAction(botId) {
  // 최신 게임 상태 확인
  if (!gameState || gameState.currentPlayer !== botId || gameState.finished) return;

  // 1) 봇의 손패 데이터 가져오기
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${botId}`);
  const snap = await get(handRef);
  if (!snap.exists()) return;

  const botHand = Array.isArray(snap.val()) ? snap.val() : Object.values(snap.val());
  const playerIds = Object.values(gameState.playerOrder || {});
  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile : Object.values(gameState.discardPile);
  const topCard = discardArr[discardArr.length - 1];

  // 2) 낼 수 있는 카드들 필터링
  const playableCards = botHand.filter(card => isValidPlay(card, topCard, gameState.currentColor, gameState.drawCount || 0));

  // 3) [낼 카드가 없는 경우] -> 1장 뽑고 다음 사람에게 넘김
  if (playableCards.length === 0) {
    const drawCount = gameState.drawCount > 0 ? gameState.drawCount : 1;
    const deckData = gameState.deck;
    let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
    const drawn = [];

    for (let i = 0; i < drawCount; i++) {
      if (deck.length === 0) {
        const reshuffled = shuffleDeck([...discardArr.slice(0, -1)]);
        deck = reshuffled;
      }
      if (deck.length > 0) {
        drawn.push(deck.shift());
      }
    }

    const newHand = [...botHand, ...drawn];
    const nextPlayer = playerIds[(playerIds.indexOf(botId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];
    const handCounts = { ...(gameState.handCounts || {}) };
    handCounts[botId] = newHand.length;

    const updates = {
      [`rooms/${myRoomCode}/hands/${botId}`]: newHand,
      [`rooms/${myRoomCode}/gameState/deck`]: deck,
      [`rooms/${myRoomCode}/gameState/drawCount`]: 0,
      [`rooms/${myRoomCode}/gameState/currentPlayer`]: nextPlayer,
      [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
      [`rooms/${myRoomCode}/gameState/unoCatchablePlayer`]: null, // [★ 신규 룰 적용] 봇이 드로우를 했으므로 우노잡기 대상 만료
      [`rooms/${myRoomCode}/gameState/lastAction`]: {
        type: drawCount > 1 ? 'draw_penalty' : 'draw_card',
        playerName: `컴퓨터(${roomPlayersCache[botId]?.name || '봇'})`,
        count: drawCount,
        timestamp: Date.now()
      }
    };

    // 만약 봇이 1장 상태였는데 카드를 뽑았다면, 해당 봇의 UNO 선언 자격을 박탈
    if (gameState.unoCalledBy === botId) {
      updates[`rooms/${myRoomCode}/gameState/unoCalledBy`] = null;
      updates[`rooms/${myRoomCode}/gameState/unoTimestamp`] = null;
    }

    await update(ref(database), updates);
    playCardDraw();
    return;
  }

  // 4) [낼 카드가 있는 경우] -> 인공지능 분석기로 최고의 카드 한 장 선정!
  const chosenCard = smartChooseCard(playableCards, botHand);

  // 내 손패에서 제거
  const newHand = botHand.filter(c => c.id !== chosenCard.id);

  // 카드 효과 계산
  const changes = processCardPlay(chosenCard, gameState, botId, playerIds);
  const newDiscardPile = [...discardArr, chosenCard];

  // 와일드 카드면 봇의 손패에 가장 많은 유리한 색상을 똑똑하게 계산해서 세팅!
  let chosenColor = chosenCard.color;
  if (chosenCard.type === CARD_TYPES.WILD || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) {
    chosenColor = botChooseColor(newHand);
  }

  // 덱 재섞기 필요 여부
  const deckData = gameState.deck;
  let newDeck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  if (newDeck.length < 5) {
    const reshuffled = shuffleDeck(newDiscardPile.slice(0, -1));
    newDeck = [...newDeck, ...reshuffled];
  }

  // 다음 플레이어 결정
  let nextPlayer = changes.nextPlayer
    || playerIds[(playerIds.indexOf(botId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  const newDrawCount = changes.drawCount;
  const newDirection = changes.reverseDirection ? -(gameState.direction || 1) : (gameState.direction || 1);
  const hasWon = newHand.length === 0;

  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[botId] = newHand.length;

  const updates = {
    [`rooms/${myRoomCode}/hands/${botId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/discardPile`]: newDiscardPile,
    [`rooms/${myRoomCode}/gameState/deck`]: newDeck,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: hasWon ? botId : nextPlayer,
    [`rooms/${myRoomCode}/gameState/currentColor`]: chosenColor,
    [`rooms/${myRoomCode}/gameState/direction`]: newDirection,
    [`rooms/${myRoomCode}/gameState/drawCount`]: newDrawCount,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: 'play_card',
      playerName: roomPlayersCache[botId]?.name || '봇',
      playerId: botId,
      card: chosenCard,
      timestamp: Date.now()
    }
  };

  // [★ 신규 룰 적용] 봇이 2장에서 1장으로 줄어든 경우 우노잡기 타겟으로 지정, 그 외에는 우노잡기 대상 만료
  if (newHand.length === 1 && !hasWon) {
    updates[`rooms/${myRoomCode}/gameState/unoCatchablePlayer`] = botId;
  } else {
    updates[`rooms/${myRoomCode}/gameState/unoCatchablePlayer`] = null;
  }

  if (hasWon) {
    updates[`rooms/${myRoomCode}/gameState/finished`] = true;
    updates[`rooms/${myRoomCode}/gameState/winner`] = botId;
    updates[`rooms/${myRoomCode}/status`] = 'finished';
    updates[`rooms/${myRoomCode}/winnerName`] = roomPlayersCache[botId]?.name || '봇';
    updates[`rooms/${myRoomCode}/winnerPlayerId`] = botId;
  }

  // 5) [🔔 중요: 봇의 우노(UNO) 타이밍 설계]
  // 봇의 손패가 2장에서 정확히 1장이 되는 순간(즉, 카드를 낼 때만), 봇은 스스로 '우노!'를 외치게 타이머를 작동합니다.
  // 이 시간 윈도우 이내에 유저가 재빨리 '우노 잡기!' 버튼을 누르면 봇의 우노가 잡힙니다!
  if (botHand.length === 2 && newHand.length === 1 && !hasWon) {
    // 이전 이 봇의 예약된 타이머 정리
    if (botUnoTimersMap[botId]) {
      clearTimeout(botUnoTimersMap[botId]);
      delete botUnoTimersMap[botId];
    }

    // 0.35초 ~ 0.85초 뒤 봇의 우노 자동 등록 (무작위 지연 적용 - 50ms 단축)
    const unoDelay = 350 + Math.random() * 500;
    botUnoTimersMap[botId] = setTimeout(async () => {
      // 그 사이에 다른 사람에게 잡히지 않고, 봇이 여전히 1장 손패를 들고 있다면
      const currentSnap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
      if (!currentSnap.exists()) return;
      const curState = currentSnap.val();
      
      if (curState.handCounts && curState.handCounts[botId] === 1 && !curState.unoCalledBy) {
        // [원자적 트랜잭션 적용] 봇의 우노 등록도 동시에 일어날 수 있으므로 runTransaction 사용
        const gameRef = ref(database, `rooms/${myRoomCode}/gameState`);
        try {
          const result = await runTransaction(gameRef, (currentData) => {
            if (!currentData) return currentData;

            // 이미 잡혔거나 다른 사람이 먼저 선언했으면 롤백
            if (currentData.unoPenaltyTarget || currentData.unoCalledBy) {
              return; // Abort
            }

            currentData.unoCalledBy = botId;
            currentData.unoTimestamp = Date.now();
            currentData.unoCatchablePlayer = null; // [★ 신규 룰 적용] 우노를 정상 선언했으므로 우노잡기 대상 만료
            currentData.lastAction = {
              type: 'uno_call',
              playerName: roomPlayersCache[botId]?.name || '봇',
              playerId: botId,
              timestamp: Date.now()
            };

            return currentData;
          });

          if (result.committed) {
            playUnoCall();
            showFloatMsg(`🔔 컴퓨터(${roomPlayersCache[botId]?.name || '봇'})가 '우노!'를 먼저 외쳤습니다!`, 2000);
          }
        } catch (err) {
          console.error("[봇 우노 선언] 트랜잭션 에러:", err);
        }
      }
      
      // 타이머 완료 후 맵에서 제거
      delete botUnoTimersMap[botId];
    }, unoDelay); // 유저가 잡을 수 있는 시간차 (0.7~1.3초 랜덤)
  }

  await update(ref(database), updates);
  playCardPlay();

  if (chosenCard.type === CARD_TYPES.WILD || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) playWild();
  if (chosenCard.type === CARD_TYPES.DRAW_TWO || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) playDrawPenalty();
  if (hasWon) playLose(); // 봇이 이기면 유저는 패배 효과음
}

/** 
 * 똑똑한 카드 선별 인공지능 분석기 
 * - 상대(특히 유저) 손패가 1~3장이면 공격 카드를 우선적으로 날림!
 * - 비장의 무기인 와일드 카드(WILD, WILD_DRAW_FOUR)는 평상시에는 손에 아껴두고 일반 카드를 먼저 냅니다.
 * - 단, 상대방이 3장 이하로 남았거나 자신이 곧 끝낼 수 있는 상황(손패 2장 이하)일 때는 아끼지 않고 냅니다!
 */
function smartChooseCard(playableCards, hand) {
  if (playableCards.length === 1) return playableCards[0];

  // 다른 플레이어들의 최소 손패 개수 확인
  let minOpponentCards = 99;
  if (gameState && gameState.handCounts) {
    for (const [pid, count] of Object.entries(gameState.handCounts)) {
      if (pid !== gameState.currentPlayer) {
        minOpponentCards = Math.min(minOpponentCards, count);
      }
    }
  }

  // 내(봇) 현재 손패 개수
  const myHandCount = hand.length;

  // 상대방이 3장 이하인 위급 상황인가?
  const isEmergency = minOpponentCards <= 3;
  // 게임 후반부이거나 내가 곧 끝낼 수 있는 상황인가? (내 패가 2장 이하)
  const isEndGame = myHandCount <= 2;

  // 1) 위급 상황(공격 필요) 시 강력한 공격 카드를 우선적으로 투척 (+4, +2, Skip 순)
  if (isEmergency) {
    const d4 = playableCards.find(c => c.type === CARD_TYPES.WILD_DRAW_FOUR);
    if (d4) return d4;
    const d2 = playableCards.find(c => c.type === CARD_TYPES.DRAW_TWO);
    if (d2) return d2;
    const skip = playableCards.find(c => c.type === CARD_TYPES.SKIP);
    if (skip) return skip;
  }

  // 2) 평상시(위급 상황이 아니거나, 공격 카드가 없는 경우):
  // 범용성이 최고인 와일드 카드(WILD, WILD_DRAW_FOUR)는 평상시 일반 카드가 낼 수 있는 게 
  // 단 하나라도 있다면 아껴두고 일반 카드를 우선적으로 냅니다.
  const nonWildPlayables = playableCards.filter(c => c.type !== CARD_TYPES.WILD && c.type !== CARD_TYPES.WILD_DRAW_FOUR);

  // 평상시이고 일반 카드 중 낼 수 있는 카드가 존재하며, 아직 봇 자신의 후반(2장 이하)이 아니라면 일반 카드를 우선 선정
  const targetPool = (nonWildPlayables.length > 0 && !isEndGame) ? nonWildPlayables : playableCards;

  // 대상 풀 중에서 리스크 점수가 높은 카드(숫자가 크거나 액션 카드) 순으로 방출하여 벌점 리스크 회피
  return targetPool.reduce((bestCard, card) => {
    const getWeight = (c) => {
      if (c.type === CARD_TYPES.WILD_DRAW_FOUR || c.type === CARD_TYPES.WILD) return 50;
      if (c.type === CARD_TYPES.DRAW_TWO || c.type === CARD_TYPES.SKIP || c.type === CARD_TYPES.REVERSE) return 20;
      return c.value || 0;
    };
    return getWeight(card) > getWeight(bestCard) ? card : bestCard;
  }, targetPool[0]);
}

/**
 * 봇의 영리한 와일드 카드 색상 변경 선택기
 * 봇이 쥐고 있는 손패 중 "가장 많이 분포한 색상"을 조사해서 똑똑하게 선언함
 */
function botChooseColor(botHand) {
  if (!botHand || botHand.length === 0) return 'red';

  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  botHand.forEach(card => {
    if (counts[card.color] !== undefined) counts[card.color]++;
  });

  // 가장 빈도가 높은 색상 리턴
  let bestColor = 'red';
  let maxCount = -1;
  for (const [color, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestColor = color;
    }
  }
  return bestColor;
}

// 봇이 동작할 때 플레이어 캐시 맵 갱신을 위해 전역 캐시 갱신 로직 추가
let roomPlayersCache = {};
const originalUpdatePlayerSidebars = updatePlayerSidebars;
updatePlayerSidebars = function(room) {
  if (room && room.players) roomPlayersCache = room.players;
  originalUpdatePlayerSidebars(room);
};


// ─── 방 코드 표시 및 클릭 시 숨기기 토글 ───
document.addEventListener('DOMContentLoaded', () => {
  const codeEl = document.getElementById('header-room-code');
  if (codeEl) {
    const params = new URLSearchParams(window.location.search);
    const rCode = params.get('room') || sessionStorage.getItem('uno_room_code') || '';
    let isHidden = false;
    const renderCode = () => {
      codeEl.textContent = isHidden ? '•••••• 👁️' : `${rCode} 🔒`;
    };
    renderCode();
    codeEl.style.cursor = 'pointer';
    codeEl.title = '클릭하여 방 코드 숨기기/보기';
    codeEl.addEventListener('click', () => {
      isHidden = !isHidden;
      renderCode();
    });
  }
});


})();