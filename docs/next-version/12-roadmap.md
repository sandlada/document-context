# 12 — 路線圖與範圍 (Roadmap)

## 12.1 v0.1.0 範圍

### P0（交付）

- **分層骨架**：`domain` / `application` / `infrastructure` 三層與四埠（`Host` / `Storage` / `Scheduler` / `ScopeTransport`）。
- **Token 系統**：`defineToken` / `definePrivateToken`；公開 branded string（可序列化、散落可用）與私有 token；強制命名空間與字元規範；Application 實例 registry（SSR per-request 隔離）。詳見 [02b-tokens.md](./02b-tokens.md)。
- **核心 IoC/DI**：提供者（同步 `provideSync` / 非同步 `provide`）；`singleton` / `scoped` / `transient`；lazy / eager（`eager` 於建立期實例化，`mount` 等待）；in-flight Promise coalescing 與拒絕自癒。
- **晚綁定解析**：pending registry（per-Document、DOM-native、WeakRef、微任務批次）；`inject$` / `injectAll$`（冷、resolve-once）、`inject` / `injectAll`（預設無限等待 + `timeoutMs` / `signal`）、`session$(el)`；**取消（AbortSignal）一等公民**（全 async 面與 `mount` 接受 `signal`；多通道冪等）；`injectSync` / `injectAllSync` 收縮為 Session-only；規範性 `context-mount` / `context-dispose` 公共事件。詳見 [09b-late-binding.md](./09b-late-binding.md)。
- **多值集合**：`injectAllSync`（Session 快照）/ `injectAll$`（冷；首次非空後 complete）/ `injectAll`（僅收集 `multi: true`；`bottomUp` 預設 / `topDown`；同 scope 依註冊順序）。
- **RxJS 狀態**：`state$` / `selectSync`（最後快取）/ `select$` / `update`（shallow merge）/ `subscribe$`；`errors$`（初始化緩衝）/ `lifecycle$` / `abort$`。
- **生命週期**：`onMount` / `onDispose` / `onSuspend` / `onResuscitate` / `onAdopt`（正向 FIFO、清理 LIFO）；`attach` 宿主綁定；四維生命週期協調。
- **Keyed Session / 復甦**：`mount(bp, { token })`、token 正規化（與 `defineToken` 共用驗證）、`suspensionTtlMs`、`onConflict`；per-Document `WeakRef` registry；集中式 `MutationObserver` 與微任務重掛檢查。
- **DOM adapter**：`HostPort` 實作；W3C Context Protocol 作用域傳輸；`SchedulerPort` 實作；集中觀察者兼任晚綁定喚醒來源。
- **儲存**：`StoragePort` 契約 + `persist`；localStorage / sessionStorage adapters；跨標籤同步（storage 事件 + 可選 BroadcastChannel / Web Locks；LWW）；水合優先級（儲存 / payload / 種子）與 migration（封裝 `{ v, d }`）。
- **SSR**：載入安全；`ssr` adapter（null host + 假排程器）；水合來源（儲存 / payload / 藍圖種子）；**PayloadResolver 與 `ssrPayload` 選項**；`serialize`（含 JSON 逃逸）。
- **公開 API 補充**：`getSessionSync` / `session$`；`provide` 的 `multi` / `eager` 選項。
- **API 梯隊與同步投影模型**：一等（異步流 / 命令）與二等（`*Sync` 後缀）分級（見 [03-application-api.md](./03-application-api.md) §3.1.1）；同步動詞限縮為熱快照投影實作、可整面移除而不影響核心；parity 測試與移除演練入閘門。
- **錯誤處理**：10 碼錯誤分類學（含 `RESOLUTION_TIMEOUT`）與「致命 / 非致命」對照表（單一事實來源）；`errors$` 沙箱化。
- **TC39 ERM**：`[Symbol.dispose]` / `[Symbol.asyncDispose]`（漸進增強，feature-detect）。

### P1（延後）

- **TC39 Signals 橋接**（原 `toSignal`）。
- **TC39 Stage 3 Decorators**（原 `@provide` / `@inject` / `provideClass`）。
- （可選）框架整合 adapter 擴充。
- **`injectRef` handle**（`status$` / `value$` / `get()` / `resolve()`）與 **`reconnect` 動態重解析**（Provider 離場後回到 pending）。
- **`suspend` / `resuscitate` / `adopt` 原生生命週期事件**（目前由集中觀察者內部處理）。
- 儲存寫入 debounce 選項；`@sandlada/document-context/testing`（契約套件與 fakes 公開）。
- `site/` 文件站重做。

## 12.2 里程碑

