/**
 * 라이어 게임 (Liar Game) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

import {
  database, ref, get, onValue, update, remove, set, serverTimestamp
} from './firebase-config.js';
import {
  WORD_DATABASE, getRandomWordEntry, LIAR_BLUFF_HINTS
} from './liar-words.js';
import {
  playMyTurn, playWin, playLose, playVote, playCorrect, playWrong, playButtonClick, playChat
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
let myAvatar = '🤫';
let playersList = {}; // { pid: { name, avatar, isBot } }
let playerOrder = []; // [pid1, pid2, ...]
let currentGs = null;
let roomListener = null;
let botActionTimer = null;
let isWordHidden = false;
let selectedVoteTarget = null;
let isNavigatingToLobby = false; // 대기실 복귀 중 퇴장 오작동 방지 플래그

// DOM 요소 캐싱
const displayRoomCode = document.getElementById('display-room-code');
const phaseBadge = document.getElementById('phase-badge');
const phaseIcon = document.getElementById('phase-icon');
const phaseText = document.getElementById('phase-text');
const btnLeave = document.getElementById('btn-leave');

const secretCard = document.getElementById('secret-card');
const secretCategory = document.getElementById('secret-category');
const secretWord = document.getElementById('secret-word');
const secretRoleDesc = document.getElementById('secret-role-desc');

const chatTimeline = document.getElementById('chat-timeline');
const inputZone = document.getElementById('input-zone');
const inputHint = document.getElementById('input-hint');
const btnSendHint = document.getElementById('btn-send-hint');

const votingZone = document.getElementById('voting-zone');
const voteTargetsGrid = document.getElementById('vote-targets-grid');
const btnSubmitVote = document.getElementById('btn-submit-vote');

const liarGuessModal = document.getElementById('liar-guess-modal');
const inputLiarGuess = document.getElementById('input-liar-guess');
const btnSubmitGuess = document.getElementById('btn-submit-guess');

const resultModal = document.getElementById('result-modal');
const resultTrophy = document.getElementById('result-trophy');
const resultWinnerTitle = document.getElementById('result-winner-title');
const resultSummaryText = document.getElementById('result-summary-text');
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
      myAvatar = playersList[myPlayerId].avatar || '🤫';
    }

    const hostId = room.host;
    playerOrder = [hostId, ...Object.keys(playersList).filter(id => id !== hostId)];

    if (isHost && !room.gameState) {
      await initLiarGameState();
    }

    listenToLiarRoom();

  } catch (err) {
    console.error('라이어 게임 초기화 오류:', err);
  }
});

/** 방장: 신규 게임 상태 생성 */
async function initLiarGameState() {
  const wordEntry = getRandomWordEntry();
  const liarIndex = Math.floor(Math.random() * playerOrder.length);
  const liarId = playerOrder[liarIndex];

  const newGs = {
    category: wordEntry.category,
    word: wordEntry.word,
    hints: wordEntry.hints || [],
    liarId,
    phase: 'speaking',
    turnIndex: 0,
    feed: [
      {
        senderId: 'system',
        senderName: '시스템',
        avatar: '📢',
        text: `카테고리는 [${wordEntry.category}]입니다! 각자 제시어에 대해 힌트를 말씀해주세요.`
      }
    ],
    votes: {},
    result: null,
    createdAt: Date.now()
  };

  await set(ref(database, `rooms/${myRoomCode}/gameState`), newGs);
}

/** 실시간 룸 상태 리스너 */
function listenToLiarRoom() {
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
    renderLiarGame(gs);

    checkLiarBotActions(gs);
  });
}

