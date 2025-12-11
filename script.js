/* -------------------------
   Firebase
------------------------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* -------------------------
   DOM
------------------------- */
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");
const logBox = document.getElementById("log");

function log(msg) {
  console.log(msg);
  logBox.textContent += msg + "\n";
}

/* -------------------------
   状態管理
------------------------- */
let isMeasuring = false;
let map, userMarker;
let lastPosition = null;
let watchId = null;
let prevTotal = null;
let currentSessionId = null;

let lastSaveTime = 0;
const normalSaveInterval = 1000; // 通常時は1秒に1回
const diffThreshold = 3; // イベント判定

/* -------------------------
   Map
------------------------- */
function initMap(lat, lng) {
  if (!map) {
    map = L.map("map").setView([lat, lng], 17);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);

    userMarker = L.marker([lat, lng]).addTo(map);
  } else {
    userMarker.setLatLng([lat, lng]);
    map.setView([lat, lng]);
  }
}

/* -------------------------
   Firestore 保存
------------------------- */
async function saveData(data) {
  try {
    await addDoc(collection(db, "accel_data"), data);
  } catch (e) {
    console.error("保存失敗:", e);
  }
}

/* -------------------------
   GPS
------------------------- */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(pos => {
    lastPosition = pos.coords;
    initMap(lastPosition.latitude, lastPosition.longitude);
  }, err => {
    log("GPSエラー: " + err.message);
  }, { enableHighAccuracy: true });
}

function stopGPS() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
}

/* -------------------------
   加速度
------------------------- */
async function requestMotionPermission() {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const resp = await DeviceMotionEvent.requestPermission();
    if (resp !== "granted") {
      alert("加速度センサーの許可がありません");
      return false;
    }
  }
  return true;
}

function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  const x = acc.x, y = acc.y, z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const now = Date.now();

  accelerationText.textContent = `加速度: ${total.toFixed(2)}`;

  if (!prevTotal) { prevTotal = total; return; }

  const diff = Math.abs(total - prevTotal);
  prevTotal = total;

  if (!lastPosition) return;

  const base = {
    sessionId: currentSessionId,
    time: Date.now(),
    lat: lastPosition.latitude,
    lng: lastPosition.longitude,
    x, y, z,
    total,
    diff,
    isEvent: diff > diffThreshold
  };

  if (base.isEvent) {
    saveData(base);
    log("イベント検出 diff=" + diff.toFixed(2));
    L.marker([base.lat, base.lng], {
      icon: L.icon({ iconUrl: "https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png" })
    }).addTo(map);
    return;
  }

  if (now - lastSaveTime >= normalSaveInterval) {
    lastSaveTime = now;
    saveData(base);
  }
}

/* -------------------------
   計測開始 / 停止
------------------------- */
async function startMeasurement() {
  log("測定開始");
  isMeasuring = true;
  currentSessionId = "sess_" + Date.now();
  prevTotal = null;
  statusText.textContent = "測定中…";

  const ok = await requestMotionPermission();
  if (!ok) return;

  startGPS();
  window.addEventListener("devicemotion", handleMotion);

  startStopBtn.textContent = "測定停止";
}

function stopMeasurement() {
  log("測定停止");
  isMeasuring = false;

  stopGPS();
  window.removeEventListener("devicemotion", handleMotion);

  startStopBtn.textContent = "測定開始";
  statusText.textContent = "停止中";
}

/* -------------------------
   ボタン
------------------------- */
startStopBtn.addEventListener("click", () => {
  if (!isMeasuring) startMeasurement();
  else stopMeasurement();
});

/* -------------------------
   初期位置を地図に反映
------------------------- */
navigator.geolocation.getCurrentPosition(pos => {
  initMap(pos.coords.latitude, pos.coords.longitude);
});