| 里程碑 | 內容 | 產出 |
| :--- | :--- | :--- |
| **M0** | 專案骨架、建置、測試環境（分層 projects）、domain/ports 型別、**組合根裝配契約（`ApplicationPorts`）**、Token 系統、錯誤分類學；決策登錄（13）與打包規格（14）生效 | 可 build、可 test 的空核心 |
| **M1** | domain：Blueprint / Session / Scope / Service / eager 狀態機 / 生命週期狀態機 / 純編排 usecases（含 resolve 晚綁定狀態機 pending→ready） | domain 於 node 全綠 |
| **M2** | application：藍圖運算子與柯里化動詞；`getSessionSync` / `session$`、`provide` 選項；fake ports 整合 | application 公共 API 全綠 |
| **M3** | infrastructure/dom：Host adapter、W3C Context Protocol、Scheduler、集中觀察者、`attach`、**晚綁定 pending registry 與 `context-mount` / `context-dispose` 事件** | happy-dom 整合全綠 |
| **M4** | infrastructure/storage：契約、瀏覽器 adapters、同步（LWW）、封裝 `{ v, d }`；`persist` 策略 | 儲存契約測試套件全綠 |
| **M5** | Keyed Session / 復甦、`injectAll` 家族多值、非同步服務自癒、**晚綁定全順序整合** | 生命週期整合全綠 |
| **M6** | SSR：`ssr` adapter、PayloadResolver、水合（儲存 / payload / 種子）、`serialize`（含逃逸） | node SSR 全綠 |
| **M7** | 收尾：typecheck、build、publint / attw / size-limit、遷移文件、範例與 README | 全閘門全綠、可發佈 |

## 12.3 品質閘門

```bash
npm test              # 分層 vitest 全綠（coverage ≥ 90% lines/branches）
npm run typecheck     # tsc --noEmit 無錯
npm run build         # tsdown ESM + .d.ts
npx publint           # 打包正確性
npx attw              # 型別解析
npx size-limit        # 體積預算（見 14-packaging-release.md §14.5）
```

## 12.4 風險與備註

- keyed session / 復甦是複雜度最高處；建議以專門測試套件（微任務重掛、TTL、跨 token、adopt、onConflict 三策略）守護。
- SSR 無閃爍：server 模板以狀態直出 HTML，client 以 payload / storage 水合；模板與狀態的一致性由使用者負責（本庫不做投影，見 [08-projection.md](./08-projection.md)）。
- 跨標籤同步（Web Locks / BroadcastChannel）需在舊瀏覽器有回退路徑（僅 `storage` 事件）；衝突為 LWW。
- domain 零 DOM 依賴是整體架構的守門不變式，務必以 node 環境測試持續驗證。
- `mount` 要求已連線宿主是刻意的嚴格邊界；需於 README 與範例明確溝通（建議於 `connectedCallback` 時機掛載）。
- SSR 不執行 `onMount`；資料載入以 eager providers / `mount` 為契約（見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.7）。
- Closed Shadow DOM 與 MutationObserver 時序需真實瀏覽器 e2e 守護（happy-dom 不足以覆蓋）。
- **晚綁定採 resolve-once（首解即 complete）**：此心智模型需在 README / 範例講清楚；Provider 動態改綁（`reconnect`）列 P1。
- **跨 bundle 喚醒**以「雙 Application 同頁」測試守護；外庫消費者無法被追回的邊界已在 [09b-late-binding.md](./09b-late-binding.md) §9b.8 明示。
- 體積預算（14 §14.5）可能對初期實作造成壓力；超出時優先精簡 application 層。
- **接受笨重（刻意取捨）**：API 雙面性（同步投影＋異步流）增加學習與維護成本；以梯隊政策（D-71）、移除演練（D-72）、文檔主導（D-73）與體積預算控制，並保留「同步面整面移除」的未來路徑。

## 12.5 完成定義（Definition of Done）

1. 三層依賴規則無違逆（以 lint/測試守護）。
2. 所有埠皆有契約測試套件。
3. domain 於 node 環境可載入與執行。
4. 公共 API 全部柯里化 data-last。
5. 品質閘門全綠（§12.3 全部）。
6. `docs/next-version/` 完成並與實作一致；[13-decisions.md](./13-decisions.md) 在 P0 範圍內無未決項。
7. 晚綁定順序無關性（inject×mount 全排列、detached→連線、re-parent、keyed 復甦喚醒）與取消語意（signal / 多通道冪等 / 目標死亡 / mount 清理）測試全綠。
8. 同步動詞僅為投影：parity（同步 / 流一致性）測試與移除演練（stub 同步動詞後核心全綠）通過。
