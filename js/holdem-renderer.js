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
export function renderPokerCardSVG(card, opts = {}) {
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
export function renderCardBack(opts = {}) {
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
export function getSuitSymbol(suit) {
  return SUIT_SYMBOL[suit] || suit;
}

/**
 * 슈트 색상 반환
 */
export function getSuitColor(suit) {
  return SUIT_COLOR[suit] || '#000';
}

/**
 * 카드 표시 문자열 (예: A♠, K♥)
 */
export function cardToString(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}
