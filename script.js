import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase初期化
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM
const startStopBtn = document.getElementById('startStopBtn');
const statusText = document.getElementById('statusText');
const accelerationText = document.getElementById('accelerationText');

// 計測フラグ
let isMeasuring = false;
let prevAcc = null;
const threshold = 0.5;

// map + GPS
let map;
let userMarker;
let watchId = null;
let lastPosition = null;

function initMap(lat, lng) {
  map = L.map('map').setView([lat, lng], 17);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  userMarker = L.marker([lat, lng]).addTo(map);
}

function updateMap(lat, lng) {
  if (!map) return initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);
}

// Firestore保存（イベント時のみ）
async function saveEvent(data) {
  try {
    await addDoc(collection(db, "events"), data);
    console.log("イベント保存成功", data);
  } catch (e) {
    console.error("保存失敗", e);
  }
}

// 加速度処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration || event.accelerationIncludingGravity;
  if (!acc || acc.x === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;

  if (prevAcc === null) {
    prevAcc = total;
    return;
  }

  const diff = Math.abs(total - prevAcc);
  prevAcc = total;

  if (diff > threshold && lastPosition) {
    const data = {
      lat: lastPosition.latitude,
      lng: lastPosition.longitude,
      total,
      totalDiff: diff,
      timestamp: new Date()
    };

    saveEvent(data);
    L.marker([data.lat, data.lng], { title: "イベント" }).addTo(map);
  }
}

// iOS向け
async function enableMotion() {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    await DeviceMotionEvent.requestPermission().catch(() => {});
  }
}

// GPS
function trackPosition() {
  watchId = navigator.geolocation.watchPosition(pos => {
    lastPosition = pos.coords;
    updateMap(lastPosition.latitude, lastPosition.longitude);
  });
}

// ボタン操作
startStopBtn.addEventListener('click', async () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    await enableMotion();
    prevAcc = null;

    navigator.geolocation.getCurrentPosition(pos => {
      lastPosition = pos.coords;
      initMap(lastPosition.latitude, lastPosition.longitude);
      trackPosition();
    });

    window.addEventListener('devicemotion', handleMotion);

    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
  } else {
    statusText.textContent = "測定停止";
    startStopBtn.textContent = "測定開始";

    window.removeEventListener('devicemotion', handleMotion);

    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  }
});
