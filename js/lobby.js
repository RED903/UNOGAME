// ═══════════════════════════════════════════════════
// 로비 로직 (Lobby Logic)
// 방 생성, 입장, 플레이어 목록 관리 및 8종 게임 라우팅
// ═══════════════════════════════════════════════════

import {
  database, ref, set, get, push, onValue, update, remove, off, serverTimestamp
} from './firebase-config.js';
import { playJoinRoom, playError, playButtonClick } from './sound.js';
import { startHoldemRound } from './holdem-init.js';

// 현재 플레이어 상태
let myPlayerId = null;
let myRoomCode = null;
let roomListener = null;

// 프로필 아바타 리스트
const AVATARS = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]; // 최초 접속 시 랜덤 아바타 기본 선택

// 게임별 이름 매핑 상수
const GAME_TYPE_NAMES = {
  yacht: '🎲 야추 다이스 (Yacht Dice)',
  liar: '🤫 라이어 게임 (Liar Game)',
  davinci: '🔢 다빈치 코드 (Da Vinci Code)',
  indian: '🤠 인디언 포커 (Indian Poker)',
  rummikub: '🧩 루미큐브 (Rummikub)',
  uno: '🃏 UNO 카드 게임',
  holdem: '🎰 텍사스 홀덤 포커',
  halligalli: '🔔 할리갈리 (Halli Galli)'
};

// 게임 종류별 진입 URL 생성기
function getGamePageUrl(targetGameType, roomCode, playerId) {
  const routes = {
    yacht: 'yacht.html',
    liar: 'liar.html',
    davinci: 'davinci.html',
    indian: 'indian.html',
    rummikub: 'rummikub.html',
    uno: 'game.html',
    holdem: 'holdem.html',
    halligalli: 'halligalli.html'
  };
  const target = routes[targetGameType] || 'yacht.html';
  return `${target}?room=${roomCode}&player=${playerId}`;
}

// DOM 요소
const screens = {
  main: document.getElementById('screen-main'),
  create: document.getElementById('screen-create'),
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting')
};

// ─── 초기화 ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initLobby();
});

async function initLobby() {
  // 세션에서 플레이어 ID 복원 (새로고침 시 재사용)
  myPlayerId = sessionStorage.getItem('uno_player_id') || generatePlayerId();
  sessionStorage.setItem('uno_player_id', myPlayerId);

  // 아바타 선택기 초기화
  initAvatarSelectors();

  bindEvents();

  // 이미 방에 있었으면 복원 시도
  const savedRoom = sessionStorage.getItem('uno_room_code');
  let rejoined = false;
  if (savedRoom) {
    rejoined = await rejoinRoom(savedRoom);
  }

  // 복원에 성공하지 못한 경우에만 메인 스크린 노출
  if (!rejoined) {
    showScreen('main');
  }
}

function bindEvents() {
  // 로비 전체 버튼 클릭음
  document.querySelector('.lobby-root')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.disabled) playButtonClick();
  });

  // 메인 화면 버튼
  document.getElementById('btn-create')?.addEventListener('click', () => showScreen('create'));
  document.getElementById('btn-join')?.addEventListener('click', () => showScreen('join'));
  document.getElementById('btn-back-create')?.addEventListener('click', () => showScreen('main'));
  document.getElementById('btn-back-join')?.addEventListener('click', () => showScreen('main'));

  // 방 생성
  document.getElementById('btn-do-create')?.addEventListener('click', handleCreateRoom);

  // 방 입장
  document.getElementById('btn-do-join')?.addEventListener('click', handleJoinRoom);
  document.getElementById('input-room-code')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // 게임 시작 (방장만)
  document.getElementById('btn-start')?.addEventListener('click', handleStartGame);

  // 방 나가기
  document.getElementById('btn-leave')?.addEventListener('click', handleLeaveRoom);

  // 대기실 실시간 설정 변경 연동 (방장용)
  document.getElementById('waiting-game-type')?.addEventListener('change', handleWaitingRoomSettingChange);
  document.getElementById('waiting-max-players')?.addEventListener('change', handleWaitingRoomSettingChange);
}

