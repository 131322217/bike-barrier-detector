// script.js
// 動作概要（実装された仕様）
// - 測定開始ボタンでセッション開始（sessionId = YYYY-MM-DD_HH-MM）
// - 1秒周期で現在の最新加速度サンプルを Periodic として Firestore に保存（isEvent = false）
// - devicemotion イベントで差分を計算し、閾値を超えたときは即座にそのサンプルを isEvent = true で保存。
//   さらに、その直前に保存した最大 PRE_KEEP_COUNT 件（ローカルで保持している docRef list）を
//   "context" としてマーク（update）して残す。
// - 測定終了で「後処理」を実行：Firestore からその session の points を取得して
//   保存ルールに基づき不要なドキュメントを削除する（削除候補は isEvent=false かつ context フラグ無し）
// - マップにはイベントのみ赤いピンで表示（測定中リアルタイムに追加される）
// - UI: 処理中はボタンを無効化してステータスを表示（"処理中..."）
// - 保存形式： collection "barriers" / doc sessionId / subcollection "points" / autoId docs
//
// 注意：Firestore の読み書き回数とセキュリティルールに注意してください。
//        大量データの運用や公開時はセキュリティルールの整備が必須です。

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ===== Firebase 設定（必要なら自分の設定に置き換えてください） ===== */
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ===== DOM 要素 ===== */
const startStopBtn = document.getElementById('startStopBtn');
const statusText = document.getElementById('statusText');
const accTotalEl = document.getElementById('accTotal');
const accXEl = document.getElementById('accX');
const accYEl = document.getElementById('accY');
const accZEl = document.getElementById('accZ');
const logArea = document.getElementById('logArea');

