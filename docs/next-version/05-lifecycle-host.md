# 05 — 生命週期與宿主綁定 (Lifecycle & Host)

本節描述四維生命週期的協調，以及以純函式重寫的宿主綁定模型 `attach`。

## 5.1 四維生命週期協調矩陣

| 外部事件 | ① 物理 DOM | ② Session 狀態機 | ③ 服務解析 | ④ 狀態 / 儲存 | 系統職責 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `mount` / `mountSync`(bp)(host) | Connected | Initializing → Mounted | 註冊 providers（lazy；eager 立即實例化） | 水合 + 訂閱就緒 | `mount`（非同步默認）於水合與 eager 完成後 resolve；`mountSync` 立即回傳；DOM 組合要求宿主已連線（`UNCONNECTED_NODE`） |
| `injectSync(token)`（同步投影・二等） | 無連接性門檻 | Mounted / Suspended | 實例化/快取 | 無 | 無連接性門檻；Mounted / Suspended 皆可；Disposed → `DISPOSED_SESSION`；僅限已取得的 Session；值未就緒即拋（見 03 §3.1.1） |
| `inject$` / `inject`（晚綁定） | 未連線則等待 | Mounted | 待 Provider 出現 → 解析 | 無 | pending registry；`context-mount` / 觀察者喚醒（09b）；`signal` 取消（先到者勝） |
| `mount` 等待期 abort | Connected | Initializing → Disposed | 銷毀已建立者 | 丟棄水合結果 | 以 `signal.reason` 拒絕；走 dispose 清理，無殘留；同 task 內 abort 檢查先於水合就緒交付（見 §5.7）；顯式 `dispose()` 於等待期可達，mount Promise 拒 `DISPOSED_SESSION` |
| `mount` 等待期斷開（非 abort） | Disconnected | keyed：Initializing → Suspended；匿名：Initializing → Disposed | keyed 保留；匿名 銷毀 | keyed 保留狀態；匿名 丟棄 | 不派發 `context-mount`、不執行 `onMount`（Initializing 源攜 `onMountSkipped`，首復甦遞延執行，見 §5.5）；keyed resolve 該 Session、匿名 reject `UNCONNECTED_NODE`（D-82）；窗口內 `mountSync` 拋 `ASYNC_SERVICE_NOT_READY`（`details.phase:'Initializing'`，可 `await` 續在途 `mount`） |
| `update(fn)` | 維持 | Mounted | 無 | 產生新快照 → 推送訂閱者 | 同步推送；儲存寫入批次見 06 §6.5 |
| host 短暫拖離 | Disconnected → (微任務重掛檢查) | Mounted 保持 | 保持 | 無（訂閱照常） | 微任務二次確認，防誤殺 |
| keyed host 置換 | Disconnected → 新 Connected | Suspended → Mounted（resuscitate 轉換；事件 resuscitated） | scoped 保持 | 狀態完整延續 | 同 token 復甦；沿用原藍圖，state 勝出 |
| keyed TTL 逾時 | Disconnected | Suspended → Disposed | 銷毀 scoped | store complete | 釋放資源、解除訂閱 |
| `dispose(session)` | 維持 | → Disposed | 銷毀 | store 毒化 | LIFO 清理、`abort$` 發射 |
| `adoptNode` | Adopted | Mounted 保持 | 保持 | 無 | 重綁觀察者與 registry 至新 Document |

### 5.1.1 生命週期鉤子全景（狀態 × 鉤子 × 事件）

同一張狀態機的三種標註：**觸發**（外部事實）→ **鉤子**（`on*` 運算子）→ **事件**（`lifecycle$` / 宿主 CustomEvent）。

**掛載字族迷你表**（後文一律全名；`connect` = `HostPort` 事件；`mounted` = Session `lifecycle$` 事件；`context-mount` = 宿主派發的 DOM CustomEvent，因果鏈見 §5.2）：

