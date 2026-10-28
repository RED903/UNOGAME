// ─── LIAR BUNDLE (Non-module Standalone) ───
(function() {

// ─── [번들 내장] 로컬 모의 DB 엔진 ───
const __LOCAL_KEY = 'uno_local_mock_db_v1';
let __mockStore = {};
try {
  const saved = localStorage.getItem(__LOCAL_KEY);
  if (saved) __mockStore = JSON.parse(saved);
} catch (e) {}

let __bc = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    __bc = new BroadcastChannel('uno_local_db_channel');
    __bc.onmessage = (e) => {
      if (e.data && e.data.type === 'SYNC') {
        __mockStore = e.data.store || {};
        __triggerListeners();
      }
    };
  } catch(e) {}
}

function __syncStore() {
  try { localStorage.setItem(__LOCAL_KEY, JSON.stringify(__mockStore)); } catch(e) {}
  if (__bc) {
    try { __bc.postMessage({ type: 'SYNC', store: __mockStore }); } catch(e) {}
  }
}

const __listeners = [];
function __triggerListeners() {
  __listeners.forEach(l => {
    try {
      const val = __getPathVal(__mockStore, l.path);
      l.callback({
        key: l.path ? l.path.split('/').pop() : null,
        exists: () => val !== null && val !== undefined,
        val: () => __deepClone(val)
      });
    } catch(e) {}
  });
}

function __deepClone(v) {
  if (v === null || v === undefined) return v;
  try { return JSON.parse(JSON.stringify(v)); } catch(e) { return v; }
}
function __normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function __getPathVal(root, path) {
  const n = __normPath(path);
  if (!n) return __deepClone(root);
  const parts = n.split('/');
  let cur = root;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || !(p in cur)) return null;
    cur = cur[p];
  }
  return __deepClone(cur);
}
function __setPathVal(root, path, val) {
  const n = __normPath(path);
  if (!n) {
    for (const k in root) delete root[k];
    if (val && typeof val === 'object') Object.assign(root, __deepClone(val));
    return;
  }
  const parts = n.split('/');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (val === null || val === undefined) {
    delete cur[last];
  } else {
    cur[last] = __deepClone(val);
  }
}

const database = { _isLocalBundle: true };
function ref(db, path = '') { return { path: __normPath(path), key: __normPath(path).split('/').pop() }; }
function get(r) {
  return Promise.resolve({
    key: r.key,
    exists: () => __getPathVal(__mockStore, r.path) !== null,
    val: () => __getPathVal(__mockStore, r.path)
  });
}
function set(r, val) {
  __setPathVal(__mockStore, r.path, val);
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function update(r, updates) {
  const base = r && r.path ? r.path : '';
  for (const [k, v] of Object.entries(updates || {})) {
    const target = base ? (k.startsWith('/') ? k : `${base}/${k}`) : k;
    __setPathVal(__mockStore, target, v);
  }
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function remove(r) {
  __setPathVal(__mockStore, r.path, null);
  __syncStore();
  __triggerListeners();
  return Promise.resolve();
}
function push(r, val) {
  const autoKey = '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  const childPath = r.path ? `${r.path}/${autoKey}` : autoKey;
  const childRef = { path: childPath, key: autoKey };
  if (val !== undefined) set(childRef, val);
  return childRef;
}
function onValue(r, cb) {
  const entry = { path: r.path, callback: cb };
  __listeners.push(entry);
  setTimeout(() => {
    const val = __getPathVal(__mockStore, r.path);
    cb({
      key: r.key,
      exists: () => val !== null && val !== undefined,
      val: () => __deepClone(val)
    });
  }, 0);
  return () => {
    const idx = __listeners.indexOf(entry);
    if (idx !== -1) __listeners.splice(idx, 1);
  };
}
function off(r, cb) {
  for (let i = __listeners.length - 1; i >= 0; i--) {
    if (__listeners[i].path === r.path) {
      if (!cb || __listeners[i].callback === cb) __listeners.splice(i, 1);
    }
  }
}
function serverTimestamp() { return Date.now(); }
function runTransaction(r, fn) {
  const cur = __getPathVal(__mockStore, r.path);
  const n = fn(__deepClone(cur));
  if (n !== undefined) set(r, n);
  return Promise.resolve({ committed: true, snapshot: { val: () => __getPathVal(__mockStore, r.path) } });
}


// ─── Dependency: sound.js ───

// ═══════════════════════════════════════════════════
// Web Audio API 기반 효과음 시스템
// 외부 파일 없이 프로그래밍 방식으로 고품질 효과음 생성
// ═══════════════════════════════════════════════════

let audioCtx = null;

// AudioContext 지연 초기화 (사용자 상호작용 후)
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * 기본 음 생성 헬퍼
 * @param {number} frequency - Hz
 * @param {number} duration - 초
 * @param {string} type - 'sine' | 'square' | 'sawtooth' | 'triangle'
 * @param {number} volume - 0~1
 * @param {number} delay - 지연 시작 (초)
 */
function playTone(frequency, duration, type = 'sine', volume = 0.3, delay = 0) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime + delay);

    // 부드러운 페이드 인/아웃
    gainNode.gain.setValueAtTime(0, ctx.currentTime + delay);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);
  } catch (e) {
    // 오디오 미지원 브라우저 대비 무시
  }
}

