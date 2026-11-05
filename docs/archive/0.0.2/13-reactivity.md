# 13 — RxJS 語義

本庫的狀態、錯誤與生命週期都以 Observable 表述。本章固定這些串流的**行為**：冷熱、重播、推送時機、去重、完成條件與錯誤通道。

> 本章固定的是**行為**。RxJS 運算子的選用、內部 Subject 的種類與 `Observable` 的型別形狀於**實作期**決定。

`rxjs` 是**必要的 peer dependency**，不是選用的互操作層。

---

## 13.1 串流總表

| 串流 | 冷熱 | 背靠當前值 | 結束 |
| :--- | :--- | :--- | :--- |
| `state$` | 熱 | 是 | 會話 `disposed` 時完成 |
| `errors$` | 熱 | 否（初始化期有緩衝） | 清理結算後完成 |
| `lifecycle$` | 熱 | 是（背靠當前狀態事件） | 會話 `disposed` 時完成 |
| `session$` | 熱 | 是（背靠當前最近會話） | 沒有明確結束點；退訂即結束 |
| `inject$` | 冷 | 否 | 送出一筆後完成；失敗時以錯誤結束 |
| `injectAll$` | 冷 | 否 | 首次得到非空陣列後完成；失敗時以錯誤結束 |

一次性等待用 Promise（`inject` / `injectAll`）。`inject$` 與 `injectAll$` **不是**持續串流——它們只是 `inject` 的串流外形，解析一次就結束。見 [04-promise-lazy](./04-promise-lazy.md) §4.1。

## 13.2 `state$`

- **熱流、多播。** 每個訂閱者都收到全部推送。
- **背靠當前值。** 訂閱的那一刻立刻收到當前快照，不需要等待。
- **推送是同步的。** `update` 成功後，訂閱者**在同一個呼叫堆疊內**收到新快照。狀態推送不經排程。
- **去重依引用。** 新舊快照以引用相等比較：若 `update` 產生了與前一筆**同一個物件**，**不推送**。回傳同一份快照的 `update` 因此是靜默的。
- **快照不可變。** 快照交到呼叫者手上後不得被改動。初始狀態在建立藍圖時被**複製**，呼叫者之後改動原始物件不影響會話。
- **在 `suspended` 期間仍然推送。** 暫停不是靜止：keyed 會話在暫停期間仍可 `update`，訂閱者照常收到。
- **會話 `disposed` 時完成。** 完成後不再推送。

```ts
const count$ = session.state$.pipe(
    map((state) => state.count),
    distinctUntilChanged(),
)
```

> `state$` **不內建** `distinctUntilChanged` 的「值」語意：它只做引用去重（見上）。欄位級去重由呼叫者自行組合。

## 13.3 `errors$`

`errors$` 承載**非致命**失敗（`SINGLETON_CONFLICT`、`HOOK_ERROR` 等，見 [12-errors](./12-errors.md) §12.3）。

- **初始化期緩衝。** 掛載初始化期間發生的錯誤會被緩衝，不會因為訂閱者還沒接上而遺失。
- **緩衝上限 32 筆。** 滿時**丟最舊、保最新**，並記錄被丟棄的筆數。
- **第一次訂閱排空緩衝。** 首個訂閱者先收到緩衝中的錯誤（最後一筆附帶被丟棄的筆數），之後轉為純熱流；**第二個及後續**訂閱者只收到自己訂閱之後的新事件。
- **永不以錯誤結束。** `errors$` 本身不承載「串流失敗」，它就是錯誤的載體。
- **清理結算後完成。** 會話 `disposed` 且非同步清理落定後，`errors$` 完成。

```ts
const subscription = session.errors$.subscribe((error) => {
    report(error.code, error.details)
})
```

> 想讀到初始化期被緩衝的錯誤，必須在 `mount` 之後**立刻**訂閱；晚一步就只能收到之後的新事件。

## 13.4 `lifecycle$`

生命週期**事件**流，不是狀態流。

- **熱流、背靠當前狀態。** 訂閱的那一刻立刻收到一筆代表**當前狀態**的事件（`active` / `suspended` / `disposed`）；`starting` 沒有對應事件——要讀當前狀態用 `session.status`。
- **事件集合**：`active`、`suspended`、`resumed`、`adopted`、`disposed`。`disposed` 帶 `reason`。
- **不重播歷史。** 只送「背靠當前狀態」那一筆，之後才是增量。
- **會話 `disposed` 時完成。**

`lifecycle$` 與 Context Protocol 的 `context-mount` / `context-dispose` **語意相近但不是同一通道**：前者只對持有該 `Session` 的訂閱者可見，後者是 DOM 事件、可跨 bundle。見 [10-events](./10-events.md) §10.2。

## 13.5 `session$`

追蹤某個元素所處的**最近會話**。

- **熱流、背靠當前值。** 訂閱立刻收到當前最近會話（可能是 `null`）。
- **只認 `active` 且宿主仍連線的會話。** `starting` 與 `suspended` 對這條查詢不可見，因此對應的值是 `null`。
- **恢復時送回同一個 `Session` 物件**，不是新物件。呼叫者可以安全地用 `===` 比較。
- **沒有「完成」的語意。** 這是追蹤面，不是會話生命週期；退訂即結束。

