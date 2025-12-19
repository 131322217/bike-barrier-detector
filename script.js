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
const THRESHOLD = 3.5;          // 加速度差分の閾値
const PRE_N = 3;
const MIN_EVENT_DISTANCE = 10; // m（距離フィルタ）

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let watchId = null;
let map = null;
let userMarker = null;
let lastPosition = null;
let prevTotal = null;
let recentSamples = [];
let lastEventPosition = null;

/* ===== util ===== */
function logUI(msg){
  resultText.textContent = msg;
  console.log(msg);
}

function calcDistance(lat1, lng1, lat2, lng2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ===== Map ===== */
function initMap(lat, lng){
  map = L.map("map").setView([lat, lng], 17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:"© OpenStreetMap contributors"
  }).addTo(map);
  userMarker = L.marker([lat, lng]).addTo(map);
}

function updateMap(lat, lng){
  if(!map) initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
}

/* ===== Firestore ===== */
async function saveSample(samples){
  await addDoc(collection(db, "raw_sessions"), {
    sessionId,
    createdAt: new Date().toISOString(),
    logs: samples
  });
}

/* ===== motion ===== */
function handleMotion(e){
  if(!isMeasuring || !lastPosition) return;

  const acc = e.acceleration || e.accelerationIncludingGravity;
  if(!acc) return;

  const x = acc.x ?? 0;
  const y = acc.y ?? 0;
  const z = acc.z ?? 0;

  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const diff = prevTotal !== null ? Math.abs(total - prevTotal) : 0;
  prevTotal = total;

  accelerationText.textContent =
    `加速度合計: ${total.toFixed(2)} (diff: ${diff.toFixed(2)})`;

  const sample = {
    x, y, z, total, diff,
    lat: lastPosition.latitude,
    lng: lastPosition.longitude,
    timestamp: new Date().toISOString(),
    isEvent: false
  };

  recentSamples.push(sample);
  if(recentSamples.length > 50) recentSamples.shift();

  if(diff > THRESHOLD){
    // 距離フィルタ
    if(lastEventPosition){
      const d = calcDistance(
        lastEventPosition.lat,
        lastEventPosition.lng,
        sample.lat,
        sample.lng
      );
      if(d < MIN_EVENT_DISTANCE){
        logUI(`イベント無視（距離 ${d.toFixed(1)}m）`);
        return;
      }
    }

    sample.isEvent = true;
    lastEventPosition = { lat: sample.lat, lng: sample.lng };

    const pre = recentSamples.slice(-PRE_N);
    saveSample([...pre, sample]);

    const icon = L.divIcon({
      className: "red-pin",
      html: "📍",
      iconSize: [16,16],
      iconAnchor: [8,16]
    });
    L.marker([sample.lat, sample.lng], { icon }).addTo(map)
      .bindPopup(`diff=${diff.toFixed(2)}`);

    logUI("段差検出！");
  }
}

/* ===== GPS ===== */
function startGPS(){
  watchId = navigator.geolocation.watchPosition(
    pos => {
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude, pos.coords.longitude);
      statusText.textContent = "測定中…";
    },
    err => logUI("GPSエラー"),
    { enableHighAccuracy: true }
  );
}

function stopGPS(){
  if(watchId) navigator.geolocation.clearWatch(watchId);
}

/* ===== Start / Stop ===== */
startStopBtn.onclick = async () => {
  if(!isMeasuring){
    if(DeviceMotionEvent?.requestPermission){
      const p = await DeviceMotionEvent.requestPermission();
      if(p !== "granted") return;
    }

    isMeasuring = true;
    startStopBtn.textContent = "測定終了";
    recentSamples = [];
    prevTotal = null;
    lastEventPosition = null;
    sessionId = new Date().toISOString();

    navigator.geolocation.getCurrentPosition(pos=>{
      lastPosition = pos.coords;
      initMap(pos.coords.latitude, pos.coords.longitude);
      startGPS();
    });

    window.addEventListener("devicemotion", handleMotion);
  } else {
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);
    stopGPS();
    statusText.textContent = "測定停止";
  }
};
