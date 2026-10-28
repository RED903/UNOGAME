/**
 * 야추 다이스 (Yacht Dice) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, set, serverTimestamp
} from './firebase-config.js';
import {
  CATEGORIES, calculateCategoryScore, calculateTotals, botDecideHold, botSelectCategory
} from './yacht-rules.js';
import {
  playDiceRoll, playDiceHold, playMyTurn, playWin, playLose, playButtonClick, playError
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
let myAvatar = '🎲';
let playersList = {}; // { pid: { name, avatar, isBot } }
let playerOrder = []; // [pid1, pid2, ...]
let activeViewingPid = myPlayerId; // 현재 스코어보드에서 보고 있는 플레이어 탭
let currentGs = null;
let roomListener = null;
let isRollingLocal = false;
let botTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// DOM 요소 캐싱
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');
const turnText = document.getElementById('turn-text');
const roundText = document.getElementById('round-text');
const rollsLeftBadge = document.getElementById('rolls-left-badge');
const diceTray = document.getElementById('dice-tray');
const btnRoll = document.getElementById('btn-roll');
const btnRollText = document.getElementById('btn-roll-text');
const rollHint = document.getElementById('roll-hint');
const scoreTabs = document.getElementById('score-tabs');
const scoreTbody = document.getElementById('score-tbody');
const btnLeave = document.getElementById('btn-leave');
const gameOverModal = document.getElementById('game-over-modal');
const rankingsList = document.getElementById('rankings-list');
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
      myAvatar = playersList[myPlayerId].avatar || '🎲';
    }

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    // 방장이면 초기 gameState 생성
    if (isHost && !room.gameState) {
      await initYachtGameState();
    }

    // 실시간 방 상태 리스닝
    listenToYachtRoom();

  } catch (err) {
    console.error('야추 초기화 실패:', err);
  }
});

/** 방장: 최초 게임 상태 생성 */
async function initYachtGameState() {
  const initialScores = {};
  playerOrder.forEach(pid => {
    initialScores[pid] = {};
  });

  const newGs = {
    turnIndex: 0,
    round: 1,
    rollsLeft: 3,
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    isRolled: false,
    scores: initialScores,
    status: 'in_progress',
    lastActionTime: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

/** 실시간 리스너 연결 */
function listenToYachtRoom() {
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
    renderGame(gs);

    // 봇 턴 체크 및 방장의 대리 실행
    checkBotTurn(gs);
  });
}

/** 화면 렌더링 */
function renderGame(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId);
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🎲' };

  // 1. 헤더 및 라운드 정보
  turnAvatar.textContent = currentPlayer.avatar || '🎲';
  turnText.textContent = isMyTurn ? '당신의 차례입니다!' : `${currentPlayer.name} 님의 차례`;
  roundText.textContent = `라운드 ${Math.min(gs.round, 12)} / 12`;
  rollsLeftBadge.textContent = `남은 굴림: ${gs.rollsLeft}회`;

  // 2. 주사위 트레이 렌더링
  renderDice(gs.dice, gs.held, gs.isRolled, isMyTurn && gs.rollsLeft < 3);

  // 3. 굴리기 버튼 상태 제어
  if (isMyTurn && gs.rollsLeft > 0 && !isRollingLocal) {
    btnRoll.disabled = false;
    btnRollText.textContent = `주사위 굴리기 (${gs.rollsLeft}/3)`;
    rollHint.textContent = gs.rollsLeft === 3 ? '주사위를 굴려 턴을 시작하세요!' : '고정할 주사위를 선택한 뒤 다시 굴릴 수 있습니다.';
  } else {
    btnRoll.disabled = true;
    if (!isMyTurn) {
      btnRollText.textContent = `${currentPlayer.name} 턴 진행 중...`;
      rollHint.textContent = '상대방의 플레이를 기다려주세요.';
    } else {
      btnRollText.textContent = '카테고리를 선택하세요';
      rollHint.textContent = '오른쪽 점수표에서 점수를 기록할 칸을 클릭하세요.';
    }
  }

  // 4. 스코어보드 탭 & 테이블 렌더링
  renderScoreTabs(gs);
  renderScoreTable(gs);

  // 5. 게임 종료 체크
  if (gs.status === 'finished') {
    renderGameOver(gs);
  }
}

