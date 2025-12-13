// script.js

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
const THRESHOLD = 2.5;

const ROUGH_START_MS = 1200;
const ROUGH_END_MS   = 1000;
const STEP_MAX_MS    = 900;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;

let lastPosition = null;
let prevTotal = null;

let roughStartTime = null;
let lastEventTime = null;
let roughLogs = [];

let map = null;
let userMarker = null;
let watchId = null;

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

/* ===== ピン（サイズだけ diff 依存） ===== */
function addPin(lat, lng, color, label, diff) {
  let size = 14;
  if (diff >= 7.0) size = 22;
  else if (diff >= 4.0) size = 18;

  const icon = L.divIcon({
    className: "pin",
    html: `<span style="font-size:${size}px;color:${color}">📍</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size]
  });

  L.marker([lat, lng], { icon })
    .addTo(map)
    .bindPopup(`${label}<br>diff=${diff.toFixed(2)}`);
}

/* ===== Firestore ===== */
async function saveEvent(type, logs) {
  await addDoc(collection(db, "events"), {
    sessionId,
    type,
    createdAt: new Date().toISOString(),
    logs
  });
}

/* ===== iOS permission ===== */
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

  const now = Date.now();

  const sample = {
    x, y, z, total, diff,
    lat: lastPosition?.latitude ?? null,
    lng: lastPosition?.longitude ?? null,
    timestamp: new Date().toISOString(),
    isEvent: diff > THRESHOLD
  };

  accelerationText.textContent =
    `total=${total.toFixed(2)} diff=${diff.toFixed(2)}`;

  // イベント検出
  if (diff > THRESHOLD) {
    if (!roughStartTime) {
      roughStartTime = now;
      logUI("ガタガタ開始");

      if (sample.lat && sample.lng) {
        initMap(sample.lat, sample.lng);
        addPin(sample.lat, sample.lng, "red", "でこぼこ道 開始", diff);
      }
    }

    lastEventTime = now;
    roughLogs.push(sample);
    return;
  }

  // ガタガタ終了判定
  if (roughStartTime && now - lastEventTime > ROUGH_END_MS) {
    const duration = lastEventTime - roughStartTime;

    if (duration <= STEP_MAX_MS) {
      logUI("段差と判定");

      if (roughLogs[0]?.lat && roughLogs[0]?.lng) {
        addPin(
          roughLogs[0].lat,
          roughLogs[0].lng,
          "green",
          "段差",
          roughLogs[0].diff
        );
      }

      saveEvent("step", roughLogs);
    } else {
      logUI("でこぼこ道終了");

      const last = roughLogs[roughLogs.length - 1];
      if (last?.lat && last?.lng) {
        addPin(last.lat, last.lng, "blue", "でこぼこ道 終了", last.diff);
      }

      saveEvent("rough", roughLogs);
    }

    roughLogs = [];
    roughStartTime = null;
    lastEventTime = null;
  }
}

/* ===== GPS ===== */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude, pos.coords.longitude);
    },
    console.warn,
    { enableHighAccuracy: true }
  );
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
    prevTotal = null;
    roughLogs = [];
    roughStartTime = null;

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

    startStopBtn.textContent = "測定開始";
    statusText.textContent = "後処理完了";
    logUI("測定終了");

    window.removeEventListener("devicemotion", handleMotion);
    stopGPS();
  }
});