/* ===== マップ関連 ===== */
let map = null;
let userMarker = null;
function initMap(lat, lng) {
  if (!map) {
    map = L.map('map').setView([lat, lng], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    userMarker = L.marker([lat, lng]).addTo(map);
  }
}
function updateMap(lat, lng) {
  if (!map) return initMap(lat, lng);
  userMarker.setLatLng([lat, lng]);
  map.setView([lat, lng]);
}
function addEventMarker(lat, lng, label) {
  if (!map) return;
  const m = L.circleMarker([lat, lng], { radius: 6, color: 'red', fillColor: 'red', fillOpacity: 0.9 });
  m.addTo(map).bindPopup(label || 'イベント').openPopup();
}

/* ===== 動作設定（変更したいものはここを編集） ===== */
const SAMPLE_INTERVAL_MS = 1000;       // 1秒ごとに periodic を保存
const PRE_KEEP_COUNT = 3;              // イベント時に直前でマークする個数
const THRESHOLD = 3.0;                 // イベント判定閾値（totalDiff）
const KEEP_EVERY_N = 8;                // 長いN系列で 8個ごとに保管（0なら無効）
const POSTPROCESS_BATCH = 50;          // 後処理で取得時の一度に取る量（必要なら調整）

/* ===== 状態変数 ===== */
let isMeasuring = false;
let sessionId = null;
let sessionStartTime = null;

let currentSample = null; // 最新の devicemotion サンプル（1秒間隔で periodic として使う）
let prevSavedTotal = null; // 前回保存した total（for diff計算 when saving periodic）
let prevAccel = null; // {x,y,z,total} — 用イベント判定用（直前フレーム）
let lastPosition = null; // 最新 GPS
let watchId = null;

/* recentSavedDocs: ローカルに保持する直近保存した docRef 情報
   - new point を addDoc で保存したとき、その docRef (id) を push しておく
   - イベント発生時はここにある直近 PRE_KEEP_COUNT 件を update して "context:true" を付ける */
let recentSavedDocs = []; // array of {id, timestamp}

/* interval 管理 */
let periodicTimerId = null;

/* ヘルパー - ログ出力 */
function log(msg) {
  const time = new Date().toLocaleTimeString();
  const el = document.createElement('div');
  el.textContent = `[${time}] ${msg}`;
  logArea.prepend(el);
}

/* ===== Firestore 保存ロジック ===== */
// session doc ref path: barriers/{sessionId}, points subcollection
function sessionDocRef() {
  return doc(db, "barriers", sessionId);
}
function pointsCollectionRef() {
  return collection(db, "barriers", sessionId, "points");
}

// save one point doc (returns the created doc reference object via addDoc promise)
async function savePointToFirestore(point) {
  // point: object with fields (x,y,z,total,xDiff,yDiff,zDiff,totalDiff,lat,lng,isEvent,isContext,timestamp)
  try {
    const colRef = pointsCollectionRef();
    const docRef = await addDoc(colRef, point);
    // keep local record of this doc id and when it was saved (for pre-event context marking)
    recentSavedDocs.push({ id: docRef.id, timestamp: point.timestamp });
    // limit recentSavedDocs size to, say, 20
    if (recentSavedDocs.length > 40) recentSavedDocs.shift();
    return docRef;
  } catch (e) {
    console.error("Firestore保存失敗:", e);
    log("Firestore保存失敗: " + (e.message || e));
    return null;
  }
}

// update existing point doc to set context flag (or merge other fields)
async function markDocsAsContext(docIds) {
  // docIds: array of doc.id strings (documents under barriers/{sessionId}/points)
  for (const id of docIds) {
    try {
      const dref = doc(db, "barriers", sessionId, "points", id);
      await updateDoc(dref, { isContext: true });
      log(`前文脈マーク: ${id}`);
    } catch (e) {
      console.error("前文脈マーク失敗:", e);
      // 失敗しても続行
    }
  }
}

/* ===== セッション（開始/終了）処理 ===== */
function generateSessionId(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

async function createSessionMeta() {
  const meta = {
    startedAt: sessionStartTime,
    createdAt: new Date(),
    device: navigator.userAgent || null,
  };
  try {
    await setDoc(sessionDocRef(), meta, { merge: true });
    log(`セッション作成: ${sessionId}`);
  } catch (e) {
    console.error("セッション作成失敗:", e);
  }
}

/* ===== デバイスデータ取得処理 ===== */

// pick acceleration (prefer event.acceleration; fallback to includingGravity)
function extractAcc(event) {
  const acc = event.acceleration && event.acceleration.x !== null ? event.acceleration : (event.accelerationIncludingGravity || null);
  if (!acc) return null;
  return { x: acc.x, y: acc.y, z: acc.z };
}

/* devicemotion handler:
   - 継続的に currentSample を更新（1秒周期で periodic 保存に使う）
   - 即時イベント判定（閾値超え）があれば event 保存・地図マーカー追加・前文脈マーク
*/
async function handleMotion(event) {
  if (!isMeasuring) return;

  const acc = extractAcc(event);
  if (!acc) return;

  const x = acc.x, y = acc.y, z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  // update UI (live)
  accTotalEl.textContent = total.toFixed(2);
  accXEl.textContent = x.toFixed(2);
  accYEl.textContent = y.toFixed(2);
  accZEl.textContent = z.toFixed(2);

  // compute diffs against prevAccel (frame-level)
  let xDiff = 0, yDiff = 0, zDiff = 0, totalDiff = 0;
  if (prevAccel) {
    xDiff = Math.abs(x - prevAccel.x);
    yDiff = Math.abs(y - prevAccel.y);
    zDiff = Math.abs(z - prevAccel.z);
    totalDiff = Math.abs(total - prevAccel.total);
  }

  // store latest sample for periodic saving
  currentSample = {
    x, y, z, total,
    xDiff, yDiff, zDiff, totalDiff,
    timestamp: new Date()
  };

  // immediate event detection: use totalDiff and THRESHOLD
  // only trigger if we have a prevAccel (so totalDiff meaningful)
  if (prevAccel && totalDiff > THRESHOLD) {
    // prepare point with lat/lng (use lastPosition if available)
    const point = {
      x, y, z, total,
      xDiff, yDiff, zDiff, totalDiff,
      lat: lastPosition ? lastPosition.latitude : null,
      lng: lastPosition ? lastPosition.longitude : null,
      isEvent: true,
      isContext: false,
      timestamp: new Date()
    };

    // save event immediately
    const docRef = await savePointToFirestore(point);
    log(`イベント保存 (totalDiff=${totalDiff.toFixed(2)})`);

    // add event marker to map
    if (point.lat && point.lng) {
      addEventMarker(point.lat, point.lng, `E: ${totalDiff.toFixed(2)}`);
    }

    // mark previous PRE_KEEP_COUNT saved docs as context
    const idsToMark = recentSavedDocs.slice(-PRE_KEEP_COUNT).map(r => r.id);
    if (idsToMark.length > 0) {
      await markDocsAsContext(idsToMark);
    }

    // we already saved event; continue (do not double-save this sample in periodic cycle)
    // reset prevSavedTotal so periodic diff computation remains consistent
    prevSavedTotal = total;
    // also set prevAccel to current
    prevAccel = { x, y, z, total };
    return;
  }

  // update prevAccel for next frame
  prevAccel = { x, y, z, total };
}

/* ===== GPS (位置) 追跡 ===== */
function startTrackingPosition() {
  if (!navigator.geolocation) {
    log("位置情報が利用できません");
    return;
  }
  // high accuracy recommended for better results
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos.coords;
      // initialize or update map centered on user
      if (!map) initMap(lastPosition.latitude, lastPosition.longitude);
      updateMap(lastPosition.latitude, lastPosition.longitude);
    },
    (err) => {
      console.warn("位置情報エラー", err);
      log("位置情報エラー: " + (err.message || err.code));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
  );
}

function stopTrackingPosition() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/* ===== Periodic 保存ループ（1秒ごと） =====
   - currentSample に最新サンプルが入っていれば、それを periodic として保存（isEvent=false）
   - periodic はデータ量増えるので最小限のフィールドで保存
*/
async function periodicSaveTick() {
  if (!isMeasuring) return;
  if (!currentSample) return;
  // compute diff against previous-saved total (so persistent diff reflects timing at saves)
  const total = currentSample.total;
  const x = currentSample.x, y = currentSample.y, z = currentSample.z;
  let xDiff = currentSample.xDiff, yDiff = currentSample.yDiff, zDiff = currentSample.zDiff, totalDiff = currentSample.totalDiff;

  // If prevSavedTotal exists, refine totalDiff relative to last saved value
  if (prevSavedTotal !== null) {
    totalDiff = Math.abs(total - prevSavedTotal);
  }

  const point = {
    x, y, z, total,
    xDiff, yDiff, zDiff, totalDiff,
    lat: lastPosition ? lastPosition.latitude : null,
    lng: lastPosition ? lastPosition.longitude : null,
    isEvent: false,
    isContext: false,
    timestamp: new Date()
  };

  const ref = await savePointToFirestore(point);
  if (ref) {
    prevSavedTotal = total;
    // keep mapping in UI log (brief)
    // but we don't show periodic markers on map (events only)
  }
}

/* ===== 後処理: 測定終了後に Firestore 上の session の points を精査して不要を削除する =====
   ルール（簡略化・安定版）：
   ・isEvent === true は必ず残す
   ・isContext === true（イベント発生時に前文脈としてマークされたもの）は残す
   ・長い連続N系列（isEvent===false && isContext!==true）が続く場合、KEEP_EVERY_N を使って
     その系列中で 8 個ごとに 1 個だけ残す（KEEP_EVERY_N=0 なら無効）
*/
async function postProcessSession() {
  // disable UI and show processing status outside
  startStopBtn.disabled = true;
  statusText.textContent = "後処理中... Firestoreを読み取り・削除します（この処理は時間がかかる場合があります）";
  log("後処理開始。Firestoreからセッションデータを取得します...");

  try {
    // fetch points ordered by timestamp
    const pointsQuery = query(collection(db, "barriers", sessionId, "points"), orderBy("timestamp", "asc"));
    const snapshot = await getDocs(pointsQuery);

    // collect docs into array with data + ref id
    const docs = [];
    snapshot.forEach(d => {
      const data = d.data();
      docs.push({
        id: d.id,
        data
      });
    });

    log(`取得件数: ${docs.length} 件`);

    // decide keep / delete
    const toKeep = new Set();   // ids to keep
    const toDelete = [];

    // 1) keep all explicit events and context docs
    for (const item of docs) {
      const d = item.data;
      if (d.isEvent === true) toKeep.add(item.id);
      if (d.isContext === true) toKeep.add(item.id);
    }

    // 2) long-run N filtering: for contiguous non-kept docs, keep every KEEP_EVERY_N-th
    if (KEEP_EVERY_N > 0) {
      let run = []; // current run of candidate N docs (ids)
      for (let i = 0; i < docs.length; i++) {
        const item = docs[i];
        const id = item.id;
        const d = item.data;
        // candidate: not already kept via event/context
        const isAlreadyKept = toKeep.has(id);
        if (!isAlreadyKept) {
          run.push(id);
        } else {
          // process previous run
          if (run.length > 0) {
            // keep every N-th (1-based): keep index KEEP_EVERY_N-1, 2*KEEP_EVERY_N-1, ...
            for (let j = 0; j < run.length; j++) {
              if ((j % KEEP_EVERY_N) === (KEEP_EVERY_N - 1)) {
                toKeep.add(run[j]);
              }
            }
            run = [];
          }
          // already kept doc -> continue
        }
      }
      // tail run
      if (run.length > 0) {
        for (let j = 0; j < run.length; j++) {
          if ((j % KEEP_EVERY_N) === (KEEP_EVERY_N - 1)) {
            toKeep.add(run[j]);
          }
        }
      }
    }

    // 3) everything else (not in toKeep) should be deleted
    for (const item of docs) {
      if (!toKeep.has(item.id)) toDelete.push(item.id);
    }

    log(`削除予定: ${toDelete.length} 件`);

    // Delete them sequentially to avoid quota/spikes; show progress
    for (let i = 0; i < toDelete.length; i++) {
      const id = toDelete[i];
      await deleteDoc(doc(db, "barriers", sessionId, "points", id));
      if ((i + 1) % 10 === 0) {
        log(`削除進捗: ${i + 1} / ${toDelete.length}`);
      }
    }

    log(`後処理完了。削除済み: ${toDelete.length} 件。保持: ${docs.length - toDelete.length} 件`);
    statusText.textContent = `後処理完了（保持 ${docs.length - toDelete.length} / ${docs.length} 件）`;
  } catch (e) {
    console.error("後処理エラー:", e);
    log("後処理エラー: " + (e.message || e));
    statusText.textContent = "後処理でエラーが発生しました（コンソールを確認）";
  } finally {
    // re-enable UI
    startStopBtn.disabled = false;
    startStopBtn.textContent = "測定開始";
    isMeasuring = false;
  }
}

/* ===== UI: start/stop ボタンロジック ===== */
async function startMeasurement() {
  // reset state
  sessionStartTime = new Date();
  sessionId = generateSessionId(sessionStartTime);
  isMeasuring = true;
  statusText.textContent = "測定中…";
  startStopBtn.textContent = "測定終了";
  startStopBtn.disabled = false;

  prevSavedTotal = null;
  prevAccel = null;
  currentSample = null;
  recentSavedDocs = [];

  // create session meta doc
  await createSessionMeta();

  // start gps tracking
  startTrackingPosition();

  // request permission for devicemotion on iOS if needed
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const resp = await DeviceMotionEvent.requestPermission();
      if (resp !== 'granted') {
        alert('加速度センサーの使用が許可されませんでした（iOS）。');
        log("DeviceMotion permission denied.");
        // still allow GPS-only session
      }
    } catch (e) {
      console.warn("DeviceMotion permission error:", e);
    }
  }

  // attach event listener
  window.addEventListener('devicemotion', handleMotion);

  // periodic timer
  periodicTimerId = setInterval(periodicSaveTick, SAMPLE_INTERVAL_MS);

  log(`測定開始: ${sessionId}`);
}

