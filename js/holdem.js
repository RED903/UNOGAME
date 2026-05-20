// ═══════════════════════════════════════════════════
// 스냅 홀덤 포커 v2 - 자동배팅 + 스냅 시스템
// 살기/죽기/스냅 방식, 글로벌 스냅 캡 적용
// ═══════════════════════════════════════════════════

import {
  database, ref, get, onValue, update, remove, serverTimestamp
} from './firebase-config.js';
import { createDeck, shuffleDeck, determineWinners } from './holdem-rules.js';
import { renderPokerCardSVG, renderCardBack } from './holdem-renderer.js';
import { shouldStartHoldemRound, startHoldemRound, calcPhaseBet, getPhaseBaseAnte } from './holdem-init.js';

// ─── 상수 ──────────────────────────────────────────

const PHASE_ORDER  = ['preflop', 'flop', 'turn', 'river'];
const PHASE_NAMES  = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운' };

/** 이번 단계에서 해당 플레이어가 아직 내야 할 칩 */
function getBetOwed(gs, pid) {
  const target = gs.phaseAnte ?? calcPhaseBet(gs.phase, gs.snapMultiplier ?? 1);
  const paid = gs.phasePaid?.[pid] ?? 0;
  return Math.max(0, target - paid);
}

function payBet(chips, pid, amount) {
  const balance = chips[pid] ?? 0;
  if (balance < amount) return false;
  chips[pid] = balance - amount;
  return true;
}

// ─── 상태 변수 ─────────────────────────────────────

let myPlayerId    = null;
let myRoomCode    = null;
let isHost        = false;
let gs            = null;   // 현재 게임 상태
let myHoleCards   = [];
let roomPlayersCache = {};
const unsubList   = [];
let hostTimer     = null;
let startRetryTimer = null;
let prevCommLen   = 0;      // 이전에 표시된 커뮤니티 카드 수
let lastLogTs     = 0;

// ─── 사운드 (Web Audio API) ─────────────────────────

const _AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new _AudioCtx();
  return audioCtx;
}

function _tone(freq, dur, type = 'sine', vol = 0.25) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}

const SFX = {
  deal:      () => { _tone(440, 0.07, 'triangle', 0.12); setTimeout(() => _tone(580, 0.07, 'triangle', 0.09), 70); },
  stay:      () => { _tone(523, 0.1, 'sine', 0.18); },
  fold:      () => { _tone(220, 0.18, 'triangle', 0.14); },
  snap:      () => { _tone(880, 0.06, 'square', 0.22); setTimeout(() => _tone(1100, 0.06, 'square', 0.18), 55); setTimeout(() => _tone(1320, 0.1, 'square', 0.14), 110); },
  snapCall:  () => { _tone(660, 0.1, 'sine', 0.2); _tone(880, 0.1, 'sine', 0.15); },
  chip:      () => { _tone(900, 0.04, 'triangle', 0.08); },
  win:       () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => _tone(f, 0.22, 'sine', 0.18), i * 110)); },
  nextPhase: () => { _tone(350, 0.05, 'triangle', 0.1); setTimeout(() => _tone(500, 0.08, 'triangle', 0.1), 80); }
};

// ─── 초기화 ─────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  // AudioContext는 사용자 제스처 후에만 생성 가능
  document.addEventListener('click', () => {
    try { getAudioCtx().resume(); } catch (e) {}
  }, { once: true });

  const params = new URLSearchParams(window.location.search);
  myRoomCode = params.get('room');
  myPlayerId = params.get('player') || sessionStorage.getItem('uno_player_id');

  if (!myRoomCode || !myPlayerId) { window.location.href = 'index.html'; return; }

  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) { window.location.href = 'index.html'; return; }
  const room = roomSnap.val();
  isHost = room.host === myPlayerId;
  roomPlayersCache = room.players || {};

  setupListeners();
  setupButtons();

  if (isHost) {
    const existingGs = (await get(ref(database, `rooms/${myRoomCode}/gameState`))).val();
    if (shouldStartHoldemRound(existingGs)) {
      scheduleStartNewRound(400);
    }
  }
});

// ─── Firebase 리스닝 ─────────────────────────────────

function setupListeners() {
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const u0 = onValue(roomRef, snap => {
    if (!snap.exists()) return;
    roomPlayersCache = snap.val().players || {};
    if (gs) renderOpponents();
  });
  unsubList.push(u0);

  // 게임 상태 리스닝
  const gsRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const u1 = onValue(gsRef, snap => {
    if (!snap.exists()) {
      gs = null;
      if (isHost) scheduleStartNewRound(600);
      return;
    }
    gs = snap.val();

    const newLen = (gs.communityCards || []).length;
    const commAdded = newLen > prevCommLen;
    renderAll(commAdded ? prevCommLen : -1);
    if (commAdded) { SFX.deal(); SFX.nextPhase(); }
    prevCommLen = newLen;

    appendLogIfNew(gs.lastAction);

    if (isHost && shouldStartHoldemRound(gs)) {
      scheduleStartNewRound(600);
      return;
    }

    if (isHost && gs && !gs.finished) {
      scheduleHostActions();
    }
  });
  unsubList.push(u1);

  // 내 홀 카드 리스닝
  const handRef = ref(database, `rooms/${myRoomCode}/hands/${myPlayerId}`);
  const u2 = onValue(handRef, snap => {
    if (!snap.exists()) { myHoleCards = []; renderMyHand(); return; }
    const val = snap.val();
    myHoleCards = Array.isArray(val) ? val : Object.values(val);
    renderMyHand();
    if (myHoleCards.length === 2) SFX.deal();
  });
  unsubList.push(u2);
}

// ─── 버튼 이벤트 ────────────────────────────────────

