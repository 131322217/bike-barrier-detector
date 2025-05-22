// ここで設定値を変えられる
const ACCELERATION_THRESHOLD = 2.0; // 特徴的な動きと判断する閾値（例: 2.0）
const ACCELERATION_CHECK_INTERVAL = 100; // 加速度チェック間隔(ms)

let isMeasuring = false;
let prevAccel = { x: 0, y: 0, z: 0 };
let watchId = null;
let accelerationDisplay = null;

window.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('toggleButton');
  const status = document.getElementById('status');
  accelerationDisplay = document.getElementById('accelerationDisplay');

  toggleButton.addEventListener('click', () => {
    if (!isMeasuring) {
      startMeasurement();
      status.textContent = 'ただいま測定中です';
      toggleButton.textContent = '測定終了';
    } else {
      stopMeasurement();
      status.textContent = '測定していません';
      toggleButton.textContent = '測定開始';
      accelerationDisplay.textContent = '加速度変化: 0.00';
    }
    isMeasuring = !isMeasuring;
  });
});

function startMeasurement() {
  if (!('geolocation' in navigator) || !('DeviceMotionEvent' in window)) {
    alert('このブラウザは位置情報または加速度センサーに対応していません。');
    return;
  }

  // 加速度センサーイベントの処理
  window.addEventListener('devicemotion', onDeviceMotion);

  // 位置情報の監視開始
  watchId = navigator.geolocation.watchPosition(
    position => {
      // 必要に応じて位置情報の処理をここに追加
    },
    error => {
      console.error(error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 5000
    }
  );
}

function stopMeasurement() {
  window.removeEventListener('devicemotion', onDeviceMotion);

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function onDeviceMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  // 直前の加速度との差を計算
  const deltaX = Math.abs(acc.x - prevAccel.x);
  const deltaY = Math.abs(acc.y - prevAccel.y);
  const deltaZ = Math.abs(acc.z - prevAccel.z);

  const totalDelta = deltaX + deltaY + deltaZ;

  // 加速度変化値を画面に表示
  accelerationDisplay.textContent = `加速度変化: ${totalDelta.toFixed(2)}`;

  if (totalDelta > ACCELERATION_THRESHOLD) {
    // 特徴的な動きがあったときの処理（位置情報取得など）
    navigator.geolocation.getCurrentPosition(
      pos => {
        console.log('特徴的な動き検出:', pos.coords.latitude, pos.coords.longitude);
        // ここに座標保存などの処理を入れる
      },
      err => {
        console.error('位置情報取得エラー:', err);
      },
      { enableHighAccuracy: true }
    );
  }

  prevAccel = { x: acc.x, y: acc.y, z: acc.z };
}
