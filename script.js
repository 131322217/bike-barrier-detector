let prevAcc = null; // x, y, z の前回値保持

function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  // totalを計算
  const total = Math.abs(acc.x) + Math.abs(acc.y) + Math.abs(acc.z);
  updateAccelerationDisplay(total);

  if (prevAcc !== null) {
    // 各軸の差分
    const xDiff = acc.x - prevAcc.x;
    const yDiff = acc.y - prevAcc.y;
    const zDiff = acc.z - prevAcc.z;
    const totalDiff = Math.abs(xDiff) + Math.abs(yDiff) + Math.abs(zDiff);

    if (totalDiff > accelerationThreshold) {
      navigator.geolocation.getCurrentPosition(pos => {
        savePoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          xDiff,
          yDiff,
          zDiff,
          totalDiff,
          timestamp: new Date()
        });
      }, err => console.error("位置情報取得失敗:", err), { enableHighAccuracy: true });
    }
  }

  prevAcc = { x: acc.x, y: acc.y, z: acc.z };
}

// Firestore保存関数もオブジェクトをそのまま保存する形に
async function savePoint(data) {
  try {
    const docRef = doc(db, "barriers", sessionId);
    await setDoc(docRef, {}, { merge: true }); // セッションIDのドキュメント作成
    await addDoc(collection(docRef, "points"), data);
    console.log("保存成功:", data);
  } catch (e) {
    console.error("Firestore保存失敗:", e);
  }
}
