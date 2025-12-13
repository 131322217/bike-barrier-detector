import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ===== Firebase ===== */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID"
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
const END_NORMAL_COUNT = 3;
const EVENT_SAVE_INTERVAL_MS = 800;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let prevTotal = null;

let inEvent = false;
let normalCount = 0;
let eventBuffer = [];
let lastEventSaveTime = 0;

let lastPosition = null;
let map = null;

/* ===== UI Log ===== */
function logUI(msg) {
  if (resultText) {
    resultText.textContent = msg;
  }
}

/* ===== Map ===== */
function initMap(lat, lng) {
  if (!map) {
    map = L.map("map").setView([lat, lng], 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  }
}

function eventPin(lat, lng, diff) {
  let size = diff < 3.5 ? 14 : diff < 5.0 ? 18 : 24;

  const icon = L.divIcon({
    html: "📍",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    className: ""
  });

  L.marker([lat, lng], { icon }).addTo(map);
}

/* ===== Firestore ===== */
async function sendEventToFirestore(logs) {
  if (logs.length === 0) return;

  await addDoc(collection(db, "event_sessions"), {
    sessionId,
    createdAt: new Date().toISOString(),
    logs
  });

  logUI(`イベント送信 (${logs.length}件)`);
}

/* ===== Motion ===== */
function handleMotion(e) {
  if (!isMeasuring) return;

  const acc = e.acceleration || e.accelerationIncludingGravity;
  if (!acc) return;

  const x = acc.x ?? 0;
  const y = acc.y ?? 0;
  const z = acc.z ?? 0;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const diff = prevTotal === null ? 0 : Math.abs(total - prevTotal);
  prevTotal = total;

  accelerationText.textContent = `total:${total.toFixed(2)} diff:${diff.toFixed(2)}`;

  const now = Date.now();

  /* ===== イベント中 ===== */
  if (diff >= THRESHOLD) {
    normalCount = 0;

    if (!inEvent) {
      inEvent = true;
      eventBuffer = [];
      logUI("イベント開始");
    }

    if (now - lastEventSaveTime > EVENT_SAVE_INTERVAL_MS) {
      const log = {
        isEvent: true,
        diff,
        x, y, z,
        total,
        lat: lastPosition?.latitude ?? null,
        lng: lastPosition?.longitude ?? null,
        timestamp: new Date().toISOString()
      };

      eventBuffer.push(log);
      lastEventSaveTime = now;

      if (log.lat && log.lng) {
        initMap(log.lat, log.lng);
        eventPin(log.lat, log.lng, diff);
      }
    }
    return;
  }

  /* ===== 通常状態 ===== */
  if (inEvent) {
    normalCount++;
    if (normalCount >= END_NORMAL_COUNT) {
      inEvent = false;
      normalCount = 0;
      sendEventToFirestore(eventBuffer);
      eventBuffer = [];
    }
  }
}

/* ===== GPS ===== */
function startGPS() {
  navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos.coords;
      initMap(pos.coords.latitude, pos.coords.longitude);
    },
    console.warn,
    { enableHighAccuracy: true }
  );
}

/* ===== Session ===== */
function makeSessionId() {
  return new Date().toISOString();
}

/* ===== Start / Stop ===== */
startStopBtn.onclick = async () => {
  if (!isMeasuring) {
    sessionId = makeSessionId();
    isMeasuring = true;
    prevTotal = null;

    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中";

    startGPS();
    window.addEventListener("devicemotion", handleMotion);
  } else {
    isMeasuring = false;

    window.removeEventListener("devicemotion", handleMotion);
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "停止";

    if (inEvent && eventBuffer.length > 0) {
      sendEventToFirestore(eventBuffer);
    }

    inEvent = false;
    eventBuffer = [];
    logUI("測定終了");
  }
};
