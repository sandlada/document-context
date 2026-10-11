# 09 — 基礎設施 (Infrastructure / Adapters)

`infrastructure` 的唯一職責是 **實作 domain 定義的被驅動埠**。它包含三個子領域：`dom`、`storage`、`ssr`。

## 9.1 組合根與裝配

`application` 不得 import `infrastructure`；預設 DOM adapter 的裝配發生於套件根入口（composition root）：

```ts
// src/index.ts
import { createApplication } from './application/index'
import { createDomAdapter } from './infrastructure/dom/index'
import { createStorageAdapters } from './infrastructure/storage/index'
import { createSsrAdapter } from './infrastructure/ssr/index'

export const app = createApplication({
    host: createDomAdapter(),
    storage: createStorageAdapters(),   // { localStorage, sessionStorage } registry（關鍵字解析）
    ssr: createSsrAdapter()             // { nullHost, payloadResolver, serialize }
})

export const {
    createContext, pipe, provide, provideSync,
    onMount, onDispose, onSuspend, onResuscitate, onAdopt,
    persist, attach,
    mount, mountSync, getSessionSync, session$, selectSync, select$, update, subscribe$,
    inject, injectSync, inject$, injectAll, injectAllSync, injectAll$, dispose
} = app

export { createApplication }
```

- 使用者 `import { mount } from '@sandlada/document-context'` 取得 **已裝配 DOM adapter** 的版本，零設定。
- 進階使用者可自訂 adapter 以 `createApplication({ host, storage, ssr })` 重新裝配。
- `createApplication` 亦於根入口 re-export；SSR 以自訂 ports **每請求**呼叫（見 §9.1.1）。
- `mount` / `mountSync` 只調注入的 `host.toHost(node)` 委派宿主解析；application 層不做任何 `HTMLElement` 嗅探（嗅探 helper 歸 `infrastructure/dom` 內部；見 §9.2）。
- **根入口單例僅供瀏覽器**；SSR 必須 **每請求** `createApplication`（per-request 隔離，見 [02b-tokens.md](./02b-tokens.md) §2b.7）。
- storage 關鍵字（`'localStorage'` / `'sessionStorage'`）由 `storage` registry 解析；未註冊關鍵字 → `UNKNOWN_SERVICE`。

### 9.1.1 裝配契約（ApplicationPorts）

```ts
// domain/ports/*（埠合約之家；application 僅 type-only 重出口）
export interface HostAdapter {
    toHost(node: unknown): HostPort                    // DOM adapter：node 為 Element（含 SVG）；非法輸入拋 HOST_INVALID（見 §9.2）
    readonly scheduler: SchedulerPort
    readonly scopeTransport: ScopeTransportPort
    // 註：集中觀察者（§9.4）為 host adapter 的內部實作——DOM adapter 預設啟用；
    //     非 DOM host 可缺省（匿名會話不自動銷毀，見 05 §5.6）。
}

export interface StorageRegistry {
    resolve(keyword: string): StoragePort | null       // null → 掛載時 UNKNOWN_SERVICE
    // 惰性 per-keyword 實例化：註冊不把未註冊 keyword 的 adapter 拉進 bundle（tree-shake 衛生，見 14 §14.5）。
}

export type PayloadResolver = (token: string | null) => unknown | null   // 一次性讀取；失敗回 null

export interface SerializeOptions<S> {
    readonly select?: (state: S) => unknown             // 預設：整狀態
}

export interface SsrAdapter {
    readonly nullHost: HostPort
    readonly payloadResolver: PayloadResolver | null
    readonly serialize: <S>(options?: SerializeOptions<S>) => (session: Session<S>) => string
}

export interface ApplicationPorts {
    readonly host: HostAdapter
    readonly storage: StorageRegistry
    readonly ssr?: SsrAdapter
    readonly observer?: 'auto' | 'off'                 // 應用級觀察者策略，預設 'auto'；逐 mount 以 MountOptions.observer?: boolean 覆寫（預設繼承），mount 贏（見 05 §5.6）
}

export function createApplication(ports: ApplicationPorts): Application

// Application：已裝配的公共 API 物件。
// 成員＝03 §3.1 命名總表的全部 API（運算子 + 動詞 + `attach` + `serialize`）；
// 型別聚合於 `application/index.ts` 匯出。
export interface Application { /* 見 03 §3.1 */ }
```

- 埠合約之家為 `domain/ports`（骨架承諾見 [01-architecture.md](./01-architecture.md) §1.3 / §1.5）；`application` 僅作 type-only 重出口。

## 9.2 DOM host adapter

`HostPort<HTMLElement>` 的實作：

