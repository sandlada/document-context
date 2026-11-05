# 18 — 配方

本章只放**可直接複製**的用法配方。

- **不新增公共 API**。每個配方只用 [01-api.md](./01-api.md) §1.1 總表上的動詞：`createContext`、`pipe`、`defineToken`、`provide`、`onMount` / `onSuspend` / `onResume` / `onDispose` / `onAdopt`、`mount`、`inject` / `inject$` / `injectAll` / `injectAll$`、`read`、`update`、`merge`、`subscribe$`、`sessionAt` / `session$`、`dispose`、`attach`、`createApplication`。
- 本庫**不內建 DOM 投影**（[00-overview.md](./00-overview.md) §0.3.10）。所有「把狀態畫到畫面上」的配方都是呼叫者自己寫的 DOM 程式碼。
- 需要示意型別或示意介面的段落會標示 **（示意）**。具體的 TypeScript 形狀於**實作期**決定（[01-api.md](./01-api.md) 開頭的說明）。

---

## 18.1 最小渲染

**適用情境**：一個狀態欄位要顯示在畫面上，並且能被按鈕改動。這是所有其它配方的地基。

```ts
import { createContext, mount, pipe, subscribe$, update } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
)

const host = document.querySelector('#app')
if (host === null) {
    throw new Error('missing #app')
}

const session = mount(blueprint)(host)
await session.ready

const output = host.querySelector('output')
if (output === null) {
    throw new Error('missing output')
}

subscribe$((state) => {
    output.textContent = String(state.count)
})(session)

session.host.on('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-inc]')) {
        update((state) => ({ ...state, count: state.count + 1 }))(session)
    }
})
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| `mount` 是同步的 | 呼叫後立刻拿到 `Session`，但初始化尚未完成。`await session.ready` 之後才可依賴 eager 依賴與 `onMount` 的副作用 |
| `update` 是整份替換 | `({ ...state, count: ... })` 裡的展開**必須寫**。省略會讓其它欄位消失（[01-api.md](./01-api.md) §1.5） |
| `subscribe$` 回傳 `Subscription` | 會話銷毀時 `state$` **完成**，訂閱自然結束，不必再包 `takeUntil`（[13-reactivity.md](./13-reactivity.md) §13.2） |
| `host` 必須已連線 | 對未連線元素 `mount` 會拋 `UNCONNECTED_HOST`（[03-dom.md](./03-dom.md) §3.1） |
| DOM 節點在暫停期間會失效 | keyed 會話恢復後底層節點可能換了。**不要**把 `host.querySelector(...)` 的結果存成長期閉包；改成每次渲染時重新抓，或在 `onResume` 重新綁 |

---

## 18.2 欄位級投影與去重

**適用情境**：狀態有十幾個欄位，但只有一個欄位的變化要重畫那一小塊 DOM。

```ts
import { distinctUntilChanged, map } from 'rxjs'

const count$ = session.state$.pipe(
    map((state) => state.count),
    distinctUntilChanged(),
)

const subscription = count$.subscribe((count) => {
    output.textContent = String(count)
})
```

**沒有 `distinctUntilChanged` 時**，任何一次 `update` 都會推進整份快照，訂閱者一律重畫——即使 `count` 根本沒變。

**物件欄位**的預設相等比較是引用相等，需要自訂比較器：

```ts
const user$ = session.state$.pipe(
    map((state) => state.user),
    distinctUntilChanged((a, b) => a.id === b.id && a.displayName === b.displayName),
)
```

**多個消費者共用同一個衍生值**時，用 `shareReplay` 讓計算只做一次：

```ts
import { distinctUntilChanged, map, shareReplay } from 'rxjs'

const total$ = session.state$.pipe(
    map((state) => state.count * state.price),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
)

const a = total$.subscribe(renderA)
const b = total$.subscribe(renderB)
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| 庫**不內建**欄位級去重 | `state$` 只做**引用去重**（新舊快照同一個物件就不推送）。欄位級語意由呼叫者用 `distinctUntilChanged` 組合（[13-reactivity.md](./13-reactivity.md) §13.2） |
| `shareReplay` 的 `refCount: true` | 沒有訂閱者時不保留快取，避免會話銷毀後仍留著衍生值 |
| 衍生值在 `state$` 的回呼裡計算 | 狀態推送是**同步**的。在回呼裡再 `update` 會造成同步遞迴（[13-reactivity.md](./13-reactivity.md) §13.9） |