// ─── 대기실 설정 실시간 변경 (방장만) ───────────────────
async function handleWaitingRoomSettingChange() {
  if (!myRoomCode) return;
  const gameTypeSelect = document.getElementById('waiting-game-type');
  const maxPlayersSelect = document.getElementById('waiting-max-players');
  if (!gameTypeSelect || !maxPlayersSelect) return;

  try {
    const roomSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();
    if (room.host !== myPlayerId) return; // 방장만 변경 가능

    const updatedGameType = gameTypeSelect.value;
    const updatedMaxPlayers = parseInt(maxPlayersSelect.value, 10);

    const updates = {
      [`rooms/${myRoomCode}/gameType`]: updatedGameType,
      [`rooms/${myRoomCode}/maxPlayers`]: updatedMaxPlayers
    };
    await update(ref(database), updates);
  } catch (err) {
    console.error("방 설정 업데이트 실패:", err);
  }
}

// ─── 방 생성 ─────────────────────────────────────────

async function handleCreateRoom() {
  const nameInput = document.getElementById('input-create-name');
  const maxPlayersSelect = document.getElementById('select-max-players');
  const name = nameInput.value.trim();
  if (!name) {
    showError('create', '닉네임을 입력해주세요!');
    return;
  }
  if (name.length > 12) {
    showError('create', '닉네임은 12자 이하로 입력해주세요!');
    return;
  }

  const gameTypeSelect = document.getElementById('select-game-type');
  const maxPlayers = parseInt(maxPlayersSelect.value, 10);
  const selectedGameType = gameTypeSelect ? gameTypeSelect.value : 'yacht';
  const roomCode = generateRoomCode();

  setLoading('btn-do-create', true);

  try {
    const roomRef = ref(database, `rooms/${roomCode}`);

    await set(roomRef, {
      host: myPlayerId,
      status: 'waiting',
      maxPlayers,
      gameType: selectedGameType, // 게임 종류 저장
      createdAt: serverTimestamp(),
      players: {
        [myPlayerId]: {
          name,
          ready: true,
          isHost: true,
          avatar: selectedAvatar,
          joinedAt: serverTimestamp()
        }
      }
    });

    myRoomCode = roomCode;
    sessionStorage.setItem('uno_room_code', roomCode);
    sessionStorage.setItem('uno_player_name', name);

    listenToRoom(roomCode);
    showScreen('waiting');
    playJoinRoom();

  } catch (err) {
    console.error('방 생성 실패:', err);
    showError('create', 'Firebase 연결에 실패했습니다. 설정을 확인해주세요.');
  } finally {
    setLoading('btn-do-create', false);
  }
}

// ─── 방 입장 ─────────────────────────────────────────

async function handleJoinRoom() {
  const nameInput = document.getElementById('input-join-name');
  const codeInput = document.getElementById('input-room-code');

  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();

  if (!name) { showError('join', '닉네임을 입력해주세요!'); return; }
  if (name.length > 12) { showError('join', '닉네임은 12자 이하입니다!'); return; }
  if (code.length !== 6) { showError('join', '방 코드는 6자리입니다!'); return; }

  setLoading('btn-do-join', true);

  try {
    const roomRef = ref(database, `rooms/${code}`);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) {
      showError('join', '존재하지 않는 방 코드입니다!');
      setLoading('btn-do-join', false);
      playError();
      return;
    }

    const room = snapshot.val();

    if (room.status !== 'waiting') {
      showError('join', '이미 게임이 진행 중인 방입니다!');
      setLoading('btn-do-join', false);
      playError();
      return;
    }

    const currentPlayers = Object.keys(room.players || {}).length;
    if (currentPlayers >= room.maxPlayers) {
      showError('join', '방이 가득 찼습니다!');
      setLoading('btn-do-join', false);
      playError();
      return;
    }

    // 플레이어 추가 (아바타 포함)
    await update(ref(database, `rooms/${code}/players/${myPlayerId}`), {
      name,
      ready: true,
      isHost: false,
      avatar: selectedAvatar,
      joinedAt: serverTimestamp()
    });

    myRoomCode = code;
    sessionStorage.setItem('uno_room_code', code);
    sessionStorage.setItem('uno_player_name', name);

    listenToRoom(code);
    showScreen('waiting');
    playJoinRoom();

  } catch (err) {
    console.error('방 입장 실패:', err);
    showError('join', '연결 실패. Firebase 설정을 확인해주세요.');
  } finally {
    setLoading('btn-do-join', false);
  }
}

