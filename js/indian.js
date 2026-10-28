/**
 * 인디언 포커 (Indian Poker) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, set, serverTimestamp
} from './firebase-config.js';
import {
  INITIAL_CHIPS, ANTE_CHIPS, createIndianDeck, botDecideIndianBet
} from './indian-rules.js';
import {
  playChips, playMyTurn, playWin, playLose, playButtonClick, playError
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
let myAvatar = '🤠';
let playersList = {};
let playerOrder = [];
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// DOM 요소
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const btnLeave = document.getElementById('btn-leave');

let isCodeHidden = false;
function updateRoomCodeText() {
  if (!displayRoomCode) return;
  displayRoomCode.textContent = isCodeHidden ? 'ROOM: •••••• 👁️' : `ROOM: ${myRoomCode} 🔒`;
}

const opponentsRow = document.getElementById('opponents-row');
const potAmount = document.getElementById('pot-amount');
const currentBetInfo = document.getElementById('current-bet-info');
const actionLogTicker = document.getElementById('action-log-ticker');

const myForeheadCard = document.getElementById('my-forehead-card');
const myCardValue = document.getElementById('my-card-value');
const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myChipsEl = document.getElementById('my-chips');

const btnFold = document.getElementById('btn-fold');
const btnCheck = document.getElementById('btn-check');
const btnCall = document.getElementById('btn-call');
const btnRaise = document.getElementById('btn-raise');

const roundResultModal = document.getElementById('round-result-modal');
const modalResultIcon = document.getElementById('modal-result-icon');
const modalResultTitle = document.getElementById('modal-result-title');
const modalResultDesc = document.getElementById('modal-result-desc');
const btnNextRound = document.getElementById('btn-next-round');

const finalGameModal = document.getElementById('final-game-modal');
const finalWinnerTitle = document.getElementById('final-winner-title');
const finalDesc = document.getElementById('final-desc');
const btnFinalLobby = document.getElementById('btn-final-lobby');
const btnFinalRestart = document.getElementById('btn-final-restart');

// ─── 초기화 ─────────────────────────────────────────
async function initIndianGameEntry() {
  updateRoomCodeText();
  displayRoomCode.addEventListener('click', () => {
    isCodeHidden = !isCodeHidden;
    updateRoomCodeText();
  });
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
      myAvatar = playersList[myPlayerId].avatar || '🤠';
    }

    myAvatarEl.textContent = myAvatar;
    myNameEl.textContent = myName;

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initIndianGame();
    }

    listenToIndianRoom();

  } catch (err) {
    console.error('인디언 포커 초기화 오류:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initIndianGameEntry);
} else {
  initIndianGameEntry();
}

async function initIndianGame() {
  const chips = {};
  playerOrder.forEach(pid => {
    chips[pid] = INITIAL_CHIPS;
  });

  await startNewIndianRound(chips, 1);
}

async function startNewIndianRound(chips, roundNum) {
  const deck = createIndianDeck();
  const cards = {};
  const playerBets = {};
  const folded = [];
  let pot = 0;

  const activePlayers = playerOrder.filter(pid => (chips[pid] || 0) > 0);

  activePlayers.forEach(pid => {
    cards[pid] = deck.pop();
    chips[pid] -= ANTE_CHIPS;
    playerBets[pid] = ANTE_CHIPS;
    pot += ANTE_CHIPS;
  });

  const newGs = {
    round: roundNum,
    chips,
    cards,
    pot,
    currentBet: ANTE_CHIPS,
    playerBets,
    folded,
    turnIndex: 0,
    actionCount: 0,
    phase: 'betting',
    log: `라운드 ${roundNum} 시작! 기본 안티 1칩을 베팅했습니다.`,
    winnerPids: null,
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

function listenToIndianRoom() {
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
    renderIndianTable(gs);

    checkIndianBotAction(gs);
  });
}

function renderIndianTable(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId && gs.phase === 'betting');
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🤠' };

  turnAvatar.textContent = currentPlayer.avatar || '🤠';
  if (isMyTurn) {
    turnText.textContent = '당신의 베팅 차례입니다!';
    turnText.style.color = 'var(--gold)';
  } else {
    turnText.textContent = `${currentPlayer.name} 님의 베팅 차례...`;
    turnText.style.color = '#F0F0FF';
  }

  potAmount.innerHTML = `<span class="chip-coin-icon"></span> ${gs.pot}`;
  const myBet = gs.playerBets[myPlayerId] || 0;
  const toCall = Math.max(0, gs.currentBet - myBet);
  currentBetInfo.textContent = `현재 최고 베팅: ${gs.currentBet} 칩 | 내가 맞출 칩: ${toCall} 칩`;
  actionLogTicker.textContent = gs.log || '';

  renderOpponentsSeat(gs, currentPid);
  renderMySeat(gs);
  updateBettingButtons(gs, isMyTurn, toCall);

  if (gs.phase === 'showdown') {
    renderShowdownModal(gs);
  } else {
    roundResultModal.classList.remove('show');
  }

  if (gs.phase === 'finished') {
    renderFinalGameModal(gs);
  }
}

function renderOpponentsSeat(gs, currentPid) {
  opponentsRow.innerHTML = '';

  playerOrder.forEach(pid => {
    if (pid === myPlayerId) return;
    const p = playersList[pid] || { name: '상대방', avatar: '👤' };
    const pCard = gs.cards?.[pid];
    const pChips = gs.chips?.[pid] || 0;
    const isFolded = gs.folded?.includes(pid);
    const isTheirTurn = (pid === currentPid && gs.phase === 'betting');

    const seat = document.createElement('div');
    seat.className = `player-seat ${isTheirTurn ? 'current-turn' : ''} ${isFolded ? 'folded' : ''}`;

    const cardEl = document.createElement('div');
    if (pCard) {
      const suitColor = pCard.color || 'black';
      cardEl.className = `forehead-card open suit-${suitColor}`;
      cardEl.innerHTML = `
        <div class="card-corner-top">${pCard.symbol}</div>
        <span class="card-num">${pCard.value}</span>
        <span class="card-suit">${pCard.symbol}</span>
        <div class="card-corner-bottom">${pCard.symbol}</div>
      `;
    } else {
      cardEl.className = 'forehead-card open';
      cardEl.innerHTML = `<span class="card-num">-</span>`;
    }

    const info = document.createElement('div');
    info.className = 'player-seat-info';
    info.innerHTML = `
      <span>${p.avatar || '👤'}</span>
      <span>${escapeHtml(p.name)}</span>
      <span class="chips-badge"><span class="chip-coin-icon"></span> ${pChips}</span>
      ${isFolded ? '<span style="color:#FF4757; font-size:0.75rem;">(다이)</span>' : ''}
    `;

    seat.appendChild(cardEl);
    seat.appendChild(info);
    opponentsRow.appendChild(seat);
  });
}

function renderMySeat(gs) {
  const myCard = gs.cards?.[myPlayerId];
  const myChips = gs.chips?.[myPlayerId] || 0;
  myChipsEl.innerHTML = `<span class="chip-coin-icon"></span> ${myChips}`;

  if (gs.phase === 'showdown' && myCard) {
    const myColor = myCard.color || 'black';
    myForeheadCard.className = `forehead-card open suit-${myColor}`;
    myForeheadCard.innerHTML = `
      <div class="card-corner-top">${myCard.symbol}</div>
      <span class="card-num">${myCard.value}</span>
      <span class="card-suit">${myCard.symbol}</span>
      <div class="card-corner-bottom">${myCard.symbol}</div>
    `;
  } else {
    myForeheadCard.className = 'forehead-card secret';
    myForeheadCard.innerHTML = `<span class="card-question">?</span>`;
  }
}

function updateBettingButtons(gs, isMyTurn, toCall) {
  const myChips = gs.chips[myPlayerId] || 0;
  const isFolded = gs.folded?.includes(myPlayerId);

  if (!isMyTurn || isFolded) {
    btnFold.disabled = true;
    btnCheck.disabled = true;
    btnCall.disabled = true;
    btnRaise.disabled = true;
    return;
  }

  btnFold.disabled = false;
  btnCheck.disabled = (toCall > 0);
  btnCall.disabled = (toCall === 0 || myChips < toCall);
  btnCall.textContent = `콜 (${toCall} 칩)`;

  const raiseCost = toCall + 2;
  btnRaise.disabled = (myChips < raiseCost);
  btnRaise.textContent = `레이즈 (+2 칩)`;
}

async function handleBetAction(action) {
  if (!currentGs || currentGs.phase !== 'betting') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playChips();
  await executeIndianBet(myPlayerId, action, 2);
}

async function executeIndianBet(pid, action, raiseAmt = 2) {
  const gs = currentGs;
  const pName = playersList[pid]?.name || '플레이어';
  const myChips = gs.chips[pid] || 0;
  const currentBet = gs.currentBet;
  const myCurrentBet = gs.playerBets[pid] || 0;
  const toCall = Math.max(0, currentBet - myCurrentBet);

  const newChips = { ...gs.chips };
  const newPlayerBets = { ...gs.playerBets };
  const newFolded = [...(gs.folded || [])];
  let newPot = gs.pot;
  let nextBet = currentBet;
  let logText = '';

  if (action === 'fold') {
    newFolded.push(pid);
    logText = `[${pName}] 님이 다이(Fold)했습니다.`;

    const card = gs.cards[pid];
    if (card && card.value === 10) {
      const penalty = Math.min(newChips[pid], 5);
      newChips[pid] -= penalty;
      newPot += penalty;
      logText += ` (⚠️ 10을 들고 다이하여 패널티 ${penalty}칩 지불!)`;
    }

  } else if (action === 'check') {
    logText = `[${pName}] 님이 체크했습니다.`;

  } else if (action === 'call') {
    const pay = Math.min(myChips, toCall);
    newChips[pid] -= pay;
    newPlayerBets[pid] += pay;
    newPot += pay;
    logText = `[${pName}] 님이 ${pay}칩을 콜했습니다.`;

  } else if (action === 'raise') {
    const totalCost = toCall + raiseAmt;
    const pay = Math.min(myChips, totalCost);
    newChips[pid] -= pay;
    newPlayerBets[pid] += pay;
    newPot += pay;
    nextBet = newPlayerBets[pid];
    logText = `[${pName}] 님이 ${raiseAmt}칩을 레이즈했습니다! (총 ${nextBet}칩)`;
  }

  const activeAlivePids = playerOrder.filter(id => (newChips[id] > 0 || (gs.cards[id] && !newFolded.includes(id))) && !newFolded.includes(id));

  if (activeAlivePids.length === 1) {
    const soleWinner = activeAlivePids[0];
    newChips[soleWinner] += newPot;

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      chips: newChips,
      playerBets: newPlayerBets,
      folded: newFolded,
      pot: 0,
      phase: 'showdown',
      winnerPids: [soleWinner],
      log: `${logText} | [${playersList[soleWinner]?.name}] 님이 단독 승리로 ${newPot}칩 획득!`,
      lastActionTime: Date.now()
    });
    return;
  }

  const allBetsEqual = activeAlivePids.every(id => newPlayerBets[id] === nextBet);
  const nextActionCount = gs.actionCount + 1;

  if (allBetsEqual && nextActionCount >= activeAlivePids.length) {
    await judgeShowdown(newChips, newPot, newFolded, newPlayerBets, logText);
    return;
  }

  let nextIndex = gs.turnIndex + 1;
  while (newFolded.includes(playerOrder[nextIndex % playerOrder.length]) || (newChips[playerOrder[nextIndex % playerOrder.length]] <= 0 && !gs.cards[playerOrder[nextIndex % playerOrder.length]])) {
    nextIndex++;
  }

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    chips: newChips,
    playerBets: newPlayerBets,
    folded: newFolded,
    pot: newPot,
    currentBet: nextBet,
    turnIndex: nextIndex,
    actionCount: nextActionCount,
    log: logText,
    lastActionTime: Date.now()
  });

  if (playerOrder[nextIndex % playerOrder.length] === myPlayerId) {
    playMyTurn();
  }
}

async function judgeShowdown(chips, pot, folded, playerBets, logText) {
  const cards = currentGs.cards;
  const alivePids = playerOrder.filter(id => !folded.includes(id));

  let maxVal = -1;
  let winners = [];

  alivePids.forEach(pid => {
    const card = cards[pid];
    if (card) {
      if (card.value > maxVal) {
        maxVal = card.value;
        winners = [pid];
      } else if (card.value === maxVal) {
        winners.push(pid);
      }
    }
  });

  const share = Math.floor(pot / winners.length);
  winners.forEach(w => {
    chips[w] += share;
  });

  const winnerNames = winners.map(w => playersList[w]?.name || '플레이어').join(', ');

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    chips,
    pot: 0,
    folded,
    phase: 'showdown',
    winnerPids: winners,
    log: `${logText} | [${winnerNames}] 님이 승리하여 ${pot}칩 획득! (카드: ${maxVal})`,
    lastActionTime: Date.now()
  });
}

function checkIndianBotAction(gs) {
  if (!isHost) return;

  if (gs.phase === 'betting') {
    const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
    const player = playersList[currentPid];
    if (player && player.isBot) {
      if (botActionTimer) clearTimeout(botActionTimer);
      botActionTimer = setTimeout(async () => {
        const opponentPid = playerOrder.find(id => id !== currentPid && !gs.folded.includes(id));
        const oppCard = opponentPid ? gs.cards[opponentPid] : null;

        const myBet = gs.playerBets[currentPid] || 0;
        const toCall = Math.max(0, gs.currentBet - myBet);
        const botChips = gs.chips[currentPid] || 0;

        const decision = botDecideIndianBet(oppCard, toCall, botChips, gs.pot);
        await executeIndianBet(currentPid, decision.action, decision.raiseAmount || 2);
      }, 1500);
    }
  }

  if (gs.phase === 'showdown') {
    if (botActionTimer) clearTimeout(botActionTimer);
    botActionTimer = setTimeout(async () => {
      await handleNextRoundTrigger(gs);
    }, 4000);
  }
}

function renderShowdownModal(gs) {
  const winners = gs.winnerPids || [];
  const isMeWinner = winners.includes(myPlayerId);

  if (isMeWinner) {
    playWin();
    modalResultIcon.textContent = '🎉';
    modalResultTitle.textContent = '라운드 승리!';
    modalResultTitle.style.color = 'var(--gold)';
  } else {
    playLose();
    modalResultIcon.textContent = '💀';
    modalResultTitle.textContent = '라운드 패배...';
    modalResultTitle.style.color = '#FF4757';
  }

  const summary = playerOrder.map(pid => {
    const p = playersList[pid] || { name: '플레이어' };
    const card = gs.cards?.[pid];
    const isFold = gs.folded?.includes(pid);
    const cardDisplay = card ? `<span style="color:${card.color === 'red' ? '#FF4757' : '#F0F0FF'}">[${card.symbol} ${card.value}]</span>` : '[?]';
    return `<strong>${escapeHtml(p.name)}</strong>: ${isFold ? '<span style="color:#FF6B81;">(다이)</span>' : cardDisplay}`;
  }).join('<br/>');

  modalResultDesc.innerHTML = `${gs.log}<br/><br/>${summary}`;
  btnNextRound.disabled = !isHost;
  btnNextRound.textContent = isHost ? '다음 라운드 시작' : '다음 라운드 대기 중...';
  roundResultModal.classList.add('show');
}

async function handleNextRoundTrigger(gs) {
  roundResultModal.classList.remove('show');

  const solventPlayers = playerOrder.filter(pid => (gs.chips[pid] || 0) > 0);

  if (solventPlayers.length <= 1) {
    const finalWinnerId = solventPlayers[0] || playerOrder[0];
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'finished',
      finalWinnerId
    });
    return;
  }

  await startNewIndianRound(gs.chips, gs.round + 1);
}

function renderFinalGameModal(gs) {
  const winner = playersList[gs.finalWinnerId] || { name: '최종 우승자' };
  const isMe = (gs.finalWinnerId === myPlayerId);

  if (isMe) playWin();
  else playLose();

  finalWinnerTitle.textContent = isMe ? '최종 우승을 차지했습니다! 👑' : `${winner.name} 님의 최종 승리!`;
  finalDesc.textContent = `모든 칩을 획득하고 인디언 포커의 최후의 승자가 되었습니다!`;

  btnFinalRestart.style.display = isHost ? 'block' : 'none';
  finalGameModal.classList.add('show');
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

      if (room.gameState) {
        const folded = [...(room.gameState.folded || [])];
        if (!folded.includes(myPlayerId)) folded.push(myPlayerId);
        updates[`rooms/${myRoomCode}/gameState/folded`] = folded;

        const active = Object.keys(players).filter(id => id !== myPlayerId && !folded.includes(id));
        if (active.length <= 1) {
          updates[`rooms/${myRoomCode}/gameState/phase`] = 'finished';
          updates[`rooms/${myRoomCode}/gameState/finalWinnerId`] = active[0] || humanPlayerIds[0];
        } else if (playerOrder[room.gameState.turnIndex % playerOrder.length] === myPlayerId) {
          updates[`rooms/${myRoomCode}/gameState/turnIndex`] = room.gameState.turnIndex + 1;
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
    console.error('인디언 포커 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnFold.addEventListener('click', () => handleBetAction('fold'));
  btnCheck.addEventListener('click', () => handleBetAction('check'));
  btnCall.addEventListener('click', () => handleBetAction('call'));
  btnRaise.addEventListener('click', () => handleBetAction('raise'));

  btnNextRound.addEventListener('click', () => {
    if (isHost && currentGs) handleNextRoundTrigger(currentGs);
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
  btnFinalLobby.addEventListener('click', async () => {
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

  btnFinalRestart.addEventListener('click', async () => {
    if (!isHost) return;
    finalGameModal.classList.remove('show');
    await initIndianGame();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
