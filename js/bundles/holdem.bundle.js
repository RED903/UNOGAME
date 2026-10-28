// ─── HOLDEM BUNDLE (Non-module Standalone) ───
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


// ─── Dependency: holdem-rules.js ───

// ═══════════════════════════════════════════════════
// 텍사스 홀덤 포커 룰 엔진
// Fixed Limit 베팅 방식, 핸드 평가, 승자 결정
// ═══════════════════════════════════════════════════

// ─── 카드 생성 ─────────────────────────────────────

/** 52장 표준 덱 생성 */
function createDeck() {
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, id: `${rank}_${suit}` });
    }
  }
  return deck;
}

/** 덱 셔플 (Fisher-Yates) */
function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ─── 핸드 평가 ─────────────────────────────────────

// 랭크 값 (높을수록 강함)
const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// 핸드 랭킹 점수 (높을수록 강함)
const HAND_RANKS = {
  ROYAL_FLUSH: 9,
  STRAIGHT_FLUSH: 8,
  FOUR_OF_A_KIND: 7,
  FULL_HOUSE: 6,
  FLUSH: 5,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR: 2,
  ONE_PAIR: 1,
  HIGH_CARD: 0
};

const HAND_NAMES_KR = {
  ROYAL_FLUSH: '로열 플러시',
  STRAIGHT_FLUSH: '스트레이트 플러시',
  FOUR_OF_A_KIND: '포카드',
  FULL_HOUSE: '풀하우스',
  FLUSH: '플러시',
  STRAIGHT: '스트레이트',
  THREE_OF_A_KIND: '쓰리카드',
  TWO_PAIR: '투 페어',
  ONE_PAIR: '원 페어',
  HIGH_CARD: '하이카드'
};

/**
 * 7장(홀 카드 2장 + 커뮤니티 5장)에서 최강 5장 핸드를 찾아 평가
 * @returns { rank, name, score, bestFive } 
 */
function evaluateBestHand(holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) return null;

  // 가능한 모든 5장 조합을 확인
  const combos = combinations(allCards, 5);
  let best = null;

  for (const combo of combos) {
    const result = evaluateHand(combo);
    if (!best || compareHandScore(result.score, best.score) > 0) {
      best = { ...result, bestFive: combo };
    }
  }

  return best;
}

/**
 * 정확히 5장의 카드로 핸드 평가
 */
function evaluateHand(cards) {
  const rankCounts = {};
  const suitCounts = {};
  const rankValsSorted = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);

  for (const card of cards) {
    rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
  }

  const isFlush = Object.values(suitCounts).some(c => c === 5);
  const isStraight = checkStraight(rankValsSorted);
  const groups = Object.values(rankCounts).sort((a, b) => b - a); // 내림차순 그룹

  // 오름차순 정렬 (타이브레이킹 및 로열플러시 판별용)
  const rankValsSortedAsc = [...rankValsSorted].reverse();

  let handType;

  if (isFlush && isStraight && rankValsSorted[0] === 14 && rankValsSortedAsc[0] === 10) {
    // 로열플러시: 플러시 + 스트레이트 + 최솟값이 10 (= 10-J-Q-K-A)
    handType = 'ROYAL_FLUSH';
  } else if (isFlush && isStraight) {
    handType = 'STRAIGHT_FLUSH';
  } else if (groups[0] === 4) {
    handType = 'FOUR_OF_A_KIND';
  } else if (groups[0] === 3 && groups[1] === 2) {
    handType = 'FULL_HOUSE';
  } else if (isFlush) {
    handType = 'FLUSH';
  } else if (isStraight) {
    handType = 'STRAIGHT';
  } else if (groups[0] === 3) {
    handType = 'THREE_OF_A_KIND';
  } else if (groups[0] === 2 && groups[1] === 2) {
    handType = 'TWO_PAIR';
  } else if (groups[0] === 2) {
    handType = 'ONE_PAIR';
  } else {
    handType = 'HIGH_CARD';
  }

  // 점수 배열: [핸드랭크, ...타이브레이킹 값들]
  const score = buildScore(handType, cards, rankCounts, rankValsSorted);

  return {
    rank: HAND_RANKS[handType],
    name: HAND_NAMES_KR[handType],
    handType,
    score
  };
}

/** 스트레이트 체크 (A-2-3-4-5 휠도 포함) */
function checkStraight(vals) {
  // 일반 스트레이트
  if (vals[0] - vals[4] === 4 && new Set(vals).size === 5) return true;
  // 휠 (A-2-3-4-5): 14, 5, 4, 3, 2
  if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) return true;
  return false;
}

/** 타이브레이킹을 위한 점수 배열 생성 */
function buildScore(handType, cards, rankCounts, sortedVals) {
  const base = [HAND_RANKS[handType]];

  // 그룹 수(카운트)가 많은 순서로 카드 랭크 값을 나열
  const byGroup = Object.entries(rankCounts)
    .sort((a, b) => b[1] - a[1] || RANK_VALUES[b[0]] - RANK_VALUES[a[0]])
    .map(([rank]) => RANK_VALUES[rank]);

  return [...base, ...byGroup];
}

/** 두 점수 배열 비교 (양수: a가 강함, 음수: b가 강함) */
function compareHandScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** n개에서 k개 조합 */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(combo => [first, ...combo]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ─── 승자 결정 ─────────────────────────────────────

/**
 * 쇼다운: 활성 플레이어들의 핸드를 비교하여 승자 반환
 * @param {Object} playerHands - { playerId: [holeCard1, holeCard2] }
 * @param {Array} communityCards - 커뮤니티 카드 최대 5장
 * @returns { winners, handResults }
 */
function determineWinners(playerHands, communityCards) {
  const handResults = {};
  let best = null;

  for (const [pid, holeCards] of Object.entries(playerHands)) {
    if (!holeCards || holeCards.length < 2) continue;
    const result = evaluateBestHand(holeCards, communityCards);
    if (!result) continue;
    handResults[pid] = result;

    if (!best || compareHandScore(result.score, best.score) > 0) {
      best = result;
    }
  }

  // 최고 점수를 공유하는 모든 플레이어 (타이 허용)
  const winners = Object.entries(handResults)
    .filter(([, r]) => compareHandScore(r.score, best.score) === 0)
    .map(([pid]) => pid);

  return { winners, handResults };
}

// ─── Fixed Limit 베팅 유틸 ────────────────────────

/**
 * 현재 베팅 단계에서의 고정 베팅 단위 반환
 * @param {'preflop'|'flop'|'turn'|'river'} phase
 */
function getBetUnit(phase) {
  if (phase === 'turn' || phase === 'river') return 2; // 빅벳
  return 1; // 스몰벳 (프리플랍, 플랍)
}

const MAX_RAISES_PER_ROUND = 3; // 한 라운드 최대 레이즈 횟수
const INITIAL_CHIPS = 200;       // 초기 지급 칩
const SMALL_BLIND = 1;
const BIG_BLIND = 2;


// ─── Dependency: holdem-renderer.js ───

// ═══════════════════════════════════════════════════
// 텍사스 홀덤 카드 렌더러
// SVG 기반 포커 카드 시각화
// ═══════════════════════════════════════════════════

// 슈트 심볼 및 색상
const SUIT_SYMBOL = {
  spades:   '♠',
  hearts:   '♥',
  diamonds: '♦',
  clubs:    '♣'
};

const SUIT_COLOR = {
  spades:   '#1a1a2e',
  hearts:   '#e8003d',
  diamonds: '#e8003d',
  clubs:    '#1a1a2e'
};

/**
 * 포커 카드 SVG 렌더링 (앞면)
 * @param {Object} card - { rank, suit }
 * @param {Object} opts - { width, height, selected, highlight }
 */
function renderPokerCardSVG(card, opts = {}) {
  const { width = 80, height = 115, selected = false, highlight = false } = opts;
  const sym = SUIT_SYMBOL[card.suit];
  const col = SUIT_COLOR[card.suit];
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  const bgColor = selected ? '#2a2a5a' : '#FAFAFA';
  const borderColor = selected ? '#6060FF' : (highlight ? '#FFD900' : '#ddd');
  const glowFilter = highlight ? `filter="url(#winGlow)"` : '';

  const rx = Math.round(width * 0.1);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
    xmlns="http://www.w3.org/2000/svg" style="display:block; border-radius:${rx}px;">
    <defs>
      <filter id="winGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
    <!-- 카드 배경 -->
    <rect width="${width}" height="${height}" rx="${rx}" ry="${rx}"
      fill="${bgColor}" stroke="${borderColor}" stroke-width="${highlight ? 3 : 1.5}" ${glowFilter}/>

    <!-- 좌상단 랭크 + 슈트 -->
    <text x="6" y="18" font-family="Georgia, serif" font-size="${Math.round(width * 0.22)}"
      font-weight="bold" fill="${col}">${card.rank}</text>
    <text x="6" y="32" font-family="Georgia, serif" font-size="${Math.round(width * 0.18)}"
      fill="${col}">${sym}</text>

    <!-- 중앙 큰 슈트 심볼 -->
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
      font-family="Georgia, serif" font-size="${Math.round(width * 0.42)}"
      fill="${col}" opacity="0.85">${sym}</text>

    <!-- 우하단 랭크 + 슈트 (180도 회전) -->
    <g transform="rotate(180, ${width/2}, ${height/2})">
      <text x="6" y="18" font-family="Georgia, serif" font-size="${Math.round(width * 0.22)}"
        font-weight="bold" fill="${col}">${card.rank}</text>
      <text x="6" y="32" font-family="Georgia, serif" font-size="${Math.round(width * 0.18)}"
        fill="${col}">${sym}</text>
    </g>
  </svg>`;
}

/**
 * 카드 뒷면 SVG 렌더링
 */
function renderCardBack(opts = {}) {
  const { width = 80, height = 115 } = opts;
  const rx = Math.round(width * 0.1);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
    xmlns="http://www.w3.org/2000/svg" style="display:block; border-radius:${rx}px;">
    <defs>
      <pattern id="bp" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill="#1a3a6a"/>
        <rect x="0" y="0" width="7" height="7" fill="#1e4585" opacity="0.6"/>
        <rect x="7" y="7" width="7" height="7" fill="#1e4585" opacity="0.6"/>
      </pattern>
      <clipPath id="cardClip">
        <rect width="${width}" height="${height}" rx="${rx}" ry="${rx}"/>
      </clipPath>
    </defs>
    <!-- 카드 배경 -->
    <rect width="${width}" height="${height}" rx="${rx}" ry="${rx}"
      fill="#1a3a6a" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
    <!-- 격자 패턴 -->
    <rect width="${width}" height="${height}" fill="url(#bp)" clip-path="url(#cardClip)"/>
    <!-- 테두리 이중선 -->
    <rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="${rx - 2}"
      fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
    <!-- 중앙 로고 -->
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
      font-family="Georgia, serif" font-size="${Math.round(width * 0.28)}"
      fill="rgba(255,255,255,0.5)">🂠</text>
  </svg>`;
}

/**
 * 슈트 심볼 반환
 */
function getSuitSymbol(suit) {
  return SUIT_SYMBOL[suit] || suit;
}

/**
 * 슈트 색상 반환
 */
function getSuitColor(suit) {
  return SUIT_COLOR[suit] || '#000';
}

/**
 * 카드 표시 문자열 (예: A♠, K♥)
 */
function cardToString(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}


// ─── Dependency: holdem-init.js ───

// 홀덤 라운드 초기화 (로비·게임 화면 공용)

// [import removed]
// [import removed]

const INITIAL_LIVES = 3; // 목숨 초기 개수

function getStartingChips(n) {
  if (n <= 4) return 250;
  if (n <= 7) return 500;
  return 750;
}

function asArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') {
    return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
  }
  return [];
}

