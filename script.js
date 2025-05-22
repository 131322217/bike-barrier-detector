// ==== 設定（閾値：加速度変化の大きさ） ====
const ACCEL_THRESHOLD = 2.5;

// ==== 状態変数 ====
let measuring = false;
let prevMagnitude = null;
let accelEvents = [];
let statusElem, toggleBtn;

// ==== 初期化 ====
window.addEventListener('DOMContentLoaded', () => {
  statusElem = document.getElementById('status');
  toggleBtn = document.getElementById('toggleBtn');

  toggleBtn.addEventListener('click', () => {
    if (!measuring) {
      startMeasurement();
    } else {
      stopMeasurement();
    }
  });
});

// ==== 測定開始 ====
function startMeasurement() {
  if (!('DeviceMotionEvent' in window)) {
    alert('加速度センサーがサポートされていません');
    return;
  }
  if (!('geolocation' in navigator)) {
    alert('ジオロケーションがサポートされていません');
    return;
  }

  accelEvents = [];
  prevMagnitude = null;
  measuring = true;
  statusElem.textContent = 'ただいま測定中です';
  toggleBtn.textContent = '測定終了';

  window.addEventListener('devicemotion', handleMotion);
}

// ==== 測定終了 ====
function stopMeasurement() {
  measuring = false;
  statusElem.textContent = '測定は停止中です';
  toggleBtn.textContent = '測定開始';
  window.removeEventListener('devicemotion', handleMotion);

  // 結果を表示（必要に応じて送信や保存も可能）
  console.log('検出した特徴的な動きの位置情報:', accelEvents);
  alert(`検出したイベント数: ${accelEvents.length}`);
}

// ==== 加速度イベントの処理 ====
function handleMotion(event) {
  if (!measuring) return;

  const a = event.accelerationIncludingGravity;
  if (!a) return;

  // 3軸合成加速度
  const magnitude = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2);

  if (prevMagnitude !== null) {
    const diff = Math.abs(magnitude - prevMagnitude);

    if (diff >= ACCEL_THRESHOLD) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const timestamp = Date.now();
          accelEvents.push({ latitude, longitude, timestamp, diff });
          console.log('特徴的な動き検出:', { latitude, longitude, diff });
        },
        (err) => {
          console.warn('位置情報取得失敗:', err);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
      );
    }
  }
  prevMagnitude = magnitude;
}
