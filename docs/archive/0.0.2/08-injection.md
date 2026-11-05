# 08 — 注入生命週期與值的種類

`provide` / `inject` 交付的是**任意 JS 值**。工廠可以回傳 record、class（建構函式或實例）、function、symbol、原始型別，或它們的 Promise。本庫不依型別分出另一套注入 API，也不把這些值序列化。

會話狀態（`createContext` / `update`）與依賴（`provide`）是兩條通道。兩者都只存在於會話記憶體。本庫不把它們寫進儲存或 HTML。

## 8.1 三種生命週期

對齊 .NET DI 與 Spring Bean scope。只有三種快取行為。Spring 的 **prototype** 與 .NET 的 **Transient** 是同一種：每次解析新建。文件與選項都接受 `transient` 與 `prototype`，行為相同。

| 選項 | .NET | Spring | 快取 |
| :--- | :--- | :--- | :--- |
| `singleton` | Singleton | singleton | 每個 **Application** 一份（瀏覽器上通常一份 = 一個 Document；伺服器上每個請求一份）。先註冊者勝 |
| `scoped` | Scoped | 自訂 scope（本庫的 scope 是 Session） | 每個 Session 一份。暫停期間保留，銷毀時丟棄 |
| `transient` 或 `prototype` | Transient | prototype | 每次 `inject` 呼叫工廠。不快取實例 |

```ts
provide(httpToken, () => new HttpClient(), { lifecycle: 'singleton' })
provide(draftToken, () => ({ text: '' }), { lifecycle: 'scoped' })
provide(idToken, () => crypto.randomUUID(), { lifecycle: 'transient' })
provide(idToken, () => crypto.randomUUID(), { lifecycle: 'prototype' })
```

預設是 `scoped`。DOM 子樹上的會話就是 scope 邊界：子節點 `inject` 拿到的是祖先鏈上最近那份會話的 scoped 實例，不是整個頁面一份。

`singleton` 不跨 Application 實例，也不活過 SSR 請求。見 [07-tokens.md](./07-tokens.md) §7.2、[14-ports.md](./14-ports.md) §14.6。

`transient` / `prototype` 的 `uses` 依賴仍按它們自己的生命週期建立一次；只有這個工廠本身每次 `inject` 再跑。

進行中的 Promise：`scoped` 與 `singleton` 合併成同一個 Promise。`transient` / `prototype` 不合併，兩次 `inject` 是兩次工廠呼叫。拒絕後，`scoped` / `singleton` 清掉快取，下一次可以重試。

## 8.2 值怎麼交出去

同一 Document、同一 JS realm 裡，跨 script 的 `context-request` 用 **callback 交引用**，不走 structured clone，也不走 JSON。

| 值 | `inject` 得到什麼 | 跨 script 注意 |
| :--- | :--- | :--- |
| record / 陣列 / 原始型別 | 工廠回傳的那個值 | 呼叫者持有的是引用；改動物件會影響快取裡的同一份（`transient` 除外，每次都是新的） |
| function | 函式引用 | 另一支 script 可以直接呼叫。不能靠「同名函式」重新對上 |
| class 建構函式 | 建構函式引用 | `new Ctor()` 在消費端成立。消費端自己 bundle 裡的同名 class **不是**同一個建構函式，`instanceof` 對不上 |
| class 實例 | 實例引用 | 與 record 相同，快取規則看生命週期 |
| symbol | symbol 引用 | 傳的是那一個 symbol。另一支 script 用 `Symbol('x')` 得到的是另一個 symbol。要用名字重建才用 `Symbol.for`，那是呼叫者的選擇，不是本庫的註冊表 |
| `Promise` | `inject` 等到 fulfill 的值 | 工廠回傳 Promise 只表示建立是非同步的，交出去的仍是上面某一種值 |

沒有 `injectClass` / `injectFunction`。型別參數 `T` 就是回傳值的型別。

```ts
const clockToken = defineToken<() => number>('public')('app:clock')
const ctorToken = defineToken<new () => { ping(): void }>('public')('app:worker')
const brandToken = defineToken<symbol>('public')('app:brand')

provide(clockToken, () => () => Date.now(), { lifecycle: 'singleton' })
provide(ctorToken, () => class Worker { ping() {} }, { lifecycle: 'transient' })
provide(brandToken, () => Symbol('brand'), { lifecycle: 'scoped' })

const clock = await inject(clockToken)(element)
const Brand = await inject<symbol>(brandToken)(element)
```

`Symbol('brand')` 放在 `singleton` 或 `scoped` 裡時，所有 `inject` 拿到同一個 symbol。放在 `transient` 裡則每次一個新 symbol。

## 8.3 本庫不碰序列化

function、class、symbol、含方法的實例、含循環參照的圖，都沒有一種本庫能替呼叫者選定的字串格式。因此公共 API 不包含 `persist`、`codec`、`embed`，也不在掛載時讀儲存或 HTML。

呼叫者要保存狀態時，自己訂 `state$` 或 `read`，在庫外轉換並寫入。要還原時，把結果傳進 `createContext` 或在 `starting` 期間 `update`。見 [05-ssr.md](./05-ssr.md)。

`merge` 仍是純函式，給呼叫者在自己的還原邏輯裡合併純物件。它不參與掛載。