---

## 18.3 受控輸入

**適用情境**：輸入框的值由狀態決定（受控），使用者輸入要寫回狀態。

```ts
import { createContext, mount, pipe, subscribe$, update } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ query: '' }),
)

const host = document.querySelector('#search')
if (host === null) {
    throw new Error('missing #search')
}

const session = mount(blueprint)(host)
await session.ready

const input = host.querySelector('input')
if (!(input instanceof HTMLInputElement)) {
    throw new Error('missing input')
}

session.host.on('input', (event) => {
    const target = event.target
    if (target instanceof HTMLInputElement) {
        update((state) => ({ ...state, query: target.value }))(session)
    }
})

subscribe$((state) => {
    if (input.value !== state.query) {
        input.value = state.query
    }
})(session)
```

**寫回前先比對**是重點：每次 `input` 事件都會推進狀態，若無條件寫 `input.value`，游標會被移到結尾。

**數字欄位**要自己解析，並決定空字串怎麼處理：

```ts
session.host.on('input', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) {
        return
    }
    const parsed = target.valueAsNumber
    update((state) => ({
        ...state,
        amount: Number.isNaN(parsed) ? 0 : parsed,
    }))(session)
})
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| 事件選 `input` 或 `change` | `input` 每次按鍵都送；`change` 在失焦或 Enter 時才送。兩者都不需要庫內建支援 |
| 受控 = 狀態是唯一真實來源 | 若只想「讀一次輸入值」，用 `event.target.value` 直接用，不必進狀態 |
| 不要把 `input` 元素存成長期閉包 | keyed 會話恢復後節點可能已被替換。用 `session.host.native()` 重新取得，或在 `onResume` 重新綁（[02-lifecycle.md](./02-lifecycle.md) §2.3） |
| 每次輸入都是整份替換 | `update` 不會替你保留未提及的欄位 |

---

## 18.4 派生狀態與記憶化

**適用情境**：狀態裡的某個衍生值（例如總價、篩選後的清單）算起來不便宜，而多個地方都要用。

**為什麼庫不內建 `memoize`**

| 理由 | 說明 |
| :--- | :--- |
| 記憶化需要「鍵」 | 快取要依什麼命中？欄位名？物件路徑？這是消費端的形狀問題，核心庫不知道 |
| 整份 state 的 memo 已經內建 | `state$` 只在快照**引用不同**時推送（`RX #2`）。缺的只是「衍生值」的 memo，而那正是 `distinctUntilChanged` 的位置 |
| memo 會製造共享 mutable 狀態 | 快取的生命週期必須綁在會話 / Application 上，否則會違反「Application 是唯一 mutable 邊界」（`PORT #3`） |
| 閉包會過期 | memo 記住的是某次 selector 的結果；selector 換了卻命中舊快取，是難查的 bug |

**寫法一：用 `distinctUntilChanged` 當串流層的 memo**

```ts
import { distinctUntilChanged, map } from 'rxjs'

const total$ = session.state$.pipe(
    map((state) => state.items.reduce((sum, item) => sum + item.price * item.qty, 0)),
    distinctUntilChanged(),
)
```

`state$` 只在快照引用改變時推送，而 `distinctUntilChanged` 只在**衍生值**改變時才讓下游收到——這兩層合起來就是「衍生值級別的 memo」。

**寫法二：以狀態快照為鍵的純函式 memo**

快照是不可變的，每次 `update` 產生新物件，所以「快照引用」天然就是快取鍵：

```ts
const memo = new WeakMap<object, number>()

const total = (state: { items: Array<{ price: number, qty: number }> }): number => {
    const cached = memo.get(state)
    if (cached !== undefined) {
        return cached
    }
    const value = state.items.reduce((sum, item) => sum + item.price * item.qty, 0)
    memo.set(state, value)
    return value
}

const total$ = session.state$.pipe(
    map((state) => total(state)),
    distinctUntilChanged(),
)
```

**寫法三：需要「同一份依賴多次用到同一個計算」時**，把它做成 `provide` 的產物，讓生命週期替你管理快取：

