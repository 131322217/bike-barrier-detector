// script.js
// 前3件 + 後3件（後続は取れた分だけ取る）
// threshold = 1.0 (diff)
// 保存先: raw_sessions/{sessionId}/raw_logs
// マップ表示: event のみ赤マーカー

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
const resultText = document.getElementById("resultText"); // optional area for messages, if present

/* ===== 設定 ===== */
const THRESHOLD = 1.0;           // diff > THRESHOLD => event (you set 1.0)
const PRE_N = 3;                 // 前3件
const AFTER_N = 3;               // 後3件
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

// after-collection 状態
let afterPending = false;
let afterNeeded = 0;
let afterCollected = []; // collected samples for after context

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

// Firestore に1サンプルを保存（flags: isEvent, isContext, isAfter）
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
      isContext: !!flags.isContext,
      isAfter: !!flags.isAfter
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
  // other platforms don't require explicit permission
  return true;
}

/* ===== devicemotion handler ===== */
async function handleMotion(event) {
  if (!isMeasuring) return;

  // choose acceleration (prefer non-null acceleration)
  const accObj = event.acceleration && event.acceleration.x !== null ? event.acceleration : (event.accelerationIncludingGravity || null);
  if (!accObj) return;

  const x = accObj.x ?? 0;
  const y = accObj.y ?? 0;
  const z = accObj.z ?? 0;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  // diff vs prevTotal
  let diff = 0;
  if (prevTotal !== null) diff = Math.abs(total - prevTotal);
  prevTotal = total;

  // create sample
  const sample = {
    id: sampleCounter++,
    x, y, z, total, diff,
    lat: lastPosition ? lastPosition.latitude : null,
    lng: lastPosition ? lastPosition.longitude : null,
    timestamp: new Date(),
    saved: false
  };

  // show UI
  accelerationText.textContent = `加速度合計: ${total.toFixed(2)} (diff: ${diff.toFixed(2)})`;

  // push into recent buffer
  pushRecentSample(sample);

  // if currently collecting after-samples (afterPending), treat this sample as after-collected
  if (afterPending) {
    afterCollected.push(sample);

    // If we've collected enough after samples, save them (as context after)
    if (afterCollected.length >= afterNeeded) {
      // Save afterCollected as context (isAfter=true, isContext=true)
      for (const s of afterCollected) {
        if (!s.saved) {
          await saveSampleToFirestore(s, { isEvent: false, isContext: true, isAfter: true });
        }
      }
      afterPending = false;
      afterCollected = [];
      afterNeeded = 0;
      logUI("後続データ保存完了");
    }
    // Important: do not process this sample further (e.g. periodic save) while in after collection
    return;
  }

  // Event detection
  if (prevTotal !== null && diff > THRESHOLD) {
    // If an after-collection was pending from previous event, it should have been handled earlier.
    // But if we find a new event while afterPending is true, spec says: discard previous afterCollected
    // We already returned above if afterPending; so here afterPending is false.
    // However we need to check if a previous after collection was being built but hadn't been saved (not possible due to logic).
    // Handle new event:

    logUI(`イベント検出 diff=${diff.toFixed(2)}`);

    // 1) Save pre-context: take up to PRE_N previous samples (excluding current sample)
    const beforeSamples = getLastNSamples(PRE_N, sample.id);
    for (const s of beforeSamples) {
      if (!s.saved) {
        await saveSampleToFirestore(s, { isEvent: false, isContext: true, isAfter: false });
      }
    }

    // 2) Save the event sample itself (isEvent: true)
    if (!sample.saved) {
      await saveSampleToFirestore(sample, { isEvent: true, isContext: false, isAfter: false });
    }

    // 3) Put red marker on map if we have coordinates
    if (sample.lat !== null && sample.lng !== null) {
      try {
        if (!map) initMap(sample.lat, sample.lng);
        L.circleMarker([sample.lat, sample.lng], { radius: 6, color: 'red', fillColor: 'red', fillOpacity: 0.9 })
          .addTo(map).bindPopup(`Event: ${diff.toFixed(2)}`).openPopup();
      } catch (e) {
        console.warn("map marker error:", e);
      }
    }

    // 4) Start collecting after-samples up to AFTER_N
    afterPending = true;
    afterNeeded = AFTER_N;
    afterCollected = [];
    logUI(`後続${AFTER_N}件を収集中...`);
    // Note: while afterPending === true, periodic normal saving is skipped (see periodicSaveTick)
    return;
  }

  // If not event and not in afterPending, don't immediately save this sample to Firestore here.
  // Periodic timer will save a snapshot every PERIODIC_MS to avoid too many writes.
}

/* ===== Periodic normal save (1s) =====
   Skips saving while we are collecting 'after' samples,
   to avoid saving samples that should become after-context.
*/
async function periodicSaveTick() {
  if (!isMeasuring) return;
  if (afterPending) return; // don't save while collecting after-samples

  // latest sample
  if (recentSamples.length === 0) return;
  const latest = recentSamples[recentSamples.length - 1];
  if (latest.saved) return;

  // save latest as normal (isEvent=false, isContext=false)
  await saveSampleToFirestore(latest, { isEvent: false, isContext: false, isAfter: false });
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
      // also update UI for location
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
    // start
    const motionOK = await requestMotionPermissionIfNeeded();
    if (!motionOK) {
      alert("加速度センサーの権限が必要です（iOSの場合は許可を押してください）");
      return;
    }

    // set session id
    sessionId = makeSessionId();
    logUI("セッション開始: " + sessionId);

    // reset states
    recentSamples = [];
    prevTotal = null;
    sampleCounter = 0;
    afterPending = false;
    afterCollected = [];
    afterNeeded = 0;

    isMeasuring = true;
    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中…";

    // start GPS & motion
    navigator.geolocation.getCurrentPosition((pos) => {
      lastPosition = pos.coords;
      initMap(lastPosition.latitude, lastPosition.longitude);
      startTrackingPosition();
    }, (err) => {
      console.warn("getCurrentPosition failed", err);
      startTrackingPosition(); // still try watch
    }, { enableHighAccuracy: true, timeout: 5000 });

    window.addEventListener("devicemotion", handleMotion);
    periodicTimer = setInterval(periodicSaveTick, PERIODIC_MS);

  } else {
    // stop
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "測定停止 → 後処理中...";
    logUI("停止: 後処理開始");

    // detach handlers
    window.removeEventListener("devicemotion", handleMotion);
    stopTrackingPosition();
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }

    // If we are in afterPending and have collected some afterCollected samples but not enough,
    // we should save whatever we have (since session ended). Spec said "取れそうなら取る".
    if (afterPending && afterCollected.length > 0) {
      for (const s of afterCollected) {
        if (!s.saved) {
          await saveSampleToFirestore(s, { isEvent: false, isContext: true, isAfter: true });
        }
      }
      afterPending = false;
      afterCollected = [];
      logUI("測定終了時に未満の後続データを保存しました");
    }

    // final: maybe save unsaved latest samples? We'll save any unsaved sample (optional)
    // but to avoid duplication, only save those not saved
    for (const s of recentSamples) {
      if (!s.saved) {
        await saveSampleToFirestore(s, { isEvent: false, isContext: false, isAfter: false });
      }
    }

    statusText.textContent = "後処理完了";
    logUI("後処理完了");
  }
});
