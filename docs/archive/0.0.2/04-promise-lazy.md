# 04 — Promise 與懶載入

等待用 Promise。會持續變化的東西用 Observable：`state$`、`errors$`、`lifecycle$`、`session$`。`inject$` 是例外：它只是 `inject` 的串流外形，送出一筆就 `complete`。

## 4.1 兩種時間

| 呼叫 | 何時結束 |
| :--- | :--- |
| `mount(...)(host)` | 同步。得到 `Session`，此時通常仍是 `starting` |
| `session.ready` | 水合、eager、首次 `onMount` 都結束；或 keyed 在初始化期間已確認斷線並進入 `suspended` |
| `inject` / `injectAll` | 值準備好，或拒絕 |
| `dispose` | 同步。非同步清理要等 `Symbol.asyncDispose` |

不要為了「立刻拿到會話」再設計一套掛載函式。句柄已經是同步的。

## 4.2 懶載入與 eager

預設 `eager: false`。工廠在第一次 `inject` 時執行。同一個 scoped 或 singleton 的進行中 Promise 只執行一次，後來的 `inject` 等待同一個 Promise。拒絕之後清掉這份快取，下一次 `inject` 可以再試。

`eager: true` 的工廠在水合之後、`onMount` 之前執行。`ready` 等待它們。懶依賴不會因為掛載而啟動。

```mermaid
flowchart TD
    call[inject]
    hit{此生命週期已有值或進行中的 Promise?}
    eager{這次掛載已排進 eager?}
    start[呼叫工廠]
    call --> hit
    hit -->|有| join[等待或回傳該值]
    hit -->|沒有| eager
    eager -->|是| join
    eager -->|否，懶載入第一次| start --> join
```

適合懶載入的例子：只有設定面板打開才需要的客戶端、以 `import()` 拆出去的模組。

```ts
provide(chartToken, async () => {
    const { Chart } = await import('./chart')
    return new Chart()
})
```

適合 eager 的例子：進畫面就必須存在的依賴。伺服器上沒有「晚一點再 inject」的 DOM。依賴與狀態都不會被本庫寫進 HTML；呼叫者在 `ready` 之後自己 `read`。

`transient` 與 `prototype` 每次 `inject` 都呼叫工廠，不參加上面的快取。它的 `uses` 依賴仍只建立一次。見 [08-injection.md](./08-injection.md)。

## 4.3 宣告依賴

```ts
provide(profileToken, async ({ use }) => {
    const http = use(httpToken)
    return http.get('/profile')
}, { uses: [httpToken] })
```

執行期在呼叫工廠之前，依 `uses` 圖把依賴建立好。`use()` 是同步的，拿到的已經是值（對方工廠的 Promise 已被等待）。

圖裡有環：`ready` 拒絕 `CIRCULAR_DEPENDENCY`，環上的工廠不執行。

`uses` 裡的 token 在作用域鏈上解析不到時，`ready` 拒絕 `UNKNOWN_SERVICE`。宣告錯了就是錯了，不會等到永遠——這與 `inject` 的「預設失敗可觀察」一致（見 §4.3 末）。

工廠**不得** `await session.ready`，也不得以元素目標 `inject` 自己這份還在 `starting` 的會話。那會和 `ready` 互相等待。宣告在 `uses` 裡的依賴不需要這樣等。

沒寫進 `uses` 的 `inject` 是動態等待：

- 對方是同一個會話裡已開始的工廠 → 等待它（合併到同一個 Promise）
- 對方是 `Session` 目標且當前祖先裡不存在，且沒有 `{ wait: true }` → 拒絕 `UNKNOWN_SERVICE`
- 對方是元素目標，或顯式 `wait: true` → pending
- 動態等待再繞回自己 → 拒絕 `CIRCULAR_DEPENDENCY`

預設行為是失敗可觀察。無限挂起不是契約。

## 4.4 取消

`inject` 家族不接受 `AbortSignal`，也沒有 `timeoutMs`。再為每次注入配一個 signal，會和會話生命、退訂各走一套時鐘。

