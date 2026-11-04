# 07 — SSR 安全與水合 (SSR & Hydration)

「極致 SSR 安全」有兩個可驗證的層級：**載入安全**（底線）與 **水合契約**（本專案目標）。DOM 投影為非目標（見 [08-projection.md](./08-projection.md)）。

## 7.1 載入安全（Load Safety）

在無 DOM 環境（Node、邊緣 runtime）中：

- `import '@sandlada/document-context/domain'` 與 `createContext` / `pipe` / 各運算子 **100% 不觸碰** `window` / `document` / `localStorage` / `MutationObserver`。
- domain 不引用任何瀏覽器 API；所有宿主、排程、儲存、傳輸皆經埠。
- application 層不做任何 `HTMLElement` 嗅探，委派給注入的 adapter（`host.toHost(node)`）；SSR 用 ssr 或 null-host（見 §7.2）。
- 因此 domain 可在 Node 環境（node 測試環境）完整單元測試，作為「嚴格解耦」的可執行證據。

```ts
// 可在純 Node 執行
import { createContext, defineToken, pipe, provideSync } from '@sandlada/document-context/application'

class ConsoleLogger {}

const loggerToken = defineToken<ConsoleLogger>('app:logger')

const blueprint = pipe(
    createContext({ count: 0 }),
    provideSync(loggerToken, () => new ConsoleLogger())
)
// 不涉及任何 DOM
```

## 7.2 Server 端執行模型

Server 端以 **`ssr` adapter**（`infrastructure/ssr`）運行：

- `null-host`：無連線、無事件、無觀察者的 `HostPort` stub（供 server 端以相同 API 掛載）。
- 以 **每請求** `createApplication` 隔離（見 [09-infrastructure.md](./09-infrastructure.md) §9.1）；per-request Application 擁有 `Map<token-string, 單例>` 加 keyed 表（「Document 鍵」換成 Application 實例本身）；單例按請求（按 Application 實例），永不跨請求共享。不建立長駐訂閱、不觸發計時器副作用（假排程器）。
- **不執行 `onMount`**（純水合契約）；資料載入路徑見 §7.7。
- 關鍵字 storage 退化為 null-storage（靜默，見 [06-storage.md](./06-storage.md) §6.2）。
- Session 生命週期為渲染範圍；渲染完成後由使用者顯式 `dispose`（`onDispose` 照常執行）；未釋放請求以顯式 dispose 合約加安全掃蕩兜底（見 [09-infrastructure.md](./09-infrastructure.md) §9.7）。
- **無 DOM 投影**：server 端不產出屬性映射（非目標）；模板由使用者以狀態直出。

## 7.3 水合來源（儲存 / Payload / 種子）

水合來源有三：**storage**（見 [06-storage.md](./06-storage.md)）、**payload**（SSR JSON，可選）、**藍圖種子**（兜底）；優先序由 `persist` 的 `hydration` 策略決定（見 [06-storage.md](./06-storage.md) §6.3）。

Payload 承載「未被儲存覆蓋的狀態」，經 `serialize` 產生（curried：`serialize(opts?)(session)`；`select` 缺省為全量）：

```ts
import { serialize } from '@sandlada/document-context/infrastructure/ssr'

const payload = serialize({
    // 可選擇要序列化的狀態子集
    select: (s: { count: number, user: unknown }) => ({ count: s.count, user: s.user })
})(session)
// payload id：keyed → `__dc_state:<token>`；匿名 → `__dc_state`
```

```html
<script type="application/json" id="__dc_state:app:cart">{...}</script>
```

- `serialize` **不** 產生 HTML 模板；使用者自行將回傳字串嵌入其模板引擎。
- 序列化輸出必須逃逸 `<`、`>`、`&` 與 U+2028 / U+2029（以 `\uXXXX` 表示），避免 `</script>` 斷出與注入風險。
- Client 由 **PayloadResolver**（`ssr` adapter 裝配）讀取對應 id；`mount({ ssrPayload: 'auto' })`（預設）啟用，未裝配 resolver 時自動退化為 `off`。
- payload 讀取 / 解析失敗 → 視同未提供，安全退化至次順位水合來源（不中斷掛載）。
- 部分 payload 空洞下探（消費者側）：payload 缺鍵下探 storage 再下探種子（見 06 §6.3 管線）；子集 `serialize(select)` 不刪鍵。
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
- 序列化身分為一等喚醒輸入：外部寫入的 key 變更入列重估，自致回寫被過濾（見 05 §5.5）。
- 匿名 Session 不做跨端身分延續。

## 7.7 資料載入契約（Server）

- Server **不執行** `onMount`；伺服器端資料載入一律經：
    1. `eager` providers（先完成水合再實例化 eager，`mount` 等待完成後才進入 `Mounted`）；或
    2. 使用者於 render 前自行取得，再以 `update` 注入。
- **server 無 element-target late binding**；Session-target server 等待僅限同 session in-flight，祖先喚醒 N/A（見 [09-infrastructure.md](./09-infrastructure.md) §9.7 與 [09b-late-binding.md](./09b-late-binding.md) §9b.8 互鏈）。server Session-target 只等同 session 訂閱時已 InFlight 的項；真缺席在 ssr adapter 下 fast-reject `UNKNOWN_SERVICE`（「訂閱時 InFlight」邊界以 03 §3.3.1 為準）。
- 這使 server 行為完全由水合 + providers 決定，杜絕隱性副作用。

**標準 server 片段**（5 行，命名空間 token，`await` 序列）：

```ts
import { createContext, defineToken, inject, mount, pipe } from '@sandlada/document-context/application'
import { nullHost, serialize } from '@sandlada/document-context/infrastructure/ssr'

interface User { readonly name: string }

const bp = pipe(createContext({ count: 0 }))
const userToken = defineToken<User>('app:user')
const session = await mount(bp)(nullHost)
const user = await inject(userToken)(session)
const payload = serialize()(session)
```

## 7.8 不變式

1. domain 與 `application` 在無 DOM 環境可安全 import 與執行（application 層不嗅探 `HTMLElement`，見 §7.1）。
2. `ssr` adapter 不建立長駐訂閱、不觸發計時器副作用、不執行 `onMount`。
3. server 端以模板直出 HTML；client 以儲存 / payload / 種子水合——DOM 表現一致性由使用者負責（本庫不做投影）。
4. `serialize` 為 curried（`serialize(opts?)(session)`，`select` 缺省全量），只回傳字串，且完成 JSON 逃逸（`<`／`>`／`&`／U+2028／U+2029）。
5. payload 由 PayloadResolver 讀取；解析失敗安全退化；`ssrPayload: 'auto'` 無 resolver 時退化 `off`。
6. server 端不提供 element-target 的晚綁定（Session-target 僅同 session in-flight 才等，真缺席 fast-reject）；`context-mount` / `context-dispose` 僅於瀏覽器 DOM adapter 派發。
7. 單例與 keyed 身分按請求隔離（按 Application 實例），永不跨請求共享；渲染後顯式 `dispose`（見 §7.2）。
