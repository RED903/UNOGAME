/**
 * 인디언 포커 (Indian Poker) 룰 및 베팅 AI
 * 한국어 주석 필수
 */

export const INITIAL_CHIPS = 30; // 1인당 기본 시작 칩
export const ANTE_CHIPS = 1;     // 라운드 기본 베팅(안티)

// 4개 카드 수트 정의
export const SUITS = [
  { name: 'spade', symbol: '♠', color: 'black', priority: 4 },
  { name: 'diamond', symbol: '♦', color: 'red', priority: 3 },
  { name: 'heart', symbol: '♥', color: 'red', priority: 2 },
  { name: 'club', symbol: '♣', color: 'black', priority: 1 }
];

/**
 * 4가지 무늬(♠, ♦, ♥, ♣) × 1~10 숫자 카드 덱 생성 (총 40장, 완전 고유 카드)
 */
export function createIndianDeck() {
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
export function botDecideIndianBet(oppCard, currentCallAmount, botChips, potSize) {
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
