import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128",
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");

// 計測制御
let isMeasuring = false;
let prevTotal = null;
const threshold = 0.5;

// GPS
let map;
let userMarker;
let watchId = null;
let lastPosition = null;

// 通常保存タイマー
let normalSaveTimer = null;

// 地図
function initMap(lat, lng) {
  map = L.map("map").setView([lat, lng], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  userMarker = L.marker([lat, lng]).addTo(map);
}

function updateMap(lat, lng) {
  if (!map) return initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);
}

// Firestore保存
async function saveEvent(data) {
  try {
    await addDoc(collection(db, "events"), data);
    console.log("イベント保存成功", data);
  } catch (e) {
    console.error("保存失敗", e);
  }
}

async function saveNormalPosition() {
  if (!lastPosition) return;

  const data = {
    lat: lastPosition.latitude,
    lng: lastPosition.longitude,
    timestamp: new Date(),
    regular: true, // 通常データ判定用
  };

  try {
    await addDoc(collection(db, "positions"), data);
    console.log("通常位置保存", data);
  } catch (e) {
    console.error("通常保存失敗", e);
  }
}

// 加速度処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;

  if (prevTotal === null) {
    prevTotal = total;
    return;
  }

  const diff = Math.abs(total - prevTotal);
  prevTotal = total;

  // イベント検出
  if (diff > threshold && lastPosition) {
    const ev = {
      lat: lastPosition.latitude,
      lng: lastPosition.longitude,
      total: total,
      diff: diff,
      timestamp: new Date(),
      event: true
    };

    saveEvent(ev);

    // 赤ピン（イベント）
    L.marker([ev.lat, ev.lng], { icon: L.icon({
      iconUrl: 'https://maps.gstatic.com/intl/en_us/mapfiles/ms/micons/red-dot.png',
      iconSize: [32, 32]
    }) }).addTo(map);
  }
}

// GPS
function trackPosition() {
  watchId = navigator.geolocation.watchPosition(pos => {
    lastPosition = pos.coords;
    updateMap(lastPosition.latitude, lastPosition.longitude);
  });
}

// ボタン
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    console.log("測定開始");
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    prevTotal = null;

    navigator.geolocation.getCurrentPosition(pos => {
      lastPosition = pos.coords;
      initMap(lastPosition.latitude, lastPosition.longitude);
      trackPosition();
    });

    window.addEventListener("devicemotion", handleMotion);

    // 通常保存 8秒ごと
    normalSaveTimer = setInterval(saveNormalPosition, 8000);

  } else {
    console.log("測定終了");
    statusText.textContent = "測定停止";
    startStopBtn.textContent = "測定開始";

    window.removeEventListener("devicemotion", handleMotion);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (normalSaveTimer) clearInterval(normalSaveTimer);
  }
});
