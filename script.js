import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, updateDoc, setDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

// Firebase設定
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
const accelValue = document.getElementById("accelerationValue");

// 測定管理
let isMeasuring = false;
let prevAcc = null;
const accThreshold = 0.5;

// セッション
let sessionId = null;

// バッチ
let batchPoints = [];
const BATCH_SIZE = 5;

// セッションID生成
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}-${min}`;
}

// Firestoreへ5件まとめて送信
async function sendBatchToFirestore() {
  if (batchPoints.length === 0) return;

  const docRef = doc(db, "barriers", sessionId);

  try {
    await updateDoc(docRef, {
      points: arrayUnion(...batchPoints)
    });
  } catch (e) {
    // ドキュメントがまだ存在しない場合 setDoc で作成
    await setDoc(docRef, {
      points: batchPoints
    });
  }

  console.log(`Firestoreへ ${batchPoints.length} 件送信完了`);
  batchPoints = [];
}

// 加速度データ処理
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  accelValue.textContent = total.toFixed(1);

  if (prevAcc !== null) {
    const diff = Math.abs(total - prevAcc);

    if (diff > accThreshold) {
      navigator.geolocation.getCurrentPosition((pos) => {
        batchPoints.push({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accelerationChange: diff.toFixed(1),
          timestamp: new Date()
        });

        if (batchPoints.length >= BATCH_SIZE) {
          sendBatchToFirestore();
        }
      });
    }
  }
  prevAcc = total;
}

// iOS permission
function requestSensorPermission() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    DeviceMotionEvent.requestPermission().then((state) => {
      if (state === "granted") {
        window.addEventListener("devicemotion", handleMotion);
      } else {
        alert("加速度センサーの許可が必要です");
      }
    });
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// ボタン動作
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    // 開始
    const now = new Date();
    sessionId = generateSessionId(now);
    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";

    prevAcc = null;
    batchPoints = [];

    requestSensorPermission();
  } else {
    // 終了
    statusText.textContent = "測定していません";
    startStopBtn.textContent = "測定開始";

    window.removeEventListener("devicemotion", handleMotion);

    // バッチに残っていたら送信
    sendBatchToFirestore();
  }
});
