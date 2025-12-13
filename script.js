// ================================
// Bike Barrier Detector - stable
// ================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ===== Firebase ===== */
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ===== DOM ===== */
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");
const resultText = document.getElementById("resultText");

/* ===== 設定 ===== */
const THRESHOLD = 2.5;       // イベント判定
const QUIET_COUNT = 3;      // 揺れが収まった判定回数

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;

let prevTotal = null;
let lastPosition = null;
let watchId = null;

let map = null;
let userMarker = null;

// ローカル保存用
let localLogs = [];
let inEvent = false;
let quietCounter = 0;

/* ===== UIログ ===== */
function logUI(msg) {
  resultText.textContent = msg;
}

/* ===== iOS 加速度 許可 ===== */
async function requestMotionPermission() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    const res = await DeviceMotionEvent.requestPermission();
    return res === "granted";
  }
  return true;
}

/* ===== 地図 ===== */
function initMap(lat, lng) {
  if (map) return;
  map = L.map("map").setView([lat, lng], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(map);
  userMarker = L.marker([lat, lng]).addTo(map);
}
function updateMap(lat, lng) {
  if (!map) initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
}

/* ===== Firestore 保存 ===== */
async function saveEventBlock(logs) {
  if (logs.length === 0) return;

  await addDoc(collection(db, "events"), {
    sessionId,
    createdAt: new Date().toISOString(),
    logs
  });

  logUI(`Firestore保存完了（${logs.length}件）`);
}

/* ===== 加速度処理 ===== */
function handleMotion(e) {
  if (!isMeasuring) return;

  const acc = e.acceleration;
  if (!acc || acc.x == null) return;

  const x = acc.x;
  const y = acc.y;
  const z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let diff = 0;
  if (prevTotal !== null) diff = Math.abs(total - prevTotal);
  prevTotal = total;

  accelerationText.textContent =
    `total: ${total.toFixed(2)} diff: ${diff.toFixed(2)}`;

  const log = {
    x, y, z, total, diff,
    lat: lastPosition?.latitude ?? null,
    lng: lastPosition?.longitude ?? null,
    timestamp: new Date().toISOString(),
    isEvent: diff > THRESHOLD
  };

  // イベント検出
  if (diff > THRESHOLD) {
    quietCounter = 0;

    if (!inEvent) {
      inEvent = true;
      localLogs = [];

      // ピン表示（最初のイベントのみ）
      if (log.lat && log.lng) {
        const pin = L.divIcon({
          className: "red-pin",
          html: "📍",
          iconSize: [16, 16],
          iconAnchor: [8, 16]
        });
        L.marker([log.lat, log.lng], { icon: pin }).addTo(map);
      }

      logUI("イベント開始");
    }

    localLogs.push(log);
    return;
  }

  // イベント中でなければ無視
  if (!inEvent) return;

  // 揺れが落ち着いたか判定
  quietCounter++;
  localLogs.push(log);

  if (quietCounter >= QUIET_COUNT) {
    // イベント終了
    saveEventBlock(localLogs);
    inEvent = false;
    quietCounter = 0;
    localLogs = [];
  }
}

/* ===== GPS ===== */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(pos => {
    lastPosition = pos.coords;
    updateMap(lastPosition.latitude, lastPosition.longitude);
  });
}
function stopGPS() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

/* ===== セッションID ===== */
function makeSessionId() {
  return new Date().toISOString();
}

/* ===== ボタン ===== */
startStopBtn.addEventListener("click", async () => {
  if (!isMeasuring) {
    const ok = await requestMotionPermission();
    if (!ok) {
      alert("加速度センサーの許可が必要です");
      return;
    }

    isMeasuring = true;
    sessionId = makeSessionId();
    prevTotal = null;
    localLogs = [];
    inEvent = false;
    quietCounter = 0;

    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中…";
    logUI("測定開始");

    navigator.geolocation.getCurrentPosition(pos => {
      lastPosition = pos.coords;
      initMap(pos.coords.latitude, pos.coords.longitude);
      startGPS();
    });

    window.addEventListener("devicemotion", handleMotion);

  } else {
    isMeasuring = false;

    window.removeEventListener("devicemotion", handleMotion);
    stopGPS();

    startStopBtn.textContent = "測定開始";
    statusText.textContent = "測定終了";
    logUI("測定終了");
  }
});
