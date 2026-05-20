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
let unoCallTimer = null;   // UNO 패널티 자동 카운트다운 타이머
let hasCalledUno = false;  // UNO 선언 여부 (로컬)
let isHost = false;        // 방장 여부
let emoteCooldown = false; // 감정표현 쿨타임 (현재 미사용)
let unoPenaltyTimer = null; // 자동 패널티 타이머 (3초 카운트다운용)
let isHandlingPenalty = false; // 패널티 중복 처리 방지 락 플래그
let isLeaving = false;       // 퇴장 중복 방지 플래그
let unoCooldown = false;     // UNO 버튼 쿨타임 상태 플래그
let unoCooldownTimer = null; // 쿨타임 타이머
let lastProcessedPenaltyTimestamp = 0; // 중복 패널티 처리 방지용 타임스탬프

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

    if (room.status === 'waiting') {
      // 대기실 상태로 전환: 리스너 먼저 전부 해제 후 이동 (재초기화 타이밍 버그 방지)
      cleanupListeners();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.location.href = 'index.html';
      return;
    }

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

/** 모든 Firebase 실시간 리스너를 즉시 해제 (중복 실행 방지) */
function cleanupListeners() {
  listeners.forEach(({ unsub }) => {
    try { unsub(); } catch (e) { /* 무시 */ }
  });
  listeners.length = 0; // 배열 비우기
}

async function checkIfHostAndInit() {
  const snapshot = await get(ref(database, `rooms/${myRoomCode}`));
  if (!snapshot.exists()) return;

  const room = snapshot.val();
  // 오직 방 상태가 'playing'일 때만 자동으로 게임 초기화 실행
  if (room.status === 'playing' && room.host === myPlayerId && !room.gameState) {
    // 방장이 게임 초기화
    await initNewGame(room);
  }
}

async function initNewGame(room) {
  const rawPlayerIds = Object.keys(room.players || {});
  
  // [★ 요구사항 1] 봇전이든 멀티플레이든 방장(나)의 차례가 무조건 첫 번째가 되도록 playerIds 순서 재정렬
  const hostId = room.host;
  const playerIds = [hostId, ...rawPlayerIds.filter(id => id !== hostId)];

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

  // UNO 버튼 상태 업데이트
  checkUnoStatus();

  // UNO 패널티 대상이 나면 처리
  handleUnoPenaltyIfTarget();

  // [★ 봇 우노잡기 AI 엔진] 누군가 1장이 되었는데 우노를 안 외쳤다면 봇들이 랜덤 확률/딜레이로 우노잡기를 시도
  if (isHost) {
    checkBotsUnoCatch();
  }

  // [★ AI 대행 엔진] 봇 플레이어가 현재 차례이고 내가 방장(Host)인 경우 봇 턴 대행 연산 실행
  if (gameState.currentPlayer && gameState.currentPlayer.startsWith('bot_') && isHost) {
    triggerBotTurn(gameState.currentPlayer);
  }
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
    const playable = isMyTurn && topCard && isValidPlay(card, topCard, currentColor, gameState?.drawCount || 0);
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

  // 내 손패가 2장 이상인데 내가 UNO를 외친 상태로 저장되어 있다면 Firebase 상태 초기화
  if (myHand.length > 1 && gameState && gameState.unoCalledBy === myPlayerId) {
    update(ref(database, `rooms/${myRoomCode}/gameState`), {
      unoCalledBy: null,
      unoTimestamp: null
    }).catch(err => console.error("UNO 외침 초기화 실패:", err));
  }

  // 손패 갱신 시 UNO 버튼 상태 즉시 업데이트
  checkUnoStatus();
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
  const rawOrder = gameState?.playerOrder ? Object.values(gameState.playerOrder) : Object.keys(players);
  // 방장(나)이 무조건 플레이어 사이드바 목록의 최상단에 오도록 배치 순서 정렬
  const hostId = room.host;
  const order = rawOrder.includes(hostId)
    ? [hostId, ...rawOrder.filter(id => id !== hostId)]
    : rawOrder;
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
      <div class="player-sidebar-avatar">${getAvatar(pid, room)}</div>
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
    // 와일드 카드는 1번 클릭에 바로 색상 선택 모달 열기
    showColorPicker(card);
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

  if (!isValidPlay(card, topCard, gameState.currentColor, gameState.drawCount || 0)) {
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

// ─── UNO 시스템 (선언 + 잡기 통합) ────────────────

/**
 * 통합 UNO 버튼 클릭 핸들러
 * - 내가 1장이고 아직 선언 안 했으면 → UNO 선언
 * - 상대가 1장이고 선언 안 했으면 → UNO 잡기 (패널티 부여)
 */
async function handleUnoBtn() {
  if (unoCooldown) return;

  // 클릭 즉시 쿨타임 3초 돌리기 (연타 차단 및 모든 상태에 공유)
  startUnoCooldown();

  // 1) 내가 1장이고 아직 선언 안 한 상태 → 내 UNO 선언
  const myHandCount = myHand.length;
  if (myHandCount === 1 && gameState?.unoCalledBy !== myPlayerId) {
    await doUnoCall();
    return;
  }

  // 2) 잡을 수 있는 상대가 있으면 → UNO 잡기
  const catchTarget = getCatchableTarget();
  if (catchTarget) {
    await doCatchUno(catchTarget);
    return;
  }

  showFloatMsg('지금은 UNO를 외치거나 잡을 수 없습니다!');
}

/** UNO 버튼 3초 쿨타임 처리 */
function startUnoCooldown() {
  unoCooldown = true;
  const unoBtn = document.getElementById('btn-uno');
  if (!unoBtn) return;

  let secondsLeft = 3;
  unoBtn.disabled = true;
  unoBtn.className = 'btn-uno-disabled';
  unoBtn.style.opacity = '0.6';
  unoBtn.style.cursor = 'not-allowed';
  unoBtn.textContent = `⏳ 대기 (${secondsLeft}초)`;

  unoCooldownTimer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(unoCooldownTimer);
      unoCooldown = false;
      unoBtn.disabled = false;
      unoBtn.style.opacity = '1';
      unoBtn.style.cursor = 'pointer';
      checkUnoStatus(); // 쿨타임 해제 후 상태 업데이트
    } else {
      unoBtn.textContent = `⏳ 대기 (${secondsLeft}초)`;
    }
  }, 1000);
}

