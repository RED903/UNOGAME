// ═══════════════════════════════════════════════════
// 게임 메인 로직
// Firebase 실시간 동기화 + UNO 게임 진행
// ═══════════════════════════════════════════════════

import {
  database, ref, set, get, onValue, update, off, remove, serverTimestamp
} from './firebase-config.js';
import {
  CARD_TYPES, COLORS, isValidPlay, processCardPlay, initializeGame, shuffleDeck
} from './uno-rules.js';
import {
  renderCardSVG, createCardElement, createCardBackElement, renderColorPicker
} from './card-renderer.js';
import {
  playCardPlay, playCardDraw, playMyTurn, playUnoCall,
  playWin, playLose, playWild, playDrawPenalty, playError, playChat
} from './sound.js';

// ─── 감정표현 목록 ────────────────────────────────
const EMOTES = ['😂', '👍', '😤', '🔥', '😭', '🤯', '😮', '😜', '🤔', '🤮', '😡', '🤦‍♂️', '👎'];

// ─── 게임 상태 ────────────────────────────────────
let myPlayerId = '';
let myRoomCode = '';
let myName = '';
let gameState = null;      // 전체 게임 상태 (Firebase에서)
let myHand = [];           // 내 손패
let selectedCardId = null; // 선택한 카드 ID (와일드용)
let listeners = [];        // 정리용 리스너 목록
let unoCallTimer = null;   // UNO 쿨타임 타이머
let hasCalledUno = false;  // UNO 선언 여부
let isHost = false;        // 방장 여부
let emoteCooldown = false; // 감정표현 쿨타임

// ─── 초기화 ──────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  myPlayerId = params.get('player') || sessionStorage.getItem('uno_player_id');
  myRoomCode = params.get('room') || sessionStorage.getItem('uno_room_code');
  myName = sessionStorage.getItem('uno_player_name') || '플레이어';

  if (!myPlayerId || !myRoomCode) {
    alert('잘못된 접근입니다.');
    window.location.href = 'index.html';
    return;
  }

  initEmotePanel();
  bindGameEvents();
  listenToGame();
});

// ─── Firebase 리스닝 ─────────────────────────────

