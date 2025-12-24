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
const THRESHOLD = 27;        // 全体の変化量
const Z_THRESHOLD = 10;     // Z軸単体のしきい値
const DISTANCE_FILTER_M = 5;
const PRE_N = 3;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let map = null;
let userMarker = null;
let lastPosition = null;
let prevAcc = null;
let recentSamples = [];
let eventMarkers = [];

/* ===== Utility ===== */
function logUI(msg){
  resultText.textContent = msg;
  console.log(msg);
}

function distanceMeters(lat1,lng1,lat2,lng2){
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

/* ===== Map ===== */
function initMap(lat,lng){
  if(map) return;
  map = L.map("map").setView([lat,lng],17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:"© OpenStreetMap contributors"
  }).addTo(map);
  userMarker = L.marker([lat,lng]).addTo(map);
}

function updateMap(lat,lng){
  if(!map) initMap(lat,lng);
  userMarker.setLatLng([lat,lng]);
  map.setView([lat,lng]);
}

/* ===== Firestore ===== */
async function saveEvent(samples){
  await addDoc(collection(db,"raw_sessions"),{
    sessionId,
    createdAt: new Date().toISOString(),
    logs: samples
  });
}

/* ===== Motion ===== */
function handleMotion(e){
  if(!isMeasuring || !lastPosition) return;

  const acc = e.accelerationIncludingGravity;
  if(!acc) return;

  const curr = { x: acc.x||0, y: acc.y||0, z: acc.z||0 };

  if(prevAcc){
    const dx = Math.abs(curr.x - prevAcc.x);
    const dy = Math.abs(curr.y - prevAcc.y);
    const dz = Math.abs(curr.z - prevAcc.z);

    const diff = dx + dy + 3 * dz;

    accelerationText.textContent = `diff=${diff.toFixed(2)} (dz=${dz.toFixed(2)})`;

    const sample = {
      x: curr.x,
      y: curr.y,
      z: curr.z,
      diff,
      lat: lastPosition.latitude,
      lng: lastPosition.longitude,
      timestamp: new Date().toISOString(),
      isEvent: false
    };

    recentSamples.push(sample);
    if(recentSamples.length > 50) recentSamples.shift();

    /* ===== 段差判定 ===== */
    if (
      diff > THRESHOLD &&
      dz > Z_THRESHOLD &&
      dz > dx && dz > dy
    ) {
      // 距離フィルタ
      for(const m of eventMarkers){
        if(distanceMeters(
          m.lat, m.lng,
          sample.lat, sample.lng
        ) < DISTANCE_FILTER_M){
          prevAcc = curr;
          return;
        }
      }

      sample.isEvent = true;
      const context = recentSamples.slice(-PRE_N);
      saveEvent(context);

      const icon = L.divIcon({
        html:"📍",
        className:"red-pin",
        iconSize:[16,16],
        iconAnchor:[8,16]
      });

      L.marker([sample.lat,sample.lng],{icon})
        .addTo(map)
        .bindPopup(`段差検出<br>diff=${diff.toFixed(2)}<br>dz=${dz.toFixed(2)}`);

      eventMarkers.push({lat:sample.lat,lng:sample.lng});
      logUI(`段差検出 diff=${diff.toFixed(2)}`);
    }
  }

  prevAcc = curr;
}

/* ===== GPS ===== */
function startGPS(){
  navigator.geolocation.watchPosition(
    pos=>{
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude,pos.coords.longitude);
      statusText.textContent = "測定中（GPS取得中）";
    },
    err=>{
      console.warn(err);
      statusText.textContent = "位置情報取得エラー";
    },
    { enableHighAccuracy:true }
  );
}

/* ===== Permission ===== */
async function requestMotionPermission(){
  if(typeof DeviceMotionEvent?.requestPermission === "function"){
    const res = await DeviceMotionEvent.requestPermission();
    return res === "granted";
  }
  return true;
}

/* ===== Start / Stop ===== */
startStopBtn.addEventListener("click", async ()=>{
  if(!isMeasuring){
    if(!await requestMotionPermission()){
      alert("加速度センサの許可が必要です");
      return;
    }
    isMeasuring = true;
    sessionId = new Date().toISOString();
    prevAcc = null;
    recentSamples = [];
    eventMarkers = [];
    startStopBtn.textContent = "測定終了";
    statusText.textContent = "測定中...";
    startGPS();
    window.addEventListener("devicemotion",handleMotion);
  } else {
    isMeasuring = false;
    startStopBtn.textContent = "測定開始";
    statusText.textContent = "測定停止";
    window.removeEventListener("devicemotion",handleMotion);
  }
});