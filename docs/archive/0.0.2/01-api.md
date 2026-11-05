# 01 — 公共 API 與功能

所有**執行期動詞**與**藍圖運算子**都是高階函式：`operation(config)(target)`。配置在前，被作用的資料在最後一段。藍圖運算子回傳新藍圖。執行期動詞作用在 `Session` 或宿主元素上。

例外只有四類，它們不是「作用在某個目標上」，而是**產生**藍圖、**組合**藍圖、**定義** token 與**純計算**：`createContext(initial)`、`pipe(blueprint, ...operators)`、`defineToken<T>(visibility?)(name)`、`merge(base, patch)`。它們同樣是函式，但不是 data-last。

Phase 1 的結果由輸入決定，可以在不執行工廠的情況下從藍圖算出依賴圖與鉤子清單。Phase 2 會寫入會話快取與宿主監聽；IoC 無法避免這部分外部狀態，但它只出現在 `mount` 之後。

這一版只有一個穩定表面。名字裡不出現 `Sync` / `Async` 後綴。`$` 只表示 Observable。

## 1.1 總表

| 用途 | API | 回傳 |
| :--- | :--- | :--- |
| 種子 | `createContext(initial)` | `Blueprint<S>` |
| 組合 | `pipe(blueprint, ...operators)` | `Blueprint<S>` |
| 公開 token | `defineToken<T>()(name)` 或 `defineToken<T>('public')(name)` | `Token<T>`（runtime 字串） |
| 私有 token | `defineToken<T>('private')(name)` | `PrivateToken<T>` |
| 註冊依賴 | `provide(token, factory, options?)` | 藍圖運算子 |
| 鉤子 | `onMount` / `onDispose` / `onSuspend` / `onResume` / `onAdopt` | 藍圖運算子 |
| 掛載 | `mount(blueprint, options?)(host)` | `Session<S>`（同步） |
| 就緒 | `session.ready` | `Promise<void>` |
| 單值依賴 | `inject<T>(token, options?)(target)` | `Promise<T>` |
| 單值依賴流 | `inject$<T>(token, options?)(target)` | `Observable<T>`（一筆後 complete） |
| 多值依賴 | `injectAll<T>` / `injectAll$<T>` | `Promise<T[]>` / `Observable<T[]>` |
| 當下狀態 | `read(selector)(session)` | `R` |
| 寫狀態 | `update(updater)(session)` | `boolean` |
| 深合併 | `merge(base, patch)` | 新物件 |
| 訂閱狀態 | `subscribe$(listener)(session)` | `Subscription` |
| 最近會話 | `sessionAt(element)` | `Session \| null` |
| 追蹤最近會話 | `session$(element)` | `Observable<Session \| null>` |
| 銷毀 | `dispose(session)` | `void` |
| 非同步銷毀 | `await session[Symbol.asyncDispose]()` | `Promise<void>` |
| 宿主轉發 | `attach(config)(session)` | `{ detach(): void }` |
| 組合根 | `createApplication(ports)` | `Application`（Phase 2 綁定；見 [11-composition.md](./11-composition.md)） |

`definePrivateToken` 已退役。可見性是 `defineToken` 的第一段參數，名字在最後一段。省略可見性時為 `'public'`。

```ts
defineToken<User>()('app:user')
defineToken<User>('public')('app:user')
defineToken<Secret>('private')('internal:secret')
```

`Token<T>` 是帶型別的字串，runtime 即 `namespace:name` 本身；不同 script / bundle 各自 `defineToken<T>('public')('app:x')` 得到**同一字串**，解析靠字串相等，不靠共用模組單例。`inject<T>` 可接受同名裸字串（同驗證規則），此時 `T` 來自呼叫處的型別參數或 `ServiceRegistry`。`defineToken<T>('private')(name)` 只在同一 realm、同一模組圖內以引用辨識，不能跨 script，不能做 keyed 身分。見 [07-tokens.md](./07-tokens.md)。

## 1.2 Session

