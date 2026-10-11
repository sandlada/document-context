# 06 — 儲存 (Storage)

儲存設計原則是 **極簡契約、策略上移**：核心只定義最小 `StoragePort` 契約與 `persist` 運算子；序列化、水合優先級、版本遷移、跨標籤同步策略由 application 層組合子提供。

## 6.1 契約

```ts
// domain/ports/storage.ts
export type StorageError =
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'corrupt', readonly raw: string }
    | { readonly kind: 'quota' }
    | { readonly kind: 'unknown', readonly cause: unknown }

export type StorageResult<T> =
    | { readonly ok: true, readonly value: T }
    | { readonly ok: false, readonly error: StorageError }

export interface StoragePort {
    read(key: string): MaybePromise<StorageResult<string | null>>
    write(key: string, value: string): MaybePromise<StorageResult<void>>
    remove(key: string): MaybePromise<StorageResult<void>>
    observe$(key: string): Observable<string | null>
}
```

契約要點：

- **不拋例外**：`StoragePort` 實作 MUST 回傳 `StorageResult<T>`，MUST NOT 拋例外；錯誤亦可鏡射到 `session.errors$`。驗證見 10 §10.3 `storagePortContract` 對應行。
- **MaybePromise**：同步為預設，非同步以支援 IndexedDB 等；**不另立非同步埠**。
- **只收發 `string`**：`StoragePort` 實作 MUST 只收發 `string`；序列化（JSON、版本封裝）在 application 層完成。
- **`observe$` 僅外部變更**：自身寫入 MUST NOT 經 `observe$` 回流，避免回饋迴圈。

## 6.2 `persist` 運算子

```ts
export interface StorageKeywords {
    readonly localStorage: true
    readonly sessionStorage: true
}

export interface StorageOptions<S> {
    readonly storage: keyof StorageKeywords | StoragePort
    readonly key: string
    readonly hydration?: 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge'   // 預設 storageFirst
    readonly version?: number
    readonly migrate?: (persisted: unknown, oldVersion: number) => Partial<S>
    readonly crossTab?: boolean   // 預設 true
    readonly conflict?: 'lww' | 'ignore-external' | ((local: S, remote: S) => S)   // 預設 'lww'
}

export function persist<S>(options: StorageOptions<S>): (bp: ContextBlueprint<S>) => ContextBlueprint<S>
```

```ts
import { createContext, persist, pipe } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0, theme: 'light' as 'light' | 'dark' }),
    persist({
        storage: 'localStorage',
        key: 'app:counter',
        hydration: 'storageFirst',
        version: 2,
        migrate: (persisted, oldVersion) => {
            if (oldVersion < 2) return { ...(persisted as Record<string, unknown>), theme: 'light' }
            return persisted as Partial<{ count: number, theme: 'light' | 'dark' }>
        },
        crossTab: false
    })
)

// 計數器與累加類在 LWW 下丟增量；跨 tab 計數請關 `crossTab` 或用 `conflict` 合併函數。
// `crossTab: true` 適用主題與偏好等整值替換語義。
```

- `storage` 可為內建關鍵字或自訂 `StoragePort` 實例（使用者完全掌控 CRUD）。自訂關鍵字以 `StorageKeywords` 聲明合併擴展（`storage: keyof StorageKeywords | StoragePort`，內建 `'localStorage'` 與 `'sessionStorage'` 為預設）。
- `'localStorage'` / `'sessionStorage'` 為預設 adapter，置於 `@sandlada/document-context/infrastructure/storage`，可 tree-shake；關鍵字由 **Application 的 storage registry** 解析（`createApplication` 裝配，見 [09-infrastructure.md](./09-infrastructure.md) §9.1）；未註冊的關鍵字 → `UNKNOWN_SERVICE`。
- 同一藍圖重複 `persist`：後者覆蓋前者。
- SSR / 無 `window` 環境：關鍵字 storage 退化為 null-storage（`unavailable`，靜默降級至藍圖種子，不推錯誤；本例外對 §6.7 #4 而言）。