| 名稱 | 一句定義 |
| :--- | :--- |
| `mount` | 動詞，非同步預設；`mount(blueprint)(host)` 建立 Session 並於水合與 eager 完成後 resolve |
| `mountSync` | 同步二等；僅同步可解析者即時回傳，否則拋 `ASYNC_SERVICE_NOT_READY`（見 §5.7） |
| `onMount` | 鉤子，FIFO；回傳清理閉包，進入 LIFO 鏈 |
| `context-mount` | DOM CustomEvent；每次進入 `Mounted`（首掛與復甦）由宿主派發 |
| `connect` | `HostPort` 事件；宿主上線信號（轉發或觀察者偵測，見 §5.4） |
| `mounted` | Session `lifecycle$` 事件；進入 `Mounted` 的推送（序見 §5.2：① `onMount` FIFO → ② `context-mount` → ③ `lifecycle$ mounted`） |

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Blueprint: createContext / pipe（純資料；無鉤子）
    Blueprint --> Initializing: mount ／ mountSync 建立會話
    Initializing --> Mounted: 水合 + eager 完成｜① onMount FIFO → ② context-mount（宿主派發）→ ③ lifecycle$ mounted（推送）
    Initializing --> Disposed: 等待期 abort（signal.reason）／等待期斷開（匿名·reject UNCONNECTED_NODE）
    Initializing --> Suspended: 等待期斷開（keyed；不派發 context-mount；待復甦）
    Mounted --> Mounted: adoptNode｜onAdopt（owner）· lifecycle$ adopted
    Mounted --> Suspended: keyed host 斷開（微任務重掛檢查後）｜onSuspend · lifecycle$ suspended
    Suspended --> Mounted: TTL 內同 token 復甦（resuscitate 轉換；狀態續行）｜onResuscitate · lifecycle$ resuscitated（事件名）
    Suspended --> Disposed: TTL 逾時／dispose()
    Mounted --> Disposed: dispose()／匿名斷開／onConflict evict・reset
    Disposed --> [*]: onDispose（LIFO）· lifecycle$ disposed（宿主派發 context-dispose）

    note right of Mounted
        斷開後先經微任務重掛檢查；
        重掛視為未離開，未重掛才轉
        Suspended（keyed）或 Disposed（匿名）。
        adopt 不離開 Mounted，僅換 Document 註冊 + onAdopt。
    end note

    note left of Suspended
        Suspended 不執行 mount 清理；
        資源以 onSuspend 暫停、onResuscitate 重綁。
    end note
```

```mermaid
sequenceDiagram
    autonumber
    participant A as 宿主 A
    participant S as Session
    participant B as 宿主 B

    Note over A,S: Initializing — 無鉤子（水合 / eager 進行中；水合完成前不調任何 eager，完成後 eager 可讀寫已水合態）
    User->>S: mount(bp)(host) → 進入 Mounted
    S->>S: onMount[h1,h2,h3]（FIFO；回傳清理閉包）
    Note over A,S: ② 宿主派發 context-mount → ③ lifecycle$「mounted」推送（abort$ 例外即時先行）

    A->>S: host 斷開 → 微任務重掛檢查（未重掛）
    S->>S: onSuspend（暫停資源；不執行 mount 清理）
    Note over A,S: lifecycle$「suspended」

    B->>S: TTL 內同 token 復甦（Initializing 源先跑遞延 onMount，見 §5.5）
    S->>S: onResuscitate（宿主代理換向新節點）
    Note over B,S: 新宿主派發 context-mount → lifecycle$「resuscitated」推送

    Note over S: adoptNode 可隨時發生｜onAdopt（owner）· lifecycle$「adopted」

    B->>S: TTL 逾時 ／ dispose()
    S->>S: 清理閉包（LIFO）＋ onDispose（LIFO）
    Note over B,S: lifecycle$「disposed」· 宿主派發 context-dispose
