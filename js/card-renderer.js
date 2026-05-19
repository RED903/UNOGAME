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
export function renderCardSVG(card, options = {}) {
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
export function renderColorPicker() {
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
export function createCardElement(card, options = {}) {
  const div = document.createElement('div');
  div.className = `card-wrapper ${options.selected ? 'selected' : ''} ${options.playable ? 'playable' : 'unplayable'}`;
  div.dataset.cardId = card.id;
  div.innerHTML = renderCardSVG(card, options);
  return div;
}

/**
 * 카드 뒷면 DOM 요소 생성
 */
export function createCardBackElement(options = {}) {
  const div = document.createElement('div');
  div.className = 'card-wrapper card-back';
  div.innerHTML = renderCardSVG(null, { ...options, isBack: true });
  return div;
}
