// 홀덤 라운드 초기화 (로비·게임 화면 공용)

import { database, ref, update } from './firebase-config.js';
import { createDeck, shuffleDeck } from './holdem-rules.js';

/** 단계별 기본 배팅 (스냅 배율이 곱해짐) */
export const PHASE_BASE_ANTES = { preflop: 1, flop: 2, turn: 4, river: 8 };
const HOLDEM_PHASES = new Set(['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown']);

export function getPhaseBaseAnte(phase) {
  return PHASE_BASE_ANTES[phase] ?? 1;
}

/** 이번 단계 1회 배팅액 = 기본 × 판 배율 */
export function calcPhaseBet(phase, snapMultiplier = 1) {
  return getPhaseBaseAnte(phase) * snapMultiplier;
}

export function getStartingChips(n) {
  if (n <= 4) return 250;
  if (n <= 7) return 500;
  return 750;
}

export function getMaxSnaps(n) {
  return n <= 4 ? 2 : 3;
}

/** UNO 등 다른 게임의 gameState와 구분 */
export function isHoldemGameState(gs) {
  if (!gs || typeof gs !== 'object') return false;
  if (!gs.phase || !HOLDEM_PHASES.has(gs.phase)) return false;
  return Array.isArray(gs.playerOrder) && gs.chipCounts && typeof gs.chipCounts === 'object';
}

/** 호스트가 새 라운드를 자동 시작해야 하는지 (종료 후 재시작은 '다음 라운드' 버튼) */
export function shouldStartHoldemRound(gs) {
  if (!gs) return true;
  if (!isHoldemGameState(gs)) return true;
  if (gs.phase === 'waiting') return true;
  return false;
}

/**
 * 새 홀덤 라운드 시작. 성공 시 true, 인원 부족 등으로 스킵 시 false.
 */
export async function startHoldemRound(roomCode, room) {
  const players = room.players || {};
  const playerIds = Object.keys(players);
  if (playerIds.length < 2) return false;

  const prevGs = room.gameState || {};
  const n = playerIds.length;
  const startChips = getStartingChips(n);
  const maxSnaps = getMaxSnaps(n);

  const prevChips = prevGs.chipCounts || {};
  const chipCounts = {};
  for (const pid of playerIds) {
    chipCounts[pid] = (prevChips[pid] > 0) ? prevChips[pid] : startChips;
  }

  const prevDealer = prevGs.dealerIndex ?? -1;
  const dealerIndex = (prevDealer + 1) % playerIds.length;

  const deck = shuffleDeck(createDeck());
  const handUpdates = {};
  const usedCardIds = [];
  for (const pid of playerIds) {
    const cards = [deck.shift(), deck.shift()];
    handUpdates[`rooms/${roomCode}/hands/${pid}`] = cards;
    usedCardIds.push(...cards.map(c => c.id));
  }

  const phaseAnte = calcPhaseBet('preflop', 1);

  const firstActorIdx = (dealerIndex + 1) % playerIds.length;
  const actorOrder = [];
  for (let i = 0; i < playerIds.length; i++) {
    actorOrder.push(playerIds[(firstActorIdx + i) % playerIds.length]);
  }

  const newGs = {
    phase: 'preflop',
    playerOrder: playerIds,
    actorOrder,
    currentActor: actorOrder[0],
    phaseActed: {},
    chipCounts,
    folded: {},
    pot: 0,
    communityCards: [],
    dealerIndex,
    phaseAnte,
    phasePaid: {},
    usedCardIds,
    snapCount: 0,
    maxSnaps,
    playerSnapped: {},
    snapMultiplier: 1,
    snapPending: false,
    snapCallCost: 0,
    snapTriggerPid: null,
    snapResponses: {},
    phaseComplete: false,
    finished: false,
    winner: null,
    winnerHand: null,
    showdownData: null,
    lastAction: { type: 'deal', playerName: '딜러', amount: 0, timestamp: Date.now() }
  };

  await update(ref(database), {
    [`rooms/${roomCode}/gameState`]: newGs,
    ...handUpdates
  });

  return true;
}
