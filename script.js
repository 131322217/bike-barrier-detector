/* ==========================================================
   Firestore 後処理：イベント前後3件だけ残し、他を削除する
   ----------------------------------------------------------
   必要なもの：
     - db（Firestore）
     - currentSessionId（同一セッションの絞り込み用）
     - log()（画面ログ）
     - startStopBtn（UI制御）
   ========================================================== */

   async function postProcessSession() {
    log(`後処理を開始します…（sessionId: ${currentSessionId}）`);
  
    try {
      const colRef = collection(db, "accel_data");
      const q = query(colRef, where("sessionId", "==", currentSessionId));
      const snap = await getDocs(q);
  
      if (snap.empty) {
        log("データが見つからないため後処理をスキップします。");
        startStopBtn.disabled = false;
        return;
      }
  
      // 1) Firestore → 配列化
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // 2) time 昇順に並べる
      records.sort((a, b) => a.time - b.time);
  
      // 3) イベント index を収集
      const eventIdxList = [];
      records.forEach((r, i) => {
        if (r.isEvent) eventIdxList.push(i);
      });
  
      // 4) 残すべきIDリスト
      const keep = new Set();
  
      // イベントは必ず残す
      eventIdxList.forEach(i => keep.add(records[i].id));
  
      // イベント前後3件も残す
      eventIdxList.forEach(idx => {
        const min = Math.max(0, idx - 3);
        const max = Math.min(records.length - 1, idx + 3);
        for (let i = min; i <= max; i++) {
          keep.add(records[i].id);
        }
      });
  
      // 5) 不要データ削除
      let deleteCount = 0;
      for (const r of records) {
        if (!keep.has(r.id)) {
          await deleteDoc(doc(db, "accel_data", r.id));
          deleteCount++;
        }
      }
  
      log(`後処理完了：削除 ${deleteCount} 件 / 残す ${keep.size} 件`);
    } catch (err) {
      console.error(err);
      log("後処理中にエラーが発生しました。");
    }
  
    // ボタンの再有効化
    startStopBtn.disabled = false;
  }
  