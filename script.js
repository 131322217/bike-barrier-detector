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
const EVENT_DIFF_TRIGGER = 45;
const PRE_N = 5;
const EVENT_COOLDOWN = 1500;
const DISTANCE_FILTER_M = 5;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let map = null;
let userMarker = null;
let lastPosition = null;
let prevAcc = null;
let recentSamples = [];
let lastEventTime = 0;
let eventMarkers = [];

/* ===== Utils ===== */
function logUI(msg) {
  resultText.textContent = msg;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ===== Map ===== */
function initMap(lat, lng) {
  if (map) return;
  map = L.map("map").setView([lat, lng], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  userMarker = L.marker([lat, lng]).addTo(map);
}

function updateMap(lat, lng) {
  if (!map) initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
}

/* ===== 特徴量 ===== */
function calcFeatures(samples) {
  let diffMax = 0;
  let sumDx = 0, sumDy = 0, sumDz = 0;
  let zSigns = [];

  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1];
    const c = samples[i];

    const dx = Math.abs(c.x - p.x);
    const dy = Math.abs(c.y - p.y);
    const dz = Math.abs(c.z - p.z);

    sumDx += dx;
    sumDy += dy;
    sumDz += dz;

    diffMax = Math.max(diffMax, c.diff);
    zSigns.push(Math.sign(c.z));
  }

  const total = sumDx + sumDy + sumDz || 1;

  return {
    diffMax,
    sumDx,
    sumDy,
    sumDz,
    xyRatio: (sumDx + sumDy) / total,
    zRatio: sumDz / total,
    zConsistency: zSigns.every(v => v > 0) || zSigns.every(v => v < 0)
  };
}

/* ===== 分類 ===== */
function classifyEvent(f) {
  if (f.diffMax >= 50 && f.zRatio >= 0.6 && !f.zConsistency) return "step";
  if (f.diffMax >= 45 && f.zRatio >= 0.6 && f.zConsistency) return "hill";
  if (f.diffMax >= 35 && f.xyRatio >= 0.6) return "curve";
  return "flat";
}

/* ===== Firestore ===== */
async function saveEvent(eventSamples, features, autoLabel) {
  return await addDoc(collection(db, "raw_events"), {
    sessionId,
    autoLabel,
    features,
    lat: eventSamples.at(-1).lat,
    lng: eventSamples.at(-1).lng,
    samples: eventSamples,
    createdAt: new Date().toISOString()
  });
}

/* ===== Marker ===== */
function createMarker(sample, autoLabel, eventId) {
  const color =
    autoLabel === "step" ? "red" :
    autoLabel === "hill" ? "orange" :
    autoLabel === "curve" ? "blue" : "gray";

  const m = L.circleMarker([sample.lat, sample.lng], {
    radius: 8,
    color,
    fillColor: color,
    fillOpacity: 0.7
  }).addTo(map);

  m.bindPopup(`
    <b>自動判定:</b> ${autoLabel}<br><br>
    <b>正解入力</b><br>
    <button onclick="saveGT('${eventId.id}','step')">段差</button>
    <button onclick="saveGT('${eventId.id}','hill')">坂</button>
    <button onclick="saveGT('${eventId.id}','curve')">カーブ</button>
    <button onclick="saveGT('${eventId.id}','flat')">平地</button>
  `);

  eventMarkers.push({ lat: sample.lat, lng: sample.lng });
}

/* ===== 正解保存 ===== */
window.saveGT = async (eventId, gt) => {
  await addDoc(collection(db, "event_labels"), {
    eventId,
    groundTruth: gt,
    labeledAt: new Date().toISOString()
  });
  alert("正解を保存しました");
};

/* ===== Motion ===== */
function handleMotion(e) {
  if (!isMeasuring || !lastPosition) return;
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;

  const curr = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };

  if (prevAcc) {
    const dx = curr.x - prevAcc.x;
    const dy = curr.y - prevAcc.y;
    const dz = curr.z - prevAcc.z;
    const diff = Math.sqrt(dx*dx + dy*dy + (dz*2)*(dz*2));

    accelerationText.textContent = `diff=${diff.toFixed(1)}`;

    const sample = {
      x:+curr.x.toFixed(2),
      y:+curr.y.toFixed(2),
      z:+curr.z.toFixed(2),
      diff:+diff.toFixed(2),
      lat:lastPosition.latitude,
      lng:lastPosition.longitude,
      timestamp:new Date().toISOString()
    };

    recentSamples.push(sample);
    if (recentSamples.length > 50) recentSamples.shift();

    const now = Date.now();
    if (now - lastEventTime > EVENT_COOLDOWN && diff >= EVENT_DIFF_TRIGGER) {
      const eventSamples = recentSamples.slice(-PRE_N);
      const features = calcFeatures(eventSamples);
      const autoLabel = classifyEvent(features);

      saveEvent(eventSamples, features, autoLabel).then(ref => {
        createMarker(sample, autoLabel, ref);
      });

      lastEventTime = now;
      logUI(`${autoLabel} 検出`);
    }
  }
  prevAcc = curr;
}

/* ===== GPS ===== */
function startGPS() {
  navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude, pos.coords.longitude);
      statusText.textContent = "測定中";
    },
    () => statusText.textContent = "GPS失敗",
    { enableHighAccuracy: true }
  );
}

/* ===== Start / Stop ===== */
startStopBtn.onclick = async () => {
  const ok = await DeviceMotionEvent?.requestPermission?.() ?? true;
  if (!ok) return alert("センサ許可が必要");

  if (!isMeasuring) {
    isMeasuring = true;
    sessionId = new Date().toISOString();
    recentSamples = [];
    eventMarkers = [];
    prevAcc = null;
    startGPS();
    window.addEventListener("devicemotion", handleMotion);
    startStopBtn.textContent = "測定終了";
  } else {
    isMeasuring = false;
    window.removeEventListener("devicemotion", handleMotion);
    startStopBtn.textContent = "測定開始";
  }
};
