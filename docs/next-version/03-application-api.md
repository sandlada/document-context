# 03 — 公共 API (Application API)

所有公共 API 皆為 **函式優先、data-last、柯里化**。運算子（`provide*`、`onXxx`、`persist`）作用於藍圖；動詞（`mount`、`inject` / `inject$`、`session$`、`update`、`dispose`…）作用於 Session 或宿主。

本套件的設計身份是 **異步流（async-first）**：解析經晚綁定流 / Promise（缺席 = pending；見 [09b-late-binding.md](./09b-late-binding.md)）；同步動詞僅為熱快照投影，身分為**二等**（見 §3.1.1）——不列入穩定契約，可於任何 minor 移除。命名公約：異步一等無 `Async` 後缀；同步二等帶 `Sync` 後缀（見 [13-decisions.md](./13-decisions.md) §13.13）。DOM 投影與雙向綁定為非目標（見 [08-projection.md](./08-projection.md)）。

> 服務型別的事實來源是 `ServiceToken<T>` / `ServiceRegistry`（見 [02b-tokens.md](./02b-tokens.md)）；本版不做跨運算子服務型別累積推導。決策見 [13-decisions.md](./13-decisions.md)。

## 3.1 命名總表

| 概念 | API | 等級 | 簽名風格 |
| :--- | :--- | :--- | :--- |
| 藍圖種子 | `createContext` | 一等 | `createContext(initial) → Blueprint` |
| 組合 | `pipe` | 一等 | `pipe(bp, ...operators) → Blueprint`（保持 `S`） |
| Token 定義 | `defineToken` / `definePrivateToken` | 一等 | `defineToken<T>(name) → ServiceToken<T>` |
| 提供者（非同步工廠・默認） | `provide` | 一等 | `provide(token, asyncFactory, opts?)(bp) → bp` |
| 提供者（同步工廠） | `provideSync` | 二等 | `provideSync(token, factory, opts?)(bp) → bp` |
| 生命週期鉤子 | `onMount` / `onDispose` / `onSuspend` / `onResuscitate` / `onAdopt` | 一等 | `onMount(fn)(bp) → bp` |
| 儲存 | `persist` | 一等 | `persist(options)(bp) → bp` |
| 掛載（非同步・默認） | `mount` | 一等 | `mount(bp, opts?)(element) → Promise<Session>` |
| 掛載（同步投影） | `mountSync` | 二等 | `mountSync(bp, opts?)(element) → Session` |
| 注入（晚綁定） | `inject$` / `injectAll$` / `inject` / `injectAll` | 一等 | `inject$(token, opts)(target) → Observable<T>`／`inject(token, opts)(target) → Promise<T>` |
| 注入（同步投影） | `injectSync` / `injectAllSync` | 二等 | `injectSync(token)(session) → T`（僅 Session） |
| Session 追蹤 | `session$` | 一等 | `session$(element, opts?) → Observable<Session \| null>` |
| Session 追蹤（同步） | `getSessionSync` | 二等 | `getSessionSync(element) → Session \| null` |
| 串流讀取 | `select$` | 一等 | `select$(selector)(session) → Observable<R>` |
| 快照讀取 | `selectSync` | 二等 | `selectSync(selector)(session) → R` |
| 更新 | `update` | 一等 | `update(updater)(session) → boolean` |
| 訂閱 | `subscribe$` | 一等 | `subscribe$(listener)(session) → Subscription` |
| 銷毀 | `dispose` | 一等 | `dispose(session) → void` |
| 宿主綁定 | `attach` | 一等 | `attach(config?)(session) → HostHooks` |
| 錯誤流 | `session.errors$` | 一等 | `Observable<DocumentContextError>` |

### 3.1.1 API 梯隊（Stability Tiers）

