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
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");

// 計測用
let isMeasuring = false;
let prevTotal = null;
const accelerationThreshold = 0.5;
let sessionId = null;

// セッションID生成 (YYYY-MM-DD_HH-MM)
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}-${min}`;
}

// DOM表示更新
function updateAccelerationDisplay(total) {
  accelerationText.textContent = `加速度合計値: ${total.toFixed(2)}`;
}

// Firestore保存
async function savePoint(lat, lng, total, diff) {
  try {
    const docRef = doc(db, "barriers", sessionId);
    await setDoc(docRef, {} , { merge: true }); // セッションIDのドキュメント作成
    await addDoc(collection(docRef, "points"), {
      lat, lng, total, diff, timestamp: new Date()
    });
    console.log("保存成功:", {lat, lng, total, diff});
  } catch (e) {
    console.error("Firestore保存失敗:", e);
  }
}

// 加速度取得
function handleMotion(event) {
  if (!isMeasuring) return;
  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  updateAccelerationDisplay(total);

  if (prevTotal !== null) {
    const diff = Math.abs(total - prevTotal);
    if (diff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition(pos => {
        savePoint(pos.coords.latitude, pos.coords.longitude, total, diff);
      }, err => {
        console.error("位置情報取得失敗:", err);
      }, { enableHighAccuracy: true });
    }
  }

  prevTotal = total;
}

// iOS用 permission
function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener("devicemotion", handleMotion);
        } else {
          alert("加速度センサー使用が許可されませんでした");
        }
      }).catch(console.error);
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// 開始/終了ボタン
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionId = generateSessionId(new Date());
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    prevTotal = null;
    requestPermissionIfNeeded();
  } else {
    statusText.textContent = "測定していません";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);
  }
});