/** UNO 선언 실행 */
async function doUnoCall() {
  hasCalledUno = true;

  // Firebase에 UNO 선언 기록
  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    unoCalledBy: myPlayerId,
    unoTimestamp: Date.now(),
    lastAction: {
      type: 'uno_call',
      playerName: myName,
      playerId: myPlayerId,
      timestamp: Date.now()
    }
  });

  playUnoCall();
  showFloatMsg('UNO!! 🔔', 2000);

  // 버튼 잠시 비활성화 (중복 방지)
  const unoBtn = document.getElementById('btn-uno');
  if (unoBtn) {
    unoBtn.disabled = true;
    setTimeout(() => { unoBtn.disabled = false; checkUnoStatus(); }, 1500);
  }
}

/** UNO 잡기 실행 */
async function doCatchUno(targetPlayerId) {
  showFloatMsg('🚨 UNO 안 외쳤죠?! 패널티 +2장!', 2500);

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    unoPenaltyTarget: targetPlayerId,
    unoPenaltyTimestamp: Date.now(), // 고유 패널티 ID (타임스탬프) 부여
    unoCalledBy: null,
    unoTimestamp: null,
    lastAction: {
      type: 'uno_penalty',
      playerName: myName,
      targetPlayerId,
      timestamp: Date.now()
    }
  });

  // 패널티 대상이 나 자신의 클라이언트에서 카드 뽑기 처리
  // → Firebase 리스너가 unoPenaltyTarget을 보고 해당 플레이어가 직접 처리
  if (unoBtn) setTimeout(() => { unoBtn.disabled = false; }, 1500);
}

/**
 * UNO 잡기 가능한 상대 플레이어 ID 반환
 * 1장이고, 본인이 UNO 선언하지 않은 플레이어
 */
function getCatchableTarget() {
  if (!gameState) return null;
  const handCounts = gameState.handCounts || {};
  const unoCalledBy = gameState.unoCalledBy;

  for (const [pid, count] of Object.entries(handCounts)) {
    if (count === 1 && pid !== myPlayerId && pid !== unoCalledBy) {
      return pid;
    }
  }
  return null;
}

/**
 * UNO 버튼 상태 업데이트
 * 매 gameState/handCounts 업데이트마다 호출됨
 */
function checkUnoStatus() {
  if (unoCooldown) return; // 쿨타임 중일 때는 텍스트/상태 업데이트 생략
  if (!gameState) return;
  const unoBtn = document.getElementById('btn-uno');
  if (!unoBtn) return;

  const myCount = myHand.length;
  const handCounts = gameState.handCounts || {};
  const unoCalledBy = gameState.unoCalledBy;

  // 내가 1장이고 아직 UNO 안 외친 상태
  const canCall = myCount === 1 && unoCalledBy !== myPlayerId;
  // 잡을 수 있는 상대가 있는지
  const catchTarget = getCatchableTarget();

  // UNO 버튼은 항상 보이게 설정하며 평소에도 상시 클릭 가능
  unoBtn.style.display = 'inline-flex';
  unoBtn.disabled = false;
  unoBtn.style.opacity = '1';
  unoBtn.style.cursor = 'pointer';

  if (canCall) {
    // 내 UNO 선언 모드
    unoBtn.textContent = '🔔 UNO!';
    unoBtn.className = 'btn-uno-call';
    unoBtn.setAttribute('title', '지금 UNO를 외치세요! 안 외치면 패널티!');
  } else if (catchTarget) {
    // 잡기 모드
    unoBtn.textContent = '🚨 UNO 잡기!';
    unoBtn.className = 'btn-uno-catch';
    unoBtn.setAttribute('title', 'UNO를 외치지 않은 상대를 잡으세요!');
  } else {
    // 평소 모드 (상시 클릭 가능하며 동일한 골드 스타일 유지)
    unoBtn.textContent = '🔔 UNO';
    unoBtn.className = 'btn-uno-disabled';
    unoBtn.setAttribute('title', 'UNO를 외칠 상황은 아니지만 클릭해 볼 수 있습니다.');
  }
}

