/**
 * 야추 다이스 (Yacht Dice) 실시간 멀티플레이 로직
 * 클래식 스타일 점수판 (사진 스타일 100% 일치) & 주사위 롤존 연동
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
let currentGs = null;
let roomListener = null;
let emoteListener = null;
let isRollingLocal = false;
let botTimer = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

/** Firebase 등에서 배열이 객체로 반환되는 경우를 대비한 안전 배열 변환기 */
function asArray(val, defaultArr = []) {
  if (!val) return defaultArr;
  if (Array.isArray(val)) return [...val];
  if (typeof val === 'object') {
    return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
  }
  return defaultArr;
}

// DOM 요소 캐싱
const displayRoomCode = document.getElementById('display-room-code');
const turnAvatar = document.getElementById('turn-avatar');

let isCodeHidden = false;
function updateRoomCodeText() {
  if (!displayRoomCode) return;
  displayRoomCode.textContent = isCodeHidden ? 'ROOM: •••••• 👁️' : `ROOM: ${myRoomCode} 🔒`;
  displayRoomCode.style.cursor = 'pointer';
  displayRoomCode.title = '클릭하여 방 코드 숨기기/보기';
}
const turnText = document.getElementById('turn-text');
const roundText = document.getElementById('round-text');
const rollsLeftBadge = document.getElementById('rolls-left-badge');
const rollHint = document.getElementById('roll-hint');
const diceTray = document.getElementById('dice-tray');
const holdSlotsContainer = document.getElementById('hold-slots-container');
const btnRoll = document.getElementById('btn-roll');
const btnRollText = document.getElementById('btn-roll-text');
const scoreTable = document.getElementById('score-table');
const scoreTbody = document.getElementById('score-tbody');
const scoreTfootRow = document.getElementById('score-tfoot-row');
const btnLeave = document.getElementById('btn-leave');
const gameOverModal = document.getElementById('game-over-modal');
const rankingsList = document.getElementById('rankings-list');
const btnModalLobby = document.getElementById('btn-modal-lobby');
const btnModalRestart = document.getElementById('btn-modal-restart');

