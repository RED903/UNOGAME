// ═══════════════════════════════════════════════════
// 로비 로직
// 방 생성, 입장, 플레이어 목록 관리
// ═══════════════════════════════════════════════════

import {
  database, ref, set, get, push, onValue, update, remove, off, serverTimestamp
} from './firebase-config.js';
import { playJoinRoom, playError } from './sound.js';

// 현재 플레이어 상태
let myPlayerId = null;
let myRoomCode = null;
let roomListener = null;

// 프로필 아바타 리스트
const AVATARS = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
let selectedAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]; // 최초 접속 시 랜덤 아바타 기본 선택

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
  // 메인 화면 버튼
  document.getElementById('btn-create').addEventListener('click', () => showScreen('create'));
  document.getElementById('btn-join').addEventListener('click', () => showScreen('join'));
  document.getElementById('btn-back-create').addEventListener('click', () => showScreen('main'));
  document.getElementById('btn-back-join').addEventListener('click', () => showScreen('main'));

  // 방 생성
  document.getElementById('btn-do-create').addEventListener('click', handleCreateRoom);

  // 방 입장
  document.getElementById('btn-do-join').addEventListener('click', handleJoinRoom);
  document.getElementById('input-room-code').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') handleJoinRoom();
    // 대문자 자동 변환
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // 게임 시작 (방장만)
  document.getElementById('btn-start').addEventListener('click', handleStartGame);

  // 방 나가기
  document.getElementById('btn-leave').addEventListener('click', handleLeaveRoom);
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

  const maxPlayers = parseInt(maxPlayersSelect.value);
  const roomCode = generateRoomCode();

  setLoading('btn-do-create', true);

  try {
    const roomRef = ref(database, `rooms/${roomCode}`);

    await set(roomRef, {
      host: myPlayerId,
      status: 'waiting',
      maxPlayers,
      createdAt: serverTimestamp(),
      players: {
        [myPlayerId]: {
          name,
          ready: true,
          isHost: true,
          avatar: selectedAvatar, // 프로필 아바타 추가
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
      showError('join', '이미 게임이 시작된 방입니다!');
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

// ─── 방 나가기 ───────────────────────────────────────

async function handleLeaveRoom() {
  if (!myRoomCode) return;

  try {
    const roomRef = ref(database, `rooms/${myRoomCode}`);
    const snapshot = await get(roomRef);

    if (snapshot.exists()) {
      const room = snapshot.val();

      if (room.host === myPlayerId) {
        // 방장이 나가면 방 삭제
        await remove(roomRef);
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
  const playerIds = Object.keys(room.players || {});

  // 만약 방에 방장 혼자만 있다면 컴퓨터(봇)를 인원수에 맞춰서 자동 투입
  if (playerIds.length === 1) {
    const botNames = [
      { name: '스마트 봇 🤖', avatar: '🤖' },
      { name: '우노 천재 👾', avatar: '👾' },
      { name: '눈치 빠른 AI 🧠', avatar: '🧠' },
      { name: '행운의 알파고 🛸', avatar: '🛸' },
      { name: '카드 카운터 🧮', avatar: '🧮' }
    ];
    
    // 최대 참가자 수(기본값 포함)까지 봇을 자동 생성하여 투입
    const maxBots = Math.min(room.maxPlayers || 4, 4) - 1; // 기본적으로 유저 1명 + 봇 3마리 = 총 4인 게임 선호
    const updates = {};
    
    for (let i = 0; i < maxBots; i++) {
      const botId = `bot_${i + 1}_${Math.random().toString(36).substr(2, 5)}`;
      const botInfo = botNames[i % botNames.length];
      
      updates[`rooms/${myRoomCode}/players/${botId}`] = {
        name: botInfo.name,
        ready: true,
        isHost: false,
        avatar: botInfo.avatar,
        isBot: true, // 봇 플래그
        joinedAt: serverTimestamp()
      };
    }
    
    showToast('컴퓨터 플레이어가 참가했습니다! 봇전을 시작합니다.', 2000);
    await update(ref(database), updates);
  }

  // 방 상태를 'playing'으로 변경 → 모든 클라이언트가 game.html로 이동
  await update(ref(database, `rooms/${myRoomCode}`), {
    status: 'playing',
    startedAt: serverTimestamp()
  });
}

// ─── 방 상태 리스닝 ──────────────────────────────────

function listenToRoom(roomCode) {
  // 기존 리스너 정리
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

    // 게임 시작 시 game.html로 이동
    if (room.status === 'playing') {
      window.location.href = `game.html?room=${roomCode}&player=${myPlayerId}`;
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
    const isHost = room.host === myPlayerId;
    startBtn.style.display = isHost ? 'block' : 'none';
    
    if (playerEntries.length === 1) {
      // 혼자 있을 때도 컴퓨터와 봇전을 시작할 수 있도록 허용!
      startBtn.disabled = false;
      startBtn.textContent = `🤖 컴퓨터와 대결 시작!`;
    } else {
      // 2명 이상인 멀티플레이어
      startBtn.disabled = false;
      startBtn.textContent = `🎮 게임 시작! (${playerEntries.length}명)`;
    }
  }
}

// ─── 재입장 처리 ─────────────────────────────────────

async function rejoinRoom(roomCode) {
  try {
    const snapshot = await get(ref(database, `rooms/${roomCode}`));
    if (!snapshot.exists()) {
      sessionStorage.removeItem('uno_room_code');
      return false;
    }

    const room = snapshot.val();

    // 이미 게임 중이면 바로 game.html로
    if (room.status === 'playing') {
      const players = room.players || {};
      if (players[myPlayerId]) {
        window.location.href = `game.html?room=${roomCode}&player=${myPlayerId}`;
        return true;
      }
    }

    // 대기실이면 복원
    if (room.status === 'waiting' && room.players?.[myPlayerId]) {
      myRoomCode = roomCode;
      listenToRoom(roomCode);
      showScreen('waiting');
      return true;
    } else {
      sessionStorage.removeItem('uno_room_code');
      return false;
    }
  } catch (err) {
    sessionStorage.removeItem('uno_room_code');
    return false;
  }
}

// ─── 유틸리티 ────────────────────────────────────────

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 12);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동되는 문자 제외
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getAvatar(name) {
  // 이름 첫 글자를 이모지 스타일로
  const emojis = ['🦊', '🐱', '🐶', '🐻', '🐼', '🦁', '🐯', '🦝', '🐺', '🦄', '🐸', '🐙'];
  const idx = name.charCodeAt(0) % emojis.length;
  return emojis[idx];
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
    // 리스너 제거
    roomListener = null;
  }
}

/** 아바타 선택기 UI 초기화 및 동기화 */
function initAvatarSelectors() {
  // 이전 세션에서 저장된 아바타 있으면 복원
  const savedAvatar = sessionStorage.getItem('uno_player_avatar');
  if (savedAvatar && AVATARS.includes(savedAvatar)) {
    selectedAvatar = savedAvatar;
  } else {
    // 기본값 지정
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
        // 모든 아바타 버튼에서 selected 제거
        grid.querySelectorAll('.avatar-select-btn').forEach(b => b.classList.remove('selected'));
        // 이 버튼만 selected 추가
        btn.classList.add('selected');
        selectedAvatar = btn.dataset.avatar;
        sessionStorage.setItem('uno_player_avatar', selectedAvatar);

        // 반대편 모드 아바타 그리드도 연계 동기화 (방만들기 ↔ 방참가)
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
