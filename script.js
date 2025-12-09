import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128",
  storageBucket: "bike-barrier-detector-1e128.appspot.com",
  messagingSenderId: "556503472203",
  appId: "1:556503472203:web:d248c2bd6f5773ea9dd5ce"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");

let isMeasuring = false;
let prevAcc = null;
let currentPos = null;
const accelerationThreshold = 0.5;

let map;
let userMarker;

// sessionID
let sessionId = null;

// map初期設定
function initMap() {
  map = L.map("map").setView([35.0, 135.0], 15); // 仮位置

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png")
    .addTo(map);

  userMarker = L.circleMarker([35.0, 135.0], {
    radius: 6
  }).addTo(map);
}

// 位置取得
function trackPosition() {
  navigator.geolocation.watchPosition(pos => {
    currentPos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };
    if (map) {
      userMarker.setLatLng(currentPos);
      map.setView(currentPos);
    }
  });
}

// save
async function saveEventData(point) {
  if (!sessionId) return;
  const docRef = doc(db, "barriers", sessionId);
  await setDoc(docRef, { points: arrayUnion(point) }, { merge: true });
}

// 加速度処理
function handleMotion(event) {
  if (!isMeasuring) return;
  if (!currentPos) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  const x = acc.x, y = acc.y, z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let totalDiff = 0;
  if (prevAcc) {
    totalDiff = Math.abs(total - prevAcc.total);
  }
  prevAcc = { x, y, z, total };

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;

  if (totalDiff > accelerationThreshold) {
    const point = {
      lat: currentPos.lat,
      lng: currentPos.lng,
      total,
      totalDiff,
      timestamp: new Date()
    };

    // 保存
    saveEventData(point);

    // マーカー表示
    L.marker([point.lat, point.lng]).addTo(map)
      .bindPopup(`段差! ${totalDiff.toFixed(2)}`);
  }
}

// ボタン
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionId = "session_" + Date.now();
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    prevAcc = null;
    requestPermission();
    trackPosition();
  } else {
    statusText.textContent = "測定終了";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);
  }
});

// iOS permission
function requestPermission() {
  if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === "granted") {
          window.addEventListener("devicemotion", handleMotion);
        }
      });
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// ページ起動時
initMap();