function setupButtons() {
  document.getElementById('btn-stay')?.addEventListener('click', handleStayClick);
  document.getElementById('btn-fold')?.addEventListener('click', handleFoldClick);
  document.getElementById('btn-snap')?.addEventListener('click', () => playerAction('snap'));
  document.getElementById('btn-next-round')?.addEventListener('click', handleNextRound);
  document.getElementById('btn-leave')?.addEventListener('click', handleLeave);
}

function handleStayClick() {
  if (!gs || gs.finished) return;
  const isFolded  = gs.folded?.[myPlayerId];
  const snapPend  = gs.snapPending;
  const iNeedResp = snapPend && gs.snapTriggerPid !== myPlayerId && !isFolded && !gs.snapResponses?.[myPlayerId];

  if (iNeedResp) {
    snapResponse('call');
  } else {
    playerAction('stay');
  }
}

function handleFoldClick() {
  if (!gs || gs.finished) return;
  const isFolded  = gs.folded?.[myPlayerId];
  const snapPend  = gs.snapPending;
  const iNeedResp = snapPend && gs.snapTriggerPid !== myPlayerId && !isFolded && !gs.snapResponses?.[myPlayerId];

  if (iNeedResp) {
    snapResponse('fold');
  } else {
    playerAction('fold');
  }
}

// ─── 새 라운드 시작 (호스트만) ──────────────────────

function scheduleStartNewRound(delayMs = 600) {
  if (!isHost) return;
  clearTimeout(startRetryTimer);
  startRetryTimer = setTimeout(() => startNewRound(), delayMs);
}

async function startNewRound(force = false) {
  if (!isHost) return;

  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (!roomSnap.exists()) return;
  const room = roomSnap.val();
  roomPlayersCache = room.players || {};

  const existingGs = room.gameState || null;
  if (!force && !shouldStartHoldemRound(existingGs)) return;

  const started = await startHoldemRound(myRoomCode, room);
  if (!started) {
    scheduleStartNewRound(1500);
    return;
  }

  prevCommLen = 0;
  lastLogTs = 0;
}

// ─── 플레이어 액션 (살기/죽기/스냅) ────────────────

async function playerAction(action) {
  if (!gs || gs.finished) return;
  if (gs.currentActor !== myPlayerId) { showFloatMsg('⚠️ 내 차례가 아닙니다!'); return; }
  if (gs.snapPending) { showFloatMsg('⚡ 스냅에 응답하세요!'); return; }
  if (gs.phaseActed?.[myPlayerId]) return;

  const myName = roomPlayersCache[myPlayerId]?.name || '나';

  if (action === 'snap') {
    if ((gs.snapCount ?? 0) >= (gs.maxSnaps ?? 3)) { showFloatMsg('🛑 이번 판 스냅이 마감됐습니다!'); return; }
    if (gs.playerSnapped?.[myPlayerId]) { showFloatMsg('⚠️ 이번 판 스냅은 1회만 가능합니다!'); return; }
  }

  const updates = {};
  const logAction = { type: action, playerName: myName, amount: 0, timestamp: Date.now() };

  if (action === 'fold') {
    SFX.fold();
    updates[`rooms/${myRoomCode}/gameState/folded/${myPlayerId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'fold';
    logAction.type = 'fold';

  } else if (action === 'stay') {
    const betCost = getBetOwed(gs, myPlayerId);
    if (betCost > 0) {
      const chips = { ...(gs.chipCounts || {}) };
      if (!payBet(chips, myPlayerId, betCost)) {
        showFloatMsg('칩이 부족합니다!');
        return;
      }
      const paid = (gs.phasePaid?.[myPlayerId] ?? 0) + betCost;
      updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
      updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + betCost;
      updates[`rooms/${myRoomCode}/gameState/phasePaid/${myPlayerId}`] = paid;
      logAction.amount = betCost;
    }
    SFX.stay();
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'stay';
    logAction.type = 'stay';

  } else if (action === 'snap') {
    const betCost = getBetOwed(gs, myPlayerId);
    if (betCost <= 0) {
      showFloatMsg('배팅할 금액이 없습니다.');
      return;
    }
    const chips = { ...(gs.chipCounts || {}) };
    if (!payBet(chips, myPlayerId, betCost)) {
      showFloatMsg('칩이 부족합니다!');
      return;
    }
    SFX.snap();
    const newMult = (gs.snapMultiplier ?? 1) * 2;
    const newCount = (gs.snapCount ?? 0) + 1;
    const newPhaseAnte = calcPhaseBet(gs.phase, newMult);
    const paid = (gs.phasePaid?.[myPlayerId] ?? 0) + betCost;

    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + betCost;
    updates[`rooms/${myRoomCode}/gameState/phasePaid/${myPlayerId}`] = paid;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${myPlayerId}`] = 'snap';
    updates[`rooms/${myRoomCode}/gameState/snapCount`] = newCount;
    updates[`rooms/${myRoomCode}/gameState/snapMultiplier`] = newMult;
    updates[`rooms/${myRoomCode}/gameState/phaseAnte`] = newPhaseAnte;
    updates[`rooms/${myRoomCode}/gameState/playerSnapped/${myPlayerId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/snapPending`] = true;
    updates[`rooms/${myRoomCode}/gameState/snapTriggerPid`] = myPlayerId;
    updates[`rooms/${myRoomCode}/gameState/snapResponses`] = {};
    logAction.type = 'snap';
    logAction.amount = betCost;

    updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;
    await update(ref(database), updates);
    return;
  }

  // 다음 액터 계산
  const next = computeNextActor(gs, myPlayerId, action === 'fold' ? { [myPlayerId]: true } : {});
  if (next) {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = next;
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = null;
    updates[`rooms/${myRoomCode}/gameState/phaseComplete`] = true;
  }
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  await update(ref(database), updates);

  if (!next && isHost) setTimeout(() => triggerPhaseComplete(), 400);
}

// ─── 스냅 응답 (스냅콜/런) ──────────────────────────

