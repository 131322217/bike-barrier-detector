import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ===== Firebase 設定 ===== */
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
const THRESHOLD = 1.0;   // diff > THRESHOLD => event
const PRE_N = 3;         // 前3件補助データ
const PERIODIC_MS = 1000;

/* ===== 状態 ===== */
let isMeasuring = false;
let sessionId = null;
let watchId = null;
let map = null;
let userMarker = null;
let lastPosition = null;
let prevTotal = null;
let sampleCounter = 0;
let recentSamples = [];
let periodicTimer = null;

/* ===== ヘルパー ===== */
function logUI(msg){
  if(resultText) resultText.textContent = msg;
  console.log(msg);
}

function initMap(lat,lng){
  if(!map){
    map = L.map("map").setView([lat,lng],17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:"© OpenStreetMap contributors"
    }).addTo(map);
    userMarker = L.marker([lat,lng]).addTo(map);
  }
}

function updateMap(lat,lng){
  if(!map) return initMap(lat,lng);
  userMarker.setLatLng([lat,lng]);
  map.setView([lat,lng]);
}

async function saveSampleToFirestore(samples){
  // samples: 配列 of { x,y,z,total,diff,lat,lng,timestamp }
  const batchDoc = {
    sessionId,
    timestamp: new Date().toISOString(),
    logs: samples.map(s=>({
      x: s.x,
      y: s.y,
      z: s.z,
      total: s.total,
      diff: s.diff,
      lat: s.lat,
      lng: s.lng,
      isEvent: s.isEvent || false,
      isContext: s.isContext || false
    }))
  };
  try{
    await addDoc(collection(db,"raw_sessions"), batchDoc);
    logUI(`Firestore 保存: ${samples.length} 件`);
  } catch(e){
    console.error("Firestore 保存失敗", e);
  }
}

/* ===== データ管理 ===== */
function pushRecentSample(sample){
  recentSamples.push(sample);
  if(recentSamples.length>100) recentSamples.shift();
}

function getLastNSamples(n){
  return recentSamples.slice(-n);
}

/* ===== Permission (iOS) ===== */
async function requestMotionPermissionIfNeeded(){
  if(typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"){
    try{
      const resp = await DeviceMotionEvent.requestPermission();
      return resp==="granted";
    } catch(e){
      console.warn("DeviceMotion permission error:", e);
      return false;
    }
  }
  return true;
}

/* ===== devicemotion handler ===== */
function handleMotion(event){
  if(!isMeasuring) return;

  const accObj = event.acceleration && event.acceleration.x !== null ? event.acceleration : (event.accelerationIncludingGravity || null);
  if(!accObj) return;

  const x = accObj.x ?? 0;
  const y = accObj.y ?? 0;
  const z = accObj.z ?? 0;
  const total = Math.abs(x)+Math.abs(y)+Math.abs(z);
  const diff = prevTotal!==null?Math.abs(total-prevTotal):0;
  prevTotal = total;

  const sample = {
    id: sampleCounter++,
    x,y,z,total,diff,
    lat:lastPosition?lastPosition.latitude:null,
    lng:lastPosition?lastPosition.longitude:null,
    timestamp:new Date(),
    isEvent:false,
    isContext:false
  };

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)} (diff: ${diff.toFixed(2)})`;
  pushRecentSample(sample);

  if(diff>THRESHOLD){
    logUI(`イベント検出 diff=${diff.toFixed(2)}`);

    // 前N件取得
    const preSamples = getLastNSamples(PRE_N);
    preSamples.forEach(s=>s.isContext=true);

    sample.isEvent=true;

    // 保存まとめ
    saveSampleToFirestore([...preSamples,sample]);

    // 小さめ赤ピン
    if(sample.lat!==null && sample.lng!==null){
      try{
        if(!map) initMap(sample.lat,sample.lng);
        const pinIcon = L.divIcon({
          className:"red-pin",
          html:"📍",
          iconSize:[16,16],
          iconAnchor:[8,16]
        });
        L.marker([sample.lat,sample.lng],{icon:pinIcon})
          .addTo(map)
          .bindPopup(`Event: ${diff.toFixed(2)}`);
      } catch(e){
        console.warn("map marker error:", e);
      }
    }
  }
}

/* ===== GPS tracking ===== */
function startTrackingPosition(){
  if(!navigator.geolocation){ logUI("位置情報が利用できません"); return; }
  watchId = navigator.geolocation.watchPosition(
    pos=>{
      lastPosition = pos.coords;
      if(!map) initMap(lastPosition.latitude,lastPosition.longitude);
      updateMap(lastPosition.latitude,lastPosition.longitude);
      statusText.textContent = `測定中… 位置あり (${lastPosition.latitude.toFixed(5)},${lastPosition.longitude.toFixed(5)})`;
    },
    err=>{
      console.warn("位置情報エラー",err);
      logUI("位置取得エラー: "+(err.message||err.code));
    },
    {enableHighAccuracy:true,maximumAge:2000,timeout:10000}
  );
}

function stopTrackingPosition(){
  if(watchId!==null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
}

/* ===== Session ID ===== */
function makeSessionId(){
  return new Date().toISOString().replace(/[:.]/g,"-");
}

/* ===== Start/Stop measurement ===== */
startStopBtn.addEventListener("click",async ()=>{
  if(!isMeasuring){
    const motionOK = await requestMotionPermissionIfNeeded();
    if(!motionOK){ alert("加速度センサーの権限が必要です"); return; }

    sessionId = makeSessionId();
    logUI("セッション開始: "+sessionId);

    recentSamples=[];
    prevTotal=null;
    sampleCounter=0;

    isMeasuring=true;
    startStopBtn.textContent="測定終了";
    statusText.textContent="測定中…";

    navigator.geolocation.getCurrentPosition(
      pos=>{
        lastPosition=pos.coords;
        initMap(lastPosition.latitude,lastPosition.longitude);
        startTrackingPosition();
      },
      err=>{
        console.warn("getCurrentPosition failed",err);
        startTrackingPosition();
      },
      {enableHighAccuracy:true,timeout:5000}
    );

    window.addEventListener("devicemotion",handleMotion);
  } else {
    isMeasuring=false;
    startStopBtn.textContent="測定開始";
    statusText.textContent="測定停止 → 後処理中...";

    window.removeEventListener("devicemotion",handleMotion);
    stopTrackingPosition();

    // 未保存のサンプルは捨てる（イベントのみ保存なので）
    logUI("後処理完了");
    statusText.textContent="後処理完了";
  }
});
