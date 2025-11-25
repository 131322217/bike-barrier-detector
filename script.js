import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase初期化
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128",
  storageBucket: "bike-barrier-detector-1e128.appspot.com",
  messagingSenderId: "556503472203",
  appId: "1:556503472203:web:d248c2bd6f5773ea9dd5ce"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM
const startStopBtn = document.getElementById('startStopBtn');
const statusText = document.getElementById('statusText');
const accelerationText = document.getElementById('accelerationText');

// 計測用
let isMeasuring = false;
let prevAcc = null;
const accelerationThreshold = 0.5;

// バッファ
let preBuffer = [];
let postBuffer = [];
let collectingPost = false;
const POST_COUNT = 2; // イベント後に収集する件数

// セッション
let sessionId = null;

// 1秒ごとにデータ保存
let intervalId = null;

// セッションID生成
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

// Firestore保存
async function saveToFirestore(points) {
  if (!sessionId || points.length === 0) return;
  const docRef = doc(db, "barriers", sessionId);
  try {
    await setDoc(docRef, { points: arrayUnion(...points) }, { merge: true });
    console.log("保存成功", points);
  } catch (e) {
    console.error("保存失敗", e);
  }
}

// データ処理
function handleMotion(event) {
  if (!isMeasuring) return;
  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  const x = acc.x, y = acc.y, z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let xDiff = 0, yDiff = 0, zDiff = 0, totalDiff = 0;
  if (prevAcc) {
    xDiff = Math.abs(x - prevAcc.x);
    yDiff = Math.abs(y - prevAcc.y);
    zDiff = Math.abs(z - prevAcc.z);
    totalDiff = Math.abs(total - prevAcc.total);
  }

  const point = {
    x, y, z, xDiff, yDiff, zDiff, totalDiff, total,
    timestamp: new Date()
  };

  prevAcc = { x, y, z, total };

  // イベント判定
  if (totalDiff > accelerationThreshold) {
    collectingPost = true;
    const combined = [...preBuffer, point];
    preBuffer = []; // まとめたらクリア
    postBuffer = [];
    collectingPost = POST_COUNT; // 後ろ2件収集中
    saveToFirestore(combined);
  } else {
    // preBuffer管理
    preBuffer.push(point);
    if (preBuffer.length > 2) preBuffer.shift();

    // postBuffer収集中
    if (collectingPost > 0) {
      postBuffer.push(point);
      collectingPost--;
      if (collectingPost === 0) {
        saveToFirestore(postBuffer);
        postBuffer = [];
      }
    }
  }

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;
}

// iOS用 permission
function requestPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') window.addEventListener('devicemotion', handleMotion);
      })
      .catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }
}

// 開始/終了ボタン
startStopBtn.addEventListener('click', () => {
  isMeasuring = !isMeasuring;
  if (isMeasuring) {
    sessionId = generateSessionId(new Date());
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    prevAcc = null;
    preBuffer = [];
    postBuffer = [];
    collectingPost = 0;
    requestPermission();
  } else {
    statusText.textContent = "測定終了";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener('devicemotion', handleMotion);
  }
});