/** 전체 화면 렌더링 */
function renderLiarGame(gs) {
  const isLiar = (gs.liarId === myPlayerId);

  secretCategory.textContent = `카테고리: ${gs.category}`;
  if (isLiar) {
    secretWord.textContent = '당신은 라이어입니다! 🤫';
    secretWord.className = `secret-word-display liar ${isWordHidden ? 'hidden' : ''}`;
    secretRoleDesc.textContent = '다른 사람들의 힌트를 듣고 제시어를 눈치껏 유추하세요!';
  } else {
    secretWord.textContent = `제시어: ${gs.word}`;
    secretWord.className = `secret-word-display citizen ${isWordHidden ? 'hidden' : ''}`;
    secretRoleDesc.textContent = '라이어에게 들키지 않도록 자연스러운 힌트를 말하세요!';
  }

  renderFeed(gs.feed || []);

  if (gs.phase === 'speaking') {
    votingZone.style.display = 'none';
    inputZone.style.display = 'flex';

    const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
    const isMyTurn = (currentPid === myPlayerId);
    const speaker = playersList[currentPid] || { name: '알 수 없음', avatar: '🤫' };

    phaseIcon.textContent = '💬';
    phaseText.textContent = isMyTurn ? '당신의 발언 차례입니다!' : `${speaker.name} 님의 발언 차례...`;

    if (isMyTurn) {
      inputHint.disabled = false;
      btnSendHint.disabled = false;
      inputHint.placeholder = '제시어에 대한 힌트를 한 문장 입력하세요...';
      inputHint.focus();
    } else {
      inputHint.disabled = true;
      btnSendHint.disabled = true;
      inputHint.placeholder = `${speaker.name} 님이 힌트를 작성 중입니다...`;
    }

  } else if (gs.phase === 'voting') {
    inputZone.style.display = 'none';
    votingZone.style.display = 'flex';

    phaseIcon.textContent = '🗳️';
    phaseText.textContent = '투표 페이즈: 라이어를 지목하세요!';

    renderVotingGrid(gs);

  } else if (gs.phase === 'liar_guess') {
    inputZone.style.display = 'none';
    votingZone.style.display = 'none';

    phaseIcon.textContent = '🚨';
    phaseText.textContent = '라이어의 마지막 역전 기회!';

    if (isLiar) {
      liarGuessModal.classList.add('show');
    } else {
      liarGuessModal.classList.remove('show');
    }

  } else if (gs.phase === 'finished') {
    liarGuessModal.classList.remove('show');
    renderResultModal(gs);
  }
}

function renderFeed(feed) {
  chatTimeline.innerHTML = '';
  feed.forEach(entry => {
    const div = document.createElement('div');
    const isMe = (entry.senderId === myPlayerId);
    div.className = `timeline-entry ${isMe ? 'me' : ''}`;

    div.innerHTML = `
      <div class="entry-avatar">${entry.avatar || '💬'}</div>
      <div class="entry-content">
        <div class="entry-name">${escapeHtml(entry.senderName)}</div>
        <div class="entry-bubble">${escapeHtml(entry.text)}</div>
      </div>
    `;
    chatTimeline.appendChild(div);
  });
  chatTimeline.scrollTop = chatTimeline.scrollHeight;
}

async function handleSendHint() {
  if (!currentGs || currentGs.phase !== 'speaking') return;
  const currentPid = playerOrder[currentGs.turnIndex % playerOrder.length];
  if (currentPid !== myPlayerId) return;

  const text = inputHint.value.trim();
  if (!text) return;

  inputHint.value = '';
  playChat();

  await commitHint(myPlayerId, myName, myAvatar, text);
}

async function commitHint(pid, name, avatar, text) {
  const newFeed = [...(currentGs.feed || []), {
    senderId: pid,
    senderName: name,
    avatar,
    text
  }];

  const nextTurnIndex = currentGs.turnIndex + 1;
  const updates = {
    [`rooms/${myRoomCode}/gameState/feed`]: newFeed,
    [`rooms/${myRoomCode}/gameState/turnIndex`]: nextTurnIndex
  };

  if (nextTurnIndex >= playerOrder.length) {
    updates[`rooms/${myRoomCode}/gameState/phase`] = 'voting';
    newFeed.push({
      senderId: 'system',
      senderName: '시스템',
      avatar: '🗳️',
      text: '모든 발언이 끝났습니다! 의심스러운 사람을 지목해 투표해주세요.'
    });
    updates[`rooms/${myRoomCode}/gameState/feed`] = newFeed;
  }

  await update(ref(database), updates);

  if (playerOrder[nextTurnIndex % playerOrder.length] === myPlayerId && nextTurnIndex < playerOrder.length) {
    playMyTurn();
  }
}

function renderVotingGrid(gs) {
  voteTargetsGrid.innerHTML = '';
  const myVote = gs.votes ? gs.votes[myPlayerId] : null;

  playerOrder.forEach(pid => {
    const p = playersList[pid] || { name: '알 수 없음', avatar: '🤫' };
    const card = document.createElement('div');
    const isSelected = (selectedVoteTarget === pid || myVote === pid);

    card.className = `vote-target-card ${isSelected ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="vote-avatar">${p.avatar || '🤫'}</div>
      <div class="vote-name">${escapeHtml(p.name)} ${pid === myPlayerId ? '(나)' : ''}</div>
    `;

    if (!myVote) {
      card.addEventListener('click', () => {
        selectedVoteTarget = pid;
        btnSubmitVote.disabled = false;
        renderVotingGrid(gs);
      });
    }

    voteTargetsGrid.appendChild(card);
  });

  btnSubmitVote.disabled = (myVote !== undefined && myVote !== null) || !selectedVoteTarget;
  if (myVote) {
    btnSubmitVote.textContent = '투표 완료 (다른 플레이어 기다리는 중...)';
  } else {
    btnSubmitVote.textContent = '투표 제출하기';
  }
}

