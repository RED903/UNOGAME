/**
 * 할리갈리 룰 엔진
 * 한국어 주석
 */

// 과일 상수
export const FRUITS = {
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
export function createHalliGalliDeck() {
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
export function checkFiveFruits(openCards) {
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
