// ═══════════════════════════════════════════════════
// 텍사스 홀덤 포커 메인 게임 로직
// Firebase 실시간 멀티플레이어, Fixed Limit 베팅
// ═══════════════════════════════════════════════════

import {
  database, ref, set, get, onValue, update, remove, runTransaction, serverTimestamp
} from './firebase-config.js';
import {
  createDeck, shuffleDeck, determineWinners, getBetUnit, evaluateBestHand,
  MAX_RAISES_PER_ROUND, INITIAL_CHIPS, SMALL_BLIND, BIG_BLIND
} from './holdem-rules.js';
import { renderPokerCardSVG, renderCardBack } from './holdem-renderer.js';

// ─── 상태 변수 ─────────────────────────────────────
let myPlayerId = null;
let myRoomCode = null;
let myName = '';
let isHost = false;
let gameState = null;
let myHoleCards = [];
let roomPlayersCache = {};
const listeners = [];

// ─── 초기화 ─────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  // URL 파라미터 파싱
  const params = new URLSearchParams(window.location.search);
  myRoomCode = params.get('room');
  myPlayerId = params.get('player') || sessionStorage.getItem('uno_player_id');

  if (!myRoomCode || !myPlayerId) {
    window.location.href = 'index.html';
    return;
  }

  // 플레이어 정보 로딩
  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) { window.location.href = 'index.html'; return; }
  const room = roomSnap.val();
  isHost = room.host === myPlayerId;
  roomPlayersCache = room.players || {};

  const me = roomPlayersCache[myPlayerId];
  myName = me?.name || '나';

  // Firebase 리스닝 시작
  listenToGame();
  listenToMyHand();

  // 나가기 버튼
  document.getElementById('btn-leave')?.addEventListener('click', handleLeave);
  document.getElementById('btn-next-round')?.addEventListener('click', handleNextRound);

  // 베팅 버튼
  document.getElementById('btn-check')?.addEventListener('click', () => handleBetAction('check'));
  document.getElementById('btn-call')?.addEventListener('click', () => handleBetAction('call'));
  document.getElementById('btn-raise')?.addEventListener('click', () => handleBetAction('raise'));
  document.getElementById('btn-fold')?.addEventListener('click', () => handleBetAction('fold'));

  // 방장이면 게임 자동 초기화
  if (isHost) {
    const gs = (await get(ref(database, `rooms/${myRoomCode}/gameState`))).val();
    if (!gs || !gs.phase || gs.phase === 'waiting') {
      setTimeout(() => startNewRound(), 1200);
    }
  }
});

// ─── Firebase 리스닝 ──────────────────────────────

function listenToGame() {
  const gsRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const unsub = onValue(gsRef, (snap) => {
    if (!snap.exists()) return;
    gameState = snap.val();
    renderAll();
  });
  listeners.push({ ref: gsRef, unsub });
}

