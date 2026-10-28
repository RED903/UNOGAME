/**
 * 야추 다이스 (Yacht Dice) 룰 및 점수 계산 로직
 * 한국어 주석 필수
 */

// 12가지 카테고리 키 및 한글 명칭
export const CATEGORIES = [
  { key: 'aces', name: 'Aces (1의 눈)', section: 'upper', desc: '1의 눈의 총합' },
  { key: 'deuces', name: 'Deuces (2의 눈)', section: 'upper', desc: '2의 눈의 총합' },
  { key: 'threes', name: 'Threes (3의 눈)', section: 'upper', desc: '3의 눈의 총합' },
  { key: 'fours', name: 'Fours (4의 눈)', section: 'upper', desc: '4의 눈의 총합' },
  { key: 'fives', name: 'Fives (5의 눈)', section: 'upper', desc: '5의 눈의 총합' },
  { key: 'sixes', name: 'Sixes (6의 눈)', section: 'upper', desc: '6의 눈의 총합' },
  { key: 'choice', name: 'Choice (초이스)', section: 'lower', desc: '모든 주사위 눈의 총합' },
  { key: 'fourKind', name: '4 of a Kind', section: 'lower', desc: '같은 눈 4개 이상 (주사위 총합)' },
  { key: 'fullHouse', name: 'Full House', section: 'lower', desc: '같은 눈 3개 + 2개 (주사위 총합)' },
  { key: 'sStraight', name: 'S. Straight (스몰)', section: 'lower', desc: '연속된 눈 4개 이상 (15점)' },
  { key: 'lStraight', name: 'L. Straight (라지)', section: 'lower', desc: '연속된 눈 5개 (30점)' },
  { key: 'yacht', name: 'Yacht (야추)', section: 'lower', desc: '5개 주사위 일치 (50점)' }
];

/**
 * 주사위 5개에 대해 각 눈의 빈도수를 계산
 * @param {number[]} dice - [1, 2, 3, 4, 5]
 * @returns {Object} { 1: cnt, 2: cnt, ... 6: cnt }
 */
export function getCounts(dice) {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const d of dice) {
    if (counts[d] !== undefined) counts[d]++;
  }
  return counts;
}

/**
 * 주사위 5개의 합산
 */
export function sumDice(dice) {
  return dice.reduce((acc, cur) => acc + cur, 0);
}

/**
 * 특정 카테고리에 현재 주사위 5개를 적용했을 때의 획득 점수 계산
 * @param {string} categoryKey
 * @param {number[]} dice
 * @returns {number} 점수
 */
export function calculateCategoryScore(categoryKey, dice) {
  if (!dice || dice.length !== 5) return 0;
  const counts = getCounts(dice);
  const totalSum = sumDice(dice);

  switch (categoryKey) {
    case 'aces': return counts[1] * 1;
    case 'deuces': return counts[2] * 2;
    case 'threes': return counts[3] * 3;
    case 'fours': return counts[4] * 4;
    case 'fives': return counts[5] * 5;
    case 'sixes': return counts[6] * 6;

    case 'choice':
      return totalSum;

    case 'fourKind': {
      // 같은 눈이 4개 이상인 경우 전체 주사위 합
      const has4 = Object.values(counts).some(cnt => cnt >= 4);
      return has4 ? totalSum : 0;
    }

    case 'fullHouse': {
      // 3개 + 2개이거나 5개 모두 같은 경우
      const vals = Object.values(counts).filter(c => c > 0);
      const isFH = (vals.length === 2 && (vals.includes(3) && vals.includes(2))) || vals.includes(5);
      return isFH ? totalSum : 0;
    }

    case 'sStraight': {
      // 4개 연속 숫자: 1-2-3-4, 2-3-4-5, 3-4-5-6
      const uniqueSorted = [...new Set(dice)].sort((a, b) => a - b);
      const str = uniqueSorted.join('');
      const isSS = str.includes('1234') || str.includes('2345') || str.includes('3456');
      return isSS ? 15 : 0;
    }

    case 'lStraight': {
      // 5개 연속 숫자: 1-2-3-4-5 또는 2-3-4-5-6
      const sortedStr = [...dice].sort((a, b) => a - b).join('');
      const isLS = (sortedStr === '12345' || sortedStr === '23456');
      return isLS ? 30 : 0;
    }

    case 'yacht': {
      // 5개 모두 일치
      const isYacht = Object.values(counts).some(cnt => cnt === 5);
      return isYacht ? 50 : 0;
    }

    default:
      return 0;
  }
}

/**
 * 한 플레이어의 현재 총점, 상단 합계, 보너스 달성 여부 산출
 * @param {Object} scores - { aces: 3, deuces: 6, ... }
 * @returns {Object} { upperTotal, bonus, lowerTotal, grandTotal, remainingCategories }
 */
export function calculateTotals(scores = {}) {
  let upperTotal = 0;
  let lowerTotal = 0;
  let filledCount = 0;

  const upperKeys = ['aces', 'deuces', 'threes', 'fours', 'fives', 'sixes'];
  const lowerKeys = ['choice', 'fourKind', 'fullHouse', 'sStraight', 'lStraight', 'yacht'];

  for (const k of upperKeys) {
    if (scores[k] !== undefined && scores[k] !== null) {
      upperTotal += scores[k];
      filledCount++;
    }
  }

  for (const k of lowerKeys) {
    if (scores[k] !== undefined && scores[k] !== null) {
      lowerTotal += scores[k];
      filledCount++;
    }
  }

  const bonus = upperTotal >= 63 ? 35 : 0;
  const grandTotal = upperTotal + bonus + lowerTotal;

  return {
    upperTotal,
    bonus,
    lowerTotal,
    grandTotal,
    isComplete: filledCount === 12
  };
}