/**
 * UNO 패널티 처리 (Firebase에서 unoPenaltyTarget 감지 시)
 * 패널티 대상 플레이어가 직접 카드를 뽑아 저장
 */
async function handleUnoPenaltyIfTarget() {
  if (isHandlingPenalty) return;
  if (!gameState?.unoPenaltyTarget) return;
  if (gameState.unoPenaltyTarget !== myPlayerId) return;

  const penaltyTs = gameState.unoPenaltyTimestamp || 0;
  // 이미 이 타임스탬프의 패널티를 수령 완료했다면 조기 중단 (중복 드로우 차단)
  if (penaltyTs !== 0 && lastProcessedPenaltyTimestamp === penaltyTs) {
    return;
  }

  isHandlingPenalty = true;
  lastProcessedPenaltyTimestamp = penaltyTs; // 로컬 기록 갱신

  try {
    const deckData = gameState.deck;
    let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
    const drawn = [];

    // 2장 뽑기
    for (let i = 0; i < 2; i++) {
      if (deck.length === 0) {
        const discardArr = Array.isArray(gameState.discardPile)
          ? gameState.discardPile : Object.values(gameState.discardPile);
        deck = shuffleDeck([...discardArr.slice(0, -1)]);
      }
      if (deck.length > 0) drawn.push(deck.shift());
    }

    const newHand = [...myHand, ...drawn];
    const handCounts = { ...(gameState.handCounts || {}) };
    handCounts[myPlayerId] = newHand.length;

    // unoPenaltyTarget, unoPenaltyTimestamp 클리어 + 손패 업데이트
    await update(ref(database), {
      [`rooms/${myRoomCode}/hands/${myPlayerId}`]: newHand,
      [`rooms/${myRoomCode}/gameState/deck`]: deck,
      [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
      [`rooms/${myRoomCode}/gameState/unoPenaltyTarget`]: null,
      [`rooms/${myRoomCode}/gameState/unoPenaltyTimestamp`]: null
    });

    showFloatMsg('패널티! 카드 2장을 받았습니다 😱', 2000);
    playDrawPenalty();
  } catch (error) {
    console.error("UNO 패널티 처리 중 오류 발생:", error);
  } finally {
    isHandlingPenalty = false;
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
    const rawPlayerIds = Object.keys(room.players || {});
    const hostId = room.host;
    const playerIds = [hostId, ...rawPlayerIds.filter(id => id !== hostId)];

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

  // 개별 이모지 클릭 (보내도 이모지 창을 닫지 않음)
  listEl.querySelectorAll('.emote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.dataset.emote;
      sendEmote(emote);
    });
  });

  // 토글 버튼
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    listEl.classList.toggle('open');
  });

  // 외부 클릭 시 닫는 로직 제거 (수동으로 다시 토글 버튼을 눌러야 닫히게 설정)
}

// 감정표현 쿨타임 추적 변수
let isEmoteCooldown = false;