function listenToMyHand() {
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${myPlayerId}`);
  const unsub = onValue(handRef, (snap) => {
    if (!snap.exists()) { myHoleCards = []; return; }
    const val = snap.val();
    myHoleCards = Array.isArray(val) ? val : Object.values(val);
    renderMyHand();
  });
  listeners.push({ ref: handRef, unsub });
}

function cleanupListeners() {
  listeners.forEach(({ unsub }) => { try { unsub(); } catch (e) {} });
  listeners.length = 0;
}

// ─── 새 라운드 시작 (방장만) ────────────────────────

async function startNewRound() {
  if (!isHost) return;

  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) return;
  const room = roomSnap.val();
  roomPlayersCache = room.players || {};

  const prevGs = room.gameState || {};

  // 플레이어 순서 결정
  const playerIds = Object.keys(roomPlayersCache);
  if (playerIds.length < 2) return;

  // 딜러 인덱스 로테이션
  const prevDealer = prevGs.dealerIndex ?? -1;
  const dealerIndex = (prevDealer + 1) % playerIds.length;
  const sbIndex = (dealerIndex + 1) % playerIds.length;
  const bbIndex = (dealerIndex + 2) % playerIds.length;

  // 이전 칩 상태 승계 (없으면 초기값)
  const prevChips = prevGs.chipCounts || {};
  const chipCounts = {};
  for (const pid of playerIds) {
    chipCounts[pid] = (prevChips[pid] !== undefined ? prevChips[pid] : INITIAL_CHIPS);
    // 칩이 없으면 리바이
    if (chipCounts[pid] <= 0) chipCounts[pid] = INITIAL_CHIPS;
  }

  // 덱 셔플 후 홀 카드 딜
  const deck = shuffleDeck(createDeck());
  const handUpdates = {};
  const newHands = {};
  for (let i = 0; i < playerIds.length; i++) {
    const pid = playerIds[i];
    newHands[pid] = [deck.shift(), deck.shift()];
    handUpdates[`rooms/${myRoomCode}/hands/${pid}`] = newHands[pid];
  }

  // 블라인드 처리
  const sbPlayer = playerIds[sbIndex];
  const bbPlayer = playerIds[bbIndex];
  chipCounts[sbPlayer] = Math.max(0, chipCounts[sbPlayer] - SMALL_BLIND);
  chipCounts[bbPlayer] = Math.max(0, chipCounts[bbPlayer] - BIG_BLIND);

  const currentBets = {};
  for (const pid of playerIds) currentBets[pid] = 0;
  currentBets[sbPlayer] = SMALL_BLIND;
  currentBets[bbPlayer] = BIG_BLIND;

  // 첫 번째 베터 (BB 다음)
  const firstBettor = playerIds[(bbIndex + 1) % playerIds.length];

  const newGs = {
    phase: 'preflop',
    pot: SMALL_BLIND + BIG_BLIND,
    communityCards: [],
    currentBettor: firstBettor,
    currentBet: BIG_BLIND,
    raiseCount: 0,
    playerOrder: playerIds,
    chipCounts,
    currentBets,
    folded: {},
    dealerIndex,
    sbIndex,
    bbIndex,
    lastAction: {
      type: 'deal',
      playerName: '딜러',
      amount: 0,
      timestamp: Date.now()
    },
    finished: false,
    winner: null,
    winnerHand: null,
    showdownData: null
  };

  await update(ref(database), {
    [`rooms/${myRoomCode}/gameState`]: newGs,
    ...handUpdates
  });

  // 봇 AI 첫 번째 베터 체크
  setTimeout(() => triggerBotIfNeeded(), 800);
}

// ─── 전체 렌더 ────────────────────────────────────

function renderAll() {
  if (!gameState) return;
  renderOpponents();
  renderCommunityCards();
  renderPhase();
  renderPot();
  renderBettingButtons();
  renderInfoPanel();
  renderMyHandRank();
  checkShowdown();

  // 내 차례 강조
  const isMyTurn = gameState.currentBettor === myPlayerId;
  document.querySelector('.poker-table-area')?.classList.toggle('my-turn', isMyTurn);
}

// ─── 상대 플레이어 렌더 ─────────────────────────────

function renderOpponents() {
  const area = document.getElementById('opponents-area');
  if (!area || !gameState) return;

  const playerIds = gameState.playerOrder || [];
  const opponents = playerIds.filter(pid => pid !== myPlayerId);

  area.innerHTML = opponents.map(pid => {
    const player = roomPlayersCache[pid];
    const name = player?.name || pid;
    const avatar = player?.avatar || '🤖';
    const chips = gameState.chipCounts?.[pid] ?? 0;
    const bet = gameState.currentBets?.[pid] ?? 0;
    const isFolded = gameState.folded?.[pid];
    const isActive = gameState.currentBettor === pid;
    const isDealer = pid === gameState.playerOrder?.[gameState.dealerIndex];
    const isWinner = gameState.winner === pid || (Array.isArray(gameState.winner) && gameState.winner.includes(pid));

    // 쇼다운 후 카드 공개 여부
    const showdownData = gameState.showdownData;
    let cardHtml = '';
    if (showdownData && showdownData[pid]) {
      // 쇼다운: 카드 공개
      const cards = showdownData[pid].cards || [];
      cardHtml = `<div class="opponent-cards">
        ${cards.map(c => `<div style="border-radius:6px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.7);">${renderPokerCardSVG(c, { width: 50, height: 72, highlight: isWinner })}</div>`).join('')}
      </div>`;
    } else {
      // 인게임: 카드 뒷면
      const numCards = isFolded ? 0 : 2;
      cardHtml = `<div class="opponent-cards">
        ${Array(numCards).fill(0).map(() => `<div style="border-radius:6px; overflow:hidden;">${renderCardBack({ width: 50, height: 72 })}</div>`).join('')}
      </div>`;
    }

    return `
      <div class="player-panel ${isActive ? 'active-turn' : ''} ${isFolded ? 'folded' : ''} ${isWinner ? 'winner' : ''}">
        ${isDealer ? '<div class="dealer-chip">D</div>' : ''}
        <div class="p-avatar">${avatar}</div>
        ${cardHtml}
        <div class="p-name">${escapeHtml(name)}</div>
        <div class="p-chips">💰 ${chips}칩</div>
        <div class="p-bet">${bet > 0 ? `배팅: ${bet}칩` : ''}</div>
        ${isActive ? '<div style="font-size:0.7rem; color:#FBBF24; font-weight:700; animation:pulse 1s infinite;">⏳ 생각 중...</div>' : ''}
        ${isWinner ? '<div style="font-size:0.75rem; color:#FFD900; font-weight:900;">🏆 승자!</div>' : ''}
        ${showdownData && showdownData[pid] ? `<div style="font-size:0.7rem; color:#d4af37; font-weight:700;">${showdownData[pid].handRank}</div>` : ''}
      </div>`;
  }).join('');
}

// ─── 커뮤니티 카드 렌더 ─────────────────────────────

function renderCommunityCards() {
  const area = document.getElementById('community-cards');
  if (!area || !gameState) return;

  const cards = gameState.communityCards || [];
  area.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const card = cards[i];
    const el = document.createElement('div');
    if (card) {
      el.className = 'community-card';
      el.style.cssText = 'border-radius:8px; overflow:hidden;';
      el.innerHTML = renderPokerCardSVG(card, { width: 72, height: 103 });
      el.style.animationDelay = `${i * 0.1}s`;
    } else {
      el.className = 'card-slot';
      el.textContent = '?';
    }
    area.appendChild(el);
  }
}

// ─── 단계 배지 렌더 ─────────────────────────────────

function renderPhase() {
  const el = document.getElementById('phase-badge');
  if (!el || !gameState) return;

  const phaseNames = {
    preflop: '프리 플랍',
    flop: '플 랍',
    turn: '턴',
    river: '리 버',
    showdown: '쇼 다운'
  };
  el.className = `phase-badge ${gameState.phase || ''}`;
  el.textContent = phaseNames[gameState.phase] || gameState.phase || '';
}

// ─── 팟 렌더 ─────────────────────────────────────────

function renderPot() {
  const el = document.getElementById('pot-amount');
  if (el && gameState) el.textContent = `${gameState.pot ?? 0}칩`;
}

// ─── 내 홀 카드 렌더 ────────────────────────────────

function renderMyHand() {
  const area = document.getElementById('my-hand-cards');
  if (!area) return;

  if (!myHoleCards || myHoleCards.length === 0) {
    area.innerHTML = `
      ${renderCardBack({ width: 90, height: 128 }).replace('<svg', '<svg class="my-hole-card"')}
      ${renderCardBack({ width: 90, height: 128 }).replace('<svg', '<svg class="my-hole-card"')}
    `;
    return;
  }

  area.innerHTML = myHoleCards.map(card =>
    `<div class="my-hole-card" style="border-radius:10px; overflow:hidden; box-shadow:0 8px 30px rgba(0,0,0,0.8);">
      ${renderPokerCardSVG(card, { width: 90, height: 128 })}
    </div>`
  ).join('');
}

// ─── 내 현재 핸드 랭킹 표시 ─────────────────────────

function renderMyHandRank() {
  const el = document.getElementById('my-hand-rank');
  if (!el) return;

  const community = gameState?.communityCards || [];
  if (myHoleCards.length < 2 || community.length < 3) {
    el.textContent = '핸드 대기 중...';
    return;
  }

  try {
    const result = evaluateBestHand(myHoleCards, community);
    if (result) {
      el.textContent = `🃏 ${result.name}`;
    }
  } catch (e) {
    el.textContent = '핸드 계산 중...';
  }
}


// ─── 베팅 버튼 렌더 ────────────────────────────────

function renderBettingButtons() {
  const isMyTurn = gameState?.currentBettor === myPlayerId;
  const isFolded = gameState?.folded?.[myPlayerId];
  const isFinished = gameState?.finished || gameState?.phase === 'showdown';

  const checkBtn  = document.getElementById('btn-check');
  const callBtn   = document.getElementById('btn-call');
  const raiseBtn  = document.getElementById('btn-raise');
  const foldBtn   = document.getElementById('btn-fold');
  const betInfo   = document.getElementById('bet-info');
  const nextBtn   = document.getElementById('btn-next-round');

  const canAct = isMyTurn && !isFolded && !isFinished;

  if (checkBtn) checkBtn.disabled  = !canAct;
  if (callBtn)  callBtn.disabled   = !canAct;
  if (raiseBtn) raiseBtn.disabled  = !canAct;
  if (foldBtn)  foldBtn.disabled   = !canAct;

  if (!canAct && betInfo) {
    if (isFinished) {
      betInfo.textContent = '';
    } else if (isFolded) {
      betInfo.textContent = '폴드됨';
    } else {
      const current = gameState?.currentBettor;
      const name = roomPlayersCache[current]?.name || '상대';
      betInfo.textContent = `${name} 베팅 중...`;
    }
  } else if (canAct && betInfo) {
    const unit = getBetUnit(gameState?.phase || 'preflop');
    const myBet = gameState?.currentBets?.[myPlayerId] ?? 0;
    const curBet = gameState?.currentBet ?? 0;
    const toCall = curBet - myBet;
    const raiseCount = gameState?.raiseCount ?? 0;
    const canRaise = raiseCount < MAX_RAISES_PER_ROUND;

    if (toCall > 0) {
      betInfo.textContent = `콜: ${toCall}칩 | 레이즈: ${unit}칩 추가 (레이즈 ${raiseCount}/${MAX_RAISES_PER_ROUND})`;
    } else {
      betInfo.textContent = `체크 가능 | 레이즈: ${unit}칩 (레이즈 ${raiseCount}/${MAX_RAISES_PER_ROUND})`;
    }

    // 체크/콜 구분
    if (checkBtn)  checkBtn.textContent  = toCall > 0 ? '— 건너뛰기 불가' : '✓ 체크';
    if (checkBtn)  checkBtn.disabled     = !canAct || toCall > 0;
    if (callBtn)   callBtn.textContent   = toCall > 0 ? `📞 콜 (${toCall}칩)` : '콜';
    if (callBtn)   callBtn.disabled      = !canAct || toCall <= 0;
    if (raiseBtn)  raiseBtn.textContent  = `↑ 레이즈 (+${unit}칩)`;
    if (raiseBtn)  raiseBtn.disabled     = !canAct || !canRaise;
  }

  // 다음 라운드 버튼
  if (nextBtn) {
    nextBtn.style.display = isHost && isFinished ? 'inline-flex' : 'none';
  }
}

// ─── 우측 정보 패널 렌더 ────────────────────────────

function renderInfoPanel() {
  if (!gameState) return;

  const playerIds = gameState.playerOrder || [];

  // 칩 목록
  const chipList = document.getElementById('chip-list');
  if (chipList) {
    chipList.innerHTML = playerIds.map(pid => {
      const player = roomPlayersCache[pid];
      const name = player?.name || pid;
      const avatar = player?.avatar || '🤖';
      const chips = gameState.chipCounts?.[pid] ?? 0;
      const isActive = gameState.currentBettor === pid;
      const isFolded = gameState.folded?.[pid];
      const isMe = pid === myPlayerId;
      return `<div class="chip-row ${isMe ? 'is-me' : ''} ${isActive ? 'active' : ''} ${isFolded ? 'folded-row' : ''}">
        <span class="chip-avatar">${avatar}</span>
        <span class="chip-name">${escapeHtml(name)}${isMe ? ' (나)' : ''}</span>
        <span class="chip-amount">💰 ${chips}</span>
      </div>`;
    }).join('');
  }

  // 내 칩 표시
  const myChipsEl = document.getElementById('my-chips');
  if (myChipsEl) {
    myChipsEl.textContent = `💰 ${gameState.chipCounts?.[myPlayerId] ?? 0}칩 보유`;
  }

  // 액션 로그
  const lastAct = gameState.lastAction;
  if (lastAct && lastAct.timestamp) {
    appendLog(lastAct);
  }

  // 게임 통계
  const phaseEl = document.getElementById('stat-phase');
  if (phaseEl) {
    const phaseNames = { preflop:'프리플랍', flop:'플랍', turn:'턴', river:'리버', showdown:'쇼다운' };
    phaseEl.textContent = phaseNames[gameState.phase] || '-';
  }
  const raisesEl = document.getElementById('stat-raises');
  if (raisesEl) raisesEl.textContent = `${gameState.raiseCount ?? 0} / ${MAX_RAISES_PER_ROUND}`;
}

// 로그 항목 추가
let lastLogTimestamp = 0;
function appendLog(action) {
  if (!action || action.timestamp === lastLogTimestamp) return;
  lastLogTimestamp = action.timestamp;

  const log = document.getElementById('action-log');
  if (!log) return;

  const typeClass = `action-${action.type}`;
  const icon = { check:'✓', call:'📞', raise:'↑', fold:'✕', win:'🏆', deal:'🃏' }[action.type] || '•';
  const amtText = action.amount > 0 ? ` (${action.amount}칩)` : '';

  const entry = document.createElement('div');
  entry.className = `log-entry ${typeClass}`;
  entry.textContent = `${icon} ${escapeHtml(action.playerName || '')} ${getActionText(action.type)}${amtText}`;
  log.appendChild(entry);

  // 최대 30개 유지
  while (log.children.length > 30) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function getActionText(type) {
  const texts = { check:'체크', call:'콜', raise:'레이즈', fold:'폴드', win:'승리!', deal:'딜' };
  return texts[type] || type;
}

// ─── 쇼다운 체크 및 표시 ────────────────────────────

function checkShowdown() {
  if (!gameState || gameState.phase !== 'showdown') {
    document.getElementById('showdown-overlay')?.classList.remove('show');
    return;
  }
  showShowdown();
}

function showShowdown() {
  const overlay = document.getElementById('showdown-overlay');
  if (!overlay || !gameState) return;

  const showdownData = gameState.showdownData || {};
  const winners = Array.isArray(gameState.winner) ? gameState.winner : (gameState.winner ? [gameState.winner] : []);
  const winnerHand = gameState.winnerHand || '';
  const playerIds = gameState.playerOrder || [];

  const winnerNames = winners.map(pid => roomPlayersCache[pid]?.name || pid).join(', ');

  // 쇼다운 플레이어 카드 표시
  const playersHtml = playerIds.map(pid => {
    const player = roomPlayersCache[pid];
    const name = player?.name || pid;
    const avatar = player?.avatar || '🤖';
    const isWinner = winners.includes(pid);
    const isFolded = gameState.folded?.[pid];
    const sdData = showdownData[pid];

    if (isFolded) {
      return `<div class="showdown-player folded-player">
        <span style="font-size:1.3rem">${avatar}</span>
        <div class="sd-name">${escapeHtml(name)}</div>
        <div class="sd-rank">폴드</div>
      </div>`;
    }

    const cards = sdData?.cards || (pid === myPlayerId ? myHoleCards : []);
    const handRank = sdData?.handRank || '-';
    const cardHtml = cards.length > 0
      ? cards.map(c => `<div style="border-radius:6px;overflow:hidden;">${renderPokerCardSVG(c, { width: 58, height: 83, highlight: isWinner })}</div>`).join('')
      : renderCardBack({ width: 58, height: 83 }).replace('<svg', '<div style="border-radius:6px;overflow:hidden;"><svg') + '</div>';

    return `<div class="showdown-player ${isWinner ? 'winner-card' : ''}">
      <span style="font-size:1.3rem">${avatar}</span>
      <div class="sd-name">${escapeHtml(name)}${isWinner ? ' 🏆' : ''}</div>
      <div class="sd-hand">${cardHtml}</div>
      <div class="sd-rank">${handRank}</div>
    </div>`;
  }).join('');

  overlay.querySelector('.showdown-title').textContent = '🏆 게임 종료!';
  overlay.querySelector('.showdown-winner-name').innerHTML = `<span>${escapeHtml(winnerNames)}</span> 승리 — <span style="color:rgba(240,240,255,0.7)">${escapeHtml(winnerHand)}</span>`;
  overlay.querySelector('.showdown-players').innerHTML = playersHtml;
  overlay.classList.add('show');
}

// ─── 베팅 액션 처리 ────────────────────────────────

async function handleBetAction(action) {
  if (!gameState || gameState.currentBettor !== myPlayerId) return;
  if (gameState.folded?.[myPlayerId]) return;

  const playerIds = gameState.playerOrder || [];
  const myChips = gameState.chipCounts?.[myPlayerId] ?? 0;
  const myBet = gameState.currentBets?.[myPlayerId] ?? 0;
  const curBet = gameState.currentBet ?? 0;
  const toCall = curBet - myBet;
  const betUnit = getBetUnit(gameState.phase);
  const myName = roomPlayersCache[myPlayerId]?.name || '나';

  let updates = {};
  let logAction = { type: action, playerName: myName, amount: 0, timestamp: Date.now() };

  if (action === 'fold') {
    updates[`rooms/${myRoomCode}/gameState/folded/${myPlayerId}`] = true;
    logAction.type = 'fold';

  } else if (action === 'check') {
    if (toCall > 0) { showFloatMsg('체크 불가! 콜하거나 폴드하세요.'); return; }
    // 패스 (아무 베팅 없이 다음으로)
    logAction.type = 'check';

  } else if (action === 'call') {
    if (toCall <= 0) { showFloatMsg('체크를 사용하세요!'); return; }
    const callAmount = Math.min(toCall, myChips);
    updates[`rooms/${myRoomCode}/gameState/chipCounts/${myPlayerId}`] = myChips - callAmount;
    updates[`rooms/${myRoomCode}/gameState/currentBets/${myPlayerId}`] = myBet + callAmount;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gameState.pot ?? 0) + callAmount;
    logAction.amount = callAmount;
    logAction.type = 'call';

  } else if (action === 'raise') {
    const raiseCount = gameState.raiseCount ?? 0;
    if (raiseCount >= MAX_RAISES_PER_ROUND) { showFloatMsg(`이번 라운드 최대 ${MAX_RAISES_PER_ROUND}회 레이즈입니다.`); return; }
    const newBet = curBet + betUnit;
    const needed = newBet - myBet;
    if (myChips < needed) { showFloatMsg('칩이 부족합니다!'); return; }
    updates[`rooms/${myRoomCode}/gameState/chipCounts/${myPlayerId}`] = myChips - needed;
    updates[`rooms/${myRoomCode}/gameState/currentBets/${myPlayerId}`] = newBet;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gameState.pot ?? 0) + needed;
    updates[`rooms/${myRoomCode}/gameState/currentBet`] = newBet;
    updates[`rooms/${myRoomCode}/gameState/raiseCount`] = raiseCount + 1;
    logAction.amount = needed;
    logAction.type = 'raise';
  }

  // 다음 베터 계산
  const nextBettor = getNextBettor(playerIds, myPlayerId, updates);
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  if (nextBettor === null) {
    // 라운드 종료 → 방장이 다음 단계로 진행
    await update(ref(database), updates);
    if (isHost) {
      setTimeout(() => advancePhase(), 500);
    }
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentBettor`] = nextBettor;
    await update(ref(database), updates);
    // 봇 차례 체크
    if (isHost) {
      setTimeout(() => triggerBotIfNeeded(), 600);
    }
  }
}

