import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase 初期化
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM取得
const startStopBtn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");
const resultText = document.getElementById("resultText");

// 状態管理
let isMeasuring = false;
let prevAcc = null;
let lastPosition = null;
let watchId = null;
let logTimer = null;

const eventThreshold = 3;      // diff > 3 → event
const normalInterval = 1000;   // 通常ログ 1秒おき

let sessionId = null;

// 地図関係
let map = null;
let userMarker = null;

// 地図初期化
function initMap(lat, lng) {
  map = L.map("map").setView([lat, lng], 17);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  userMarker = L.marker([lat, lng]).addTo(map);
}

// 地図更新
function updateMap(lat, lng) {
  if (!map) return initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);
}

// Firestoreにデータ保存（raw セッション用）
async function saveRaw(data) {
  await addDoc(collection(db, `raw_sessions/${sessionId}/raw_logs`), data);
}

// 加速度センサー処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  let x = acc.x;
  let y = acc.y;
  let z = acc.z;
  let total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;

  if (prevAcc === null) {
    prevAcc = total;
    return;
  }

  const diff = Math.abs(total - prevAcc);
  prevAcc = total;

  const isEvent = diff > eventThreshold;

  if (lastPosition) {
    saveRaw({
      x, y, z, total, diff, isEvent,
      lat: lastPosition.latitude,
      lng: lastPosition.longitude,
      timestamp: new Date()
    });

    // イベントを地図に表示
    if (isEvent) {
      L.marker([lastPosition.latitude, lastPosition.longitude], {
        icon: L.divIcon({
          className: "red-pin",
          html: "📍"
        })
      }).addTo(map);
    }
  }
}

// 通常ログ（1秒おき）
async function saveNormalLog() {
  if (!lastPosition || !isMeasuring) return;

  saveRaw({
    type: "normal",
    lat: lastPosition.latitude,
    lng: lastPosition.longitude,
    timestamp: new Date()
  });
}

// GPS追跡
function trackPosition() {
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos.coords;
      updateMap(lastPosition.latitude, lastPosition.longitude);
    }
  );
}

// ---- 後処理 ----
async function postProcess() {
  resultText.textContent = "後処理中…";

  const snap = await getDocs(collection(db, `raw_sessions/${sessionId}/raw_logs`));

  const docs = [];
  snap.forEach((d) => docs.push({ id: d.id, ...d.data() }));

  // ※あなたの本命ロジックはここに組み込む（Nの前3件削除など）
  // いったんは "イベント以外は削除しない" だけ実装
  for (let d of docs) {
    if (!d.isEvent) {
      await deleteDoc(doc(db, `raw_sessions/${sessionId}/raw_logs`, d.id));
    }
  }

  resultText.textContent = "後処理完了！";
}

// ---- ボタン操作 ----
startStopBtn.addEventListener("click", async () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    // セッション開始
    sessionId = new Date().toISOString().replace(/[:.]/g, "-");

    statusText.textContent = "測定中…";
    resultText.textContent = "";

    prevAcc = null;

    // iOS の加速度 permission
    if (typeof DeviceMotionEvent?.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== "granted") {
        alert("加速度センサーの使用を許可してください");
        return;
      }
    }

    navigator.geolocation.getCurrentPosition((pos) => {
      lastPosition = pos.coords;
      initMap(lastPosition.latitude, lastPosition.longitude);
      trackPosition();
    });

    window.addEventListener("devicemotion", handleMotion);

    logTimer = setInterval(saveNormalLog, normalInterval);

    startStopBtn.textContent = "測定終了";

  } else {
    statusText.textContent = "測定停止中…";
    startStopBtn.textContent = "測定開始";

    window.removeEventListener("devicemotion", handleMotion);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (logTimer) clearInterval(logTimer);

    await postProcess(); // 後処理
  }
});