| 呼叫還在等 | 怎麼結束 |
| :--- | :--- |
| `inject$` / `injectAll$` | 退訂。`complete()`，不送錯誤 |
| `inject` / `injectAll` | 值到了就 fulfill。目標元素確認斷線，或所屬會話 `abortSignal` abort，就拒絕 |
| 會話上的工廠還在跑 | 跟著該會話的 `abortSignal`。別的 `inject` 還在等同一個 scoped / singleton 時，不因為其中一次退訂而中止工廠 |

`session.abortSignal` 留給會話裡的外部 I/O，例如工廠中的 `fetch`。`MountOptions.signal` 只取消仍在 `starting` 的這次掛載。

節點還在文件裡、只是這一次等待不再需要時，不要對 Promise 做 `Promise.race` 就丟棄：那樣庫內的等待還在。改訂 `inject$`，不需要時退訂。

已經交出去的值留在呼叫者手裡。取消不寫入 `errors$`。

## 4.5 多值（`injectAll` / `injectAll$`）

只有 **`multi: true`** 的註冊會被收集。單值 `inject` / `inject$` 永遠 **nearest-wins**（作用域鏈上最近的一份 `active` 提供者），**沒有** `direction` 選項。若要「最遠那一個」單值，用 `injectAll` 搭配 `direction: 'from-top-to-bottom'` 再取陣列最後一項（或自行選元素）。

```ts
interface InjectAllOptions {
    readonly wait?: boolean
    readonly direction?: 'from-bottom-to-top' | 'from-top-to-bottom'
}
```

| `direction` | 沿作用域鏈的順序 | 預設 |
| :--- | :--- | :--- |
| `from-bottom-to-top` | 由**近**到**遠**（從目標元素向祖先，鏈的「底」→「頂」） | 是 |
| `from-top-to-bottom` | 由**遠**到**近**（祖先 → 目標，鏈的「頂」→「底」） | |

深度沿 **composed 祖先鏈**量：普通父節點與 shadow host（`HostPort.parent`），與 [03-dom.md](./03-dom.md) 的作用域一致。

**同一個宿主**上若有多筆 `multi: true` 註冊，它們在結果陣列裡保持 **藍圖註冊順序**；跨宿主時再按上面的 `direction` 排各宿主的那一組。

```ts
// 祖先 page 與子 card 都 provide multi: true 的 app:plugin
// from-bottom-to-top（預設）→ [card 上的註冊…, page 上的註冊…]
// from-top-to-bottom          → [page 上的註冊…, card 上的註冊…]

await injectAll<Plugin>('app:plugin')(button)
await injectAll<Plugin>('app:plugin', { direction: 'from-top-to-bottom' })(button)
```

`injectAll$` 使用同一組選項；首次得到**非空**陣列後 `complete()`。

**等待與結束**

- 鏈上還沒有任何 `multi` 註冊時，元素目標繼續等（與單值 `inject` 相同的生命週期規則；`wait` 見 [03-dom.md](./03-dom.md) §3.5）。**空集合永不結案**——元素可能在稍後才掛上提供者，代價是呼叫者必須自己退訂。
- `Session` 目標在沒有 `{ wait: true }` 時，空結果就是 `[]`，Promise fulfill，因為這份藍圖不會再長出新的註冊。
- `injectAll$` 與 Promise 版同一規則：`Session` 目標上**立即**以 `[]` 結束；元素目標上則等到首次非空才結束。
- 後來才掛上的多值提供者**不會**回填已經結束的 `injectAll` / `injectAll$`。要跟著時間變，請在新的宿主生命週期裡再呼叫一次。

`InjectOptions`（單值）只有 `wait`，沒有 `direction`。

pending 注入的請求有**上限**（同一 Application 預設 1024，Application 級可調）。超過時新的等待請求以 `PENDING_LIMIT_EXCEEDED` 拒絕，而不是無限累積。見 [12-errors.md](./12-errors.md)、[14-ports.md](./14-ports.md)。

## 4.6 和 `read` 的分工

`read` 不參與懶載入，也不回傳 Promise。它只讀狀態快照。

依賴可能還在建立時，用 `inject`。狀態已經在 `state$` 裡時，用 `read` 或 `subscribe$`。渲染函式若必須同步拿到數字，`await session.ready` 之後再 `read`。