// ─── 초기화 ─────────────────────────────────────────
async function initYachtGame() {
  updateRoomCodeText();
  displayRoomCode?.addEventListener('click', () => {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initYachtGame);
} else {
  initYachtGame();
}

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

    // 대기실 복귀 동기화
    if (room.status === 'waiting') {
      isNavigatingToLobby = true;
      window.location.href = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('uno_local_mode') === 'true') ? 'index-local.html' : 'index.html';
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

  // 감정표현 리스너 연결
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  emoteListener = onValue(emoteRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const emotes = snapshot.val();
    Object.entries(emotes).forEach(([pid, data]) => {
      if (data && data.emote && data.timestamp) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });
}

// 이미 표시된 감정표현 타임스탬프 추적 (중복 방지)
const shownEmoteTimestamps = new Set();

function showEmotePopup(playerId, emote, timestamp) {
  const key = `${playerId}_${timestamp}`;
  if (shownEmoteTimestamps.has(key)) return;
  shownEmoteTimestamps.add(key);

  if (shownEmoteTimestamps.size > 50) {
    const first = shownEmoteTimestamps.values().next().value;
    shownEmoteTimestamps.delete(first);
  }

  // 플레이어 헤더 셀(.th-player[data-pid="..."]) 위치 기준으로 팝업
  const playerTh = document.querySelector(`.th-player[data-pid="${playerId}"]`);
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  popup.textContent = emote;

  if (playerTh) {
    const rect = playerTh.getBoundingClientRect();
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${Math.max(10, rect.top - 20)}px`;
  } else {
    // 앵커를 찾지 못한 경우 중앙 상단
    popup.style.left = '50%';
    popup.style.top = '100px';
  }

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 2800);
}

async function sendYachtEmote(emote) {
  playButtonClick();
  showEmotePopup(myPlayerId, emote, Date.now());
  try {
    await update(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`), {
      emote,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('감정표현 전송 실패:', e);
  }
}

/** 메인 화면 렌더링 */
function renderGame(gs) {
  if (playerOrder.length === 0) return;
  const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
  const isMyTurn = (currentPid === myPlayerId);
  const currentPlayer = playersList[currentPid] || { name: '알 수 없음', avatar: '🎲' };

  // 1. 헤더 정보
  turnAvatar.textContent = currentPlayer.avatar || '🎲';
  turnText.textContent = isMyTurn ? '당신의 차례입니다!' : `${currentPlayer.name} 님의 차례`;
  roundText.textContent = `${Math.min(gs.round, 12)}/12`;
  rollsLeftBadge.textContent = `남은 굴림: ${gs.rollsLeft}회`;

  // 2. 주사위 트레이 및 HOLD 슬롯 렌더링
  const diceArr = asArray(gs.dice, [1, 2, 3, 4, 5]);
  const heldArr = asArray(gs.held, [false, false, false, false, false]);
  renderDice(diceArr, heldArr, gs.isRolled, isMyTurn && gs.isRolled);

  // 3. 굴리기 버튼 상태 제어
  if (isMyTurn && gs.rollsLeft > 0 && !isRollingLocal) {
    btnRoll.disabled = false;
    btnRollText.textContent = `주사위 굴리기 (${gs.rollsLeft}/3)`;
    rollHint.textContent = gs.rollsLeft === 3 ? '주사위를 굴려 턴을 시작하세요!' : '고정할 주사위를 클릭한 뒤 다시 굴릴 수 있습니다.';
  } else {
    btnRoll.disabled = true;
    if (!isMyTurn) {
      btnRollText.textContent = `${currentPlayer.name} 턴 진행 중...`;
      rollHint.textContent = '상대방의 플레이를 기다려주세요.';
    } else {
      btnRollText.textContent = '카테고리를 선택하세요';
      rollHint.textContent = '왼쪽 점수판에서 점수를 기록할 칸을 클릭하세요!';
    }
  }

  // 4. [★ 핵심] 사진 스타일 다중 열 스코어보드 렌더링
  renderClassicScoreboard(gs, currentPid);

  // 5. 게임 종료 체크
  if (gs.status === 'finished') {
    renderGameOver(gs);
  }
}

/** 주사위 5개 및 HOLD 슬롯 렌더링 */
function renderDice(dice, held, isRolled, canToggleHold) {
  diceTray.innerHTML = '';
  const dList = asArray(dice, [1, 2, 3, 4, 5]);
  const hList = asArray(held, [false, false, false, false, false]);

  dList.forEach((val, idx) => {
    const isHeld = !!hList[idx];
    const wrapper = document.createElement('div');
    wrapper.className = `dice-wrapper ${isHeld ? 'held' : ''}`;
    wrapper.setAttribute('data-dice-idx', idx);

    const cube = document.createElement('div');
    cube.className = `dice-cube dice-val-${val}`;

    for (let i = 0; i < val; i++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      cube.appendChild(dot);
    }

    if (isHeld) {
      const tag = document.createElement('div');
      tag.className = 'hold-tag';
      tag.textContent = 'HOLD';
      cube.appendChild(tag);
    }

    if (canToggleHold && !isRollingLocal) {
      wrapper.style.cursor = 'pointer';
      wrapper.title = isHeld ? '클릭하여 고정 해제' : '클릭하여 주사위 고정 (HOLD)';
      wrapper.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleToggleHold(idx);
      };
    } else {
      wrapper.style.cursor = 'default';
    }

    wrapper.appendChild(cube);
    diceTray.appendChild(wrapper);
  });

  // 상단 HOLD 슬롯 박스 갱신
  if (holdSlotsContainer) {
    const slotBoxes = holdSlotsContainer.querySelectorAll('.hold-slot-box');
    slotBoxes.forEach((box, idx) => {
      box.innerHTML = '';
      const isHeld = !!hList[idx];
      if (isHeld) {
        box.classList.add('has-dice');
        const miniDice = document.createElement('span');
        miniDice.style.fontSize = '1.4rem';
        const symbols = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        miniDice.textContent = symbols[(dList[idx] || 1) - 1] || '🎲';
        box.appendChild(miniDice);
        if (canToggleHold && !isRollingLocal) {
          box.style.cursor = 'pointer';
          box.title = '클릭하여 고정 해제';
          box.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleToggleHold(idx);
          };
        }
      } else {
        box.classList.remove('has-dice');
        box.style.cursor = 'default';
        box.title = '';
        box.onclick = null;
      }
    });
  }
}

/**
 * ═══════════════════════════════════════════════════
 * [★ 핵심] 사진 스타일 클래식 스코어보드 렌더링 함수
 * ═══════════════════════════════════════════════════
 */