async function handleSubmitVote() {
  if (!selectedVoteTarget || !currentGs || currentGs.phase !== 'voting') return;
  playVote();

  const updates = {
    [`rooms/${myRoomCode}/gameState/votes/${myPlayerId}`]: selectedVoteTarget
  };

  await update(ref(database), updates);
  selectedVoteTarget = null;
}

function checkLiarBotActions(gs) {
  if (!isHost) return;

  if (gs.phase === 'speaking') {
    const currentPid = playerOrder[gs.turnIndex % playerOrder.length];
    const player = playersList[currentPid];
    if (player && player.isBot) {
      if (botActionTimer) clearTimeout(botActionTimer);
      botActionTimer = setTimeout(async () => {
        const isBotLiar = (gs.liarId === currentPid);
        let hintText = '';
        if (isBotLiar) {
          hintText = LIAR_BLUFF_HINTS[Math.floor(Math.random() * LIAR_BLUFF_HINTS.length)];
        } else {
          const hints = gs.hints || ['좋아하는 편이에요'];
          hintText = hints[Math.floor(Math.random() * hints.length)];
        }
        await commitHint(currentPid, player.name, player.avatar || '🤖', hintText);
      }, 1500);
    }
  }

  if (gs.phase === 'voting') {
    const votes = gs.votes || {};
    playerOrder.forEach(pid => {
      const p = playersList[pid];
      if (p && p.isBot && !votes[pid]) {
        setTimeout(async () => {
          const targets = playerOrder.filter(id => id !== pid);
          const chosenTarget = targets[Math.floor(Math.random() * targets.length)];
          await update(ref(database, `rooms/${myRoomCode}/gameState/votes/${pid}`), chosenTarget);
        }, 1000 + Math.random() * 1500);
      }
    });

    if (Object.keys(votes).length === playerOrder.length) {
      if (botActionTimer) clearTimeout(botActionTimer);
      botActionTimer = setTimeout(async () => {
        await tallyVotes(gs);
      }, 1200);
    }
  }

  if (gs.phase === 'liar_guess') {
    const liarPlayer = playersList[gs.liarId];
    if (liarPlayer && liarPlayer.isBot) {
      if (botActionTimer) clearTimeout(botActionTimer);
      botActionTimer = setTimeout(async () => {
        const guessCorrect = Math.random() < 0.25;
        const guessWord = guessCorrect ? gs.word : '오답';
        await handleLiarGuessResult(guessWord);
      }, 2000);
    }
  }
}

async function tallyVotes(gs) {
  const voteCounts = {};
  playerOrder.forEach(pid => { voteCounts[pid] = 0; });

  Object.values(gs.votes || {}).forEach(targetPid => {
    if (voteCounts[targetPid] !== undefined) voteCounts[targetPid]++;
  });

  let maxVotes = -1;
  let suspects = [];
  for (const [pid, cnt] of Object.entries(voteCounts)) {
    if (cnt > maxVotes) {
      maxVotes = cnt;
      suspects = [pid];
    } else if (cnt === maxVotes) {
      suspects.push(pid);
    }
  }

  const liarId = gs.liarId;
  const liarPlayer = playersList[liarId] || { name: '라이어' };

  if (suspects.includes(liarId)) {
    const newFeed = [...(gs.feed || []), {
      senderId: 'system',
      senderName: '시스템',
      avatar: '🚨',
      text: `최다 득표로 [${liarPlayer.name}] 님이 라이어로 지목되었습니다! 라이어에게 마지막 역전 기회가 주어집니다.`
    }];

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'liar_guess',
      feed: newFeed
    });
  } else {
    const suspectNames = suspects.map(id => (playersList[id]?.name || '시민')).join(', ');
    const newFeed = [...(gs.feed || []), {
      senderId: 'system',
      senderName: '시스템',
      avatar: '🎭',
      text: `시민들이 엉뚱한 사람([${suspectNames}])을 지목했습니다! 진짜 라이어는 [${liarPlayer.name}] 님이었습니다. 라이어 승리!`
    }];

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'finished',
      result: {
        winner: 'liar',
        reason: '시민들이 라이어를 찾아내지 못했습니다.',
        liarId,
        word: gs.word
      },
      feed: newFeed
    });
  }
}

