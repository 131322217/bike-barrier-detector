let isMeasuring = false;
let previousAcceleration = { x: 0, y: 0, z: 0 };
let accelerationThreshold = 1.5;  // 特徴的な動き判定用の閾値
let displayThreshold = 0.1;       // 表示更新用の閾値（小さめに設定）

let watchId = null;
let accelListener = null;

const statusText = document.getElementById('status');
const toggleButton = document.getElementById('toggleButton');
const accelDisplay = document.getElementById('accelValue');

toggleButton.addEventListener('click', async () => {
  if (!isMeasuring) {
    // iOS Safari用の許可取得処理
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const response = await DeviceMotionEvent.requestPermission();
        if (response !== 'granted') {
          alert('加速度センサーの使用が許可されませんでした。');
          return;
        }
      } catch (e) {
        alert('加速度センサーの許可取得中にエラーが発生しました。');
        return;
      }
    }

    startMeasuring();
  } else {
    stopMeasuring();
  }
});

function startMeasuring() {
  isMeasuring = true;
  statusText.textContent = 'ただいま測定中です';
  toggleButton.textContent = '測定終了';

  // 位置情報取得開始
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      console.log('位置取得:', position.coords.latitude, position.coords.longitude);
    },
    (error) => {
      console.error('位置情報エラー:', error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    }
  );

  // 加速度センサー監視開始
  accelListener = (event) => {
    const acc = event.accelerationIncludingGravity;
    const dx = acc.x - previousAcceleration.x;
    const dy = acc.y - previousAcceleration.y;
    const dz = acc.z - previousAcceleration.z;
    const change = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 表示は変化がdisplayThreshold（0.1）を超えたときだけ更新
    if (change > displayThreshold) {
      accelDisplay.textContent = `加速度の変化: ${change.toFixed(1)}`;
    }

    // 特徴的な動き（段差など）の検出
    if (change > accelerationThreshold) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude, longitude } = pos.coords;
          console.log(`特徴的な動き記録: (${latitude}, ${longitude})`);
        });
      }
    }

    previousAcceleration = { x: acc.x, y: acc.y, z: acc.z };
  };

  window.addEventListener('devicemotion', accelListener);
}

function stopMeasuring() {
  isMeasuring = false;
  statusText.textContent = '測定していません';
  toggleButton.textContent = '測定開始';

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (accelListener) {
    window.removeEventListener('devicemotion', accelListener);
    accelListener = null;
  }

  accelDisplay.textContent = '';
}