```ts
import { defineToken } from '@sandlada/document-context'

const totalsToken = defineToken<{ of(state: State): number }>('public')('app:totals')

provide(totalsToken, () => {
    const memo = new WeakMap<object, number>()
    return {
        of(state: State): number {
            const cached = memo.get(state)
            if (cached !== undefined) {
                return cached
            }
            const value = state.items.reduce((sum, item) => sum + item.price * item.qty, 0)
            memo.set(state, value)
            return value
        },
    }
}, { lifecycle: 'scoped' })
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| `WeakMap` 會跟著快照一起被回收 | 快照沒有其它參照時，條目自動消失，不會洩漏 |
| `update` 回傳同一個參考時不會推送 | 那一筆的 memo 也不會被重新計算——這正是想要的效果 |
| `scoped` vs `singleton` 的快取 | `scoped` 每個 Session 一份；`singleton` 每個 Application 一份。**不要**把跨會話的快取放進 `scoped` 產物 |
| `read` 沒有記憶化 | `read(selector)(session)` 每次都重新計算。需要 memo 就自己加這一層 |

---

## 18.5 異步 provider：把 `session.abortSignal` 接到 `fetch`

**適用情境**：某個依賴要打網路取資料，而且會話被銷毀時這次請求應該取消。

```ts
import { createContext, defineToken, mount, pipe, provide } from '@sandlada/document-context'

interface Profile {
    readonly id: string
    readonly name: string
}

const profileToken = defineToken<Profile>('public')('app:profile')

const blueprint = pipe(
    createContext({ status: 'idle' as 'idle' | 'ready' }),
    provide(profileToken, async ({ session }) => {
        const response = await fetch('/api/profile', { signal: session.abortSignal })
        if (!response.ok) {
            throw new Error(`profile request failed: ${response.status}`)
        }
        return await response.json() as Profile
    }, { eager: true }),
)

const session = mount(blueprint)(host)
await session.ready
```

**取用**

```ts
import { inject } from '@sandlada/document-context'

const profile = await inject(profileToken)(host)
```

**宣告式依賴**（`uses`）讓依賴在工廠執行前就緒，工廠裡 `use()` 是**同步**的：

```ts
const httpToken = defineToken<{ get(path: string): Promise<unknown> }>('public')('app:http')
const userToken = defineToken<User>('public')('app:user')

provide(httpToken, () => ({
    get: (path: string) => fetch(path).then((res) => res.json()),
}), { lifecycle: 'singleton' })

provide(userToken, async ({ use }) => {
    const http = use(httpToken)
    return await http.get('/api/user') as User
}, { uses: [httpToken] })
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| `session.abortSignal` 在會話 `disposed` 時 abort | 這是外部 I/O 的取消邊界；`inject` 家族本身**不**接受 `AbortSignal`（[04-promise-lazy.md](./04-promise-lazy.md) §4.4） |
| 工廠被中止後會清掉快取 | `scoped` / `singleton` 的進行中 Promise 合併成同一個；拒絕後清掉快取，下一次 `inject` 可以重試（[08-injection.md](./08-injection.md) §8.1） |
| `eager: true` 的工廠失敗 → `ready` 拒絕 | 會話隨後 `disposed`（[12-errors.md](./12-errors.md) §12.4） |
| 工廠**不得** `await session.ready` | 會和 `ready` 互相等待。要用的依賴寫進 `uses`，用 `use()` 取 |
| 依賴取消**不是**錯誤 | 不寫入 `errors$`，也不轉成失敗識別碼（[12-errors.md](./12-errors.md) §12.5） |

---

## 18.6 keyed session：片段替換後保留狀態

**適用情境**：HTMX / Turbo / 任何「把一塊 DOM 換掉」的框架。要讓被換掉的那塊**保留狀態**。

```ts
import { createContext, mount, pipe } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
)

const mountCounter = (host: Element): void => {
    // token 必須一致：恢復時靠它找回同一份會話
    const session = mount(blueprint, { token: 'app:counter' })(host)
    void session.ready
}

const root = document.querySelector('#counter')
if (root === null) {
    throw new Error('missing #counter')
}

mountCounter(root)

// 片段被換掉之後，在新元素上再掛一次：同一個 token → 同一份會話
document.addEventListener('htmx:afterSwap', (event) => {
    const target = event.target
    if (target instanceof Element && target.matches('[data-counter]')) {
        mountCounter(target)
    }
})
```