function renderClassicScoreboard(gs, currentPid) {
  // 1. 헤더 갱신: 플레이어 열들 렌더링
  const headerTurnRow = document.querySelector('.header-turn-row');
  if (headerTurnRow) {
    // 기존 th-player 셀들만 제거
    headerTurnRow.querySelectorAll('.th-player').forEach(th => th.remove());

    playerOrder.forEach((pid, pIdx) => {
      const player = playersList[pid] || { name: `P${pIdx+1}`, avatar: '🎲' };
      const th = document.createElement('th');
      const isPlayerTurn = (pid === currentPid);
      th.className = `th-player ${isPlayerTurn ? 'is-turn' : ''}`;
      th.setAttribute('data-pid', pid);

      // 플레이어 아바타 배지 (사용자 설정 아바타 100% 반영)
      let avatarBadgeClass = 'player-avatar-badge';
      if (pIdx === 1) avatarBadgeClass += ' p2';
      else if (pIdx === 2) avatarBadgeClass += ' p3';
      else if (pIdx === 3) avatarBadgeClass += ' p4';

      const avatarContent = player.avatar || (player.isBot ? '🤖' : '🎲');

      th.innerHTML = `
        <div class="${avatarBadgeClass}">${avatarContent}</div>
        <div class="player-col-name" title="${escapeHtml(player.name)}">
          ${escapeHtml(player.name)} ${pid === myPlayerId ? '(나)' : ''}
        </div>
      `;
      headerTurnRow.appendChild(th);
    });
  }

  // 2. Categories 제목 colspan 맞춤
  const catTitleCell = document.getElementById('cat-title-cell');
  if (catTitleCell) {
    catTitleCell.colSpan = 1 + playerOrder.length;
  }

  // 3. 테이블 본문(카테고리 행들) 렌더링
  scoreTbody.innerHTML = '';
  const isMyTurn = (currentPid === myPlayerId);

  // 카테고리 기호 매핑 (사진 그대로)
  const CATEGORY_SYMBOLS = {
    aces: '⚀',
    deuces: '⚁',
    threes: '⚂',
    fours: '⚃',
    fives: '⚄',
    sixes: '⚅',
    choice: '⚄',
    fourKind: '⚃',
    fullHouse: '⚂⚁',
    sStraight: '⚀⚁⚂⚃',
    lStraight: '⚀⚁⚂⚃⚄',
    yacht: '⚄⚄⚄'
  };

  const CATEGORY_LABELS = {
    aces: 'Aces',
    deuces: 'Deuces',
    threes: 'Threes',
    fours: 'Fours',
    fives: 'Fives',
    sixes: 'Sixes',
    choice: 'Choice',
    fourKind: '4 of a Kind',
    fullHouse: 'Full House',
    sStraight: 'S. Straight',
    lStraight: 'L. Straight',
    yacht: 'Yacht'
  };

  // 상단 카테고리 6개 (Aces ~ Sixes)
  const upperCats = ['aces', 'deuces', 'threes', 'fours', 'fives', 'sixes'];
  upperCats.forEach(catKey => {
    appendCategoryRow(catKey, CATEGORY_SYMBOLS[catKey], CATEGORY_LABELS[catKey], gs, currentPid, isMyTurn);
  });

  // Subtotal 행
  appendSubtotalRow(gs, currentPid);

  // +35 Bonus 행
  appendBonusRow(gs, currentPid);

  // Bonus 안내 텍스트 행
  appendBonusDescRow();

  // 하단 카테고리 6개 (Choice, 4 of a Kind, Full House, S. Straight, L. Straight, Yacht)
  const lowerCats = ['choice', 'fourKind', 'fullHouse', 'sStraight', 'lStraight', 'yacht'];
  lowerCats.forEach(catKey => {
    appendCategoryRow(catKey, CATEGORY_SYMBOLS[catKey], CATEGORY_LABELS[catKey], gs, currentPid, isMyTurn);
  });

  // 4. Total 합계 행 갱신
  renderTotalRow(gs, currentPid);
}