// ─── 방 나가기 (대기실에서 나갈 때) ───────────────────

async function handleLeaveRoom() {
  if (!myRoomCode) return;

  try {
    const roomRef = ref(database, `rooms/${myRoomCode}`);
    const snapshot = await get(roomRef);

    if (snapshot.exists()) {
      const room = snapshot.val();
      const players = room.players || {};
      const remainingHumanIds = Object.keys(players).filter(id => id !== myPlayerId && !id.startsWith('bot_'));

      if (room.host === myPlayerId) {
        if (remainingHumanIds.length > 0) {
          // 남은 사람 중 다음 사람에게 방장 권한 위임
          const nextHostId = remainingHumanIds[0];
          await update(ref(database), {
            [`rooms/${myRoomCode}/host`]: nextHostId,
            [`rooms/${myRoomCode}/players/${nextHostId}/isHost`]: true,
            [`rooms/${myRoomCode}/players/${myPlayerId}`]: null
          });
        } else {
          // 남은 유저가 없으면 방 폭파
          await remove(roomRef);
        }
      } else {
        // 일반 플레이어는 자신만 제거
        await remove(ref(database, `rooms/${myRoomCode}/players/${myPlayerId}`));
      }
    }
  } catch (err) {
    console.error('방 나가기 실패:', err);
  }

  cleanupRoom();
  showScreen('main');
}

// ─── 게임 시작 ───────────────────────────────────────

async function handleStartGame() {
  if (!myRoomCode) return;

  const snapshot = await get(ref(database, `rooms/${myRoomCode}`));
  if (!snapshot.exists()) return;

  const room = snapshot.val();
  const currentGameType = room.gameType || 'yacht';
  let playerIds = Object.keys(room.players || {});

  // 만약 방에 방장 혼자만 있다면 컴퓨터(봇)를 인원수에 맞춰서 자동 투입
  if (playerIds.length === 1) {
    const botNames = [
      { name: '알파 주사위 🤖', avatar: '🤖' },
      { name: '승부사 냥이 🐱', avatar: '🐱' },
      { name: '천재 댕댕이 🐶', avatar: '🐶' },
      { name: '블러핑 여우 🦊', avatar: '🦊' },
      { name: '타일 마스터 🧩', avatar: '🧩' },
      { name: '행운의 팬더 🐼', avatar: '🐼' }
    ];
    
    // 최대 인원에 맞춰 적절한 봇 수 배치
    const targetCount = Math.min(room.maxPlayers || 4, (currentGameType === 'davinci' || currentGameType === 'indian' ? 2 : 4));
    const autoBotsCount = Math.max(1, targetCount - 1);
    const updates = {};
    
    for (let i = 0; i < autoBotsCount; i++) {
      const botId = `bot_${i + 1}_${Math.random().toString(36).substr(2, 5)}`;
      const botInfo = botNames[i % botNames.length];
      
      updates[`rooms/${myRoomCode}/players/${botId}`] = {
        name: botInfo.name,
        ready: true,
        isHost: false,
        avatar: botInfo.avatar,
        isBot: true,
        joinedAt: serverTimestamp()
      };
    }
    
    showToast('컴퓨터 플레이어가 참가했습니다! 봇전을 시작합니다.', 2000);
    await update(ref(database), updates);

    const refreshed = await get(ref(database, `rooms/${myRoomCode}`));
    if (refreshed.exists()) {
      room.players = refreshed.val().players || room.players;
      playerIds = Object.keys(room.players);
    }
  }

  // 홀덤 포커일 경우 첫 라운드 데이터 초기화
  if (currentGameType === 'holdem') {
    await remove(ref(database, `rooms/${myRoomCode}/hands`));
    await remove(ref(database, `rooms/${myRoomCode}/gameState`));

    const latestSnap = await get(ref(database, `rooms/${myRoomCode}`));
    if (latestSnap.exists()) {
      const latestRoom = latestSnap.val();
      const ok = await startHoldemRound(myRoomCode, latestRoom);
      if (!ok) {
        showToast('플레이어가 부족합니다. 잠시 후 다시 시도해주세요.', 2500);
        return;
      }
    }
  } else {
    // 다른 게임들도 이전 잔여 gameState가 남아있다면 초기화
    await remove(ref(database, `rooms/${myRoomCode}/gameState`));
  }

  // 방 상태를 'playing'으로 변경 -> 리스너를 통해 모든 유저가 게임 화면으로 이동
  await update(ref(database, `rooms/${myRoomCode}`), {
    status: 'playing',
    startedAt: serverTimestamp()
  });
}

