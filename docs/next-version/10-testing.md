# 10 — 測試策略 (Testing)

本專案嚴格遵循 **TDD**，並在分層架構下採用 **分層測試環境** 與 **埠契約測試套件**。

## 10.1 TDD 鐵律

1. **Red**：先寫 `*.test.ts` 描述行為、邊界、錯誤條件與生命週期不變式。
2. **Green**：以最小實作令測試全綠。
3. **Refactor**：重構而不破壞測試。
4. **1:1 同級對應**：每個 `*.ts` 皆有同目錄的 `*.test.ts`（`index.ts` 與純 `.d.ts` 除外）。

## 10.2 分層測試環境

不同層使用不同環境，`domain` 的環境同時是「嚴格解耦」的可執行證明：

| 層 | 環境 | 驗證重點 |
| :--- | :--- | :--- |
| `domain` | **node**（無 DOM） | 純模型、狀態機、純編排；證明零 DOM 依賴 |
| `application` | node + fake ports | 柯里化動詞、藍圖組裝、公共 API 契約 |
| `infrastructure` | **happy-dom** | DOM adapter、W3C 事件、MutationObserver、localStorage |
| 型別 | TS（`expectTypeOf`） | `ServiceRegistry` 注入多載、柯里化簽名、埠契約型別 |
| e2e | 真實瀏覽器（Playwright） | Closed Shadow DOM、MutationObserver 時序、晚綁定喚醒、跨分頁 storage |

```ts
// vitest.config.ts（概念）
export default defineConfig({
    test: {
        projects: [
            { test: { name: 'domain', environment: 'node', include: ['src/domain/**/*.test.ts'] } },
            { test: { name: 'application', environment: 'node', include: ['src/application/**/*.test.ts'] } },
            { test: { name: 'infrastructure', environment: 'happy-dom', include: ['src/infrastructure/**/*.test.ts'] } }
        ]
    }
})
```

> `domain` 若任何測試意外觸碰 DOM，將因環境缺少 `document` 立即失敗——這是最直接的解耦守門員。
> happy-dom 無法忠實模擬 focus / selection / IME / Closed Shadow DOM；這些行為以真實瀏覽器 e2e 煙測守護（見 §10.5）。

## 10.3 埠契約測試套件

為每個埠建立可重用的契約斷言，所有 adapter 共用：

```ts
// src/domain/ports/storage.contract.test.ts（契約）
export function storagePortContract(create: () => StoragePort): void {
    it('read 對不存在鍵回傳 { ok: true, value: null }', () => { /* ... */ })
    it('write 後 read 回傳相同字串', () => { /* ... */ })
    it('remove 後 read 回傳 null', () => { /* ... */ })
    it('不拋例外，錯誤以 StorageResult 表達', () => { /* ... */ })
    it('observe$ 僅外部變更發射，自身寫入不回流', () => { /* ... */ })
}
// infrastructure/storage/local-storage.test.ts
describe('localStorage adapter', () => storagePortContract(() => createLocalStorageAdapter()))
```

同理建立 `hostPortContract`、`schedulerPortContract`、`scopeTransportPortContract`。

## 10.4 Fake ports

`application` 測試以記憶體 fake adapter 驗證編排，不依賴真實 DOM：

```ts
import { createFakeHost, createFakeScheduler, createFakeStorage } from '../testing/fakes'

const session = await mount(blueprint)(createFakeHost())
```

- `src/testing/` 為測試輔助，非公開 API，不需 1:1 測試檔。
- v0.1.0 **不公開** `testing` subpath；契約測試套件先留在 repo（P1 評估公開，見 [13-decisions.md](./13-decisions.md) D-60）。

## 10.5 必測清單（關鍵不變式）