/** 개별 카테고리 행 추가 */
function appendCategoryRow(catKey, symbol, label, gs, currentPid, isMyTurn) {
  const tr = document.createElement('tr');
  tr.className = 'cat-row';

  const myScores = (gs.scores && gs.scores[myPlayerId]) || {};
  const isMyCategoryFilled = (myScores[catKey] !== undefined && myScores[catKey] !== null);
  const canSelectThisRow = (isMyTurn && gs.isRolled && !isMyCategoryFilled);

  if (canSelectThisRow) {
    tr.classList.add('row-can-select');
  }

  // 1열: 카테고리 명칭 (주사위 심볼 + 이름)
  const tdName = document.createElement('td');
  tdName.className = 'td-cat-name';
  tdName.innerHTML = `<span class="cat-dice-symbol">${symbol}</span> <span>${label}</span>`;
  if (canSelectThisRow) {
    tdName.style.cursor = 'pointer';
    tdName.title = `클릭하여 [${label}] 점수 기록`;
    tdName.addEventListener('click', (e) => {
      e.stopPropagation();
      handleChooseCategory(catKey);
    });
  }
  tr.appendChild(tdName);

  // 각 플레이어별 점수 열
  playerOrder.forEach(pid => {
    const tdScore = document.createElement('td');
    const isPlayerTurn = (pid === currentPid);
    tdScore.className = `td-player-score ${isPlayerTurn ? 'turn-col' : ''}`;

    const playerScores = (gs.scores && gs.scores[pid]) || {};
    const isFilled = (playerScores[catKey] !== undefined && playerScores[catKey] !== null);

    if (isFilled) {
      const val = playerScores[catKey];
      tdScore.textContent = val;
      tdScore.classList.add('filled');
      if (val === 0) tdScore.classList.add('zero-score');
    } else {
      // 아직 기록되지 않은 빈 칸
      if (pid === myPlayerId) {
        // [★ 핵심] 내 점수 칸인 경우:
        if (isMyTurn && gs.isRolled) {
          // 주사위를 굴린 상태 -> 예상 점수(Preview) 표시 및 클릭 가능!
          const potentialScore = calculateCategoryScore(catKey, gs.dice);
          tdScore.textContent = potentialScore;
          tdScore.classList.add('selectable', 'preview-score');
          tdScore.title = `클릭하여 [${label}]에 ${potentialScore}점 기록`;

          // 클릭 시 점수 확정 입력!
          tdScore.addEventListener('click', (e) => {
            e.stopPropagation();
            handleChooseCategory(catKey);
          });
        } else {
          // 아직 주사위를 안 굴렸거나 내 턴이 아닌 경우
          tdScore.textContent = '';
          tdScore.style.cursor = 'pointer';
          tdScore.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isMyTurn) {
              showToast('상대방의 턴입니다!');
            } else if (!gs.isRolled) {
              showToast('먼저 주사위를 굴려주세요! 🎲');
            }
          });
        }
      } else {
        // 다른 플레이어의 빈 칸
        tdScore.textContent = '';
      }
    }

    tr.appendChild(tdScore);
  });

  scoreTbody.appendChild(tr);
}

/** Subtotal 행 추가 (사진처럼 24/63 형식 표시) */
function appendSubtotalRow(gs, currentPid) {
  const tr = document.createElement('tr');
  tr.className = 'subtotal-row';

  const tdLabel = document.createElement('td');
  tdLabel.className = 'td-cat-name';
  tdLabel.style.fontWeight = '800';
  tdLabel.textContent = 'Subtotal';
  tr.appendChild(tdLabel);

  playerOrder.forEach(pid => {
    const tdVal = document.createElement('td');
    const isPlayerTurn = (pid === currentPid);
    tdVal.className = `td-subtotal-val ${isPlayerTurn ? 'turn-col' : ''}`;

    const pScores = (gs.scores && gs.scores[pid]) || {};
    const totals = calculateTotals(pScores);
    tdVal.textContent = `${totals.upperTotal}/63`;
    tr.appendChild(tdVal);
  });

  scoreTbody.appendChild(tr);
}

/** +35 Bonus 행 추가 */
function appendBonusRow(gs, currentPid) {
  const tr = document.createElement('tr');
  tr.className = 'bonus-row';

  const tdLabel = document.createElement('td');
  tdLabel.className = 'td-cat-name';
  tdLabel.style.fontWeight = '800';
  tdLabel.textContent = '+35 Bonus';
  tr.appendChild(tdLabel);

  playerOrder.forEach(pid => {
    const tdVal = document.createElement('td');
    const isPlayerTurn = (pid === currentPid);
    tdVal.className = `td-bonus-val ${isPlayerTurn ? 'turn-col' : ''}`;

    const pScores = (gs.scores && gs.scores[pid]) || {};
    const totals = calculateTotals(pScores);
    tdVal.textContent = totals.bonus > 0 ? '+35' : '';
    tr.appendChild(tdVal);
  });

  scoreTbody.appendChild(tr);
}

/** Bonus 조건 안내 텍스트 행 */
function appendBonusDescRow() {
  const tr = document.createElement('tr');
  tr.className = 'bonus-desc-row';

  const td = document.createElement('td');
  td.className = 'td-bonus-desc';
  td.colSpan = 1 + playerOrder.length;
  td.innerHTML = `Bonus if ⚀ - ⚅ are over 63 points`;
  tr.appendChild(td);

  scoreTbody.appendChild(tr);
}