```

- `resuscitate` 是**轉換動詞**（圖邊標），`resuscitated` 是 **`lifecycle$` 事件名**，`resuscitation` 是**過程義**（見術語表）——復甦後回到 `Mounted`，不是獨立停留狀態。
- `context-mount` 於每次**進入 `Mounted`**（首掛與復甦）派發；`context-dispose` 僅於最終 `Disposed` 派發一次。
- 匿名 Session 斷開直接 `Disposed`（不經 `Suspended`）；`Suspended` 不執行 mount 清理——資源以 `onSuspend` 暫停、`onResuscitate` 重綁；sync 投影（`selectSync` / `injectSync` / `update`）於 `Suspended` 照常可用（見 §5.5）。
- 等待期斷開（D-82）：不派發 `context-mount`、不執行 `onMount` / `onSuspend`；keyed → `Suspended`（Promise resolve，Initializing 源攜 `onMountSkipped` 標，首復甦先跑遞延 `onMount`，見 §5.5）、匿名 → `Disposed`（Promise 拒絕 `UNCONNECTED_NODE`）。
- 鉤子順序為規範：單一編號鏈四處同文——① `onMount` FIFO → ② `context-mount`（宿主派發）→ ③ `lifecycle$ mounted`（推送）；`abort$` 例外即時先行；正向（`onMount` / `onSuspend` / `onResuscitate` / `onAdopt`）FIFO；清理閉包（LIFO）先於 `onDispose`（LIFO）（見 §5.2、§5.7）。
- 終結媒介：`dispose()` ≡ `Session[Symbol.dispose]`；`await using` 以 `Symbol.asyncDispose` 等待結算（見 [03-application-api.md](./03-application-api.md) §3.3）。

## 5.2 生命週期鉤子運算子

```ts
import { onAdopt, onDispose, onMount, onResuscitate, onSuspend, selectSync } from '@sandlada/document-context'

onMount((session) => {
    const host = session.host.native() as HTMLElement
    const chart = new ECharts(host)
    const id = setInterval(() => chart.update(selectSync((s: { data: unknown }) => s.data)(session)), 1000)
    return () => {
        clearInterval(id)
        chart.dispose()
    }
})

onDispose((session) => analytics.track('unmounted', { token: session.token }))
onSuspend((session) => pauseAnimation())
onResuscitate((session, host) => resumeAnimation(host))
onAdopt((session, owner) => console.log('adopted by', owner))
```

- **執行順序**：單一編號鏈——① `onMount` FIFO → ② `context-mount`（宿主派發）→ ③ `lifecycle$「mounted」`（推送）；其餘狀態同構；`abort$` 例外即時先行。清理閉包與 `onDispose` 各自 LIFO，**先清理閉包、後 `onDispose`**。
- **Suspended 不執行 mount 清理**：資源以 `onSuspend` 暫停、`onResuscitate` 重綁；mount 清理只在最終銷毀時執行。
- **錯誤沙箱**：除 `onMount` 外永不中斷——每個鉤子與清理閉包獨立 `try...catch`，例外送 `errors$` 且不中斷其餘流程。`onMount` 失敗即 mount 失敗：FIFO 任一拋錯或 reject → mount Promise 拒絕並同步推一條 `HOOK_ERROR` 供觀測；走 dispose 清理；不派發 `context-mount`，不推送 `mounted`；先跑者的清理閉包經 dispose 執行。

**鉤子總覽**（五個 Session 鉤子 + 三個宿主轉發鉤子；事件欄對應 `LifecycleEvent` / `HostLifecycleEvent` union，見 [02-domain-model.md](./02-domain-model.md)）：

| 鉤子 | 觸發時機 | 簽名 | 順序 | 對應事件 | 備註 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `onMount(handler)` | 進入 `Mounted`（水合 + eager 完成） | `(session) => void \| (() => void)` | FIFO | `lifecycle$: mounted`；`context-mount` | 回傳清理閉包（進入 LIFO 鏈）；SSR 不執行（D-49） |
| `onSuspend(handler)` | keyed `Mounted → Suspended` | `(session) => void` | FIFO | `lifecycle$: suspended` | 只暫停、不清理；mount 清理延後至最終銷毀 |
| `onResuscitate(handler)` | `Suspended → Mounted`（TTL 內同 token 新宿主） | `(session, host: HostPort) => void` | FIFO | 新宿主 `context-mount`；`lifecycle$: resuscitated` | 狀態完整延續；原生引用重讀（§5.5）；Initializing 源首復甦先跑遞延 `onMount` |
| `onAdopt(handler)` | `adoptNode`（Session 保持 `Mounted`） | `(session, owner: unknown) => void` | FIFO | `lifecycle$: adopted` | 觀察者 / registry 遷移；跨 Document 復甦不支援 |
| `onDispose(handler)` | 最終 `Disposed` | `(session) => void \| Promise<void>` | LIFO | `lifecycle$: disposed`（串流完結）；`context-dispose` | 同步階段執行；非同步 fire-and-forget；`await using` 等待結算（D-09） |
| `attach({ onConnect })` | 宿主 `connectedCallback` 轉發（或觀察者偵測） | `() => void` | 冪等收斂 | `HostLifecycleEvent: connect` | 純函式；雙通道後到者 no-op（§5.4） |
| `attach({ onDisconnect })` | 宿主 `disconnectedCallback` 轉發 | `() => void` | 冪等收斂 | `HostLifecycleEvent: disconnect` | 微任務重掛檢查先於任何銷毀（§5.7 #3） |
| `attach({ onAdopt })` | 宿主 `adoptedCallback` 轉發 | `(owner: unknown) => void` | 冪等收斂 | `HostLifecycleEvent: adopt` | 宿主轉發層；Session 語意層為 `onAdopt` |

## 5.3 原生標準媒介

`Session` 自帶 `abort$`（以及對應的底層 `abortSignal`）。任何非同步任務只需以 `takeUntil(session.abort$)` 或傳遞 `AbortSignal` 即可獲得自動取消。

```ts
import { defineToken, provide } from '@sandlada/document-context'

