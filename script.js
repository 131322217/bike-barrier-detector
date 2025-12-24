import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* Firebase */
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* 設定 */
const STEP_THRESHOLD = 28;
const CURVE_THRESHOLD = 18;

let prevAcc = null;
let lastPosition = null;
let measuring = false;

/* GPS */
navigator.geolocation.watchPosition(pos => {
  lastPosition = pos.coords;
}, err => console.error(err), {
  enableHighAccuracy: true
});

/* 判定 */
function judge(dx, dy, dz, diff) {
  if (dz > dx && dz > dy && diff > STEP_THRESHOLD) return "step";
  if ((dx + dy) > dz && diff > CURVE_THRESHOLD) return "curve";
  return null;
}

/* 保存 */
async function save(data) {
  await addDoc(collection(db, "logs"), data);
}

/* 加速度処理 */
function onMotion(e) {
  if (!measuring || !lastPosition) return;

  const a = e.accelerationIncludingGravity;
  if (!a) return;

  const curr = { x: a.x || 0, y: a.y || 0, z: a.z || 0 };

  if (prevAcc) {
    const dx = Math.abs(curr.x - prevAcc.x);
    const dy = Math.abs(curr.y - prevAcc.y);
    const dz = Math.abs(curr.z - prevAcc.z);
    const diff = dx + dy + 3 * dz;

    const type = judge(dx, dy, dz, diff);

    if (type) {
      save({
        x: curr.x,
        y: curr.y,
        z: curr.z,
        diff,
        lat: lastPosition.latitude,
        lng: lastPosition.longitude,
        timestamp: new Date().toISOString(),
        type
      });
      console.log(type, diff.toFixed(1));
    }
  }

  prevAcc = curr;
}

/* 外部呼び出し */
export function startMeasure() {
  measuring = true;
  prevAcc = null;
  window.addEventListener("devicemotion", onMotion);
}

export function stopMeasure() {
  measuring = false;
  window.removeEventListener("devicemotion", onMotion);
}
