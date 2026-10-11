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
| 根入口（node） | node（無 DOM） | 根入口與預設裝配在無 DOM 下可 import 不拋（見 §10.5） |

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

> domain 晚綁定狀態機的 M1 整合測試以 fake-transport 合約驗證：`ScopeTransportPort.watch` / `watchAll` + `SchedulerPort.microtask` 為 domain↔infra 唯一 handoff（見 02 §2.6.4）；DOM 喚醒只是可替換的喚醒源之一。

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
- fake-scheduler 為時序確定性的唯一路徑：`timeoutMs`、TTL、儲存批窗口、晚綁定重試批處理一律經 `SchedulerPort`（見 04 §4.7）；`frame` 無 `requestAnimationFrame` 時必須退化為 microtask（見 02 §2.6.3），由 scheduler contract 測試守護。

```ts
import { createFakeScheduler } from '../testing/fakes'

const scheduler = createFakeScheduler()
scheduler.microtask(() => { /* 確定性推進，無真時鐘 */ })
```

## 10.5 必測清單（關鍵不變式）

本節為 checklist，規範源為 02 §2.8（單向指針；02 不指回本節）。

- Blueprint 運算子零副作用、零工廠執行、結構共享（covers 02 #2）。
- Token：驗證規則（字元/命名空間/黑名單）、`defineToken` 冪等、與 keyed 身分共用驗證器。
- `mount`：對同宿主冪等；藍圖首掛為準；未連線宿主 `UNCONNECTED_NODE`；Disposed 後 `update` 回 `false`、`inject` 拋 `DISPOSED_SESSION`；等待期斷開：keyed → `Suspended`（resolve）、匿名 → `Disposed`（reject `UNCONNECTED_NODE`）（covers 02 #7）。
- 身分衝突：`onConflict` 三策略（throw / evict / reset）、同 token 雙活躍 `KEYED_SESSION_CONFLICT`。
- 微任務重掛檢查：拖離再掛不誤殺（covers 02 #3）。
- keyed 復甦：同 token 延續、不同 token 不接管、TTL 逾時銷毀。
- 非同步服務：Promise coalescing、拒絕自癒、`abort$` 級聯取消、`injectSync` 拋 `ASYNC_SERVICE_NOT_READY`（covers 02 #5）。
- eager 服務：建立期實例化；`mountSync` 遇非同步 eager 拋錯；`mount` 等待。
- 晚綁定：inject 先於 mount／mount 先於 inject／並行 script 順序、detached→連線、consumer 被搬移（re-parent）、keyed 復甦喚醒、雙 Application 跨 bundle 喚醒、Shadow DOM composed 事件路徑（covers 02 #10）。
- 晚綁定語意：缺席 = pending（不報錯）；`timeoutMs` → `RESOLUTION_TIMEOUT`；單值首次發射 / 多值首次非空後 complete，空數組永不結案（`single first-emit / multi first-non-empty; empty never settles`）；只有 Mounted（水合完成）Session 應答（covers 02 #10、covers 02 #11）。
- 多值同步免責：`requestAll` / `injectAllSync` 空快照合法；同步空快照不違反 async first-non-empty 規則。
- 晚綁定缺口誠實行：settle 後掛載的新 multi provider 不回填已結案消費者；需持續跟蹤請待 P1 `reconnect`（見 12 §12.1）。
- 取消（AbortSignal 一等公民）：abort 預設 reason 與自訂 reason；呼叫前已 aborted；多通道競爭冪等（unsubscribe / signal / timeoutMs / 目標死亡先到者勝）；`AbortSignal.any` / `AbortSignal.timeout` 組合；目標 Session 死亡 → `DISPOSED_SESSION`；`mount` 等待期 abort 無洩漏；`session$` abort → complete（covers 02 #13）。
- 非同步依賴環（6 列全矩陣）：同步重入拋 `CIRCULAR_DEPENDENCY`；async 自環無 `timeoutMs` 時保持 pending 且無錯；async 自環配 `timeoutMs` 收斂為 `RESOLUTION_TIMEOUT`；多方環 `timeoutMs` 語義一致；同 session 合法 fan-out 雙解皆成功（不得誤判為環）；拒絕後剔除 in-flight 快取可自癒重試。
- 同步投影（二等）：parity 測試——值就緒時同步讀等於最新流投影；未就緒時拋（不等待、不阻塞）（covers 02 #14）。
- 移除演練（Removal drill，covers 02 #14）：seam 為 application 匯出邊界 stub（`injectSync` / `injectAllSync` / `provideSync` / `selectSync` / `getSessionSync` / `mountSync`，或不含 sync chunk 之構建）；suite 為 domain + application 核心套件（infrastructure 同步依賴 recipes 排除並列出）；criterion 為全綠無跳過——證明核心不依賴同步面。演練證明核心不依賴同步面；下游 SSR 渲染與同步工廠替代需 D-71 門控（見 D-112）另行確立。
- 無洩漏：pending registry 以 WeakRef 追蹤、無輪詢、無常駐計時器；取消後無殘留計時器 / 監聽（covers 02 #12）。
- 待決留存與範圍語義：沿 `p1-weakref-hold.mjs` 模式斷言丟使用者引用後 resuscitate 仍得同一對象；shadow / detached / adopted 下 `P.contains(E.host)` 範圍語義測試；回調不得強捕 host / element（僅 token + weak refs + 純量選項）。
- 待決有界：`maxPendingPerDocument` 溢出時 oldest → `RESOLUTION_TIMEOUT`；每批 K 上限、超量鏈式下一個 microtask（FIFO 防餓死）。
- `injectAll` / `injectAll$` / `injectAllSync`：僅收集 `multi`、順序（bottomUp/topDown）、同 scope 註冊序；同步快照可為空（0..N），流 / Promise 首次非空才結案。
- 儲存：封裝 `{ v, d }`、毀損/遷移失敗/版本過新降級、外部變更 LWW、dispose flush。
- 水合順序：fake storage 延遲斷言水合完成前不調任何 eager，完成後 eager 首行讀到水合值（hydration-first）。
- SSR：domain/application 於 node 環境可 import 與執行；根入口 node 下可 import 不拋；adapter 工廠到方法調用前零 DOM / 全局觸碰；`serialize` 逃逸；PayloadResolver 讀取與失敗降級；server 不執行 `onMount`。
- 生命週期：鉤子先於事件（`onMount` FIFO → `context-mount` → `lifecycle$`）；清理閉包先於 `onDispose`（各自 LIFO）；鉤子例外隔離（`onMount` 失敗即 mount 失敗除外）；`errors$` 初始化緩衝。
- `errors$` 溢出與晚訂：滿 32 時丟最舊保最新並計數，首訂附記賬；第二及後續訂閱者僅收訂閱後新事件；從未被訂閱的終態錯誤保留至首訂，仍無人訂閱則經 `reportError`（fake `reportError` 斷言）。
- 單例衝突路由：輸家 mount session 的 `errors$` 在 `mounted` 之前收到 `SINGLETON_CONFLICT`，首訂第一條即該碼。
- `adoptNode`：Session 保持 `Mounted`；觀察者 / registry 遷移；`onAdopt` FIFO。
- 工廠解析邊界：eager 自引用等待以 `timeoutMs` 收斂為 `RESOLUTION_TIMEOUT`（03 §3.3.1）。
- 快取與可見性：快取命中 `mount` 立即 resolve；`session$` 復甦重發同一物件；`Suspended` 期間同步投影（`selectSync` / `injectSync` / `update`）可用、元素目標不可見（`session$` 吐 null）。
- Suspended 留存：弱留存（facade native 弱化，`native()` 取 deref-or-throw）；逐出行（cap 預設 100，oldest-first 經 `lifecycle$ disposed` 可觀測）；pinned 留存行（`retention: 'pinned'` + owner）；teardown 全清行。
- 掛載併發：同 host + token in-flight coalesce（首 blueprint 勝）；窗口內 `mountSync` 拋 `ASYNC_SERVICE_NOT_READY`（`details.phase: 'Initializing'`）；Initializing 可 dispose（顯式拒 `DISPOSED_SESSION`）；同 task 內 abort-check 先於 hydration-settle 交付（兩行：abort-armed-before-flush 即拒；flush-before-abort 即解）。
- 領域時間禁令：domain 不得引入時間算子（`delay` / `debounceTime` / `timeout` / `asyncScheduler`）與裸 `queueMicrotask` / `setTimeout`（lint + node 行為測試雙守衛）。
- scheduler 合約：`frame` 無 `requestAnimationFrame` 時必須退化為 microtask；observer 重檢走 `scheduler.microtask()`。
- 零洩漏：`WeakMap`/`WeakRef` 追蹤不產生強引用；Session 銷毀後無活動訂閱。
- 每個不變式對應至少一個具名測試；缺失即閘門紅燈（見 12 §12.5）。

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