const HOLDEM_PHASES = new Set(['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown']);

/** UNO 등 다른 게임의 gameState와 구분 */
function isHoldemGameState(gs) {
  if (!gs || typeof gs !== 'object') return false;
  if (!gs.phase || !HOLDEM_PHASES.has(gs.phase)) return false;
  return asArray(gs.playerOrder).length > 0 && gs.chipCounts && typeof gs.chipCounts === 'object';
}

/** 호스트가 새 라운드를 자동 시작해야 하는지 */
function shouldStartHoldemRound(gs) {
  if (!gs) return true;
  if (!isHoldemGameState(gs)) return true;
  if (gs.phase === 'waiting') return true;
  return false;
}

/**
 * 새 홀덤 라운드 시작. 성공 시 true, 인원 부족 등으로 스킵 시 false.
 */
async function startHoldemRound(roomCode, room) {
  const players = room.players || {};
  const allPlayerIds = Object.keys(players);
  if (allPlayerIds.length < 2) return false;

  const prevGs = room.gameState || {};
  const n = allPlayerIds.length;
  const startChips = getStartingChips(n);

  const prevChips = prevGs.chipCounts || {};
  const prevLives = prevGs.lives || {};
  const prevEliminated = prevGs.eliminated || {};

  // ─── 목숨 및 칩 처리 ───────────────────────────
  const lives = {};
  const chipCounts = {};
  const eliminated = { ...prevEliminated };

  for (const pid of allPlayerIds) {
    // 이미 탈락한 플레이어는 건너뜀
    if (eliminated[pid]) continue;

    // prevChips[pid]가 undefined이면 한 번도 칩을 받은 적 없는 신규(첫 라운드)
    // prevChips[pid]가 명시적으로 0이면 이번 라운드에서 칩을 다 잃은 것
    const isFirstGame = prevChips[pid] === undefined;
    const curChips = prevChips[pid] ?? 0;
    const curLives = prevLives[pid] ?? INITIAL_LIVES;

    if (isFirstGame || curChips > 0) {
      // 첫 게임이거나 칩이 남아있으면 그대로 유지 (신규는 초기 칩 지급)
      chipCounts[pid] = curChips > 0 ? curChips : startChips;
      lives[pid] = curLives;
    } else {
      // 이전 라운드에서 칩이 있었는데 0이 됨 → 목숨 1개 소모
      const newLives = curLives - 1;
      if (newLives <= 0) {
        // 목숨 0 → 완전 탈락
        eliminated[pid] = true;
        lives[pid] = 0;
        chipCounts[pid] = 0;
      } else {
        // 목숨 차감 후 칩 재지급
        lives[pid] = newLives;
        chipCounts[pid] = startChips;
      }
    }
  }

  // 탈락자를 제외한 실제 게임 참가자 목록
  const playerIds = allPlayerIds.filter(pid => !eliminated[pid]);

  // 생존자가 1명 이하면 게임 종료 조건 (더 이상 라운드 불가)
  if (playerIds.length < 2) return false;

  const prevDealer = prevGs.dealerIndex ?? -1;
  const dealerIndex = (prevDealer + 1) % playerIds.length;

  const deck = shuffleDeck(createDeck());
  const handUpdates = {};
  const usedCardIds = [];
  for (const pid of playerIds) {
    const cards = [deck.shift(), deck.shift()];
    handUpdates[`rooms/${roomCode}/hands/${pid}`] = cards;
    usedCardIds.push(...cards.map(c => c.id));
  }

  // 블라인드 포스팅 로직 (스몰 블라인드 2, 빅 블라인드 5)
  const currentBets = {};
  for (const pid of playerIds) {
    currentBets[pid] = 0;
  }

  let pot = 0;
  const sbAmount = 2;
  const bbAmount = 5;

  let sbPlayerId, bbPlayerId;
  if (playerIds.length === 2) {
    // 2인 헤즈업: 딜러가 SB, 다른 사람이 BB
    sbPlayerId = playerIds[dealerIndex];
    bbPlayerId = playerIds[(dealerIndex + 1) % 2];
  } else {
    // 3인 이상: 딜러 다음 사람이 SB, 그 다음 사람이 BB
    sbPlayerId = playerIds[(dealerIndex + 1) % playerIds.length];
    bbPlayerId = playerIds[(dealerIndex + 2) % playerIds.length];
  }

  // SB 포스팅 (남은 칩이 부족하면 올인)
  const sbChips = chipCounts[sbPlayerId] ?? 0;
  const sbPaid = Math.min(sbChips, sbAmount);
  chipCounts[sbPlayerId] = sbChips - sbPaid;
  currentBets[sbPlayerId] = sbPaid;
  pot += sbPaid;

  // BB 포스팅 (남은 칩이 부족하면 올인)
  const bbChips = chipCounts[bbPlayerId] ?? 0;
  const bbPaid = Math.min(bbChips, bbAmount);
  chipCounts[bbPlayerId] = bbChips - bbPaid;
  currentBets[bbPlayerId] = bbPaid;
  pot += bbPaid;

  // 프리플랍 액터 순서 결정 (BB 다음 사람부터 시작)
  let bbIdx = playerIds.indexOf(bbPlayerId);
  const firstActorIdx = (bbIdx + 1) % playerIds.length;
  const actorOrder = [];
  for (let i = 0; i < playerIds.length; i++) {
    actorOrder.push(playerIds[(firstActorIdx + i) % playerIds.length]);
  }

  // 목숨이 차감된 플레이어 목록 생성 (표시용)
  const lifeChangedPids = allPlayerIds.filter(pid =>
    (prevLives[pid] ?? INITIAL_LIVES) !== (lives[pid] ?? INITIAL_LIVES)
  );
  const lifeDetail = lifeChangedPids.length > 0
    ? ` | 목숨 차감: ${lifeChangedPids.map(pid => `${players[pid]?.name || pid} (남은 목숨: ❤️×${lives[pid]})`).join(', ')}`
    : '';

  const newGs = {
    phase: 'preflop',
    playerOrder: playerIds,
    actorOrder,
    currentActor: actorOrder[0],
    phaseActed: {},
    chipCounts,
    lives,
    eliminated,
    folded: {},
    pot,
    communityCards: [],
    dealerIndex,
    currentBet: bbAmount,
    currentBets,
    raiseCount: 0,
    usedCardIds,
    phaseComplete: false,
    finished: false,
    winner: null,
    winnerHand: null,
    showdownData: null,
    lastAction: {
      type: 'deal',
      playerName: '딜러',
      amount: 0,
      detail: `게임 시작! 블라인드 지불 (SB: ${sbPaid}, BB: ${bbPaid})${lifeDetail}`,
      timestamp: Date.now()
    }
  };

  await update(ref(database), {
    [`rooms/${roomCode}/gameState`]: newGs,
    ...handUpdates
  });

  return true;
}



