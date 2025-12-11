// ==============================
// Firestore 初期化
// ==============================
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_ID",
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ==============================
// 計測用変数
// ==============================
let watchId = null;
let lastAcc = { x: 0, y: 0, z: 0 };
let lastSaveTime = 0;
let sessionId = null;
let tempIndex = 0;

// ==============================
// 許可リクエスト（iOS）
// ==============================
async function requestMotionPermission() {
  if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
          const state = await DeviceMotionEvent.requestPermission();
          return state === "granted";
      } catch (e) {
          console.error("Motion permission error:", e);
          return false;
      }
  }
  // Android / PC は自動的にOK
  return true;
}

// ==============================
// 位置情報許可
// ==============================
async function requestLocationPermission() {
  return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false)
      );
  });
}

// ==============================
// 共通ログ出力
// ==============================
function logStatus(text) {
  const box = document.getElementById("status");
  box.textContent = text;
}

// ==============================
// Firestore 保存（処理前）
// ==============================
async function saveTempData(data) {
  await db.collection("preprocess").doc(sessionId)
      .collection("raw")
      .doc(String(tempIndex++))
      .set(data);
}

// ==============================
// Firestore コピー（測定終了後）
// ==============================
async function finalizeSession() {
  const now = new Date();
  const finalCollection = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}-${now.getHours()}${now.getMinutes()}`;

  logStatus("後処理中...");

  const rawRef = db.collection("preprocess").doc(sessionId).collection("raw");
  const snap = await rawRef.get();

  const batch = db.batch();
  let i = 0;

  snap.forEach((doc) => {
      const dst = db.collection(finalCollection).doc(String(i++));
      batch.set(dst, doc.data());
  });

  await batch.commit();

  logStatus("後処理完了！");
}

// ==============================
// メイン処理
// ==============================
async function startMeasure() {
  logStatus("許可確認中...");

  const motionOK = await requestMotionPermission();
  const locOK = await requestLocationPermission();

  if (!motionOK || !locOK) {
      alert("加速度 or 位置情報の許可が得られませんでした");
      logStatus("許可エラー");
      return;
  }

  // 新しいセッションID
  sessionId = "session-" + Date.now();
  tempIndex = 0;

  logStatus("計測開始");

  // ---- 位置情報 ----
  watchId = navigator.geolocation.watchPosition(
      (pos) => {
          // 位置だけでは保存しない、加速度イベントと一緒に保存する
      },
      () => logStatus("位置取得エラー"),
      { enableHighAccuracy: true }
  );

  // ---- 加速度 ----
  window.addEventListener("devicemotion", handleMotion);
}

function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const diff =
      Math.abs(acc.x - lastAcc.x) +
      Math.abs(acc.y - lastAcc.y) +
      Math.abs(acc.z - lastAcc.z);

  lastAcc = { ...acc };

  const now = Date.now();
  const isEvent = diff > 3;

  // 保存データ作成
  navigator.geolocation.getCurrentPosition((pos) => {
      const data = {
          x: acc.x,
          y: acc.y,
          z: acc.z,
          diff,
          isEvent,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          time: now,
      };

      // ---- 保存条件 ----
      if (isEvent) {
          saveTempData(data);
      } else {
          if (now - lastSaveTime > 1000) {
              saveTempData(data);
              lastSaveTime = now;
          }
      }
  });
}

function stopMeasure() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  window.removeEventListener("devicemotion", handleMotion);

  logStatus("後処理開始...");
  finalizeSession();
}

// ==============================
// ボタン割り当て
// ==============================
document.getElementById("btnStart").onclick = startMeasure;
document.getElementById("btnStop").onclick = stopMeasure;