**一等（穩定契約）**：藍圖運算子（含非同步工廠 `provide`）、`mount`（非同步默認）、異步解析家族（`inject$` / `injectAll$` / `inject` / `injectAll` / `session$`）、流家族（`select$` / `subscribe$` / `state$` / `errors$` / `lifecycle$` / `abort$`）、命令（`update` / `dispose`）、`attach`——語意化版本；變更提供遷移說明。

**二等（同步投影）**：凡帶 `Sync` 後缀者——`provideSync` / `mountSync` / `injectSync` / `injectAllSync` / `selectSync` / `getSessionSync`；**不列入穩定契約，可於任何 minor 移除或改語意（CHANGELOG 標註即為充分告知）、不提供遷移承諾**；新程式碼一律導向異步對應（`inject` / `inject$` / `mount`…）。判定規則：**帶 `Sync` 後缀即二等（機械可辨）**；命令與建構子（`update` / `dispose` / `createContext` / `pipe`）不帶後缀、屬一等。

- **同步投影語意**：同步讀在值已就緒時等於最新投影；未就緒時拋（`ASYNC_SERVICE_NOT_READY` 等），**不等待**——等待一律走流 / Promise。
- **核心不依賴**：domain / application 內部不得以同步動詞實現功能；移除同步面不得改變核心行為（驗證見 [10-testing.md](./10-testing.md) §10.5 的 parity 測試與移除演練）。
- **移除前評估**：任何二等 API 的實際移除，需先確立渲染（SSR）與同步工廠（改以 `provide` 宣告）等場景的替代路徑；先標記、後移除（D-71）。
- 接近移除時再掛 `@deprecated` 標記；現階段以梯隊政策與文檔標註管理，避免 IDE 噪音。

```ts
// 一等：元素目標（順序無關、可取消）
const user$ = inject$('user')(el)
const session = await mount(blueprint)(el)

// 二等：僅當已持有 Session 且值已就緒（同步工廠內、mountSync / mount 後）
const user = injectSync('user')(session)
```

## 3.2 藍圖運算子

```ts
// 1. 藍圖種子
export function createContext<S extends Record<PropertyKey, unknown>>(
    initial: S
): ContextBlueprint<S>

// 2. 組合：保持（累加器的）S；服務型別由 ServiceRegistry / ServiceToken<T> 提供
export type BlueprintOperator<S> = (bp: ContextBlueprint<S>) => ContextBlueprint<S>

export function pipe<S, ...Ops extends ReadonlyArray<BlueprintOperator<S>>>(
    bp: ContextBlueprint<S>,
    ...operators: Ops
): ContextBlueprint<S>

// 3. 提供者選項（provide 與 provideSync 共用）
export interface ProvideOptions {
    readonly lifecycle?: ServiceLifecycle   // 預設 'scoped'
    readonly multi?: boolean                // 預設 false；僅 injectAll 系列可解析
    readonly eager?: boolean                // 預設 false；建立期（onMount 前）實例化
}

// 4. 同步提供者（二等；token 多載策略同 injectSync——見 02b §2b.8）
export function provideSync<S, T>(
    token: Token,
    factory: (session: Session<S>) => T,
    options?: ProvideOptions
): BlueprintOperator<S>

// 5. 非同步提供者（一等・默認）
export function provide<S, T>(
    token: Token,
    asyncFactory: (session: Session<S>) => Promise<T>,
    options?: ProvideOptions
): BlueprintOperator<S>

// 6. 生命週期鉤子（每個事件一個具名函式）
export function onMount<S>(handler: (session: Session<S>) => void | (() => void)): BlueprintOperator<S>
export function onDispose<S>(handler: (session: Session<S>) => void | Promise<void>): BlueprintOperator<S>
export function onSuspend<S>(handler: (session: Session<S>) => void): BlueprintOperator<S>
export function onResuscitate<S>(handler: (session: Session<S>, host: HostPort) => void): BlueprintOperator<S>
export function onAdopt<S>(handler: (session: Session<S>, owner: unknown) => void): BlueprintOperator<S>

// 7. 儲存
export function persist<S>(
    options: StorageOptions<S>
): BlueprintOperator<S>
```