async function handleLiarGuessResult(guessWord) {
  const isCorrect = (guessWord.trim().toLowerCase() === currentGs.word.trim().toLowerCase());
  const liarPlayer = playersList[currentGs.liarId] || { name: '라이어' };

  if (isCorrect) {
    playCorrect();
    const newFeed = [...(currentGs.feed || []), {
      senderId: 'system',
      senderName: '시스템',
      avatar: '🎉',
      text: `라이어 [${liarPlayer.name}] 님이 정답 [${currentGs.word}]을(를) 맞혔습니다! 라이어의 극적인 역전 승리!`
    }];

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'finished',
      result: {
        winner: 'liar_reversal',
        reason: `라이어가 제시어 [${currentGs.word}]을(를) 정확히 맞혔습니다!`,
        liarId: currentGs.liarId,
        word: currentGs.word
      },
      feed: newFeed
    });
  } else {
    playWrong();
    const newFeed = [...(currentGs.feed || []), {
      senderId: 'system',
      senderName: '시스템',
      avatar: '🛡️',
      text: `라이어가 제시어를 맞히지 못했습니다! (입력: ${guessWord} / 정답: ${currentGs.word}) 시민들의 승리!`
    }];

    await update(ref(database, `rooms/${myRoomCode}/gameState`), {
      phase: 'finished',
      result: {
        winner: 'citizen',
        reason: `시민들이 라이어를 잡았고, 라이어의 추리가 빗나갔습니다.`,
        liarId: currentGs.liarId,
        word: currentGs.word
      },
      feed: newFeed
    });
  }
}

function renderResultModal(gs) {
  const result = gs.result || {};
  const isLiar = (gs.liarId === myPlayerId);
  const liarPlayer = playersList[gs.liarId] || { name: '라이어', avatar: '🤫' };

  let iWon = false;
  if (result.winner === 'citizen') {
    iWon = !isLiar;
    resultTrophy.textContent = '🛡️';
    resultWinnerTitle.textContent = '시민 승리!';
    resultWinnerTitle.style.color = '#2ED573';
  } else {
    iWon = isLiar;
    resultTrophy.textContent = '🎭';
    resultWinnerTitle.textContent = result.winner === 'liar_reversal' ? '라이어 역전 승리!' : '라이어 완승!';
    resultWinnerTitle.style.color = '#FF4757';
  }

  if (iWon) playWin();
  else playLose();

  resultSummaryText.innerHTML = `
    <strong>진짜 라이어:</strong> ${liarPlayer.avatar} ${escapeHtml(liarPlayer.name)}<br/>
    <strong>제시어:</strong> <span style="color:#FFD700; font-weight:800;">${escapeHtml(gs.word)}</span><br/><br/>
    ${escapeHtml(result.reason || '')}
  `;

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
      if (room.gameState && room.gameState.votes) {
        updates[`rooms/${myRoomCode}/gameState/votes/${myPlayerId}`] = null;
      }

      if (room.host === myPlayerId) {
        const nextHost = humanPlayerIds[0];
        updates[`rooms/${myRoomCode}/host`] = nextHost;
        updates[`rooms/${myRoomCode}/players/${nextHost}/isHost`] = true;
      }

      // 만약 나간 사람이 라이어였으면 시민 즉시 승리로 처리
      if (currentGs && currentGs.liarId === myPlayerId && currentGs.phase !== 'finished') {
        updates[`rooms/${myRoomCode}/gameState/phase`] = 'finished';
        updates[`rooms/${myRoomCode}/gameState/result`] = {
          winner: 'citizen',
          reason: '라이어가 게임 도중 퇴장하여 시민이 승리하였습니다.',
          word: currentGs.word
        };
      }

      await update(ref(database), updates);
    }
  } catch (err) {
    console.error('라이어 이탈 처리 실패:', err);
  }

  window.location.href = 'index.html';
}

// ─── UI 이벤트 바인딩 ────────────────────────────────
function bindUiEvents() {
  secretCard.addEventListener('click', () => {
    isWordHidden = !isWordHidden;
    secretWord.classList.toggle('hidden', isWordHidden);
  });

  btnSendHint.addEventListener('click', handleSendHint);
  inputHint.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSendHint();
  });

  btnSubmitVote.addEventListener('click', handleSubmitVote);

  btnSubmitGuess.addEventListener('click', () => {
    const guess = inputLiarGuess.value.trim();
    if (!guess) return;
    liarGuessModal.classList.remove('show');
    handleLiarGuessResult(guess);
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
    await initLiarGameState();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
