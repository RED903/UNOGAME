// 홀덤 라운드 초기화 (로비·게임 화면 공용)

import { database, ref, update } from './firebase-config.js';
import { createDeck, shuffleDeck } from './holdem-rules.js';

export const INITIAL_LIVES = 3; // 목숨 초기 개수

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
  const allPlayerIds = Object.keys(players);
  if (allPlayerIds.length < 2) return false;

  const prevGs = room.gameState || {};
  const n = allPlayerIds.length;
  const startChips = getStartingChips(n);

  const prevChips = prevGs.chipCounts || {};
  const prevLives = prevGs.lives || {};
  const prevEliminated = prevGs.eliminated || {};

  // ─── 목숨 및 칩 처리 ───────────────────────────
  const lives = {};
  const chipCounts = {};
  const eliminated = { ...prevEliminated };

  for (const pid of allPlayerIds) {
    // 이미 탈락한 플레이어는 건너뜀
    if (eliminated[pid]) continue;

    const curChips = prevChips[pid] ?? 0;
    const curLives = prevLives[pid] ?? INITIAL_LIVES;

    if (curChips > 0) {
      // 칩이 남아있으면 그대로 유지
      chipCounts[pid] = curChips;
      lives[pid] = curLives;
    } else {
      // 칩이 0이 됨 → 목숨 1개 소모
      const newLives = curLives - 1;
      if (newLives <= 0) {
        // 목숨 0 → 완전 탈락
        eliminated[pid] = true;
        lives[pid] = 0;
        chipCounts[pid] = 0;
      } else {
        // 목숨 차감 후 칩 재지급
        lives[pid] = newLives;
        chipCounts[pid] = startChips;
      }
    }
  }

  // 탈락자를 제외한 실제 게임 참가자 목록
  const playerIds = allPlayerIds.filter(pid => !eliminated[pid]);

  // 생존자가 1명 이하면 게임 종료 조건 (더 이상 라운드 불가)
  if (playerIds.length < 2) return false;

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

  // 목숨이 차감된 플레이어 목록 생성 (표시용)
  const lifeChangedPids = allPlayerIds.filter(pid =>
    (prevLives[pid] ?? INITIAL_LIVES) !== (lives[pid] ?? INITIAL_LIVES)
  );
  const lifeDetail = lifeChangedPids.length > 0
    ? ` | 목숨 차감: ${lifeChangedPids.map(pid => `${players[pid]?.name || pid} (남은 목숨: ❤️×${lives[pid]})`).join(', ')}`
    : '';

  const newGs = {
    phase: 'preflop',
    playerOrder: playerIds,
    actorOrder,
    currentActor: actorOrder[0],
    phaseActed: {},
    chipCounts,
    lives,
    eliminated,
    folded: {},
    pot,
    communityCards: [],
    dealerIndex,
    currentBet: bbAmount,
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
      detail: `게임 시작! 블라인드 지불 (SB: ${sbPaid}, BB: ${bbPaid})${lifeDetail}`,
      timestamp: Date.now()
    }
  };

  await update(ref(database), {
    [`rooms/${roomCode}/gameState`]: newGs,
    ...handUpdates
  });

  return true;
}

