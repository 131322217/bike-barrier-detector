import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Firebase
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ===== 設定 =====
const W = 3;
const THRESHOLD = 27;
const Z_THRESHOLD = 3;

// セッションID（ページ開いた単位）
const sessionId = crypto.randomUUID();

let prev = null;
let currentPos = null;

// 位置取得
navigator.geolocation.watchPosition(pos => {
  currentPos = pos.coords;
});

// 判定関数
function detect(prev, curr) {
  const dx = Math.abs(curr.x - prev.x);
  const dy = Math.abs(curr.y - prev.y);
  const dz = Math.abs(curr.z - prev.z);

  const diff = dx + dy + W * dz;

  const isStep =
    diff > THRESHOLD &&
    dz > Z_THRESHOLD &&
    dz > dx &&
    dz > dy;

  const isCurve =
    diff > 10 &&
    dz < Z_THRESHOLD &&
    (dx + dy) > dz;

  let type = null;
  if (isStep) type = "step";
  else if (isCurve) type = "curve";

  return { dx, dy, dz, diff, type };
}

// 計測開始
window.start = async () => {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    await DeviceMotionEvent.requestPermission();
  }

  window.addEventListener("devicemotion", async e => {
    const acc = e.accelerationIncludingGravity;
    if (!acc || !currentPos) return;

    const curr = {
      x: acc.x,
      y: acc.y,
      z: acc.z
    };

    if (!prev) {
      prev = curr;
      return;
    }

    const result = detect(prev, curr);

    if (result.type) {
      await addDoc(collection(db, "events"), {
        lat: currentPos.latitude,
        lng: currentPos.longitude,
        x: curr.x,
        y: curr.y,
        z: curr.z,
        diff: result.diff,
        type: result.type,        // ← ここが重要
        timestamp: new Date().toISOString(),
        sessionId: sessionId
      });
    }

    prev = curr;
  });
};
