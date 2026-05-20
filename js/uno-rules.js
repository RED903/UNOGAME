// ═══════════════════════════════════════════════════
// UNO 규칙 엔진
// 카드 생성, 덱 섞기, 유효성 검사, 게임 로직 담당
// ═══════════════════════════════════════════════════

// 카드 색상
export const COLORS = ['red', 'blue', 'green', 'yellow'];

// 카드 타입
export const CARD_TYPES = {
  NUMBER: 'number',
  SKIP: 'skip',
  REVERSE: 'reverse',
  DRAW_TWO: 'draw_two',
  WILD: 'wild',
  WILD_DRAW_FOUR: 'wild_draw_four'
};

// 카드 값에 따른 점수
export const CARD_POINTS = {
  'skip': 20,
  'reverse': 20,
  'draw_two': 20,
  'wild': 50,
  'wild_draw_four': 50
};

/**
 * 고유 ID를 가진 UNO 카드 객체 생성
 */
export function createCard(color, type, value = null) {
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
export function createDeck() {
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
export function shuffleDeck(deck) {
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
export function isValidPlay(card, topCard, currentColor, drawCount = 0) {
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
export function processCardPlay(card, gameState, playerId, playerIds) {
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
export function initializeGame(playerIds, cardsPerPlayer = 7) {
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
export function calculateScore(hands, winnerId) {
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