- 同 token 的單值註冊 **後者覆蓋**；`multi: true` 註冊 **累加**（見 [02-domain-model.md](./02-domain-model.md) §2.1）。
- 工廠內若需狀態型別，請以 `selectSync((s: MyState) => …)(session)` 明確標註，或經 `ServiceRegistry` 型別化的服務取用。
- **投影 / 雙向綁定為非目標**：本版不提供 `project` / `twoWay`；狀態 → DOM 由使用者以流 + DOM API 自行組合（配方見 [08-projection.md](./08-projection.md)）。

### 3.2.1 範例

```ts
import { createContext, pipe, provide, provideSync, onMount, persist, mount, subscribe$ } from '@sandlada/document-context'

const counterBlueprint = pipe(
    createContext({ count: 0, user: null as User | null }),

    provideSync('logger', () => new ConsoleLogger(), { lifecycle: 'singleton' }),

    provide('user', async (session) => {
        const response = await fetch('/api/user', { signal: session.abortSignal })
        return response.json()
    }),

    onMount((session) => {
        const id = setInterval(() => update((s) => ({ count: s.count + 1 }))(session), 1000)
        return () => clearInterval(id)
    }),

    persist({ storage: 'localStorage', key: 'counter' })
)

const session = await mount(counterBlueprint)(document.getElementById('app')!)

// 狀態 → DOM 由使用者自行組合（官方配方見 08-projection.md §8.2）
subscribe$((s) => {
    document.querySelector('#badge')!.setAttribute('data-count', String(s.count))
})(session)
```

## 3.3 執行期動詞

```ts
export interface MountOptions {
    readonly token?: string                              // keyed 身分（可序列化公開 token；以 defineToken 規則驗證）
    readonly suspensionTtlMs?: number                    // 預設 50；0 = 立即銷毀；Infinity = 永不自動銷毀
    readonly onConflict?: 'throw' | 'evict' | 'reset'    // 預設 'throw'；身分衝突策略（見 05 §5.5）
    readonly ssrPayload?: 'auto' | 'off'                 // 預設 'auto'；無 PayloadResolver 裝配時自動退化為 off
    readonly signal?: AbortSignal                        // 僅 mount 消費；mountSync 不讀取
}

// 同步啟動（二等投影）：不等待水合 / eager；未就緒即拋；立即回傳 Session
export function mountSync<S, Host = HTMLElement>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions
): (element: Host) => Session<S, Host>

// 等待非同步儲存水合與 eager 服務完成後，才進入 Mounted 並 resolve
// 等待期 signal abort → 丟棄水合 / eager 結果、走 dispose 清理、以 signal.reason 拒絕；進入 Mounted 後不可取消
export function mount<S, Host = HTMLElement>(
    blueprint: ContextBlueprint<S>,
    options?: MountOptions
): (element: Host) => Promise<Session<S, Host>>

// 沿 element 祖先鏈回傳最近已掛載的 Session；無則 null（同步快照）
export function getSessionSync(element: Element): Session | null

export function selectSync<S, R>(selector: (state: S) => R): (session: Session<S>) => R
export function select$<S, R>(selector: (state: S) => R): (session: Session<S>) => Observable<R>

export function update<S>(updater: Partial<S> | ((prev: S) => Partial<S> | S)): (session: Session<S>) => boolean
export function subscribe$<S>(listener: (state: S) => void): (session: Session<S>) => Subscription

export function dispose(session: Session): void
```

