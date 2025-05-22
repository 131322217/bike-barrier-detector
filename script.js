let watchId = null;
let lastAcceleration = null;
let lastGeo = null;

// ノイズ除去のしきい値（これを調整すれば感度を変えられる）
const NOISE_THRESHOLD = 0.3;

function startMeasurement() {
  document.getElementById('status').textContent = '測定中です';
  document.getElementById('measureButton').disabled = true;

  // 位置情報の取得開始
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        lastGeo = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          speed: position.coords.speed
        };
      },
      (error) => {
        console.error('位置情報の取得に失敗:', error);
      },
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
  } else {
    alert('このブラウザでは位置情報が利用できません');
  }

  // 加速度センサーの設定
  if (window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', handleMotion);
  } else {
    alert('このデバイスでは加速度センサーが利用できません');
  }
}

function handleMotion(event) {
  const acc = event.accelerationIncludingGravity;
  if (!acc) return;

  const current = {
    x: acc.x || 0,
    y: acc.y || 0,
    z: acc.z || 0
  };

  // 前回との差分を計算
  if (lastAcceleration) {
    const dx = current.x - lastAcceleration.x;
    const dy = current.y - lastAcceleration.y;
    const dz = current.z - lastAcceleration.z;

    const totalDiff = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);

    // 値を画面に表示（小数第1位）
    document.getElementById('accValue').textContent = totalDiff.toFixed(1);

    if (totalDiff > NOISE_THRESHOLD) {
      console.log('大きな変化を検出:', totalDiff.toFixed(2));
      if (lastGeo) {
        console.log(`位置: 緯度 ${lastGeo.lat}, 経度 ${lastGeo.lon}`);
      }
    }
  }

  lastAcceleration = current;
}
