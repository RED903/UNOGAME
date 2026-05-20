// ═══════════════════════════════════════════════════
// Firebase 설정 파일
//
// ⚠️ 이 파일의 firebaseConfig를 본인의 Firebase 설정으로 교체해야 합니다!
//
// 방법:
// 1. https://console.firebase.google.com 에서 프로젝트 생성
// 2. Realtime Database 활성화 (테스트 모드)
// 3. 프로젝트 설정 > 일반 > 앱 추가(웹) > SDK 구성 복사
// 4. 아래 firebaseConfig 값을 복사한 값으로 교체
// 5. databaseURL이 반드시 있어야 합니다!
//
// 자세한 방법: README.md 참고
// ═══════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  push,
  onValue,
  update,
  remove,
  off,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ══════════════════════════════════════════════════
// 🔧 여기를 본인의 Firebase 설정으로 교체하세요!
// ══════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBZYI7EJZBac29eFaJQLKpDJJp-YwVZr6o",
  authDomain: "uno-game-7f074.firebaseapp.com",
  databaseURL: "https://uno-game-7f074-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "uno-game-7f074",
  storageBucket: "uno-game-7f074.firebasestorage.app",
  messagingSenderId: "364236312896",
  appId: "1:364236312896:web:475600e15fb99d92a4eaa5"
};
// ══════════════════════════════════════════════════

// 설정이 아직 기본값인지 확인
function isDefaultConfig() {
  return firebaseConfig.apiKey === "YOUR_API_KEY" ||
         firebaseConfig.databaseURL.includes("YOUR_PROJECT_ID");
}

// Firebase 초기화
let app, database;

try {
  if (isDefaultConfig()) {
    // 기본 설정 경고 (개발 환경에서 안내)
    console.warn(
      '%c⚠️ Firebase 설정이 필요합니다!',
      'color: orange; font-size: 16px; font-weight: bold;'
    );
    console.warn(
      'js/firebase-config.js 파일을 열어서 firebaseConfig를 본인의 Firebase 설정으로 교체하세요.\n' +
      '자세한 방법은 README.md를 참고하세요.'
    );

    // 페이지에 경고 표시
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        const warning = document.createElement('div');
        warning.style.cssText = `
          position: fixed;
          top: 0; left: 0; right: 0;
          background: linear-gradient(135deg, #FF6B00, #FF1744);
          color: white;
          padding: 12px 20px;
          text-align: center;
          font-family: 'Outfit', sans-serif;
          font-weight: 700;
          font-size: 0.9rem;
          z-index: 99999;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        `;
        warning.innerHTML = `
          ⚠️ Firebase 설정이 필요합니다!
          <a href="README.md" target="_blank"
            style="color:white; text-decoration:underline; margin-left:8px;">
            설정 가이드 보기 (README.md)
          </a>
        `;
        document.body.prepend(warning);
      }, 500);
    }
  }

  app = initializeApp(firebaseConfig);
  database = getDatabase(app);
} catch (err) {
  console.error('Firebase 초기화 실패:', err);
}

export {
  database,
  ref,
  set,
  get,
  push,
  onValue,
  update,
  remove,
  off,
  serverTimestamp,
  runTransaction
};