const userToken = defineToken<string>('app:user')

provide(userToken, async (session) => {
    const response = await fetch('/api/user', { signal: session.abortSignal })
    return response.json()
})
```

## 5.4 宿主綁定 `attach`（參考 Lit 生命週期回調設計）

> **重要**：本庫 **不引入 LitJS 依賴**，也 **不引入 `ReactiveController` 這個詞**。我們僅 **參考** Lit 組件的生命週期回調設計（connect / disconnect / adopt 三段式），並以 **純函式** 形式提供。

Lit 的 `ReactiveController` 提供 `hostConnected` / `hostDisconnected` 等回調；本庫以回傳鉤子物件的高階函式對應之：

```ts
import { attach } from '@sandlada/document-context'

// 回傳的鉤子由宿主在自身的 connectedCallback / disconnectedCallback / adoptedCallback 中轉發
const hooks = attach({
    onConnect: () => console.log('host connected'),
    onDisconnect: () => console.log('host disconnected'),
    onAdopt: (owner) => console.log('host adopted', owner)
})(session)

// 宿主（例如 Custom Element）：
class MyElement extends HTMLElement {
    connectedCallback() { hooks.connect() }
    disconnectedCallback() { hooks.disconnect() }
    adoptedCallback(_old, _new, owner) { hooks.adopt(owner) }
}
```

設計要點：

- **純函式、無 class、無 `this`**：`attach(config)(session)` 回傳 `{ connect, disconnect, adopt }`。
- **宿主主導**：核心不插入任何全域 `MutationObserver`；預設 DOM 組合根啟用一個集中觀察者（見 [09-infrastructure.md](./09-infrastructure.md)）。由宿主明確轉發亦可。
- **通道優先級**：預設 DOM root 啟用集中觀察者；宿主 `attach` 轉發為可選增強，早信號同遷移；雙通道按 §5.7 #4 後驗冪等收斂。非 DOM 自組裝下轉發是唯一通道，見 §5.6。
- **可選的生命週期回調**：`onConnect` / `onDisconnect` / `onAdopt` 皆為可選。
- **與中央觀察者並存**：宿主轉發與觀察者偵測是同一事實的兩條通道；鉤子冪等收斂（後到者 no-op），跨通道順序不保證（狀態轉換本身冪等）。

## 5.5 Keyed Session 與復甦

- **身分來源與正規化**：`mount(bp, { token })` > 宿主 `data-context-key`；兩者並存且字串不等 → `KEYED_SESSION_CONFLICT`。token 以與 `defineToken` 共用的驗證器檢查（違規 `TOKEN_INVALID`；keyed 身分強制為可序列化公開 token）。`mount` 與 `mountSync` 適用同一組 keyed / TTL / 復甦 / `onConflict` 規則。
- **屬性維護**：keyed mount 會將 token 補寫入宿主 `data-context-key`；`Suspended` 期間保留；最終 `Disposed` 時，若屬性值等於會話 token 則移除（避免殘留身分宣稱）。自致回寫或移除被集中觀察者過濾（不喚醒）；外部寫入的 key 變更入列重估（見 [09-infrastructure.md](./09-infrastructure.md) §9.4 與 [09b-late-binding.md](./09b-late-binding.md) §9b.4）。
- **幂等**：同宿主同 token 重複 `mount` 回傳快取 Session；**藍圖以首次掛載為準**（除非其 host 已 observed-disconnect 待 re-check，此時走復甦，見下）。同 host 加同 token 的 in-flight 第二 `mount` 併入首個 in-flight（一次水合、一次 eager、一 session，見 03 §3.3）。匿名 Session 無跨宿主復甦；同宿主重複掛載同樣回傳快取。
- **身分衝突**（依 `onConflict`，預設 `throw`；`onConflict` 僅同 host swap 與 `options.token` 對 `data-context-key` 矛盾；跨 host 真雙活一律拋錯）：

| 情境 | 處理 |
| :--- | :--- |
| 同宿主已有 token A，再次掛載 token B | `throw` → `KEYED_SESSION_CONFLICT`；`evict` → 處置舊 Session 後掛載新者（直接 `dispose`；不經 `Suspended`、不執行 `onSuspend`）；`reset` → 舊 Session 銷毀，其**當前狀態**替代新 Session 的「藍圖種子」槽位（其餘水合順序不變，供 HMR；需保熱態請用 `blueprintFirst`，見下） |
| 同 token 同時活躍於兩個已連線宿主（真雙活） | 一律 `KEYED_SESSION_CONFLICT`，無視 `onConflict`；併發雙 `Initializing` 首達 `Mounted` 勝、敗方拒 `KEYED_SESSION_CONFLICT` |
| 同 token、不同宿主、原 Session 仍在 `Suspended` TTL 內 | 復甦（見下） |
| 同 token、原 Session 已 observed-disconnect 待微任務 re-check（Suspended-in-waiting） | 視同 `Suspended`，走復甦（D-15 state-wins），非衝突 |

- **evict 對 suspend 優先序**：跨 host 乘 `Suspended` 乘 `evict` / `reset` → 復甦勝；同 host swap 乘 `evict` → 處置舊者後掛載新者；跨 host 乘真雙活乘 `evict` → 處置舊者後掛載新者；`reset` 跨 host 乘 `Suspended` → 復甦（事件以 resuscitate 為勝，種子語義等價）。
- **遞延 `onMount`**：`Initializing` 源 `Suspended` 攜 `onMountSkipped` 標；首復甦按「遞延 `onMount` FIFO → 註冊清理閉包 → `onResuscitate` → `context-mount` → `lifecycle$ resuscitated`（`details.setup:'deferred-mount'`）」執行；之後與常態 `Mounted` 無異。
- **復甦**（`resuscitate` 轉換；`resuscitated` 事件；`resuscitation` 過程）：沿用原 Session 的藍圖與身分；狀態完整延續（state 勝出，不重跑水合）。使用者自建的 DOM 綁定請於 `onResuscitate` 後重讀 `native()` 並重綁（見 [08-projection.md](./08-projection.md)）。`suspensionTtlMs` 預設 50；`0` = 不進 Suspended 立即銷毀；`Infinity` 僅當 `retention:'pinned'` 並存時生效（見下）。
- **留存槽**：`Suspended` 條目由 Application 擁有的 per-Document Suspended 表持強引用槽 `{ ref, weak }`；釋放點三者其一：復甦、處置、TTL 到期。留存與排程器脫鉤。
- **原生引用弱化**：`Suspended` 進入時 facade 強原生降為 `WeakRef`，復甦時重取新宿主；`Suspended` 期間 `native()` 取 deref-or-throw：deref 命中返舊（detached）節點並標註，deref 失配拋指定碼（碼號由 02 §2.7 稅制定案）。
- **留存上限**：`maxSuspendedPerDocument` 預設 100；溢出受害規則 oldest-first，`Suspended → Disposed` 走完整處置路（`onDispose` LIFO 加 `lifecycle$ disposed`）；可觀測通道為 `lifecycle$ disposed` 且 `details.evicted:'suspended-cap'`，`errors$` 不另推；被逐出 token 的復甦變全新掛載。
- **`Infinity` 門**：`suspensionTtlMs: Infinity` 僅當 `retention:'pinned'` 明式 opt-in 並存時生效；擁有者為 mounter；Application teardown 全清 pinned 條目；裸 `Infinity` 無標即拋配置錯（碼歸 02 §2.7 稅制）。
- **reset-seed 與三者正交**：復甦走不重跑水合；`reset` 走 seed-substitute 跑水合（舊態替代「藍圖種子」槽位，其餘策略順序不變）；全新掛載種子為藍圖 initial；三者觸發條件互斥（復甦：同 token 加 TTL 內加不同宿主；`reset`：同宿主衝突加 `onConflict:'reset'`）。`reset` 首次 write-back 與正常掛載一致（微任務批次，`v` 沿舊態版本）。
- **registry**：身分存活於 per-Document registry（`WeakMap<Document, Map<string, WeakRef<Session>>>`），`FinalizationRegistry` 作兜底；`adoptNode` 時 Session 與其 registry 條目遷移至新 Document；跨 Document 復甦不支援（請重新掛載）。
- **TTL 計時**：背景分頁的計時器可能被瀏覽器節流，TTL 只保證「不早於」設定時間觸發。
- **Suspended 期服務面規則**（規範，單一來源為 02 §2.5.1，本節鏡像）：`Suspended` 期服務面全活（scoped 緩存留、transient 可調、lazy 可首建、`state$` / `subscribe$` / `errors$` / storage 照常演進）；僅 element-target 解析路徑盲（無新命中；`session$` 吐 null，見 §5.8）。註一：`Suspended` 期首建的 lazy 或 transient 工廠勿 capture `native()`（detached，見留存弱化段）。註二：`subscribe$` 回調 `Suspended` 期照推，背壓與可見性歸呼叫者（見 [08-projection.md](./08-projection.md) recipes）。

## 5.6 不使用集中觀察者時的行為

若宿主未轉發生命週期、且未啟用 `infrastructure/dom` 的集中觀察者（`createApplication({ host })` 應用級 `observer?: 'auto' | 'off'` 預設 `'auto'`；`MountOptions.observer?: boolean` 逐 mount 覆寫（預設繼承），mount 贏）：

- 匿名 Session 不會自動隨節點脫離而銷毀，需顯式 `dispose(session)` 或以 `using` / `await using`（TC39 Explicit Resource Management）管理。
- 啟用集中觀察者（預設於 DOM 組合根）可獲得自動 GC 與復甦。
- 非 DOM 自組裝下轉發是唯一通道（見 §5.4 通道優先級）。

## 5.7 不變式

1. 單一編號鏈：① `onMount` FIFO → ② `context-mount`（宿主派發）→ ③ `lifecycle$ mounted`（推送）；正向生命週期鉤子（`onMount` / `onSuspend` / `onResuscitate` / `onAdopt`）FIFO；清理閉包（LIFO）先於 `onDispose`（LIFO）。
2. 鉤子例外隔離：除 `onMount` 失敗即 mount 失敗外，絕不中斷銷毀流程。
3. 微任務重掛檢查先於任何 keyed Session 銷毀；observed-disconnect 待 re-check 者視同 Suspended-in-waiting（見 §5.5）。
4. `attach` 回傳的鉤子可安全重複呼叫（冪等）；雙通道並存時後到者為 no-op。
5. 復甦以「狀態完整延續（state 勝出）」，不重跑水合；沿用原 Session 原藍圖。
6. 藍圖以首次掛載為準；身分衝突依 `onConflict`（跨 host 真雙活一律 `KEYED_SESSION_CONFLICT`）。
7. 等待期斷開（D-82）：keyed → `Suspended`、匿名 → `Disposed`；兩者皆不派發 `context-mount`、不執行 `onMount`（keyed 攜遞延標，見 §5.5）。
8. `mount` 機械交付就緒的同一 task 內，先同步查 `signal.aborted`；已 abort 即走 abort 路，即使水合同 task 完成。`mountSync` 加 `signal` 明式 dev-warn 後忽略前行，不靜默。
9. pending 按 target 切分：`context-dispose` 對 element-target pending 非喚醒；Session-target 等待經 `abort$` 鏈結隨目標死亡結算 `DISPOSED_SESSION`（首勝單結算；同 batch 死亡檢查先於命中投遞，全域一致）。facade 穩定不等於存活，勿輪詢 facade 或 `isConnected` 判定死亡。

## 5.8 `session$` 追蹤訂閱（非 pending 條目）

`session$` 是 hot 永不完成的連續追蹤器，不是 token 索引的 resolve-once 條目，不佔 `maxPendingPerDocument`：

- 以 host 索引：訂閱 mount 與 dispose 事件加祖先觀察者，目標死亡不斷 registry 條目而斷追蹤。
- 可見性：`Mounted` 加已連線才發射；`Suspended` 發射 null；復甦重發同一對象（見 03 §3.3.1；可見性規範以 02 §2.5.1 為準，本節鏡像）。