```ts
type SessionStatus = 'starting' | 'active' | 'suspended' | 'disposed'

interface Session<S> {
    readonly host: Host
    readonly token: string | null
    readonly status: SessionStatus
    readonly ready: Promise<void>
    readonly state$: Observable<S>
    readonly errors$: Observable<DocumentContextError>
    readonly lifecycle$: Observable<LifecycleEvent>
    readonly abortSignal: AbortSignal
}
```

`host` 在暫停與恢復之後仍然是同一個物件，裡面指向當前節點。`native()` 在暫停期間若節點已被回收，拋 `HOST_INVALID`。

`state$` 是熱的：訂閱立刻收到當前快照。`read` 就是讀這份快照，在 `starting`、`active`、`suspended` 都可用；`disposed` 回傳最後一筆。

## 1.3 掛載選項

```ts
interface MountOptions {
    readonly token?: string
    readonly suspensionTtlMs?: number
    readonly retention?: 'default' | 'pinned'
    readonly onConflict?: 'throw' | 'replace' | 'reset'
    readonly signal?: AbortSignal
}
```

- `token` 讓這份會話在宿主被換掉後還能找回狀態。省略則為匿名會話：確認斷線即銷毀。
- `suspensionTtlMs` 預設 `5000`。`0` 表示確認斷線後直接銷毀。`Infinity` 必須同時傳 `retention: 'pinned'`，否則 `mount` 拋出 `INVALID_OPTIONS`（[12-errors](./12-errors.md) §12.4）。
- `retention: 'pinned'` 表示這份會話**不受暫停上限影響**，也**不因 TTL 到期而銷毀**——它只會被明確 `dispose` 或因衝突而銷毀。`pinned` 與 `Infinity` 搭配時，兩者都成立。
- `onConflict` 只處理**同一個宿主**上的身分衝突，以及 `token` 與 `data-context-key` 不一致。**跨宿主**的同一 token（兩個已連線宿主）是硬失敗，後一次 `mount` 拋 `KEYED_CONFLICT`，`replace` / `reset` 都不適用（[09-mount-host](./09-mount-host.md) §9.4）。
- `signal` 只在 `starting` 期間生效。abort 後會話進入 `disposed`，`ready` 以 `signal.reason` 拒絕。進入 `active` 之後，取消這次掛載的方式是 `dispose(session)`。

瀏覽器 `Element` 與 SSR `serverHost` 的契約、嵌套宿主選型見 [09-mount-host.md](./09-mount-host.md)。

## 1.4 依賴

```ts
interface ProvideOptions {
    readonly lifecycle?: 'scoped' | 'singleton' | 'transient' | 'prototype'
    readonly eager?: boolean
    readonly multi?: boolean
    readonly uses?: readonly Token<unknown>[]
}

type Factory<T> = (tools: {
    readonly session: Session
    readonly use: <U>(token: Token<U>) => U
}) => T | Promise<T>
```

| 選項 | 預設 | 意義 |
| :--- | :--- | :--- |
| `lifecycle: 'scoped'` | 是 | 每個 Session 一份（.NET Scoped） |
| `lifecycle: 'singleton'` | | 每個 Document（伺服器上是每個請求）一份，先註冊者勝 |
| `lifecycle: 'transient'` 或 `'prototype'` | | 每次 `inject` 新的一份。`prototype` 與 `transient` 相同（Spring prototype / .NET Transient） |
| `eager: false` | 是 | 第一次 `inject` 才建立 |
| `multi: false` | 是 | `true` 時可由 `injectAll` / `injectAll$` 收集；**單值 `inject` 仍 nearest-wins**，不會因為存在 `multi` 註冊而改變。排序見 [04-promise-lazy.md](./04-promise-lazy.md) §4.5 |

**單值與多值是兩個池子。** `multi: true` 的註冊只進多值池：單值 `inject` **不**解析它，只在同一個 token 的**單值**註冊裡找。因此一個只註冊了 `multi: true` 的宿主**不**回答單值注入——單值注入會沿作用域鏈往更遠處找。