**恢復時重新投影畫面**：節點換了，`output` 的元素也換了，所以要把渲染邏輯放進 `onResume`：

```ts
import { createContext, onResume, pipe, read } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
    onResume((session) => {
        const node = session.host.native()
        const output = node.querySelector('output')
        if (output !== null) {
            output.textContent = String(read((state) => state.count)(session))
        }
    }),
)
```

**Turbo** 用的是自己的事件：

```ts
document.addEventListener('turbo:render', () => {
    const target = document.querySelector('[data-counter]')
    if (target instanceof Element) {
        mountCounter(target)
    }
})
```

**重點**：恢復是**換節點、留狀態**，不是「重新建立」。同一個 `token` 在 TTL 內回到新的已連線宿主，就會走 `onResume`，狀態保留、不回到種子（[02-lifecycle.md](./02-lifecycle.md) §2.3）。

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| TTL 預設是 **5000ms** | 片段替換後要在一個窗口內重新掛載。逾時就回到種子（[09-mount-host.md](./09-mount-host.md) §9.5） |
| 同一時間只能有一個宿主持有該 token | 兩個已連線宿主搶同一個 token → 後一次 `mount` 拋 `KEYED_CONFLICT`（`replace` / `reset` **不**適用） |
| 同一個元素重複 `mount` | 依 `onConflict` 處理，預設 `throw` |
| 暫停期間狀態仍可改 | `suspended` 不是靜止，`update` 仍有效、`state$` 仍推送 |
| 匿名會話沒有這個能力 | 沒傳 `token` 的會話在確認斷線時**直接銷毀**，不暫停 |
| 逾時銷毀後是**新會話** | 狀態從藍圖種子開始，不是舊狀態 |

---

## 18.7 跨 bundle / 跨 script

**適用情境**：同一個頁面上有兩支互不認識的 `<script>`。一方提供服務，另一方消費。**不需要**共用 import。

```html
<div id="page">
    <output id="theme-label"></output>
</div>

<script type="module" src="/bundle-a.js"></script>
<script type="module" src="/bundle-b.js"></script>
```

**`/bundle-a.js`**（提供者，掛在祖先元素上）：

```ts
import { createContext, defineToken, mount, pipe, provide } from '@sandlada/document-context'

const themeToken = defineToken<'dark' | 'light'>('public')('app:theme')

const blueprint = pipe(
    createContext({ theme: 'light' as 'dark' | 'light' }),
    provide(themeToken, () => 'light'),
)

const host = document.querySelector('#page')
if (host === null) {
    throw new Error('missing #page')
}

const session = mount(blueprint)(host)
await session.ready
```

**`/bundle-b.js`**（消費者，**不需要** import A 的 token）：

```ts
import { inject } from '@sandlada/document-context'

const label = document.querySelector('#theme-label')
if (label === null) {
    throw new Error('missing #theme-label')
}

const theme = await inject<'dark' | 'light'>('app:theme')(label)
label.textContent = theme
```

**傳遞的原理**是 DOM 上的 Context Protocol 事件：`context-request` 沿 composed 祖先鏈冒泡，提供者會話 `active` 後回應；`context-mount` 喚醒等待中的請求（[10-events.md](./10-events.md) §10.1）。

**重點**：

- 消費端**必須用元素目標**。以 `Session` 為目標時只看得見自己那份藍圖與既有祖先，不會等「也許稍後才出現的祖先」。
- 公開 token 的 runtime 身分就是 `namespace:name` **字串**。兩邊各自 `defineToken` 同名即等價（[07-tokens.md](./07-tokens.md) §7.1）。
- 私有 token（`defineToken<T>('private')(...)`）**不能**跨 script：它是引用身分。

**同一份 bundle 裡想避免字串散落**時，抽一個共用的常數模組：

```ts
// tokens.ts —— 兩邊都 import 這一個檔
import { defineToken } from '@sandlada/document-context'

export const themeToken = defineToken<'dark' | 'light'>('public')('app:theme')
```

**跨 bundle 的 singleton 注意事項**：`singleton` 槽**每個 Application 一份**，不跨組合根共享。跨 script 要共用服務，就把它 **provide 在祖先 DOM 上**（scoped），讓消費端沿鏈解析——不要依賴「另一支 script 已經註冊過 singleton」（[07-tokens.md](./07-tokens.md) §7.2）。

---

