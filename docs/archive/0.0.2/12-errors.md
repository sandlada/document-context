# 12 — 錯誤分類學

本章是**失敗語意**的單一事實來源：每一種失敗有穩定的識別碼、明確的出現位置，以及可預期的處置。其他章節引用它，不重複列出。

> 本章固定的是**行為**。TypeScript 的型別形狀（錯誤類別名稱、`details` 的結構型別）於**實作期**決定；下文的 `code` 只是規定的識別碼字串。

---

## 12.1 三條規則

1. **每一種失敗都有識別碼。** 使用者可以依 `code` 分支，不依賴訊息文字。
2. **失敗有固定的出現位置。** 同一個識別碼不會在 `throw`、`ready` 拒絕、Promise 拒絕與 `errors$` 之間漂移。
3. **取消不是錯誤。** 退訂與 abort 是使用者主動停止，**不得**寫入 `errors$`，也**不得**轉成失敗識別碼。

## 12.2 出現位置

| 位置 | 意義 |
| :--- | :--- |
| **throw** | 呼叫點同步拋出。呼叫者可以用 `try/catch` 立即接住。 |
| **`ready` 拒絕** | `session.ready` 以該失敗拒絕；會話隨後 `disposed`。 |
| **Promise 拒絕** | `inject` / `injectAll` 的 Promise 拒絕。 |
| **串流錯誤** | `inject$` / `injectAll$` 的 Observable 發出 error 訊號。 |
| **`errors$`** | 非致命的錯誤推入會話的錯誤串流；不中斷其他流程。 |

一個識別碼可以出現在多個位置，但**同一次呼叫的失敗只會走其中一條路**。

## 12.3 識別碼總表

| # | `code` | 觸發 | 出現位置 | 致命 |
| :--- | :--- | :--- | :--- | :--- |
| `ERR #1` | `UNCONNECTED_HOST` | 瀏覽器中對未連線元素 `mount`；或匿名會話在初始化期間確認斷線 | throw / `ready` 拒絕 | 是 |
| `ERR #2` | `HOST_INVALID` | 掛載對象不是元素（文字節點、文件片段、非節點）；或暫停期間 `native()` 對應的節點已被回收 | throw / `ready` 拒絕 | 是 |
| `ERR #3` | `TOKEN_INVALID` | token 名稱不符合 `namespace:name` 規則 | throw | 是 |
| `ERR #4` | `KEYED_CONFLICT` | 兩個已連線宿主持有同一個 keyed token；或同一宿主的身分衝突 | throw | 是 |
| `ERR #5` | `SINGLETON_CONFLICT` | 同一 Application 內重複註冊同名 singleton | `errors$` | 否 |
| `ERR #6` | `UNKNOWN_SERVICE` | `Session` 目標上找不到可解析的單值註冊且未開 `wait`；`uses` 宣告的依賴無法解析 | Promise 拒絕 / 串流錯誤 / `ready` 拒絕 | 是 |
| `ERR #7` | `CIRCULAR_DEPENDENCY` | `uses` 圖有環，或動態等待繞回自己 | `ready` 拒絕 / Promise 拒絕 / 串流錯誤 | 是 |
| `ERR #8` | `DISPOSED_SESSION` | 對已 `disposed` 的會話呼叫 `inject` | Promise 拒絕 / 串流錯誤 | 是 |
| `ERR #9` | `HOOK_ERROR` | `onMount` 以外的鉤子拋錯或拒絕 | `errors$` | 否 |
| `ERR #10` | `MOUNT_ABORTED` | （已廢止；依 E-1 裁決由 `signal.reason` 直接拒絕，不另設碼） | `ready` 拒絕 | 是 |
| `ERR #11` | `FOREIGN_SESSION` | 對某個 `Session` 操作的 Application 不是 mount 出該 Session 的那一個（[11-composition](./11-composition.md) §11.4） | throw | 是 |
| `ERR #12` | `INVALID_OPTIONS` | 掛載選項組合不合法（例如 `suspensionTtlMs: Infinity` 未搭配 `retention: 'pinned'`） | throw | 是 |
| `ERR #13` | `PENDING_LIMIT_EXCEEDED` | 同一 Application 的 pending 注入數量超過上限 | Promise 拒絕 / 串流錯誤 | 是 |

## 12.4 逐條語意

### `ERR #1` — `UNCONNECTED_HOST`

瀏覽器的掛載對象必須是**已連線**的元素。未連線時 `mount` 同步拋出。

初始化期間被確認斷線的**匿名**會話，屬於同一種失敗：`ready` 以 `UNCONNECTED_HOST` 拒絕，會話 `disposed`。keyed 會話在同樣情況下**不**失敗，而是轉入 `suspended`（見 [02-lifecycle](./02-lifecycle.md) §2.3）。

### `ERR #2` — `HOST_INVALID`

掛載對象必須是元素。文字節點、文件片段、任意非節點物件一律拒絕。

暫停期間 `native()` 的語意是「解參考或拋錯」：節點仍可取回時回傳它；節點已被回收時拋 `HOST_INVALID`。恢復後 `native()` 重新指向新宿主。

### `ERR #3` — `TOKEN_INVALID`

`defineToken` 的公開名、`mount` 的 `token` 選項、寫回宿主的鍵值字串，共用同一套驗證規則。**私有 token 不走這條規則**——它的名字僅供除錯。

### `ERR #4` — `KEYED_CONFLICT`

兩種情形：