- `mount` / `mountSync` 幂等以宿主為粒度：同宿主同身分重複呼叫回傳快取 Session；**藍圖以首次掛載為準**（替換藍圖 = `dispose` 後重掛）。快取命中時：`mountSync` 直接回傳；`mount` 的 Promise 立即 resolve（微任務）；`mountSync` 完整繼承 keyed / TTL / 復甦 / `onConflict` 規則（差異僅「不等待、未就緒即拋」）。
- 身分衝突（同宿主不同 token、同 token 雙活躍、`options.token` 與 `data-context-key` 矛盾）依 `onConflict`；預設 `throw`。
- DOM 組合下 `mount` / `mountSync` 均要求宿主已連線，否則 `UNCONNECTED_NODE`；`ssr` 組合不受此限。
- `mount` 等待期宿主斷開（未 abort）：初始化完成後判定——keyed → 直接 `Suspended`（不派發 `context-mount`、不執行 `onMount`；Promise resolve 該 Session，待復甦）；匿名 → 直接 `Disposed`（走清理；Promise 拒絕 `UNCONNECTED_NODE`）。`mountSync` 同步完成，不適用。
- `mount` 等待期 `signal` abort：丟棄水合 / eager 結果、走 `dispose` 清理（同步階段 + fire-and-forget）、以 `signal.reason` 拒絕；進入 `Mounted` 後不可取消。`mountSync` 無取消概念（不讀取 `signal`）。
- `dispose` 兩相：同步階段執行 `abort$` 發射、store 毒化、監聽解除、同步清理閉包（LIFO）；非同步清理 fire-and-forget；`[Symbol.asyncDispose]` / `await using` 會等待結算；`errors$` 於結算後 `complete()`。
- `update` 一律 **shallow merge**（物件展開語意；不深合併、不刪鍵）。

### 3.3.1 依賴注入

Token 系統（`ServiceToken<T>` / `PrivateToken<T>` / `ServiceRegistry` 並存、命名空間強制、字元規範）詳見 [02b-tokens.md](./02b-tokens.md)。解析採 **async-first**：元素目標一律晚綁定（缺席 = pending，見 [09b-late-binding.md](./09b-late-binding.md)）；同步 API 僅作用於已就緒的 Session。

```ts
// ── 同步投影（二等；僅 Session；隨時可能移除——見 §3.1.1）────────────────
// 1. ServiceRegistry 宣告合併（字串字面量，ergonomics）
export function injectSync<K extends keyof ServiceRegistry>(token: K): (session: Session) => ServiceRegistry[K]
// 2. 顯式 branded token
export function injectSync<T>(token: ServiceToken<T>): (session: Session) => T
// 3. 私有 token
export function injectSync<T>(token: PrivateToken<T>): (session: Session) => T
// 4. 裸字串（逃逸口，回傳 unknown）
export function injectSync(token: string): (session: Session) => unknown

export function injectAllSync<T>(
    token: Token,
    options?: { direction?: 'bottomUp' | 'topDown' }
): (session: Session) => ReadonlyArray<T>

// ── 晚綁定流（冷；首次解析後 complete；缺席 = pending）──────────────
export function inject$<T>(
    token: Token,
    options?: { timeoutMs?: number, signal?: AbortSignal }
): (target: Session | HostPort | Element) => Observable<T>

export function injectAll$<T>(
    token: Token,
    options?: { direction?: 'bottomUp' | 'topDown', timeoutMs?: number, signal?: AbortSignal }
): (target: Session | HostPort | Element) => Observable<ReadonlyArray<T>>

// ── 等待式 Promise（一等地名；預設無限等待；timeoutMs / signal 可選）────
export function inject<T>(
    token: Token,
    options?: { signal?: AbortSignal, timeoutMs?: number }
): (target: Session | HostPort | Element) => Promise<T>

export function injectAll<T>(
    token: Token,
    options?: { direction?: 'bottomUp' | 'topDown', signal?: AbortSignal, timeoutMs?: number }
): (target: Session | HostPort | Element) => Promise<ReadonlyArray<T>>

// ── Session 追蹤 ────────────────────────────────────────────────
export function getSessionSync(element: Element): Session | null            // 快照（二等）
export function session$(element: Element, options?: { signal?: AbortSignal }): Observable<Session | null>  // 熱流（一等）；訂閱即得當前值
```