/** 주사위 5개 렌더링 */
function renderDice(dice, held, isRolled, canToggleHold) {
  diceTray.innerHTML = '';

  dice.forEach((val, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = `dice-wrapper ${held[idx] ? 'held' : ''}`;
    
    const cube = document.createElement('div');
    cube.className = 'dice-cube';
    
    renderPips(cube, val);

    const label = document.createElement('span');
    label.className = 'hold-label';
    label.textContent = '🔒 HOLD';

    wrapper.appendChild(cube);
    wrapper.appendChild(label);

    if (canToggleHold) {
      wrapper.addEventListener('click', () => handleToggleHold(idx));
    }

    diceTray.appendChild(wrapper);
  });
}

function renderPips(container, value) {
  const pipPositions = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [1, 3], [3, 1], [3, 3]],
    5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
    6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]]
  };

  const positions = pipPositions[value] || [[2, 2]];
  positions.forEach(([r, c]) => {
    const pip = document.createElement('div');
    pip.className = `pip ${value === 1 ? 'red' : ''}`;
    pip.style.gridRow = r;
    pip.style.gridColumn = c;
    container.appendChild(pip);
  });
}

function renderScoreTabs(gs) {
  scoreTabs.innerHTML = '';
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];

  playerOrder.forEach(pid => {
    const p = playersList[pid] || { name: '알 수 없음', avatar: '🎲' };
    const tab = document.createElement('div');
    tab.className = `score-tab ${pid === activeViewingPid ? 'active' : ''} ${pid === currentPid ? 'current-turn' : ''}`;
    tab.innerHTML = `<span>${p.avatar || '🎲'}</span> <span>${escapeHtml(p.name)}</span>`;
    
    tab.addEventListener('click', () => {
      activeViewingPid = pid;
      renderScoreTabs(gs);
      renderScoreTable(gs);
    });

    scoreTabs.appendChild(tab);
  });
}

function renderScoreTable(gs) {
  scoreTbody.innerHTML = '';
  const viewingScores = (gs.scores && gs.scores[activeViewingPid]) || {};
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId);
  const isViewingMyScore = (activeViewingPid === myPlayerId);

  CATEGORIES.filter(c => c.section === 'upper').forEach(cat => {
    renderScoreRow(cat, viewingScores, gs, isMyTurn && isViewingMyScore && gs.isRolled);
  });

  const totals = calculateTotals(viewingScores);
  renderSubtotalRow(totals.upperTotal, totals.bonus);

  CATEGORIES.filter(c => c.section === 'lower').forEach(cat => {
    renderScoreRow(cat, viewingScores, gs, isMyTurn && isViewingMyScore && gs.isRolled);
  });

  renderGrandTotalRow(totals.grandTotal);
}

function renderScoreRow(cat, viewingScores, gs, canSelect) {
  const row = document.createElement('tr');
  const isFilled = (viewingScores[cat.key] !== undefined && viewingScores[cat.key] !== null);
  const potentialScore = calculateCategoryScore(cat.key, gs.dice);

  row.className = `score-row ${isFilled ? 'filled' : ''} ${canSelect && !isFilled ? 'selectable' : ''}`;

  const nameTd = document.createElement('td');
  nameTd.className = 'score-cell-name';
  nameTd.innerHTML = `<div>${cat.name}</div><div class="score-cell-desc">${cat.desc}</div>`;

  const valTd = document.createElement('td');
  valTd.className = 'score-cell-val';

  if (isFilled) {
    const scoreVal = viewingScores[cat.key];
    valTd.textContent = scoreVal;
    if (scoreVal === 0) valTd.classList.add('zero');
  } else if (canSelect) {
    valTd.textContent = potentialScore;
    valTd.classList.add('preview');

    row.addEventListener('click', () => {
      handleChooseCategory(cat.key);
    });
  } else {
    valTd.textContent = '-';
  }

  row.appendChild(nameTd);
  row.appendChild(valTd);
  scoreTbody.appendChild(row);
}

function renderSubtotalRow(upperTotal, bonus) {
  const row = document.createElement('tr');
  row.className = 'score-row score-subtotal-row';

  const progressPct = Math.min(100, Math.round((upperTotal / 63) * 100));

  row.innerHTML = `
    <td class="score-cell-name">
      <div>상단 합계 / 보너스</div>
      <div class="score-cell-desc">63점 이상 시 +35점 (${upperTotal}/63)</div>
      <div class="bonus-progress-bar">
        <div class="bonus-progress-fill" style="width: ${progressPct}%;"></div>
      </div>
    </td>
    <td class="score-cell-val" style="color:${bonus > 0 ? '#2ED573' : 'inherit'};">
      ${upperTotal} ${bonus > 0 ? '(+35)' : ''}
    </td>
  `;
  scoreTbody.appendChild(row);
}