- **跨宿主**：同一 Application 中，兩個已連線宿主持有同一個 keyed token。後一次 `mount` 拋出。
- **同宿主**：同一元素上已有會話，再次 `mount` 且身分衝突。依 `onConflict` 處理（見 [09-mount-host](./09-mount-host.md) §9.4）。

`onConflict: 'replace'` 與 `'reset'` **只**處理同宿主衝突；跨宿主的 keyed 衝突是硬失敗。

### `ERR #5` — `SINGLETON_CONFLICT`

同一 Application 內重複註冊同名 singleton 時，**先註冊者勝出**，後者被忽略。後者的會話在 `active` 之前收到一筆 `SINGLETON_CONFLICT`。這是**非致命**的：會話照常 `active`。

### `ERR #6` — `UNKNOWN_SERVICE`

`Session` 目標的 `inject` 在藍圖與既有 `active` 祖先都找不到該 token 時，預設**立即拒絕**。需要等待「也許稍後會出現的祖先」時傳 `wait: true`。

`uses` 宣告的依賴若無法解析，`ready` 以 `UNKNOWN_SERVICE` 拒絕——宣告錯了就是錯了，不會等到永遠。

### `ERR #7` — `CIRCULAR_DEPENDENCY`

`uses` 圖有環時，環上的工廠**不執行**，`ready` 拒絕。動態等待繞回自己時同理。

### `ERR #8` — `DISPOSED_SESSION`

對已銷毀的會話解析依賴。`update` 不拋錯，它回傳 `false`（見 [01-api](./01-api.md) §1.5）。

### `ERR #9` — `HOOK_ERROR`

`onMount` 以外的鉤子（`onSuspend` / `onResume` / `onAdopt` / `onDispose`）拋錯時，錯誤封裝成 `HOOK_ERROR` 推入 `errors$`，**其餘鉤子繼續執行**，銷毀流程不中斷。

`onMount` 失敗是另一回事：`ready` 拒絕、會話 `disposed`（見 [02-lifecycle](./02-lifecycle.md) §2.2）。

### `ERR #10` — `MOUNT_ABORTED`（已廢止）

`MountOptions.signal` 在 `starting` 期間 abort。`ready` 以**平台慣例**拒絕——預設是 `signal.reason`（通常為 `AbortError`），不保證是本庫的錯誤型別。進入 `active` 之後，`signal` 不再有任何作用；取消那次掛載的方式是 `dispose(session)`。依裁定 E-1，此識別碼已廢止，不作為獨立 ErrorCode 產生。

### `ERR #11` — `FOREIGN_SESSION`

對某個 `Session` 做 `update` / `inject` / `dispose` 的 Application，必須是 mount 出該 Session 的那一個。跨實例操作同一個 `Session` **必須被拒絕**，不得靜默 `no-op`——靜默失敗會讓跨實例的 bug 難以追查（見 [11-composition](./11-composition.md) §11.4）。

這個碼只在**動詞的目標是 Session** 時出現：目標是元素時，元素只屬於它的文件，不存在跨 Application 的問題。

### `ERR #12` — `INVALID_OPTIONS`

掛載選項的組合檢查失敗。`suspensionTtlMs: Infinity` 必須同時傳 `retention: 'pinned'`，否則 `mount` 拋出此碼（**不是**一般 `Error`）。

### `ERR #13` — `PENDING_LIMIT_EXCEEDED`

同一 Application 的 pending 注入表達到上限時，新的等待請求被拒絕，而不是無限累積。上限值是 Application 級設定（見 [13-reactivity](./13-reactivity.md) 與 [14-ports](./14-ports.md)）。被拒絕的請求**不**寫入 `errors$`——它是呼叫者自己的請求失敗，由呼叫者處理。

## 12.5 取消與終止

取消**不是**失敗，因此**沒有**對應的識別碼：

| 動作 | 結果 |
| :--- | :--- |
| 退訂 `inject$` / `injectAll$` | 串流 `complete()`，不送錯誤 |
| `MountOptions.signal` abort | `ready` 以 `signal.reason` 拒絕（見 `MOUNT_ABORTED`） |
| 目標元素確認斷線 | 元素目標的等待以 `UNCONNECTED_HOST` 結束 |
| 所屬會話 `dispose` | 等待以 `DISPOSED_SESSION` 結束 |
| 會話 `disposed` | `update` 回傳 `false`，不拋錯 |

取消**不**寫入 `errors$`。

## 12.6 錯誤串流

`errors$` 承載**非致命**失敗：`SINGLETON_CONFLICT`、`HOOK_ERROR`，以及初始化期間發生、但不足以讓掛載失敗的問題。

- 初始化期間的錯誤會被**緩衝**，不會因為訂閱者還沒接上而遺失。
- 第一次訂閱會先收到緩衝，再轉為純熱流。
- `errors$` 在會話 `disposed` 且清理結算後**完成**。
- `errors$` **永不**以錯誤結束——它本身就是錯誤的載體。

細節見 [13-reactivity](./13-reactivity.md) §13.3。

## 12.7 與其它章節的分工

- 狀態更新失敗的語意：[01-api](./01-api.md) §1.5
- 生命週期與鉤子失敗：[02-lifecycle](./02-lifecycle.md) §2.2、§2.4
- 等待與拒絕的結束條件：[04-promise-lazy](./04-promise-lazy.md) §4.3、§4.4
- keyed 衝突的處理：[09-mount-host](./09-mount-host.md) §9.4
- 錯誤串流的語意：[13-reactivity](./13-reactivity.md)
