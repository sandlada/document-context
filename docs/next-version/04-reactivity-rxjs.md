# 04 — RxJS 響應式核心 (Reactivity)

RxJS 在本專案是 **強制依賴與第一公民**，而非選用互操作層。狀態、錯誤、生命週期全部以 `Observable` 表達。

## 4.1 Session 上的四個串流

| 串流 | 型別 | 語意 |
| :--- | :--- | :--- |
| `state$` | `Observable<S>` | 熱、背靠當前值；訂閱即得當前快照，之後持續推送 |
| `errors$` | `Observable<DocumentContextError>` | 非致命錯誤匯流；**初始化期緩衝**（≤ 32 筆，首次訂閱排空），之後為純熱流；於銷毀結算後 `complete()` |
| `lifecycle$` | `Observable<LifecycleEvent>` | mounted / suspended / resuscitated / adopted / disposed |
| `abort$` | `Observable<void>` | Session 銷毀時**即時**發射一次；所有內部訂閱以此收斂 |

```ts
// state$ 為熱串流，無需等待即有當前值
session.state$.pipe(
    map((s) => s.count),
    distinctUntilChanged()
).subscribe(console.log)
```

- 初始化期緩衝確保 `mount` 完成前發生的水合 / 儲存錯誤不會遺失。
- `errors$` 是唯一「延後 `complete()`」的串流：等待非同步清理結算（見 [05-lifecycle-host.md](./05-lifecycle-host.md) §5.2 與 [13-decisions.md](./13-decisions.md) D-09）。

## 4.2 狀態流背靠 BehaviorSubject 語意

`state$` 由一個 BehaviorSubject 風格的狀態 store 支撐：

- 新訂閱者 **立即** 收到當前狀態。
- `update` 產生新的不可變狀態快照並推送。
- store 在 Session `Disposed` 時 `complete()`，並進入毒化保護。

```ts
// 讀取（同步投影・二等）
const count = selectSync((s) => s.count)(session)

// 串流（精細、可組合）
const count$ = select$((s) => s.count)(session)

// 更新（回傳是否成功；Disposed → false）
const ok = update((s) => ({ count: s.count + 1 }))(session)
```

- `update` 一律 **shallow merge**（物件展開語意；不深合併、不刪鍵）。
- `selectSync(selector)` 快取最後一次 `(state, result)` 配對：同一快照重複呼叫不重算，快照更新後失效。
- `select$` 不在內部過濾：每次狀態變更即推送，去重請自行組合 `distinctUntilChanged`。

## 4.3 動詞的同步/串流雙軌

| 面向 | 同步投影（二等・僅 Session） | 串流 / 等待（一等・晚綁定） |
| :--- | :--- | :--- |
| 讀取 | `selectSync(selector)(session)` | `select$(selector)(session)` |
| 訂閱 | — | `subscribe$(listener)(session)` |
| 注入（單值） | `injectSync(token)(session)` | `inject$(token)(target)`（冷；resolve-once）／`inject`（`Promise`） |
| 注入（多值） | `injectAllSync(token)(session)` | `injectAll$`（冷；首次非空後 complete）／`injectAll`（`Promise`） |
| Session 追蹤 | `getSessionSync(element)` | `session$(element)` |

> 設計取捨：`inject` 維持 `Promise`，因為單值非同步的 `await` 語意比 `Observable` 直觀；需要串流或組合的依賴用 `inject$`。`injectSync` 遇非同步服務拋 `ASYNC_SERVICE_NOT_READY`。元素目標一律晚綁定（見 [09b-late-binding.md](./09b-late-binding.md)）：缺席 = pending，非錯誤。晚綁定流 / Promise 均接受 `signal` 取消：Observable 面取消即 `complete()`（等同退訂），Promise 面以 `signal.reason` 拒絕。

## 4.4 內部訂閱收斂（takeUntil 契約）

所有掛載期建立的內部訂閱，一律以 `abort$` 收斂：

```ts
session.state$.pipe(
    takeUntil(session.abort$)
).subscribe(/* ... */)
```

- Session 銷毀時 `abort$` 發射，所有內部訂閱自動解除。
- 使用者若直接訂閱 `state$`，請同樣以 `takeUntil(session.abort$)` 或 `subscribe$` 收斂，避免洩漏。
- `subscribe$(listener)(session)` 內部已套用 `takeUntil(abort$)`，回傳 `Subscription`。

## 4.5 排程與批次（透過 SchedulerPort）

domain 不直接使用 `queueMicrotask` / `setTimeout` / `requestAnimationFrame`，而經 `SchedulerPort`：

- 儲存寫入以微任務批次（batch）合併（見 [06-storage.md](./06-storage.md) §6.5）。
- Suspend TTL 計時器使用 `scheduler.timeout`。
- `frame` 保留給使用者側高頻渲染自組（本庫不代管 DOM 寫入）。

SSR / 測試可注入假排程器使行為確定化。

## 4.6 錯誤策略

```ts
session.errors$.subscribe((error) => {
    // 非致命：儲存解析失敗、鉤子例外
    report(error.code, error.resolutionGuide)
})
```

- 致命 / 非致命的完整對照以 [02-domain-model.md](./02-domain-model.md) §2.7 為 **單一事實來源**（不在此複列）。
- 鉤子/清理閉包在獨立沙箱執行；拋錯封裝後送 `errors$`，**不中斷** 其餘清理與銷毀。

## 4.7 不變式

1. `state$` 恆為熱串流，新訂閱立即取得當前值。
2. 所有內部訂閱以 `abort$` 收斂；Session 銷毀後不再有活動訂閱。
3. 所有串流在 Session 銷毀時 `complete()`；唯一例外：`errors$` 於清理結算後 `complete()`（見 §4.1）。
4. `abort$` 於銷毀時即時發射；非同步清理的拒絕仍經 `errors$` 回報。
5. domain 不引用任何瀏覽器排程 API（經 `SchedulerPort`）。
6. `inject$` / `injectAll$` 為冷串流且 resolve-once：缺席 = pending，首次解析後 `complete()`；取消（unsubscribe / `signal`）即解除 pending。
7. `session$` 為熱流、背靠當前值；只認已連線的 Mounted Session；`signal` 取消即 `complete()`。