| 埠成員 | DOM 實作 |
| :--- | :--- |
| `token` | 由 `mount` 選項或 `data-context-key` 屬性正規化（寫回與移除見 [05-lifecycle-host.md](./05-lifecycle-host.md) §5.5） |
| `isConnected` | `node.isConnected` |
| `parent` | `node.parentElement` 或 `ShadowRoot.host`（穿透 Shadow DOM） |
| `lifecycle$` | 集中觀察者 + 規範性 CustomEvent（`context-mount` / `context-dispose`；見 [09b-late-binding.md](./09b-late-binding.md) §9b.5） |
| `on(type, fn, options?)` | `addEventListener`（支援 `capture` / `passive` / `once` / `signal`；回傳解除函式） |
| `native()` | 回傳底層 `HTMLElement` |

- 接受廣義 `Element`（含 SVG / MathML）；`toHost` 對非宿主輸入（`Text` 節點、無 `nodeType` / `ownerDocument` 的 plain object 等）拋新碼 `HOST_INVALID`（致命；碼表見 [02-domain-model.md](./02-domain-model.md) §2.7）。宿主判定一律 duck-typing（`nodeType` / `ownerDocument` / `isConnected`），全 corpus 禁 `instanceof` 作宿主判定。
- 跨 realm 誤判禁令同上：adapter 內部嗅探亦不得用 `instanceof HTMLElement`；以 duck-typing 實作。

## 9.3 作用域傳輸：W3C Context Protocol

`ScopeTransportPort` 以 **W3C Web Components Community Group Context Protocol** 實作：

- 消費者（子節點）派發 `context-request` CustomEvent（`bubbles: true, composed: true, cancelable: true`）。
- Provider（掛載宿主）監聽並以閉包 `callback(value, unsubscribe)` 回應，回應後 `stopPropagation()`（`multi: true` 除外——multi provider **不得** 中止傳播，以收集全部回應）。
- 閉包直接持有消費端，**不讀取 `event.target`**，因此對 **Closed Shadow DOM** 100% 安全（不受 retargeting 影響）。
- **P1 保留**：`subscribe: true`（長期值串流）為協議擴充欄位——v0.1.0 無公共 API 消費（`inject$` 為 resolve-once，不依賴長期訂閱）；提供側一律一次性回應並忽略該旗標，不維護長期訂閱（外部消費者帶 `subscribe: true` 亦同，見 D-115）。
- **晚綁定**：未命中的元素目標請求進入 pending registry，由 `context-mount` 與集中觀察者喚醒重試（規範見 [09b-late-binding.md](./09b-late-binding.md)）。`inject$` / `injectAll$` 為 resolve-once（單值首次發射 / 多值首次非空後 `complete()`；空數組永不結案，見 [09b-late-binding.md](./09b-late-binding.md) §9b.2），不依賴長期訂閱。

```ts
export const CONTEXT_REQUEST_EVENT = 'context-request'

export interface ContextRequestDetail<T = unknown> {
    readonly token: Token
    readonly callback: (value: T, unsubscribe?: () => void) => void
    readonly subscribe?: boolean  // P1 保留；v0.1.0 僅容忍不消費，外部 subscribe:true → 一次性回應（D-86、D-115）
    readonly multi?: boolean
}
```

- `detail.token` 持 token 者名 token（本庫 detail 非 W3C 線上格式，改名不破線上傳輸；手造 detail 的極少數互操作代碼需改，經 `inject$` 的消費者無感）。
- 路由快取：消費者 Session 以 `WeakRef` 快取最近命中的 Provider；喚醒批次開始前，凡祖先鏈受本次喚醒影響的快取條目即失效（集中觀察者偵測 `childList` / 連線變化時亦立即失效）；命中時更新為最新 Provider。

## 9.4 集中式 MutationObserver

`infrastructure/dom/observer.ts` 提供 per-Document 的集中觀察者：

- **單一** `MutationObserver` 監看 `document`，避免每個 Session 各自觀察。
- 節點以 `WeakMap` / `WeakRef` 追蹤，**零強引用洩漏**。
- `FinalizationRegistry` 作 GC 兜底清理（永不作主機制；主機制為批次剪除，見 [09b-late-binding.md](./09b-late-binding.md) §9b.3）。
- 節點脫離時經 `SchedulerPort.microtask` 二次確認（DOM adapter 預設即 `queueMicrotask`；防拖拽/重排誤殺）。
- `adoptNode`（`adoptedCallback`）時重綁觀察者與 registry 至新 Document。
- HTMX / Turbo 片段置換：經 keyed 復甦無縫延續。
- **兼任晚綁定喚醒來源**：結構變更（`childList`）與連線狀態變化觸發 pending registry 重試（見 [09b-late-binding.md](./09b-late-binding.md) §9b.4）；每次回調搭便車跑 prune（deref 掃），即使不觸發喚醒亦然。
- `data-context-key` 自致回寫 / 移除被過濾（不喚醒）；外部 key 變更入列重估（喚醒表見 [09b-late-binding.md](./09b-late-binding.md) §9b.4；自/外因判定器須測試：自寫不喚醒、外寫喚醒）。
- 與 `attach` 雙通道並存時冪等收斂（見 [05-lifecycle-host.md](./05-lifecycle-host.md) §5.4）。

