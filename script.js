import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, doc, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const accelerationDisplay = document.getElementById('accelerationValue');
const statusText = document.getElementById('statusText');
const toggleButton = document.getElementById('toggleButton');

// 計測用
let isMeasuring = false;
let prevAcceleration = null;
const accelerationThreshold = 0.5;
let sessionId = null;
let sessionStartTime = null;

// バッチ保存用
let batchPoints = [];
const BATCH_SIZE = 5;

// セッションID生成
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

function updateAccelerationDisplay(value) {
  accelerationDisplay.textContent = value.toFixed(1);
}

// Firestoreにバッチ送信
async function saveBatch() {
  if (batchPoints.length === 0) return;
  const docRef = doc(db, "barriers", sessionId);

  for (const point of batchPoints) {
    try {
      await addDoc(collection(docRef, "points"), point);
    } catch (e) {
      console.error("Firestore保存失敗:", e);
    }
  }
  console.log(`バッチ送信成功: ${batchPoints.length} 件`);
  batchPoints = [];
}

function handleMotion(event) {
  if (!isMeasuring) return;
  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  updateAccelerationDisplay(total);

  if (prevAcceleration !== null) {
    const diff = Math.abs(total - prevAcceleration);
    if (diff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition((position) => {
        batchPoints.push({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accelerationChange: diff.toFixed(1),
          timestamp: new Date()
        });

        if (batchPoints.length >= BATCH_SIZE) {
          saveBatch();
        }
      }, (error) => {
        console.error("位置情報取得失敗:", error);
      }, { enableHighAccuracy: true });
    }
  }
  prevAcceleration = total;
}

// iOS用 permission
function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('devicemotion', handleMotion);
        } else {
          alert("加速度センサーの使用が許可されませんでした。");
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }
}

// 開始/終了トグル
toggleButton.addEventListener('click', () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionStartTime = new Date();
    sessionId = generateSessionId(sessionStartTime);
    statusText.textContent = "測定中です…";
    toggleButton.textContent = "測定終了";
    prevAcceleration = null;
    batchPoints = [];
    requestPermissionIfNeeded();
  } else {
    statusText.textContent = "測定していません";
    toggleButton.textContent = "測定開始";
    window.removeEventListener('devicemotion', handleMotion);
    saveBatch(); // 終了時に残りのデータも送信
  }
});
