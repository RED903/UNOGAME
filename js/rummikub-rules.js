/**
 * 루미큐브 (Rummikub) 타일 룰 및 세트 검증 로직
 * 한국어 주석 필수
 */

export const RUMMI_COLORS = ['red', 'blue', 'yellow', 'black'];

/**
 * 106개 루미큐브 타일 덱 생성
 * (1~13 각 4색 x 2벌 = 104개 + 조커 2개 = 106개)
 */
export function createRummikubDeck() {
  const deck = [];
  let uid = 1;

  for (let copy = 1; copy <= 2; copy++) {
    for (const color of RUMMI_COLORS) {
      for (let num = 1; num <= 13; num++) {
        deck.push({
          id: `t_${uid++}`,
          color, // 'red' | 'blue' | 'yellow' | 'black'
          value: num,
          isJoker: false
        });
      }
    }
  }

  // 조커 2개 추가
  deck.push({ id: `t_${uid++}`, color: 'joker-red', value: 0, isJoker: true });
  deck.push({ id: `t_${uid++}`, color: 'joker-black', value: 0, isJoker: true });

  // 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/**
 * 타일 세트가 유효한지 검증 (그룹 또는 런인지)
 * @param {Array} tiles - 세트를 이루는 타일 배열 (최소 3개 이상)
 * @returns {boolean} 유효 여부
 */
export function isValidSet(tiles) {
  if (!tiles || tiles.length < 3) return false;

  // 1. 그룹(Group) 검사: 같은 숫자, 서로 다른 색상 (3~4개)
  if (isGroup(tiles)) return true;

  // 2. 런(Run) 검사: 같은 색상, 연속된 숫자 (3개 이상)
  if (isRun(tiles)) return true;

  return false;
}

/** 그룹(Group) 판별: 숫자가 같고 색상이 모두 다름 */
function isGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;

  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return true; // 조커만으로 이뤄질 수는 없음(최대 2개이므로)

  const targetValue = nonJokers[0].value;
  // 모든 일반 타일 숫자가 같은지 확인
  if (!nonJokers.every(t => t.value === targetValue)) return false;

  // 모든 일반 타일 색상이 서로 다른지 확인
  const colors = nonJokers.map(t => t.color);
  const uniqueColors = new Set(colors);
  if (uniqueColors.size !== colors.length) return false;

  return true;
}

/** 런(Run) 판별: 색상이 같고 숫자가 1씩 연속됨 */
function isRun(tiles) {
  if (tiles.length < 3) return false;

  const nonJokers = tiles.filter(t => !t.isJoker);
  if (nonJokers.length === 0) return false;

  const targetColor = nonJokers[0].color;
  // 모든 일반 타일 색상이 같은지 확인
  if (!nonJokers.every(t => t.color === targetColor)) return false;

  // 정렬 후 연속성 검사 (조커 포함)
  // 조커가 없는 경우의 기본 연속성 체크
  if (nonJokers.length === tiles.length) {
    const sorted = [...tiles].sort((a, b) => a.value - b.value);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].value !== sorted[i].value + 1) return false;
    }
    return true;
  }

  // 조커 1~2개 포함된 런 체크
  const sortedVals = nonJokers.map(t => t.value).sort((a, b) => a - b);
  const minVal = sortedVals[0];
  const maxVal = sortedVals[sortedVals.length - 1];
  const span = maxVal - minVal + 1;

  if (span <= tiles.length && maxVal <= 13 && minVal >= 1) {
    // 중복 숫자 없는지 확인
    const unique = new Set(sortedVals);
    if (unique.size === sortedVals.length) return true;
  }

  return false;
}

/**
 * 타일 세트의 점수 합산 계산 (최초 등록 30점 판정용)
 */
export function calculateSetScore(tiles) {
  let sum = 0;
  tiles.forEach(t => {
    if (t.isJoker) {
      sum += 10; // 조커 기본 임시 가산
    } else {
      sum += t.value;
    }
  });
  return sum;
}

/**
 * 타일 정렬 1: 숫자별 (777...)
 */
export function sortByNumber(tiles) {
  return [...tiles].sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.color.localeCompare(b.color);
  });
}

/**
 * 타일 정렬 2: 색상별 (123...)
 */
export function sortByColor(tiles) {
  const colorOrder = { red: 1, blue: 2, yellow: 3, black: 4, 'joker-red': 5, 'joker-black': 6 };
  return [...tiles].sort((a, b) => {
    const ca = colorOrder[a.color] || 9;
    const cb = colorOrder[b.color] || 9;
    if (ca !== cb) return ca - cb;
    return a.value - b.value;
  });
}

/**
 * 봇 AI: 손패에서 내려놓을 수 있는 유효 세트 탐색
 * @param {Array} hand
 * @param {boolean} hasInitialMeld
 * @returns {Array|null} 유효한 세트 타일 배열 또는 null
 */
export function botFindValidSet(hand, hasInitialMeld) {
  // 1. 그룹 탐색 (같은 숫자 다른 색 3~4개)
  const byVal = {};
  hand.forEach(t => {
    if (!t.isJoker) {
      if (!byVal[t.value]) byVal[t.value] = [];
      byVal[t.value].push(t);
    }
  });

  for (const val of Object.keys(byVal)) {
    const list = byVal[val];
    // 색상 중복 제거
    const uniqueColorTiles = [];
    const seenColors = new Set();
    list.forEach(t => {
      if (!seenColors.has(t.color)) {
        uniqueColorTiles.push(t);
        seenColors.add(t.color);
      }
    });

    if (uniqueColorTiles.length >= 3) {
      const setCandidate = uniqueColorTiles.slice(0, 3);
      const score = calculateSetScore(setCandidate);
      if (hasInitialMeld || score >= 30) {
        return setCandidate;
      }
    }
  }

  // 2. 런 탐색 (같은 색 연속 숫자 3개)
  const byColor = {};
  hand.forEach(t => {
    if (!t.isJoker) {
      if (!byColor[t.color]) byColor[t.color] = [];
      byColor[t.color].push(t);
    }
  });

  for (const col of Object.keys(byColor)) {
    const sorted = [...byColor[col]].sort((a, b) => a.value - b.value);
    for (let i = 0; i <= sorted.length - 3; i++) {
      if (sorted[i + 1].value === sorted[i].value + 1 && sorted[i + 2].value === sorted[i].value + 2) {
        const runCandidate = [sorted[i], sorted[i + 1], sorted[i + 2]];
        const score = calculateSetScore(runCandidate);
        if (hasInitialMeld || score >= 30) {
          return runCandidate;
        }
      }
    }
  }

  return null;
}

