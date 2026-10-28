/**
 * 루미큐브 (Rummikub) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, set, serverTimestamp
} from './firebase-config.js';
import {
  createRummikubDeck, isValidSet, calculateSetScore, sortByNumber, sortByColor, botFindValidSet
} from './rummikub-rules.js';
import {
  playTilePlace, playMyTurn, playWin, playLose, playButtonClick, playError
} from './sound.js';

// URL 파라미터 파싱
const urlParams = new URLSearchParams(window.location.search);
const myRoomCode = urlParams.get('room');
const myPlayerId = urlParams.get('player');

if (!myRoomCode || !myPlayerId) {
  alert('방 코드 또는 플레이어 ID가 올바르지 않습니다.');
  window.location.href = 'index.html';
}

// ─── 상태 변수 ─────────────────────────────────────
let isHost = false;
let myName = '';
let myAvatar = '🧩';
let playersList = {};
let playerOrder = [];
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// 로컬 선택 타일 ID 목록
let selectedTileIds = new Set();

// DOM 요소
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const btnLeave = document.getElementById('btn-leave');

const playersStatusBar = document.getElementById('players-status-bar');
const boardZone = document.getElementById('board-zone');
const boardEmptyHint = document.getElementById('board-empty-hint');

const btnSortNum = document.getElementById('btn-sort-num');
const btnSortColor = document.getElementById('btn-sort-color');
const btnClearSelection = document.getElementById('btn-clear-selection');
const btnMeldTiles = document.getElementById('btn-meld-tiles');
const selectedCount = document.getElementById('selected-count');
const btnDrawTile = document.getElementById('btn-draw-tile');
const myTilesRack = document.getElementById('my-tiles-rack');

const resultModal = document.getElementById('result-modal');
const winnerTitle = document.getElementById('winner-title');
const winnerDesc = document.getElementById('winner-desc');
const btnModalLobby = document.getElementById('btn-modal-lobby');
const btnModalRestart = document.getElementById('btn-modal-restart');

// ─── 초기화 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  displayRoomCode.textContent = `ROOM: ${myRoomCode}`;
  bindUiEvents();

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!roomSnap.exists()) {
      alert('존재하지 않는 방입니다.');
      window.location.href = 'index.html';
      return;
    }

    const room = roomSnap.val();
    playersList = room.players || {};
    isHost = (room.host === myPlayerId);

    if (playersList[myPlayerId]) {
      myName = playersList[myPlayerId].name;
      myAvatar = playersList[myPlayerId].avatar || '🧩';
    }

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initRummikubGameState();
    }

    listenToRummikubRoom();

  } catch (err) {
    console.error('루미큐브 초기화 실패:', err);
  }
});

async function initRummikubGameState() {
  const pool = createRummikubDeck();
  const hands = {};
  const initialMelds = {};

  playerOrder.forEach(pid => {
    const hand = [];
    for (let i = 0; i < 14; i++) {
      if (pool.length > 0) hand.push(pool.pop());
    }
    hands[pid] = sortByColor(hand);
    initialMelds[pid] = false;
  });

  const newGs = {
    pool,
    hands,
    initialMelds,
    boardSets: [],
    turnIndex: 0,
    phase: 'playing',
    winnerId: null,
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

function listenToRummikubRoom() {
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  roomListener = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      alert('방이 종료되었습니다.');
      window.location.href = 'index.html';
      return;
    }

    const room = snapshot.val();
    playersList = room.players || {};

    // [★ 핵심] 방 상태가 waiting으로 환원되면 모든 유저가 함께 대기실로 이동
    if (room.status === 'waiting') {
      isNavigatingToLobby = true;
      window.location.href = 'index.html';
      return;
    }

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    const gs = room.gameState;
    if (!gs) return;

    currentGs = gs;
    renderRummikubGame(gs);

    checkRummikubBotAction(gs);
  });
}

function renderRummikubGame(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId && gs.phase === 'playing');
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🧩' };

  turnAvatar.textContent = currentPlayer.avatar || '🧩';
  if (isMyTurn) {
    turnText.textContent = '당신의 차례입니다! 세트를 내거나 타일을 뽑으세요.';
    turnText.style.color = 'var(--gold)';
  } else {
    turnText.textContent = `${currentPlayer.name} 님의 차례...`;
    turnText.style.color = '#F8FAFC';
  }

  renderPlayersStatusBar(gs, currentPid);
  renderBoardSets(gs.boardSets || []);
  renderMyRack(gs, isMyTurn);

  btnDrawTile.disabled = !isMyTurn;
  btnMeldTiles.disabled = !isMyTurn || selectedTileIds.size < 3;
  selectedCount.textContent = selectedTileIds.size;

  if (gs.phase === 'finished') {
    renderResultModal(gs);
  }
}

function renderPlayersStatusBar(gs, currentPid) {
  playersStatusBar.innerHTML = '';
  playerOrder.forEach(pid => {
    const p = playersList[pid] || { name: '플레이어', avatar: '👤' };
    const pHand = gs.hands?.[pid] || [];
    const hasMeld = gs.initialMelds?.[pid];
    const isCurrent = (pid === currentPid);

    const chip = document.createElement('div');
    chip.className = `player-status-chip ${isCurrent ? 'current-turn' : ''}`;
    chip.innerHTML = `
      <span>${p.avatar || '👤'}</span>
      <span>${escapeHtml(p.name)}: <strong>${pHand.length}장</strong></span>
      ${hasMeld ? '<span style="font-size:0.68rem; color:#2ED573; background:rgba(46,213,115,0.15); padding:1px 4px; border-radius:4px;">등록완료</span>' : ''}
    `;
    playersStatusBar.appendChild(chip);
  });
}

function renderBoardSets(boardSets) {
  if (boardSets.length === 0) {
    boardEmptyHint.style.display = 'flex';
    boardZone.querySelectorAll('.tile-set-cluster').forEach(el => el.remove());
    return;
  }

  boardEmptyHint.style.display = 'none';
  boardZone.querySelectorAll('.tile-set-cluster').forEach(el => el.remove());

  boardSets.forEach(setGroup => {
    const cluster = document.createElement('div');
    cluster.className = 'tile-set-cluster';

    setGroup.forEach(tile => {
      const tileEl = createTileElement(tile);
      cluster.appendChild(tileEl);
    });

    boardZone.appendChild(cluster);
  });
}

function renderMyRack(gs, isMyTurn) {
  myTilesRack.innerHTML = '';
  const myHand = gs.hands?.[myPlayerId] || [];

  myHand.forEach(tile => {
    const isSelected = selectedTileIds.has(tile.id);
    const tileEl = createTileElement(tile, isSelected);

    tileEl.addEventListener('click', () => {
      if (selectedTileIds.has(tile.id)) {
        selectedTileIds.delete(tile.id);
      } else {
        selectedTileIds.add(tile.id);
      }
      renderMyRack(gs, isMyTurn);
      btnMeldTiles.disabled = !isMyTurn || selectedTileIds.size < 3;
      selectedCount.textContent = selectedTileIds.size;
    });

    myTilesRack.appendChild(tileEl);
  });
}

function createTileElement(tile, isSelected = false) {
  const el = document.createElement('div');
  el.className = `rummi-tile ${tile.color} ${isSelected ? 'selected' : ''}`;
  
  if (tile.isJoker) {
    el.textContent = '★';
  } else {
    el.textContent = tile.value;
  }
  return el;
}

async function handleMeldTiles() {
  if (!currentGs || currentGs.phase !== 'playing') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  const myHand = currentGs.hands[myPlayerId] || [];
  const selectedTiles = myHand.filter(t => selectedTileIds.has(t.id));

  if (selectedTiles.length < 3) {
    showToast('세트는 최소 3개 이상의 타일이어야 합니다!');
    playError();
    return;
  }

  if (!isValidSet(selectedTiles)) {
    showToast('유효하지 않은 세트입니다! (그룹: 같은 숫자 다른 색 / 런: 같은 색 연속 숫자)');
    playError();
    return;
  }

  const hasInitialMeld = currentGs.initialMelds?.[myPlayerId];
  const setScore = calculateSetScore(selectedTiles);

  if (!hasInitialMeld && setScore < 30) {
    showToast(`최초 등록은 합계 30점 이상이어야 합니다! (현재 선택: ${setScore}점)`);
    playError();
    return;
  }

  playTilePlace();

  const remainingHand = myHand.filter(t => !selectedTileIds.has(t.id));
  const newBoardSets = [...(currentGs.boardSets || []), selectedTiles];
  selectedTileIds.clear();

  if (remainingHand.length === 0) {
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      [`hands/${myPlayerId}`]: [],
      boardSets: newBoardSets,
      [`initialMelds/${myPlayerId}`]: true,
      phase: 'finished',
      winnerId: myPlayerId,
      lastActionTime: Date.now()
    });
    return;
  }

  const nextTurnIndex = currentGs.turnIndex + 1;
  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    [`hands/${myPlayerId}`]: remainingHand,
    boardSets: newBoardSets,
    [`initialMelds/${myPlayerId}`]: true,
    turnIndex: nextTurnIndex,
    lastActionTime: Date.now()
  });

  if (playerOrder[nextTurnIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

async function handleDrawTile() {
  if (!currentGs || currentGs.phase !== 'playing') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playTilePlace();
  selectedTileIds.clear();

  const pool = [...(currentGs.pool || [])];
  let drawnTile = null;
  if (pool.length > 0) {
    drawnTile = pool.pop();
  }

  const myHand = [...(currentGs.hands[myPlayerId] || [])];
  if (drawnTile) myHand.push(drawnTile);

  const nextTurnIndex = currentGs.turnIndex + 1;

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    pool,
    [`hands/${myPlayerId}`]: myHand,
    turnIndex: nextTurnIndex,
    lastActionTime: Date.now()
  });

  if (playerOrder[nextTurnIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

function checkRummikubBotAction(gs) {
  if (!isHost || gs.phase === 'finished') return;

  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const player = playersList[currentPid];
  if (!player || !player.isBot) return;

  if (botActionTimer) clearTimeout(botActionTimer);

  botActionTimer = setTimeout(async () => {
    await runRummikubBotTurn(currentPid, gs);
  }, 1600);
}

async function runRummikubBotTurn(botId, gs) {
  const botHand = gs.hands?.[botId] || [];
  const hasMeld = gs.initialMelds?.[botId];

  const foundSet = botFindValidSet(botHand, hasMeld);

  if (foundSet) {
    playTilePlace();
    const setIds = new Set(foundSet.map(t => t.id));
    const nextHand = botHand.filter(t => !setIds.has(t.id));
    const nextBoardSets = [...(gs.boardSets || []), foundSet];

    if (nextHand.length === 0) {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        [`hands/${botId}`]: [],
        boardSets: nextBoardSets,
        [`initialMelds/${botId}`]: true,
        phase: 'finished',
        winnerId: botId
      });
      return;
    }

    const nextTurnIndex = gs.turnIndex + 1;
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      [`hands/${botId}`]: nextHand,
      boardSets: nextBoardSets,
      [`initialMelds/${botId}`]: true,
      turnIndex: nextTurnIndex
    });

  } else {
    playTilePlace();
    const pool = [...(gs.pool || [])];
    const nextHand = [...botHand];
    if (pool.length > 0) {
      nextHand.push(pool.pop());
    }

    const nextTurnIndex = gs.turnIndex + 1;
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      pool,
      [`hands/${botId}`]: nextHand,
      turnIndex: nextTurnIndex
    });
  }
}

function renderResultModal(gs) {
  const winner = playersList[gs.winnerId] || { name: '승리자' };
  const isMe = (gs.winnerId === myPlayerId);

  if (isMe) {
    playWin();
    winnerTitle.textContent = '🎉 루미큐브 달성! 승리!';
    winnerTitle.style.color = 'var(--gold)';
    winnerDesc.textContent = '손패의 모든 타일을 가장 먼저 털어내고 루미큐브를 달성했습니다!';
  } else {
    playLose();
    winnerTitle.textContent = `${winner.name} 님의 루미큐브!`;
    winnerTitle.style.color = '#F59E0B';
    winnerDesc.textContent = `${winner.name} 님이 손패의 타일을 모두 내려놓아 승리하였습니다.`;
  }

  btnModalRestart.style.display = isHost ? 'block' : 'none';
  resultModal.classList.add('show');
}

// ─── 중간 이탈 및 안전 종료 처리 ─────────────────────
async function handleLeaveGameSafely() {
  if (isNavigatingToLobby) return;
  isNavigatingToLobby = true;

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!roomSnap.exists()) {
      window.location.href = 'index.html';
      return;
    }

    const room = roomSnap.val();
    const players = room.players || {};
    const humanPlayerIds = Object.keys(players).filter(id => !id.startsWith('bot_') && id !== myPlayerId);

    if (humanPlayerIds.length === 0) {
      await remove(ref(database, `rooms/${myRoomCode}`));
    } else {
      const updates = {};
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      if (room.gameState && room.gameState.hands) {
        updates[`rooms/${myRoomCode}/gameState/hands/${myPlayerId}`] = null;
      }

      if (room.host === myPlayerId) {
        const nextHost = humanPlayerIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

      if (currentGs && playerOrder[currentGs.turnIndex % playerOrder.length] === myPlayerId) {
        updates[`rooms/${myRoomCode}/gameState/turnIndex`] = currentGs.turnIndex + 1;
      }

      await update(ref(database), updates);
    }
  } catch (err) {
    console.error('루미큐브 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnMeldTiles.addEventListener('click', handleMeldTiles);
  btnDrawTile.addEventListener('click', handleDrawTile);

  btnSortNum.addEventListener('click', () => {
    if (!currentGs) return;
    const myHand = currentGs.hands[myPlayerId] || [];
    currentGs.hands[myPlayerId] = sortByNumber(myHand);
    renderMyRack(currentGs, playerOrder[currentGs.turnIndex % playerOrder.length] === myPlayerId);
  });

  btnSortColor.addEventListener('click', () => {
    if (!currentGs) return;
    const myHand = currentGs.hands[myPlayerId] || [];
    currentGs.hands[myPlayerId] = sortByColor(myHand);
    renderMyRack(currentGs, playerOrder[currentGs.turnIndex % playerOrder.length] === myPlayerId);
  });

  btnClearSelection.addEventListener('click', () => {
    selectedTileIds.clear();
    if (currentGs) {
      renderMyRack(currentGs, playerOrder[currentGs.turnIndex % playerOrder.length] === myPlayerId);
      btnMeldTiles.disabled = true;
      selectedCount.textContent = '0';
    }
  });

  btnLeave.addEventListener('click', () => {
    if (confirm('게임을 나가시겠습니까? 다른 플레이어들은 계속 진행됩니다.')) {
      handleLeaveGameSafely();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (!isNavigatingToLobby) {
      handleLeaveGameSafely();
    }
  });

  // [★ 핵심 해결: 대기실 복귀 버튼]
  btnModalLobby.addEventListener('click', async () => {
    isNavigatingToLobby = true;
    try {
      await update(ref(database, `rooms/${myRoomCode}`), {
        status: 'waiting',
        gameState: null
      });
    } catch (e) {
      console.error(e);
    }
    window.location.href = 'index.html';
  });

  btnModalRestart.addEventListener('click', async () => {
    if (!isHost) return;
    resultModal.classList.remove('show');
    await initRummikubGameState();
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'show';
  setTimeout(() => toast.className = '', 2500);
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