## 13.6 `inject$` / `injectAll$`

**冷流、resolve-once。** 每次訂閱都是一次獨立的解析嘗試。

| 情境 | 結束方式 |
| :--- | :--- |
| 單值解析成功 | 送出一筆後 `complete()` |
| 單值解析失敗 | 以錯誤結束（`UNKNOWN_SERVICE` / `DISPOSED_SESSION` / …） |
| 多值首次得到**非空**陣列 | 送出一筆後 `complete()` |
| 多值在 `Session` 目標上得到空結果 | 立即以 `[]` 結束——藍圖不會再長出新的註冊 |
| 多值在元素目標上一直空 | **不結束**，直到目標斷線或所屬會話 `disposed` |
| 退訂 | `complete()`，不送錯誤 |

空陣列永不結案是刻意的：元素可能在稍後才掛上提供者。代價是呼叫者必須自己退訂。見 [04-promise-lazy](./04-promise-lazy.md) §4.5。

## 13.7 內部收斂

會話內部建立的每一個訂閱，都以**會話的 abort 邊界**收斂。公共面提供 `session.abortSignal`（平台標準，可直接餵給 `fetch`），內部另外維護一份等價的單次訊號用於收斂。

- 會話進入 `disposed` 時，abort 邊界**立即**觸發。
- 內部訂閱隨之解除，不留殘留監聽器。
- 非同步清理的失敗走 `errors$`，不影響 abort 時序。

> 為什麼公共面是 `abortSignal` 而不是 `abort$`：`AbortSignal` 是平台標準，可直接與 `fetch`、 Streams、Node 的 I/O 整合；單一的 abort 邊界也避免「會話生命」與「每次注入」各走一套時鐘（見 [04-promise-lazy](./04-promise-lazy.md) §4.4）。

## 13.8 排程

庫內部所有**時間相關**的行為都經排程埠，不在動詞裡裸用 `setTimeout` / `queueMicrotask`：

| 用途 | 排程 |
| :--- | :--- |
| 斷線後的微任務重掛確認 | 微任務 |
| keyed 會話的暫停 TTL 計時 | 逾時 |
| pending 注入的批次喚醒 | 微任務批次 |
| 觀察者的重檢 | 微任務 |

**狀態推送本身不同步排程**——它同步發生（見 §13.2）。這是刻意的對比：時間行為需要可控與可測試，狀態更新需要「寫完就讀得到」。

SSR 與測試可注入假排程器，使時間行為確定化。

## 13.9 重入與背壓

- `update` 是同步的；推送也是同步的。**在 `state$` 的回呼裡再 `update` 會造成同步遞迴**。這是呼叫者的責任；要攤平就自己用微任務或節流算子。
- 慢消費者不會被丟棄事件，也不會被緩衝到無上限；RxJS 的標準背壓語意適用。
- 本庫**不**在內部做節流、去重或批次合併——那是呼叫者的選擇。

## 13.10 常用組合

```ts
// 欄位級投影 + 去重
const label$ = session.state$.pipe(map((s) => s.label), distinctUntilChanged())

// 只在初始化期間活躍
const sub = session.state$.subscribe(render)

// 手動提早結束（正常情況下會話銷毀時就會完成）
const sub = session.state$.pipe(takeUntil(mySignal)).subscribe(render)

// 生命週期
session.lifecycle$.subscribe((event) => log(event.type))
```

## 13.11 不變式

| # | 不變式 |
| :--- | :--- |
| `RX #1` | `state$` 恆為熱流；新訂閱立即取得當前快照。 |
| `RX #2` | 狀態推送**同步**發生，且只推送引用不同的快照。 |
| `RX #3` | `state$`、`lifecycle$` 在會話 `disposed` 時完成；`errors$` 在清理結算後完成。 |
| `RX #4` | `errors$` 永不以錯誤結束；初始化期錯誤緩衝上限 32 筆，首訂排空並附記賬。 |
| `RX #5` | `lifecycle$` 只背靠**當前狀態**那一筆，不重播歷史。 |
| `RX #6` | `inject$` / `injectAll$` 為冷流且 resolve-once；元素目標上的空多值集合永不結案。 |
| `RX #7` | 內部訂閱一律以會話的 abort 邊界收斂；銷毀後無活動訂閱。 |
| `RX #8` | 所有時間行為經排程埠；狀態推送不經排程。 |
| `RX #9` | `session$` 只認 `active` 且宿主仍連線的會話；恢復時送回**同一個** `Session` 物件。 |
| `RX #10` | 取消（退訂）不寫入 `errors$`，不轉成失敗識別碼。 |

每條不變式至少對應一個具名測試；清單見 [15-testing](./15-testing.md)。

## 13.12 與其它章節的分工

- 串流的欄位與型別：[01-api](./01-api.md) §1.2
- 等待與拒絕：[04-promise-lazy](./04-promise-lazy.md)
- 事件通道的區分：[10-events](./10-events.md) §10.2
- 錯誤識別碼：[12-errors](./12-errors.md)
- 排程埠：[14-ports](./14-ports.md)
