# 08 — 投影：非目標與自行組合食譜 (Projection: Non-Goal & Recipes)

**本庫不做投影，也不做雙向綁定。** 狀態與身分歸本庫；DOM 表現歸使用者。本文件說明非目標的理由，並給出官方替代配方。

## 8.1 非目標（Non-Goal）

- 不提供 `project` / `twoWay`；不提供 locator 詞彙（`dataset.*` / `attr.*` / `class.*` / …）；不提供 `collectAttributes`。
- 不代管任何 DOM 寫入：屬性、class、style、`textContent`、表單值一律由使用者自行設定。
- 不建立任何反向綁定：DOM → 狀態一律由使用者自行監聽 + `update`。
- 歷史：v0.0.1 的 `withBridge`、以及草案階段的 `project` / `twoWay` 設計均廢止（決策見 [13-decisions.md](./13-decisions.md) D-76）。

理由：

1. **職責邊界**：DOM 表現屬視圖層；React / Vue / Lit / 原生各有其渲染模型，庫若自帶投影會與其重疊、並被迫追趕各框架細節。
2. **狀態流已足夠**：`state$` / `select$` / `subscribe$` 提供完整、可組合、可收斂的狀態流；DOM 差異只是訂閱回呼裡的一行。
3. **縮小表面**：不再需要投影安全（XSS sink / URL scheme / style 注入）、IME / 焦點守護與 SSR 屬性軌；維護與測試維度顯著下降。

## 8.2 官方配方

> 全部只使用本庫的流與生命週期契約；`subscribe$` 內建 `takeUntil(session.abort$)` 收斂，無需手動清理。

### 配方 1：狀態 → DOM（粗粒度）

```ts
import { mount, subscribe$ } from '@sandlada/document-context'

const card = document.getElementById('card')!
const session = await mount(blueprint)(card)

subscribe$((s) => {
    card.setAttribute('data-count', String(s.count))
    card.textContent = `計數：${s.count}`
})(session)
```

### 配方 2：狀態 → DOM（細粒度，僅在值變化時寫入）

```ts
import { distinctUntilChanged, map, takeUntil } from 'rxjs'

select$((s) => s.count)(session).pipe(
    map(String),
    distinctUntilChanged(),
    takeUntil(session.abort$)
).subscribe((count) => {
    badge.setAttribute('data-count', count)
})
```

- `select$` 不對值去重（見 [04-reactivity-rxjs.md](./04-reactivity-rxjs.md) §4.2）；細粒度場景請自行組合 `map` / `distinctUntilChanged`，並以 `takeUntil(session.abort$)` 收斂。

### 配方 3：DOM → 狀態（表單輸入）

```ts
onMount((session) => {
    const input = session.host.native() as HTMLInputElement
    const onInput = () => update({ name: input.value })(session)
    input.addEventListener('input', onInput)
    return () => input.removeEventListener('input', onInput)
})
```

- 需要 IME composition 護欄、游標守護等細節時，使用者在此配方上自行擴充——本庫不內建。
- 亦可使用宿主的抽象事件面（`session.host.on(type, fn)` 回傳解除函式；見 [02-domain-model.md](./02-domain-model.md) §2.6.1）。

### 配方 4：復甦後重綁（keyed session）

```ts
onResuscitate((session, host) => {
    // host 已指向新節點；重新讀取原生引用並重建你的 DOM 綁定
    rebind(session, host.native())
})
```

- 本庫不代管 DOM 綁定；Suspended → Resuscitated 後，使用者的自建綁定需自行重綁（`native()` 引用規則見 [02-domain-model.md](./02-domain-model.md) §2.3）。

## 8.3 常見問答

- **為什麼沒有 `withBridge`？** v0.0.1 的 DSL 與後續草案的 `project` / `twoWay` 一併廢止：投影屬視圖層職責，見 §8.1。
- **SSR 的「無閃爍」怎麼辦？** 模板直出 HTML + payload / storage 水合（見 [07-ssr-hydration.md](./07-ssr-hydration.md)）；本庫不再比對屬性。
- **高頻 DOM 更新怎麼辦？** 配方 2 + 自行排程（例如 `requestAnimationFrame` 合併）；本庫不代管 DOM 寫入節奏。

## 8.4 不變式

1. 本庫不提供任何 DOM 寫入或投影 API。
2. 狀態流與生命週期收斂由串流契約保證（`takeUntil(abort$)` / `subscribe$`）。
3. DOM 表現的產生、更新與 IME / 焦點 / 安全細節，全部由使用者負責。
