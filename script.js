import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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
const btn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accValue = document.getElementById("accValue");
const errorBox = document.getElementById("errorBox");

// 状態
let measuring = false;
let sessionId = null;
let prevAcc = null;

// セッションID
function makeSessionId() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    + `-${String(d.getDate()).padStart(2,'0')}_`
    + `${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
}

// 画面エラー表示
function showError(msg) {
  errorBox.style.display = "block";
  errorBox.textContent = msg;
  console.error(msg);
}

// 加速度処理
function handleMotion(e) {
  if (!measuring) return;

  const acc = e.acceleration;
  if (!acc || acc.x == null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  accValue.textContent = total.toFixed(1);

  if (prevAcc !== null) {
    const diff = Math.abs(total - prevAcc);

    if (diff > 0.5) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          await addDoc(collection(db, "barriers", sessionId, "data"), {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acceleration: diff.toFixed(1),
            timestamp: new Date()
          });
        } catch (e) {
          showError("Firestore 保存失敗: " + e.message);
        }
      }, (err) => {
        showError("位置情報エラー: " + err.message);
      });
    }
  }

  prevAcc = total;
}

// iOS permission
function requestPermission() {
  if (DeviceMotionEvent?.requestPermission) {
    DeviceMotionEvent.requestPermission().then(res => {
      if (res === "granted") {
        window.addEventListener("devicemotion", handleMotion);
      } else {
        showError("加速度センサーが許可されませんでした");
      }
    });
  } else {
    window.addEventListener("devicemotion", handleMotion);
  }
}

// ボタンクリック
btn.addEventListener("click", () => {
  measuring = !measuring;

  if (measuring) {
    errorBox.style.display = "none";
    sessionId = makeSessionId();
    prevAcc = null;
    statusText.textContent = "測定中...";
    btn.textContent = "停止";

    requestPermission();
  } else {
    statusText.textContent = "停止中";
    btn.textContent = "測定開始";
    window.removeEventListener("devicemotion", handleMotion);
  }
});