// ─── 방 상태 리스닝 ──────────────────────────────────

function listenToRoom(roomCode) {
  if (roomListener && myRoomCode) {
    off(ref(database, `rooms/${myRoomCode}`), roomListener);
  }

  const roomRef = ref(database, `rooms/${roomCode}`);
  roomListener = onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      // 방이 삭제됨 (방장이 나감)
      cleanupRoom();
      showScreen('main');
      showToast('방장이 방을 닫았습니다.');
      return;
    }

    const room = snapshot.val();

    // 게임 시작 시 gameType에 따라 적절한 페이지로 이동
    if (room.status === 'playing') {
      const activeGameType = room.gameType || 'yacht';
      window.location.href = getGamePageUrl(activeGameType, roomCode, myPlayerId);
      return;
    }

    // 대기실 UI 업데이트
    updateWaitingRoom(room, roomCode);
  });
}

function updateWaitingRoom(room, roomCode) {
  // 방 코드 표시
  const codeEl = document.getElementById('display-room-code');
  if (codeEl) codeEl.textContent = roomCode;

  // 게임 종류 배지 업데이트
  const badgeEl = document.getElementById('game-type-badge');
  if (badgeEl) {
    const roomGameType = room.gameType || 'yacht';
    badgeEl.textContent = GAME_TYPE_NAMES[roomGameType] || '🎲 야추 다이스';
    badgeEl.style.display = 'block';
  }

  // 실시간 대기실 설정 박스 업데이트
  const isHost = room.host === myPlayerId;
  const waitingGameTypeSelect = document.getElementById('waiting-game-type');
  const waitingMaxPlayersSelect = document.getElementById('waiting-max-players');

  if (waitingGameTypeSelect) {
    waitingGameTypeSelect.value = room.gameType || 'yacht';
    waitingGameTypeSelect.disabled = !isHost; // 방장만 조작 가능
  }
  if (waitingMaxPlayersSelect) {
    waitingMaxPlayersSelect.value = String(room.maxPlayers || 4);
    waitingMaxPlayersSelect.disabled = !isHost; // 방장만 조작 가능
  }

  // 플레이어 목록 업데이트
  const listEl = document.getElementById('player-list');
  if (!listEl) return;

  const players = room.players || {};
  // 방장이 무조건 맨 위에 오도록 플레이어 배치 순서 정렬
  const hostId = room.host;
  const sortedPlayerIds = [hostId, ...Object.keys(players).filter(id => id !== hostId)];
  const playerEntries = sortedPlayerIds
    .map(id => [id, players[id]])
    .filter(([id, player]) => player !== undefined);

  listEl.innerHTML = playerEntries.map(([id, player]) => `
    <div class="player-item ${id === myPlayerId ? 'me' : ''} ${id === room.host ? 'host' : ''}">
      <span class="player-avatar">${player.avatar || getAvatar(player.name)}</span>
      <span class="player-name">${escapeHtml(player.name)}</span>
      <span class="player-badges">
        ${id === room.host ? '<span class="badge badge-host">방장</span>' : ''}
        ${id === myPlayerId ? '<span class="badge badge-me">나</span>' : ''}
      </span>
    </div>
  `).join('');

  // 인원 수 표시
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${playerEntries.length} / ${room.maxPlayers}명`;

  // 시작 버튼 (방장만 표시)
  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    startBtn.style.display = isHost ? 'block' : 'none';
    if (playerEntries.length === 1) {
      startBtn.disabled = false;
      startBtn.textContent = `🤖 컴퓨터와 대결 시작!`;
    } else {
      startBtn.disabled = false;
      startBtn.textContent = `🎮 게임 시작! (${playerEntries.length}명)`;
    }
  }
}

// ─── 재입장 처리 (새로고침 및 게임 종료 후 대기실 복귀) ──────

async function rejoinRoom(roomCode) {
  try {
    const snapshot = await get(ref(database, `rooms/${roomCode}`));
    if (!snapshot.exists()) {
      sessionStorage.removeItem('uno_room_code');
      return false;
    }

    const room = snapshot.val();
    const players = room.players || {};

    // 내가 플레이어 목록에 존재하지 않으면 세션 정리 후 메인으로
    if (!players[myPlayerId]) {
      sessionStorage.removeItem('uno_room_code');
      return false;
    }

    // [★ 핵심 수정: 대기실 복귀 버그 방지]
    // 만약 방 상태가 playing이더라도 게임 상태가 이미 끝났거나 비어있는 경우
    // 누군가 먼저 대기실로 복귀했으므로 방 상태를 waiting으로 동기화하고 대기실로 안전 진입!
    const gs = room.gameState;
    const isGameFinished = !gs || gs.phase === 'finished' || gs.status === 'finished';

    if (room.status === 'waiting' || isGameFinished) {
      myRoomCode = roomCode;
      if (room.status !== 'waiting') {
        // 방 상태를 waiting으로 정상 동기화
        await update(ref(database, `rooms/${roomCode}`), {
          status: 'waiting',
          gameState: null
        });
      }
      listenToRoom(roomCode);
      showScreen('waiting');
      return true;
    }

    // 실제로 게임이 여전히 진행 중인 상태에서만 게임 화면으로 복구
    if (room.status === 'playing') {
      const rejoiningGameType = room.gameType || 'yacht';
      window.location.href = getGamePageUrl(rejoiningGameType, roomCode, myPlayerId);
      return true;
    }

    return false;
  } catch (err) {
    console.error('방 복원 에러:', err);
    sessionStorage.removeItem('uno_room_code');
    return false;
  }
}

// ─── 유틸리티 ────────────────────────────────────────

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 12);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getAvatar(name) {
  const emojis = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
  const idx = (name || '').charCodeAt(0) % emojis.length;
  return emojis[idx] || '🎮';
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showScreen(name) {
  Object.values(screens).forEach(el => { if (el) el.style.display = 'none'; });
  if (screens[name]) screens[name].style.display = 'flex';
}

function showError(screen, message) {
  const el = document.getElementById(`error-${screen}`);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }
  playError();
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? '⏳ 연결 중...' : btn.dataset.originalText;
  }
}

function cleanupRoom() {
  myRoomCode = null;
  sessionStorage.removeItem('uno_room_code');
  if (roomListener) {
    roomListener = null;
  }
}

/** 아바타 선택기 UI 초기화 및 동기화 */
function initAvatarSelectors() {
  const savedAvatar = sessionStorage.getItem('uno_player_avatar');
  if (savedAvatar && AVATARS.includes(savedAvatar)) {
    selectedAvatar = savedAvatar;
  } else {
    sessionStorage.setItem('uno_player_avatar', selectedAvatar);
  }

  ['create', 'join'].forEach(mode => {
    const grid = document.getElementById(`${mode}-avatar-grid`);
    if (!grid) return;

    grid.innerHTML = AVATARS.map(avatar => `
      <button type="button" class="avatar-select-btn ${avatar === selectedAvatar ? 'selected' : ''}" data-avatar="${avatar}">
        ${avatar}
      </button>
    `).join('');

    grid.querySelectorAll('.avatar-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.avatar-select-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAvatar = btn.dataset.avatar;
        sessionStorage.setItem('uno_player_avatar', selectedAvatar);

        const otherMode = mode === 'create' ? 'join' : 'create';
        const otherGrid = document.getElementById(`${otherMode}-avatar-grid`);
        if (otherGrid) {
          otherGrid.querySelectorAll('.avatar-select-btn').forEach(b => {
            b.classList.toggle('selected', b.dataset.avatar === selectedAvatar);
          });
        }
      });
    });
  });
}