工廠的 `T` 不限於 record。function、class、symbol 與純資料走同一條 `inject`，以引用交付，不依型別另開 API。見 [08-injection.md](./08-injection.md)。

`uses` 可以列出**公開或私有**的 token；私有 token 只在同一模組圖內有效（[07-tokens](./07-tokens.md) §7.3）。`uses` 裡的 token 若在作用域鏈上解析不到，`ready` 以 `UNKNOWN_SERVICE` 拒絕——宣告錯了就是錯了，不會等到永遠。

`inject` 家族都帶型別參數。`Token<T>` 能推出 `T`。裸字串沒有品牌型別時，由呼叫處的 `<T>` 或 `ServiceRegistry` 給出。顯式 `<T>` 與品牌 token 不一致時，這次呼叫是型別錯誤。

```ts
interface InjectOptions {
    readonly wait?: boolean
}

interface InjectAllOptions {
    readonly wait?: boolean
    /** 僅 `injectAll` / `injectAll$`。預設 `from-bottom-to-top`（近→遠）。語意見 [04-promise-lazy.md](./04-promise-lazy.md) §4.5。 */
    readonly direction?: 'from-bottom-to-top' | 'from-top-to-bottom'
}

inject<T>(token: Token<T> | string, options?: InjectOptions): (target: LateTarget) => Promise<T>
inject$<T>(token: Token<T> | string, options?: InjectOptions): (target: LateTarget) => Observable<T>
injectAll<T>(token: Token<T> | string, options?: InjectAllOptions): (target: LateTarget) => Promise<T[]>
injectAll$<T>(token: Token<T> | string, options?: InjectAllOptions): (target: LateTarget) => Observable<T[]>
```

`options` 裡沒有 `signal`，也沒有 `timeoutMs`。單值沒有 `direction`。取消與多值排序見 [04-promise-lazy.md](./04-promise-lazy.md) §4.4、§4.5。

```ts
const userToken = defineToken<User>('public')('app:user')
const user = await inject(userToken)(element)
const theme = await inject<'dark' | 'light'>('app:theme')(element)
```

`use<U>` 同樣由 token 的 `U` 決定回傳型別。它是同步的，因為 `uses` 在工廠執行前已經算完。

`use(token)` 只能取 `uses` 裡列出、且已經建立完成的依賴。**解析規則與 `inject` 相同**：nearest-wins，作用域鏈包含本會話自己的藍圖。工廠不必再 `await inject` 去拿它們。

注入目標是 `Element`（瀏覽器）、`Session`，或 `HostPort`（同一 Application 內部的宿主表徵）。公共面不要求呼叫者自備 `HostPort`——它是內部概念。

動態依賴仍然用 `inject`：token 要到執行時才知道，或依賴在祖先會話上、藍圖寫不出來。動態路徑的規則見 [04-promise-lazy.md](./04-promise-lazy.md)。

同一藍圖裡，同一個單值 token 後註冊的覆蓋先註冊的。`multi: true` 則累加。

## 1.5 狀態

`update` 的回傳值就是下一份狀態，與 React `useState` 的 setter 相同。函式收到上一份狀態，回傳的物件整份換上。上一份裡有、回傳值裡沒有的鍵會被刪除。

要留下原欄位，呼叫者自己展開：

```ts
update((state) => ({ ...state, count: state.count + 1 }))(session)

update((state) => {
    const { draft, ...rest } = state
    return rest
})(session)
```

直接傳物件也是整份替換，沒寫上的鍵同樣刪除：

```ts
update({ count: 1 })(session)
```

巢狀欄位不會自動合併。要改巢狀物件裡的一個鍵，在回傳值裡自己展開那一層，或先做深合併再整份換上：

```ts
update((state) => merge(state, { user: { name: 'Ada' } }))(session)
```

`merge(base, patch)` 是純函式，不寫入會話。兩邊都是純物件時按鍵遞迴；陣列、`null`、日期與其他非純物件整顆替換。`patch` 沒提到的鍵保留。它不刪鍵；刪鍵只發生在 `update` 的回傳值裡。不合併 `__proto__`、`constructor`、`prototype`。遇到循環引用時 `merge` 拋錯，`update` 不改變狀態。

