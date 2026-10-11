# 11 — 遷移指引 (Migration from v0.0.1)

v0.1.0 是 **greenfield 全刪重寫**，最大力度支持破壞性變更。本文件列出必須調整的面向。

## 11.1 子包（subpath）變更

按功能改為 **按層**：

| v0.0.1 | v0.1.0 |
| :--- | :--- |
| `@sandlada/document-context/core` | `@sandlada/document-context/application`（或根入口 `.`） |
| `@sandlada/document-context/bridge` | **已移除**（非目標；無替代 API；配方見 [08-projection.md](./08-projection.md)） |
| `@sandlada/document-context/storage` | `@sandlada/document-context/infrastructure/storage` |
| `@sandlada/document-context/dom` | `@sandlada/document-context/infrastructure/dom` |
| `@sandlada/document-context/signals` | 已移除（延後至 P1） |
| （新增） | `@sandlada/document-context/domain`（埠與 model 型別） |
| （新增） | `@sandlada/document-context/infrastructure/ssr` |

> 根入口 `.` re-export application 公共 API，且已裝配預設 DOM adapter，一般使用只需根入口。

## 11.2 API 命名對照

| v0.0.1 | v0.1.0 | 備註 |
| :--- | :--- | :--- |
| `withProvider(token, factory, opts)` | `provideSync(token, factory, opts)` | 去 `with-` 前綴；同步工廠＝二等（`Sync` 後缀） |
| `withAsyncProvider(...)` | `provide(...)` | 去 `with-` 前綴；非同步工廠＝一等默認 |
| `withHook('mount', fn)` | `onMount(fn)` | 具名鉤子 |
| `withHook('dispose', fn)` | `onDispose(fn)` | |
| `withHook('suspend', fn)` | `onSuspend(fn)` | |
| `withHook('resuscitate', fn)` | `onResuscitate(fn)` | |
| `withHook('adopt', fn)` | `onAdopt(fn)` | |
| `withStorage(opts)` | `persist(opts)` | 契約與策略改版，見下 |
| `withBridge(opts)` | **已移除**（非目標；無替代 API） | 狀態 → DOM 由使用者以 `subscribe$` / `select$` + DOM API 自行組合（見 08） |
| `subscribe(listener)(session)` | `subscribe$(listener)(session)` | 回傳 `Subscription` |
| `readErrorStream(session)` | `session.errors$` | 串流屬性 |
| `mount(bp, { key })` / `session.key` | `mount(bp, { token })` / `session.token` | 身分詞彙統一為 token |
| `mount(bp)(el)`（同步）/ `mountAsync(bp)(el)` | `mount(bp)(el)`（非同步・默認，`Promise<Session>`）／`mountSync`（同步投影・二等） | 命名收編：去 `Async` 後缀、同步加 `Sync` |
| `inject(token)(element)` | `inject$(token)(element)`（流）/ `inject(token)(element)`（Promise） | 元素目標改晚綁定：缺席 = pending、順序無關 |
| `inject(token)(session)` / `select` | `injectSync` / `selectSync`（同步投影・二等） | 同步面加 `Sync` 後缀 |
| `injectAsync(token)(element)` / `injectAllAsync(...)` | `inject` / `injectAll`（名稱去 `Async` 後缀） | 預設無限等待；可選 `timeoutMs` / `signal` |
| `injectAll`（舊同步版） | `injectAllSync` | 同步投影・二等；`injectAll$` 首次非空後 complete |
| （無） | `session$` / `getSessionSync` | 追蹤最近已 Mounted Session：熱流 / 同步快照 |
| （無） | `update` / `dispose` / `createContext` / `pipe` | 不變（命令與建構子不帶後缀） |

新增：`select$`、`inject$` / `injectAll$`（晚綁定流；缺席 = pending）、`session$`（熱流）、`attach`、`defineToken`、`definePrivateToken`、`getSessionSync`、`provide` 的 `multi` / `eager` 選項。

> 裸 `Infinity`（`suspensionTtlMs: Infinity`）遷移：v0.1.0 起須配 `retention: 'pinned'` 並具名 owner，否則拋配置錯（見 05 §5.5）。

**命名公約**（見 [13-decisions.md](./13-decisions.md) §13.13）：異步一等**無 `Async` 後缀**（`injectAsync` → `inject`、`mountAsync` → `mount`、`provideAsync` → `provide`）；同步二等**必帶 `Sync` 後缀**（`injectSync` / `injectAllSync` / `provideSync` / `selectSync` / `getSessionSync` / `mountSync`）——不列入穩定契約，隨時可能移除，新程式碼請使用異步對應。取消為一等公民：全 async 解析 API 與 `mount` 皆接受 `signal`（可選 `timeoutMs`）。

