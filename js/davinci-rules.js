/**
 * 다빈치 코드 (Da Vinci Code) 타일 룰 및 소거법 추리 AI
 * 한국어 주석 필수
 */

// 타일 색상 및 숫자 정의
export const TILE_COLORS = ['black', 'white']; // 검은색, 흰색
export const TILE_NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * 신규 24개 타일 풀 생성
 * { id: 'b_0', color: 'black', value: 0, isOpen: false }
 */
export function createTilePool() {
  const pool = [];
  TILE_COLORS.forEach(color => {
    TILE_NUMBERS.forEach(val => {
      pool.push({
        id: `${color[0]}_${val}`,
        color, // 'black' | 'white'
        value: val,
        isOpen: false // 공개 여부
      });
    });
  });

  // 셔플
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

/**
 * 다빈치 코드 고유 정렬 규칙:
 * 1. 숫자가 작은 것이 왼쪽 (오름차순)
 * 2. 숫자가 같을 경우 검은색(black)이 흰색(white)보다 무조건 왼쪽!
 */
export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => {
    if (a.value !== b.value) {
      return a.value - b.value;
    }
    // 같은 숫자일 때 검은색이 먼저
    if (a.color === 'black' && b.color === 'white') return -1;
    if (a.color === 'white' && b.color === 'black') return 1;
    return 0;
  });
}

/**
 * 봇 AI: 논리적 소거법 기반 상대방 타일 추리
 * @param {Object} targetTile - 추리 대상 타일 { id, color, isOpen }
 * @param {Array} targetTilesAll - 상대방의 전체 타일 배열 (순서대로 정렬되어 있음)
 * @param {Array} botTiles - 봇 자신의 손패 타일 배열
 * @param {Array} allOpenTiles - 보드 전체에서 이미 공개된 타일들
 * @returns {number} 추리할 숫자 (0~11)
 */
export function botDeduceTileValue(targetTile, targetTilesAll, botTiles, allOpenTiles) {
  // 1. 이미 세상에 존재가 확인된 타일 집합 (봇 손패 + 전체 공개 타일)
  const knownTiles = new Set();
  botTiles.forEach(t => knownTiles.add(`${t.color}_${t.value}`));
  allOpenTiles.forEach(t => knownTiles.add(`${t.color}_${t.value}`));

  // 2. 상대방 배열에서 targetTile의 인덱스 확인
  const idx = targetTilesAll.findIndex(t => t.id === targetTile.id);
  if (idx === -1) return Math.floor(Math.random() * 12);

  // 3. 왼쪽과 오른쪽 타일의 숫자 경계선 파악
  let minVal = 0;
  let maxVal = 11;

  // 왼쪽에서 가장 가까운 공개 타일 탐색
  for (let i = idx - 1; i >= 0; i--) {
    const leftT = targetTilesAll[i];
    if (leftT.isOpen) {
      // 같은 색이면 왼쪽보다 무조건 커야 함, 검은색-흰색 관계 고려
      minVal = Math.max(minVal, leftT.value);
      if (leftT.color === targetTile.color) minVal = Math.max(minVal, leftT.value + 1);
      break;
    }
  }

  // 오른쪽에서 가장 가까운 공개 타일 탐색
  for (let i = idx + 1; i < targetTilesAll.length; i++) {
    const rightT = targetTilesAll[i];
    if (rightT.isOpen) {
      maxVal = Math.min(maxVal, rightT.value);
      if (rightT.color === targetTile.color) maxVal = Math.min(maxVal, rightT.value - 1);
      break;
    }
  }

  // 4. minVal ~ maxVal 범위 내에서 아직 미공개된 후보 숫자 목록 필터링
  const candidates = [];
  for (let v = minVal; v <= maxVal; v++) {
    const key = `${targetTile.color}_${v}`;
    if (!knownTiles.has(key)) {
      candidates.push(v);
    }
  }

  // 5. 후보가 있으면 후보 중 하나 선택, 없으면 범위 내 랜덤
  if (candidates.length > 0) {
    // 중앙값 또는 랜덤 선택
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return Math.min(11, Math.max(0, minVal));
}

