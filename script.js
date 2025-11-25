import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const accelerationText = document.getElementById("accelerationText");
const statusText = document.getElementById("statusText");
const startStopBtn = document.getElementById("startStopBtn");
const errorBox = document.getElementById("errorBox");

// エラー表示
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = "block";
}

// エラー非表示
function clearError() {
  errorBox.style.display = "none";
}

// 計測用
let isMeasuring = false;
let prevAcceleration = null;
const accelerationThreshold = 0.5;

// バッチ送信用
let batchPoints = [];
const BATCH_SIZE = 5;

let sessionId = null;

// セッションID生成 YYYY-MM-DD_HH-MM
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}-${min}`;
}

// Firestoreへバッチ送信
async function saveBatch() {
  if (!sessionId || batchPoints.length === 0) return;

  const docRef = doc(db, "barriers", sessionId);

  try {
    await updateDoc(docRef, {
      points: arrayUnion(...batchPoints)
    }).catch(async () => {
      await updateDoc(docRef, {
        points: arrayUnion(...batchPoints)
      });
    });

    console.log(`送信成功: ${batchPoints.length}件`);
    batchPoints = [];
  } catch (e) {
    showError("Firestore保存でエラーが発生しました: " + e.message);
  }
}

// 加速度イベント
function handleMotion(event) {
  try {
    if (!isMeasuring) return;
    clearError();

    const acc = event.acceleration;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) {
      showError("加速度データが取得できません");
      return;
    }

    const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
    accelerationText.textContent = total.toFixed(1);

    if (prevAcceleration !== null) {
      const diff = Math.abs(total - prevAcceleration);

      if (diff > accelerationThreshold) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            batchPoints.push({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accelerationChange: diff.toFixed(1),
              timestamp: new Date()
            });

            if (batchPoints.length >= BATCH_SIZE) {
              saveBatch();
            }
          },
          (err) => showError("位置情報エラー: " + err.message),
          { enableHighAccuracy: true }
        );
      }
    }

    prevAcceleration = total;
  } catch (err) {
    showError("加速度処理中にエラー: " + err.message);
  }
}

// iOS用 permission
function requestPermissionIfNeeded() {
  try {
    clearError();

    if (typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function") {

      DeviceMotionEvent.requestPermission().then(state => {
        if (state === "granted") {
          window.addEventListener("devicemotion", handleMotion);
        } else {
          showError("加速度センサーの権限が必要です");
        }
      }).catch(err => showError("権限要求エラー: " + err.message));

    } else {
      window.addEventListener("devicemotion", handleMotion);
    }
  } catch (err) {
    showError("権限処理でエラー: " + err.message);
  }
}

// ボタン
startStopBtn.addEventListener("click", () => {
  isMeasuring = !isMeasuring;
  clearError();

  if (isMeasuring) {
    const now = new Date();
    sessionId = generateSessionId(now);

    statusText.textContent = "測定中…";
    startStopBtn.textContent = "測定終了";

    batchPoints = [];
    prevAcceleration = null;

    requestPermissionIfNeeded();
  } else {
    statusText.textContent = "測定していません";
    startStopBtn.textContent = "測定開始";

    window.removeEventListener("devicemotion", handleMotion);
    saveBatch(); // 残り送信
  }
});