// ─── Main: holdem.js ───

// ═══════════════════════════════════════════════════
// 텍사스 홀덤 포커 - 기본 고정 리밋 베팅 시스템
// ═══════════════════════════════════════════════════

// [import removed]
// [import removed]
// [import removed]
// [import removed]

// ─── 상수 ──────────────────────────────────────────

const PHASE_ORDER  = ['preflop', 'flop', 'turn', 'river'];
const PHASE_NAMES  = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운' };

/** Firebase가 배열을 객체로 저장한 경우 대비 */
function asArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') {
    return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
  }
  return [];
}

function getPlayerOrder(gs) {
  return asArray(gs?.playerOrder);
}

function getActorOrder(state) {
  const order = asArray(state?.actorOrder);
  return order.length ? order : getPlayerOrder(state);
}

/** 이번 단계 고정 베팅 단위 (프리플랍/플랍: 5, 턴/리버: 10) */
function getBetUnit(phase) {
  return (phase === 'preflop' || phase === 'flop') ? 5 : 10;
}

/** 이번 단계에서 해당 플레이어가 아직 내야 할 칩 */
function getBetOwed(gs, pid) {
  const target = gs.currentBet ?? 0;
  const paid = gs.currentBets?.[pid] ?? 0;
  return Math.max(0, target - paid);
}

function payBet(chips, pid, amount) {
  const balance = chips[pid] ?? 0;
  if (balance < amount) return false;
  chips[pid] = balance - amount;
  return true;
}

/** 이번 단계에서 행동이 필요한 상태인지 */
function canActThisTurn(state, pid) {
  if (state.folded?.[pid]) return false;
  if ((state.chipCounts?.[pid] ?? 0) <= 0) return false; // 올인한 플레이어는 액션 불가
  if (getBetOwed(state, pid) > 0) return true;
  return !state.phaseActed?.[pid];
}

/** 베팅 라운드 종료 조건 체크 */
function isBettingRoundComplete(state) {
  const order = getPlayerOrder(state);
  const active = order.filter(pid => !state.folded?.[pid]);
  
  // 살아있고 칩이 남아있는 플레이어
  const activeWithChips = active.filter(pid => (state.chipCounts?.[pid] ?? 0) > 0);
  
  // 만약 칩이 있는 플레이어가 1명 이하이면 베팅 불가하므로 즉시 종료
  if (activeWithChips.length <= 1) {
    return true;
  }

  for (const pid of active) {
    if ((state.chipCounts?.[pid] ?? 0) <= 0) continue; // 올인은 제외
    if (!state.phaseActed?.[pid]) return false;
    if (getBetOwed(state, pid) > 0) return false;
  }
  return true;
}

// ─── 상태 변수 ─────────────────────────────────────

let myPlayerId    = null;
let myRoomCode    = null;
let isHost        = false;
let isNavigatingToLobby = false; // 대기실 복귀 중인지 여부 플래그
let gs            = null;   // 현재 게임 상태
let myHoleCards   = [];
let roomPlayersCache = {};
const unsubList   = [];
let hostTimer     = null;
let startRetryTimer = null;
let prevCommLen   = 0;      // 이전에 표시된 커뮤니티 카드 수
let lastLogTs     = 0;

// ─── 사운드 (Web Audio API) ─────────────────────────

const _AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new _AudioCtx();
  return audioCtx;
}

function _tone(freq, dur, type = 'sine', vol = 0.25) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}

const SFX = {
  deal:      () => { _tone(440, 0.07, 'triangle', 0.12); setTimeout(() => _tone(580, 0.07, 'triangle', 0.09), 70); },
  stay:      () => { _tone(523, 0.1, 'sine', 0.18); },
  fold:      () => { _tone(220, 0.18, 'triangle', 0.14); },
  snap:      () => { _tone(880, 0.06, 'square', 0.22); setTimeout(() => _tone(1100, 0.06, 'square', 0.18), 55); setTimeout(() => _tone(1320, 0.1, 'square', 0.14), 110); },
  snapCall:  () => { _tone(660, 0.1, 'sine', 0.2); _tone(880, 0.1, 'sine', 0.15); },
  chip:      () => { _tone(900, 0.04, 'triangle', 0.08); },
  win:       () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => _tone(f, 0.22, 'sine', 0.18), i * 110)); },
  nextPhase: () => { _tone(350, 0.05, 'triangle', 0.1); setTimeout(() => _tone(500, 0.08, 'triangle', 0.1), 80); }
};

// ─── 초기화 ─────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  document.addEventListener('click', () => {
    try { getAudioCtx().resume(); } catch (e) {}
  }, { once: true });

  const params = new URLSearchParams(window.location.search);
  myRoomCode = params.get('room');
  myPlayerId = params.get('player') || sessionStorage.getItem('uno_player_id');

  if (!myRoomCode || !myPlayerId) { window.location.href = 'index.html'; return; }

  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) { window.location.href = 'index.html'; return; }
  const room = roomSnap.val();
  isHost = room.host === myPlayerId;
  roomPlayersCache = room.players || {};

  setupListeners();
  setupButtons();
  initEmotePanel();
  window.addEventListener('beforeunload', handleBeforeUnload);

  if (isHost) {
    const existingGs = (await get(ref(database, `rooms/${myRoomCode}/gameState`))).val();
    if (shouldStartHoldemRound(existingGs)) {
      scheduleStartNewRound(400);
    }
  }
});

// ─── Firebase 리스닝 ─────────────────────────────────

