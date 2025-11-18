import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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

let isMeasuring = false;
let prevAcceleration = null;
const accelerationThreshold = 0.5;

const accelerationDisplay = document.getElementById('accelerationValue');
const statusText = document.getElementById('statusText');
const toggleButton = document.getElementById('toggleButton');

let sessionId = null;

// 加速度表示
function updateAccelerationDisplay(value) {
  accelerationDisplay.textContent = value.toFixed(1);
}

// セッションID生成（YYYY-MM-DD_HH-MM）
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

// Firestoreに1件保存
async function saveGeoPoint(lat, lng, diff) {
  if (!sessionId) return;
  try {
    await addDoc(collection(db, "barriers", sessionId, "points"), {
      lat,
      lng,
      accelerationChange: diff,
      timestamp: new Date()
    });
    console.log("保存成功:", lat, lng, diff);
  } catch (e) {
    console.error("Firestore保存失敗:", e);
  }
}

// 加速度イベント
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  updateAccelerationDisplay(total);

  if (prevAcceleration !== null) {
    const diff = Math.abs(total - prevAcceleration);
    if (diff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition((pos) => {
        saveGeoPoint(pos.coords.latitude, pos.coords.longitude, diff.toFixed(1));
      }, (error) => {
        console.error("位置情報取得失敗:", error);
      }, { enableHighAccuracy: true });
    }
  }

  prevAcceleration = total;
}

// 加速度センサー許可
function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(permission => {
        if (permission === 'granted') window.addEventListener('devicemotion', handleMotion);
        else alert("加速度センサーの使用が許可されませんでした。");
      }).catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }
}

// トグル
function toggleMeasurement() {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionId = generateSessionId(new Date());
    statusText.textContent = "測定中です…";
    toggleButton.textContent = "測定終了";
    prevAcceleration = null;

    requestPermissionIfNeeded();
    console.log("新しいセッション開始:", sessionId);

  } else {
    statusText.textContent = "測定していません";
    toggleButton.textContent = "測定開始";
    window.removeEventListener('devicemotion', handleMotion);
  }
}

toggleButton.addEventListener('click', toggleMeasurement);
