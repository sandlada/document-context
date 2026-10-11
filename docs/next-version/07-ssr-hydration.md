# 07 — SSR 安全與水合 (SSR & Hydration)

「極致 SSR 安全」有兩個可驗證的層級：**載入安全**（底線）與 **水合契約**（本專案目標）。DOM 投影為非目標（見 [08-projection.md](./08-projection.md)）。

## 7.1 載入安全（Load Safety）

在無 DOM 環境（Node、邊緣 runtime）中：

- `import '@sandlada/document-context/domain'` 與 `createContext` / `pipe` / 各運算子 **100% 不觸碰** `window` / `document` / `localStorage` / `MutationObserver`。
- domain 不引用任何瀏覽器 API；所有宿主、排程、儲存、傳輸皆經埠。
- 因此 domain 可在 Node 環境（node 測試環境）完整單元測試，作為「嚴格解耦」的可執行證據。

```ts
// 可在純 Node 執行
import { createContext, pipe, provide } from '@sandlada/document-context/application'

const blueprint = pipe(
    createContext({ count: 0 }),
    provideSync('logger', () => new ConsoleLogger())
)
// 不涉及任何 DOM
```

## 7.2 Server 端執行模型

Server 端以 **`ssr` adapter**（`infrastructure/ssr`）運行：

- `null-host`：無連線、無事件、無觀察者的 `HostPort` stub（供 server 端以相同 API 掛載）。
- 以 **每請求** `createApplication` 隔離（見 [09-infrastructure.md](./09-infrastructure.md) §9.1）；不建立長駐訂閱、不觸發計時器副作用（假排程器）。
- **不執行 `onMount`**（純水合契約）；資料載入路徑見 §7.7。
- 關鍵字 storage 退化為 null-storage（靜默，見 [06-storage.md](./06-storage.md) §6.2）。
- Session 生命週期 = 渲染範圍；渲染完成後由使用者顯式 `dispose`（`onDispose` 照常執行）。
- **無 DOM 投影**：server 端不產出屬性映射（非目標）；模板由使用者以狀態直出。

## 7.3 水合來源（儲存 / Payload / 種子）

水合來源有三：**storage**（見 [06-storage.md](./06-storage.md)）、**payload**（SSR JSON，可選）、**藍圖種子**（兜底）；優先序由 `persist` 的 `hydration` 策略決定（見 [06-storage.md](./06-storage.md) §6.3）。

Payload 承載「未被儲存覆蓋的狀態」，經 `serialize` 產生：

```ts
import { serialize } from '@sandlada/document-context/infrastructure/ssr'

const payload = serialize(session, {
    // 可選擇要序列化的狀態子集
    select: (s) => ({ count: s.count, user: s.user })
})
// payload id：keyed → `__dc_state:<token>`；匿名 → `__dc_state`
```

```html
<script type="application/json" id="__dc_state:app:cart">{...}</script>
```

- `serialize` **不** 產生 HTML 模板；使用者自行將回傳字串嵌入其模板引擎。
- 序列化輸出必須逃逸 `<`、`>`、`&` 與 U+2028 / U+2029（以 `\uXXXX` 表示），避免 `</script>` 斷出與注入風險。
- Client 由 **PayloadResolver**（`ssr` adapter 裝配）讀取對應 id；`mount({ ssrPayload: 'auto' })`（預設）啟用，未裝配 resolver 時自動退化為 `off`。
- payload 讀取 / 解析失敗 → 視同未提供，安全退化至次順位水合來源（不中斷掛載）。
- 「無閃爍」= 模板直出 HTML 與水合來源（payload / storage）一致；屬性輸出的職責在模板，本庫不代管。

## 7.4 水合決策

- 水合優先序（見 [06-storage.md](./06-storage.md) §6.3；策略 `storageFirst` / `payloadFirst` / `blueprintFirst` / `merge`）決定儲存 / payload / 種子的勝出順序。
- 復甦（resuscitation）時不重跑水合，狀態完整延續（state 勝出）；使用者的自建 DOM 綁定於 `onResuscitate` 重綁（配方見 [08-projection.md](./08-projection.md) §8.2 配方 4）。

## 7.5 Mismatch 策略（已退役）

- 投影為非目標後，不再存在「屬性 vs client 狀態」的比對對象；`MountOptions.hydrationMismatch` 與 `HYDRATION_MISMATCH` 已退役（D-77）。
- 來源衝突由水合優先序解決；payload 損毀安全退化（§7.3）。

## 7.6 與 keyed session 的互動

- keyed Session 的身分（`host.token`）在 SSR 時可序列化為 `data-context-key` 屬性，client 端據此復甦。
- payload id 以 token 為後綴（`__dc_state:<token>`），與身分一一對應。
- 匿名 Session 不做跨端身分延續。

## 7.7 資料載入契約（Server）

- Server **不執行** `onMount`；伺服器端資料載入一律經：
    1. `eager` providers（`mount` 等待完成後才進入 `Mounted`）；或
    2. 使用者於 render 前自行取得，再以 `update` 注入。
- **無晚綁定**：server 端無 DOM 事件與元素消費者；`inject$` / `inject` 的 element 目標等待語意僅存在於瀏覽器。伺服器解析一律以 Session 為目標（`inject(token)(session)` 可等待非同步服務就緒）。
- 這使 server 行為完全由水合 + providers 決定，杜絕隱性副作用。

## 7.8 不變式

1. domain 與 `application` 在無 DOM 環境可安全 import 與執行。
2. `ssr` adapter 不建立長駐訂閱、不觸發計時器副作用、不執行 `onMount`。
3. server 端以模板直出 HTML；client 以儲存 / payload / 種子水合——DOM 表現一致性由使用者負責（本庫不做投影）。
4. `serialize` 只回傳字串，且完成 JSON 逃逸（`<`／`>`／`&`／U+2028／U+2029）。
5. payload 由 PayloadResolver 讀取；解析失敗安全退化；`ssrPayload: 'auto'` 無 resolver 時退化 `off`。
6. server 端不提供 element 目標的晚綁定；`context-mount` / `context-dispose` 僅於瀏覽器 DOM adapter 派發。