## 9.5 Scheduler adapter

```ts
// DOM-only — browser adapter default.
// SSR / 測試請注入假排程器（見 04 §4.5 / 10 §10.4）；本配方定義 DOM 預設實現。
export function createSchedulerAdapter(): SchedulerPort {
    return {
        microtask: (task) => queueMicrotask(task),
        timeout: (task, ms) => {
            const id = setTimeout(task, ms)
            return () => clearTimeout(id)
        },
        frame: (task) => {
            const id = requestAnimationFrame(() => task())
            return () => cancelAnimationFrame(id)
        }
    }
}
```

SSR / 測試以假排程器替換，使行為確定化（假排程器 5 行片段見 [04-reactivity-rxjs.md](./04-reactivity-rxjs.md) §4.5 / [10-testing.md](./10-testing.md) §10.4）。

## 9.6 Storage adapters

- `local-storage.ts` / `session-storage.ts`：包裝 Web Storage API 為 `StoragePort`，錯誤轉為 `StorageResult`。
- `sync.ts`：`storage` 事件 + 可選 `BroadcastChannel` + 可選 Web Locks，實作 `observe$`（僅外部變更；LWW 套用）。
- `crossTab` 於 SSR / 無 `window` 環境強制關閉；關鍵字 storage 退化為 null-storage（靜默）。
- 全部可 tree-shake；未使用跨標籤同步的應用不會打包相關程式碼。

## 9.7 SSR adapter

- `null-host.ts`：無連線、無事件、無觀察者的 `HostPort` stub（供 server 端以相同 API 掛載；無 DOM 投影——非目標，見 [08-projection.md](./08-projection.md)）。
- `payload-resolver.ts`：由 `script[type="application/json"]`（id = `__dc_state:<token>` / `__dc_state`）讀取 payload；一次性讀取、無長駐訂閱（`PayloadResolver = (token) => unknown | null`，見 §9.1.1）。
- 以假排程器運行，不建立長駐訂閱、不執行 `onMount`。
- **無元素目標晚綁定**：server 端不派發 `context-mount`、不設元素 pending registry（見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.7）；Session-target server 等待僅限訂閱時已 InFlight 的同 session 項，真缺席在 ssr adapter 下 fast-reject `UNKNOWN_SERVICE`（in-flight 邊界定義見 [03-application-api.md](./03-application-api.md) §3.3.1，與 [09b-late-binding.md](./09b-late-binding.md) §9b.2 / §9b.8 同字）。
- Server 單例按請求隔離：per-request Application 擁有 `Map<token-string, 單例>` + keyed 表（「Document 鍵」換成 Application 實例本身；單例按 Application 實例，永不跨請求共享）。未釋放請求走顯式 dispose 合約 + 安全掃蕩兜底（觸發器見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.2），並以 node 洩漏測試守衛。
- 標準 server 片段（`nullHost → await mount → await inject → serialize` 定名定路，過 `tsc --strict`）見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.7；本節與該片段互鏈。
- `serialize.ts`：`serialize(options?: SerializeOptions<S>)(session)`——`select` 取子集（預設全量）；輸出 JSON payload（完成 `<`／`>`／`&`／U+2028／U+2029 逃逸）。

## 9.8 不變式

1. Adapters 在 runtime 只依賴 `domain/ports` 契約（`import type` 引用 application 型別是允許的，以 lint + node load test 守衛；見 [01-architecture.md](./01-architecture.md) §1.2），不反向依賴 application 內部。
2. 集中觀察者採 WeakMap/WeakRef，零強引用洩漏。
3. 單一 per-Document `MutationObserver`。
4. W3C Context Protocol 不讀 `event.target`，Closed Shadow DOM 安全；multi provider 不中止傳播。
5. 所有 adapter 皆可被 fake 替換以進行確定性測試。
6. 根入口單例不得用於 SSR；server 每請求重新裝配。
7. 晚綁定 pending registry 為 per-Document、WeakRef 追蹤、微任務批次；`context-mount` / `context-dispose` 為規範性公共契約（cross-bundle 喚醒媒介）；取消（`signal`）與逾時即時移除條目，不殘留計時器與監聽；多通道競爭（unsubscribe / `signal` / `timeoutMs` / 目標死亡）先到者勝（見 02 §2.8 #13）。
