// UNO 게임 BGM (Sound 폴더 랜덤 재생, 루프)

import { getAudioVolume } from './sound.js';

const BGM_TRACKS = [
  'Sound/Tech_Owl__Chill__Apr_13_2026_1029_PM_cropped.ogg',
  'Sound/Tech_Owl__Chill__Apr_13_2026_1033_PM_cropped.ogg',
  'Sound/Tech_Owl__Chill__Apr_13_2026_1042_PM_cropped.ogg',
  'Sound/Tech_Owl__Moody__Apr_13_2026_1058_PM_cropped.ogg'
];

let bgmAudio = null;
let bgmActive = false;

export function startGameBgm() {
  if (bgmActive && bgmAudio) return;

  const track = BGM_TRACKS[Math.floor(Math.random() * BGM_TRACKS.length)];
  bgmAudio = new Audio(track);
  bgmAudio.loop = true;
  bgmAudio.volume = getAudioVolume();
  bgmActive = true;

  const playPromise = bgmAudio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => { /* 자동재생 차단 등 */ });
  }
}

export function stopGameBgm() {
  if (!bgmAudio) {
    bgmActive = false;
    return;
  }
  bgmAudio.pause();
  bgmAudio.currentTime = 0;
  bgmAudio.src = '';
  bgmAudio = null;
  bgmActive = false;
}

export function setBgmVolume(volume) {
  if (bgmAudio) bgmAudio.volume = volume;
}

export function isBgmPlaying() {
  return bgmActive && !!bgmAudio && !bgmAudio.paused;
}