function setupListeners() {
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const u0 = onValue(roomRef, snap => {
    if (!snap.exists()) return;
    const room = snap.val();
    roomPlayersCache = room.players || {};
    isHost = room.host === myPlayerId;

    // 대기실 복귀 감지 및 처리
    if (room.status === 'waiting') {
      isNavigatingToLobby = true;
      unsubList.forEach(u => { try { u(); } catch (e) {} });
      unsubList.length = 0;
      clearTimeout(hostTimer);
      clearTimeout(startRetryTimer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.location.href = 'index.html';
      return;
    }

    const backLobbyBtn = document.getElementById('btn-back-lobby');
    const backLobbySdBtn = document.getElementById('btn-back-lobby-sd');
    if (backLobbyBtn) backLobbyBtn.style.display = isHost ? 'block' : 'none';
    if (backLobbySdBtn) backLobbySdBtn.style.display = isHost ? 'block' : 'none';

    if (gs) renderOpponents();
  });
  unsubList.push(u0);

  // 게임 상태 리스닝
  const gsRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const u1 = onValue(gsRef, snap => {
    if (!snap.exists()) {
      gs = null;
      if (isHost) scheduleStartNewRound(600);
      return;
    }
    gs = snap.val();

    const newLen = (gs.communityCards || []).length;
    const commAdded = newLen > prevCommLen;
    renderAll(commAdded ? prevCommLen : -1);
    if (commAdded) { SFX.deal(); SFX.nextPhase(); }
    prevCommLen = newLen;

    appendLogIfNew(gs.lastAction);

    if (isHost && shouldStartHoldemRound(gs)) {
      scheduleStartNewRound(600);
      return;
    }

    if (isHost && gs && !gs.finished) {
      scheduleHostActions();
    }
  });
  unsubList.push(u1);

  // 내 홀 카드 리스닝
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${myPlayerId}`);
  const u2 = onValue(handRef, snap => {
    if (!snap.exists()) { myHoleCards = []; renderMyHand(); return; }
    const val = snap.val();
    myHoleCards = Array.isArray(val) ? val : Object.values(val);
    renderMyHand();
    if (myHoleCards.length === 2) SFX.deal();
  });
  unsubList.push(u2);

  // 감정표현 리스닝
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  const uEmote = onValue(emoteRef, snap => {
    if (!snap.exists()) return;
    const emotes = snap.val();
    Object.entries(emotes).forEach(([pid, data]) => {
      if (pid !== myPlayerId && data && data.emote) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });
  unsubList.push(uEmote);
}

// ─── 버튼 이벤트 ────────────────────────────────────

function setupButtons() {
  document.getElementById('btn-stay')?.addEventListener('click', () => playerAction('stay'));
  document.getElementById('btn-fold')?.addEventListener('click', () => playerAction('fold'));
  document.getElementById('btn-snap')?.addEventListener('click', () => playerAction('snap'));
  document.getElementById('btn-next-round')?.addEventListener('click', handleNextRound);
  document.getElementById('btn-leave')?.addEventListener('click', handleLeave);
  document.getElementById('btn-back-lobby')?.addEventListener('click', handleBackToLobby);
  document.getElementById('btn-back-lobby-sd')?.addEventListener('click', handleBackToLobby);
}

// ─── 새 라운드 시작 (호스트만) ──────────────────────

function scheduleStartNewRound(delayMs = 600) {
  if (!isHost) return;
  clearTimeout(startRetryTimer);
  startRetryTimer = setTimeout(() => startNewRound(), delayMs);
}

async function startNewRound(force = false) {
  if (!isHost) return;

  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) return;
  const room = roomSnap.val();
  roomPlayersCache = room.players || {};

  const existingGs = room.gameState || null;
  if (!force && !shouldStartHoldemRound(existingGs)) return;

  const started = await startHoldemRound(myRoomCode, room);
  if (!started) {
    scheduleStartNewRound(1500);
    return;
  }

  prevCommLen = 0;
  lastLogTs = 0;
}

// ─── 플레이어 액션 (체크/콜, 레이즈, 죽기) ────────────────

async function playerAction(action) {
  if (!gs || gs.finished) return;
  if (gs.currentActor !== myPlayerId) { showFloatMsg('⚠️ 내 차례가 아닙니다!'); return; }
  if (!canActThisTurn(gs, myPlayerId)) return;

  const myName = roomPlayersCache[myPlayerId]?.name || '나';
  const myChips = gs.chipCounts?.[myPlayerId] ?? 0;
  const owed = getBetOwed(gs, myPlayerId);

  const updates = {};
  const logAction = { type: action, playerName: myName, playerId: myPlayerId, amount: 0, detail: '', timestamp: Date.now() };

  if (action === 'fold') {
    SFX.fold();
    updates[`rooms/${myRoomCode}/gameState/folded/${myPlayerId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'fold';
    logAction.type = 'fold';
    logAction.detail = '기권';

  } else if (action === 'stay') {
    // 체크 / 콜 처리
    const chips = { ...(gs.chipCounts || {}) };
    const currentBets = { ...(gs.currentBets || {}) };
    
    if (owed === 0) {
      // 체크
      SFX.stay();
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'check';
      logAction.type = 'stay';
      logAction.detail = '체크';
    } else {
      // 콜 (칩이 모자라면 올인 콜)
      const callCost = Math.min(myChips, owed);
      if (!payBet(chips, myPlayerId, callCost)) {
        showFloatMsg('칩이 부족합니다!');
        return;
      }
      SFX.stay();
      const isAllIn = (chips[myPlayerId] ?? 0) === 0;
      updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
      updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + callCost;
      currentBets[myPlayerId] = (currentBets[myPlayerId] ?? 0) + callCost;
      updates[`rooms/${myRoomCode}/gameState/currentBets`] = currentBets;
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'call';
      
      logAction.type = 'stay';
      logAction.amount = callCost;
      logAction.detail = isAllIn ? '올인 콜' : '콜';
    }

  } else if (action === 'snap') {
    // 레이즈 처리 (btn-snap을 레이즈로 재활용)
    if ((gs.raiseCount ?? 0) >= 3) {
      showFloatMsg('⚠️ 이번 단계 레이즈 캡(최대 3회)에 도달했습니다.');
      return;
    }

    const betUnit = getBetUnit(gs.phase);
    const newBet = (gs.currentBet ?? 0) + betUnit;
    const raiseCost = newBet - (gs.currentBets?.[myPlayerId] ?? 0);

    if (myChips < raiseCost) {
      showFloatMsg('⚠️ 칩이 부족하여 레이즈할 수 없습니다!');
      return;
    }

    const chips = { ...(gs.chipCounts || {}) };
    const currentBets = { ...(gs.currentBets || {}) };

    if (!payBet(chips, myPlayerId, raiseCost)) {
      showFloatMsg('칩이 부족합니다!');
      return;
    }

    SFX.snap();
    
    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + raiseCost;
    currentBets[myPlayerId] = (currentBets[myPlayerId] ?? 0) + raiseCost;
    updates[`rooms/${myRoomCode}/gameState/currentBets`] = currentBets;
    updates[`rooms/${myRoomCode}/gameState/currentBet`] = newBet;
    updates[`rooms/${myRoomCode}/gameState/raiseCount`] = (gs.raiseCount ?? 0) + 1;

    // 레이즈가 발생했으므로 다른 모든 사람들의 phaseActed를 초기화하여 다시 배팅을 맞추게 함
    const nextPhaseActed = { [myPlayerId]: 'raise' };
    updates[`rooms/${myRoomCode}/gameState/phaseActed`] = nextPhaseActed;

    logAction.type = 'snap';
    logAction.amount = raiseCost;
    logAction.detail = `레이즈 (+${betUnit}칩, 총 ${newBet}칩)`;
  }

  const projected = applyLocalUpdates(gs, updates);
  const extraFolded = action === 'fold' ? { [myPlayerId]: true } : {};
  const { next, updates: actorUpdates } = advanceActorAfterAction(projected, myPlayerId, extraFolded);
  Object.assign(updates, actorUpdates);
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  await update(ref(database), updates);
}

function advanceActorAfterAction(state, currentPid, extraFolded = {}) {
  const merged = { ...state, folded: { ...(state.folded || {}), ...extraFolded } };
  const next = computeNextActor(merged, currentPid, extraFolded);

  const updates = {};
  if (next) {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = next;
    updates[`rooms/${myRoomCode}/gameState/phaseComplete`] = false;
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = null;
    updates[`rooms/${myRoomCode}/gameState/phaseComplete`] = true;
  }
  return { next, updates };
}

/** Firebase update 경로를 반영한 로컬 상태 미리보기 */
function applyLocalUpdates(state, updates) {
  const next = {
    ...state,
    chipCounts: { ...(state.chipCounts || {}) },
    currentBets: { ...(state.currentBets || {}) },
    folded: { ...(state.folded || {}) },
    phaseActed: { ...(state.phaseActed || {}) }
  };
  const prefix = `rooms/${myRoomCode}/gameState/`;

  for (const [path, value] of Object.entries(updates)) {
    if (!path.startsWith(prefix)) continue;
    const parts = path.slice(prefix.length).split('/');
    if (parts.length === 1) {
      next[parts[0]] = value;
    } else if (parts.length === 2) {
      next[parts[0]] = { ...(next[parts[0]] || {}), [parts[1]]: value };
    }
  }
  return next;
}

// ─── 호스트 자동 처리 엔진 ───────────────────────────

function scheduleHostActions() {
  clearTimeout(hostTimer);
  hostTimer = setTimeout(async () => {
    if (!gs || !isHost || gs.finished) return;
    const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
    if (!snap.exists()) return;
    const cur = snap.val();

    if (cur.finished) return;

    // 활성 플레이어 수 확인
    const active = getPlayerOrder(cur).filter(p => !cur.folded?.[p]);

    // 1명 이하 생존 감지 시 조기 종료
    if (active.length <= 1) {
      await endHandEarly(active, cur);
      return;
    }

    // 턴이 돌 사람 구하기
    const order = getActorOrder(cur);
    let nextActor = cur.currentActor;

    // 현재 액터가 유효하지 않거나 액션 불가인 경우 복구
    if (!nextActor || cur.folded?.[nextActor] || (cur.chipCounts?.[nextActor] ?? 0) <= 0) {
      // 딜러 다음의 첫 살아있고 칩 있는 사람 찾기
      const pending = order.find(pid => !cur.folded?.[pid] && (cur.chipCounts?.[pid] ?? 0) > 0 && (!cur.phaseActed?.[pid] || getBetOwed(cur, pid) > 0));
      if (pending) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          currentActor: pending,
          phaseComplete: false
        });
        return;
      }
    }

    // 페이즈 완료 확인
    if (isBettingRoundComplete(cur)) {
      await triggerPhaseComplete(cur);
      return;
    }

    // 봇 차례 자동화
    if (cur.currentActor?.startsWith('bot_') && canActThisTurn(cur, cur.currentActor)) {
      await executeBotAction(cur, cur.currentActor);
      return;
    }
  }, 600);
}