function listenToGame() {
  // 게임 전체 상태 리스닝
  const gameRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const unsubGame = onValue(gameRef, (snapshot) => {
    if (!snapshot.exists()) {
      // 게임 상태 없으면 방장이 초기화할 때까지 대기
      checkIfHostAndInit();
      return;
    }
    gameState = snapshot.val();
    renderGameState();
  });

  // 내 손패 별도 리스닝 (다른 플레이어가 볼 수 없게)
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${myPlayerId}`);
  const unsubHand = onValue(handRef, (snapshot) => {
    if (!snapshot.exists()) {
      myHand = [];
    } else {
      const val = snapshot.val();
      // Firebase는 배열을 객체로 저장할 수 있으므로 양쪽 처리
      myHand = Array.isArray(val) ? val : Object.values(val);
    }
    renderMyHand();
  });

  // 방 상태 (게임 종료, 플레이어 이탈 등)
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const unsubRoom = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      showGameOver({ reason: '방이 닫혔습니다.', winner: null });
      return;
    }
    const room = snapshot.val();
    // 방장 여부 업데이트
    isHost = room.host === myPlayerId;

    if (room.status === 'finished') {
      handleGameFinished(room);
    } else if (room.status === 'restarting' || room.status === 'playing') {
      // 다시 시작 중이거나 플레이 중이면 게임 종료 모달 닫기
      const modal = document.getElementById('game-over-modal');
      if (modal) modal.style.display = 'none';
    }
    updatePlayerSidebars(room);
  });

  // 감정표현 리스닝
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  const unsubEmote = onValue(emoteRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const emotes = snapshot.val();
    // 내 것 제외하고 표시
    Object.entries(emotes).forEach(([pid, data]) => {
      if (pid !== myPlayerId && data && data.emote) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });

  listeners.push({ ref: gameRef, unsub: unsubGame });
  listeners.push({ ref: handRef, unsub: unsubHand });
  listeners.push({ ref: roomRef, unsub: unsubRoom });
  listeners.push({ ref: emoteRef, unsub: unsubEmote });
}

async function checkIfHostAndInit() {
  const snapshot = await get(ref(database, `rooms/${myRoomCode}`));
  if (!snapshot.exists()) return;

  const room = snapshot.val();
  if (room.host === myPlayerId && !room.gameState) {
    // 방장이 게임 초기화
    await initNewGame(room);
  }
}

async function initNewGame(room) {
  const playerIds = Object.keys(room.players || {});
  const initialState = initializeGame(playerIds, 7);

  // 손패는 플레이어별로 분리 저장 (보안)
  const handsUpdate = {};
  for (const [pid, hand] of Object.entries(initialState.hands)) {
    handsUpdate[`rooms/${myRoomCode}/hands/${pid}`] = hand;
  }

  // 게임 상태 저장 (손패 제외)
  const gameStateToSave = {
    deck: initialState.deck,
    discardPile: initialState.discardPile,
    currentColor: initialState.currentColor,
    currentPlayer: initialState.currentPlayer,
    direction: initialState.direction,
    drawCount: initialState.drawCount,
    unoCalledBy: null,
    started: true,
    finished: false,
    winner: null,
    lastAction: { type: 'game_start', timestamp: Date.now() }
  };

  // 플레이어 순서 저장
  const playerOrder = {};
  playerIds.forEach((id, i) => { playerOrder[i] = id; });
  gameStateToSave.playerOrder = playerOrder;
  gameStateToSave.playerCount = playerIds.length;

  // 초기 손패 개수 저장
  const handCounts = {};
  for (const [pid, hand] of Object.entries(initialState.hands)) {
    handCounts[pid] = hand.length;
  }
  gameStateToSave.handCounts = handCounts;

  await update(ref(database), {
    [`rooms/${myRoomCode}/gameState`]: gameStateToSave,
    [`rooms/${myRoomCode}/status`]: 'playing',
    [`rooms/${myRoomCode}/emotes`]: null, // 감정표현 초기화
    ...handsUpdate
  });
}

// ─── 게임 렌더링 ─────────────────────────────────

function renderGameState() {
  if (!gameState) return;

  // 현재 플레이어 강조
  updateCurrentPlayerUI();

  // 버린 카드 더미 표시
  renderDiscardPile();

  // 드로우 더미 (남은 장수)
  renderDrawPile();

  // 현재 색상 표시 (와일드 후)
  renderCurrentColor();

  // 방향 표시 (상하)
  renderDirection();

  // 로그/액션 표시
  renderLastAction();

  // 내 턴 표시
  const isMyTurn = gameState.currentPlayer === myPlayerId;
  document.getElementById('my-turn-indicator')?.classList.toggle('active', isMyTurn);

  if (isMyTurn) {
    playMyTurn();
  }

  // 패 다시 렌더 (유효성 재계산)
  renderMyHand();

  // UNO 체크
  checkUnoStatus();
}

function renderMyHand() {
  const handEl = document.getElementById('my-hand');
  if (!handEl) return;

  const isMyTurn = gameState?.currentPlayer === myPlayerId;
  const currentColor = gameState?.currentColor;
  const topCard = gameState?.discardPile?.[gameState.discardPile.length - 1];

  handEl.innerHTML = '';

  // 손패 정렬 (색상별)
  const sorted = [...myHand].sort((a, b) => {
    const colorOrder = { red: 0, blue: 1, green: 2, yellow: 3, wild: 4 };
    if (colorOrder[a.color] !== colorOrder[b.color]) return colorOrder[a.color] - colorOrder[b.color];
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (a.value || 0) - (b.value || 0);
  });

  sorted.forEach((card, idx) => {
    const playable = isMyTurn && topCard && isValidPlay(card, topCard, currentColor);
    const isWild = card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR;
    const isSelectedWild = selectedCardId === card.id; // 와일드 선택 중

    const wrapper = document.createElement('div');
    wrapper.className = `hand-card ${playable ? 'playable' : 'unplayable'} ${isSelectedWild ? 'selected' : ''}`;
    wrapper.style.setProperty('--card-index', idx);
    wrapper.innerHTML = renderCardSVG(card, { width: 90, height: 130, selected: isSelectedWild, playable });
    wrapper.dataset.cardId = card.id;

    wrapper.addEventListener('click', () => {
      if (!isMyTurn) {
        showFloatMsg('지금은 내 차례가 아닙니다!');
        return;
      }
      if (!playable) {
        // 낼 수 없는 카드 흔들기
        wrapper.classList.remove('shake');
        void wrapper.offsetWidth; // reflow
        wrapper.classList.add('shake');
        playError();
        return;
      }
      handleCardPlay(card);
    });

    handEl.appendChild(wrapper);
  });

  // 패 개수 표시
  const countEl = document.getElementById('my-hand-count');
  if (countEl) countEl.textContent = myHand.length;
}

function renderDiscardPile() {
  const el = document.getElementById('discard-pile');
  if (!el || !gameState?.discardPile?.length) return;

  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile
    : Object.values(gameState.discardPile);

  const topCard = discardArr[discardArr.length - 1];
  const second = discardArr.length > 1 ? discardArr[discardArr.length - 2] : null;

  el.innerHTML = '';

  // 두 번째 카드 (약간 기울어지게)
  if (second) {
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;transform:rotate(-10deg) translateY(3px);opacity:0.65;';
    bg.innerHTML = renderCardSVG(second, { width: 90, height: 130 });
    el.appendChild(bg);
  }

  // 맨 위 카드
  const top = document.createElement('div');
  top.style.cssText = 'position:relative;';
  top.innerHTML = renderCardSVG(topCard, { width: 90, height: 130 });
  el.appendChild(top);
}

function renderDrawPile() {
  const el = document.getElementById('draw-pile');
  if (!el) return;

  const deckData = gameState?.deck;
  let deckSize = 0;
  if (Array.isArray(deckData)) {
    deckSize = deckData.length;
  } else if (deckData && typeof deckData === 'object') {
    deckSize = Object.keys(deckData).length;
  }

  el.innerHTML = '';
  // 스택처럼 보이게 여러 장
  const layers = Math.min(3, Math.ceil(deckSize / 20));
  for (let i = layers; i >= 0; i--) {
    const card = document.createElement('div');
    card.style.cssText = `position:absolute; top:${-i*2}px; left:${-i*2}px;`;
    card.innerHTML = renderCardSVG(null, { width: 90, height: 130, isBack: true });
    el.appendChild(card);
  }

  // 남은 카드 수
  const countEl = document.getElementById('deck-count');
  if (countEl) countEl.textContent = deckSize;
}

function renderCurrentColor() {
  const el = document.getElementById('current-color');
  if (!el || !gameState) return;

  const colorMap = {
    red: '#E8003D', blue: '#0065BD', green: '#1B9E3E', yellow: '#FFD900', wild: '#333'
  };
  const labelMap = { red: '빨강', blue: '파랑', green: '초록', yellow: '노랑', wild: '?' };

  const color = colorMap[gameState.currentColor] || '#333';
  el.style.background = color;
  el.style.boxShadow = `0 0 20px ${color}88`;
  el.title = labelMap[gameState.currentColor] || '';
}

function renderDirection() {
  // 방향 표시 상하 ↓/↑
  const dirEl = document.getElementById('direction-indicator');
  if (!dirEl || !gameState) return;
  dirEl.textContent = gameState.direction === 1 ? '↓' : '↑';
}

function renderLastAction() {
  const el = document.getElementById('action-log');
  if (!el || !gameState?.lastAction) return;

  const action = gameState.lastAction;
  let msg = '';

  switch (action.type) {
    case 'game_start': msg = '🎮 게임이 시작되었습니다!'; break;
    case 'play_card': msg = `${action.playerName}가 카드를 냈습니다`; break;
    case 'draw_card': msg = `${action.playerName}가 카드를 뽑았습니다`; break;
    case 'draw_penalty': msg = `${action.playerName}가 ${action.count}장을 받았습니다`; break;
    case 'uno_call': msg = `🔔 ${action.playerName}가 UNO를 외쳤습니다!`; break;
    case 'uno_penalty': msg = `⚠️ ${action.playerName}가 UNO 패널티 +2장!`; break;
    case 'skip': msg = `⏭️ ${action.playerName}의 차례를 건너뜁니다`; break;
    case 'reverse': msg = `🔄 방향이 바뀌었습니다`; break;
    default: msg = action.message || '';
  }

  // 페이드 인 애니메이션
  el.style.opacity = '0';
  el.textContent = msg;
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '1';
  });
}

function updatePlayerSidebars(room) {
  const playersEl = document.getElementById('players-sidebar');
  if (!playersEl || !room.players) return;

  const players = room.players;
  const order = gameState?.playerOrder ? Object.values(gameState.playerOrder) : Object.keys(players);
  const currentPlayer = gameState?.currentPlayer;

  playersEl.innerHTML = order.map(pid => {
    const player = players[pid];
    if (!player) return '';

    const handCount = gameState?.handCounts?.[pid] ?? '?';
    const isActive = pid === currentPlayer;
    const isMe = pid === myPlayerId;
    // 방향 화살표: 현재 방향(↓/↑)
    const dirArrow = gameState?.direction === 1 ? '↓' : '↑';

    // 1장이면 빨간 강조
    const countClass = handCount === 1 ? 'card-count-badge uno-alert' : 'card-count-badge';

    return `<div class="player-sidebar-item ${isActive ? 'active-player' : ''} ${isMe ? 'is-me' : ''}" data-pid="${pid}">
      <div class="player-sidebar-avatar">${getAvatar(player.name)}</div>
      <div class="player-sidebar-info">
        <div class="player-sidebar-name">${escapeHtml(player.name)}${isMe ? ' (나)' : ''}${pid === room.host ? ' 👑' : ''}</div>
        <div class="player-sidebar-cards">
          <span class="${countClass}">${handCount}</span>
          <span class="card-count-label">장</span>
        </div>
      </div>
      ${isActive ? `<div class="turn-arrow">${dirArrow}</div>` : ''}
    </div>`;
  }).join('');
}

function updateCurrentPlayerUI() {
  if (!gameState) return;

  const isMyTurn = gameState.currentPlayer === myPlayerId;
  document.body.classList.toggle('my-turn', isMyTurn);

  // DrawCount가 있으면 표시
  const drawEl = document.getElementById('draw-count-badge');
  if (drawEl) {
    if (gameState.drawCount > 0) {
      drawEl.textContent = `+${gameState.drawCount}`;
      drawEl.style.display = 'block';
    } else {
      drawEl.style.display = 'none';
    }
  }
}

// ─── 카드 내기 (클릭 1번) ───────────────────────

function handleCardPlay(card) {
  const isWild = card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR;

  if (isWild) {
    // 와일드 카드는 2번 클릭 방식: 첫 클릭에 선택, 두 번째에 색상 모달
    if (selectedCardId === card.id) {
      // 이미 선택됨 → 색상 선택 모달 열기
      showColorPicker(card);
    } else {
      // 첫 클릭 → 선택만
      selectedCardId = card.id;
      renderMyHand();
      showFloatMsg('한 번 더 클릭하면 색상을 선택합니다 🎨');
    }
    return;
  }

  // 일반 카드: 클릭 1번에 즉시 냄
  selectedCardId = null;
  playCard(card, null);
}

async function playCard(card, chosenColor) {
  if (!gameState || gameState.currentPlayer !== myPlayerId) return;

  const playerIds = Object.values(gameState.playerOrder || {});
  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile
    : Object.values(gameState.discardPile);
  const topCard = discardArr[discardArr.length - 1];

  if (!isValidPlay(card, topCard, gameState.currentColor)) {
    showFloatMsg('낼 수 없는 카드입니다!');
    playError();
    return;
  }

  // 내 손패에서 카드 제거
  const newHand = myHand.filter(c => c.id !== card.id);

  // 카드 효과 계산
  const changes = processCardPlay(card, gameState, myPlayerId, playerIds);

  // 새 discard pile
  const newDiscardPile = [...discardArr, card];

  // 색상 결정
  let newColor = chosenColor || card.color;

  // 덱 재섞기 필요 여부
  const deckData = gameState.deck;
  let newDeck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  if (newDeck.length < 5) {
    const reshuffled = shuffleDeck(newDiscardPile.slice(0, -1));
    newDeck = [...newDeck, ...reshuffled];
  }

  // 다음 플레이어
  let nextPlayer = changes.nextPlayer
    || playerIds[(playerIds.indexOf(myPlayerId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  // drawCount 처리
  const newDrawCount = changes.drawCount;

  // 방향 업데이트
  const newDirection = changes.reverseDirection ? -(gameState.direction || 1) : (gameState.direction || 1);

  // 이긴 경우
  const hasWon = newHand.length === 0;

  // 손패 개수 업데이트 (사이드바용)
  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[myPlayerId] = newHand.length;

  const updates = {
    [`rooms/${myRoomCode}/hands/${myPlayerId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/discardPile`]: newDiscardPile,
    [`rooms/${myRoomCode}/gameState/deck`]: newDeck,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: hasWon ? myPlayerId : nextPlayer,
    [`rooms/${myRoomCode}/gameState/currentColor`]: newColor,
    [`rooms/${myRoomCode}/gameState/direction`]: newDirection,
    [`rooms/${myRoomCode}/gameState/drawCount`]: newDrawCount,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: 'play_card',
      playerName: myName,
      playerId: myPlayerId,
      card: card,
      timestamp: Date.now()
    }
  };

  if (hasWon) {
    // 게임 종료: 방은 삭제하지 않고 상태만 변경 (다시 시작 가능)
    updates[`rooms/${myRoomCode}/gameState/finished`] = true;
    updates[`rooms/${myRoomCode}/gameState/winner`] = myPlayerId;
    updates[`rooms/${myRoomCode}/status`] = 'finished';
    updates[`rooms/${myRoomCode}/winnerName`] = myName;
    updates[`rooms/${myRoomCode}/winnerPlayerId`] = myPlayerId;
  }

  await update(ref(database), updates);

  selectedCardId = null;
  hasCalledUno = false;
  playCardPlay();

  // 특수 카드 효과음
  if (card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR) playWild();
  if (card.type === CARD_TYPES.DRAW_TWO || card.type === CARD_TYPES.WILD_DRAW_FOUR) playDrawPenalty();

  // 이긴 경우
  if (hasWon) playWin();
}

// ─── 카드 뽑기 ───────────────────────────────────

async function handleDrawCard() {
  if (!gameState || gameState.currentPlayer !== myPlayerId) {
    showFloatMsg('지금은 내 차례가 아닙니다!');
    return;
  }

  const drawCount = gameState.drawCount > 0 ? gameState.drawCount : 1;

  const deckData = gameState.deck;
  let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  const drawn = [];

  for (let i = 0; i < drawCount; i++) {
    if (deck.length === 0) {
      // 버린 더미 재섞기
      const discardArr = Array.isArray(gameState.discardPile)
        ? gameState.discardPile
        : Object.values(gameState.discardPile);
      const reshuffled = shuffleDeck([...discardArr.slice(0, -1)]);
      deck = reshuffled;
    }
    if (deck.length > 0) {
      drawn.push(deck.shift());
    }
  }

  const newHand = [...myHand, ...drawn];
  const playerIds = Object.values(gameState.playerOrder || {});
  const nextPlayer = playerIds[(playerIds.indexOf(myPlayerId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[myPlayerId] = newHand.length;

  await update(ref(database), {
    [`rooms/${myRoomCode}/hands/${myPlayerId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/deck`]: deck,
    [`rooms/${myRoomCode}/gameState/drawCount`]: 0,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: nextPlayer,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: drawCount > 1 ? 'draw_penalty' : 'draw_card',
      playerName: myName,
      count: drawCount,
      timestamp: Date.now()
    }
  });

  playCardDraw();
  selectedCardId = null;
  hasCalledUno = false;
}

// ─── UNO 선언 (쿨타임 3초) ──────────────────────

async function handleUnoCall() {
  const unoBtn = document.getElementById('btn-uno');

  // 쿨타임 체크
  if (unoBtn && unoBtn.disabled) return;

  if (myHand.length > 2) {
    showFloatMsg('패가 2장 이하일 때만 UNO를 외칠 수 있습니다!');
    return;
  }

  hasCalledUno = true;

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    unoCalledBy: myPlayerId,
    lastAction: {
      type: 'uno_call',
      playerName: myName,
      playerId: myPlayerId,
      timestamp: Date.now()
    }
  });

  playUnoCall();
  showFloatMsg('UNO!! 🔔', 2000);

  // 쿨타임 3초 시작
  if (unoBtn) {
    unoBtn.disabled = true;
    let remaining = 3;
    unoBtn.textContent = `UNO! (${remaining}s)`;
    unoCallTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(unoCallTimer);
        unoBtn.disabled = false;
        unoBtn.textContent = 'UNO!';
      } else {
        unoBtn.textContent = `UNO! (${remaining}s)`;
      }
    }, 1000);
  }
}

function checkUnoStatus() {
  if (!gameState) return;

  const unoBtn = document.getElementById('btn-catch-uno');
  if (unoBtn) {
    const handCounts = gameState.handCounts || {};
    const unoCalledBy = gameState.unoCalledBy;
    const hasCatchable = Object.entries(handCounts).some(
      ([pid, count]) => count === 1 && pid !== myPlayerId && pid !== unoCalledBy
    );
    unoBtn.style.display = hasCatchable ? 'block' : 'none';
  }
}

async function handleCatchUno() {
  const handCounts = gameState?.handCounts || {};
  const unoCalledBy = gameState?.unoCalledBy;

  for (const [pid, count] of Object.entries(handCounts)) {
    if (count === 1 && pid !== myPlayerId && pid !== unoCalledBy) {
      showFloatMsg(`UNO 패널티! +2장 🚨`);
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        drawCount: 2,
        currentPlayer: pid,
        unoCalledBy: null,
        lastAction: {
          type: 'uno_penalty',
          playerName: '?',
          timestamp: Date.now()
        }
      });
      break;
    }
  }
}

// ─── 색상 선택기 ─────────────────────────────────

function showColorPicker(card) {
  const modal = document.getElementById('color-picker-modal');
  if (!modal) return;

  modal.style.display = 'flex';
  const buttonsEl = document.getElementById('color-picker-buttons');
  if (buttonsEl) buttonsEl.innerHTML = renderColorPicker();

  // 색상 선택 이벤트
  buttonsEl.querySelectorAll('.color-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      modal.style.display = 'none';
      selectedCardId = null;
      playCard(card, color);
    });
  });

  // 취소
  const cancelBtn = document.getElementById('btn-cancel-color');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.style.display = 'none';
      selectedCardId = null;
      renderMyHand();
    };
  }
}

// ─── 게임 종료 ───────────────────────────────────

function handleGameFinished(room) {
  const winnerId = gameState?.winner || room.winnerPlayerId;
  const winnerName = room.winnerName || '???';
  const isWinner = winnerId === myPlayerId;

  showGameOver({ isWinner, winnerName });
  if (isWinner) playWin(); else playLose();

  // 다시 시작 버튼 - 방장만 표시
  const restartBtn = document.getElementById('btn-restart-game');
  if (restartBtn) {
    restartBtn.style.display = isHost ? 'inline-flex' : 'none';
  }
}

function showGameOver({ isWinner, winnerName, reason }) {
  const modal = document.getElementById('game-over-modal');
  if (!modal) return;

  // 이미 열려 있으면 다시 열지 않음
  if (modal.style.display === 'flex') return;

  const titleEl = document.getElementById('game-over-title');
  const msgEl = document.getElementById('game-over-msg');
  const emojiEl = document.getElementById('game-over-emoji');

  if (reason) {
    if (emojiEl) emojiEl.textContent = '🚪';
    if (titleEl) titleEl.textContent = '게임 종료';
    if (msgEl) msgEl.textContent = reason;
  } else {
    if (emojiEl) emojiEl.textContent = isWinner ? '🏆' : '😢';
    if (titleEl) titleEl.textContent = isWinner ? '🎉 승리!' : '😢 패배...';
    if (msgEl) msgEl.textContent = isWinner
      ? '축하합니다! UNO 게임에서 이겼습니다!'
      : `${winnerName}님이 먼저 카드를 모두 냈습니다.`;
  }

  modal.style.display = 'flex';
}

// ─── 게임 다시 시작 (방장만) ─────────────────────

async function handleRestartGame() {
  if (!isHost) return;

  // 모달 닫기
  const modal = document.getElementById('game-over-modal');
  if (modal) modal.style.display = 'none';

  try {
    const snap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!snap.exists()) return;

    const room = snap.val();
    const playerIds = Object.keys(room.players || {});
    const initialState = initializeGame(playerIds, 7);

    // 손패는 플레이어별로 분리 저장 (보안)
    const handsUpdate = {};
    for (const [pid, hand] of Object.entries(initialState.hands)) {
      handsUpdate[`rooms/${myRoomCode}/hands/${pid}`] = hand;
    }

    // 게임 상태 구성 (손패 제외)
    const gameStateToSave = {
      deck: initialState.deck,
      discardPile: initialState.discardPile,
      currentColor: initialState.currentColor,
      currentPlayer: initialState.currentPlayer,
      direction: initialState.direction,
      drawCount: initialState.drawCount,
      unoCalledBy: null,
      started: true,
      finished: false,
      winner: null,
      lastAction: { type: 'game_start', timestamp: Date.now() }
    };

    // 플레이어 순서 저장
    const playerOrder = {};
    playerIds.forEach((id, i) => { playerOrder[i] = id; });
    gameStateToSave.playerOrder = playerOrder;
    gameStateToSave.playerCount = playerIds.length;

    // 초기 손패 개수 저장
    const handCounts = {};
    for (const [pid, hand] of Object.entries(initialState.hands)) {
      handCounts[pid] = hand.length;
    }
    gameStateToSave.handCounts = handCounts;

    // 단일 트랜잭션 업데이트로 모든 방원들이 즉시 갱신되도록 처리
    await update(ref(database), {
      [`rooms/${myRoomCode}/gameState`]: gameStateToSave,
      [`rooms/${myRoomCode}/status`]: 'playing',
      [`rooms/${myRoomCode}/emotes`]: null, // 감정표현 초기화
      ...handsUpdate
    });
  } catch (err) {
    console.error('게임 재시작 실패:', err);
    alert('게임 재시작 중 오류가 발생했습니다.');
  }
}

// ─── 감정표현 ────────────────────────────────────

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
      listEl.classList.remove('open');
      sendEmote(emote);
    });
  });

  // 토글 버튼
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (emoteCooldown) {
      showFloatMsg('감정표현 쿨타임 중...');
      return;
    }
    listEl.classList.toggle('open');
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', () => {
    listEl.classList.remove('open');
  });
}

async function sendEmote(emote) {
  if (emoteCooldown) return;

  emoteCooldown = true;
  const toggleBtn = document.getElementById('btn-emote-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = '⏳';
    toggleBtn.classList.add('cooldown');
  }

  // Firebase에 저장
  try {
    await update(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`), {
      emote,
      senderName: myName,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('감정표현 전송 실패:', e);
  }

  // 내 화면에서도 보이게 (자기 자신 팝업)
  showEmotePopupSelf(emote);

  // 2초 쿨타임
  setTimeout(() => {
    emoteCooldown = false;
    if (toggleBtn) {
      toggleBtn.textContent = '😊';
      toggleBtn.classList.remove('cooldown');
    }
  }, 2000);
}

// 이미 표시된 감정표현 타임스탬프 추적 (중복 방지)
const shownEmoteTimestamps = new Set();

function showEmotePopup(playerId, emote, timestamp) {
  // 중복 방지
  const key = `${playerId}_${timestamp}`;
  if (shownEmoteTimestamps.has(key)) return;
  shownEmoteTimestamps.add(key);

  // 최신 것만 유지 (메모리 관리)
  if (shownEmoteTimestamps.size > 50) {
    const first = shownEmoteTimestamps.values().next().value;
    shownEmoteTimestamps.delete(first);
  }

  // 플레이어 사이드바 아이템 위치 기준으로 팝업
  const playerEl = document.querySelector(`[data-pid="${playerId}"]`);
  if (!playerEl) return;

  const rect = playerEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  popup.textContent = emote;
  popup.style.left = `${rect.right + 10}px`;
  popup.style.top = `${rect.top}px`;

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 3100);
}

