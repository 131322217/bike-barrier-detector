// script.js
// 仕様:
// - 通常ログはローカル配列のみ（Firestoreに送らない）
// - イベント検出(diff > THRESHOLD)でのみFirestore保存
// - 前N件 + イベント本体を1ドキュメントとして保存
// - イベントクールダウンあり（再判定抑制）
// - 赤ピンはイベント開始位置のみ表示

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const THRESHOLD = 2.5;           // イベント判定しきい値
const PRE_N = 3;                 // 前N件
const EVENT_COOLDOWN_MS = 1200;  // 再判定抑制時間(ms)

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let lastPosition = null;
let prevTotal = null;
let lastEventTime = 0;

let watchId = null;
let map = null;
let userMarker = null;

// ローカル保存
let buffer = [];        // 通常ログ
let eventBuffer = null; // 現在のイベント

/* ===== UI ===== */
function logUI(msg) {
  if (resultText) resultText.textContent = msg;
}

/* ===== Map ===== */
function initMap(lat, lng) {
  if (map) return;
  map = L.map("map").setView([lat, lng], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  userMarker = L.marker([lat, lng]).addTo(map);
}

function updateMap(lat, lng) {
  if (!map) initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
}

function addEventPin(lat, lng, diff) {
  const pinIcon = L.divIcon({
    className: "red-pin",
    html: "📍",
    iconSize: [16, 16],
    iconAnchor: [8, 16]
  });
  L.marker([lat, lng], { icon: pinIcon })
    .addTo(map)
    .bindPopup(`Event diff=${diff.toFixed(2)}`);
}

/* ===== Firestore ===== */
async function saveEventDocument(eventData) {
  await addDoc(collection(db, "events"), eventData);
}

/* ===== Permission (iOS) ===== */
async function requestMotionPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    const res = await DeviceMotionEvent.requestPermission();
    return res === "granted";
  }
  return true;
}

/* ===== Motion ===== */
function handleMotion(e) {
  if (!isMeasuring) return;

  const acc = e.acceleration && e.acceleration.x !== null
    ? e.acceleration
    : e.accelerationIncludingGravity;
  if (!acc) return;

  const x = acc.x ?? 0;
  const y = acc.y ?? 0;
  const z = acc.z ?? 0;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let diff = 0;
  if (prevTotal !== null) diff = Math.abs(total - prevTotal);
  prevTotal = total;

  const sample = {
    x, y, z, total, diff,
    lat: lastPosition?.latitude ?? null,
    lng: lastPosition?.longitude ?? null,
    timestamp: new Date().toISOString(),
    isEvent: false
  };

  accelerationText.textContent = `加速度: ${total.toFixed(2)} (diff ${diff.toFixed(2)})`;

  // 通常はバッファに積む
  buffer.push(sample);
  if (buffer.length > 20) buffer.shift();

  const now = Date.now();

  // イベント判定
  if (diff > THRESHOLD && now - lastEventTime > EVENT_COOLDOWN_MS) {
    lastEventTime = now;

    const context = buffer.slice(-PRE_N);
    eventBuffer = {
      sessionId,
      createdAt: new Date().toISOString(),
      logs: [
        ...context.map(s => ({ ...s, isEvent: false })),
        { ...sample, isEvent: true }
      ]
    };

    logUI("イベント検出 → 保存");

    if (sample.lat && sample.lng) {
      initMap(sample.lat, sample.lng);
      addEventPin(sample.lat, sample.lng, diff);
    }

    saveEventDocument(eventBuffer);
  }
}

/* ===== GPS ===== */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(pos => {
    lastPosition = pos.coords;
    updateMap(pos.coords.latitude, pos.coords.longitude);
  }, console.warn, { enableHighAccuracy: true });
}

function stopGPS() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

/* ===== Session ===== */
function makeSessionId() {
  return new Date().toISOString();
}

/* ===== Start / Stop ===== */
startStopBtn.addEventListener("click", async () => {
  if (!isMeasuring) {
    const ok = await requestMotionPermissionIfNeeded();
    if (!ok) return alert("加速度の許可が必要です");

    isMeasuring = true;
    sessionId = makeSessionId();
    buffer = [];
    prevTotal = null;

    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";

    navigator.geolocation.getCurrentPosition(pos => {
      lastPosition = pos.coords;
      initMap(pos.coords.latitude, pos.coords.longitude);
      startGPS();
    });

    window.addEventListener("devicemotion", handleMotion);

  } else {
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "後処理完了";
    logUI("測定終了");

    window.removeEventListener("devicemotion", handleMotion);
    stopGPS();
  }
});