// 다음 액터 계산
function computeNextActor(state, currentPid, extraFolded = {}) {
  const order  = getActorOrder(state);
  const folded = { ...(state.folded || {}), ...extraFolded };
  const curIdx = order.indexOf(currentPid);
  if (curIdx < 0) return null;

  // 다음 사람부터 시계방향으로 1바퀴 돌면서 의사결정이 안 끝난 첫 사람을 찾음
  for (let i = 1; i <= order.length; i++) {
    const pid = order[(curIdx + i) % order.length];
    if (folded[pid]) continue;
    if ((state.chipCounts?.[pid] ?? 0) <= 0) continue; // 올인한 플레이어는 건너뜀

    const owed = (state.currentBet ?? 0) - (state.currentBets?.[pid] ?? 0);
    if (!state.phaseActed?.[pid] || owed > 0) {
      return pid;
    }
  }

  return null;
}

// ─── 봇 액션 ─────────────────────────────────────────

async function executeBotAction(curGs, botId) {
  await new Promise(r => setTimeout(r, 700 + Math.random() * 1100));
  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs2 = snap.val();
  if (gs2.currentActor !== botId || !canActThisTurn(gs2, botId) || gs2.finished) return;

  const botName  = roomPlayersCache[botId]?.name || '봇';
  const botChips = gs2.chipCounts?.[botId] ?? 0;
  const owed     = getBetOwed(gs2, botId);
  const rand     = Math.random();

  const betUnit = getBetUnit(gs2.phase);
  const newBet = (gs2.currentBet ?? 0) + betUnit;
  const raiseCost = newBet - (gs2.currentBets?.[botId] ?? 0);
  const canRaise = (gs2.raiseCount ?? 0) < 3 && botChips >= raiseCost;

  let action = 'stay'; // 기본은 체크 / 콜
  
  if (owed === 0) {
    // 체크 가능할 때: 85% 체크, 15% 레이즈
    if (canRaise && rand < 0.15) {
      action = 'snap';
    } else {
      action = 'stay';
    }
  } else {
    // 콜해야 할 때: 15% 폴드, 70% 콜, 15% 레이즈
    if (rand < 0.15) {
      action = 'fold';
    } else if (canRaise && rand > 0.85) {
      action = 'snap';
    } else {
      action = 'stay';
    }
  }

  const updates = {};
  const logAction = { type: action, playerName: botName, playerId: botId, amount: 0, detail: '', timestamp: Date.now() };

  const chips = { ...(gs2.chipCounts || {}) };
  const currentBets = { ...(gs2.currentBets || {}) };
  let pot = gs2.pot ?? 0;

  if (action === 'fold') {
    updates[`rooms/${myRoomCode}/gameState/folded/${botId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'fold';
    logAction.type = 'fold';
    logAction.detail = '기권';

  } else if (action === 'stay') {
    if (owed === 0) {
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'check';
      logAction.type = 'stay';
      logAction.detail = '체크';
    } else {
      const callCost = Math.min(botChips, owed);
      payBet(chips, botId, callCost);
      const isAllIn = (chips[botId] ?? 0) === 0;
      pot += callCost;
      currentBets[botId] = (currentBets[botId] ?? 0) + callCost;
      
      updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
      updates[`rooms/${myRoomCode}/gameState/pot`] = pot;
      updates[`rooms/${myRoomCode}/gameState/currentBets`] = currentBets;
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'call';
      
      logAction.type = 'stay';
      logAction.amount = callCost;
      logAction.detail = isAllIn ? '올인 콜' : '콜';
    }

  } else if (action === 'snap') {
    payBet(chips, botId, raiseCost);
    pot += raiseCost;
    currentBets[botId] = (currentBets[botId] ?? 0) + raiseCost;

    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = pot;
    updates[`rooms/${myRoomCode}/gameState/currentBets`] = currentBets;
    updates[`rooms/${myRoomCode}/gameState/currentBet`] = newBet;
    updates[`rooms/${myRoomCode}/gameState/raiseCount`] = (gs2.raiseCount ?? 0) + 1;
    
    const nextPhaseActed = { [botId]: 'raise' };
    updates[`rooms/${myRoomCode}/gameState/phaseActed`] = nextPhaseActed;

    logAction.type = 'snap';
    logAction.amount = raiseCost;
    logAction.detail = `레이즈 (+${betUnit}칩, 총 ${newBet}칩)`;
  }

  const extraFolded = action === 'fold' ? { [botId]: true } : {};
  const projected = applyLocalUpdates(gs2, updates);
  const { next, updates: actorUpdates } = advanceActorAfterAction(projected, botId, extraFolded);
  Object.assign(updates, actorUpdates);
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  await update(ref(database), updates);
}

// ─── 페이즈 완료 처리 ────────────────────────────────

async function triggerPhaseComplete(curGs) {
  if (!isHost) return;

  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs2 = curGs || snap.val();

  if (gs2.finished) return;

  // 이미 다음 페이즈 딜링이 진행되었거나 베팅이 완료 상태가 아니라면 중복 처리 방지
  if (!isBettingRoundComplete(gs2)) return;

  const playerOrder = getPlayerOrder(gs2);
  const folded      = gs2.folded || {};
  const active      = playerOrder.filter(p => !folded[p]);

  // 1명 이하 → 조기 종료
  if (active.length <= 1) { await endHandEarly(active, gs2); return; }

  // 다음 페이즈 결정
  const curIdx   = PHASE_ORDER.indexOf(gs2.phase);
  const isLast   = curIdx >= PHASE_ORDER.length - 1;

  if (isLast) {
    await runShowdown(gs2, active);
  } else {
    await advancePhase(gs2, active, PHASE_ORDER[curIdx + 1]);
  }
}

// ─── 다음 페이즈로 진행 ──────────────────────────────

async function advancePhase(curGs, active, nextPhase) {
  if (!isHost) return;

  const usedSet  = new Set(curGs.usedCardIds || []);
  const freshDeck = shuffleDeck(createDeck()).filter(c => !usedSet.has(c.id));
  const existing = curGs.communityCards || [];
  let newComm    = [...existing];
  const newUsed  = [...(curGs.usedCardIds || [])];

  if (nextPhase === 'flop') {
    const cards = [freshDeck.shift(), freshDeck.shift(), freshDeck.shift()];
    newComm = [...existing, ...cards];
    newUsed.push(...cards.map(c => c.id));
  } else {
    const card = freshDeck.shift();
    newComm = [...existing, card];
    newUsed.push(card.id);
  }

  // 액터 순서 (딜러 다음 살아있는 사람부터 순서대로)
  const playerOrder = getPlayerOrder(curGs);
  const dealerIdx = curGs.dealerIndex ?? 0;
  const actorOrder = [];
  const newFolded = { ...(curGs.folded || {}) };
  for (let i = 1; i <= playerOrder.length; i++) {
    const pid = playerOrder[(dealerIdx + i) % playerOrder.length];
    if (!newFolded[pid] && (curGs.chipCounts?.[pid] ?? 0) > 0) {
      actorOrder.push(pid);
    }
  }

  // 매 페이즈마다 배팅 초기화
  const currentBets = {};
  for (const pid of playerOrder) {
    currentBets[pid] = 0;
  }

  SFX.chip();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: nextPhase,
    communityCards: newComm,
    usedCardIds: newUsed,
    folded: newFolded,
    currentBet: 0,
    currentBets,
    raiseCount: 0,
    actorOrder,
    currentActor: actorOrder[0] || null,
    phaseActed: {},
    // actorOrder가 비었으면 즉시 페이즈 완료(전원 올인) 표시
    phaseComplete: actorOrder.length === 0,
    lastAction: {
      type: 'deal',
      playerName: '딜러',
      amount: 0,
      detail: actorOrder.length === 0
        ? `${PHASE_NAMES[nextPhase]} 오픈 (전원 올인 - 자동 진행)`
        : `${PHASE_NAMES[nextPhase]} 오픈 · 베팅 단위: ${getBetUnit(nextPhase)}칩`,
      timestamp: Date.now()
    }
  });

  // 전원 올인으로 베팅할 사람이 없으면, 방장이 연속으로 다음 페이즈/쇼다운 진행
  if (isHost && actorOrder.length === 0) {
    setTimeout(() => scheduleHostActions(), 800);
  }
}

// ─── 조기 종료 (1명 남음) ───────────────────────────

async function endHandEarly(survivors, curGs) {
  if (!isHost) return;
  const winner = survivors[0] || null;
  if (!winner) return;

  const pot = curGs.pot ?? 0;
  const chips = { ...(curGs.chipCounts || {}) };
  chips[winner] = (chips[winner] ?? 0) + pot;

  SFX.win();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'showdown',
    finished: true,
    winner,
    winnerHand: '독점 승리 (상대 전원 기권)',
    chipCounts: chips,
    pot: 0,
    showdownData: null,
    lastAction: {
      type: 'win',
      playerName: roomPlayersCache[winner]?.name || '플레이어',
      amount: pot,
      timestamp: Date.now()
    }
  });
}

// ─── 쇼다운 ─────────────────────────────────────────

async function runShowdown(curGs, active) {
  if (!isHost) return;

  const handsSnap = await get(ref(database, `rooms/${myRoomCode}/hands`));
  if (!handsSnap.exists()) return;
  const handsData = handsSnap.val();

  const playerHands = {};
  for (const pid of active) {
    const h = handsData[pid];
    if (h) playerHands[pid] = Array.isArray(h) ? h : Object.values(h);
  }

  const community = (curGs.communityCards || []).slice(0, 5);
  const { winners, handResults } = determineWinners(playerHands, community);

  const pot   = curGs.pot ?? 0;
  const share = Math.floor(pot / (winners.length || 1));
  const chips = { ...(curGs.chipCounts || {}) };
  for (const pid of winners) chips[pid] = (chips[pid] ?? 0) + share;

  const showdownData = {};
  for (const pid of active) {
    showdownData[pid] = {
      cards: playerHands[pid] || [],
      handRank: handResults[pid]?.name || '-'
    };
  }

  SFX.win();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'showdown',
    finished: true,
    winner: winners.length === 1 ? winners[0] : winners,
    winnerHand: handResults[winners[0]]?.name || '승리',
    chipCounts: chips,
    pot: 0,
    showdownData,
    lastAction: {
      type: 'win',
      playerName: winners.map(p => roomPlayersCache[p]?.name || p).join(', '),
      amount: pot,
      timestamp: Date.now()
    }
  });
}

// ─── 다음 라운드 ─────────────────────────────────────

async function handleNextRound() {
  if (!isHost) return;
  document.getElementById('showdown-overlay')?.classList.remove('show');
  prevCommLen = 0;
  await startNewRound(true);
}

// ─── 대기실 복귀 (방장 및 참가자 공통 안전 복귀) ───────────────
async function handleBackToLobby() {
  isNavigatingToLobby = true;

  unsubList.forEach(u => { try { u(); } catch (e) {} });
  unsubList.length = 0;
  clearTimeout(hostTimer);
  clearTimeout(startRetryTimer);
  window.removeEventListener('beforeunload', handleBeforeUnload);

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    const updates = {
      [`rooms/${myRoomCode}/status`]: 'waiting',
      [`rooms/${myRoomCode}/gameState`]: null,
      [`rooms/${myRoomCode}/hands`]: null,
      [`rooms/${myRoomCode}/emotes`]: null
    };

    if (roomSnap.exists()) {
      const roomData = roomSnap.val();
      const players = roomData.players || {};
      
      Object.keys(players).forEach(pid => {
        if (pid.startsWith('bot_')) {
          updates[`rooms/${myRoomCode}/players/${pid}`] = null;
        }
      });
    }

    await update(ref(database), updates);
    window.location.href = 'index.html';
  } catch (err) {
    console.error("대기실 복귀 실패:", err);
    window.location.href = 'index.html';
  }
}

// ─── 브라우저 닫기/새로고침 시 이탈 처리 ───────────────────
const handleBeforeUnload = () => {
  if (isNavigatingToLobby) return;
  handleLeave();
};

// ─── 나가기 ──────────────────────────────────────────

async function handleLeave() {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  unsubList.forEach(u => { try { u(); } catch (e) {} });
  unsubList.length = 0;
  clearTimeout(hostTimer);
  clearTimeout(startRetryTimer);
  try {
    const snap = await get(ref(database, `rooms/${myRoomCode}`));
    if (snap.exists()) {
      const room = snap.val();
      if (room.host === myPlayerId) {
        await remove(ref(database, `rooms/${myRoomCode}`));
      } else {
        await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
        await remove(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`));
      }
    }
  } catch (e) {}
  sessionStorage.removeItem('uno_room_code');
  window.location.href = 'index.html';
}

