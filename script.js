// script.js (モジュール)
/*
  仕様（実装済み）：
  - 定期保存：8秒ごとに位置＋センサーを Firestore に isEvent: false として保存（画面表示しない）
  - イベント（閾値超え）：即座に isEvent: true で保存して、地図に赤いマーカーで表示
  - 停止時：当該セッション内の isEvent:false ドキュメントを削除（非イベントは消す）
  - 地図：Leaflet。測定中は現在位置に追従して地図中心を移動
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  query,
  where,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

/* ==========================
   Firebase 初期化（自分の設定で置き換えてください）
   ========================== */
const firebaseConfig = {
  apiKey: "AIzaSyAb9Zt2Hw_o-wXfXby6vlBDdcWZ6xZUJpo",
  authDomain: "bike-barrier-detector-1e128.firebaseapp.com",
  projectId: "bike-barrier-detector-1e128",
  storageBucket: "bike-barrier-detector-1e128.appspot.com",
  messagingSenderId: "556503472203",
  appId: "1:556503472203:web:d248c2bd6f5773ea9dd5ce"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ==========================
   DOM
   ========================== */
const startStopBtn = document.getElementById('startStopBtn');
const statusText = document.getElementById('statusText');
const accelerationText = document.getElementById('accelerationText');

/* ==========================
   設定パラメータ
   ========================== */
const ACC_THRESHOLD = 0.8;   // イベント閾値（totalDiff） — 実験で調整してください
const PERIODIC_S = 8;        // 定期保存間隔（秒）
const POST_COUNT = 0;        // 今回は「イベント時は前の2件だけ残す」から後ろは不要としたい場合は0（質問では後ろ不要）
// ユーザーは preBuffer size を 2 にしている流れのため、下に反映
const PRE_COUNT = 2;

/* ==========================
   状態変数
   ========================== */
let isMeasuring = false;
let prevAcc = null;
let sessionId = null;

let preBuffer = [];         // 常に最新を保持（最大 PRE_COUNT 件）
let periodicTimerId = null; // setInterval ID
let geolocationWatchId = null;

let map = null;
let userMarker = null;
let eventMarkersLayer = null; // LayerGroup for event markers

/* ==========================
   Map 初期化（Leaflet） — 東京付近の初期位置を適当に指定
   ========================== */
function initMap() {
  // 既に作成済みなら何もしない
  if (map) return;

  map = L.map('map').setView([35.681236, 139.767125], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // ユーザー位置用マーカーとイベントマーカーのレイヤ
  userMarker = L.circleMarker([0,0], { radius: 6, fillColor: '#3388ff', color: '#fff', weight: 1, fillOpacity: 1 }).addTo(map);
  eventMarkersLayer = L.layerGroup().addTo(map);
}

/* ==========================
   セッションID 生成（分まで）
   ========================== */
function generateSessionId(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  const h = String(date.getHours()).padStart(2,'0');
  const min = String(date.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${d}_${h}-${min}`;
}

/* ==========================
   Firestore に 1 件保存（points サブコレクション）
   point: { x,y,z, xDiff,yDiff,zDiff,total,totalDiff,lat,lng,timestamp,isEvent }
   ========================== */
async function savePointToFirestore(point) {
  if (!sessionId) return;
  try {
    const pointsCol = collection(doc(db, "barriers", sessionId), "points");
    await addDoc(pointsCol, point);
    // console.log("Saved point:", point);
  } catch (e) {
    console.error("Firestore 保存失敗:", e);
  }
}

/* ==========================
   停止時：非イベント (isEvent:false) を全削除
   ========================== */
async function deleteNonEventPointsForSession(sessId) {
  if (!sessId) return;
  try {
    const pointsCol = collection(doc(db, "barriers", sessId), "points");
    const q = query(pointsCol, where("isEvent", "==", false));
    const snap = await getDocs(q);
    const deletes = [];
    snap.forEach(d => {
      deletes.push(deleteDoc(d.ref));
    });
    await Promise.all(deletes);
    console.log("停止時に非イベント削除完了:", deletes.length);
  } catch (e) {
    console.error("停止時の削除エラー:", e);
  }
}

/* ==========================
   イベント用マーカーを地図に追加（赤）
   ========================== */
function addEventMarker(lat, lng, payload) {
  if (!map) initMap();
  const marker = L.circleMarker([lat, lng], {
    radius: 7,
    fillColor: 'red',
    color: '#800',
    weight: 1,
    fillOpacity: 0.9
  }).addTo(eventMarkersLayer);

  const popupHtml = `
    <div>
      <strong>イベント</strong><br/>
      totalDiff: ${payload.totalDiff.toFixed(2)}<br/>
      total: ${payload.total.toFixed(2)}<br/>
      time: ${new Date(payload.timestamp).toLocaleString()}
    </div>
  `;
  marker.bindPopup(popupHtml);
}

/* ==========================
   データ処理（devicemotion から受け取り）
   - devicemotion はかなり高頻度で来るので、保存は throttling（ここでは periodic で）とイベント時の保存
   - ここでは「totalDiff > ACC_THRESHOLD」の判定でイベント扱い
   ========================== */
function handleMotion(event) {
  if (!isMeasuring) return;
  const acc = event.acceleration;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

  const x = acc.x, y = acc.y, z = acc.z;
  const total = Math.abs(x) + Math.abs(y) + Math.abs(z);

  let xDiff = 0, yDiff = 0, zDiff = 0, totalDiff = 0;
  if (prevAcc) {
    xDiff = Math.abs(x - prevAcc.x);
    yDiff = Math.abs(y - prevAcc.y);
    zDiff = Math.abs(z - prevAcc.z);
    totalDiff = Math.abs(total - prevAcc.total);
  }

  const now = new Date();
  const basePoint = {
    x, y, z, xDiff, yDiff, zDiff, total, totalDiff,
    lat: null, lng: null, // 位置は後で geolocation から埋める（位置取得が非同期のため）
    timestamp: now.toISOString(),
    isEvent: false
  };

  // 更新表示
  accelerationText.textContent = `加速度合計: ${total.toFixed(2)}`;

  // preBuffer に追加（常に最新 PRE_COUNT 件を保持）
  preBuffer.push(basePoint);
  if (preBuffer.length > PRE_COUNT) preBuffer.shift();

  // イベント判定（直前との差分）
  if (totalDiff > ACC_THRESHOLD) {
    // イベント：preBuffer（直近 PRE_COUNT 件） + 今回の1件をまとめて保存・表示
    // ただし位置情報が必要 -> getCurrentPosition で取得してから保存
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // combine points: preBuffer (may have null lat/lng) + current
      const pointsToSave = [];

      // clone preBuffer contents (but fill lat/lng with the current pos if missing)
      for (const p of preBuffer) {
        const clone = { ...p };
        if (!clone.lat) { clone.lat = lat; clone.lng = lng; } // best-effort fill
        clone.isEvent = true; // mark as event-context (we store pre-context as event-related)
        pointsToSave.push(clone);
      }

      // current point
      const cur = { ...basePoint, lat, lng, isEvent: true };
      pointsToSave.push(cur);

      // save each doc individually (subcollection "points")
      for (const pt of pointsToSave) {
        await savePointToFirestore(pt);
      }

      // 地図に赤いマーカー（現在中心を指定）
      addEventMarker(lat, lng, { totalDiff, total, timestamp: now });

      // clear preBuffer after handling event (so we don't resend same pre-context)
      preBuffer = [];
    }, (err) => {
      console.error("位置取得失敗（イベント）:", err);
    }, { enableHighAccuracy: true });
  }

  // 保存は periodic のタイマーで行う（毎 PERIODIC_S 秒）
  prevAcc = { x, y, z, total };
}

/* ==========================
   8秒ごとの定期保存（isEvent: false）
   - この関数は最新の preBuffer の最後の要素を位置情報で補完して Firestore に保存
   - 画面には表示しない（要望）
   ========================== */
async function periodicSaveTask() {
  if (!isMeasuring) return;

  // take the latest sample from preBuffer (if any)
  if (preBuffer.length === 0) return;

  const sample = preBuffer[preBuffer.length - 1];
  // obtain current GPS (best-effort) and save
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const pt = { ...sample, lat, lng, isEvent: false, timestamp: new Date().toISOString() };
    await savePointToFirestore(pt);
    // NOTE: this point is saved but not shown on map
  }, (err) => {
    console.error("位置取得失敗（periodic）:", err);
  }, { enableHighAccuracy: true });
}

/* ==========================
   start / stop の処理
   ========================== */
function startMeasurement() {
  initMap();
  sessionId = generateSessionId(new Date());
  isMeasuring = true;
  statusText.textContent = `測定中（session: ${sessionId}）`;
  startStopBtn.textContent = "測定終了";
  prevAcc = null;
  preBuffer = [];

  // devicemotion の permission（iOS）
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('devicemotion', handleMotion);
        } else {
          alert('加速度センサーの使用が許可されませんでした。');
        }
      })
      .catch(console.error);
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }

  // geolocation watch でユーザー位置を追跡し地図中心を更新
  if (navigator.geolocation) {
    geolocationWatchId = navigator.geolocation.watchPosition((pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (!map) initMap();
      try {
        userMarker.setLatLng([lat, lng]);
        map.setView([lat, lng], map.getZoom());
      } catch (e) {
        // 初回は userMarker 等が未作成の可能性
      }
    }, (err) => {
      console.error("位置情報監視エラー:", err);
    }, { enableHighAccuracy: true, maximumAge: 1000 });
  }

  // 8秒ごとの定期保存を開始
  periodicTimerId = setInterval(periodicSaveTask, PERIODIC_S * 1000);
}

async function stopMeasurement() {
  isMeasuring = false;
  statusText.textContent = "測定していません";
  startStopBtn.textContent = "測定開始";

  // remove listeners
  window.removeEventListener('devicemotion', handleMotion);
  if (geolocationWatchId !== null) {
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
  }

  // stop periodic saves
  if (periodicTimerId) {
    clearInterval(periodicTimerId);
    periodicTimerId = null;
  }

  // delete non-event points for this session from Firestore
  await deleteNonEventPointsForSession(sessionId);

  // reset map event markers? keep event markers visible — we keep them
  preBuffer = [];
  prevAcc = null;
  console.log("計測停止。非イベントデータは削除しました（sessionId:", sessionId, ")");
  sessionId = null;
}

/* ==========================
   ボタンイベント
   ========================== */
startStopBtn.addEventListener('click', () => {
  if (!isMeasuring) {
    startMeasurement();
  } else {
    stopMeasurement();
  }
});

/* ==========================
   最後に map を初期化しておく（見た目） — 実際の測定開始で位置追跡が始まる
   ========================== */
initMap();
