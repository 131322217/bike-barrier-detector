// script.js
// イベント塊まとめ保存方式
// threshold = 2.5
// 通常ログはローカルのみ
// イベント終了時にまとめて Firestore に保存

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
const THRESHOLD = 2.5;
const NORMAL_END_COUNT = 3;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;

let prevTotal = null;
let lastPosition = null;
let watchId = null;

// イベント制御
let eventActive = false;
let normalStreak = 0;

// ローカルバッファ（イベント塊）
let localBuffer = [];

// map
let map = null;
let userMarker = null;

/* ===== UIログ ===== */
function logUI(msg) {
  if (resultText) {
    resultText.textContent = msg;
  }
  console.log(msg);
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
  map.setView([lat, lng]);
}

/* ===== iOS Permission ===== */
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

/* ===== Firestore 保存 ===== */
async function saveEventBlockToFirestore(block) {
  if (block.length === 0) return;

  try {
    await addDoc(collection(db, "events"), {
      sessionId,
      createdAt: new Date().toISOString(),
      logs: block
    });
    logUI(`イベント塊保存完了（${block.length}件）`);
  } catch (e) {
    console.error("Firestore 保存失敗", e);
    logUI("保存失敗");
  }
}

/* ===== 加速度処理 ===== */
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc =
    event.acceleration && event.acceleration.x !== null
      ? event.acceleration
      : event.accelerationIncludingGravity;

  if (!acc) return;

  const x = acc.x ?? 0;
  const y = acc.y ?? 0;
  const z = acc.z ?? 0;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const diff = prevTotal === null ? 0 : Math.abs(total - prevTotal);
  prevTotal = total;

  accelerationText.textContent =
    `加速度合計: ${total.toFixed(2)} / diff: ${diff.toFixed(2)}`;

  const sample = {
    timestamp: new Date().toISOString(),
    lat: lastPosition?.latitude ?? null,
    lng: lastPosition?.longitude ?? null,
    x, y, z, total, diff
  };

  // ===== イベント判定 =====
  if (diff > THRESHOLD) {
    // イベント
    if (!eventActive) {
      logUI("イベント開始");
    }

    eventActive = true;
    normalStreak = 0;

    localBuffer.push({ ...sample, isEvent: true });

    // マーカー表示
    if (sample.lat && sample.lng) {
      const pinIcon = L.divIcon({
        className: "red-pin",
        html: "📍",
        iconSize: [14, 14],
        iconAnchor: [7, 14]
      });

      L.marker([sample.lat, sample.lng], { icon: pinIcon })
        .addTo(map)
        .bindPopup(`Event diff=${diff.toFixed(2)}`);
    }

  } else {
    // 通常
    localBuffer.push({ ...sample, isEvent: false });

    if (eventActive) {
      normalStreak++;

      if (normalStreak >= NORMAL_END_COUNT) {
        // イベント終了
        logUI("イベント終了 → Firestore送信");
        saveEventBlockToFirestore(localBuffer);

        localBuffer = [];
        eventActive = false;
        normalStreak = 0;
      }
    }
  }
}

/* ===== GPS ===== */
function startGPS() {
  watchId = navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos.coords;
      updateMap(lastPosition.latitude, lastPosition.longitude);
      statusText.textContent = "測定中…";
    },
    err => {
      console.warn(err);
    },
    { enableHighAccuracy: true }
  );
}

function stopGPS() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
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

    sessionId = makeSessionId();
    logUI(`測定開始 session=${sessionId}`);

    prevTotal = null;
    localBuffer = [];
    eventActive = false;
    normalStreak = 0;

    isMeasuring = true;
    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中…";

    navigator.geolocation.getCurrentPosition(pos => {
      lastPosition = pos.coords;
      initMap(pos.coords.latitude, pos.coords.longitude);
      startGPS();
    });

    window.addEventListener("devicemotion", handleMotion);

  } else {
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "後処理中…";

    window.removeEventListener("devicemotion", handleMotion);
    stopGPS();

    // イベント途中なら破棄 or 保存（今回は破棄）
    localBuffer = [];

    statusText.textContent = "後処理完了";
    logUI("測定終了");
  }
});