function renderGrandTotalRow(grandTotal) {
  const row = document.createElement('tr');
  row.className = 'score-row score-grand-total';
  row.innerHTML = `
    <td class="score-cell-name" style="color:var(--gold);">🏆 총 점수</td>
    <td class="score-cell-val" style="color:var(--gold); font-size:1.3rem;">${grandTotal}</td>
  `;
  scoreTbody.appendChild(row);
}

// ─── 유저 인터랙션 액션 ─────────────────────────────

async function handleRollDice() {
  if (!currentGs || isRollingLocal) return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId || currentGs.rollsLeft <= 0) return;

  isRollingLocal = true;
  playDiceRoll();

  const diceCubes = document.querySelectorAll('.dice-cube');
  diceCubes.forEach((cube, idx) => {
    if (!currentGs.held[idx]) {
      cube.classList.add('rolling');
    }
  });

  const nextDice = [...currentGs.dice];
  for (let i = 0; i < 5; i++) {
    if (!currentGs.held[i]) {
      nextDice[i] = Math.floor(Math.random() * 6) + 1;
    }
  }

  setTimeout(async () => {
    try {
      await update(ref(database, `rooms/${myRoomCode}/gameState`), {
        dice: nextDice,
        rollsLeft: currentGs.rollsLeft - 1,
        isRolled: true,
        lastActionTime: Date.now()
      });
    } catch (e) {
      console.error(e);
    } finally {
      isRollingLocal = false;
    }
  }, 450);
}

async function handleToggleHold(index) {
  if (!currentGs || !currentGs.isRolled) return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  playDiceHold();

  const nextHeld = [...currentGs.held];
  nextHeld[index] = !nextHeld[index];

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    held: nextHeld
  });
}

async function handleChooseCategory(categoryKey) {
  if (!currentGs || !currentGs.isRolled) return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  const myScores = currentGs.scores[myPlayerId] || {};
  if (myScores[categoryKey] !== undefined && myScores[categoryKey] !== null) {
    playError();
    return;
  }

  const scoreEarned = calculateCategoryScore(categoryKey, currentGs.dice);
  playButtonClick();

  await commitTurnScore(myPlayerId, categoryKey, scoreEarned);
}

async function commitTurnScore(pid, categoryKey, score) {
  const updatedScores = { ...currentGs.scores };
  if (!updatedScores[pid]) updatedScores[pid] = {};
  updatedScores[pid][categoryKey] = score;

  const nextTurnIndex = currentGs.turnIndex + 1;
  const nextRound = Math.floor(nextTurnIndex / playerOrder.length) + 1;

  let allComplete = true;
  for (const p of playerOrder) {
    const sc = updatedScores[p] || {};
    if (Object.keys(sc).length < 12) {
      allComplete = false;
      break;
    }
  }

  const updates = {
    [`rooms/${myRoomCode}/gameState/scores/${pid}/${categoryKey}`]: score,
    [`rooms/${myRoomCode}/gameState/turnIndex`]: nextTurnIndex,
    [`rooms/${myRoomCode}/gameState/round`]: nextRound,
    [`rooms/${myRoomCode}/gameState/rollsLeft`]: 3,
    [`rooms/${myRoomCode}/gameState/held`]: [false, false, false, false, false],
    [`rooms/${myRoomCode}/gameState/isRolled`]: false,
    [`rooms/${myRoomCode}/gameState/lastActionTime`]: Date.now()
  };

  if (allComplete || nextRound > 12) {
    updates[`rooms/${myRoomCode}/gameState/status`] = 'finished';
  }

  await update(ref(database), updates);

  const nextPid = playerOrder[nextTurnIndex % playerOrder.length];
  if (nextPid === myPlayerId && !allComplete) {
    playMyTurn();
  }
}

// ─── 봇 AI 대리 실행 ─────────────────────────────
function checkBotTurn(gs) {
  if (!isHost || gs.status === 'finished') return;

  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const player = playersList[currentPid];
  if (!player || !player.isBot) return;

  if (botTimer) clearTimeout(botTimer);

  botTimer = setTimeout(async () => {
    await runBotAction(currentPid, gs);
  }, 1200);
}