- 所有注入 API 共用 [02b-tokens.md](./02b-tokens.md) §2b.8 的四種多載策略（`ServiceRegistry` / `ServiceToken<T>` / `PrivateToken<T>` / 裸字串）。
- **工廠內取用**：`provide`（非同步工廠）內用 `inject` / `inject$`；`provideSync`（同步工廠）內僅能用 `injectSync`（依賴值必須已就緒）。工廠內**不得**以 element 目標等待「自己所在會話」的掛載（`eager` 工廠必死鎖：`mount` 等 eager、eager 等 `Mounted`）——一律以 `session` 參數作 Session 目標；`timeoutMs` 僅作逃生，不作設計（D-81）。
- `injectSync` / `injectAllSync`（二等投影；見 §3.1.1）僅接受已取得的 `Session`；遇非同步服務 → `ASYNC_SERVICE_NOT_READY`（改用 `inject`，或 `eager: true` + `mount` 預備）。multi 收集亦然：任一條目未就緒 → **整體**拋錯，不做局部跳過。
- **元素目標的解析與 `mount` 順序無關**：先 inject 後 mount、先 mount 後 inject、被搬移、detached 後連線皆正確；缺席 = pending，只有顯式 `timeoutMs` 才產生 `RESOLUTION_TIMEOUT`。
- `inject$` / `injectAll$` 為冷串流：訂閱才開始解析；首次解析（多值首次非空）後 `complete()`；取消（unsubscribe / `signal`）即解除 pending。transient 生命週期下每個訂閱各自取得新實例。
- `inject` / `injectAll` 預設無限等待 Provider 出現；`timeoutMs` 逾時以 `RESOLUTION_TIMEOUT` 拒絕；`signal` abort 以 `signal.reason` 拒絕（預設平台 `AbortError`，自訂 reason 原樣傳遞）。
- **取消（AbortSignal）**：Observable 面（`inject$` / `injectAll$` / `session$`）abort → `complete()`（等同退訂，理由不進串流）；Promise 面 abort → 以 `signal.reason` 拒絕。取消不推送 `errors$`；呼叫前已 aborted → 立即結案（Observable 不發射、Promise 立即拒絕）。
- **目標死亡終止**：以明確 Session 為目標的等待，在該 Session 銷毀時以 `DISPOSED_SESSION` 終止（Observable error / Promise reject）；element 目標不因中間事件終止，持續等待。
- **Session 目標的缺席 = pending**：對明確 Session 解析不存在的 token 不拋 `UNKNOWN_SERVICE`（藍圖固定，但祖先會話可能後續掛載並經 `context-mount` 喚醒）；建議配 `timeoutMs`。
- **多通道冪等**：unsubscribe / `signal` / `timeoutMs` / 目標死亡競爭時先到者勝出、僅結案一次，無殘留計時器與監聽。
- `injectAll` / `injectAll$` / `injectAllSync` 僅收集 `multi: true` 註冊；對僅有 multi 的 token 呼叫單值 `inject` / `injectSync` → `UNKNOWN_SERVICE`。多值排序：`bottomUp`（預設，近→遠）／`topDown`（遠→近）；同一 scope 內依註冊順序。
- `session$(el)`：熱流、背靠當前值；訂閱即得當前值（`null` 或最近已 Mounted 的 Session），隨祖先鏈變化 / `context-mount` / `context-dispose` 推送；**只認已連線的 Mounted Session**——Initializing 與 Suspended 皆不可見（`mountSync` 同步完成，無可觀測窗口）；keyed 復甦時：Suspended 期間發射 `null`，復甦後重發**同一 Session 物件**。`getSessionSync(el)` 為其同步快照版；`signal` 取消 → `complete()`。
- 對已銷毀 Session 的 `injectSync` → `DISPOSED_SESSION`；以已銷毀 Session 為目標的 `inject$` / `inject` 以錯誤收場。

### 3.3.2 宿主綁定