/** Total 합계 행 갱신 */
function renderTotalRow(gs, currentPid) {
  if (!scoreTfootRow) return;
  // 기존 플레이어 셀 제거
  scoreTfootRow.querySelectorAll('.td-total-val').forEach(td => td.remove());

  playerOrder.forEach(pid => {
    const td = document.createElement('td');
    const isPlayerTurn = (pid === currentPid);
    td.className = `td-total-val ${isPlayerTurn ? 'turn-col' : ''}`;

    const pScores = (gs.scores && gs.scores[pid]) || {};
    const totals = calculateTotals(pScores);
    td.textContent = totals.grandTotal;
    scoreTfootRow.appendChild(td);
  });
}

// ─── 유저 인터랙션 액션 ─────────────────────────────

/** 주사위 굴리기 */
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

/** 주사위 고정 (HOLD) 토글 */
async function handleToggleHold(index) {
  if (!currentGs || !currentGs.isRolled) {
    showToast('먼저 주사위를 굴려주세요! 🎲');
    return;
  }
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) {
    showToast('상대방의 턴입니다!');
    return;
  }
  if (isRollingLocal) return;

  playDiceHold();

  const currentHeld = asArray(currentGs.held, [false, false, false, false, false]);
  const nextHeld = [...currentHeld];
  nextHeld[index] = !nextHeld[index];

  // 즉각적인 로컬 낙관적 렌더링 (Optimistic UI)
  currentGs.held = nextHeld;
  renderDice(asArray(currentGs.dice, [1, 2, 3, 4, 5]), nextHeld, true, true);

  try {
    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      held: nextHeld
    });
  } catch (e) {
    console.error('주사위 HOLD 동기화 실패:', e);
  }
}

/** [★ 핵심] 카테고리 선택 및 점수 확정 입력 */
async function handleChooseCategory(categoryKey) {
  if (!currentGs) return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) {
    showToast('상대방의 턴입니다!');
    return;
  }
  if (!currentGs.isRolled) {
    showToast('먼저 주사위를 굴려주세요! 🎲');
    return;
  }

  const myScores = (currentGs.scores && currentGs.scores[myPlayerId]) || {};
  if (myScores[categoryKey] !== undefined && myScores[categoryKey] !== null) {
    playError();
    showToast('이미 기록된 카테고리입니다!');
    return;
  }

  const scoreEarned = calculateCategoryScore(categoryKey, currentGs.dice);
  playButtonClick();

  await commitTurnScore(myPlayerId, categoryKey, scoreEarned);
}

/** 점수 저장 및 다음 턴 진행 */
async function commitTurnScore(pid, categoryKey, score) {
  const updatedScores = { ...(currentGs.scores || {}) };
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

  // [★ 핵심] scores 객체를 통째로 넘겨 중첩 키 경로 누락 문제 100% 방지!
  const updates = {
    [`rooms/${myRoomCode}/gameState/scores`]: updatedScores,
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
      <div style="font-size:1.1rem; font-weight:900; color:${idx === 0 ? '#FFD700' : '#FFF'};">
        ${r.score}점 ${r.upperBonus ? '<span style="font-size:0.75rem; color:#2ED573;">(+35)</span>' : ''}
      </div>
    </div>
  `).join('');

  gameOverModal.classList.add('show');
}

// ─── 방 이탈 및 안전 종료 ─────────────────────────────
async function handleLeaveGameSafely() {
  isNavigatingToLobby = true;
  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (roomSnap.exists()) {
      const room = roomSnap.val();
      const players = room.players || {};
      const remainingHumanIds = Object.keys(players).filter(id => id !== myPlayerId && !id.startsWith('bot_'));

      if (room.host === myPlayerId && remainingHumanIds.length === 0) {
        await remove(ref(database, `rooms/${myRoomCode}`));
        window.location.href = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('uno_local_mode') === 'true') ? 'index-local.html' : 'index.html';
        return;
      }

      const updates = {};
      updates[`rooms/${myRoomCode}/players/${myPlayerId}`] = null;
      if (room.host === myPlayerId && remainingHumanIds.length > 0) {
        const nextHost = remainingHumanIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

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

  window.location.href = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('uno_local_mode') === 'true') ? 'index-local.html' : 'index.html';
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
    window.location.href = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('uno_local_mode') === 'true') ? 'index-local.html' : 'index.html';
  });

  btnModalRestart.addEventListener('click', async () => {
    if (!isHost) return;
    gameOverModal.classList.remove('show');
    await initYachtGameState();
  });

  // 감정표현 (우노 스타일 실시간 팝업 동기화)
  document.querySelectorAll('.btn-emote').forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.dataset.emote;
      if (emote) sendYachtEmote(emote);
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