// ─── 기본 및 공통 효과음 ─────────────────────────────

/** 카드 내려놓기 */
function playCardPlay() {
  playTone(440, 0.08, 'triangle', 0.2);
  playTone(660, 0.12, 'triangle', 0.15, 0.05);
}

/** 카드 뽑기 */
function playCardDraw() {
  playTone(300, 0.1, 'sawtooth', 0.1);
  playTone(250, 0.1, 'sawtooth', 0.08, 0.08);
}

/** 내 차례 알림 */
function playMyTurn() {
  playTone(523, 0.1, 'sine', 0.25);      // C5
  playTone(659, 0.1, 'sine', 0.25, 0.12); // E5
  playTone(784, 0.2, 'sine', 0.3, 0.24);  // G5
}

/** UNO 선언 */
function playUnoCall() {
  playTone(880, 0.08, 'square', 0.3);
  playTone(1100, 0.08, 'square', 0.3, 0.1);
  playTone(880, 0.15, 'square', 0.35, 0.2);
}

/** 승리 팡파레 */
function playWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    playTone(freq, 0.3, 'sine', 0.3, i * 0.15);
  });
}

/** 패배 */
function playLose() {
  playTone(400, 0.2, 'sawtooth', 0.2);
  playTone(320, 0.2, 'sawtooth', 0.2, 0.2);
  playTone(240, 0.4, 'sawtooth', 0.2, 0.4);
}

/** 와일드 카드 */
function playWild() {
  const colors = [330, 392, 440, 494];
  colors.forEach((freq, i) => {
    playTone(freq, 0.08, 'triangle', 0.2, i * 0.06);
  });
}

/** Draw Two / Wild Draw Four */
function playDrawPenalty() {
  playTone(200, 0.15, 'square', 0.25);
  playTone(180, 0.15, 'square', 0.25, 0.15);
  playTone(160, 0.2, 'square', 0.2, 0.3);
}

/** 방 입장 */
function playJoinRoom() {
  playTone(440, 0.1, 'sine', 0.2);
  playTone(550, 0.15, 'sine', 0.25, 0.1);
}

/** 오류/유효하지 않음 */
function playError() {
  playTone(150, 0.1, 'square', 0.2);
  playTone(130, 0.15, 'square', 0.2, 0.1);
}

/** 채팅 메시지 */
function playChat() {
  playTone(880, 0.05, 'sine', 0.15);
}

/** 버튼 클릭 */
function playButtonClick() {
  playTone(520, 0.04, 'sine', 0.18);
  playTone(780, 0.05, 'sine', 0.14, 0.03);
}

/** 할리갈리 종소리 */
function playBell() {
  playTone(987.77, 0.4, 'sine', 0.35); // B5
  playTone(1318.51, 0.5, 'sine', 0.25, 0.02); // E6
  playTone(1975.53, 0.6, 'sine', 0.15, 0.04); // B6
  playTone(2637.02, 0.7, 'triangle', 0.1, 0.06); // E7
}

// ─── 신규 게임 전용 효과음 ──────────────────────────

/** 주사위 굴리는 소리 (야추 다이스) */
function playDiceRoll() {
  const delays = [0, 0.04, 0.08, 0.13, 0.19, 0.26, 0.35];
  delays.forEach((d, i) => {
    const freq = 200 + Math.random() * 260;
    playTone(freq, 0.05, 'triangle', 0.22 - (i * 0.02), d);
  });
}

/** 주사위 홀드 / 고정 토글 소리 (야추 다이스) */
function playDiceHold() {
  playTone(620, 0.06, 'sine', 0.2);
  playTone(830, 0.08, 'sine', 0.25, 0.04);
}

