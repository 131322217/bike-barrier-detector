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
const STEP_DIFF = 30;
const DISTANCE_FILTER_M = 5;
const PRE_N = 3;
const EVENT_COOLDOWN = 1500;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let map = null;
let userMarker = null;
let lastPosition = null;
let prevAcc = null;
let recentSamples = [];
let eventMarkers = [];
let lastEventTime = 0;
let posHistory = [];

/* ===== Utility ===== */
function logUI(msg){
  resultText.textContent = msg;
}

function distanceMeters(lat1,lng1,lat2,lng2){
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getAngle(p1, p2) {
  return Math.atan2(p2.lng - p1.lng, p2.lat - p1.lat) * 180 / Math.PI;
}

/* ===== Map ===== */
function initMap(lat,lng){
  if(map) return;
  map = L.map("map").setView([lat,lng],17);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  userMarker = L.marker([lat,lng]).addTo(map);
}

function updateMap(lat,lng){
  if(!map) initMap(lat,lng);
  userMarker.setLatLng([lat,lng]);
}

function markerColor(label){
  switch(label){
    case "step": return "red";
    case "curve": return "blue";
    case "flat": return "green";
    case "manual": return "yellow";
    default: return "gray";
  }
}

function popupHTML(label){
  return `
    <div>
      <button class="label-btn step">段差</button>
      <button class="label-btn curve">カーブ</button>
      <button class="label-btn flat">平地</button>
      <p>現在: ${label}</p>
    </div>
  `;
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

    const diff = Math.sqrt(dx*dx + dy*dy + (dz*2)*(dz*2));

    let angleDiff = 0;
    if(posHistory.length >= 3){
      const a1 = getAngle(posHistory[0], posHistory[1]);
      const a2 = getAngle(posHistory[1], posHistory[2]);
      angleDiff = Math.abs(a2 - a1);
    }

    accelerationText.textContent = `diff=${diff.toFixed(2)} dz=${dz.toFixed(2)} angle=${angleDiff.toFixed(1)}`;

    const sample = {
      x: parseFloat(curr.x.toFixed(2)),
      y: parseFloat(curr.y.toFixed(2)),
      z: parseFloat(curr.z.toFixed(2)),
      diff: parseFloat(diff.toFixed(2)),
      angleDiff: parseFloat(angleDiff.toFixed(2)),
      lat: lastPosition.latitude,
      lng: lastPosition.longitude,
      timestamp: new Date().toISOString(),
      isEvent: false,
      type: null
    };

    recentSamples.push(sample);
    if(recentSamples.length>50) recentSamples.shift();

    const now = Date.now();
    if(now - lastEventTime < EVENT_COOLDOWN){
      prevAcc = curr;
      return;
    }

    for(const m of eventMarkers){
      if(distanceMeters(m.lat, m.lng, sample.lat, sample.lng) < DISTANCE_FILTER_M){
        prevAcc = curr;
        return;
      }
    }

    /* 判定ロジック */
    if(diff >= 45){
      if(diff >= 50){
        sample.type = "step";
        logUI("段差検出");
      } else {
        sample.type = "curve";
        logUI("カーブ検出");
      }

      sample.isEvent = true;
      lastEventTime = now;
      saveEvent(recentSamples.slice(-PRE_N));

      const marker = L.circleMarker([sample.lat, sample.lng],{
        radius:8,
        color: markerColor(sample.type),
        fillColor: markerColor(sample.type),
        fillOpacity:0.7
      }).addTo(map);

      marker.bindPopup(popupHTML(sample.type)).openPopup();

      // ポップアップでラベル変更可能
      marker.on("popupopen", async e=>{
        const el = e.popup.getElement();
        el.querySelectorAll(".label-btn").forEach(btn=>{
          btn.onclick = async ()=>{
            const label = btn.classList.contains("step") ? "step" :
                          btn.classList.contains("curve") ? "curve" : "flat";

            marker.setStyle({
              color: markerColor("manual"),
              fillColor: markerColor("manual")
            });

            marker.setPopupContent(popupHTML(label));

            await addDoc(collection(db,"labels"),{
              lat: sample.lat,
              lng: sample.lng,
              label_true: label,
              type_detected: sample.type,
              diff: sample.diff,
              x: sample.x,
              y: sample.y,
              z: sample.z,
              angleDiff: sample.angleDiff,
              sessionId: sessionId,
              updatedAt: new Date().toISOString()
            });
          };
        });
      });

      eventMarkers.push({ lat: sample.lat, lng: sample.lng });
    }
  }

  prevAcc = curr;
}

/* ===== GPS ===== */
function startGPS(){
  navigator.geolocation.watchPosition(
    pos=>{
      lastPosition = pos.coords;
      updateMap(pos.coords.latitude, pos.coords.longitude);

      posHistory.push({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        time: Date.now()
      });
      if(posHistory.length>5) posHistory.shift();

      statusText.textContent = "測定中";
    },
    ()=> statusText.textContent = "GPS取得失敗",
    { enableHighAccuracy:true }
  );
}

/* ===== Start/Stop ===== */
startStopBtn.addEventListener("click", async ()=>{
  const ok = await DeviceMotionEvent?.requestPermission?.() ?? true;
  if(!ok) return alert("加速度センサの許可が必要です");

  if(!isMeasuring){
    isMeasuring = true;
    sessionId = new Date().toISOString();
    prevAcc = null;
    recentSamples = [];
    eventMarkers = [];
    startGPS();
    window.addEventListener("devicemotion", handleMotion);
    startStopBtn.textContent = "測定終了";
  } else {
    isMeasuring = false;
    window.removeEventListener("devicemotion", handleMotion);
    startStopBtn.textContent = "測定開始";
  }
});
