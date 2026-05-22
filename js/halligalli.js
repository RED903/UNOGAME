/**
 * 할리갈리 (Halli Galli) 실시간 게임 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, runTransaction
} from './firebase-config.js';
import {
  createHalliGalliDeck, checkFiveFruits, FRUITS
} from './halligalli-rules.js';
import {
  playBell, playCardPlay, playCardDraw, playMyTurn, playWin, playLose, playError
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
let myAvatar = '🦊';
let gs = null; // 게임 상태
let playersList = {}; // { pid: { name, avatar, isBot } }
const unsubList = [];

// 봇 타이머 리스트
let botActionTimers = [];

// DOM 요소들
const displayRoomCode = document.getElementById('display-room-code');
const turnStatus = document.getElementById('turn-status');
const btnLeave = document.getElementById('btn-leave');
const btnBell = document.getElementById('btn-bell');
const btnFlip = document.getElementById('btn-flip');
const opponentsArea = document.getElementById('opponents-area');
const penaltyNotice = document.getElementById('penalty-notice');
const actionLog = document.getElementById('action-log');

const myAvatarEl = document.getElementById('my-avatar');
const myNameEl = document.getElementById('my-name');
const myDeckCount = document.getElementById('my-deck-count');
const myOpenCardSlot = document.getElementById('my-open-card-slot');

const gameOverOverlay = document.getElementById('game-over-overlay');
const winnerNameEl = document.getElementById('winner-name');
const playersRankingEl = document.getElementById('players-ranking');
const btnBackLobby = document.getElementById('btn-back-lobby');
const btnRestart = document.getElementById('btn-restart');
const btnOverlayLeave = document.getElementById('btn-overlay-leave');

// ─── 초기화 ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  displayRoomCode.textContent = myRoomCode;
  initEmotePanel();

  try {
    // 1. 방 정보 취득
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
    myNameEl.textContent = myName;
    document.querySelector('.my-status-card')?.setAttribute('data-pid', myPlayerId);

    // 2. 방장 주도의 카드 게임 상태 초기화
    if (isHost && !room.gameState) {
      await initHalliGalliGame(room);
    }

    // 3. 실시간 리스너 작동
    subscribeToRoom();

  } catch (err) {
    console.error('할리갈리 초기화 실패:', err);
  }
});

// ─── 방장: 게임 최초 초기화 ────────────────────────────
async function initHalliGalliGame(room) {
  const pids = Object.keys(room.players || {});
  
  // 56장 덱 생성 및 공평 배분
  const fullDeck = createHalliGalliDeck();
  const decks = {};
  pids.forEach(pid => { decks[pid] = []; });

  fullDeck.forEach((card, idx) => {
    const targetPid = pids[idx % pids.length];
    decks[targetPid].push(card);
  });

  const playersOut = {};
  pids.forEach(pid => {
    playersOut[pid] = false;
  });

  const gameState = {
    status: 'playing',
    turn: pids[0], // 첫 턴
    playerOrder: pids,
    bellRungPid: '',
    bellRungTime: 0,
    decks,
    // faceUpPile: 각 플레이어의 앞면 쌓인 더미 (배열). 카드를 뒤집을수록 쌓임.
    // 종 성공 시 전체 수거, 오발 시 그대로 유지.
    faceUpPile: {},
    playersOut,
    roundCount: 1,
    bellRungResult: {
      status: 'none',
      winnerId: '',
      ts: 0
    }
  };

  // faceUpPile 초기화 (빈 배열)
  pids.forEach(pid => {
    gameState.faceUpPile[pid] = [];
  });

  await update(ref(database, `rooms/${myRoomCode}/gameState`), gameState);
}

// ─── Firebase 실시간 구독 ─────────────────────────────────
function subscribeToRoom() {
  const gsRef = ref(database, `rooms/${myRoomCode}/gameState`);
  const unsub = onValue(gsRef, (snapshot) => {
    if (!snapshot.exists()) {
      // 방 파괴 시 로비로
      cleanup();
      window.location.href = 'index.html';
      return;
    }

    gs = snapshot.val();
    updateUI();

    // 봇 AI 구동
    handleBotAI();
  });
  unsubList.push(unsub);

  // 로비 정보 업데이트에 대응하여 나갈 때 분기
  const roomRef = ref(database, `rooms/${myRoomCode}`);
  const unsubRoom = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const room = snapshot.val();
    if (room.status === 'waiting') {
      // 대기실로 방이 환원된 경우
      cleanup();
      window.location.href = 'index.html';
    }
  });
  unsubList.push(unsubRoom);

  // 실시간 감정표현 리스너
  const emoteRef = ref(database, `rooms/${myRoomCode}/emotes`);
  const unsubEmote = onValue(emoteRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const emotes = snapshot.val();
    Object.entries(emotes).forEach(([pid, data]) => {
      if (pid !== myPlayerId && data && data.emote) {
        showEmotePopup(pid, data.emote, data.timestamp);
      }
    });
  });
  unsubList.push(unsubEmote);
}

// ─── UI 실시간 갱신 ──────────────────────────────────────
function updateUI() {
  if (!gs) return;

  const currentTurnPid = gs.turn;
  const isMyTurn = (currentTurnPid === myPlayerId);

  // 1. 내 카드덱 수량 및 오픈 카드 슬롯 렌더링
  const myDeck = gs.decks?.[myPlayerId] || [];
  myDeckCount.textContent = myDeck.length;
  
  // faceUpPile의 가장 위 카드(최신 카드)를 표시
  const myPile = gs.faceUpPile?.[myPlayerId] || [];
  const myTopCard = myPile.length > 0 ? myPile[myPile.length - 1] : null;
  renderCard(myTopCard, myOpenCardSlot);

  // 2. 카드 뒤집기 버튼 활성 조건
  // 내 턴이고, 내 덱에 카드가 남아있으며, 아직 종이 울린 결과 판정 중이 아닐 때
  const bellLocked = gs.bellRungPid !== '' && gs.bellRungPid !== undefined;
  if (isMyTurn && myDeck.length > 0 && !bellLocked && !gs.playersOut?.[myPlayerId]) {
    btnFlip.disabled = false;
  } else {
    btnFlip.disabled = true;
  }

  // 3. 턴 상태 뱃지 업데이트
  if (gs.playersOut?.[myPlayerId]) {
    turnStatus.textContent = '❌ 파산 (아웃됨)';
    turnStatus.className = 'turn-status-badge';
    turnStatus.style.color = '#ef4444';
  } else if (isMyTurn) {
    turnStatus.textContent = '👉 내 차례! 카드를 뒤집으세요!';
    turnStatus.className = 'turn-status-badge my-turn';
    turnStatus.style.color = '#10b981';
  } else {
    const turnPlayerName = playersList[currentTurnPid]?.name || '상대';
    turnStatus.textContent = `⏳ ${turnPlayerName}의 차례`;
    turnStatus.className = 'turn-status-badge';
    turnStatus.style.color = 'rgba(240,240,255,0.6)';
  }

  // 4. 상대방 영역 DOM 캐싱 방식으로 업데이트 (매번 초기화하면 깜빡임 발생)
  const order = gs.playerOrder || [];
  const renderedPids = new Set();

  order.forEach(pid => {
    if (pid === myPlayerId) return; // 나는 제외
    renderedPids.add(pid);

    const pInfo = playersList[pid] || { name: '컴퓨터', avatar: '🤖' };
    const pDeck = gs.decks?.[pid] || [];
    // faceUpPile 최상위 카드를 오픈 카드로 표시
    const pPile = gs.faceUpPile?.[pid] || [];
    const pOpenCard = pPile.length > 0 ? pPile[pPile.length - 1] : null;
    const isHisTurn = (gs.turn === pid);
    const isOut = gs.playersOut?.[pid];

    // 이미 DOM에 있는 노드는 재사용, 없으면 새로 생성
    let cardDiv = opponentsArea.querySelector(`[data-opponent-pid="${pid}"]`);
    if (!cardDiv) {
      cardDiv = document.createElement('div');
      cardDiv.dataset.opponentPid = pid;
      cardDiv.dataset.pid = pid;
      cardDiv.innerHTML = `
        <div class="opponent-profile">
          <span class="opponent-avatar">${pInfo.avatar || '🤖'}</span>
          <span class="opponent-name">${pInfo.name}</span>
        </div>
        <div class="opponent-deck-info">
          <div class="mini-card-back"></div>
          <span class="mini-deck-count">${pDeck.length}</span>
        </div>
        <div class="opponent-open-card-slot" id="open-slot-${pid}"></div>
      `;
      opponentsArea.appendChild(cardDiv);
    } else {
      // 덱 카운트만 갱신 (DOM 재생성 없이)
      const countEl = cardDiv.querySelector('.mini-deck-count');
      if (countEl) countEl.textContent = pDeck.length;
    }

    // 액티브 턴 클래스 갱신
    cardDiv.className = `opponent-card ${isHisTurn ? 'active-turn' : ''} ${isOut ? 'out' : ''}`;

    // 오픈 카드 슬롯 렌더링 (변경 시에만 flip 애니메이션 발동)
    const slot = document.getElementById(`open-slot-${pid}`);
    renderCard(pOpenCard, slot);
  });

  // 게임에서 떠난 플레이어 노드 제거
  opponentsArea.querySelectorAll('[data-opponent-pid]').forEach(el => {
    if (!renderedPids.has(el.dataset.opponentPid)) {
      opponentsArea.removeChild(el);
    }
  });

  // 5. 종 울림 사운드 및 모션
  if (gs.bellRungPid) {
    btnBell.classList.add('pressed', 'ring-anim');
    playBell();
    setTimeout(() => {
      btnBell.classList.remove('pressed', 'ring-anim');
    }, 400);

    // 방장인 경우 즉시 결과 판정 트랙 진입
    if (isHost) {
      setTimeout(() => {
        judgeBellRing(gs.bellRungPid);
      }, 300);
    }
  }

  // 6. 판정 결과 메시지 로그 및 말풍선 처리
  handleBellResultMessages();

  // 7. 게임 승패 오버레이 표시 여부 검사
  checkGameOver();
}

// ─── 카드 렌더러 ───
// 카드 ID가 변경되었을 때만 DOM을 갱신하고, 새 카드일 때만 flip 애니메이션 적용
function renderCard(card, targetEl) {
  if (!targetEl) return;

  const currentCardId = targetEl.dataset.cardId || '';
  const newCardId = card ? card.id : '';

  // 동일한 카드 → 렌더링 완전 스킵 (깜빡임 방지)
  if (currentCardId === newCardId) {
    return;
  }

  targetEl.dataset.cardId = newCardId;
  targetEl.innerHTML = '';

  if (!card) {
    targetEl.style.border = '2px dashed rgba(255,255,255,0.15)';
    targetEl.style.background = 'rgba(0,0,0,0.2)';
    return;
  }

  targetEl.style.border = 'none';
  targetEl.style.background = 'transparent';

  const cardContainer = document.createElement('div');
  // 카드가 실제로 바뀐 경우에만 flip-in 애니메이션 클래스 적용
  cardContainer.className = 'hg-card hg-card--flip-in';
  // 애니메이션 재사용을 위해 강제 reflow 후 클래스 제거
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cardContainer.classList.remove('hg-card--flip-in');
    });
  });

  const pattern = document.createElement('div');
  pattern.className = 'hg-card-pattern';
  pattern.dataset.count = card.count;

  for (let i = 0; i < card.count; i++) {
    const item = document.createElement('span');
    item.className = 'hg-card-item';
    item.textContent = card.fruit;
    pattern.appendChild(item);
  }

  cardContainer.appendChild(pattern);
  targetEl.appendChild(cardContainer);
}

// ─── 카드 뒤집기 액션 (내 턴일 때) ───────────────────────
btnFlip.addEventListener('click', async () => {
  if (!gs || gs.turn !== myPlayerId || gs.playersOut?.[myPlayerId]) return;

  btnFlip.disabled = true; // 중복 방지
  playCardPlay();

  try {
    const myDeck = [...(gs.decks?.[myPlayerId] || [])];
    if (myDeck.length === 0) return;

    const flippedCard = myDeck.shift(); // 덱 맨위 1장 제거

    // 다음 턴 플레이어 검색 (파산 안 당한 사람)
    const order = gs.playerOrder || [];
    let nextIdx = (order.indexOf(myPlayerId) + 1) % order.length;
    let nextTurnPid = order[nextIdx];

    // 살아있는 사람 찾을 때까지 루프
    let attempts = 0;
    while (gs.playersOut?.[nextTurnPid] && attempts < order.length) {
      nextIdx = (nextIdx + 1) % order.length;
      nextTurnPid = order[nextIdx];
      attempts++;
    }

    const updates = {
      [`rooms/${myRoomCode}/gameState/decks/${myPlayerId}`]: myDeck,
      // faceUpPile 배열에 새 카드를 추가 (기존 카드는 보존 - 증발 버그 수정)
      [`rooms/${myRoomCode}/gameState/faceUpPile/${myPlayerId}`]: [
        ...(gs.faceUpPile?.[myPlayerId] || []),
        flippedCard
      ],
      [`rooms/${myRoomCode}/gameState/turn`]: nextTurnPid
    };

    await update(ref(database), updates);

    // 카드 뒤집음 로그 추가
    addLocalLog(`${myName}님이 카드를 뒤집었습니다.`);

  } catch (err) {
    console.error('카드 뒤집기 실패:', err);
    btnFlip.disabled = false;
  }
});

// ─── 종 치기 경쟁 (Transaction) ─────────────────────────
btnBell.addEventListener('click', () => {
  triggerBellRing(myPlayerId);
});

async function triggerBellRing(pid) {
  if (!gs) return;
  if (gs.bellRungPid !== '' && gs.bellRungPid !== undefined) return; // 이미 누군가 침

  const bellRungRef = ref(database, `rooms/${myRoomCode}/gameState/bellRungPid`);

  try {
    const result = await runTransaction(bellRungRef, (currentVal) => {
      if (currentVal === "" || !currentVal) {
        return pid; // 내가 선점
      }
      return; // 트랜잭션 거부 (이미 상대가 선점)
    });

    if (result.committed) {
      // 종치기 전송 완료
      await update(ref(database, {
        [`rooms/${myRoomCode}/gameState/bellRungTime`]: Date.now()
      }));
    }
  } catch (err) {
    console.error('타종 트랜잭션 에러:', err);
  }
}

// ─── 방장 전용: 타종 판정 연산 ────────────────────────────
async function judgeBellRing(ringerId) {
  if (!isHost || !gs) return;

  // faceUpPile에서 각 플레이어의 최상위 카드만 추출하여 5개 판정
  const pileSnapshot = gs.faceUpPile || {};
  const topCards = {};
  Object.keys(pileSnapshot).forEach(pid => {
    const pile = pileSnapshot[pid] || [];
    topCards[pid] = pile.length > 0 ? pile[pile.length - 1] : null;
  });

  const isFive = checkFiveFruits(topCards);
  const ringerName = playersList[ringerId]?.name || '상대';

  const decks = { ...gs.decks };
  const playersOut = { ...gs.playersOut };
  // faceUpPile을 깊은 복사
  const faceUpPile = {};
  Object.keys(pileSnapshot).forEach(pid => {
    faceUpPile[pid] = [...(pileSnapshot[pid] || [])];
  });

  let status = 'none';

  if (isFive) {
    // 1. 성공! 모든 플레이어의 faceUpPile을 전부 수거하여 종 친 사람 덱 하단으로
    status = 'success';
    const collectedCards = [];

    Object.keys(faceUpPile).forEach(pid => {
      const pile = faceUpPile[pid];
      if (pile && pile.length > 0) {
        collectedCards.push(...pile); // 더미 전체 수거
        faceUpPile[pid] = [];         // 더미 클리어
      }
    });

    // 수거한 카드를 종 친 사람 덱 맨 밑에 추가
    decks[ringerId] = [...(decks[ringerId] || []), ...collectedCards];

    // 아웃당해있던 사람이 성공했으면 구활
    if (playersOut[ringerId]) {
      playersOut[ringerId] = false;
    }

    // 다음 턴은 종 친 사람으로 변경
    gs.turn = ringerId;

  } else {
    // 2. 오발! 종 친 사람이 자신의 덱 카드를 다른 살아있는 사람들에게 1장씩 분배
    // (faceUpPile은 그대로 유지 - 오발 시 바닥 카드는 건드리지 않음)
    status = 'penalty';
    const activePlayers = gs.playerOrder.filter(pid => pid !== ringerId && !playersOut[pid]);
    const ringerDeck = [...(decks[ringerId] || [])];

    activePlayers.forEach(pid => {
      if (ringerDeck.length > 0) {
        const penaltyCard = ringerDeck.pop();
        decks[pid] = [...(decks[pid] || []), penaltyCard];
        
        // 벌칙 카드를 받아 덱이 생겼으면 구활
        if (playersOut[pid]) {
          playersOut[pid] = false;
        }
      }
    });

    decks[ringerId] = ringerDeck;
  }

  // 3. 카드 수급 후, 덱도 없고 faceUpPile도 없는 플레이어는 영구 아웃(패배) 판정
  gs.playerOrder.forEach(pid => {
    const dLen = decks[pid]?.length || 0;
    const pileLen = faceUpPile[pid]?.length || 0;
    if (dLen === 0 && pileLen === 0) {
      playersOut[pid] = true;
    }
  });

  // 4. Firebase 원자적 업데이트
  const updates = {
    [`rooms/${myRoomCode}/gameState/decks`]: decks,
    [`rooms/${myRoomCode}/gameState/faceUpPile`]: faceUpPile,
    [`rooms/${myRoomCode}/gameState/playersOut`]: playersOut,
    [`rooms/${myRoomCode}/gameState/turn`]: gs.turn,
    [`rooms/${myRoomCode}/gameState/bellRungPid`]: '', // 종 초기화
    [`rooms/${myRoomCode}/gameState/bellRungTime`]: 0,
    [`rooms/${myRoomCode}/gameState/bellRungResult`]: {
      status,
      winnerId: ringerId,
      ts: Date.now()
    }
  };

  await update(ref(database), updates);
}

// ─── 종 결과 처리 텍스트 & 토스트 및 피드백 ───────────────────
let lastResultTs = 0;
function handleBellResultMessages() {
  const res = gs.bellRungResult;
  if (!res || res.ts === lastResultTs || res.status === 'none') return;
  lastResultTs = res.ts;

  const winnerName = playersList[res.winnerId]?.name || '상대';
  
  if (res.status === 'success') {
    // 성공 알림
    showToast(`🔔 성공! ${winnerName}님이 바닥 카드를 모두 획득했습니다!`);
    addLocalLog(`[타종] ${winnerName}님 종치기 성공! 카드 싹쓸이.`);
    
    // 이펙트 효과음
    if (res.winnerId === myPlayerId) {
      playWin();
    }
  } else if (res.status === 'penalty') {
    // 오발 벌칙 알림
    showToast(`⚠️ 오발! ${winnerName}님이 잘못 종을 쳐 벌칙 카드를 돌렸습니다.`);
    addLocalLog(`[오발] ${winnerName}님 오타종! 벌칙 카드 분배.`);
    
    // 벌칙 경고 말풍선 띄우기
    penaltyNotice.textContent = `❌ 오발! 벌칙 1장씩!`;
    penaltyNotice.classList.add('show');
    playError();
    setTimeout(() => {
      penaltyNotice.classList.remove('show');
    }, 2000);
  }
}

// ─── 봇 AI 실시간 핸들러 ────────────────────────────────
function handleBotAI() {
  if (!gs || gs.status !== 'playing') return;

  // 기존 실행 대기 중인 모든 타이머 폭파
  botActionTimers.forEach(t => clearTimeout(t));
  botActionTimers = [];

  // 종이 이미 눌려있으면 대기
  if (gs.bellRungPid) return;

  const faceUpPile = gs.faceUpPile || {};
  // 각 플레이어의 최상위 카드만 추출하여 5개 판정
  const topCards = {};
  Object.keys(faceUpPile).forEach(pid => {
    const pile = faceUpPile[pid] || [];
    topCards[pid] = pile.length > 0 ? pile[pile.length - 1] : null;
  });
  const isFive = checkFiveFruits(topCards);

  // 1. 과일의 합이 정확히 5개일 때 경쟁 타종
  if (isFive) {
    const order = gs.playerOrder || [];
    order.forEach(pid => {
      const pInfo = playersList[pid];
      if (pInfo?.isBot && !gs.playersOut?.[pid]) {
        // 0.8초 ~ 1.5초 사이의 난수 타이머 가동
        const speed = 800 + Math.random() * 700;
        const timer = setTimeout(() => {
          triggerBellRing(pid);
        }, speed);
        botActionTimers.push(timer);
      }
    });
  } 
  // 2. 과일의 합이 5가 아닐 때, 5%의 낮은 확률로 실수 종치기 유도
  else {
    const order = gs.playerOrder || [];
    order.forEach(pid => {
      const pInfo = playersList[pid];
      if (pInfo?.isBot && !gs.playersOut?.[pid]) {
        // 5% 확률
        if (Math.random() < 0.05) {
          // 1.2초 ~ 2.0초 후 실수
          const speed = 1200 + Math.random() * 800;
          const timer = setTimeout(() => {
            triggerBellRing(pid);
          }, speed);
          botActionTimers.push(timer);
        }
      }
    });
  }

  // 3. 봇의 턴인 경우 자동으로 카드 뒤집기 작동
  const curTurnPid = gs.turn;
  const curTurnBot = playersList[curTurnPid];
  if (curTurnBot?.isBot && !gs.playersOut?.[curTurnPid]) {
    // 봇 덱 장수 확인
    const botDeck = gs.decks?.[curTurnPid] || [];
    if (botDeck.length > 0) {
      // 1.0초 ~ 1.8초 대기 후 카드 뒤집기
      const timer = setTimeout(async () => {
        // 뒤집을 때 남들 뒤집는 것 감시하고 중복 막기 위해 방장 또는 봇 자신이 대행
        // 봇의 액션은 방장이 트랙 진행 대행 처리 가능
        if (isHost) {
          const freshDeck = [...botDeck];
          const flipped = freshDeck.shift();
          
          const order = gs.playerOrder || [];
          let nextIdx = (order.indexOf(curTurnPid) + 1) % order.length;
          let nextTurnPid = order[nextIdx];

          let attempts = 0;
          while (gs.playersOut?.[nextTurnPid] && attempts < order.length) {
            nextIdx = (nextIdx + 1) % order.length;
            nextTurnPid = order[nextIdx];
            attempts++;
          }

          const updates = {
            [`rooms/${myRoomCode}/gameState/decks/${curTurnPid}`]: freshDeck,
            // faceUpPile 배열에 push (기존 카드 보존)
            [`rooms/${myRoomCode}/gameState/faceUpPile/${curTurnPid}`]: [
              ...(gs.faceUpPile?.[curTurnPid] || []),
              flipped
            ],
            [`rooms/${myRoomCode}/gameState/turn`]: nextTurnPid
          };
          
          playCardPlay();
          await update(ref(database), updates);
          addLocalLog(`${curTurnBot.name}이 카드를 뒤집었습니다.`);
        }
      }, 1000 + Math.random() * 800);
      botActionTimers.push(timer);
    } else {
      // 봇이 뒤집을 카드가 없으면 턴 패스
      if (isHost) {
        const order = gs.playerOrder || [];
        let nextIdx = (order.indexOf(curTurnPid) + 1) % order.length;
        let nextTurnPid = order[nextIdx];

        let attempts = 0;
        while (gs.playersOut?.[nextTurnPid] && attempts < order.length) {
          nextIdx = (nextIdx + 1) % order.length;
          nextTurnPid = order[nextIdx];
          attempts++;
        }
        update(ref(database, `rooms/${myRoomCode}/gameState`), { turn: nextTurnPid });
      }
    }
  }
}

// ─── 게임 최종 종료 검증 ────────────────────────────────
function checkGameOver() {
  if (!gs || gs.status === 'gameover') return;

  const order = gs.playerOrder || [];
  const activePlayers = order.filter(pid => !gs.playersOut?.[pid]);

  // 생존자가 1명 이하이면 게임 오버!
  if (activePlayers.length <= 1) {
    const winnerId = activePlayers[0] || order[0];
    const winnerName = playersList[winnerId]?.name || '상대';

    gs.status = 'gameover';
    gs.roundWinner = winnerId;

    // 최종 순위표: 남은 덱 + faceUpPile 합산 장수 기준 정렬
    const ranking = order.map(pid => {
      const pDeck = gs.decks?.[pid] || [];
      const pPile = gs.faceUpPile?.[pid] || [];
      const isOut = gs.playersOut?.[pid];
      const totalCards = isOut ? 0 : pDeck.length + pPile.length;
      return {
        pid,
        name: playersList[pid]?.name || '상대',
        avatar: playersList[pid]?.avatar || '🤖',
        deckCount: totalCards,
        isOut
      };
    }).sort((a, b) => {
      if (a.isOut !== b.isOut) return a.isOut ? 1 : -1;
      return b.deckCount - a.deckCount;
    });

    // UI 출력
    winnerNameEl.textContent = `🏆 최종 승자: ${winnerName}`;
    playersRankingEl.innerHTML = ranking.map((rank, idx) => `
      <div class="rank-item ${idx === 0 ? 'rank-1' : ''}">
        <span class="rank-num">${idx + 1}등</span>
        <span class="rank-player">${rank.avatar} ${rank.name}</span>
        <span class="rank-cards">${rank.deckCount}장 보유 ${rank.isOut ? '(파산)' : ''}</span>
      </div>
    `).join('');

    // 호스트면 리스타트 및 대기실 복귀 단추 활성화
    if (isHost) {
      btnRestart.style.display = 'block';
      btnBackLobby.style.display = 'block';
    } else {
      btnRestart.style.display = 'none';
      btnBackLobby.style.display = 'none';
    }

    gameOverOverlay.style.display = 'flex';

    if (winnerId === myPlayerId) {
      playWin();
    } else {
      playLose();
    }
  }
}

// ─── 다음 라운드 리스타트 (방장용) ───────────────────────────
btnRestart.addEventListener('click', async () => {
  if (!isHost) return;
  gameOverOverlay.style.display = 'none';

  // 카드 초기화 및 다시 분배
  const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
  if (roomSnap.exists()) {
    await initHalliGalliGame(roomSnap.val());
  }
});

// ─── 대기실 복귀 (방장용) ──────────────────────────────────
btnBackLobby.addEventListener('click', async () => {
  if (!isHost) return;

  try {
    // 방 상태를 waiting으로 돌려놓으면 모든 클라이언트가 index.html로 강제 이동됨
    await update(ref(database, `rooms/${myRoomCode}`), {
      status: 'waiting'
    });
    // 내 게임정보 삭제
    await remove(ref(database, `rooms/${myRoomCode}/gameState`));
    await remove(ref(database, `rooms/${myRoomCode}/emotes`));
  } catch (err) {
    console.error('대기실 복귀 에러:', err);
  }
});

// ─── 게임 나가기 (다른 게임들과 동일: 방장은 대기실로, 참가자는 퇴장) ───
btnLeave.addEventListener('click', handleLeave);
btnOverlayLeave.addEventListener('click', handleLeave);

async function handleLeave() {
  if (confirm('정말로 게임에서 나가시겠습니까?')) {
    cleanup();
    
    try {
      if (isHost) {
        // 방장이 나가면 방 상태를 'waiting'으로 되돌려 모든 플레이어를 대기실로 복귀시킴
        await update(ref(database, `rooms/${myRoomCode}`), {
          status: 'waiting'
        });
        // 게임 상태 초기화 (봇 플레이어 포함)
        await remove(ref(database, `rooms/${myRoomCode}/gameState`));
        await remove(ref(database, `rooms/${myRoomCode}/emotes`));
        // 봇 플레이어는 대기실에서 제거
        const pids = Object.keys(playersList);
        for (const pid of pids) {
          if (playersList[pid]?.isBot) {
            await remove(ref(database, `rooms/${myRoomCode}/players/${pid}`));
          }
        }
      } else {
        // 일반 유저는 자신만 플레이어 목록에서 삭제
        await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
        if (gs) {
          await remove(ref(database, `rooms/${myRoomCode}/gameState/decks/${myPlayerId}`));
          await remove(ref(database, `rooms/${myRoomCode}/gameState/openCards/${myPlayerId}`));
        }
      }
    } catch (err) {
      console.error('방 퇴장 처리 에러:', err);
    }

    window.location.href = 'index.html';
  }
}

// ─── 로그 및 텍스트 ───
function addLocalLog(msg) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  if (msg.includes('종치기')) entry.classList.add('log-bell');
  else if (msg.includes('카드')) entry.classList.add('log-flip');
  else if (msg.includes('아웃')) entry.classList.add('log-out');

  entry.textContent = `[${new Date().toLocaleTimeString('ko-KR', { hour12: false })}] ${msg}`;
  actionLog.appendChild(entry);
  actionLog.scrollTop = actionLog.scrollHeight;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

function cleanup() {
  botActionTimers.forEach(t => clearTimeout(t));
  unsubList.forEach(unsub => unsub());
}

// ─── 감정표현 ────────────────────────────────────
const EMOTES = ['😂', '👍', '😤', '🔥', '😭', '🤯', '😮', '😜', '🤔', '🤮', '😡', '🤦‍♂️', '👎'];
let isEmoteCooldown = false;
const shownEmoteTimestamps = new Set();

function initEmotePanel() {
  const listEl = document.getElementById('emote-list');
  const toggleBtn = document.getElementById('btn-emote-toggle');

  if (!listEl || !toggleBtn) return;

  // 이모지 버튼 생성
  listEl.innerHTML = EMOTES.map(e =>
    `<button class="emote-btn" data-emote="${e}" title="${e}">${e}</button>`
  ).join('');

  // 개별 이모지 클릭
  listEl.querySelectorAll('.emote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.dataset.emote;
      sendEmote(emote);
    });
  });

  // 토글 버튼
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    listEl.classList.toggle('open');
  });

  // 문서 클릭 시 이모지 패널 닫기
  document.addEventListener('click', () => {
    listEl.classList.remove('open');
  });
  listEl.addEventListener('click', (e) => e.stopPropagation());
  toggleBtn.addEventListener('click', (e) => e.stopPropagation());
}

async function sendEmote(emote) {
  if (isEmoteCooldown) return;
  isEmoteCooldown = true;

  const toggleBtn = document.getElementById('btn-emote-toggle');
  const listEl = document.getElementById('emote-list');

  if (toggleBtn) toggleBtn.classList.add('cooldown');
  if (listEl) {
    listEl.querySelectorAll('.emote-btn').forEach(btn => {
      btn.classList.add('cooldown');
      btn.disabled = true;
    });
  }

  try {
    await update(ref(database, `rooms/${myRoomCode}/emotes/${myPlayerId}`), {
      emote,
      senderName: myName,
      timestamp: Date.now()
    });
  } catch (e) {
    console.error('감정표현 전송 실패:', e);
  }

  showEmotePopup(myPlayerId, emote, Date.now());

  setTimeout(() => {
    isEmoteCooldown = false;
    if (toggleBtn) toggleBtn.classList.remove('cooldown');
    if (listEl) {
      listEl.querySelectorAll('.emote-btn').forEach(btn => {
        btn.classList.remove('cooldown');
        btn.disabled = false;
      });
    }
  }, 1000);
}

function showEmotePopup(playerId, emote, timestamp) {
  const key = `${playerId}_${timestamp}`;
  if (shownEmoteTimestamps.has(key)) return;
  shownEmoteTimestamps.add(key);

  if (shownEmoteTimestamps.size > 50) {
    const first = shownEmoteTimestamps.values().next().value;
    shownEmoteTimestamps.delete(first);
  }

  const playerEl = document.querySelector(`[data-pid="${playerId}"]`);
  if (!playerEl) return;

  const rect = playerEl.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.className = 'emote-popup';
  popup.textContent = emote;
  
  // 플레이어 패널 하단 중앙에서 아래로 떨어지게 세팅
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.bottom + 10}px`;
  popup.style.transform = 'translateX(-50%)';

  document.getElementById('emote-popup-container')?.appendChild(popup);
  setTimeout(() => popup.remove(), 2900);
}