## 6.3 水合優先級與數據流管線

| 策略 | 決策 |
| :--- | :--- |
| `storageFirst`（預設） | 儲存 > payload（SSR JSON） > 藍圖種子 |
| `payloadFirst` | payload > 儲存 > 藍圖種子 |
| `blueprintFirst` | 藍圖種子 > 儲存 > payload |
| `merge` | 依序淺層合併（藍圖 → 儲存 → payload） |

> 註：v0.0.1 的 `domFirst` 與早期草案的 `projectionFirst` 均廢止——投影為非目標（見 [08-projection.md](./08-projection.md)）；「以 payload 為先」的新名為 `payloadFirst`。
> 註：`onConflict:'reset'` 舊態替代「藍圖種子」槽位，其餘不變；HMR 保熱態請用 `blueprintFirst`（見 05 §5.5）。

- 水合於 `mountSync`（同步可解析者）或 `mount`（需等待非同步儲存）時完成，結果寫回 `state$` 並推送給訂閱者。先完成水合再實例化 eager；eager 內 `selectSync` 必為水合後狀態（水合完成前不調任何 eager；完成後 eager 可讀寫已水合態）。
- **`mountSync` 遇非同步儲存**（`read` 回傳 Promise）→ `ASYNC_SERVICE_NOT_READY`（改用 `mount`）。

**四階段管線**（分策略 wiring，階段編號固定）：

1. 讀取：並行讀 storage 與 payload，各自容錯降級（storage 失敗視同無儲存；payload 讀取或解析失敗視同未提供，不中斷掛載）。
2. 遷移：`migrate` 只吃 storage 原始 `d`，輸出替代 storage 側、優先級不變；失敗 → `INVALID_STORAGE_DATA` 加藍圖種子；單步、無目標版本、同步。
3. 合併：按策略合併——`storageFirst` 取首個可用源；`payloadFirst` 同理；`blueprintFirst` 種子優先；`merge` 依序頂層淺合併（藍圖 → 儲存 → payload）。
4. 種子回填：缺鍵回填藍圖 initial；三源全缺即藍圖類型違約（斷言「種子須完備」，不新增錯誤碼）。

- **嵌套對象規則**：頂層淺合併（nested 整替換），與 `update` 同深（見 04 §4.5，互為指針）。嵌套偏好類需用戶展平頂層鍵或用 `migrate` 預整形。
- **來源獨有鍵**：三源鍵並集；缺鍵為無意見，不刪不置 `undefined`。storage 殘留鍵可「復活」已刪藍圖鍵，須由 `migrate` 顯式清理。
- **部分 payload 空洞下探**：payload 缺鍵下探 storage 再下探種子（payload 缺 → storage → 種子）。
- **水合中外部更新**：水合完成前到達的外部更新排隊，視同水合後的一次遠端寫走 LWW 與 `conflict` 管線（見 §6.5），不參與水合優先級比較。

## 6.4 版本與遷移

- **封裝格式**：`{ "v": number, "d": unknown }`（`d` 為 JSON 狀態快照）；未設 `version` 時 `v = 0`。
- 讀取比對：
    - `v === version` → 採用。
    - `v < version` → `migrate(persisted, oldVersion)` 轉換（只吃 storage 原始 `d`，輸出替代 storage 側、優先級不變）；失敗 → `INVALID_STORAGE_DATA` + 藍圖種子。
    - `v > version` → 資料來自較新版本：**不採用、不覆寫**，推 `INVALID_STORAGE_DATA`，以藍圖種子起步；並置 `storageVersionGuard:'newer-blocked'`——後續該 key 批次寫全攔（讀、訂閱、狀態演進照常，只不寫回），首攔追加一次同碼（`details.guarded:true`）；解除為 bump `version` 重 mount，零新 API（顯式 ack 列 P1）。
- 資料毀損（parse 失敗 / 形狀不符）→ `INVALID_STORAGE_DATA` + 藍圖種子（安全降級）。
- `v > version` 會話為只讀後端模式（本地編輯只活內存，直到發版對齊）。