## 18.8 SSR：請求內 mount → read → dispose

**適用情境**：伺服器端算出一份狀態，交給模板渲染。**本庫不寫 HTML，也不從 HTML 讀回**（[05-ssr.md](./05-ssr.md) §5.1）。

```ts
import { createContext, dispose, mount, pipe, read } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ title: 'Hello' }),
)

export async function render(): Promise<string> {
    // 示意：每個請求各自一個 Application；取得占位宿主的方式於實作期決定
    const app = createSsrApplication()
    const serverHost = app.serverHost

    const session = mount(blueprint)(serverHost)
    await session.ready

    const state = read((value) => value)(session)

    // 模板是呼叫者的事：字串格式、HTML 跳脫、放在哪個 <script> 都不歸本庫
    // （escapeHtml 是呼叫者自己的工具函式，不是本庫提供）
    const html = `<h1>${escapeHtml(state.title)}</h1>`

    dispose(session)
    return html
}
```

**邊界（必須遵守）**

| 項目 | 說明 |
| :--- | :--- |
| **每個請求一個 Application** | 請求之間不得共用實例，否則 singleton 與 keyed 暫存表會跨請求洩漏（[11-composition.md](./11-composition.md) §11.2） |
| **先 `dispose(session)`，再釋放 Application** | 釋放順序反了，singleton 槽可能還活著 |
| 伺服器上不跑 `onMount` / `onSuspend` / `onResume` | `onDispose` 會跑（[02-lifecycle.md](./02-lifecycle.md) §2.2） |
| 伺服器上 `inject` 只能用 `Session` 為目標 | 沒有元素晚綁定；缺席即 `UNKNOWN_SERVICE` |
| 伺服器上不產生也不解析 payload | 沒有 `serialize`，也沒有 `ssrPayload` 選項 |

**瀏覽器接回時**：把伺服器算出的值放進藍圖**種子**，而不是等庫去讀 DOM。

```ts
const restored = decode(document.querySelector('#state')?.textContent ?? '')
const session = mount(pipe(createContext(restored)))(element)
await session.ready
```

**HTML 上的文字是否等於這份狀態，由渲染那份 HTML 的人負責**。本庫不比對 DOM，也不在不一致時改寫節點。

---

## 18.9 測試：假 Application / 假 ports

**適用情境**：測試生命週期、暫停 TTL、斷線恢復這些**時間相關**的行為，想讓時間確定化。

**三種測試層級**

| 層級 | 掛載對象 | 需要什麼 |
| :--- | :--- | :--- |
| 純藍圖 / 依賴解析 | `serverHost`（**示意**：非 DOM 占位宿主） | 不需要 DOM |
| DOM 行為 | 已連線的 `Element` | happy-dom 或真瀏覽器 |
| 時間行為（TTL、斷線） | 假 host adapter + 假 scheduler | 可注入的 ports |

**示意：假 Application 的組裝**（ports 的確切形狀於**實作期**決定）：

```ts
// 示意：假 host adapter 與假排程器的形狀於實作期決定
import { expect } from 'vitest'
import { createApplication, createContext, pipe, read, update } from '@sandlada/document-context'

const blueprint = pipe(
    createContext({ count: 0 }),
)

const app = createApplication({
    host: {
        toHost: (native: unknown) => fakeHost,
        connectivity: fakeConnectivity,
        scheduler: fakeClock,
        scopeTransport: fakeScopeTransport,
        tokens: fakeTokens,
    },
})

// 示意：非 DOM 占位宿主；SSR 與測試共用同一種形狀
const serverHost = { kind: 'server' }

const session = app.mount(blueprint)(serverHost)
await session.ready

expect(read((state) => state.count)(session)).toBe(0)

update((state) => ({ ...state, count: 1 }))(session)

expect(read((state) => state.count)(session)).toBe(1)
```

> **兩種 microtask 不要搞混。** 假排程器的微任務佇列與 JavaScript 語意的 microtask 是**兩件事**。`await Promise.resolve()` 只推進 JS microtask，**不會**推進假排程器的佇列；要推進後者必須呼叫 flush 驅動（[15-testing.md](./15-testing.md) §15.3.2）。

**用真的 DOM 節點做測試時，節點必須已連線**：

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { mount, update } from '@sandlada/document-context'