/** 칩 짤랑거리는 베팅 소리 (인디언 포커) */
function playChips() {
  playTone(1200, 0.04, 'triangle', 0.18);
  playTone(1500, 0.05, 'triangle', 0.15, 0.03);
  playTone(950, 0.06, 'triangle', 0.12, 0.07);
}

/** 타일 내려놓기 / 딸깍 소리 (다빈치 코드 & 루미큐브) */
function playTilePlace() {
  playTone(380, 0.05, 'triangle', 0.25);
  playTone(520, 0.04, 'sine', 0.15, 0.02);
}

/** 추리 성공 / 정답 소리 (다빈치 코드 & 라이어 게임) */
function playCorrect() {
  playTone(587.33, 0.12, 'sine', 0.25); // D5
  playTone(880, 0.2, 'sine', 0.3, 0.1);  // A5
  playTone(1174.66, 0.35, 'triangle', 0.35, 0.2); // D6
}

/** 추리 실패 / 오답 소리 */
function playWrong() {
  playTone(220, 0.15, 'sawtooth', 0.25);
  playTone(174.61, 0.25, 'sawtooth', 0.25, 0.12);
}

/** 투표 제출 소리 (라이어 게임) */
function playVote() {
  playTone(440, 0.08, 'sine', 0.2);
  playTone(659.25, 0.12, 'sine', 0.25, 0.07);
}


// ─── Dependency: liar-words.js ───

/**
 * 라이어 게임 (Liar Game) 단어 사전 및 봇 힌트 데이터
 * 한국어 주석 필수
 */

const WORD_DATABASE = [
  // 1. 음식
  {
    category: '음식 (Food)',
    words: [
      { word: '피자', hints: ['치즈가 듬뿍 들어가서 맛있어요', '동그랗고 조각내서 먹어요', '배달 음식으로 아주 인기가 많죠'] },
      { word: '치킨', hints: ['바삭바삭 튀겨서 맥주랑 잘 어울려요', '양념과 후라이드가 대표적이에요', '야식 메뉴 1순위예요'] },
      { word: '떡볶이', hints: ['매콤달콤한 빨간 양념이 특징이에요', '어묵과 떡이 쫄깃해요', '분식집에서 튀김이랑 순대랑 같이 먹어요'] },
      { word: '삼겹살', hints: ['불판에 구워 쌈장에 찍어 먹어요', '회식 메뉴로 정말 자주 먹어요', '김치랑 마늘을 같이 구워 먹으면 최고예요'] },
      { word: '라면', hints: ['물이 끓으면 3~4분 만에 완성돼요', '계란이나 파를 넣으면 더 맛있어요', '밤에 냄새 맡으면 참기 힘들어요'] },
      { word: '초밥', hints: ['밥 위에 신선한 생선이 올라가요', '와사비와 간장에 찍어 먹어요', '일본 전통 요리 중 하나예요'] },
      { word: '짜장면', hints: ['검은색 춘장 소스를 비벼 먹어요', '단무지와 함께 이삿날에 자주 먹죠', '양파와 고기가 들어가요'] }
    ]
  },
  // 2. 동물
  {
    category: '동물 (Animal)',
    words: [
      { word: '호랑이', hints: ['용맹한 줄무늬가 몸 전체에 있어요', '산속의 제왕이라고 불려요', '고양잇과 맹수예요'] },
      { word: '펭귄', hints: ['남극의 얼음 위에서 뒤뚱뒤뚱 걸어요', '날지 못하지만 수영을 엄청 잘해요', '검은색과 흰색 턱시도를 입은 것 같아요'] },
      { word: '강아지', hints: ['사람의 가장 친한 반려동물이에요', '산책과 꼬리 흔들기를 좋아해요', '멍멍 소리를 내요'] },
      { word: '고양이', hints: ['조용하게 발걸음을 옮기고 높은 곳을 좋아해요', '가끔 골골송을 부르며 애교를 부려요', '생선과 츄르를 아주 좋아해요'] },
      { word: '팬더', hints: ['대나무를 하루 종일 맛있게 먹어요', '눈 주위에 검은 테두리가 있어요', '뒹굴뒹굴 구르는 모습이 귀여워요'] },
      { word: '코끼리', hints: ['코가 손처럼 길고 자유자재로 움직여요', '귀가 아주 크고 몸집이 거대해요', '아프리카나 아시아 초원에 살아요'] }
    ]
  },
  // 3. 전자기기
  {
    category: '전자기기 (Tech)',
    words: [
      { word: '스마트폰', hints: ['하루 종일 손에서 놓지 못해요', '전화뿐만 아니라 영상, 게임도 다 돼요', '액정보호필름을 붙여서 써요'] },
      { word: '노트북', hints: ['접어서 가방에 넣고 카페에서 작업해요', '화면과 키보드가 하나로 합쳐져 있어요', '배터리를 충전해서 씁니다'] },
      { word: '이어폰', hints: ['귀에 꽂아서 음악을 들어요', '요즘은 선이 없는 무선 제품이 대세예요', '노이즈 캔슬링 기능이 유명하죠'] },
      { word: '냉장고', hints: ['음식이 상하지 않게 차갑게 보관해요', '문을 열면 불이 켜져요', '냉동실에는 얼음과 아이스크림이 있어요'] },
      { word: '에어컨', hints: ['무더운 여름철에 실내를 시원하게 만들어줘요', '리모컨으로 온도를 맞춰요', '필터 청소를 주기적으로 해줘야 해요'] }
    ]
  },
  // 4. 영화 & 엔터테인먼트
  {
    category: '영화/문화 (Culture)',
    words: [
      { word: '영화관', hints: ['팝콘과 콜라를 들고 큰 스크린을 봐요', '좌석이 어두워지면 상영이 시작돼요', '티켓을 예매해서 친구나 연인과 가요'] },
      { word: '노래방', hints: ['마이크를 잡고 신나게 소리 지르며 노래해요', '탬버린을 흔들며 점수 대결을 해요', '리모컨으로 번호를 입력해 곡을 찾아요'] },
      { word: '놀이공원', hints: ['롤러코스터와 바이킹을 타며 소리 질러요', '머리띠를 쓰고 츄러스를 사 먹어요', '밤에는 퍼레이드와 불꽃놀이를 해요'] }
    ]
  },
  // 5. 학용품 & 일상도구
  {
    category: '일상용품 (Daily Goods)',
    words: [
      { word: '우산', hints: ['비나 눈이 올 때 펼쳐서 써요', '사용 후에는 잘 말려 접어둬요', '갑자기 소나기가 오면 편의점에서 사요'] },
      { word: '시계', hints: ['손목에 차거나 벽에 걸어둬요', '시간과 분을 알려주는 바늘이나 숫자가 있어요', '약속 시간을 지키기 위해 확인해요'] },
      { word: '안경', hints: ['시력이 나쁜 사람이 코와 귀에 걸쳐 써요', '렌즈를 안경 닦이로 깨끗이 닦아요', '패션 아이템으로도 많이 쓰여요'] },
      { word: '가위', hints: ['두 개의 날로 종이나 옷감을 잘라요', '손가락 두 개를 끼우고 싹둑싹둑 움직여요', '조심히 다루지 않으면 손을 벨 수 있어요'] }
    ]
  }
];