```ts
export interface HostHooks {
    readonly connect: () => void
    readonly disconnect: () => void
    readonly adopt: (owner: unknown) => void
}

export function attach(config?: {
    readonly onConnect?: () => void
    readonly onDisconnect?: () => void
    readonly onAdopt?: (owner: unknown) => void
}): (session: Session) => HostHooks
```

詳見 [05-lifecycle-host.md](./05-lifecycle-host.md)。

### 3.3.3 儲存選項

```ts
export interface StorageOptions<S> {
    readonly storage: 'localStorage' | 'sessionStorage' | StoragePort
    readonly key: string
    readonly hydration?: 'storageFirst' | 'payloadFirst' | 'blueprintFirst' | 'merge'  // 預設 storageFirst
    readonly version?: number
    readonly migrate?: (persisted: unknown, oldVersion: number) => Partial<S>
    readonly crossTab?: boolean   // 預設 true（交由 infrastructure/storage 實作）
}
```

關鍵字 `'localStorage'` / `'sessionStorage'` 由 Application 的 storage registry 解析（見 [06-storage.md](./06-storage.md) §6.2 與 [09-infrastructure.md](./09-infrastructure.md) §9.1）；未註冊關鍵字 → `UNKNOWN_SERVICE`。

## 3.4 與 v0.0.1 的命名對照

| v0.0.1 | v0.1.0 |
| :--- | :--- |
| `withProvider(token, factory, opts)` | `provideSync(token, factory, opts)`（同步工廠・二等） |
| `withAsyncProvider(...)` | `provide(...)`（非同步工廠・一等） |
| `withHook('mount', fn)` | `onMount(fn)` |
| `withStorage` | `persist` |
| `withBridge` | **已移除**（非目標；無替代 API）：狀態 → DOM 由使用者以流 + DOM API 自行組合（見 [08-projection.md](./08-projection.md)） |
| `subscribe` | `subscribe$` |
| `readErrorStream(session)` | `session.errors$` |
| `mount(bp)(el)` / `mountAsync(bp)(el)` | `mount(bp)(el)`（非同步・默認，`Promise<Session>`）／`mountSync(bp)(el)`（同步投影・二等） |
| `inject(token)(element)` | `inject$(token)(element)`（流）/ `inject(token)(element)`（Promise） |
| `inject(token)(session)` / `select` / `update` / `dispose` / `createContext` / `pipe` | `injectSync` / `selectSync`（同步投影・二等）；`update` / `dispose` / `createContext` / `pipe` 不變 |
| `injectAsync(token)(element)` / `injectAllAsync(...)` | `inject` / `injectAll`（名稱去 `Async` 後缀） |
| （無） | `getSessionSync` / `session$`（由元素取得最近 Session：快照 / 熱流） |
| （無） | `injectAll$`、`provide` 選項 `multi` / `eager` |

## 3.5 公共 API 不變式

1. 所有運算子純函式，回傳新藍圖，不改動輸入。
2. 所有動詞柯里化 data-last。
3. `mount` / `mountSync` 幂等：同宿主同身分回傳快取；藍圖以首次掛載為準；身分衝突依 `onConflict`。
4. 對已銷毀 Session 的注入以 `DISPOSED_SESSION` 收場；`update` → `false`；`selectSync` → 最後快照；`subscribe$` → 立即完成的空流；`dispose` 可重複呼叫（幂等）。
5. token 一律通過與 `defineToken` 共用的驗證器（違規 `TOKEN_INVALID`）。
6. 元素目標解析與 `mount` 順序無關；缺席 = pending（見 [09b-late-binding.md](./09b-late-binding.md)）。
7. 取消與終止冪等：全 async 面接受 `signal`；unsubscribe / `signal` / `timeoutMs` / 目標死亡先到者勝出（見 [09b-late-binding.md](./09b-late-binding.md) §9b.2）。
8. 本庫不提供 DOM 投影 / 雙向綁定；DOM 表現由使用者自行組合（見 [08-projection.md](./08-projection.md)）。