## 6.5 跨標籤同步

`crossTab: true`（預設）時，`infrastructure/storage/sync.ts` 提供：

- 監聽 `storage` 事件（同源其他分頁的寫入，沿用信封）。
- 可選 `BroadcastChannel` 作為更即時通道，消息信封為 `{ kind, key, v, d, ts, tabId, seq }`；「last」為 `(ts, seq, tabId)` 全序。
- 可選 W3C Web Locks API 協調並發寫入：鎖名 `dc-storage:<key>`，`mode:'exclusive'`，僅包 read-modify-write 的寫節（flush 與外部應用各持鎖）；無 Locks 降級為無鎖（全序仍保證收斂）。key 宜 URL-safe 轉義。

外部變更經 `StoragePort.observe$` 流入，觸發 `update`，**不** 回流自身寫入。

- **自回聲規則**：`(tabId, sessionId)` 同者丟棄為真自回聲；同 tab 兄弟 session 視為合法外部變更祝福接收。同 key 多 session 即多寫者（互相覆蓋符合 LWW）。
- **寫收排序**：應用外部快照前先 flush 本地待刷批次，再按 `(ts, seq, tabId)` 全序公平比較（flush-then-compare）；`conflict` 鉤子在比較點調用，返回值經正常 `update` 加批次寫回。非同步後端 best-effort flush 殘餘窗口誠實注記（見寫入節奏）。
- **入站冪等**：雙重去重——`(tabId, seq)` 已見即丟（per-key 有界集，如最近 128）；storage 值字符串整體（含 `{ v, d }`）字節相等即丟。
- **衝突策略**：預設 last-write-wins（LWW）：外部變更以整快照替換本地狀態；不做 rebase（CRDT 需求請自訂 `StoragePort`）。`conflict?: 'lww' | 'ignore-external' | ((local, remote) => S)` 預設 `'lww'`。
- **寫入節奏**：狀態變更後以微任務批次合併寫入；`dispose` 時對同步 adapter 立即 flush（保證最後一致性）；非同步 adapter 為 best-effort（文件明示）。
- **quota**：寫入失敗推 `errors$`（`INVALID_STORAGE_DATA`，`details` 為 `{ op:'write', key, storageKind }`）；後續更新照常重試，不自動退避。
- **時鐘誠實聲明**：`Date.now()` 跨 tab 有毫秒級 skew，不承諾物理同時的公平性。

## 6.6 使用者自訂 adapter（Bring Your Own，BYO CRUD）

```ts
import { Observable } from 'rxjs'
import type { StoragePort, StorageResult } from '@sandlada/document-context/domain'

const memoryStore = new Map<string, string>()

export const memoryStorage: StoragePort = {
    read: (key): StorageResult<string | null> => ({ ok: true, value: memoryStore.get(key) ?? null }),
    write: (key, value): StorageResult<void> => {
        memoryStore.set(key, value)
        return { ok: true, value: undefined }
    },
    remove: (key): StorageResult<void> => {
        memoryStore.delete(key)
        return { ok: true, value: undefined }
    },
    observe$: () => new Observable<string | null>(() => {})
}
```

使用者只需實作四個方法即可接上任何後端（IndexedDB、遠端 API、記憶體）。

## 6.7 不變式

1. `StoragePort` 實作 MUST 回傳 `StorageResult`，MUST NOT 拋例外——驗證見 10 §10.3 `storagePortContract` 對應行。
2. 自身寫入 MUST NOT 經 `observe$` 回流。
3. adapter MUST 只處理 `string`；序列化與封裝（`{ v, d }`）在 application。
4. 毀損 / 遷移失敗 / 版本過新一律安全降級並回報 `errors$`（SSR null-storage 路徑除外——見 §6.2，靜默設計）；版本過新時不覆寫。
5. 寫入以微任務批次合併；`dispose` 時對同步 adapter 立即 flush。
6. 跨標籤外部變更採 LWW 整快照替換（`conflict` 鉤子除外）。
