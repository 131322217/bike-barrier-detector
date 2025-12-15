// script.js
// 仕様:
// - 通常ログはローカルのみ
// - diff > THRESHOLD の瞬間を「段差イベント」として検出
// - イベント時のみ Firestore に保存
// - イベント時のみ地図にピン表示
// - diff の大きさでピンサイズを変更
// - iOS の加速度許可対応
// - UIログを画面下に表示

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
const THRESHOLD = 2.5;            // 段差判定
const EVENT_COOLDOWN_MS = 1200;   // 再判定抑制
const PRE_N = 2;                  // 前データ件数

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let lastPosition = null;
let prevTotal = null;
let lastEventTime = 0;

let watchId = null;
let map = null;
let userMarker = null;

// ローカルバッファ
let buffer = [];

/* ===== UIログ ===== */
function logUI(msg) {
  if (resultText) {
    resultText.textContent = msg;
  }
}

/* ===== 地図 ===== */
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

/* ===== diff に応じたピンサイズ ===== */
function getPinSize(diff) {
  if (diff < 4.0) return 14;   // 小
  if (diff < 8.0) return 20;   // 中
  return 28;                   // 大
}

function addEventPin(lat, lng, diff) {
  const size = getPinSize(diff);

  const pinIcon = L.divIcon({
    className: "event-pin",
    html: "📍",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
  });

  L.marker([lat, lng], { icon: pinIcon })
    .addTo(map)
    .bindPopup(`段差検出<br>diff = ${diff.toFixed(2)}`);
}

/* ===== Firestore ===== */
async function saveEvent(eventData) {
  try {
    await addDoc(collection(db, "events"), eventData);
    logUI("Firestore にイベント保存");
  } catch (e) {
    console.error(e);
    logUI("Firestore 保存失敗");
  }
}

/* ===== iOS 加速度許可 ===== */
async function requestMotionPermissionIfNeeded() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    const res = await DeviceMotionEvent.requestPermission();
    return res === "granted";
  }
  return true;
}

/* ===== 加速度処理 ===== */
function handleMotion(e) {
  if (!isMeasuring) return;

  const acc =
    e.acceleration && e.acceleration.x !== null
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

  accelerationText.textContent =
    `total=${total.toFixed(2)} diff=${diff.toFixed(2)}`;

  const sample = {
    x, y, z, total, diff,
    lat: lastPosition?.latitude ?? null,
    lng: lastPosition?.longitude ?? null,
    timestamp: new Date().toISOString(),
    isEvent: false
  };

  buffer.push(sample);
  if (buffer.length > 10) buffer.shift();

  const now = Date.now();

  // 段差イベント判定
  if (diff > THRESHOLD && now - lastEventTime > EVENT_COOLDOWN_MS) {
    lastEventTime = now;

    const logs = [
      ...buffer.slice(-PRE_N).map(s => ({ ...s, isEvent: false })),
      { ...sample, isEvent: true }
    ];

    const eventDoc = {
      sessionId,
      createdAt: new Date().toISOString(),
      logs
    };

    logUI("段差イベント検出");

    if (sample.lat && sample.lng) {
      initMap(sample.lat, sample.lng);
      addEventPin(sample.lat, sample.lng, diff);
    }

    saveEvent(eventDoc);
  }
}

/* ===== GPS ===== */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude, pos.coords.longitude);
    },
    err => console.warn(err),
    { enableHighAccuracy: true }
  );
}

function stopGPS() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

/* ===== セッション ===== */
function makeSessionId() {
  return new Date().toISOString();
}

/* ===== Start / Stop ===== */
startStopBtn.addEventListener("click", async () => {
  if (!isMeasuring) {
    const ok = await requestMotionPermissionIfNeeded();
    if (!ok) {
      alert("加速度センサの許可が必要です");
      return;
    }

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