describe('counter', () => {
    let host: HTMLElement

    beforeEach(() => {
        document.body.innerHTML = '<div id="app"><output></output></div>'
        const found = document.querySelector('#app')
        if (found === null) {
            throw new Error('missing #app')
        }
        host = found
    })

    it('renders the current count', async () => {
        const session = mount(blueprint)(host)
        await session.ready

        const output = host.querySelector('output')
        update((state) => ({ ...state, count: 3 }))(session)

        expect(output?.textContent).toBe('3')
    })
})
```

**斷線與恢復的測試**：把節點從文件拿掉，等一個微任務（重掛確認），再掛到新節點上。

```ts
import { expect } from 'vitest'
import { mount, read, update } from '@sandlada/document-context'

const first = document.querySelector('#app')
if (first === null) {
    throw new Error('missing #app')
}

const session = mount(blueprint, { token: 'app:counter' })(first)
await session.ready

update((state) => ({ ...state, count: 7 }))(session)

first.remove()
await clock.flushMicrotasks() // 重掛確認：推進假排程器的微任務佇列

const second = document.querySelector('#app')
if (second === null) {
    throw new Error('missing #app')
}

const resumed = mount(blueprint, { token: 'app:counter' })(second)
await resumed.ready

expect(read((state) => state.count)(resumed)).toBe(7)
```

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| 每個用例或每個 `describe` 各建一個 Application | ports 換成 fake，測試之間不共享狀態（[11-composition.md](./11-composition.md) §11.2） |
| `await session.ready` 是必要的 | 否則測到的是 `starting` 狀態，eager 依賴與 `onMount` 還沒跑 |
| `update` 在 `starting` 期間會被排隊重放 | 種子落地 → 重放 → eager。順序固定（[02-lifecycle.md](./02-lifecycle.md) §2.1） |
| **不要用 `setTimeout` 等時間** | 時間一律由假排程器推進：TTL 用 `clock.advance(ms)`，微任務用 `await clock.flushMicrotasks()`（[15-testing.md](./15-testing.md) §15.3） |
| 測試層級與檔名 | `*.unit-test.ts`（node，假 ports）／`*.integration-test.ts`（happy-dom）／`*.e2e-test.ts`（happy-dom）。共置於源檔旁（[15-testing.md](./15-testing.md) §15.1） |
| 每個 `it` 至少一個斷言 | 斷言要能對應到某一條不變式 ID（`LC #n` / `SCOPE #n` / `API #n`）（[15-testing.md](./15-testing.md) §15.2） |
| 測完請 `dispose(session)` | 讓訂閱與監聽器確實收乾淨 |
| 時間行為經排程埠 | 假排程器讓 TTL 與重掛確認可手動推進（[13-reactivity.md](./13-reactivity.md) §13.8） |
| 錯誤的緩衝要立刻訂閱 | 想讀到掛載期的錯誤，必須在 `mount` 之後**立刻**訂 `errors$` |

---

## 18.10 同頁多 Application：隔離 singleton

**適用情境**：同一個頁面上有兩個互不信任的區塊（例如微前端），各自需要一份 `singleton`，而且**不能**互相看到。

```ts
import { createContext, createApplication, defineToken, pipe, provide } from '@sandlada/document-context'

const configToken = defineToken<{ name: string }>('public')('app:config')

const buildBlueprint = (name: string) => pipe(
    createContext({ name }),
    provide(configToken, () => ({ name }), { lifecycle: 'singleton' }),
)

// 示意：兩個獨立的 Application 實例，各用各自的 host adapter
const appA = createApplication({ host: hostAdapterA })
const appB = createApplication({ host: hostAdapterB })

const hostA = document.querySelector('#widget-a')
const hostB = document.querySelector('#widget-b')
if (hostA === null || hostB === null) {
    throw new Error('missing widget hosts')
}

const sessionA = appA.mount(buildBlueprint('a'))(hostA)
const sessionB = appB.mount(buildBlueprint('b'))(hostB)
await sessionA.ready
await sessionB.ready
```

`sessionA` 與 `sessionB` 是兩個 Application 的兩份 session。`singleton` 槽**各自一份**，互相看不到。

**跨 Application 想共用同一份服務**時，正確做法是**把服務放在祖先 DOM 上**，讓消費端沿作用域鏈解析：