// ─── 다음 베터 계산 ─────────────────────────────────

/**
 * 다음 베터 계산. 라운드가 끝나면 null 반환.
 */
function getNextBettor(playerIds, currentId, pendingUpdates = {}) {
  const folded = { ...(gameState.folded || {}), ...getPendingFolded(pendingUpdates) };
  const activePlayers = playerIds.filter(pid => !folded[pid]);

  if (activePlayers.length <= 1) return null; // 모두 폴드

  const curIdx = activePlayers.indexOf(currentId);
  const nextIdx = (curIdx + 1) % activePlayers.length;
  const nextPid = activePlayers[nextIdx];

  // 라운드 종료 체크: 모든 활성 플레이어가 같은 베팅 금액을 냈는지
  const pendingBets = getPendingBets(pendingUpdates);
  const allBets = activePlayers.map(pid => pendingBets[pid] ?? gameState.currentBets?.[pid] ?? 0);
  const pendingCurBet = pendingUpdates[`rooms/${myRoomCode}/gameState/currentBet`] ?? gameState.currentBet ?? 0;

  // nextPid가 라운드 시작자(BB 등)로 돌아왔는지 확인
  const nextIsRoundComplete = activePlayers.every(pid => {
    const bet = pendingBets[pid] ?? gameState.currentBets?.[pid] ?? 0;
    return bet >= pendingCurBet;
  });

  if (nextIsRoundComplete && nextIdx === 0 && curIdx === activePlayers.length - 1) {
    return null;
  }

  // 베팅이 완료되었는지 (모두 콜)
  const allCalled = activePlayers.every(pid => {
    const bet = pendingBets[pid] ?? gameState.currentBets?.[pid] ?? 0;
    return bet >= pendingCurBet;
  });

  if (allCalled && nextPid === getFirstToAct(activePlayers)) {
    return null;
  }

  return nextPid;
}