async function sendEmote(emote) {
  if (isEmoteCooldown) return; // 쿨타임 중이면 전송 무시
  isEmoteCooldown = true;

  const toggleBtn = document.getElementById('btn-emote-toggle');
  const originalHtml = toggleBtn ? toggleBtn.innerHTML : '😊';

  if (toggleBtn) {
    toggleBtn.classList.add('cooldown');
    toggleBtn.disabled = true;
    toggleBtn.innerHTML = '⏳';
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

  // 내 화면에서도 플레이어 사이드바 내 이름 오른쪽에 이모지가 팝업되도록 설정
  showEmotePopup(myPlayerId, emote, Date.now());

  // 1초(1000ms) 쿨타임 후 상태 원상 복구
  setTimeout(() => {
    isEmoteCooldown = false;
    if (toggleBtn) {
      toggleBtn.classList.remove('cooldown');
      toggleBtn.disabled = false;
      toggleBtn.innerHTML = originalHtml;
    }
  }, 1000);
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

// 브라우저 닫기/새로고침 시 이탈 처리 핸들러
const handleBeforeUnload = () => {
  leaveGameRoom();
};

function bindGameEvents() {
  // 카드 뽑기
  document.getElementById('draw-pile')?.addEventListener('click', handleDrawCard);
  document.getElementById('btn-draw')?.addEventListener('click', handleDrawCard);

  // UNO 선언 / 잡기 통합 버튼
  document.getElementById('btn-uno')?.addEventListener('click', handleUnoBtn);

  // 게임 다시 시작 (방장만)
  document.getElementById('btn-restart-game')?.addEventListener('click', handleRestartGame);

  // 게임 종료 후 대기실 복귀
  document.getElementById('btn-back-lobby')?.addEventListener('click', async () => {
    // 리스너 먼저 전부 해제 (이후 Firebase 변경이 루프를 일으키지 않도록)
    cleanupListeners();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    if (isHost) {
      try {
        // [★ 요구사항 3] 대기실로 복귀할 때 방에 있던 봇(bot_)들을 데이터베이스에서 완벽하게 제거
        const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
        const updates = {
          [`rooms/${myRoomCode}/status`]: 'waiting',
          [`rooms/${myRoomCode}/gameState`]: null,
          [`rooms/${myRoomCode}/winnerName`]: null,
          [`rooms/${myRoomCode}/winnerPlayerId`]: null,
          [`rooms/${myRoomCode}/emotes`]: null
        };

        if (roomSnap.exists()) {
          const roomData = roomSnap.val();
          const players = roomData.players || {};
          
          Object.keys(players).forEach(pid => {
            if (pid.startsWith('bot_')) {
              // 봇 플레이어 삭제
              updates[`rooms/${myRoomCode}/players/${pid}`] = null;
              // 봇 손패 삭제
              updates[`rooms/${myRoomCode}/hands/${pid}`] = null;
            }
          });
        }

        await update(ref(database), updates);
        window.location.href = 'index.html';
      } catch (err) {
        console.error("대기실 복귀 처리 실패:", err);
        window.location.href = 'index.html';
      }
    } else {
      window.location.href = 'index.html';
    }
  });

  // 게임 나가기
  document.getElementById('btn-leave-game')?.addEventListener('click', () => {
    if (confirm('게임을 나가시겠습니까? 다른 플레이어들은 계속 진행됩니다.')) {
      leaveGameRoom();
    }
  });

  // 브라우저 닫기/새로고침 시 이탈 처리
  window.addEventListener('beforeunload', handleBeforeUnload);
}

// ─── 유틸리티 ────────────────────────────────────

function getAvatar(playerIdOrName, roomData) {
  // 1) 방 데이터에서 커스텀 아바타(이모지) 추출 시도
  if (roomData && roomData.players && roomData.players[playerIdOrName]) {
    const player = roomData.players[playerIdOrName];
    if (player.avatar) return player.avatar;
  }

  // 2) 이모지 문자열 자체가 전달된 경우 바로 반환
  const emojis = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
  if (emojis.includes(playerIdOrName)) return playerIdOrName;

  // 3) 폴백: 문자열 해시 코드를 기반으로 기본 배정
  const nameStr = String(playerIdOrName || '플레이어');
  return emojis[nameStr.charCodeAt(0) % emojis.length] || '🎮';
}

// ─── 중간 이탈자 방출 처리 ────────────────────────
async function leaveGameRoom() {
  if (isLeaving) return;
  isLeaving = true;

  try {
    const roomRef = ref(database, `rooms/${myRoomCode}`);
    const snap = await get(roomRef);
    if (!snap.exists()) {
      redirectToLobby();
      return;
    }

    const room = snap.val();
    const players = room.players || {};
    const playerIds = Object.keys(players);

    // 나를 제외한 남은 플레이어 목록
    const remainingIds = playerIds.filter(id => id !== myPlayerId);

    // 나를 제외한 남은 실제 유저 목록 (봇 제외)
    const remainingHumanIds = remainingIds.filter(id => !id.startsWith('bot_'));

    // 1) 실제 유저가 나 혼자였던 방(싱글 봇전 포함)이면 방 삭제 후 메인으로
    if (remainingHumanIds.length === 0) {
      await remove(roomRef);
      redirectToLobby();
      return;
    }

    const updates = {};

    // 2) 게임 진행 중이었던 경우
    if (room.status === 'playing' && room.gameState) {
      // [★ 2인 이탈] 세션 유지한 채로 대기방으로 함께 이동
      if (playerIds.length === 2) {
        updates[`rooms/${myRoomCode}/status`] = 'waiting';
        updates[`rooms/${myRoomCode}/gameState`] = null;
        updates[`rooms/${myRoomCode}/winnerName`] = null;
        updates[`rooms/${myRoomCode}/winnerPlayerId`] = null;
        updates[`rooms/${myRoomCode}/emotes`] = null;

        // 리스너 전부 해제 후 업데이트 (재초기화 방지)
        cleanupListeners();
        window.removeEventListener('beforeunload', handleBeforeUnload);
        await update(ref(database), updates);

        // 세션(방코드) 유지하여 index.html에서 대기실로 자동 복원
        window.location.href = 'index.html';
        return;
      }

      // 플레이어가 3명 이상일 때 1명이 나가는 경우:
      // 나간 플레이어를 완전히 방에서 삭제하고 세션 파괴, 남은 사람들끼리 진행!
      if (room.host === myPlayerId) {
        updates[`rooms/${myRoomCode}/host`] = remainingIds[0];
      }

      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      updates[`rooms/${myRoomCode}/hands/${myPlayerId}`] = null;
      if (room.emotes && room.emotes[myPlayerId]) {
        updates[`rooms/${myRoomCode}/emotes/${myPlayerId}`] = null;
      }

      const currentGameState = room.gameState;
      const currentOrder = currentGameState.playerOrder ? Object.values(currentGameState.playerOrder) : [];
      const myIndex = currentOrder.indexOf(myPlayerId);

      // 새 playerOrder 구성
      const newOrderList = currentOrder.filter(id => id !== myPlayerId);
      const newPlayerOrder = {};
      newOrderList.forEach((id, i) => {
        newPlayerOrder[i] = id;
      });

      // 현재 턴이 나였다면 다음 생존 플레이어에게 인계
      let nextPlayer = currentGameState.currentPlayer;
      if (currentGameState.currentPlayer === myPlayerId) {
        const dir = currentGameState.direction || 1;
        let nextIdx = (myIndex + dir + currentOrder.length) % currentOrder.length;
        nextPlayer = currentOrder[nextIdx];
        if (!newOrderList.includes(nextPlayer)) {
          nextPlayer = newOrderList[0];
        }
      }

      // handCounts에서 제거
      const newHandCounts = { ...(currentGameState.handCounts || {}) };
      delete newHandCounts[myPlayerId];

      updates[`rooms/${myRoomCode}/gameState/playerOrder`] = newPlayerOrder;
      updates[`rooms/${myRoomCode}/gameState/playerCount`] = newOrderList.length;
      updates[`rooms/${myRoomCode}/gameState/currentPlayer`] = nextPlayer;
      updates[`rooms/${myRoomCode}/gameState/handCounts`] = newHandCounts;
      updates[`rooms/${myRoomCode}/gameState/lastAction`] = {
        type: 'leave',
        playerName: myName,
        message: `🚪 ${myName}님이 게임을 나갔습니다.`,
        timestamp: Date.now()
      };

      await update(ref(database), updates);
      redirectToLobby();
      return;
    }

    // 게임 시작 대기 중이거나 이미 종료된 방에서 나가는 경우
    if (room.host === myPlayerId) {
      await remove(roomRef);
    } else {
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      await update(ref(database), updates);
    }
    redirectToLobby();
  } catch (err) {
    console.error("퇴장 처리 중 오류 발생:", err);
    redirectToLobby();
  }
}

function redirectToLobby(keepSession = false) {
  if (!keepSession) {
    // 완전히 방을 나갈 때는 세션 정리
    sessionStorage.removeItem('uno_room_code');
  }
  window.location.href = 'index.html';
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

// ─── [★ AI 컴퓨터 플레이어 대행 엔진] ────────────────
let activeBotThinkings = {}; // 봇 작동 상태 중복 방지 맵
let botUnoTimer = null;      // 봇 우노 타이밍용 타이머
let botUnoCatchTimer = null; // 봇 우노잡기용 타이머

/** 봇들의 우노잡기 AI 연산 */
function checkBotsUnoCatch() {
  if (!isHost || !gameState || gameState.finished) return;

  // 봇 입장에서 잡을 수 있는 대상(손패가 1장이고 아직 우노를 안 외친 플레이어) 확인
  const catchTarget = getCatchableTargetForBots();
  if (!catchTarget) {
    if (botUnoCatchTimer) {
      clearTimeout(botUnoCatchTimer);
      botUnoCatchTimer = null;
    }
    return;
  }

  // 이미 봇이 우노잡기 실행을 준비 중이라면 중복 타이머 방지
  if (botUnoCatchTimer) return;

  // 봇이 우노잡기 버튼을 누를 때까지의 반응 속도 딜레이 (0.8초 ~ 1.8초로 랜덤)
  // 유저가 이 사이에 먼저 우노 선언을 하거나, 유저가 먼저 우노잡기를 클릭하면 타이머는 무효화됩니다.
  const catchDelay = 800 + Math.random() * 1000;

  botUnoCatchTimer = setTimeout(async () => {
    try {
      // 타이머가 동작한 순간, 여전히 상대방이 1장이고 우노를 안 외쳤는지 DB 최신 상태 재조회
      const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
      if (!snap.exists()) return;
      const curState = snap.val();

      const handCounts = curState.handCounts || {};
      const unoCalledBy = curState.unoCalledBy;

      // 여전히 1장인 상태이고 우노가 선언되지 않았는지 체크
      if (handCounts[catchTarget] === 1 && !unoCalledBy && !curState.finished) {
        // 이 방에 있는 봇(컴퓨터) 리스트 가져오기 (단, 잡히는 대상이 봇인 경우 그 봇 자신은 잡기에서 제외)
        const playersRef = ref(database, `rooms/${myRoomCode}/players`);
        const pSnap = await get(playersRef);
        if (!pSnap.exists()) return;
        const players = pSnap.val();

        const botIds = Object.keys(players).filter(id => id.startsWith('bot_') && id !== catchTarget);
        if (botIds.length === 0) return;

        // 살아있는 봇 중 하나가 랜덤하게 우노잡기를 선언한 것으로 처리
        const luckyBotId = botIds[Math.floor(Math.random() * botIds.length)];
        const botName = players[luckyBotId]?.name || '컴퓨터 봇';

        showFloatMsg(`🚨 [우노잡기] 컴퓨터(${botName})가 먼저 잡았습니다! 패널티 +2장!`, 3000);
        playDrawPenalty();

        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          unoPenaltyTarget: catchTarget,
          unoPenaltyTimestamp: Date.now(),
          unoCalledBy: null,
          unoTimestamp: null,
          lastAction: {
            type: 'uno_penalty',
            playerName: botName,
            targetPlayerId: catchTarget,
            timestamp: Date.now()
          }
        });
      }
    } catch (e) {
      console.error("[AI 우노잡기] 대행 처리 실패:", e);
    } finally {
      botUnoCatchTimer = null;
    }
  }, catchDelay);
}

/** 봇 시점에서의 우노잡기 타겟 검출 */
function getCatchableTargetForBots() {
  if (!gameState) return null;
  const handCounts = gameState.handCounts || {};
  const unoCalledBy = gameState.unoCalledBy;

  for (const [pid, count] of Object.entries(handCounts)) {
    // 손패가 1장이고 아직 우노를 성공적으로 외치지 않은 모든 플레이어가 잡기 후보 대상
    if (count === 1 && pid !== unoCalledBy) {
      return pid;
    }
  }
  return null;
}

function triggerBotTurn(botId) {
  if (!gameState) return;
  const topCard = gameState.discardPile 
    ? (Array.isArray(gameState.discardPile) 
        ? gameState.discardPile[gameState.discardPile.length - 1] 
        : Object.values(gameState.discardPile)[Object.values(gameState.discardPile).length - 1])
    : null;
  const topCardId = topCard ? topCard.id : 'no_card';
  // 봇ID + 버린 더미 탑 카드의 ID + 마지막 액션 타임스탬프를 묶어서 고유 락 키 생성
  const lockKey = `${botId}_${topCardId}_${gameState.lastAction?.timestamp || 0}`;

  // 이미 해당 봇이 이 동일한 게임 상태(턴 및 버린 카드 상태)에서 연산 중이면 무시
  if (activeBotThinkings[lockKey]) return;
  activeBotThinkings[lockKey] = true;

  // 봇의 자연스러운 고민 시간 부여 (2.2초 ~ 4.0초로 느리고 불규칙하게 조절)
  const thinkDelay = 2200 + Math.random() * 1800;

  setTimeout(async () => {
    try {
      await executeBotAction(botId);
    } catch (e) {
      console.error(`[AI ${botId}] 행동 수행 중 에러:`, e);
    } finally {
      // 연산이 완료되거나 실패했을 때 락 해제
      delete activeBotThinkings[lockKey];
    }
  }, thinkDelay);
}

async function executeBotAction(botId) {
  // 최신 게임 상태 확인
  if (!gameState || gameState.currentPlayer !== botId || gameState.finished) return;

  // 1) 봇의 손패 데이터 가져오기
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${botId}`);
  const snap = await get(handRef);
  if (!snap.exists()) return;

  const botHand = Array.isArray(snap.val()) ? snap.val() : Object.values(snap.val());
  const playerIds = Object.values(gameState.playerOrder || {});
  const discardArr = Array.isArray(gameState.discardPile)
    ? gameState.discardPile : Object.values(gameState.discardPile);
  const topCard = discardArr[discardArr.length - 1];

  // 2) 낼 수 있는 카드들 필터링
  const playableCards = botHand.filter(card => isValidPlay(card, topCard, gameState.currentColor, gameState.drawCount || 0));

  // 3) [낼 카드가 없는 경우] -> 1장 뽑고 다음 사람에게 넘김
  if (playableCards.length === 0) {
    const drawCount = gameState.drawCount > 0 ? gameState.drawCount : 1;
    const deckData = gameState.deck;
    let deck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
    const drawn = [];

    for (let i = 0; i < drawCount; i++) {
      if (deck.length === 0) {
        const reshuffled = shuffleDeck([...discardArr.slice(0, -1)]);
        deck = reshuffled;
      }
      if (deck.length > 0) {
        drawn.push(deck.shift());
      }
    }

    const newHand = [...botHand, ...drawn];
    const nextPlayer = playerIds[(playerIds.indexOf(botId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];
    const handCounts = { ...(gameState.handCounts || {}) };
    handCounts[botId] = newHand.length;

    const updates = {
      [`rooms/${myRoomCode}/hands/${botId}`]: newHand,
      [`rooms/${myRoomCode}/gameState/deck`]: deck,
      [`rooms/${myRoomCode}/gameState/drawCount`]: 0,
      [`rooms/${myRoomCode}/gameState/currentPlayer`]: nextPlayer,
      [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
      [`rooms/${myRoomCode}/gameState/lastAction`]: {
        type: drawCount > 1 ? 'draw_penalty' : 'draw_card',
        playerName: `컴퓨터(${roomPlayersCache[botId]?.name || '봇'})`,
        count: drawCount,
        timestamp: Date.now()
      }
    };

    // 만약 봇이 1장 상태였는데 카드를 뽑았다면, 해당 봇의 UNO 선언 자격을 박탈
    if (gameState.unoCalledBy === botId) {
      updates[`rooms/${myRoomCode}/gameState/unoCalledBy`] = null;
      updates[`rooms/${myRoomCode}/gameState/unoTimestamp`] = null;
    }

    await update(ref(database), updates);
    playCardDraw();
    return;
  }

  // 4) [낼 카드가 있는 경우] -> 인공지능 분석기로 최고의 카드 한 장 선정!
  const chosenCard = smartChooseCard(playableCards, botHand);

  // 내 손패에서 제거
  const newHand = botHand.filter(c => c.id !== chosenCard.id);

  // 카드 효과 계산
  const changes = processCardPlay(chosenCard, gameState, botId, playerIds);
  const newDiscardPile = [...discardArr, chosenCard];

  // 와일드 카드면 봇의 손패에 가장 많은 유리한 색상을 똑똑하게 계산해서 세팅!
  let chosenColor = chosenCard.color;
  if (chosenCard.type === CARD_TYPES.WILD || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) {
    chosenColor = botChooseColor(newHand);
  }

  // 덱 재섞기 필요 여부
  const deckData = gameState.deck;
  let newDeck = Array.isArray(deckData) ? [...deckData] : Object.values(deckData || {});
  if (newDeck.length < 5) {
    const reshuffled = shuffleDeck(newDiscardPile.slice(0, -1));
    newDeck = [...newDeck, ...reshuffled];
  }

  // 다음 플레이어 결정
  let nextPlayer = changes.nextPlayer
    || playerIds[(playerIds.indexOf(botId) + (gameState.direction || 1) + playerIds.length) % playerIds.length];

  const newDrawCount = changes.drawCount;
  const newDirection = changes.reverseDirection ? -(gameState.direction || 1) : (gameState.direction || 1);
  const hasWon = newHand.length === 0;

  const handCounts = { ...(gameState.handCounts || {}) };
  handCounts[botId] = newHand.length;

  const updates = {
    [`rooms/${myRoomCode}/hands/${botId}`]: newHand,
    [`rooms/${myRoomCode}/gameState/discardPile`]: newDiscardPile,
    [`rooms/${myRoomCode}/gameState/deck`]: newDeck,
    [`rooms/${myRoomCode}/gameState/currentPlayer`]: hasWon ? botId : nextPlayer,
    [`rooms/${myRoomCode}/gameState/currentColor`]: chosenColor,
    [`rooms/${myRoomCode}/gameState/direction`]: newDirection,
    [`rooms/${myRoomCode}/gameState/drawCount`]: newDrawCount,
    [`rooms/${myRoomCode}/gameState/handCounts`]: handCounts,
    [`rooms/${myRoomCode}/gameState/lastAction`]: {
      type: 'play_card',
      playerName: roomPlayersCache[botId]?.name || '봇',
      playerId: botId,
      card: chosenCard,
      timestamp: Date.now()
    }
  };

  if (hasWon) {
    updates[`rooms/${myRoomCode}/gameState/finished`] = true;
    updates[`rooms/${myRoomCode}/gameState/winner`] = botId;
    updates[`rooms/${myRoomCode}/status`] = 'finished';
    updates[`rooms/${myRoomCode}/winnerName`] = roomPlayersCache[botId]?.name || '봇';
    updates[`rooms/${myRoomCode}/winnerPlayerId`] = botId;
  }

  // 5) [🔔 중요: 봇의 우노(UNO) 타이밍 설계]
  // 봇의 손패가 정확히 1장이 될 때, 봇은 0.9초 뒤에 스스로 '우노!'를 외치게 타이머를 작동합니다.
  // 이 0.9초 이내에 유저가 재빨리 '우노 잡기!' 버튼을 누르면 봇의 우노가 잡힙니다!
  if (newHand.length === 1 && !hasWon) {
    // 이전 타이머 정리
    if (botUnoTimer) clearTimeout(botUnoTimer);

    // 0.9초 뒤 봇의 우노 자동 등록
    botUnoTimer = setTimeout(async () => {
      // 그 사이에 다른 사람에게 잡히지 않고, 봇이 여전히 1장 손패를 들고 있다면
      const currentSnap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
      if (!currentSnap.exists()) return;
      const curState = currentSnap.val();
      
      if (curState.handCounts && curState.handCounts[botId] === 1 && !curState.unoCalledBy) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          unoCalledBy: botId,
          unoTimestamp: Date.now(),
          lastAction: {
            type: 'uno_call',
            playerName: roomPlayersCache[botId]?.name || '봇',
            playerId: botId,
            timestamp: Date.now()
          }
        });
        playUnoCall();
        showFloatMsg(`🔔 컴퓨터(${roomPlayersCache[botId]?.name || '봇'})가 '우노!'를 먼저 외쳤습니다!`, 2000);
      }
    }, 900); // 유저가 잡을 수 있는 시간차(0.9초)
  }

  await update(ref(database), updates);
  playCardPlay();

  if (chosenCard.type === CARD_TYPES.WILD || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) playWild();
  if (chosenCard.type === CARD_TYPES.DRAW_TWO || chosenCard.type === CARD_TYPES.WILD_DRAW_FOUR) playDrawPenalty();
  if (hasWon) playLose(); // 봇이 이기면 유저는 패배 효과음
}

/** 
 * 똑똑한 카드 선별 인공지능 분석기 
 * - 상대(특히 유저) 손패가 1~3장이면 공격 카드를 우선적으로 날림!
 * - 그렇지 않으면 가장 점수가 리스크한 카드(숫자가 크거나 액션 카드) 순으로 방출!
 */
function smartChooseCard(playableCards, hand) {
  if (playableCards.length === 1) return playableCards[0];

  // 다른 플레이어들의 최소 손패 개수 확인
  let minOpponentCards = 99;
  if (gameState && gameState.handCounts) {
    for (const [pid, count] of Object.entries(gameState.handCounts)) {
      if (pid !== gameState.currentPlayer) {
        minOpponentCards = Math.min(minOpponentCards, count);
      }
    }
  }

  // 상대방이 3장 이하인 위급 상황인가?
  const isEmergency = minOpponentCards <= 3;

  if (isEmergency) {
    // 상대 견제를 위해 강한 공격 카드들을 필터링 (+4, +2, Skip 순)
    const d4 = playableCards.find(c => c.type === CARD_TYPES.WILD_DRAW_FOUR);
    if (d4) return d4;
    const d2 = playableCards.find(c => c.type === CARD_TYPES.DRAW_TWO);
    if (d2) return d2;
    const skip = playableCards.find(c => c.type === CARD_TYPES.SKIP);
    if (skip) return skip;
  }

  // 특수 견제 상황이 아니거나, 공격 카드가 없는 경우 -> 점수가 가장 높은 카드를 털어서 리스크 회피
  // (점수 비중: 와일드(50) > 액션카드(20) > 높은 숫자순)
  return playableCards.reduce((bestCard, card) => {
    const getWeight = (c) => {
      if (c.type === CARD_TYPES.WILD_DRAW_FOUR || c.type === CARD_TYPES.WILD) return 50;
      if (c.type === CARD_TYPES.DRAW_TWO || c.type === CARD_TYPES.SKIP || c.type === CARD_TYPES.REVERSE) return 20;
      return c.value || 0;
    };
    return getWeight(card) > getWeight(bestCard) ? card : bestCard;
  }, playableCards[0]);
}

/**
 * 봇의 영리한 와일드 카드 색상 변경 선택기
 * 봇이 쥐고 있는 손패 중 "가장 많이 분포한 색상"을 조사해서 똑똑하게 선언함
 */
function botChooseColor(botHand) {
  if (!botHand || botHand.length === 0) return 'red';

  const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
  botHand.forEach(card => {
    if (counts[card.color] !== undefined) counts[card.color]++;
  });

  // 가장 빈도가 높은 색상 리턴
  let bestColor = 'red';
  let maxCount = -1;
  for (const [color, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestColor = color;
    }
  }
  return bestColor;
}

// 봇이 동작할 때 플레이어 캐시 맵 갱신을 위해 전역 캐시 갱신 로직 추가
let roomPlayersCache = {};
const originalUpdatePlayerSidebars = updatePlayerSidebars;
updatePlayerSidebars = function(room) {
  if (room && room.players) roomPlayersCache = room.players;
  originalUpdatePlayerSidebars(room);
};