回傳 `false` 表示會話已 `disposed`，狀態沒有變。

updater **必須是同步的**：回傳型別不含 `Promise`。需要非同步工作時，把工作放進 `provide` 的工廠裡，不要放進 `update`。

updater 拋錯時，錯誤**原樣向外拋出**，狀態**不變**，快照**不動**。狀態的不可破壞性優先於錯誤的可見性——半套更新比看不到錯誤更糟。

`starting` 期間的 `update` 排在種子落地之後、eager 之前，依呼叫順序重放，然後 `ready` 才 fulfill。見 [02-lifecycle.md](./02-lifecycle.md)。

`suspended` 期間的 `update` **允許**，且 `state$` 訂閱者照常收到推送。暫停不是靜止。

快照是**不可變**的：交到呼叫者手上後不得被改動。`createContext(initial)` 在建立藍圖時**複製**初始狀態，呼叫者之後改動原始物件不影響會話。

`subscribe$` 在會話銷毀時結束訂閱；`state$` 本身也會在會話銷毀時**完成**（[13-reactivity](./13-reactivity.md) §13.2）。要提早結束就自己退訂，不必再包一層 `takeUntil`。

要寫進 `localStorage`、其他分頁或 HTML，呼叫者自己 `read` 或訂 `state$`，在庫外轉成字串再寫。本庫不提供 `persist` 或 `codec`。

## 1.6 失敗時使用者看到什麼

錯誤的**識別碼、觸發條件與出現位置**由 [12-errors.md](./12-errors.md) 單獨定義；本章只給速查。

| 情況 | 結果 |
| :--- | :--- |
| 元素目標上還沒有提供者 | `inject` 保持 pending，直到提供者出現、目標斷線，或所屬會話被銷毀 |
| `Session` 目標上沒有這個 token，且 `wait` 未開 | `inject` 拒絕 `UNKNOWN_SERVICE` |
| `uses` 圖有環，或動態等待形成環 | `ready` 或該次 `inject` 拒絕 `CIRCULAR_DEPENDENCY` |
| 對已銷毀會話 `inject` | 拒絕 `DISPOSED_SESSION` |
| 瀏覽器裡對未連線節點 `mount` | 拋 `UNCONNECTED_HOST` |
| 兩個已連線宿主搶同一個 token | 拋 `KEYED_CONFLICT` |
| token 字串不合法 | 拋 `TOKEN_INVALID` |
| 宿主不是元素 | 拋 `HOST_INVALID` |
| `onMount` 以外的鉤子拋錯 | `errors$` 收到 `HOOK_ERROR`，其餘鉤子繼續 |
| `onMount` 或 eager 工廠失敗 | `ready` 拒絕，會話銷毀 |
| `mount` 的 `signal` 在 `starting` 期間 abort | 會話銷毀，`ready` 以 `signal.reason` 拒絕 |
| 同 Application 重複 singleton | 先註冊者保留，後者的 `errors$` 收到 `SINGLETON_CONFLICT` |
| 掛載選項組合不合法 | 拋 `INVALID_OPTIONS` |

`inject` 家族不接受 `AbortSignal`，也沒有 `timeoutMs`。`inject$` / `injectAll$` 退訂就結束等待並 `complete()`。取消**不是**失敗，不寫入 `errors$`。見 [04-promise-lazy.md](./04-promise-lazy.md)、[12-errors.md](./12-errors.md)。

## 1.7 與 DOM 組合

狀態寫進 DOM、事件寫回狀態，都由呼叫者完成：

```ts
subscribe$((state) => {
    session.host.native().querySelector('output')!.textContent = String(state.count)
})(session)

session.host.on('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-inc]')) {
        update((state) => ({ ...state, count: state.count + 1 }))(session)
    }
})
```

鉤子與暫停期間不要把 `native()` 存進閉包。恢復後重新讀。見 [02-lifecycle.md](./02-lifecycle.md)。