function getFirstToAct(activePlayers) {
  // 프리플랍: BB 다음, 이후 라운드: SB(또는 딜러 다음)
  if (!gameState) return activePlayers[0];
  const bbIdx = gameState.bbIndex ?? 0;
  const bbPid = gameState.playerOrder?.[bbIdx];
  const afterBb = activePlayers.indexOf(bbPid);
  if (afterBb < 0) return activePlayers[0];
  return activePlayers[(afterBb + 1) % activePlayers.length];
}

function getPendingFolded(updates) {
  const folded = {};
  for (const [k, v] of Object.entries(updates)) {
    const m = k.match(/gameState\/folded\/(.+)/);
    if (m) folded[m[1]] = v;
  }
  return folded;
}

function getPendingBets(updates) {
  const bets = {};
  for (const [k, v] of Object.entries(updates)) {
    const m = k.match(/gameState\/currentBets\/(.+)/);
    if (m) bets[m[1]] = v;
  }
  return bets;
}

// ─── 페이즈 진행 (방장만) ───────────────────────────

async function advancePhase() {
  if (!isHost || !gameState) return;

  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs = snap.val();

  const playerIds = gs.playerOrder || [];
  const activePlayers = playerIds.filter(pid => !gs.folded?.[pid]);

  // 모두 폴드: 마지막 1명이 승자
  if (activePlayers.length === 1) {
    await processWinner(gs, activePlayers, [activePlayers[0]], '상대 폴드로 승리');
    return;
  }

  const phaseOrder = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const curPhaseIdx = phaseOrder.indexOf(gs.phase);
  const nextPhase = phaseOrder[curPhaseIdx + 1] || 'showdown';

  // 커뮤니티 카드 딜
  const deck = shuffleDeck(createDeck()); // 임시 덱 (실제는 남은 덱 유지해야 하나 간단화)
  // 이미 딜된 카드 제외 (정확성보다 간단함 우선)
  let existingCards = [...(gs.communityCards || [])];
  let newCommunity = [...existingCards];

  if (nextPhase === 'flop') {
    newCommunity = [...existingCards, deck.shift(), deck.shift(), deck.shift()];
  } else if (nextPhase === 'turn') {
    newCommunity = [...existingCards, deck.shift()];
  } else if (nextPhase === 'river') {
    newCommunity = [...existingCards, deck.shift()];
  }

  // 베팅 리셋 (프리플랍 이후엔 SB가 먼저)
  const firstActor = activePlayers[(gs.sbIndex ?? 0) % activePlayers.length] || activePlayers[0];
  const resetBets = {};
  for (const pid of playerIds) resetBets[pid] = 0;

  if (nextPhase === 'showdown') {
    // 핸드 평가하여 승자 결정
    await runShowdown(gs, activePlayers, newCommunity.slice(0, 5));
    return;
  }

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: nextPhase,
    communityCards: newCommunity,
    currentBettor: firstActor,
    currentBet: 0,
    raiseCount: 0,
    currentBets: resetBets,
    lastAction: { type: 'deal', playerName: '딜러', amount: 0, timestamp: Date.now() }
  });

  setTimeout(() => triggerBotIfNeeded(), 800);
}