/**
 * 무작위 카테고리와 제시어 1개 뽑기
 */
function getRandomWordEntry() {
  const cat = WORD_DATABASE[Math.floor(Math.random() * WORD_DATABASE.length)];
  const item = cat.words[Math.floor(Math.random() * cat.words.length)];
  return {
    category: cat.category,
    word: item.word,
    hints: item.hints
  };
}

/**
 * 봇이 라이어일 때 둘러대는 일반적/모호한 힌트 대사 모음
 */
const LIAR_BLUFF_HINTS = [
  '누구나 일상에서 한 번쯤은 자주 접해봤을 법해요.',
  '개인적으로 꽤 좋아하는 편이고 매력적인 것 같아요.',
  '상황이나 사람의 취향에 따라 호불호가 조금 갈릴 수도 있어요.',
  '주변에서 어렵지 않게 찾아볼 수 있는 친숙한 느낌이에요.',
  '이걸 접할 때면 꽤 기분이 좋아지는 편입니다.',
  '요즘 들어 사람들의 관심도가 부쩍 높아진 것 같아요.',
  '적절하게 잘 활용하면 삶의 질이 올라간다고 생각해요.'
];



// ─── Main: liar.js ───

/**
 * 라이어 게임 (Liar Game) 실시간 멀티플레이 로직
 * 한국어 주석 필수
 */

// [import removed]
// [import removed]
// [import removed]

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

let isCodeHidden = false;
function updateRoomCodeText() {
  if (!displayRoomCode) return;
  displayRoomCode.textContent = isCodeHidden ? 'ROOM: •••••• 👁️' : `ROOM: ${myRoomCode} 🔒`;
  displayRoomCode.style.cursor = 'pointer';
  displayRoomCode.title = '클릭하여 방 코드 숨기기/보기';
}
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


})();