async function runBotAction(botId, gs) {
  const botScores = (gs.scores && gs.scores[botId]) || {};

  if (!gs.isRolled || gs.rollsLeft === 3) {
    playDiceRoll();
    const rolled = [1, 2, 3, 4, 5].map(() => Math.floor(Math.random() * 6) + 1);
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      dice: rolled,
      rollsLeft: 2,
      isRolled: true,
      held: [false, false, false, false, false],
      lastActionTime: Date.now()
    });
    return;
  }

  if (gs.rollsLeft > 0) {
    const holds = botDecideHold(gs.dice, botScores, gs.rollsLeft);
    const allHeld = holds.every(h => h === true);

    if (allHeld) {
      const chosenCat = botSelectCategory(gs.dice, botScores);
      const score = calculateCategoryScore(chosenCat, gs.dice);
      await commitTurnScore(botId, chosenCat, score);
      return;
    }

    playDiceRoll();
    const newDice = [...gs.dice];
    for (let i = 0; i < 5; i++) {
      if (!holds[i]) newDice[i] = Math.floor(Math.random() * 6) + 1;
    }

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      dice: newDice,
      held: holds,
      rollsLeft: gs.rollsLeft - 1,
      lastActionTime: Date.now()
    });
    return;
  }

  const bestCategory = botSelectCategory(gs.dice, botScores);
  if (bestCategory) {
    const score = calculateCategoryScore(bestCategory, gs.dice);
    await commitTurnScore(botId, bestCategory, score);
  }
}

// ─── 게임 종료 및 결과 모달 ─────────────────────────
function renderGameOver(gs) {
  const rankings = playerOrder.map(pid => {
    const p = playersList[pid] || { name: '알 수 없음', avatar: '🎲' };
    const sc = (gs.scores && gs.scores[pid]) || {};
    const totals = calculateTotals(sc);
    return {
      pid,
      name: p.name,
      avatar: p.avatar,
      score: totals.grandTotal,
      upperBonus: totals.bonus > 0
    };
  });

  rankings.sort((a, b) => b.score - a.score);

  const isMeWinner = (rankings[0].pid === myPlayerId);
  if (isMeWinner) playWin();
  else playLose();

  rankingsList.innerHTML = rankings.map((r, idx) => `
    <div class="rank-item ${idx === 0 ? 'first' : ''}">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:1.2rem; font-weight:900; color:${idx === 0 ? '#FFD700' : 'rgba(255,255,255,0.5)'};">
          #${idx + 1}
        </span>
        <span>${r.avatar || '🎲'}</span>
        <span style="font-weight:700;">${escapeHtml(r.name)} ${r.pid === myPlayerId ? '(나)' : ''}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${r.upperBonus ? '<span style="font-size:0.75rem; color:#2ED573; background:rgba(46,213,115,0.15); padding:2px 6px; border-radius:4px;">보너스 +35</span>' : ''}
        <span style="font-weight:900; font-size:1.15rem; color:${idx === 0 ? '#FFD700' : '#fff'};">
          ${r.score}점
        </span>
      </div>
    </div>
  `).join('');

  btnModalRestart.style.display = isHost ? 'block' : 'none';
  gameOverModal.classList.add('show');
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
      // 남은 사람이 없으면 방 삭제
      await remove(ref(database, `rooms/${myRoomCode}`));
    } else {
      const updates = {};
      // 플레이어에서 나 제거
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      if (room.gameState && room.gameState.scores) {
        updates[`rooms/${myRoomCode}/gameState/scores/${myPlayerId}`] = null;
      }

      // 방장이 나가는 경우 다음 사람에게 방장 위임
      if (room.host === myPlayerId) {
        const nextHost = humanPlayerIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

      // 만약 내가 현재 턴이었다면 턴 인덱스 증가
      if (currentGs && playerOrder[currentGs.turnIndex % playerOrder.length] === myPlayerId) {
        updates[`rooms/${myRoomCode}/gameState/turnIndex`] = currentGs.turnIndex + 1;
        updates[`rooms/${myRoomCode}/gameState/rollsLeft`] = 3;
        updates[`rooms/${myRoomCode}/gameState/held`] = [false, false, false, false, false];
        updates[`rooms/${myRoomCode}/gameState/isRolled`] = false;
      }

      await update(ref(database), updates);
    }
  } catch (err) {
    console.error('이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  btnRoll.addEventListener('click', handleRollDice);

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
      // 방장이든 일반 유저든 대기실로 복귀 시 방의 상태를 'waiting'으로 안전하게 동기화!
      // 이렇게 하면 방 안의 모든 유저가 리스너에 의해 동시에 index.html 대기실로 복귀됩니다.
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
    gameOverModal.classList.remove('show');
    await initYachtGameState();
  });

  // 감정표현
  document.querySelectorAll('.btn-emote').forEach(btn => {
    btn.addEventListener('click', () => {
      showToast(`${myName}: ${btn.dataset.emote}`);
    });
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'show';
  setTimeout(() => toast.className = '', 2000);
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
