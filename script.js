import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, doc, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// --- Firebase 初期化 ---
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

// --- DOM ---
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");
const errorText = document.getElementById("errorText");

// --- 計測用 ---
let isMeasuring = false;
let prevAcc = null;
const accelerationThreshold = 1.0; // 変化の閾値
let sessionId = null;
let sessionStartTime = null;

// --- バッファ（直近3秒） ---
let buffer = [];
const BUFFER_MS = 3000;

// --- セッションID生成 ---
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

// --- バッファ内データを Firebase に送信 ---
async function saveBatch(points) {
  if (!points.length) return;
  try {
    const docRef = doc(db, "barriers", sessionId);
    // points を配列として保存
    await addDoc(collection(docRef, "data"), { points });
    console.log("Firebase送信成功:", points.length, "件");
  } catch (e) {
    console.error("Firebase送信失敗:", e);
    errorText.textContent = "Firebase送信失敗: " + e.message;
  }
}

// --- センサー処理 ---
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);

  const xDiff = prevAcc ? acc.x - prevAcc.x : 0;
  const yDiff = prevAcc ? acc.y - prevAcc.y : 0;
  const zDiff = prevAcc ? acc.z - prevAcc.z : 0;
  const totalDiff = prevAcc ? Math.abs(total - prevAcc.total) : 0;

  const data = {
    x: acc.x,
    y: acc.y,
    z: acc.z,
    total,
    xDiff,
    yDiff,
    zDiff,
    totalDiff,
    timestamp: new Date()
  };

  buffer.push(data);

  // 古いデータ削除
  const cutoff = Date.now() - BUFFER_MS;
  buffer = buffer.filter(d => d.timestamp.getTime() >= cutoff);

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)} / 差分: ${totalDiff.toFixed(2)}`;

  if (totalDiff > accelerationThreshold) {
    // 閾値超えたら直近3秒分を送信
    saveBatch(buffer);
    buffer = []; // 送信後クリア
  }

  prevAcc = { x: acc.x, y: acc.y, z: acc.z, total };
}

// --- iOS permission ---
function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener("devicemotion", handleMotion);
        } else {
          errorText.textContent = "加速度センサー使用が許可されませんでした";
        }
      }).catch(e => errorText.textContent = "Error: " + e.message);
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// --- 開始/停止ボタン ---
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionStartTime = new Date();
    sessionId = generateSessionId(sessionStartTime);
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    buffer = [];
    prevAcc = null;
    requestPermissionIfNeeded();
    errorText.textContent = "";
  } else {
    statusText.textContent = "測定停止";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);
    // 終了時に残りのバッファも送信
    saveBatch(buffer);
    buffer = [];
  }
});
