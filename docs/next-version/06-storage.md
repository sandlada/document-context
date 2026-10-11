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

- **不拋例外**：一律回傳 `StorageResult<T>`；錯誤亦可鏡射到 `session.errors$`。
- **MaybePromise**：同步為預設，非同步以支援 IndexedDB 等；**不另立非同步埠**。
- **只收發 `string`**：序列化（JSON、版本封裝）在 application 層完成。
- **`observe$` 僅外部變更**：自身寫入不回流，避免回饋迴圈。

## 6.2 `persist` 運算子

```ts
export interface StorageOptions<S> {
    readonly storage: 'localStorage' | 'sessionStorage' | StoragePort
    readonly key: string
    readonly hydration?: 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge'   // 預設 storageFirst
    readonly version?: number
    readonly migrate?: (persisted: unknown, oldVersion: number) => Partial<S>
    readonly crossTab?: boolean   // 預設 true
}

export function persist<S>(options: StorageOptions<S>): (bp: ContextBlueprint<S>) => ContextBlueprint<S>
```

```ts
const blueprint = pipe(
    createContext({ count: 0, theme: 'light' as 'light' | 'dark' }),
    persist({
        storage: 'localStorage',
        key: 'app:counter',
        hydration: 'storageFirst',
        version: 2,
        migrate: (persisted, oldVersion) => {
            if (oldVersion < 2) return { ...(persisted as object), theme: 'light' }
            return persisted as Partial<{ count: number, theme: 'light' | 'dark' }>
        }
    })
)
```

- `storage` 可為內建關鍵字或自訂 `StoragePort` 實例（使用者完全掌控 CRUD）。
- `'localStorage'` / `'sessionStorage'` 為預設 adapter，置於 `@sandlada/document-context/infrastructure/storage`，可 tree-shake；關鍵字由 **Application 的 storage registry** 解析（`createApplication` 裝配，見 [09-infrastructure.md](./09-infrastructure.md) §9.1）；未註冊的關鍵字 → `UNKNOWN_SERVICE`。
- 同一藍圖重複 `persist`：後者覆蓋前者。
- SSR / 無 `window` 環境：關鍵字 storage 退化為 null-storage（`unavailable`，靜默降級至藍圖種子，不推錯誤）。

## 6.3 水合優先級

| 策略 | 決策 |
| :--- | :--- |
| `storageFirst`（預設） | 儲存 > payload（SSR JSON） > 藍圖種子 |
| `payloadFirst` | payload > 儲存 > 藍圖種子 |
| `blueprintFirst` | 藍圖種子 > 儲存 > payload |
| `merge` | 依序淺層合併（藍圖 → 儲存 → payload） |

> 註：v0.0.1 的 `domFirst` 與早期草案的 `projectionFirst` 均廢止——投影為非目標（見 [08-projection.md](./08-projection.md)）；「以 payload 為先」的新名為 `payloadFirst`。

- 水合於 `mountSync`（同步可解析者）或 `mount`（需等待非同步儲存）時完成，結果寫回 `state$` 並推送給訂閱者。
- **`mountSync` 遇非同步儲存**（`read` 回傳 Promise）→ `ASYNC_SERVICE_NOT_READY`（改用 `mount`）。

## 6.4 版本與遷移

- **封裝格式**：`{ "v": number, "d": unknown }`（`d` 為 JSON 狀態快照）；未設 `version` 時 `v = 0`。
- 讀取比對：
    - `v === version` → 採用。
    - `v < version` → `migrate(persisted, oldVersion)` 轉換；失敗 → `INVALID_STORAGE_DATA` + 藍圖種子。
    - `v > version` → 資料來自較新版本：**不採用、不覆寫**，推 `INVALID_STORAGE_DATA`，以藍圖種子起步。
- 資料毀損（parse 失敗 / 形狀不符）→ `INVALID_STORAGE_DATA` + 藍圖種子（安全降級）。

## 6.5 跨標籤同步

`crossTab: true`（預設）時，`infrastructure/storage/sync.ts` 提供：

- 監聽 `storage` 事件（同源其他分頁的寫入）。
- 可選 `BroadcastChannel` 作為更即時通道。
- 可選 W3C Web Locks API 協調並發寫入（僅序列化寫入，不改變衝突結果）。

外部變更經 `StoragePort.observe$` 流入，觸發 `update`，**不** 回流自身寫入。

- **衝突策略：last-write-wins（LWW）**：外部變更以整快照替換本地狀態；不做 rebase / 合併（CRDT 需求請自訂 `StoragePort`）。
- **寫入節奏**：狀態變更後以微任務批次合併寫入；`dispose` 時對同步 adapter 立即 flush（保證最後一致性）；非同步 adapter 為 best-effort（文件明示）。
- **quota**：寫入失敗推 `errors$`（`quota`）；後續更新照常重試，不自動退避。

## 6.6 使用者自訂 adapter（BYO CRUD）

```ts
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

1. `StoragePort` 實作不拋例外，一律回傳 `StorageResult`。
2. 自身寫入不經 `observe$` 回流。
3. adapter 只處理 `string`；序列化與封裝（`{ v, d }`）在 application。
4. 毀損 / 遷移失敗 / 版本過新一律安全降級並回報 `errors$`；版本過新時不覆寫。
5. 寫入以微任務批次合併；`dispose` 時對同步 adapter 立即 flush。
6. 跨標籤外部變更採 LWW 整快照替換。