/**
 * 봇 AI: 어떤 주사위를 홀드(Hold)할지 결정
 * @param {number[]} dice - 현재 5개 주사위
 * @param {Object} scores - 봇의 현재 스코어보드
 * @param {number} rollsLeft - 남은 굴림 횟수 (1 or 2)
 * @returns {boolean[]} - [true, false, ...] 각 인덱스 홀드 여부
 */
export function botDecideHold(dice, scores = {}, rollsLeft) {
  const counts = getCounts(dice);
  const holds = [false, false, false, false, false];

  // 1. 이미 야추 완성이고 야추 칸이 비어있으면 전부 홀드
  if (scores.yacht === undefined && Object.values(counts).some(c => c === 5)) {
    return [true, true, true, true, true];
  }

  // 2. 라지 스트레이트 완성이고 lStraight 칸이 비어있으면 전부 홀드
  const sorted = [...dice].sort((a, b) => a - b).join('');
  if (scores.lStraight === undefined && (sorted === '12345' || sorted === '23456')) {
    return [true, true, true, true, true];
  }

  // 3. 같은 눈 3개 또는 4개가 있으면 해당 눈을 모두 홀드
  let maxCountVal = null;
  let maxCount = 0;
  for (let num = 6; num >= 1; num--) {
    if (counts[num] > maxCount) {
      maxCount = counts[num];
      maxCountVal = num;
    }
  }

  if (maxCount >= 2 && maxCountVal !== null) {
    // 2개 이상 모인 주사위는 홀드
    dice.forEach((d, idx) => {
      if (d === maxCountVal) holds[idx] = true;
    });

    // 만약 풀하우스가 비어있고 3개 + 2개 형태라면 나머지 2개도 홀드
    if (scores.fullHouse === undefined && maxCount === 3) {
      const otherPair = Object.keys(counts).find(k => counts[k] === 2);
      if (otherPair) {
        dice.forEach((d, idx) => {
          if (d === Number(otherPair)) holds[idx] = true;
        });
      }
    }
    return holds;
  }

  // 4. 스몰 스트레이트 가능성 확인
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  if (scores.sStraight === undefined || scores.lStraight === undefined) {
    if (unique.length >= 4) {
      const uStr = unique.join('');
      if (uStr.includes('1234') || uStr.includes('2345') || uStr.includes('3456')) {
        // 이미 스몰 스트레이트 구성 타일 홀드
        const straightSet = new Set(uStr.includes('1234') ? [1,2,3,4] : (uStr.includes('2345') ? [2,3,4,5] : [3,4,5,6]));
        const kept = new Set();
        dice.forEach((d, idx) => {
          if (straightSet.has(d) && !kept.has(d)) {
            holds[idx] = true;
            kept.add(d);
          }
        });
        return holds;
      }
    }
  }

  // 5. 기본: 4, 5, 6 같은 고득점 주사위 유지
  dice.forEach((d, idx) => {
    if (d >= 5 && (scores[`${d === 5 ? 'fives' : 'sixes'}`] === undefined || scores.choice === undefined)) {
      holds[idx] = true;
    }
  });

  return holds;
}

/**
 * 봇 AI: 마지막 굴림 후 최적의 카테고리 선택
 * @param {number[]} dice
 * @param {Object} scores
 * @returns {string} categoryKey
 */
export function botSelectCategory(dice, scores = {}) {
  const available = CATEGORIES.filter(c => scores[c.key] === undefined);
  if (available.length === 0) return null;

  // 각 미기입 카테고리의 실제 획득 가능 점수 계산
  const candidates = available.map(cat => {
    const score = calculateCategoryScore(cat.key, dice);
    let priority = score;

    // 가중치 보정
    if (cat.key === 'yacht' && score === 50) priority += 100;
    if (cat.key === 'lStraight' && score === 30) priority += 50;
    if (cat.key === 'sStraight' && score === 15) priority += 25;
    if (cat.key === 'fullHouse' && score > 0) priority += 30;
    if (cat.key === 'fourKind' && score > 0) priority += 25;
    
    // 상단 항목에서 3개 이상이면 보너스 획득에 도움되므로 가산
    if (cat.section === 'upper') {
      const counts = getCounts(dice);
      const targetNum = { aces: 1, deuces: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }[cat.key];
      if (counts[targetNum] >= 3) priority += 20;
    }

    return { key: cat.key, score, priority };
  });

  // 우선순위가 가장 높은 것 선택
  candidates.sort((a, b) => b.priority - a.priority);

  // 만약 최고 점수가 0점이라면, 손해가 가장 적은 카테고리(Aces 또는 Yacht/L.Straight)를 희생
  if (candidates[0].score === 0) {
    const sacrificeOrder = ['aces', 'deuces', 'yacht', 'lStraight', 'fourKind', 'sStraight', 'fullHouse', 'threes', 'fours', 'fives', 'sixes', 'choice'];
    for (const key of sacrificeOrder) {
      if (scores[key] === undefined) return key;
    }
  }

  return candidates[0].key;
}

