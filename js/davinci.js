/**
 * 다빈치 코드 (Da Vinci Code) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, set, serverTimestamp
} from './firebase-config.js';
import {
  createTilePool, sortTiles, botDeduceTileValue
} from './davinci-rules.js';
import {
  playTilePlace, playCorrect, playWrong, playMyTurn, playWin, playLose, playButtonClick, playError
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
let myAvatar = '🔢';
let playersList = {};
let playerOrder = [];
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// 추리 선택 상태
let selectedTargetPid = null;
let selectedTargetTileId = null;

// DOM 요소
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const btnLeave = document.getElementById('btn-leave');

const opponentsZone = document.getElementById('opponents-zone');
const poolTitle = document.getElementById('pool-title');
const btnDrawBlack = document.getElementById('btn-draw-black');
const btnDrawWhite = document.getElementById('btn-draw-white');
const labelBlackCount = document.getElementById('label-black-count');
const labelWhiteCount = document.getElementById('label-white-count');
const drawHint = document.getElementById('draw-hint');

const myRackZone = document.getElementById('my-rack-zone');
const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myTilesStand = document.getElementById('my-tiles-stand');

const guessModal = document.getElementById('guess-modal');
const guessTargetDesc = document.getElementById('guess-target-desc');
const btnCancelGuess = document.getElementById('btn-cancel-guess');

const continueModal = document.getElementById('continue-modal');
const btnChoiceContinue = document.getElementById('btn-choice-continue');
const btnChoicePass = document.getElementById('btn-choice-pass');

const resultModal = document.getElementById('result-modal');
const resultTrophy = document.getElementById('result-trophy');
const resultWinnerTitle = document.getElementById('result-winner-title');
const resultDesc = document.getElementById('result-desc');
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
      myAvatar = playersList[myPlayerId].avatar || '🦊';
    }

    myAvatarEl.textContent = myAvatar;
    myNameEl.textContent = `${myName}의 타일`;

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initDavinciGameState();
    }

    listenToDavinciRoom();

  } catch (err) {
    console.error('다빈치 코드 초기화 실패:', err);
  }
});

async function initDavinciGameState() {
  const pool = createTilePool();
  const hands = {};
  const initialTileCount = playerOrder.length === 2 ? 4 : 3;

  playerOrder.forEach(pid => {
    const playerTiles = [];
    for (let i = 0; i < initialTileCount; i++) {
      if (pool.length > 0) {
        playerTiles.push(pool.pop());
      }
    }
    hands[pid] = sortTiles(playerTiles);
  });

  const newGs = {
    pool,
    hands,
    turnIndex: 0,
    phase: 'draw',
    newDrawnTileId: null,
    eliminated: [],
    winnerId: null,
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

function listenToDavinciRoom() {
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
    renderDavinciBoard(gs);

    checkDavinciBotAction(gs);
  });
}

function renderDavinciBoard(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId);
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🔢' };

  turnAvatar.textContent = currentPlayer.avatar || '🔢';
  if (isMyTurn) {
    turnText.textContent = gs.phase === 'draw' ? '타일을 1장 뽑으세요!' : '상대방 타일을 추리하세요!';
    turnText.style.color = 'var(--gold)';
  } else {
    turnText.textContent = `${currentPlayer.name} 님의 차례...`;
    turnText.style.color = '#F0F0FF';
  }

  renderTilePool(gs.pool || [], isMyTurn && gs.phase === 'draw');
  renderOpponents(gs, isMyTurn && gs.phase === 'guess');
  renderMyRack(gs, isMyTurn);

  if (isMyTurn && gs.phase === 'decide') {
    continueModal.classList.add('show');
  } else {
    continueModal.classList.remove('show');
  }

  if (gs.phase === 'finished') {
    renderResult(gs);
  }
}

function renderTilePool(pool, canDraw) {
  const blackCount = pool.filter(t => t.color === 'black').length;
  const whiteCount = pool.filter(t => t.color === 'white').length;
  const totalCount = pool.length;

  poolTitle.textContent = `중앙 타일 더미 (남은 타일: ${totalCount}개)`;
  labelBlackCount.textContent = `검은색 (${blackCount})`;
  labelWhiteCount.textContent = `흰색 (${whiteCount})`;

  btnDrawBlack.disabled = !canDraw || blackCount === 0;
  btnDrawWhite.disabled = !canDraw || whiteCount === 0;

  if (canDraw) {
    drawHint.textContent = '원하는 색상의 타일을 1장 뽑아 턴을 시작하세요!';
    drawHint.style.color = 'var(--gold)';
  } else {
    drawHint.textContent = '중앙 더미에서 타일을 가져올 수 없습니다.';
    drawHint.style.color = 'rgba(240,240,255,0.45)';
  }
}

function renderOpponents(gs, canSelectTile) {
  opponentsZone.innerHTML = '';
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];

  playerOrder.forEach(pid => {
    if (pid === myPlayerId) return;
    const p = playersList[pid] || { name: '상대방', avatar: '👤' };
    const pTiles = gs.hands?.[pid] || [];
    const isEliminated = (gs.eliminated || []).includes(pid);
    const isTheirTurn = (pid === currentPid);

    const card = document.createElement('div');
    card.className = `player-rack-card ${isTheirTurn ? 'active-turn' : ''} ${isEliminated ? 'eliminated' : ''}`;

    const header = document.createElement('div');
    header.className = 'rack-header';
    header.innerHTML = `
      <div class="rack-user-info">
        <span>${p.avatar || '👤'}</span>
        <span>${escapeHtml(p.name)}</span>
        ${isEliminated ? '<span style="color:#EB3B5A; font-size:0.75rem;">(탈락)</span>' : ''}
      </div>
      <div style="font-size:0.8rem; color:rgba(240,240,255,0.5);">타일 ${pTiles.length}개</div>
    `;
    card.appendChild(header);

    const stand = document.createElement('div');
    stand.className = 'tiles-stand';

    pTiles.forEach(tile => {
      const tileEl = document.createElement('div');
      const isSelectable = canSelectTile && !tile.isOpen && !isEliminated;

      tileEl.className = `tile-item ${tile.color} ${tile.isOpen ? '' : 'secret'} ${isSelectable ? 'selectable' : ''} ${tile.id === gs.newDrawnTileId ? 'new-drawn' : ''}`;
      
      if (tile.isOpen) {
        tileEl.textContent = tile.value;
      } else {
        tileEl.textContent = '?';
      }

      if (isSelectable) {
        tileEl.addEventListener('click', () => {
          openGuessModal(pid, p.name, tile);
        });
      }

      stand.appendChild(tileEl);
    });

    card.appendChild(stand);
    opponentsZone.appendChild(card);
  });
}

function renderMyRack(gs, isMyTurn) {
  myTilesStand.innerHTML = '';
  const myTiles = gs.hands?.[myPlayerId] || [];

  if (isMyTurn) myRackZone.classList.add('active-turn');
  else myRackZone.classList.remove('active-turn');

  myTiles.forEach(tile => {
    const tileEl = document.createElement('div');
    tileEl.className = `tile-item ${tile.color} ${tile.id === gs.newDrawnTileId ? 'new-drawn' : ''}`;
    tileEl.textContent = tile.value;

    if (!tile.isOpen) {
      const lockBadge = document.createElement('span');
      lockBadge.style.cssText = 'position:absolute; bottom:2px; font-size:0.65rem; opacity:0.6;';
      lockBadge.textContent = '🔒';
      tileEl.appendChild(lockBadge);
    }

    myTilesStand.appendChild(tileEl);
  });
}

async function handleDrawTile(color) {
  if (!currentGs || currentGs.phase !== 'draw') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playTilePlace();

  const pool = [...currentGs.pool];
  const targetIndex = pool.findIndex(t => t.color === color);
  if (targetIndex === -1) return;

  const drawnTile = pool.splice(targetIndex, 1)[0];
  const myHand = [...(currentGs.hands[myPlayerId] || []), drawnTile];
  const sortedHand = sortTiles(myHand);

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    pool,
    [`hands/${myPlayerId}`]: sortedHand,
    phase: 'guess',
    newDrawnTileId: drawnTile.id,
    lastActionTime: Date.now()
  });
}

function openGuessModal(targetPid, targetName, targetTile) {
  selectedTargetPid = targetPid;
  selectedTargetTileId = targetTile.id;

  guessTargetDesc.innerHTML = `<strong>${escapeHtml(targetName)}</strong> 님의 <span style="color:${targetTile.color === 'white' ? '#fff' : '#aaa'}; font-weight:800;">[${targetTile.color === 'white' ? '흰색' : '검은색'}]</span> 타일의 숫자를 맞추세요!`;
  guessModal.classList.add('show');
}

async function handleGuessNumber(guessedNumber) {
  guessModal.classList.remove('show');
  if (!currentGs || currentGs.phase !== 'guess') return;

  const targetPid = selectedTargetPid;
  const tileId = selectedTargetTileId;
  const targetHand = currentGs.hands[targetPid] || [];
  const targetTileIndex = targetHand.findIndex(t => t.id === tileId);

  if (targetTileIndex === -1) return;

  const targetTile = targetHand[targetTileIndex];
  const isCorrect = (targetTile.value === guessedNumber);

  if (isCorrect) {
    playCorrect();
    const updatedTargetHand = [...targetHand];
    updatedTargetHand[targetTileIndex] = { ...targetTile, isOpen: true };

    const isTargetEliminated = updatedTargetHand.every(t => t.isOpen);
    const updatedEliminated = [...(currentGs.eliminated || [])];
    if (isTargetEliminated && !updatedEliminated.includes(targetPid)) {
      updatedEliminated.push(targetPid);
    }

    const activePlayers = playerOrder.filter(pid => !updatedEliminated.includes(pid));
    if (activePlayers.length === 1) {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        [`hands/${targetPid}`]: updatedTargetHand,
        eliminated: updatedEliminated,
        phase: 'finished',
        winnerId: activePlayers[0],
        lastActionTime: Date.now()
      });
      return;
    }

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      [`hands/${targetPid}`]: updatedTargetHand,
      eliminated: updatedEliminated,
      phase: 'decide',
      lastActionTime: Date.now()
    });

  } else {
    playWrong();
    
    const myHand = currentGs.hands[myPlayerId] || [];
    const updatedMyHand = myHand.map(t => {
      if (t.id === currentGs.newDrawnTileId) {
        return { ...t, isOpen: true };
      }
      return t;
    });

    await passTurnToNext(updatedMyHand);
  }
}

async function handlePassTurn() {
  continueModal.classList.remove('show');
  playButtonClick();
  await passTurnToNext(currentGs.hands[myPlayerId]);
}

async function handleContinueGuess() {
  continueModal.classList.remove('show');
  playButtonClick();
  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'guess',
    lastActionTime: Date.now()
  });
}

async function passTurnToNext(updatedCurrentPlayerHand = null) {
  const eliminated = currentGs.eliminated || [];
  let nextIndex = currentGs.turnIndex + 1;

  while (eliminated.includes(playerOrder[nextIndex % playerOrder.length])) {
    nextIndex++;
  }

  const updates = {
    turnIndex: nextIndex,
    phase: 'draw',
    newDrawnTileId: null,
    lastActionTime: Date.now()
  };

  if (updatedCurrentPlayerHand) {
    updates[`hands/${playerOrder[currentGs.turnIndex % playerOrder.length]}`] = updatedCurrentPlayerHand;
  }

  await update(ref(database, `rooms/${myRoomCode}/gameState`), updates);

  if (playerOrder[nextIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

function checkDavinciBotAction(gs) {
  if (!isHost || gs.phase === 'finished') return;

  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const player = playersList[currentPid];
  if (!player || !player.isBot) return;

  if (botActionTimer) clearTimeout(botActionTimer);

  botActionTimer = setTimeout(async () => {
    await runDavinciBotTurn(currentPid, gs);
  }, 1400);
}

async function runDavinciBotTurn(botId, gs) {
  if (gs.phase === 'draw') {
    const pool = gs.pool || [];
    if (pool.length === 0) {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        phase: 'guess',
        newDrawnTileId: null
      });
      return;
    }

    const hasBlack = pool.some(t => t.color === 'black');
    const hasWhite = pool.some(t => t.color === 'white');
    const chosenColor = (hasBlack && hasWhite) ? (Math.random() < 0.5 ? 'black' : 'white') : (hasBlack ? 'black' : 'white');

    const nextPool = [...pool];
    const idx = nextPool.findIndex(t => t.color === chosenColor);
    const drawn = nextPool.splice(idx, 1)[0];

    const botHand = sortTiles([...(gs.hands[botId] || []), drawn]);

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      pool: nextPool,
      [`hands/${botId}`]: botHand,
      phase: 'guess',
      newDrawnTileId: drawn.id,
      lastActionTime: Date.now()
    });
    return;
  }

  if (gs.phase === 'guess') {
    const eliminated = gs.eliminated || [];
    const targets = playerOrder.filter(pid => pid !== botId && !eliminated.includes(pid));
    if (targets.length === 0) return;

    const targetPid = targets[Math.floor(Math.random() * targets.length)];
    const targetHand = gs.hands[targetPid] || [];
    const secretTiles = targetHand.filter(t => !t.isOpen);

    if (secretTiles.length === 0) return;
    const targetTile = secretTiles[Math.floor(Math.random() * secretTiles.length)];

    const allOpen = [];
    Object.values(gs.hands || {}).forEach(h => {
      h.filter(t => t.isOpen).forEach(ot => allOpen.push(ot));
    });

    const guessVal = botDeduceTileValue(targetTile, targetHand, gs.hands[botId] || [], allOpen);
    const isCorrect = (targetTile.value === guessVal);
    const tIdx = targetHand.findIndex(t => t.id === targetTile.id);

    if (isCorrect) {
      playCorrect();
      const newTargetHand = [...targetHand];
      newTargetHand[tIdx] = { ...targetTile, isOpen: true };

      const isTargetEliminated = newTargetHand.every(t => t.isOpen);
      const updatedEliminated = [...eliminated];
      if (isTargetEliminated && !updatedEliminated.includes(targetPid)) {
        updatedEliminated.push(targetPid);
      }

      const activePlayers = playerOrder.filter(pid => !updatedEliminated.includes(pid));
      if (activePlayers.length === 1) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          [`hands/${targetPid}`]: newTargetHand,
          eliminated: updatedEliminated,
          phase: 'finished',
          winnerId: activePlayers[0]
        });
        return;
      }

      if (Math.random() < 0.5) {
        await update(ref(database, `rooms/${myRoomCode}/gameState`), {
          [`hands/${targetPid}`]: newTargetHand,
          eliminated: updatedEliminated,
          phase: 'guess'
        });
      } else {
        await passTurnToNext();
      }

    } else {
      playWrong();
      const botHand = (gs.hands[botId] || []).map(t => {
        if (t.id === gs.newDrawnTileId) return { ...t, isOpen: true };
        return t;
      });
      await passTurnToNext(botHand);
    }
  }

  if (gs.phase === 'decide') {
    await passTurnToNext();
  }
}

function renderResult(gs) {
  const winner = playersList[gs.winnerId] || { name: '승리자', avatar: '🏆' };
  const isMe = (gs.winnerId === myPlayerId);

  if (isMe) {
    playWin();
    resultTrophy.textContent = '🏆';
    resultWinnerTitle.textContent = '승리하였습니다!';
    resultWinnerTitle.style.color = 'var(--gold)';
    resultDesc.textContent = '모든 상대방의 비밀 타일을 간파하고 승리했습니다!';
  } else {
    playLose();
    resultTrophy.textContent = '💀';
    resultWinnerTitle.textContent = `${winner.name} 님의 승리!`;
    resultWinnerTitle.style.color = '#EB3B5A';
    resultDesc.textContent = `${winner.name} 님이 끝까지 살아남아 우승을 차지했습니다.`;
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
      
      // 내 타일 모두 오픈 및 탈락 처리
      if (room.gameState) {
        const myHand = (room.gameState.hands?.[myPlayerId] || []).map(t => ({ ...t, isOpen: true }));
        updates[`rooms/${myRoomCode}/gameState/hands/${myPlayerId}`] = myHand;
        
        const eliminated = [...(room.gameState.eliminated || [])];
        if (!eliminated.includes(myPlayerId)) eliminated.push(myPlayerId);
        updates[`rooms/${myRoomCode}/gameState/eliminated`] = eliminated;

        // 남은 생존자 검사
        const active = Object.keys(players).filter(id => id !== myPlayerId && !eliminated.includes(id));
        if (active.length === 1) {
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'finished';
          updates[`rooms/${myRoomCode}/gameState/winnerId`] = active[0];
        } else if (playerOrder[room.gameState.turnIndex % playerOrder.length] === myPlayerId) {
          updates[`rooms/${myRoomCode}/gameState/turnIndex`] = room.gameState.turnIndex + 1;
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'draw';
          updates[`rooms/${myRoomCode}/gameState/newDrawnTileId`] = null;
        }
      }

      if (room.host === myPlayerId) {
        const nextHost = humanPlayerIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

      await update(ref(database), updates);
    }
  } catch (err) {
    console.error('다빈치 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnDrawBlack.addEventListener('click', () => handleDrawTile('black'));
  btnDrawWhite.addEventListener('click', () => handleDrawTile('white'));

  document.querySelectorAll('.btn-num-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const num = parseInt(btn.dataset.num, 10);
      handleGuessNumber(num);
    });
  });

  btnCancelGuess.addEventListener('click', () => {
    guessModal.classList.remove('show');
  });

  btnChoicePass.addEventListener('click', handlePassTurn);
  btnChoiceContinue.addEventListener('click', handleContinueGuess);

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
    await initDavinciGameState();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
