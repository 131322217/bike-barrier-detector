// script.js（イベント連続抑制・ローカルバッファ版 / 簡潔コメント付き）

/* =====================
   設定値（ここだけ見ればOK）
===================== */
const EVENT_DIFF_THRESHOLD = 2.5; // イベント判定のしきい値
const NORMAL_END_COUNT = 3;       // 通常が何回続いたらイベント終了とみなすか

/* =====================
   状態管理用変数
===================== */
let inEvent = false;              // 今イベント中か？
let normalCount = 0;              // イベント後の通常ログ連続数
let eventBuffer = [];             // イベント1回分をまとめる配列

/* =====================
   Firestore（すでに初期化済み前提）
===================== */
// db が firebase.firestore() で初期化されている前提

/* =====================
   加速度処理のメイン関数
===================== */
function handleSample(sample) {
  const diff = sample.diff;

  /* ---------- イベント判定 ---------- */
  if (diff >= EVENT_DIFF_THRESHOLD) {
    // イベント検出

    if (!inEvent) {
      // イベント開始
      inEvent = true;
      normalCount = 0;
      log("イベント開始");
    }

    // イベント中はとにかくバッファに溜める
    sample.isEvent = true;
    eventBuffer.push(sample);

    // 地図に赤ピン表示
    putEventMarker(sample, diff);

    return; // ここで終了（まだFirestoreには送らない）
  }

  /* ---------- 通常ログ ---------- */
  sample.isEvent = false;

  if (inEvent) {
    // イベント後の通常データ
    eventBuffer.push(sample);
    normalCount++;

    if (normalCount >= NORMAL_END_COUNT) {
      // イベント終了と判断 → まとめて保存
      flushEventBuffer();
      inEvent = false;
      normalCount = 0;
    }
  }
}

/* =====================
   Firestore にまとめて保存
===================== */
async function flushEventBuffer() {
  if (eventBuffer.length === 0) return;

  log(`イベント確定：${eventBuffer.length}件を保存中…`);

  try {
    const sessionId = currentSessionId;
    const batch = db.batch();

    eventBuffer.forEach((data, index) => {
      const ref = db
        .collection("raw_sessions")
        .doc(sessionId)
        .collection("raw_logs")
        .doc(String(index));

      batch.set(ref, data);
    });

    await batch.commit();
    log("後処理完了！");
  } catch (e) {
    console.error(e);
    log("保存エラー");
  }

  eventBuffer = []; // バッファクリア
}

/* =====================
   地図ピン表示（待ち針）
===================== */
function putEventMarker(sample, diff) {
  if (sample.lat == null || sample.lng == null) return;

  try {
    if (!map) initMap(sample.lat, sample.lng);

    const pinIcon = L.divIcon({
      className: "red-pin",
      html: "📍",
      iconSize: [16, 16],
      iconAnchor: [8, 16]
    });

    L.marker([sample.lat, sample.lng], { icon: pinIcon })
      .addTo(map)
      .bindPopup(`Event diff: ${diff.toFixed(2)}`);
  } catch (e) {
    console.warn("map marker error:", e);
  }
}

/* =====================
   UIログ表示
===================== */
function log(msg) {
  const el = document.getElementById("resultText");
  if (!el) return;
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}
