// script.js
// 前3件のみ保存、後続データは保存しない
// threshold = 1.0 (diff)
// 保存先: raw_sessions/{sessionId}/raw_logs
// マップ表示: event のみ赤マーカー（待ち針風）

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ===== Firebase 設定（あなたの設定を使ってください） ===== */
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
const resultText = document.getElementById("resultText"); // 詳細ログ表示用

/* ===== 設定 ===== */
const THRESHOLD = 1.0;           // diff > THRESHOLD => event
const PRE_N = 3;                 // 前3件
const PERIODIC_MS = 1000;        // 通常ログを1秒ごとに保存

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let watchId = null;
let map = null;
let userMarker = null;

let lastPosition = null;         // { latitude, longitude }
let prevTotal = null;            // 前フレームの total
let sampleCounter = 0;           // 内部IDカウンタ

// バッファ：最新のサンプルを保持（古いものは捨てる）
const MAX_RECENT = 200;
let recentSamples = []; // [{ id, x,y,z,total,diff,timestamp,lat,lng,saved:false }]

// periodic timer
let periodicTimer = null;

/* ===== ヘルパー ===== */
function logUI(msg) {
  if (resultText) {
    resultText.textContent = msg;
  } else {
    console.log(msg);
  }
}

function initMap(lat, lng) {
  if (!map) {
    map = L.map("map").setView([lat, lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);
    userMarker = L.marker([lat, lng]).addTo(map);
  }
}
function updateMap(lat, lng) {
  if (!map) return initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);
}

// Firestore に1サンプルを保存（flags: isEvent, isContext）
async function saveSampleToFirestore(sample, flags = {}) {
  try {
    const doc = {
      sessionId,
      x: sample.x,
      y: sample.y,
      z: sample.z,
      total: sample.total,
      diff: sample.diff,
      lat: sample.lat ?? null,
      lng: sample.lng ?? null,
      timestamp: sample.timestamp.toISOString ? sample.timestamp.toISOString() : new Date(sample.timestamp).toISOString(),
      isEvent: !!flags.isEvent,
      isContext: !!flags.isContext
    };
    await addDoc(collection(db, `raw_sessions/${sessionId}/raw_logs`), doc);
    sample.saved = true;
  } catch (e) {
    console.error("Firestore 保存失敗:", e);
  }
}

/* ===== データ管理 ===== */
function pushRecentSample(s) {
  recentSamples.push(s);
  if (recentSamples.length > MAX_RECENT) recentSamples.shift();
}

// get last N samples (excluding those with same id as excludeId if provided)
function getLastNSamples(n, excludeId = null) {
  const out = [];
  for (let i = recentSamples.length - 1; i >= 0 && out.length < n; i--) {
    const s = recentSamples[i];
    if (excludeId !== null && s.id === excludeId) continue;
    out.unshift(s); // maintain chronological order
  }
  return out;
}

/* ===== Permission (iOS) ===== */
async function requestMotionPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const resp = await DeviceMotionEvent.requestPermission();
      return resp === "granted";
    } catch (e) {
      console.warn("DeviceMotion permission error:", e);
      return false;
    }
  }
  return true;
}

/* ===== devicemotion handler ===== */
async function handleMotion(event) {
  if (!isMeasuring) return;

  const accObj = event.acceleration && event.acceleration.x !== null ? event.acceleration : (event.accelerationIncludingGravity || null);
  if (!accObj) return;

  const x = accObj.x ?? 0;
  const y = accObj.y ?? 0;
  const z = accObj.z ?? 0;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let diff = 0;
  if (prevTotal !== null) diff = Math.abs(total - prevTotal);
  prevTotal = total;

  const sample = {
    id: sampleCounter++,
    x, y, z, total, diff,
    lat: lastPosition ? lastPosition.latitude : null,
    lng: lastPosition ? lastPosition.longitude : null,
    timestamp: new Date(),
    saved: false
  };

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)} (diff: ${diff.toFixed(2)})`;

  pushRecentSample(sample);

  // Event detection
  if (prevTotal !== null && diff > THRESHOLD) {
    logUI(`イベント検出 diff=${diff.toFixed(2)}`);

    // Save pre-context: 前 N 件
    const beforeSamples = getLastNSamples(PRE_N, sample.id);
    for (const s of beforeSamples) {
      if (!s.saved) {
        await saveSampleToFirestore(s, { isEvent: false, isContext: true });
      }
    }

    // Save event itself
    if (!sample.saved) {
      await saveSampleToFirestore(sample, { isEvent: true, isContext: false });
    }

    // Put red marker on map
    if (sample.lat !== null && sample.lng !== null) {
      try {
        if (!map) initMap(sample.lat, sample.lng);
        L.marker([sample.lat, sample.lng], {
          icon: L.divIcon({ className: "red-pin", html: "📍" })
        }).addTo(map).bindPopup(`Event: ${diff.toFixed(2)}`).openPopup();
      } catch (e) {
        console.warn("map marker error:", e);
      }
    }
  }
}

/* ===== Periodic normal save (1s) ===== */
async function periodicSaveTick() {
  if (!isMeasuring) return;
  if (recentSamples.length === 0) return;
  const latest = recentSamples[recentSamples.length - 1];
  if (latest.saved) return;
  await saveSampleToFirestore(latest, { isEvent: false, isContext: false });
}

/* ===== GPS tracking ===== */
function startTrackingPosition() {
  if (!navigator.geolocation) {
    logUI("位置情報が利用できません");
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos.coords;
      if (!map) initMap(lastPosition.latitude, lastPosition.longitude);
      updateMap(lastPosition.latitude, lastPosition.longitude);
      const locEl = document.getElementById("statusText");
      if (locEl) locEl.textContent = `測定中… 位置あり (${lastPosition.latitude.toFixed(5)}, ${lastPosition.longitude.toFixed(5)})`;
    },
    (err) => {
      console.warn("位置情報エラー", err);
      logUI("位置取得エラー: " + (err.message || err.code));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}
function stopTrackingPosition() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/* ===== session management ===== */
function makeSessionId() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, "-");
}

/* ===== Start / Stop measurement ===== */
startStopBtn.addEventListener("click", async () => {
  if (!isMeasuring) {
    const motionOK = await requestMotionPermissionIfNeeded();
    if (!motionOK) {
      alert("加速度センサーの権限が必要です");
      return;
    }

    sessionId = makeSessionId();
    logUI("セッション開始: " + sessionId);

    recentSamples = [];
    prevTotal = null;
    sampleCounter = 0;

    isMeasuring = true;
    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中…";

    navigator.geolocation.getCurrentPosition((pos) => {
      lastPosition = pos.coords;
      initMap(lastPosition.latitude, lastPosition.longitude);
      startTrackingPosition();
    }, () => {
      startTrackingPosition();
    }, { enableHighAccuracy: true, timeout: 5000 });

    window.addEventListener("devicemotion", handleMotion);
    periodicTimer = setInterval(periodicSaveTick, PERIODIC_MS);

  } else {
    // stop
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "測定停止 → 後処理中...";
    logUI("停止: 後処理開始");

    window.removeEventListener("devicemotion", handleMotion);
    stopTrackingPosition();
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }

    // save any unsaved samples
    for (const s of recentSamples) {
      if (!s.saved) {
        await saveSampleToFirestore(s, { isEvent: false, isContext: false });
      }
    }

    statusText.textContent = "後処理完了";
    logUI("後処理完了");
  }
});