async function snapResponse(response) {
  if (!gs || !gs.snapPending || gs.finished) return;
  if (gs.snapTriggerPid === myPlayerId) return; // 발동자는 응답 불필요
  if (gs.folded?.[myPlayerId]) return;
  if (gs.snapResponses?.[myPlayerId]) return;

  const owed = getBetOwed(gs, myPlayerId);
  const myChips = gs.chipCounts?.[myPlayerId] ?? 0;
  const myName = roomPlayersCache[myPlayerId]?.name || '나';

  const actual = (response === 'call' && (owed <= 0 || myChips < owed)) ? 'fold' : response;

  const updates = {};
  updates[`rooms/${myRoomCode}/gameState/snapResponses/${myPlayerId}`] = actual;

  if (actual === 'call') {
    SFX.snapCall();
    const chips = { ...(gs.chipCounts || {}) };
    payBet(chips, myPlayerId, owed);
    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = (gs.pot ?? 0) + owed;
    updates[`rooms/${myRoomCode}/gameState/phasePaid/${myPlayerId}`] =
      (gs.phasePaid?.[myPlayerId] ?? 0) + owed;
  } else {
    SFX.fold();
    updates[`rooms/${myRoomCode}/gameState/folded/${myPlayerId}`] = true;
  }

  updates[`rooms/${myRoomCode}/gameState/lastAction`] = {
    type: actual === 'call' ? 'snapCall' : 'fold',
    playerName: myName,
    amount: actual === 'call' ? owed : 0,
    timestamp: Date.now()
  };

  await update(ref(database), updates);
}

// ─── 호스트 자동 처리 엔진 ───────────────────────────

function scheduleHostActions() {
  clearTimeout(hostTimer);
  hostTimer = setTimeout(async () => {
    if (!gs || !isHost || gs.finished) return;
    const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
    if (!snap.exists()) return;
    const cur = snap.val();

    if (cur.finished) return;

    // 활성 플레이어 수 확인
    const active = (cur.playerOrder || []).filter(p => !cur.folded?.[p]);

    // 스냅 대기 중
    if (cur.snapPending) {
      await processBotSnapResponses(cur);
      await tryResolveSnap(cur);
      return;
    }

    // 페이즈 완료 확인
    if (cur.phaseComplete || !cur.currentActor) {
      await triggerPhaseComplete(cur);
      return;
    }

    // 봇 차례
    if (cur.currentActor?.startsWith('bot_') && !cur.phaseActed?.[cur.currentActor] && !cur.folded?.[cur.currentActor]) {
      await executeBotAction(cur, cur.currentActor);
      return;
    }

    // 1명 이하 생존 감지
    if (active.length <= 1 && !cur.finished) {
      await endHandEarly(active, cur);
    }
  }, 600);
}

// 다음 액터 계산
function computeNextActor(state, currentPid, extraFolded = {}) {
  const order  = state.actorOrder || state.playerOrder || [];
  const folded = { ...(state.folded || {}), ...extraFolded };
  const acted  = state.phaseActed || {};
  const curIdx = order.indexOf(currentPid);

  for (let i = curIdx + 1; i < order.length; i++) {
    const pid = order[i];
    if (!folded[pid] && !acted[pid]) return pid;
  }
  return null; // 모두 행동 완료
}

// ─── 봇 액션 ─────────────────────────────────────────

