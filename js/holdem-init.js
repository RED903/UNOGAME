// 홀덤 라운드 초기화 (로비·게임 화면 공용)

import { database, ref, update } from './firebase-config.js';
import { createDeck, shuffleDeck } from './holdem-rules.js';

export function getStartingChips(n) {
  if (n <= 4) return 250;
  if (n <= 7) return 500;
  return 750;
}

function asArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') {
    return Object.keys(val).sort((a, b) => Number(a) - Number(b)).map(k => val[k]);
  }
  return [];
}

const HOLDEM_PHASES = new Set(['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown']);

/** UNO 등 다른 게임의 gameState와 구분 */
export function isHoldemGameState(gs) {
  if (!gs || typeof gs !== 'object') return false;
  if (!gs.phase || !HOLDEM_PHASES.has(gs.phase)) return false;
  return asArray(gs.playerOrder).length > 0 && gs.chipCounts && typeof gs.chipCounts === 'object';
}

/** 호스트가 새 라운드를 자동 시작해야 하는지 */
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

  // 블라인드 포스팅 로직 (스몰 블라인드 2, 빅 블라인드 5)
  const currentBets = {};
  for (const pid of playerIds) {
    currentBets[pid] = 0;
  }

  let pot = 0;
  const sbAmount = 2;
  const bbAmount = 5;

  let sbPlayerId, bbPlayerId;
  if (playerIds.length === 2) {
    // 2인 헤즈업: 딜러가 SB, 다른 사람이 BB
    sbPlayerId = playerIds[dealerIndex];
    bbPlayerId = playerIds[(dealerIndex + 1) % 2];
  } else {
    // 3인 이상: 딜러 다음 사람이 SB, 그 다음 사람이 BB
    sbPlayerId = playerIds[(dealerIndex + 1) % playerIds.length];
    bbPlayerId = playerIds[(dealerIndex + 2) % playerIds.length];
  }

  // SB 포스팅 (남은 칩이 부족하면 올인)
  const sbChips = chipCounts[sbPlayerId] ?? 0;
  const sbPaid = Math.min(sbChips, sbAmount);
  chipCounts[sbPlayerId] = sbChips - sbPaid;
  currentBets[sbPlayerId] = sbPaid;
  pot += sbPaid;

  // BB 포스팅 (남은 칩이 부족하면 올인)
  const bbChips = chipCounts[bbPlayerId] ?? 0;
  const bbPaid = Math.min(bbChips, bbAmount);
  chipCounts[bbPlayerId] = bbChips - bbPaid;
  currentBets[bbPlayerId] = bbPaid;
  pot += bbPaid;

  // 프리플랍 액터 순서 결정 (BB 다음 사람부터 시작)
  let bbIdx = playerIds.indexOf(bbPlayerId);
  const firstActorIdx = (bbIdx + 1) % playerIds.length;
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
    pot,
    communityCards: [],
    dealerIndex,
    currentBet: bbAmount, // 프리플랍 최고 배팅액은 BB 금액인 5
    currentBets,
    raiseCount: 0,
    usedCardIds,
    phaseComplete: false,
    finished: false,
    winner: null,
    winnerHand: null,
    showdownData: null,
    lastAction: {
      type: 'deal',
      playerName: '딜러',
      amount: 0,
      detail: `게임 시작! 블라인드 지불 (SB: ${sbPaid}, BB: ${bbPaid})`,
      timestamp: Date.now()
    }
  };

  await update(ref(database), {
    [`rooms/${roomCode}/gameState`]: newGs,
    ...handUpdates
  });

  return true;
}