```ts
// 祖先（appA 掛載）
const pageBlueprint = pipe(
    createContext({}),
    provide(configToken, () => ({ name: 'shared' })),
)

const pageHost = document.querySelector('#page')
if (pageHost === null) {
    throw new Error('missing #page')
}

const pageSession = appA.mount(pageBlueprint)(pageHost)
await pageSession.ready

// 消費端（另一個 Application，子節點）——用元素目標
const leaf = document.querySelector('#widget-b-leaf')
if (leaf === null) {
    throw new Error('missing leaf')
}

const shared = await appB.inject(configToken)(leaf)
```

**同一個 Session 只能用 mount 出它的那個 Application 操作**。拿 `appA` 的動詞去操作 `appB` 的 session，結果**未定義**，實作**應當拒絕**（[11-composition.md](./11-composition.md) §11.8）。

**注意点**

| 項目 | 說明 |
| :--- | :--- |
| singleton 歸 Application | 不跨組合根、不跨 SSR 請求（[14-ports.md](./14-ports.md) §14.6） |
| 同一 Application 內重複註冊同名 singleton | **先註冊者勝**，後者被忽略並收到一筆 `SINGLETON_CONFLICT`（非致命） |
| scoped 依賴跨 Application 可用 | 祖先 DOM 上 provide 的 scoped 服務，子樹的 `inject`（元素目標）沿鏈解析得到 |
| 狀態不跨 Application | 每個 `mount` 一份 state。共享狀態只能靠祖先會話 |
| 同頁多 Application 的收益 | 刻意隔離 singleton、暫存表與 pending 表；與「多 script / 多 bundle」無關 |

---

## 18.11 配方索引

| 需求 | 配方 |
| :--- | :--- |
| 把狀態畫到畫面上 | [§18.1](#181-最小渲染) |
| 只有一個欄位變了才重畫 | [§18.2](#182-欄位級投影與去重) |
| 輸入框與狀態雙向對應 | [§18.3](#183-受控輸入) |
| 衍生值很貴 / 想記憶化 | [§18.4](#184-派生狀態與記憶化) |
| 依賴要打網路、要能取消 | [§18.5](#185-異步-provider把-sessionabortsignal-接到-fetch) |
| 片段被換掉後要保留狀態 | [§18.6](#186-keyed-session片段替換後保留狀態) |
| 兩支 script 不共用 import | [§18.7](#187-跨-bundle--跨-script) |
| 伺服器算狀態、交給模板 | [§18.8](#188-ssr請求內-mount--read--dispose) |
| 測生命週期與時間行為 | [§18.9](#189-測試假-application--假-ports) |
| 同頁兩份 singleton 不互相干擾 | [§18.10](#1810-同頁多-application隔離-singleton) |

---

## 18.12 與其它章節的分工

- **動詞總表、掛載選項、依賴選項**：[01-api.md](./01-api.md)
- **生命週期、鉤子順序、暫停與恢復**：[02-lifecycle.md](./02-lifecycle.md)
- **DOM 宿主、作用域鏈、斷線由誰說了算**：[03-dom.md](./03-dom.md)
- **Promise、懶載入、`uses`、等待與取消**：[04-promise-lazy.md](./04-promise-lazy.md)
- **SSR 行為與請求邊界**：[05-ssr.md](./05-ssr.md)
- **Token 字串身分與多 script**：[07-tokens.md](./07-tokens.md)
- **依賴生命週期與值的種類**：[08-injection.md](./08-injection.md)
- **掛載對象、keyed 身分、衝突處理**：[09-mount-host.md](./09-mount-host.md)
- **事件通道與 Context Protocol**：[10-events.md](./10-events.md)
- **Application 邊界、何時該有幾個實例**：[11-composition.md](./11-composition.md)
- **錯誤識別碼（規範源）**：[12-errors.md](./12-errors.md)
- **RxJS 語意、推送時機、去重與完成**：[13-reactivity.md](./13-reactivity.md)
- **ports 職責與 Application 級上限**：[14-ports.md](./14-ports.md)
- **測試分層、假排程器與假 ports、不變式 ID**：[15-testing.md](./15-testing.md)
- **匯出地圖、版本策略與棄用政策**：[16-packaging.md](./16-packaging.md)
- **從舊版線遷移**：[17-migration.md](./17-migration.md)

本章只回答：**這些動詞實際組起來長什麼樣**。語意與邊界由上面各章決定。