function showEmotePopupSelf(emote) {
  // 자기 자신의 팝업은 화면 중앙 하단에 표시
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  popup.textContent = emote;
  popup.style.left = '50%';
  popup.style.bottom = '220px';
  popup.style.transform = 'translateX(-50%)';
  popup.style.fontSize = '3rem';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 3100);
}

// ─── 이벤트 바인딩 ───────────────────────────────

function bindGameEvents() {
  // 카드 뽑기
  document.getElementById('draw-pile')?.addEventListener('click', handleDrawCard);
  document.getElementById('btn-draw')?.addEventListener('click', handleDrawCard);

  // UNO 선언
  document.getElementById('btn-uno')?.addEventListener('click', handleUnoCall);

  // UNO 잡기
  document.getElementById('btn-catch-uno')?.addEventListener('click', handleCatchUno);

  // 게임 다시 시작 (방장만)
  document.getElementById('btn-restart-game')?.addEventListener('click', handleRestartGame);

  // 게임 종료 후 로비로
  document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
    // 방은 삭제하지 않고 그냥 나가기
    sessionStorage.removeItem('uno_room_code');
    window.location.href = 'index.html';
  });

  // 게임 나가기
  document.getElementById('btn-leave-game')?.addEventListener('click', () => {
    if (confirm('게임을 나가시겠습니까? 다른 플레이어들은 계속 진행됩니다.')) {
      sessionStorage.removeItem('uno_room_code');
      window.location.href = 'index.html';
    }
  });
}

// ─── 유틸리티 ────────────────────────────────────

function getAvatar(name) {
  const emojis = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
  return emojis[name?.charCodeAt(0) % emojis.length] || '🎮';
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let floatTimer = null;
function showFloatMsg(text, duration = 1500) {
  let el = document.getElementById('float-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'float-msg';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(() => el.classList.remove('show'), duration);
}