// ─── 쇼다운 처리 (방장만) ───────────────────────────

async function runShowdown(gs, activePlayers, communityCards) {
  if (!isHost) return;

  // 각 플레이어 홀 카드 수집
  const handsSnap = await get(ref(database, `rooms/${myRoomCode}/hands`));
  if (!handsSnap.exists()) return;
  const handsData = handsSnap.val();

  const playerHands = {};
  for (const pid of activePlayers) {
    const hand = handsData[pid];
    if (hand) playerHands[pid] = Array.isArray(hand) ? hand : Object.values(hand);
  }

  const { winners, handResults } = determineWinners(playerHands, communityCards);

  // 팟 분배
  const pot = gs.pot ?? 0;
  const share = Math.floor(pot / winners.length);
  const chipUpdates = { ...(gs.chipCounts || {}) };
  for (const pid of winners) {
    chipUpdates[pid] = (chipUpdates[pid] ?? 0) + share;
  }

  // 쇼다운 데이터 구성 (카드 공개용)
  const showdownData = {};
  for (const pid of activePlayers) {
    showdownData[pid] = {
      cards: playerHands[pid] || [],
      handRank: handResults[pid]?.name || '-'
    };
  }

  const winnerHand = handResults[winners[0]]?.name || '';

  await processWinner(gs, activePlayers, winners, winnerHand, chipUpdates, showdownData, communityCards);
}