async function stopMeasurement() {
  // disable immediate interaction & change UI to processing
  startStopBtn.disabled = true;
  statusText.textContent = "測定終了 → 後処理中...";
  startStopBtn.textContent = "処理中...";

  // detach motion listener to stop more saves/triggers
  window.removeEventListener('devicemotion', handleMotion);

  // stop periodic timer
  if (periodicTimerId) {
    clearInterval(periodicTimerId);
    periodicTimerId = null;
  }

  // stop GPS watch
  stopTrackingPosition();

  log("測定停止。後処理（Firestoreの不要データ削除）を開始します...");
  // run post-processing (will re-enable button at end)
  await postProcessSession();
}

/* start/stop button handler */
startStopBtn.addEventListener('click', async () => {
  if (!isMeasuring) {
    // start
    await startMeasurement();
  } else {
    // stop
    await stopMeasurement();
  }
});

/* ===== 初期化：ページ読み込み時にマップを作る（位置情報が取れたらセンタリング） ===== */
(function init() {
  // try to get an initial position to center the map
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      initMap(pos.coords.latitude, pos.coords.longitude);
    }, (_err) => {
      // fallback: set to Tokyo station if position not available
      initMap(35.681236, 139.767125);
    }, { enableHighAccuracy: true, timeout: 5000 });
  } else {
    initMap(35.681236, 139.767125);
  }
  log("準備完了。ボタンを押して測定を開始してください。");
})();