async function executeBotAction(curGs, botId) {
  // 딜레이 후 최신 상태 재확인
  await new Promise(r => setTimeout(r, 700 + Math.random() * 1100));
  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs2 = snap.val();
  if (gs2.currentActor !== botId || gs2.phaseActed?.[botId] || gs2.folded?.[botId] || gs2.snapPending || gs2.finished) return;

  const botName  = roomPlayersCache[botId]?.name || '봇';
  const botChips = gs2.chipCounts?.[botId] ?? 0;
  const rand     = Math.random();

  // 봇 스냅 가능 여부
  const canSnap = (gs2.snapCount ?? 0) < (gs2.maxSnaps ?? 3)
    && !gs2.playerSnapped?.[botId]
    && botChips > 15
    && rand < 0.12;

  let action = 'stay';
  if (canSnap) action = 'snap';
  else if (rand < 0.18) action = 'fold';

  const updates = {};
  const logAction = { type: action, playerName: botName, amount: 0, timestamp: Date.now() };

  const chips = { ...(gs2.chipCounts || {}) };
  let pot = gs2.pot ?? 0;

  if (action === 'fold') {
    updates[`rooms/${myRoomCode}/gameState/folded/${botId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'fold';
  } else if (action === 'stay') {
    const betCost = getBetOwed(gs2, botId);
    if (betCost > 0 && !payBet(chips, botId, betCost)) {
      updates[`rooms/${myRoomCode}/gameState/folded/${botId}`] = true;
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'fold';
      logAction.type = 'fold';
    } else {
      if (betCost > 0) {
        pot += betCost;
        updates[`rooms/${myRoomCode}/gameState/phasePaid/${botId}`] =
          (gs2.phasePaid?.[botId] ?? 0) + betCost;
        logAction.amount = betCost;
      }
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'stay';
    }
    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = pot;
  } else if (action === 'snap') {
    const betCost = getBetOwed(gs2, botId);
    if (betCost > 0 && !payBet(chips, botId, betCost)) {
      updates[`rooms/${myRoomCode}/gameState/folded/${botId}`] = true;
      updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'fold';
      updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
      updates[`rooms/${myRoomCode}/gameState/lastAction`] = { type: 'fold', playerName: botName, amount: 0, timestamp: Date.now() };
      await update(ref(database), updates);
      return;
    }
    const newMult = (gs2.snapMultiplier ?? 1) * 2;
    const newCount = (gs2.snapCount ?? 0) + 1;
    const newPhaseAnte = calcPhaseBet(gs2.phase, newMult);
    if (betCost > 0) {
      pot += betCost;
      updates[`rooms/${myRoomCode}/gameState/phasePaid/${botId}`] =
        (gs2.phasePaid?.[botId] ?? 0) + betCost;
    }
    updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
    updates[`rooms/${myRoomCode}/gameState/pot`] = pot;
    updates[`rooms/${myRoomCode}/gameState/phaseActed/${botId}`] = 'snap';
    updates[`rooms/${myRoomCode}/gameState/snapCount`] = newCount;
    updates[`rooms/${myRoomCode}/gameState/snapMultiplier`] = newMult;
    updates[`rooms/${myRoomCode}/gameState/phaseAnte`] = newPhaseAnte;
    updates[`rooms/${myRoomCode}/gameState/playerSnapped/${botId}`] = true;
    updates[`rooms/${myRoomCode}/gameState/snapPending`] = true;
    updates[`rooms/${myRoomCode}/gameState/snapTriggerPid`] = botId;
    updates[`rooms/${myRoomCode}/gameState/snapResponses`] = {};
    logAction.type = 'snap';
    logAction.amount = betCost;
    updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;
    await update(ref(database), updates);
    return;
  }

  const next = computeNextActor(gs2, botId, action === 'fold' ? { [botId]: true } : {});
  if (next) {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = next;
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = null;
    updates[`rooms/${myRoomCode}/gameState/phaseComplete`] = true;
  }
  updates[`rooms/${myRoomCode}/gameState/lastAction`] = logAction;

  await update(ref(database), updates);
  if (!next) setTimeout(() => triggerPhaseComplete(), 400);
}

// ─── 봇 스냅 응답 처리 ────────────────────────────────

async function processBotSnapResponses(curGs) {
  const playerOrder = curGs.playerOrder || [];
  const folded      = curGs.folded || {};
  const trigger     = curGs.snapTriggerPid;
  const responses   = curGs.snapResponses || {};
  const botsNeeding = playerOrder.filter(pid =>
    pid.startsWith('bot_') && pid !== trigger && !folded[pid] && !responses[pid]
      && getBetOwed(curGs, pid) > 0
  );
  if (botsNeeding.length === 0) return;

  await new Promise(r => setTimeout(r, 500 + Math.random() * 700));

  // 재확인
  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs2 = snap.val();
  if (!gs2.snapPending) return;

  const updates = {};
  let pot = gs2.pot ?? 0;
  const chips = { ...(gs2.chipCounts || {}) };
  const newFolded = { ...(gs2.folded || {}) };

  for (const botId of botsNeeding) {
    if (gs2.snapResponses?.[botId]) continue; // 이미 응답
    const owed = getBetOwed(gs2, botId);
    const botChips = chips[botId] ?? 0;
    const canCall = botChips >= owed;
    const r = Math.random();
    const resp = (!canCall || owed <= 0 || r < 0.3) ? 'fold' : 'call';

    updates[`rooms/${myRoomCode}/gameState/snapResponses/${botId}`] = resp;
    if (resp === 'call' && owed > 0) {
      payBet(chips, botId, owed);
      pot += owed;
      updates[`rooms/${myRoomCode}/gameState/phasePaid/${botId}`] =
        (gs2.phasePaid?.[botId] ?? 0) + owed;
    } else if (resp === 'fold') {
      newFolded[botId] = true;
    }
  }

  updates[`rooms/${myRoomCode}/gameState/pot`]      = pot;
  updates[`rooms/${myRoomCode}/gameState/chipCounts`] = chips;
  updates[`rooms/${myRoomCode}/gameState/folded`]   = newFolded;

  await update(ref(database), updates);
}

// ─── 스냅 해결 (호스트만) ───────────────────────────

async function tryResolveSnap(curGs) {
  const playerOrder = curGs.playerOrder || [];
  const folded      = curGs.folded || {};
  const trigger     = curGs.snapTriggerPid;
  const responses   = curGs.snapResponses || {};

  // 배팅 차액이 남은 플레이어만 응답 (발동자·폴드 제외)
  const needResp = playerOrder.filter(pid =>
    pid !== trigger && !folded[pid] && getBetOwed(curGs, pid) > 0
  );
  const allDone = needResp.every(pid => responses[pid]);
  if (!allDone) return;

  // 스냅 해결 완료 → 다음 액터 찾기
  // folded에 새로 런한 사람들 반영
  const newFolded = { ...folded };
  for (const pid of needResp) {
    if (responses[pid] === 'fold') newFolded[pid] = true;
  }

  const active = playerOrder.filter(p => !newFolded[p]);
  if (active.length <= 1) {
    await endHandEarly(active, { ...curGs, folded: newFolded });
    return;
  }

  // actorOrder에서 트리거 이후 미행동 플레이어
  const actorOrder = curGs.actorOrder || playerOrder;
  const trigIdx = actorOrder.indexOf(trigger);
  let nextActor = null;
  for (let i = trigIdx + 1; i < actorOrder.length; i++) {
    const pid = actorOrder[i];
    if (!newFolded[pid] && !curGs.phaseActed?.[pid]) { nextActor = pid; break; }
  }

  const updates = {};
  updates[`rooms/${myRoomCode}/gameState/snapPending`] = false;
  updates[`rooms/${myRoomCode}/gameState/folded`]      = newFolded;

  if (nextActor) {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = nextActor;
  } else {
    updates[`rooms/${myRoomCode}/gameState/currentActor`] = null;
    updates[`rooms/${myRoomCode}/gameState/phaseComplete`] = true;
  }

  await update(ref(database), updates);
  if (!nextActor) setTimeout(() => triggerPhaseComplete(), 400);
}

// ─── 페이즈 완료 처리 ────────────────────────────────

async function triggerPhaseComplete(curGs) {
  if (!isHost) return;

  const snap = await get(ref(database, `rooms/${myRoomCode}/gameState`));
  if (!snap.exists()) return;
  const gs2 = curGs || snap.val();

  if (gs2.finished) return;

  const playerOrder = gs2.playerOrder || [];
  const folded      = gs2.folded || {};
  const active      = playerOrder.filter(p => !folded[p]);

  // 1명 이하 → 조기 종료
  if (active.length <= 1) { await endHandEarly(active, gs2); return; }

  // 다음 페이즈 결정
  const curIdx   = PHASE_ORDER.indexOf(gs2.phase);
  const isLast   = curIdx >= PHASE_ORDER.length - 1;

  if (isLast) {
    await runShowdown(gs2, active);
  } else {
    await advancePhase(gs2, active, PHASE_ORDER[curIdx + 1]);
  }
}

// ─── 다음 페이즈로 진행 ──────────────────────────────

async function advancePhase(curGs, active, nextPhase) {
  if (!isHost) return;

  // 커뮤니티 카드 딜 (사용된 카드 제외)
  const usedSet  = new Set(curGs.usedCardIds || []);
  const freshDeck = shuffleDeck(createDeck()).filter(c => !usedSet.has(c.id));
  const existing = curGs.communityCards || [];
  let newComm    = [...existing];
  const newUsed  = [...(curGs.usedCardIds || [])];

  if (nextPhase === 'flop') {
    const cards = [freshDeck.shift(), freshDeck.shift(), freshDeck.shift()];
    newComm = [...existing, ...cards];
    newUsed.push(...cards.map(c => c.id));
  } else {
    const card = freshDeck.shift();
    newComm = [...existing, card];
    newUsed.push(card.id);
  }

  const snapMult = curGs.snapMultiplier ?? 1;
  const phaseAnte = calcPhaseBet(nextPhase, snapMult);

  // 액터 순서 (딜러 다음 살아있는 사람부터)
  const playerOrder = curGs.playerOrder || [];
  const dealerIdx = curGs.dealerIndex ?? 0;
  const actorOrder = [];
  const newFolded = { ...(curGs.folded || {}) };
  for (let i = 1; i <= playerOrder.length; i++) {
    const pid = playerOrder[(dealerIdx + i) % playerOrder.length];
    if (!newFolded[pid]) actorOrder.push(pid);
  }

  const stillActive = active.filter(p => !newFolded[p]);
  if (stillActive.length <= 1) {
    await endHandEarly(stillActive, { ...curGs, folded: newFolded, communityCards: newComm });
    return;
  }

  SFX.chip();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: nextPhase,
    communityCards: newComm,
    usedCardIds: newUsed,
    folded: newFolded,
    phaseAnte,
    phasePaid: {},
    actorOrder,
    currentActor: actorOrder[0] || null,
    phaseActed: {},
    phaseComplete: false,
    snapPending: false,
    snapResponses: {},
    lastAction: {
      type: 'deal',
      playerName: '딜러',
      amount: 0,
      detail: `${PHASE_NAMES[nextPhase]} · 배팅 ${phaseAnte}칩 (×${snapMult})`,
      timestamp: Date.now()
    }
  });
}

// ─── 조기 종료 (1명 남음) ───────────────────────────

async function endHandEarly(survivors, curGs) {
  if (!isHost) return;
  const winner = survivors[0] || null;
  if (!winner) return;

  const pot = curGs.pot ?? 0;
  const chips = { ...(curGs.chipCounts || {}) };
  chips[winner] = (chips[winner] ?? 0) + pot;

  SFX.win();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'showdown',
    finished: true,
    winner,
    winnerHand: '독점 승리 (상대 전원 기권)',
    chipCounts: chips,
    pot: 0,
    showdownData: null,
    lastAction: {
      type: 'win',
      playerName: roomPlayersCache[winner]?.name || '플레이어',
      amount: pot,
      timestamp: Date.now()
    }
  });
}

// ─── 쇼다운 ─────────────────────────────────────────

async function runShowdown(curGs, active) {
  if (!isHost) return;

  const handsSnap = await get(ref(database, `rooms/${myRoomCode}/hands`));
  if (!handsSnap.exists()) return;
  const handsData = handsSnap.val();

  const playerHands = {};
  for (const pid of active) {
    const h = handsData[pid];
    if (h) playerHands[pid] = Array.isArray(h) ? h : Object.values(h);
  }

  const community = (curGs.communityCards || []).slice(0, 5);
  const { winners, handResults } = determineWinners(playerHands, community);

  const pot   = curGs.pot ?? 0;
  const share = Math.floor(pot / (winners.length || 1));
  const chips = { ...(curGs.chipCounts || {}) };
  for (const pid of winners) chips[pid] = (chips[pid] ?? 0) + share;

  const showdownData = {};
  for (const pid of active) {
    showdownData[pid] = {
      cards: playerHands[pid] || [],
      handRank: handResults[pid]?.name || '-'
    };
  }

  SFX.win();

  await update(ref(database, `rooms/${myRoomCode}/gameState`), {
    phase: 'showdown',
    finished: true,
    winner: winners.length === 1 ? winners[0] : winners,
    winnerHand: handResults[winners[0]]?.name || '승리',
    chipCounts: chips,
    pot: 0,
    showdownData,
    lastAction: {
      type: 'win',
      playerName: winners.map(p => roomPlayersCache[p]?.name || p).join(', '),
      amount: pot,
      timestamp: Date.now()
    }
  });
}

// ─── 다음 라운드 ─────────────────────────────────────

async function handleNextRound() {
  if (!isHost) return;
  document.getElementById('showdown-overlay')?.classList.remove('show');
  prevCommLen = 0;
  await startNewRound(true);
}

// ─── 나가기 ──────────────────────────────────────────

async function handleLeave() {
  unsubList.forEach(u => { try { u(); } catch (e) {} });
  unsubList.length = 0;
  clearTimeout(hostTimer);
  clearTimeout(startRetryTimer);
  try {
    const snap = await get(ref(database, `rooms/${myRoomCode}`));
    if (snap.exists()) {
      const room = snap.val();
      if (room.host === myPlayerId) await remove(ref(database, `rooms/${myRoomCode}`));
      else await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
    }
  } catch (e) {}
  sessionStorage.removeItem('uno_room_code');
  window.location.href = 'index.html';
}

// ═══════════════════════════════════════════════════
// ─── 렌더 함수들 ────────────────────────────────────
// ═══════════════════════════════════════════════════

function renderAll(newCardStartIdx = -1) {
  if (!gs) return;
  renderOpponents();
  renderCommunityCards(newCardStartIdx);
  renderMyHand();
  renderMyHandRank();
  renderPot();
  renderPhaseInfo();
  renderSnapInfo();
  renderActionButtons();
  renderChipList();
  if (gs.finished) showShowdown();
}

// ─── 상대 플레이어 ───────────────────────────────────

function renderOpponents() {
  const area = document.getElementById('opponents-area');
  if (!area || !gs) return;

  const opponents = (gs.playerOrder || []).filter(pid => pid !== myPlayerId);
  const winners   = gs.winner ? (Array.isArray(gs.winner) ? gs.winner : [gs.winner]) : [];

  area.innerHTML = opponents.map(pid => {
    const p        = roomPlayersCache[pid] || {};
    const name     = p.name || pid;
    const avatar   = p.avatar || '🤖';
    const chips    = gs.chipCounts?.[pid] ?? 0;
    const isFolded = gs.folded?.[pid];
    const isActive = gs.currentActor === pid && !gs.finished;
    const isDealer = (gs.playerOrder?.indexOf(pid) === gs.dealerIndex);
    const isWinner = winners.includes(pid);
    const sdData   = gs.showdownData?.[pid];

    // 스냅 응답 대기 표시
    const needsResponse = gs.snapPending && gs.snapTriggerPid !== pid && !isFolded && !gs.snapResponses?.[pid];
    const responded     = gs.snapPending && gs.snapResponses?.[pid];

    let cardHtml = '';
    if (sdData) {
      // 쇼다운: 카드 공개
      cardHtml = `<div class="opponent-cards">${(sdData.cards || []).map(c =>
        `<div style="border-radius:5px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.8);">${renderPokerCardSVG(c, { width: 48, height: 69, highlight: isWinner })}</div>`
      ).join('')}</div>`;
    } else {
      const num = isFolded ? 0 : 2;
      cardHtml = `<div class="opponent-cards">${Array(num).fill(0).map(() =>
        `<div style="border-radius:5px;overflow:hidden;">${renderCardBack({ width: 48, height: 69 })}</div>`
      ).join('')}</div>`;
    }

    return `<div class="player-panel ${isActive ? 'active-turn' : ''} ${isFolded ? 'folded' : ''} ${isWinner ? 'winner' : ''} ${needsResponse ? 'needs-response' : ''}">
      ${isDealer ? '<div class="dealer-chip">D</div>' : ''}
      <div class="p-avatar">${avatar}</div>
      ${cardHtml}
      <div class="p-name">${escapeHtml(name)}</div>
      <div class="p-chips">💰 ${chips}칩</div>
      ${isActive && !gs.snapPending ? '<div class="p-thinking">⏳ 선택 중...</div>' : ''}
      ${needsResponse ? '<div class="p-thinking snap-anim">⚡ 응답 대기...</div>' : ''}
      ${responded ? `<div class="p-thinking">${gs.snapResponses[pid] === 'call' ? '📞 스냅콜' : '🏃 런'}</div>` : ''}
      ${isWinner ? '<div class="p-winner">🏆 승자!</div>' : ''}
      ${sdData ? `<div class="p-hand-rank">${sdData.handRank}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── 커뮤니티 카드 (애니메이션 최적화) ───────────────

function renderCommunityCards(animateFromIdx = -1) {
  const area = document.getElementById('community-cards');
  if (!area || !gs) return;

  const cards = gs.communityCards || [];
  area.innerHTML = '';

  for (let i = 0; i < 5; i++) {
    const card = cards[i];
    const el   = document.createElement('div');

    if (card) {
      el.style.cssText = 'border-radius:8px; overflow:hidden;';
      // 새로 깔린 카드만 애니메이션 적용
      if (animateFromIdx >= 0 && i >= animateFromIdx) {
        el.className = 'community-card';
        el.style.animationDelay = `${(i - animateFromIdx) * 0.12}s`;
      }
      el.innerHTML = renderPokerCardSVG(card, { width: 72, height: 103 });
    } else {
      el.className = 'card-slot';
      el.textContent = '?';
    }
    area.appendChild(el);
  }
}

// ─── 내 홀 카드 ──────────────────────────────────────

function renderMyHand() {
  const area = document.getElementById('my-hand-cards');
  if (!area) return;

  if (!myHoleCards || myHoleCards.length === 0) {
    area.innerHTML = [1, 2].map(() =>
      `<div style="border-radius:10px;overflow:hidden;">${renderCardBack({ width: 90, height: 128 })}</div>`
    ).join('');
    return;
  }

  area.innerHTML = myHoleCards.map(card =>
    `<div class="my-hole-card" style="border-radius:10px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.8);">
      ${renderPokerCardSVG(card, { width: 90, height: 128 })}
    </div>`
  ).join('');
}

// ─── 내 핸드 랭킹 ────────────────────────────────────

function renderMyHandRank() {
  const el = document.getElementById('my-hand-rank');
  if (!el) return;
  const community = gs?.communityCards || [];
  if (!myHoleCards || myHoleCards.length < 2 || community.length < 3) {
    el.textContent = '핸드 대기 중...';
    return;
  }
  try {
    import('./holdem-rules.js').then(({ evaluateBestHand }) => {
      const result = evaluateBestHand(myHoleCards, community);
      if (result) el.textContent = `🃏 ${result.name}`;
    });
  } catch (e) {}
}

// ─── 팟 / 페이즈 ─────────────────────────────────────

function renderPot() {
  const el = document.getElementById('pot-amount');
  if (el && gs) el.textContent = `${gs.pot ?? 0}칩`;
}

function renderPhaseInfo() {
  const el = document.getElementById('phase-badge');
  if (!el || !gs) return;
  el.className = `phase-badge ${gs.phase || ''}`;
  el.textContent = PHASE_NAMES[gs.phase] || gs.phase || '-';

  const anteEl = document.getElementById('phase-ante');
  if (anteEl) {
    const base = getPhaseBaseAnte(gs.phase);
    const mult = gs.snapMultiplier ?? 1;
    const ante = gs.phaseAnte ?? calcPhaseBet(gs.phase, mult);
    anteEl.textContent = `이번 단계: ${ante}칩 (기본 ${base} × ${mult})`;
  }

  const statPhase = document.getElementById('stat-phase');
  if (statPhase) statPhase.textContent = PHASE_NAMES[gs.phase] || '-';
}

// ─── 스냅 정보 ───────────────────────────────────────

function renderSnapInfo() {
  const container = document.getElementById('snap-multiplier');
  if (!container || !gs) return;

  const mult = gs.snapMultiplier ?? 1;
  const nextPhases = PHASE_ORDER.filter(p => PHASE_ORDER.indexOf(p) >= PHASE_ORDER.indexOf(gs.phase));
  const preview = nextPhases.map(p => `${PHASE_NAMES[p]} ${calcPhaseBet(p, mult)}`).join(' → ');

  container.innerHTML = `<span style="font-size:0.78rem;color:#d4af37;font-weight:700;">판 배율 ×${mult}</span>`;

  const remainEl = document.getElementById('snap-remain');
  if (remainEl) {
    const max = gs.maxSnaps ?? 3;
    const count = gs.snapCount ?? 0;
    remainEl.textContent = preview ? `남은 단계: ${preview} · 2배 ${max - count}회` : '';
  }
}

// ─── 액션 버튼 ───────────────────────────────────────

function renderActionButtons() {
  if (!gs) return;

  const isFolded  = gs.folded?.[myPlayerId];
  const isFinished = gs.finished;
  const isMyTurn  = gs.currentActor === myPlayerId && !isFolded && !isFinished;
  const snapPend  = gs.snapPending;
  const iNeedResp = snapPend && gs.snapTriggerPid !== myPlayerId && !isFolded && !gs.snapResponses?.[myPlayerId];
  const canSnap   = (gs.snapCount ?? 0) < (gs.maxSnaps ?? 3) && !gs.playerSnapped?.[myPlayerId];
  const myChips   = gs.chipCounts?.[myPlayerId] ?? 0;

  // 버튼 그룹 표시/숨김
  const normalActions = document.getElementById('normal-actions');
  const nextBtn       = document.getElementById('btn-next-round');
  const infoEl        = document.getElementById('action-info');

  // 일반 액션 버튼은 흔들림 방지를 위해 항시 노출 상태로 유지
  if (normalActions) {
    normalActions.style.display = 'flex';

    const stayBtn = document.getElementById('btn-stay');
    const snapBtn = document.getElementById('btn-snap');
    const foldBtn = document.getElementById('btn-fold');

    // 내 차례가 아니거나, 다른 사람이 스냅을 친 응답 대기 상태라면 모든 일반 액션 버튼 비활성화
    const disabledState = !(isMyTurn && !snapPend);
    const mySnapped = gs.playerSnapped?.[myPlayerId];
    const isSnapDisabled = disabledState || mySnapped || !canSnap || snapPend;

    const owed = getBetOwed(gs, myPlayerId);

    if (stayBtn) {
      const canAfford = myChips >= owed && owed > 0;
      const canAct = iNeedResp ? canAfford : (disabledState ? false : (owed <= 0 || canAfford));
      stayBtn.disabled = !canAct;
      const label = owed > 0
        ? (canAfford ? `배팅 ${owed}칩` : `칩 부족 (${owed}칩)`)
        : '배팅 완료';
      stayBtn.innerHTML = `
        <span class="btn-icon">💰</span>
        <div class="btn-text-wrap">
          <span class="btn-label" id="btn-stay-label">${label}</span>
          <span class="btn-sub" id="btn-stay-sub">${iNeedResp ? '추가 배팅 후 잔류' : '클릭 시 칩 차감'}</span>
        </div>
      `;
    }

    if (foldBtn) {
      foldBtn.disabled = iNeedResp ? false : disabledState;
      foldBtn.innerHTML = `
        <span class="btn-icon">✕</span>
        <div class="btn-text-wrap">
          <span class="btn-label">죽기</span>
          <span class="btn-sub">${iNeedResp ? '추가 배팅 포기' : '기권'}</span>
        </div>
      `;
    }

    if (snapBtn) {
      snapBtn.disabled = isSnapDisabled || owed <= 0 || myChips < owed;
      snapBtn.style.opacity = snapBtn.disabled ? '0.35' : '1';
      const nextMult = (gs.snapMultiplier ?? 1) * 2;
      snapBtn.innerHTML = `
        <span class="btn-icon">⚡</span>
        <div class="btn-text-wrap">
          <span class="btn-label">판돈 2배</span>
          <span class="btn-sub">${owed}칩 · 이후 ×${nextMult}</span>
        </div>
      `;
    }
  }

  if (nextBtn) nextBtn.style.display = (isHost && isFinished) ? 'inline-flex' : 'none';

  // 정보 메시지
  if (infoEl) {
    if (isFinished) {
      infoEl.textContent = '';
    } else if (isFolded) {
      infoEl.textContent = '💀 기권 (폴드)';
    } else if (snapPend && !iNeedResp && gs.snapTriggerPid !== myPlayerId) {
      infoEl.textContent = '⏳ 다른 플레이어가 응답 중...';
    } else if (snapPend && gs.snapTriggerPid === myPlayerId) {
      infoEl.textContent = '⚡ 판돈 2배! 상대 추가 배팅 대기 중...';
    } else if (!isMyTurn) {
      const cur = gs.currentActor;
      const name = cur ? (roomPlayersCache[cur]?.name || '상대') : '';
      infoEl.textContent = cur ? `${name} 선택 중...` : '';
    } else {
      const mult = gs.snapMultiplier ?? 1;
      const ante = gs.phaseAnte ?? calcPhaseBet(gs.phase, mult);
      infoEl.textContent = `이번 단계 목표 배팅 ${ante}칩 · 판 배율 ×${mult}`;
    }
  }

  // 내 칩 표시
  const myChipsEl = document.getElementById('my-chips');
  if (myChipsEl) myChipsEl.textContent = `💰 ${myChips}칩`;
}

// ─── 칩 목록 ─────────────────────────────────────────

function renderChipList() {
  const list = document.getElementById('chip-list');
  if (!list || !gs) return;

  list.innerHTML = (gs.playerOrder || []).map(pid => {
    const p      = roomPlayersCache[pid] || {};
    const isMe   = pid === myPlayerId;
    const act    = gs.currentActor === pid;
    const folded = gs.folded?.[pid];
    const chips  = gs.chipCounts?.[pid] ?? 0;
    return `<div class="chip-row ${isMe ? 'is-me' : ''} ${act ? 'active' : ''} ${folded ? 'folded-row' : ''}">
      <span class="chip-avatar">${p.avatar || '🤖'}</span>
      <span class="chip-name">${escapeHtml(p.name || pid)}${isMe ? ' (나)' : ''}</span>
      <span class="chip-amount">💰 ${chips}</span>
    </div>`;
  }).join('');
}

// ─── 쇼다운 오버레이 ─────────────────────────────────

function showShowdown() {
  const overlay = document.getElementById('showdown-overlay');
  if (!overlay || !gs) return;

  const winners = gs.winner ? (Array.isArray(gs.winner) ? gs.winner : [gs.winner]) : [];
  const winnerNames = winners.map(pid => roomPlayersCache[pid]?.name || pid).join(', ');
  const sdData  = gs.showdownData || {};

  overlay.querySelector('.showdown-title').textContent    = '🏆 게임 종료!';
  overlay.querySelector('.showdown-winner-name').innerHTML =
    `<span>${escapeHtml(winnerNames)}</span> 승리 — <span style="color:rgba(240,240,255,0.7)">${escapeHtml(gs.winnerHand || '')}</span>`;

  const playersEl = overlay.querySelector('.showdown-players');
  if (playersEl) {
    playersEl.innerHTML = (gs.playerOrder || []).map(pid => {
      const p        = roomPlayersCache[pid] || {};
      const isWinner = winners.includes(pid);
      const isFolded = gs.folded?.[pid];
      const sd       = sdData[pid];
      const cards    = sd?.cards || (pid === myPlayerId ? myHoleCards : []);
      const rank     = sd?.handRank || '-';

      if (isFolded && !sd) {
        return `<div class="showdown-player folded-player">
          <span style="font-size:1.3rem">${p.avatar || '🤖'}</span>
          <div class="sd-name">${escapeHtml(p.name || pid)}</div>
          <div class="sd-rank">기권</div>
        </div>`;
      }

      const cardHtml = cards.length > 0
        ? cards.map(c => `<div style="border-radius:6px;overflow:hidden;">${renderPokerCardSVG(c, { width: 58, height: 83, highlight: isWinner })}</div>`).join('')
        : `<div style="border-radius:6px;overflow:hidden;">${renderCardBack({ width: 58, height: 83 })}</div>`;

      return `<div class="showdown-player ${isWinner ? 'winner-card' : ''}">
        <span style="font-size:1.3rem">${p.avatar || '🤖'}</span>
        <div class="sd-name">${escapeHtml(p.name || pid)}${isWinner ? ' 🏆' : ''}</div>
        <div class="sd-hand">${cardHtml}</div>
        <div class="sd-rank">${rank}</div>
      </div>`;
    }).join('');
  }

  overlay.classList.add('show');
}

// ─── 로그 ────────────────────────────────────────────

function appendLogIfNew(action) {
  if (!action || action.timestamp === lastLogTs) return;
  lastLogTs = action.timestamp;

  const log = document.getElementById('action-log');
  if (!log) return;

  const icons = { stay:'💰', fold:'✕', snap:'⚡', snapCall:'💰', win:'🏆', deal:'🃏' };
  const labels = { stay:'배팅', fold:'기권', snap:'판돈 2배', snapCall:'추가 배팅', win:'승리!', deal:'딜' };
  const cls = { stay:'action-check', fold:'action-fold', snap:'action-raise', snapCall:'action-call', win:'action-win', deal:'action-deal' };

  const icon  = icons[action.type]  || '•';
  const label = labels[action.type] || action.type;
  const amt   = action.amount > 0 ? ` ${action.amount}칩` : '';
  const extra = action.detail ? ` — ${action.detail}` : '';

  const entry = document.createElement('div');
  entry.className = `log-entry ${cls[action.type] || ''}`;
  entry.textContent = `${icon} ${escapeHtml(action.playerName || '')} ${label}${amt}${extra}`;
  log.appendChild(entry);
  while (log.children.length > 35) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

// ─── 유틸 ────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let floatTimer = null;
function showFloatMsg(text, duration = 2000) {
  let el = document.getElementById('float-msg');
  if (!el) { el = document.createElement('div'); el.id = 'float-msg'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(() => el.classList.remove('show'), duration);
}
