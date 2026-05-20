// ═══════════════════════════════════════════════════
// 텍사스 홀덤 포커 룰 엔진
// Fixed Limit 베팅 방식, 핸드 평가, 승자 결정
// ═══════════════════════════════════════════════════

// ─── 카드 생성 ─────────────────────────────────────

/** 52장 표준 덱 생성 */
export function createDeck() {
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
export function shuffleDeck(deck) {
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
export function evaluateBestHand(holeCards, communityCards) {
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

  let handType;

  if (isFlush && isStraight && rankValsSorted[0] === 14 && rankValsSorted[1] === 13) {
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
export function determineWinners(playerHands, communityCards) {
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
export function getBetUnit(phase) {
  if (phase === 'turn' || phase === 'river') return 2; // 빅벳
  return 1; // 스몰벳 (프리플랍, 플랍)
}

export const MAX_RAISES_PER_ROUND = 3; // 한 라운드 최대 레이즈 횟수
export const INITIAL_CHIPS = 200;       // 초기 지급 칩
export const SMALL_BLIND = 1;
export const BIG_BLIND = 2;