async function processWinner(gs, activePlayers, winners, winnerHand, chipUpdates, showdownData, community) {
  const pot = gs.pot ?? 0;

  if (!chipUpdates) {
    chipUpdates = { ...(gs.chipCounts || {}) };
    const share = Math.floor(pot / winners.length);
    for (const pid of winners) {
      chipUpdates[pid] = (chipUpdates[pid] ?? 0) + share;
    }
  }

  const winnerNames = winners.map(pid => roomPlayersCache[pid]?.name || pid).join(', ');

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'showdown',
    finished: true,
    winner: winners.length === 1 ? winners[0] : winners,
    winnerHand,
    chipCounts: chipUpdates,
    pot: 0,
    showdownData: showdownData || null,
    communityCards: community || gs.communityCards || [],
    lastAction: {
      type: 'win',
      playerName: winnerNames,
      amount: pot,
      timestamp: Date.now()
    }
  });
}

// ─── 봇 AI ─────────────────────────────────────────

let botThinking = false;

async function triggerBotIfNeeded() {
  if (!isHost || !gameState) return;
  const current = gameState.currentBettor;
  if (!current || !current.startsWith('bot_')) return;
  if (gameState.finished || gameState.phase === 'showdown') return;
  if (botThinking) return;
  botThinking = true;

  // 봇 생각 딜레이 (0.8 ~ 2초)
  const delay = 800 + Math.random() * 1200;
  await new Promise(r => setTimeout(r, delay));

  // 최신 상태 재조회
  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) { botThinking = false; return; }
  const gs = snap.val();

  if (gs.currentBettor !== current || gs.finished) { botThinking = false; return; }

  await executeBotBet(gs, current);
  botThinking = false;
}