> 舊資產（`DESIGN.md`、`docs/core-concepts.md` 等）於 v0.1.0 發佈時移入 `docs/archive/`；詳見 [14-packaging-release.md](./14-packaging-release.md) §14.8。

## 11.3 響應式模型變更

- RxJS 從 **選用** 升為 **強制** dependency（`peerDependencies` 移除 optional 設定）。
- 狀態以 `session.state$`（熱 Observable）為第一公民。
- 新增 `session.lifecycle$`、`session.abort$`、`session.errors$`。
- 所有內部訂閱以 `takeUntil(session.abort$)` 收斂。

## 11.4 儲存模型變更

- 舊 `withStorage` 的內建策略拆解：核心只留 `StoragePort` 契約 + `persist`；策略上移 application。
- 契約 **不拋例外**，回傳 `StorageResult<T>`；支援 `MaybePromise`。
- adapter 只處理 `string`；序列化在 application。
- `observe$` 僅外部變更（自身寫入不回流）。
- `domFirst` / 草案的 `projectionFirst` 均廢止——投影為非目標（見 [08-projection.md](./08-projection.md)）；「以 payload 為先」的新名為 `payloadFirst`。

## 11.5 投影移除（非目標）

- v0.0.1 的 `withBridge` DSL **直接刪除**，且不提供替代 API：草案中的 `project` / `twoWay` 一併廢止（見 [08-projection.md](./08-projection.md)）。
- 狀態 → DOM：改用 `subscribe$` / `select$` + DOM API 自行組合（官方配方見 08 §8.2）。
- DOM → 狀態：改用 `addEventListener`（或 `session.host.on`）+ `update`。
- SSR：屬性投影軌與 `collectAttributes` 移除；水合以儲存 / payload / 藍圖種子為來源（見 [07-ssr-hydration.md](./07-ssr-hydration.md)）。

## 11.6 宿主綁定變更

- 舊 `withHook` + 手動 `inject` 的模式，改為 `attach(config)(session)` 回傳 `{ connect, disconnect, adopt }`，由宿主轉發。
- **不引入 LitJS**，僅參考其生命週期回調設計。

## 11.7 型別與架構變更

- domain 不再直接暴露 `HTMLElement`；`Session<Host>` 泛型預設由公共 API 綁為 `HTMLElement`。
- `ISession` 更名/重塑為 `Session`；`IContextBlueprint` → `ContextBlueprint`（去除 `I` 前綴）。
- 進階使用者可自 `/domain` 取得埠契約實作自訂 adapter。
- 舊 `registerKeyedSession`（已在 v0.0.1 移除）等 API 一律不存在。

### 11.7.1 Token 系統（新增）

- 舊 `ServiceToken<T>`（symbol/object branding）與寬鬆的 `Token = string | symbol | object` 改為明確的公開 / 私有二分（見 [02b-tokens.md](./02b-tokens.md)）。
- 公開 token 為 branded string、強制命名空間 `namespace:name`、字元規範與黑名單一律 `throw`；私有 token 為 frozen 物件、不可序列化。
- keyed 身分由 `key` 改為 `token`，且強制為可序列化公開 token。
- registry 由 module 全域移至 Application 實例（瀏覽器 per-Document、SSR per-request）。

## 11.8 移除項

- `withBridge` 及整個投影 DSL；`project` / `twoWay` 不提供（非目標）。
- `toSignal` 與 TC39 signals 整合（延後至 P1）。
- `@provide` / `@inject` / `provideClass` 裝飾器（延後至 P1）。
- 所有 `with-` 前綴運算子。

## 11.9 建議遷移步驟

1. 更新 import 至根入口或 `/application`。
2. 全域替換命名（見 11.2，含命名公約：`Async` 去後缀、同步加 `Sync`）。
3. 元素上的 `inject(token)(element)` 改寫為 `inject$`（串流）或 `inject`（Promise，見修好的 flagship 與 03 §3.3.1）；`mount` 後已持有 Session 的場景可過渡用 `injectSync`（同步投影・二等・`@deprecated`・interim，新程式碼請用 `inject(session)` / `inject$(target)`，`0.2.0` 移除見 12 §12.1）。
4. `mount(...)` 改為 `await mount(...)`（非同步默認，見 03 §3.3）；需要立即 Session 時可過渡用 `mountSync`（同步投影・二等・`@deprecated`・interim，`0.2.0` 移除見 12 §12.1）。
5. `withBridge` 直接刪除；以官方配方（08 §8.2）改用 `subscribe$` / `select$` + DOM API。
6. `readErrorStream(s)` → `s.errors$`。
7. `withStorage` → `persist`，檢視 hydration/version/migrate 選項。
8. 若使用 Lit/框架組件，接入 `attach` 鉤子。
9. 若依賴 signals/decorators，暫留於 P1 或改用 RxJS/手動注入。
