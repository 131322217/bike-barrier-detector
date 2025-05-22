// ======== 変数 ========
// 加速度変化を判定する閾値（自由に調整してください）
const ACCELERATION_THRESHOLD = 2.0;

// 加速度センサーの直前値保存用
let lastAccel = { x: null, y: null, z: null };

// 測定状態フラグ
let isMeasuring = false;

// 測定中の位置情報記録配列
let recordedPositions = [];

// ボタンと表示要素
const btn = document.getElementById("startStopBtn");
const statusText = document.getElementById("statusText");
const accelerationText = document.getElementById("accelerationText");

// 加速度イベントリスナー用関数
function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  // 直前との差を計算
  let diffX = lastAccel.x !== null ? Math.abs(acc.x - lastAccel.x) : 0;
  let diffY = lastAccel.y !== null ? Math.abs(acc.y - lastAccel.y) : 0;
  let diffZ = lastAccel.z !== null ? Math.abs(acc.z - lastAccel.z) : 0;

  // 合計の差分
  const totalDiff = diffX + diffY + diffZ;

  // 表示更新
  accelerationText.textContent = `加速度の変化: ${totalDiff.toFixed(2)}`;

  // 閾値を超えたら現在位置を取得し記録
  if (totalDiff > ACCELERATION_THRESHOLD) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: pos.timestamp,
            accelerationDiff: totalDiff,
          };
          recordedPositions.push(coords);
          console.log("特徴的な動き検出: ", coords);
        },
        (err) => {
          console.warn("位置情報取得失敗:", err.message);
        }
      );
    }
  }

  // 今回の値を保存
  lastAccel = { x: acc.x, y: acc.y, z: acc.z };
}

// 加速度使用許可を求める（iOS Safari対応）
async function requestMotionPermission() {
  if (
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function"
  ) {
    try {
      const response = await DeviceMotionEvent.requestPermission();
      if (response === "granted") {
        window.addEventListener("devicemotion", handleMotion);
        return true;
      } else {
        alert("加速度センサーの使用が許可されませんでした");
        return false;
      }
    } catch (error) {
      console.error("Permission error:", error);
      return false;
    }
  } else {
    // iOS以外や古いブラウザはそのままイベント登録
    window.addEventListener("devicemotion", handleMotion);
    return true;
  }
}

// 測定開始
async function startMeasurement() {
  const granted = await requestMotionPermission();
  if (!granted) return;

  // 位置情報の連続監視開始
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // 位置情報は連続的に記録可能（必要に応じて使う）
        console.log("現在位置:", pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.warn("位置情報取得失敗:", err.message);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  }

  isMeasuring = true;
  statusText.textContent = "ただいま測定中です";
  btn.textContent = "測定終了";
  lastAccel = { x: null, y: null, z: null };
  recordedPositions = [];
}

// 測定終了
function stopMeasurement() {
  isMeasuring = false;
  statusText.textContent = "測定は停止中です";
  btn.textContent = "測定開始";

  // 位置情報の監視停止
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  // ここで recordedPositions のデータを保存や送信したい場合処理を追加
  console.log("測定終了。特徴的な動きの位置:", recordedPositions);
}

// ボタン押下時の動作切替
btn.addEventListener("click", () => {
  if (!isMeasuring) {
    startMeasurement();
  } else {
    stopMeasurement();
  }
});

// 位置情報監視IDの保持用
let watchId = null;