// ═══════════════════════════════════════════════════
// ─── 렌더 함수들 ────────────────────────────────────
// ═══════════════════════════════════════════════════

function renderAll(newCardStartIdx = -1) {
  if (!gs) return;
  const myArea = document.querySelector('.my-area');
  if (myArea && !myArea.hasAttribute('data-pid')) {
    myArea.setAttribute('data-pid', myPlayerId);
  }
  renderOpponents();
  renderCommunityCards(newCardStartIdx);
  renderMyHand();
  renderMyHandRank();
  renderPot();
  renderPhaseInfo();
  renderSnapInfo();
  renderActionButtons();
  renderChipList();
  if (gs.finished) showShowdown();
}

// ─── 상대 플레이어 ───────────────────────────────────

function renderOpponents() {
  const area = document.getElementById('opponents-area');
  if (!area || !gs) return;

  const opponents = getPlayerOrder(gs).filter(pid => pid !== myPlayerId);
  const winners   = gs.winner ? (Array.isArray(gs.winner) ? gs.winner : [gs.winner]) : [];

  area.innerHTML = opponents.map(pid => {
    const p        = roomPlayersCache[pid] || {};
    const name     = p.name || pid;
    const avatar   = p.avatar || '🤖';
    const chips    = gs.chipCounts?.[pid] ?? 0;
    const isFolded = gs.folded?.[pid];
    const isDealer = (getPlayerOrder(gs).indexOf(pid) === gs.dealerIndex);
    const isWinner = winners.includes(pid);
    const sdData   = gs.showdownData?.[pid];

    const owesMore = !isFolded && getBetOwed(gs, pid) > 0 && gs.phaseActed?.[pid];
    const isActive = gs.currentActor === pid && !gs.finished && canActThisTurn(gs, pid);

    let cardHtml = '';
    if (sdData) {
      cardHtml = `<div class="opponent-cards">${(sdData.cards || []).map(c =>
        `<div style="border-radius:5px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.8);">${renderPokerCardSVG(c, { width: 48, height: 69, highlight: isWinner })}</div>`
      ).join('')}</div>`;
    } else {
      const num = isFolded ? 0 : 2;
      cardHtml = `<div class="opponent-cards">${Array(num).fill(0).map(() =>
        `<div style="border-radius:5px;overflow:hidden;">${renderCardBack({ width: 48, height: 69 })}</div>`
      ).join('')}</div>`;
    }

    // 목숨 하트 표시 (lives가 있을 경우)
    const livesCount = gs.lives?.[pid] ?? null;
    const livesHtml = livesCount !== null
      ? `<div class="p-lives">${'❤️'.repeat(livesCount)}${livesCount === 0 ? '💀' : ''}</div>`
      : '';

    return `<div class="player-panel ${isActive ? 'active-turn' : ''} ${isFolded ? 'folded' : ''} ${isWinner ? 'winner' : ''}" data-pid="${pid}">
      ${isDealer ? '<div class="dealer-chip">D</div>' : ''}
      <div class="p-avatar">${avatar}</div>
      ${cardHtml}
      <div class="p-name">${escapeHtml(name)}</div>
      ${livesHtml}
      <div class="p-chips">💰 ${chips}칩 (낸 액수: ${gs.currentBets?.[pid] ?? 0})</div>
      ${isActive ? '<div class="p-thinking">⏳ 선택 중...</div>' : ''}
      ${isWinner ? '<div class="p-winner">🏆 승자!</div>' : ''}
      ${sdData ? `<div class="p-hand-rank">${sdData.handRank}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── 커뮤니티 카드 ───────────────────────────────────

function renderCommunityCards(animateFromIdx = -1) {
  const area = document.getElementById('community-cards');
  if (!area || !gs) return;

  const cards = gs.communityCards || [];
  area.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const card = cards[i];
    const el   = document.createElement('div');

    if (card) {
      el.style.cssText = 'border-radius:8px; overflow:hidden;';
      if (animateFromIdx >= 0 && i >= animateFromIdx) {
        el.className = 'community-card';
        el.style.animationDelay = `${(i - animateFromIdx) * 0.12}s`;
      }
      el.innerHTML = renderPokerCardSVG(card, { width: 72, height: 103 });
    } else {
      el.className = 'card-slot';
      el.textContent = '?';
    }
    area.appendChild(el);
  }
}

// ─── 내 홀 카드 ──────────────────────────────────────

function renderMyHand() {
  const area = document.getElementById('my-hand-cards');
  if (!area) return;

  if (!myHoleCards || myHoleCards.length === 0) {
    area.innerHTML = [1, 2].map(() =>
      `<div style="border-radius:10px;overflow:hidden;">${renderCardBack({ width: 90, height: 128 })}</div>`
    ).join('');
    return;
  }

  area.innerHTML = myHoleCards.map(card =>
    `<div class="my-hole-card" style="border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.8);">
      ${renderPokerCardSVG(card, { width: 90, height: 128 })}
    </div>`
  ).join('');
}

// ─── 내 핸드 랭킹 ────────────────────────────────────

function renderMyHandRank() {
  const el = document.getElementById('my-hand-rank');
  if (!el) return;
  const community = gs?.communityCards || [];
  if (!myHoleCards || myHoleCards.length < 2 || community.length < 3) {
    el.textContent = '핸드 대기 중...';
    return;
  }
  try {
    const result = evaluateBestHand(myHoleCards, community);
    if (result) el.textContent = `🃏 ${result.name}`;
  } catch (e) {}
}

// ─── 팟 / 페이즈 ─────────────────────────────────────

function renderPot() {
  const el = document.getElementById('pot-amount');
  if (el && gs) el.textContent = `${gs.pot ?? 0}칩`;
}

function renderPhaseInfo() {
  const el = document.getElementById('phase-badge');
  if (!el || !gs) return;
  el.className = `phase-badge ${gs.phase || ''}`;
  el.textContent = PHASE_NAMES[gs.phase] || gs.phase || '-';

  const anteEl = document.getElementById('phase-ante');
  if (anteEl) {
    const betUnit = getBetUnit(gs.phase);
    anteEl.textContent = `베팅 단위: ${betUnit}칩 (현재 최고 배팅액: ${gs.currentBet ?? 0}칩)`;
  }

  const statPhase = document.getElementById('stat-phase');
  if (statPhase) statPhase.textContent = PHASE_NAMES[gs.phase] || '-';
}

// ─── 베팅 정보 표시 (스냅 대체) ───────────────────────────

function renderSnapInfo() {
  const container = document.getElementById('snap-multiplier');
  if (!container || !gs) return;

  container.innerHTML = `<span style="font-size:0.78rem;color:#d4af37;font-weight:700;">기본 베팅 시스템</span>`;

  const remainEl = document.getElementById('snap-remain');
  if (remainEl) {
    const raiseCount = gs.raiseCount ?? 0;
    remainEl.textContent = `이번 라운드 레이즈 횟수: ${raiseCount}/3회`;
  }
}

// ─── 액션 버튼 ───────────────────────────────────────

function renderActionButtons() {
  if (!gs) return;

  const isFolded  = gs.folded?.[myPlayerId];
  const isFinished = gs.finished;
  const isMyTurn  = gs.currentActor === myPlayerId && !isFolded && !isFinished;
  const owed           = getBetOwed(gs, myPlayerId);
  const myChips        = gs.chipCounts?.[myPlayerId] ?? 0;
  const canAct         = isMyTurn && canActThisTurn(gs, myPlayerId);

  const normalActions = document.getElementById('normal-actions');
  const nextBtn       = document.getElementById('btn-next-round');
  const infoEl        = document.getElementById('action-info');

  if (normalActions) {
    normalActions.style.display = 'flex';

    // 스냅콜 버튼은 숨김 처리
    const snapCallBtn = document.getElementById('btn-snap-call');
    if (snapCallBtn) snapCallBtn.style.display = 'none';

    const stayBtn = document.getElementById('btn-stay');
    const snapBtn = document.getElementById('btn-snap');
    const foldBtn = document.getElementById('btn-fold');

    if (stayBtn) {
      stayBtn.disabled = !canAct;
      stayBtn.style.display = 'flex';
      const stayLabel = document.getElementById('btn-stay-label');
      const staySub = document.getElementById('btn-stay-sub');
      
      if (stayLabel) {
        if (owed === 0) {
          stayLabel.textContent = '체크';
        } else {
          stayLabel.textContent = myChips >= owed ? `콜 ${owed}칩` : `올인 콜 (${myChips}칩)`;
        }
      }
      if (staySub) staySub.textContent = owed === 0 ? '차례 넘기기' : '금액 맞추기';
    }

    if (foldBtn) {
      foldBtn.disabled = !canAct;
      const foldLabel = foldBtn.querySelector('.btn-label');
      const foldSub = foldBtn.querySelector('.btn-sub');
      if (foldLabel) foldLabel.textContent = '죽기';
      if (foldSub) foldSub.textContent = '기권';
    }

    if (snapBtn) {
      const betUnit = getBetUnit(gs.phase);
      const newBet = (gs.currentBet ?? 0) + betUnit;
      const raiseCost = newBet - (gs.currentBets?.[myPlayerId] ?? 0);
      const raiseCount = gs.raiseCount ?? 0;
      const canRaise = raiseCount < 3 && myChips >= raiseCost;

      snapBtn.disabled = !canAct || !canRaise;
      snapBtn.style.opacity = snapBtn.disabled ? '0.35' : '1';
      snapBtn.style.display = 'flex';
      snapBtn.innerHTML = `
        <span class="btn-icon">⚡</span>
        <div class="btn-text-wrap">
          <span class="btn-label">레이즈</span>
          <span class="btn-sub">+${betUnit}칩 (필요: ${raiseCost}칩)</span>
        </div>
      `;
    }
  }

  if (nextBtn) nextBtn.style.display = (isHost && isFinished) ? 'inline-flex' : 'none';

  if (infoEl) {
    if (isFinished) {
      infoEl.textContent = '';
    } else if (isFolded) {
      infoEl.textContent = '💀 기권 (폴드)';
    } else if (!isMyTurn) {
      const cur = gs.currentActor;
      const name = cur ? (roomPlayersCache[cur]?.name || '상대') : '';
      infoEl.textContent = cur ? `${name} 선택 중...` : '';
    } else {
      const paid = gs.currentBets?.[myPlayerId] ?? 0;
      if (owed === 0) {
        infoEl.textContent = `내 차례입니다. 체크하거나 레이즈할 수 있습니다. (이번 페이즈 낸 칩: ${paid}칩)`;
      } else {
        infoEl.textContent = `내 차례입니다. 콜(${owed}칩)하거나 레이즈, 혹은 폴드할 수 있습니다. (이번 페이즈 낸 칩: ${paid}칩)`;
      }
    }
  }

  const myChipsEl = document.getElementById('my-chips');
  const myLives = gs?.lives?.[myPlayerId] ?? null;
  const livesText = myLives !== null ? ` | ❤️×${myLives}` : '';
  if (myChipsEl) myChipsEl.textContent = `💰 ${myChips}칩${livesText}`;
}

// ─── 칩 목록 ─────────────────────────────────────────

function renderChipList() {
  const list = document.getElementById('chip-list');
  if (!list || !gs) return;

  list.innerHTML = getPlayerOrder(gs).map(pid => {
    const p      = roomPlayersCache[pid] || {};
    const isMe   = pid === myPlayerId;
    const act    = gs.currentActor === pid;
    const folded = gs.folded?.[pid];
    const chips  = gs.chipCounts?.[pid] ?? 0;
    const paid   = gs.currentBets?.[pid] ?? 0;
    const lives  = gs.lives?.[pid] ?? null;
    const livesStr = lives !== null ? ` ❤️×${lives}` : '';
    return `<div class="chip-row ${isMe ? 'is-me' : ''} ${act ? 'active' : ''} ${folded ? 'folded-row' : ''}">
      <span class="chip-avatar">${p.avatar || '🤖'}</span>
      <span class="chip-name">${escapeHtml(p.name || pid)}${isMe ? ' (나)' : ''}${livesStr}</span>
      <span class="chip-amount">💰 ${chips} (낸 액수: ${paid})</span>
    </div>`;
  }).join('');
}

// \u2500\u2500\u2500 \uc1fc\ub2e4\uc6b4 \uc624\ubc84\ub808\uc774 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

let sdCountdownTimer = null; // \uce74\uc6b4\ud2b8\ub2e4\uc6b4 \ud0c0\uc774\uba38 \ub808\ud37c\ub7f0\uc2a4

function showShowdown() {
  const overlay = document.getElementById('showdown-overlay');
  if (!overlay || !gs) return;

  const winners = gs.winner ? (Array.isArray(gs.winner) ? gs.winner : [gs.winner]) : [];
  const winnerNames = winners.map(pid => roomPlayersCache[pid]?.name || pid).join(', ');
  const sdData  = gs.showdownData || {};

  // \uc2b9\uc790 \ud45c\uc2dc (\uac8c\uc784\uc885\ub8cc \ud0c0\uc774\ud2c0 \uc81c\uac70)
  overlay.querySelector('.showdown-winner-name').innerHTML =
    `\uD83C\uDFC6 <span>${escapeHtml(winnerNames)}</span> \uc2b9\ub9ac \u2014 <span style="color:rgba(240,240,255,0.7)">${escapeHtml(gs.winnerHand || '')}</span>`;

  // \ucf4c\ub7ec\ucf54\ub4dc: \ucee4\ubba4\ub2c8\ud2f0 \uce74\ub4dc (\ubcf4\ub4dc \uce74\ub4dc) \ud45c\uc2dc
  const communityArea = document.getElementById('sd-community-cards');
  if (communityArea) {
    const comm = gs.communityCards || [];
    if (comm.length > 0) {
      communityArea.innerHTML = comm.map(c =>
        `<div style="border-radius:6px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.6);">${renderPokerCardSVG(c, { width: 52, height: 75, highlight: false })}</div>`
      ).join('');
      document.getElementById('sd-community-area').style.display = 'block';
    } else {
      document.getElementById('sd-community-area').style.display = 'none';
    }
  }

  // \ud50c\ub808\uc774\uc5b4 \ud328 \ubaa9\ub85d \ub80c\ub354\ub9c1
  const playersEl = overlay.querySelector('.showdown-players');
  if (playersEl) {
    playersEl.innerHTML = getPlayerOrder(gs).map(pid => {
      const p        = roomPlayersCache[pid] || {};
      const isWinner = winners.includes(pid);
      const isFolded = gs.folded?.[pid];
      const sd       = sdData[pid];
      const cards    = sd?.cards || (pid === myPlayerId ? myHoleCards : []);
      const rank     = sd?.handRank || '-';

      if (isFolded && !sd) {
        return `<div class="showdown-player folded-player">
          <span style="font-size:1.3rem">${p.avatar || '🤖'}</span>
          <div class="sd-name">${escapeHtml(p.name || pid)}</div>
          <div class="sd-rank">\uae30\uad8c</div>
        </div>`;
      }

      const cardHtml = cards.length > 0
        ? cards.map(c => `<div style="border-radius:6px;overflow:hidden;">${renderPokerCardSVG(c, { width: 58, height: 83, highlight: isWinner })}</div>`).join('')
        : `<div style="border-radius:6px;overflow:hidden;">${renderCardBack({ width: 58, height: 83 })}</div>`;

      return `<div class="showdown-player ${isWinner ? 'winner-card' : ''}">
        <span style="font-size:1.3rem">${p.avatar || '🤖'}</span>
        <div class="sd-name">${escapeHtml(p.name || pid)}${isWinner ? ' 🏆' : ''}</div>
        <div class="sd-hand">${cardHtml}</div>
        <div class="sd-rank">${rank}</div>
      </div>`;
    }).join('');
  }

  overlay.classList.add('show');

  // 3\ucd08 \uce74\uc6b4\ud2b8\ub2e4\uc6b4 \ud6c4 \uc790\ub3d9 \ub2e4\uc74c \ub77c\uc6b4\ub4dc
  if (sdCountdownTimer) {
    clearInterval(sdCountdownTimer);
    sdCountdownTimer = null;
  }

  const countdownEl = document.getElementById('sd-countdown');
  let count = 5;
  if (countdownEl) countdownEl.innerHTML = `⏳ 다음 라운드까지 <span>${count}</span>초...`;

  sdCountdownTimer = setInterval(() => {
    count--;
    if (countdownEl) countdownEl.innerHTML = `⏳ 다음 라운드까지 <span>${count}</span>초...`;

    if (count <= 0) {
      clearInterval(sdCountdownTimer);
      sdCountdownTimer = null;
      overlay.classList.remove('show');

      // \ubc29\uc7a5\ub9cc \ub2e4\uc74c \ub77c\uc6b4\ub4dc \uc2dc\uc791, \ub098\uba38\uc9c0\ub294 Firebase \ub9ac\uc2a4\ub108\ub97c \ud1b5\ud574 \uc790\ub3d9 \uac31\uc2e0
      if (isHost) {
        handleNextRound();
      }
    }
  }, 1000);
}


// ─── 로그 ────────────────────────────────────────────

function appendLogIfNew(action) {
  if (!action || action.timestamp === lastLogTs) return;
  lastLogTs = action.timestamp;

  const log = document.getElementById('action-log');
  if (!log) return;

  const icons = { stay:'💰', fold:'✕', snap:'⚡', win:'🏆', deal:'🃏' };
  const cls = { stay:'action-check', fold:'action-fold', snap:'action-raise', win:'action-win', deal:'action-deal' };

  const icon  = icons[action.type]  || '•';
  const amt   = action.amount > 0 ? ` ${action.amount}칩` : '';
  const extra = action.detail ? ` — ${action.detail}` : '';

  const entry = document.createElement('div');
  entry.className = `log-entry ${cls[action.type] || ''}`;
  entry.textContent = `${icon} ${escapeHtml(action.playerName || '')}${amt}${extra}`;
  log.appendChild(entry);
  while (log.children.length > 35) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;

  // 텍사스 홀덤 베팅 액션 로고 플로팅 팝업 (하단으로 흘러내리는 연출)
  if (action.playerId && action.playerId !== 'dealer') {
    let actionType = '';
    let detail = '';
    
    if (action.type === 'fold') {
      actionType = 'fold';
      detail = 'Fold';
    } else if (action.type === 'stay') {
      if (action.detail === '체크') {
        actionType = 'check';
        detail = 'Check';
      } else {
        actionType = 'call';
        detail = action.detail === '올인 콜' ? 'All-in Call' : 'Call';
      }
    } else if (action.type === 'snap') {
      actionType = 'raise';
      detail = 'Raise';
    }
    
    if (actionType) {
      showPokerActionPopup(action.playerId, actionType, detail);
    }
  }
}

// ─── 유틸 ────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let floatTimer = null;
function showFloatMsg(text, duration = 2000) {
  let el = document.getElementById('float-msg');
  if (!el) { el = document.createElement('div'); el.id = 'float-msg'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ─── 감정표현 및 베팅 액션 팝업 공통 로직 ───────────────────
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
    const myName = roomPlayersCache[myPlayerId]?.name || '나';
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
  
  // 플레이어 패널 하단 중앙에서 아래로 떨어지게 세팅 (방해 안 되게 화면 하단으로 흘러내림)
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.bottom + 10}px`;
  popup.style.transform = 'translateX(-50%)';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 2900);
}

function showPokerActionPopup(playerId, actionType, detail) {
  const playerEl = document.querySelector(`[data-pid="${playerId}"]`);
  if (!playerEl) return;

  const rect = playerEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = `emote-popup poker-action-popup ${actionType}`;
  popup.textContent = detail;
  
  // 플레이어 패널 하단 중앙에서 아래로 떨어지게 세팅 (UNO 감정표현 스타일과 완전 동일)
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.bottom + 10}px`;
  popup.style.transform = 'translateX(-50%)';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 2900);
}


})();