async function executeBotBet(gs, botId) {
  const playerIds = gs.playerOrder || [];
  const activePlayers = playerIds.filter(pid => !gs.folded?.[pid]);
  if (activePlayers.length <= 1) return;

  const botChips = gs.chipCounts?.[botId] ?? 0;
  const botBet = gs.currentBets?.[botId] ?? 0;
  const curBet = gs.currentBet ?? 0;
  const toCall = curBet - botBet;
  const betUnit = getBetUnit(gs.phase);
  const raiseCount = gs.raiseCount ?? 0;
  const botName = roomPlayersCache[botId]?.name || '봇';

  // 간단한 봇 전략: 랜덤 + 약간의 전략
  const rand = Math.random();
  let action;
  if (toCall === 0) {
    // 체크 or 레이즈
    action = (rand < 0.3 && raiseCount < MAX_RAISES_PER_ROUND) ? 'raise' : 'check';
  } else {
    // 콜 or 레이즈 or 폴드
    if (rand < 0.15) {
      action = 'fold';
    } else if (rand < 0.35 && raiseCount < MAX_RAISES_PER_ROUND && botChips >= toCall + betUnit) {
      action = 'raise';
    } else {
      action = 'call';
    }
  }

  let updates = {};
  let logAction = { type: action, playerName: botName, amount: 0, timestamp: Date.now() };

  if (action === 'fold') {
    updates[`rooms/${myRoomCode}/gameState/folded/${botId}`] = true;
    logAction.type = 'fold';

  } else if (action === 'check') {
    logAction.type = 'check';

  } else if (action === 'call') {
    const callAmount = Math.min(toCall, botChips);
    updates[`rooms/${myRoomCode}/gameState/chipCounts/${botId}`] = botChips - callAmount;
    updates[`rooms/${myRoomCode}/gameState/currentBets/${botId}`] = botBet + callAmount;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + callAmount;
    logAction.amount = callAmount;

  } else if (action === 'raise') {
    const newBet = curBet + betUnit;
    const needed = newBet - botBet;
    if (botChips < needed) {
      // 칩 부족 → 콜로 전환
      const callAmount = Math.min(toCall, botChips);
      updates[`rooms/${myRoomCode}/gameState/chipCounts/${botId}`] = botChips - callAmount;
      updates[`rooms/${myRoomCode}/gameState/currentBets/${botId}`] = botBet + callAmount;
      updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + callAmount;
      logAction.type = 'call';
      logAction.amount = callAmount;
    } else {
      updates[`rooms/${myRoomCode}/gameState/chipCounts/${botId}`] = botChips - needed;
      updates[`rooms/${myRoomCode}/gameState/currentBets/${botId}`] = newBet;
      updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + needed;
      updates[`rooms/${myRoomCode}/gameState/currentBet`] = newBet;
      updates[`rooms/${myRoomCode}/gameState/raiseCount`] = raiseCount + 1;
      logAction.amount = needed;
    }
  }

  // 다음 베터 계산
  const mergedGs = { ...gs, folded: { ...gs.folded, ...getPendingFoldedFromUpdates(updates) } };
  const mergedBets = { ...gs.currentBets, ...getPendingBetsFromUpdates(updates) };
  const updatedGs = { ...mergedGs, currentBets: mergedBets, currentBet: updates[`rooms/${myRoomCode}/gameState/currentBet`] ?? gs.currentBet };

  const nextBettor = getNextBettorFromGs(updatedGs, botId);
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  if (nextBettor === null) {
    await update(ref(database), updates);
    setTimeout(() => advancePhase(), 500);
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentBettor`] = nextBettor;
    await update(ref(database), updates);
    setTimeout(() => triggerBotIfNeeded(), 600);
  }
}

function getPendingFoldedFromUpdates(updates) {
  const folded = {};
  for (const [k, v] of Object.entries(updates)) {
    const m = k.match(/gameState\/folded\/(.+)/);
    if (m) folded[m[1]] = v;
  }
  return folded;
}

function getPendingBetsFromUpdates(updates) {
  const bets = {};
  for (const [k, v] of Object.entries(updates)) {
    const m = k.match(/gameState\/currentBets\/(.+)/);
    if (m) bets[m[1]] = v;
  }
  return bets;
}

function getNextBettorFromGs(gs, currentId) {
  const playerIds = gs.playerOrder || [];
  const folded = gs.folded || {};
  const activePlayers = playerIds.filter(pid => !folded[pid]);
  if (activePlayers.length <= 1) return null;

  const curIdx = activePlayers.indexOf(currentId);
  const nextIdx = (curIdx + 1) % activePlayers.length;
  const nextPid = activePlayers[nextIdx];

  const curBet = gs.currentBet ?? 0;
  const allCalled = activePlayers.every(pid => (gs.currentBets?.[pid] ?? 0) >= curBet);

  if (allCalled && nextIdx === 0) return null;
  if (allCalled && nextPid === activePlayers[0]) return null;

  return nextPid;
}

// ─── 다음 라운드 버튼 ────────────────────────────────

async function handleNextRound() {
  if (!isHost) return;
  document.getElementById('showdown-overlay')?.classList.remove('show');
  await startNewRound();
}

// ─── 나가기 ─────────────────────────────────────────

async function handleLeave() {
  cleanupListeners();
  try {
    const snap = await get(ref(database, `rooms/${myRoomCode}`));
    if (snap.exists()) {
      const room = snap.val();
      if (room.host === myPlayerId) {
        await remove(ref(database, `rooms/${myRoomCode}`));
      } else {
        await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
      }
    }
  } catch (e) {}
  sessionStorage.removeItem('uno_room_code');
  window.location.href = 'index.html';
}

// ─── 유틸리티 ────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let floatTimer = null;
function showFloatMsg(text, duration = 1800) {
  let el = document.getElementById('float-msg');
  if (!el) { el = document.createElement('div'); el.id = 'float-msg'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(() => el.classList.remove('show'), duration);
}
