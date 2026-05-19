# 🎴 UNO Online - 실시간 멀티플레이어

> **GitHub Pages + Firebase Realtime Database**로 구동되는 UNO 카드 게임

[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-deployed-brightgreen)](https://your-username.github.io/UNO)
[![Firebase](https://img.shields.io/badge/Firebase-Realtime_DB-orange)](https://firebase.google.com)

---

## 🎮 게임 방법

1. 사이트에 접속 후 **닉네임 입력**
2. **방 만들기** → 6자리 코드 생성
3. 코드를 친구에게 공유
4. 친구는 **방 입장하기** → 코드 입력
5. 방장이 **게임 시작!** 클릭
6. UNO 규칙대로 게임!

---

## 🃏 UNO 규칙 요약

| 카드 | 효과 |
|------|------|
| 숫자 0-9 | 같은 색상 또는 같은 숫자 위에 낼 수 있음 |
| Skip | 다음 플레이어 건너뜀 |
| Reverse | 방향 전환 (2명일 때는 Skip과 동일) |
| Draw Two (+2) | 다음 플레이어 카드 2장 뽑음 |
| Wild | 색상 변경 |
| Wild Draw Four (+4) | 색상 변경 + 다음 플레이어 4장 뽑음 |

> **UNO 선언**: 패가 1장 남으면 반드시 **UNO!** 버튼을 눌러야 합니다.  
> 선언하지 않으면 상대방이 **UNO 잡기** 버튼으로 패널티 +2장을 줄 수 있습니다.

---

## 🚀 GitHub Pages 배포 방법

### 1단계: Firebase 프로젝트 생성 (필수!)

> ⚠️ 기본 설정의 Firebase는 데모용입니다. **본인의 Firebase 프로젝트**를 만들어야 정상 작동합니다.

1. [Firebase Console](https://console.firebase.google.com) 접속
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: `my-uno-game`)
4. Google Analytics는 선택사항 (없어도 됨)
5. 프로젝트 생성 완료 후 **⚙️ 프로젝트 설정** 클릭
6. **일반 탭** → 스크롤 내려서 **Firebase SDK 구성 및 스니펫** → **구성** 선택
7. 아래처럼 생긴 코드가 나옵니다:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "my-uno-game.firebaseapp.com",
  databaseURL: "https://my-uno-game-default-rtdb.firebaseio.com",
  projectId: "my-uno-game",
  storageBucket: "my-uno-game.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc..."
};
```

### 2단계: Realtime Database 활성화

1. Firebase Console 왼쪽 메뉴 → **Realtime Database**
2. **데이터베이스 만들기** 클릭
3. 지역: `asia-southeast1 (Singapore)` 선택 (한국에서 가장 가까움)
4. 보안 규칙: **테스트 모드로 시작** 선택 (30일간 자유 접근)

### 3단계: 보안 규칙 설정 (중요!)

Firebase Console → Realtime Database → **규칙 탭**:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        "hands": {
          "$playerId": {
            ".read": "auth == null || true",
            ".write": "auth == null || true"
          }
        }
      }
    }
  }
}
```

> 💡 이 규칙은 누구나 읽고 쓸 수 있게 합니다. 인증 없는 게임에는 충분합니다.

### 4단계: firebase-config.js 수정

`js/firebase-config.js` 파일을 열고 `firebaseConfig` 객체를 복사한 값으로 교체:

```js
const firebaseConfig = {
  apiKey: "여기에_복사한_값",
  authDomain: "여기에_복사한_값",
  databaseURL: "여기에_복사한_값",  // ← 반드시 필요!
  projectId: "여기에_복사한_값",
  // ...
};
```

### 5단계: GitHub에 올리기

```bash
git init
git add .
git commit -m "🎴 UNO 온라인 게임 초기 배포"
git remote add origin https://github.com/YOUR_USERNAME/UNO.git
git push -u origin main
```

### 6단계: GitHub Pages 활성화

1. GitHub 저장소 → **Settings** 탭
2. 왼쪽 메뉴 → **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main` / `/(root)`
5. **Save** 클릭

약 1~2분 후 `https://YOUR_USERNAME.github.io/UNO` 에서 접속 가능!

---

## 📁 파일 구조

```
UNO/
├── index.html          # 로비 화면 (방 만들기/입장/대기)
├── game.html           # 게임 화면
├── css/
│   ├── main.css        # 공통 디자인 시스템
│   └── game.css        # 게임 전용 스타일
├── js/
│   ├── firebase-config.js  # ⚠️ Firebase 설정 (교체 필요!)
│   ├── uno-rules.js        # UNO 규칙 엔진
│   ├── card-renderer.js    # SVG 카드 렌더링
│   ├── lobby.js            # 로비 로직
│   ├── game.js             # 게임 메인 로직
│   └── sound.js            # 효과음 (Web Audio API)
└── README.md
```

---

## 🔧 기술 스택

- **HTML / CSS / JavaScript** (순수 바닐라, 프레임워크 없음)
- **Firebase Realtime Database** (실시간 멀티플레이)
- **Web Audio API** (효과음, 외부 파일 없음)
- **SVG 카드 렌더링** (이미지 파일 없음)
- **Google Fonts** (Outfit)

---

## ⚡ 로컬 테스트

Firebase 연결 없이 로컬에서 테스트하려면 `index.html`을 로컬 서버로 열어야 합니다 (ES Module 때문에 file:// 직접 열기는 안 됩니다):

```bash
# Python 사용
python -m http.server 8080

# Node.js 사용
npx serve .
```

그 후 `http://localhost:8080` 접속.

---

## 🐛 문제 해결

| 문제 | 해결법 |
|------|--------|
| Firebase 연결 실패 | `firebase-config.js`의 `databaseURL` 확인 |
| 게임이 시작 안 됨 | 방장이 시작 버튼을 눌렀는지 확인 |
| 카드가 안 보임 | 브라우저 콘솔(F12) 오류 확인 |
| 실시간 동기화 안 됨 | Firebase 보안 규칙 확인 |

---

## 📜 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능합니다.

> UNO는 Mattel의 등록 상표입니다. 이 프로젝트는 팬 메이드 비영리 구현입니다.
