/**********************
 * 設定値
 **********************/
const THRESHOLD = 4.5;              // 段差判定閾値
const EVENT_COOLDOWN_MS = 800;      // 連続検出防止
const IGNORE_AFTER_START_MS = 3000; // 開始後3秒無視
const IGNORE_BEFORE_END_MS = 3000;  // 終了前3秒無視

/**********************
 * 状態管理
 **********************/
let lastAccel = null;
let lastEventTime = 0;

let measurementStartTime = 0;
let measurementEndTime = 0;
let isMeasuring = false;

let currentLat = null;
let currentLng = null;

/**********************
 * Leaflet 初期化
 **********************/
const map = L.map("map").setView([35.9435, 139.7070], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19
}).addTo(map);

/**********************
 * センサー許可（iOS）
 **********************/
document.getElementById("permissionBtn").addEventListener("click", async () => {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    const res = await DeviceMotionEvent.requestPermission();
    alert(res === "granted" ? "許可されました" : "拒否されました");
  } else {
    alert("この端末では許可不要です");
  }
});

/**********************
 * 計測開始
 **********************/
document.getElementById("startBtn").addEventListener("click", () => {
  measurementStartTime = Date.now();
  measurementEndTime = 0;
  isMeasuring = true;
  lastAccel = null;
  lastEventTime = 0;

  document.getElementById("status").textContent = "計測中…";
});

/**********************
 * 計測終了
 **********************/
document.getElementById("stopBtn").addEventListener("click", () => {
  measurementEndTime = Date.now();
  isMeasuring = false;

  document.getElementById("status").textContent = "計測終了";
});

/**********************
 * 無視時間判定
 **********************/
function isInIgnoreTime(now) {
  // 開始直後
  if (now - measurementStartTime < IGNORE_AFTER_START_MS) {
    return true;
  }

  // 終了直前
  if (
    measurementEndTime !== 0 &&
    measurementEndTime - now < IGNORE_BEFORE_END_MS
  ) {
    return true;
  }

  return false;
}

/**********************
 * 位置情報取得
 **********************/
navigator.geolocation.watchPosition(
  (pos) => {
    currentLat = pos.coords.latitude;
    currentLng = pos.coords.longitude;
  },
  (err) => console.error(err),
  { enableHighAccuracy: true }
);

/**********************
 * 加速度処理
 **********************/
window.addEventListener("devicemotion", (event) => {
  if (!isMeasuring) return;
  if (!event.accelerationIncludingGravity) return;

  const now = Date.now();

  const x = event.accelerationIncludingGravity.x ?? 0;
  const y = event.accelerationIncludingGravity.y ?? 0;
  const z = event.accelerationIncludingGravity.z ?? 0;

  const total = Math.sqrt(x * x + y * y + z * z);

  if (lastAccel === null) {
    lastAccel = total;
    return;
  }

  const diff = Math.abs(total - lastAccel);
  lastAccel = total;

  // 段差判定
  if (
    diff > THRESHOLD &&
    now - lastEventTime > EVENT_COOLDOWN_MS &&
    !isInIgnoreTime(now) &&
    currentLat !== null
  ) {
    lastEventTime = now;

    L.circleMarker([currentLat, currentLng], {
      radius: 6,
      fillOpacity: 0.8
    })
      .addTo(map)
      .bindPopup(`diff: ${diff.toFixed(2)}`);

    console.log("段差検出", diff);
  }
});
