import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const statusText = document.getElementById('statusText');
const accelerationText = document.getElementById('accelerationText');
const startStopBtn = document.getElementById('startStopBtn');
const errorText = document.getElementById('errorText');

// 計測用
let isMeasuring = false;
let prevAcc = null;
const accelerationThreshold = 0.5;
let sessionId = null;

// セッションID生成（分まで）
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  const h = String(date.getHours()).padStart(2,'0');
  const min = String(date.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

// Firestoreに1件保存
async function savePoint(point) {
  try {
    const docRef = doc(db, "barriers", sessionId);
    // 既存ドキュメントを作る（なければ作る）
    await setDoc(docRef, { sessionId }, { merge: true });
    await addDoc(collection(docRef, "points"), point);
    console.log("保存成功:", point);
  } catch (e) {
    console.error("Firestore保存失敗:", e);
    errorText.textContent = "Firestore保存失敗: " + e.message;
  }
}

// 加速度処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  accelerationText.textContent = total.toFixed(2);

  if (prevAcc !== null) {
    const xDiff = Math.abs(acc.x - prevAcc.x);
    const yDiff = Math.abs(acc.y - prevAcc.y);
    const zDiff = Math.abs(acc.z - prevAcc.z);
    const totalDiff = xDiff + yDiff + zDiff;

    if (totalDiff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition(pos => {
        savePoint({
          xDiff, yDiff, zDiff, totalDiff,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: new Date()
        });
      }, err => {
        console.error("位置情報取得失敗:", err);
        errorText.textContent = "位置情報取得失敗: " + err.message;
      }, { enableHighAccuracy: true });
    }
  }

  prevAcc = { x: acc.x, y: acc.y, z: acc.z };
}

// iOS向け permission
function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('devicemotion', handleMotion);
        } else {
          alert("加速度センサーの使用が許可されませんでした。");
        }
      }).catch(err => {
        console.error(err);
        errorText.textContent = err.message;
      });
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }
}

// 開始/終了トグル
startStopBtn.addEventListener('click', () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionId = generateSessionId(new Date());
    statusText.textContent = "測定中です…";
    startStopBtn.textContent = "測定終了";
    prevAcc = null;
    errorText.textContent = "";
    requestPermissionIfNeeded();
  } else {
    statusText.textContent = "測定していません";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener('devicemotion', handleMotion);
  }
});
