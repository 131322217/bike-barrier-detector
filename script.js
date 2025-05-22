let isMeasuring = false;
let prevAcceleration = null;
let accelerationThreshold = 0.5; // ノイズ除去のための閾値（0.1〜1.0で調整）
let accelerationDisplay = document.getElementById('accelerationValue');
let statusText = document.getElementById('statusText');
let toggleButton = document.getElementById('toggleButton');

let geoPoints = [];

function updateAccelerationDisplay(value) {
  accelerationDisplay.textContent = value.toFixed(1); // 表示は0.0単位に
}

function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  updateAccelerationDisplay(total);

  if (prevAcceleration !== null) {
    const diff = Math.abs(total - prevAcceleration);
    if (diff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition((position) => {
        geoPoints.push({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: new Date(),
          accelerationChange: diff.toFixed(1),
        });
        console.log("特徴的な動き記録:", geoPoints[geoPoints.length - 1]);
      });
    }
  }

  prevAcceleration = total;
}

function requestPermissionIfNeeded() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('devicemotion', handleMotion);
        } else {
          alert("加速度センサーの使用が許可されませんでした。");
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleMotion); // AndroidやPCなど通常環境
  }
}

function toggleMeasurement() {
  isMeasuring = !isMeasuring;

  if (isMeasuring) {
    statusText.textContent = "測定中です…";
    toggleButton.textContent = "測定終了";
    prevAcceleration = null;
    requestPermissionIfNeeded();
  } else {
    statusText.textContent = "測定していません";
    toggleButton.textContent = "測定開始";
  }
}

toggleButton.addEventListener('click', toggleMeasurement);