- Blueprint 運算子零副作用、零工廠執行、結構共享。
- Token：驗證規則（字元/命名空間/黑名單）、`defineToken` 冪等、與 keyed 身分共用驗證器。
- `mount`：對同宿主冪等；藍圖首掛為準；未連線宿主 `UNCONNECTED_NODE`；Disposed 後 `update` 回 `false`、`inject` 拋 `DISPOSED_SESSION`；等待期斷開：keyed → `Suspended`（resolve）、匿名 → `Disposed`（reject `UNCONNECTED_NODE`）。
- 身分衝突：`onConflict` 三策略（throw / evict / reset）、同 token 雙活躍 `KEYED_SESSION_CONFLICT`。
- 微任務重掛檢查：拖離再掛不誤殺。
- keyed 復甦：同 token 延續、不同 token 不接管、TTL 逾時銷毀。
- 非同步服務：Promise coalescing、拒絕自癒、`abort$` 級聯取消、`injectSync` 拋 `ASYNC_SERVICE_NOT_READY`。
- eager 服務：建立期實例化；`mountSync` 遇非同步 eager 拋錯；`mount` 等待。
- 晚綁定：inject 先於 mount／mount 先於 inject／並行 script 順序、detached→連線、consumer 被搬移（re-parent）、keyed 復甦喚醒、雙 Application 跨 bundle 喚醒、Shadow DOM composed 事件路徑。
- 晚綁定語意：缺席 = pending（不報錯）；`timeoutMs` → `RESOLUTION_TIMEOUT`；`inject$` / `injectAll$` resolve-once（首次解析後 complete）；只有 Mounted（水合完成）Session 應答。
- 取消（AbortSignal 一等公民）：abort 預設 reason 與自訂 reason；呼叫前已 aborted；多通道競爭冪等（unsubscribe / signal / timeoutMs / 目標死亡先到者勝）；`AbortSignal.any` / `AbortSignal.timeout` 組合；目標 Session 死亡 → `DISPOSED_SESSION`；`mount` 等待期 abort 無洩漏；`session$` abort → complete。
- 同步投影（二等）：parity 測試——值就緒時同步讀等於最新流投影；未就緒時拋（不等待、不阻塞）。
- 移除演練：以 stub 替換同步動詞（`injectSync` / `injectAllSync` / `provideSync` / `selectSync` / `getSessionSync` / `mountSync`）後，核心功能套件仍全綠——證明核心不依賴同步面。
- 無洩漏：pending registry 以 WeakRef 追蹤、無輪詢、無常駐計時器；取消後無殘留計時器 / 監聽。
- `injectAll` / `injectAll$` / `injectAllSync`：僅收集 `multi`、順序（bottomUp/topDown）、同 scope 註冊序；同步快照可為空（0..N），流 / Promise 首次非空才結案。
- 儲存：封裝 `{ v, d }`、毀損/遷移失敗/版本過新降級、外部變更 LWW、dispose flush。
- SSR：domain/application 於 node 環境可 import 與執行；`serialize` 逃逸；PayloadResolver 讀取與失敗降級；server 不執行 `onMount`。
- 生命週期：鉤子先於事件（`onMount` FIFO → `context-mount` → `lifecycle$`）；清理閉包先於 `onDispose`（各自 LIFO）；鉤子例外隔離；`errors$` 初始化緩衝。
- `adoptNode`：Session 保持 `Mounted`；觀察者 / registry 遷移；`onAdopt` FIFO。
- 工廠解析邊界：eager 自引用等待以 `timeoutMs` 收斂為 `RESOLUTION_TIMEOUT`（03 §3.3.1）。
- 快取與可見性：快取命中 `mount` 立即 resolve；`session$` 復甦重發同一物件；`Suspended` 期間同步投影可用、元素目標不可見。
- 零洩漏：`WeakMap`/`WeakRef` 追蹤不產生強引用；Session 銷毀後無活動訂閱。

## 10.6 CI 品質閘門

```bash
npm test              # vitest（分層 projects；coverage ≥ 90% lines/branches）
npm run typecheck     # tsc --noEmit
npm run build         # tsdown（ESM + .d.ts）
npx publint           # 打包正確性
npx attw              # 型別解析（Are The Types Wrong）
npx size-limit        # 體積預算（見 14-packaging-release.md）
```

全綠方為通過。

## 10.7 不變式

1. 任何 `*.ts` 皆有同級 `*.test.ts`。
2. `domain` 測試在無 DOM 環境執行。
3. 每個埠皆有契約測試套件，所有 adapter 共用。
4. 測試不得依賴真實瀏覽器時序（以 fake 排程器確定化）；需要真實時序的行為以 e2e 覆蓋。
5. 公共 API 的型別契約以 `expectTypeOf` 測試守護。
