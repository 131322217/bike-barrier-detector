import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase初期化
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
const startStopBtn = document.getElementById('startStopBtn');
const statusText = document.getElementById('statusText');
const accelerationText = document.getElementById('accelerationText');

let isMeasuring = false;
let prevAcc = null;
const accelerationThreshold = 0.5;

let dataArray = [];
let intervalId = null;
let sessionId = null;

function generateSessionId() {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth()+1)
    .toString().padStart(2,'0')}-${d.getDate()
    .toString().padStart(2,'0')}_${d.getHours()
    .toString().padStart(2,'0')}-${d.getMinutes()
    .toString().padStart(2,'0')}-${d.getSeconds()
    .toString().padStart(2,'0')}`;
}

async function saveToFirestore() {
  if (!sessionId) return;
  const docRef = doc(db, "sessions", sessionId);
  await setDoc(docRef, { data: dataArray }, { merge: true });
  console.log("保存中", dataArray.length);
}

// データ整理（終了時に実行）
async function cleanupFirestore() {
  const docRef = doc(db, "sessions", sessionId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;

  const original = snap.data().data;
  let cleaned = [];
  let eventStreak = 0;

  for (const p of original) {
    if (p.isEvent) {
      cleaned.push(p);
      eventStreak = 0;
    } else {
      eventStreak++;
      if (eventStreak <= 2) cleaned.push(p); // イベント前後2件だけ残す
    }
  }

  await setDoc(docRef, { data: cleaned }, { merge: true });
  console.log("不要データ削除 => ", cleaned.length);
  alert("不要データ削除完了！");
}

// 加速度処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null) return;

  const { x, y, z } = acc;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let totalDiff = 0;
  if (prevAcc) {
    totalDiff = Math.abs(total - prevAcc.total);
  }

  const point = {
    x, y, z,
    total,
    totalDiff,
    isEvent: totalDiff > accelerationThreshold,
    ts: Date.now()
  };

  dataArray.push(point);
  prevAcc = { x, y, z, total };

  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;
}

function requestPermission() {
  if (typeof DeviceMotionEvent !== "undefined" 
      && DeviceMotionEvent.requestPermission) {
    DeviceMotionEvent.requestPermission().then(state => {
      if (state === "granted") {
        window.addEventListener("devicemotion", handleMotion);
      }
    });
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// Start / Stop
startStopBtn.addEventListener("click", async () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    sessionId = generateSessionId();
    dataArray = [];
    prevAcc = null;
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";
    requestPermission();

    intervalId = setInterval(saveToFirestore, 1000);

  } else {
    statusText.textContent = "測定終了";
    startStopBtn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);

    clearInterval(intervalId);
    await saveToFirestore();
    await cleanupFirestore();
  }
});
