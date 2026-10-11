# 13 — 決策登錄 (Decision Register)

本文件是 `docs/next-version/` 的 **單一事實來源（single source of truth）** 決策清單：凡藍圖文件之間的取捨、未定選項與勘誤，一律在此拍板並回寫正文。日後變更決策需新開編號（不覆寫歷史）。

編號規則：`D-nn` 穩定不重用；「落地」指出正文中的規範位置。

## 13.1 勘誤修正（正文一致性）

- **D-01（`MountOptions.hydrationMismatch`）** 補上 `hydrationMismatch?: 'reconcile' | 'throw'`（預設 `'reconcile'`），與 07 §7.5 一致。落地：03 §3.3、07 §7.5。（後續修訂：D-77——`hydrationMismatch` 隨投影退役。）
- **D-02（`Session.abortSignal`）** Session 介面補 `abortSignal: AbortSignal`，與 `abort$` 同源（銷毀即時 abort）。落地：02 §2.3、05 §5.3。
- **D-03（錯誤分類學）** 補 `TOKEN_INVALID`、`UNRESOLVED_SESSION`、`SINGLETON_CONFLICT`、`PROJECTION_RULE_INVALID`；移除 `KEYED_BLUEPRINT_MISMATCH`（執行期不做藍圖引用比對）。以「代碼 → 觸發 → 致命性」表為單一事實來源。落地：02 §2.7、04 §4.6。（後續修訂：D-64、D-79。）
- **D-04（`LifecycleEvent`）** 定義 union：`mounted` / `suspended` / `resuscitated` / `adopted{owner}` / `disposed`。落地：02 §2.3。
- **D-05（multi 註冊）** 提供 `provide`（非同步工廠）/ `provideSync`（同步工廠）的 `{ multi: true }`；`multi` 註冊累加、僅 `injectAll*` 可解析；僅有 multi 的 token 被單值 `inject` / `injectSync` 時拋 `UNKNOWN_SERVICE`。落地：02 §2.1、03 §3.2/§3.3.1。
- **D-06（eager）** 提供 `eager?: boolean`（預設 false）；建立期（`onMount` 前）實例化；`mountSync` 遇非同步 eager 拋 `ASYNC_SERVICE_NOT_READY`。落地：02 §2.1、03 §3.2。
- **D-07（服務型別策略）** 不做跨運算子服務型別累積推導；`ContextBlueprint<S>` 不擴充；型別事實來源為 `ServiceRegistry` + `ServiceToken<T>`。移除 `pipe` 的「精確推導累積服務型別」措辭與未用的 `Existing` 泛型。落地：03 §3.2。
- **D-08（`Session.host` 穩定代理）** `host` 為 facade，復甦時換向新宿主；`native()` 於 Suspended 指向舊節點、復甦後指向新節點；跨復甦的原生引用一律重讀。落地：02 §2.3、05 §5.1。
- **D-09（`dispose` 兩相）** 同步階段：`abort$` 即時發射、store 毒化、監聽解除、同步清理 LIFO；非同步清理 fire-and-forget；`[Symbol.asyncDispose]` 等待結算；`errors$` 於結算後 `complete()`（唯一延後 complete 的串流）。落地：03 §3.3、04 §4.1/§4.7。（組間順序補遺：D-84——清理閉包先、`onDispose` 後。）
- **D-10（`mount` 等待清單）** 等待「非同步儲存水合 + eager 服務」完成後才進入 `Mounted` 並 resolve。落地：03 §3.3、06 §6.3。
- **D-11（ScopeTransport 非同步與 multi）** `ScopeResolution.value` 允許 `MaybePromise<T>`；`requestAll` 回傳 0..N 筆（不外拋 null）；`bottomUp` 預設（近→遠）、`topDown`（遠→近）。落地：02 §2.6.4。（後續追加：D-63 增加 `watch` / `watchAll` 晚綁定通道。）
- **D-12（同步注入非同步服務）** 一律拋 `ASYNC_SERVICE_NOT_READY`（改用 `inject` 或 `eager` + `mount`）。落地：03 §3.3.1、04 §4.3。

## 13.2 生命週期與會話

- **D-13（`mount` 幂等粒度）** 同宿主同身分（皆匿名或同 token）重複 `mount` / `mountSync` 回傳快取；**藍圖以首次掛載為準**，不做引用比對；替換藍圖 = `dispose` 後重掛。
- **D-14（`onConflict` 策略）** 身分衝突（同宿主不同 token、同 token 雙活躍、`options.token` 與 `data-context-key` 矛盾）依 `onConflict`：`throw`（預設，`KEYED_SESSION_CONFLICT`）/ `evict`（處置舊者後掛新者）/ `reset`（舊狀態作新 seed，供 HMR）。同 token 雙活躍一律 `throw`。落地：05 §5.5、02b §2b.9。
- **D-15（復甦語意）** 同 token 不同宿主且原 Session 在 `Suspended` TTL 內 → 復甦；**沿用原藍圖**；狀態完整延續（state 勝出，不重跑水合）。落地：05 §5.5。（措辭修訂：D-76——「全量重新投影」不再適用；DOM 綁定由使用者自管。）
- **D-16（mount 連線要求）** DOM 組合下 `mount` / `mountSync` 要求宿主已連線（`UNCONNECTED_NODE`；建議 `connectedCallback` 時機）；`ssr` 組合不受限。（等待期斷開語意：D-82。）
- **D-17（keyed token 正規化）** 來源 `options.token` > `data-context-key`；與 `defineToken` 共用驗證器（`TOKEN_INVALID`）；keyed mount 補寫屬性；最終 Disposed 且值相符時移除。落地：05 §5.5、02b §2b.4/§2b.9。
- **D-18（registry 與 adoptNode）** registry per-Document；`adoptNode` 時 Session 與 registry 條目遷移至新 Document；跨 Document 復甦不支援。
- **D-19（attach 與觀察者雙通道）** 兩通道冪等收斂（後到者 no-op），順序不保證；狀態轉換本身冪等。落地：05 §5.4、09 §9.4。
- **D-20（TTL 節流明示）** 背景分頁計時器可能被節流；TTL 只保證「不早於」設定時間觸發。落地：05 §5.5。

## 13.3 IoC 與 Token

- **D-21（預設 lifecycle）** `provide` 預設 `'scoped'`。落地：02 §2.1、03 §3.2。
- **D-22（同 token 註冊語意）** 單值後者覆蓋；multi 累加；`injectAll` 排序見 D-11；同 scope 內依註冊順序。
- **D-23（singleton 衝突）** 同 Document 首個註冊者勝出；後續聲明忽略並推 `SINGLETON_CONFLICT`（非致命）。落地：02 §2.4。
- **D-24（`getSessionSync`）** 新增公開 API：沿 `element` 祖先鏈回傳最近已掛載 Session（無則 `null`）。落地：03 §3.1/§3.3。（命名修訂：D-75——原名 `getSession`。）
- **D-25（解析錯誤界定）** 找不到 Session → `UNRESOLVED_SESSION`；Session 存在但 token 無註冊 → `UNKNOWN_SERVICE`；Disposed Session 的 `inject*` → `DISPOSED_SESSION`（其餘動詞降級見 D-09 與 03 §3.5）。落地：02 §2.7。（後續修訂：D-61～D-62、D-64——元素目標改晚綁定，`UNRESOLVED_SESSION` 退役。）
- **D-26（私有 token 邊界）** 私有 token 不可序列化、不得作 keyed 身分；序列化路徑遇到即拒（`TOKEN_INVALID`）。落地：02b §2b.6。
- **D-27（`defineToken` 驗證式單參）** 維持 Q20 A 決策：純函式、冪等、runtime 驗證式單參名。落地：02b §2b.3。
- **D-28（跨 Application 共享）** 同頁多 Application 共享 W3C 事件為刻意特性（跨 bundle 公共契約）；隔離以 token 命名空間達成，不做 app 級事件隔離。落地：02b §2b.10。

## 13.4 反應式與錯誤

- **D-29（`errors$` 初始化緩衝）** 初始化期錯誤緩衝（≤ 32 筆），首次訂閱排空後轉純熱流；不完整重播。落地：02 §2.8、04 §4.1。
- **D-30（致命/非致命單一事實來源）** 02 §2.7 對照表；其他章節只引用不複列。
- **D-31（selectSync / select$ 語意）** `selectSync` 快取最後一次 `(state, result)`；`select$` 不過濾（使用者自行 `distinctUntilChanged`）。落地：04 §4.2。
- **D-32（update 合併語意）** 一律 shallow merge；物件展開（CreateDataProperty）語意，禁 `Object.assign`；不深合併、不刪鍵。落地：02 §2.8 #8、04 §4.2。
- **D-33（狀態形狀）** 狀態根限 plain object（`Record<PropertyKey, unknown>` 約束維持）；需持久化的狀態應為 JSON-safe。落地：02 §2.1。

## 13.5 投影（已廢止——見 §13.14）

> 以下 D-34～D-39 隨 **D-76（投影非目標）** 整節廢止，保留作歷史記錄。

- **D-34（無 DSL；單向優先）** 維持 Q13 / Q23：`project` 單向、last-wins（同 locator 後者覆蓋）、規則依陣列順序；`twoWay` 為 opt-in 表單 helper。落地：08 §8.1/§8.2。
- **D-35（值語意）** `undefined` = 跳過；`null` = 移除（僅 `dataset.*` / `attr.*` / `class.*` / `style.*`）。落地：08 §8.2。
- **D-36（observe 事件映射）** 表單 props → `input`/`change`；其餘白名單 locator → `MutationObserver`；其他 `prop.*` 不支援（`PROJECTION_RULE_INVALID`）。落地：08 §8.5。
- **D-37（twoWay 範圍與 IME）** 限 `value` / `checked`；必要 IME composition 護欄（compositionstart 暫停、compositionend 補寫）與焦點游標守護；radio group / select multiple 列 P1（附手動配方）。落地：08 §8.6/§8.7。
- **D-38（投影安全擴充）** URL 型屬性 scheme 白名單（`http`/`https`/`mailto`/`tel`/相對/`#`）；style 值拒絕 `url(` / `expression(` / `javascript:`；規則驗證期致命、寫入期非致命。落地：08 §8.8。
- **D-39（`PROJECTION_RULE_INVALID`）** 空 locator、未知前綴 → mount 期致命。落地：08 §8.2/§8.8、02 §2.7。

## 13.6 儲存

- **D-40（封裝格式）** `{ "v": number, "d": unknown }`；`version` 缺省 = 0。落地：06 §6.4。
- **D-41（版本比對）** `v === version` 採用；`v <` → `migrate`（失敗降級）；`v >` → 不採用、**不覆寫**、報 `INVALID_STORAGE_DATA`。落地：06 §6.4。
- **D-42（寫入節奏）** 微任務批次合併；`dispose` 時同步 adapter 立即 flush；非同步 adapter best-effort；頁面卸載不另設 flush。落地：06 §6.5/§6.7。
- **D-43（跨標籤衝突）** LWW 整快照替換；Web Locks 僅序列化寫入；不做 rebase / CRDT（自訂 `StoragePort`）。落地：06 §6.5。
- **D-44（關鍵字解析）** Application storage registry；未註冊關鍵字 → `UNKNOWN_SERVICE`；SSR / 無 `window` 以 null-storage 靜默降級。落地：06 §6.2、09 §9.1/§9.6。
- **D-45（水合優先級含 payload）** storageFirst：儲存 > payload > 投影 > 藍圖；projectionFirst：投影 > payload > 儲存 > 藍圖；blueprintFirst：藍圖 > 儲存 > payload > 投影；merge：藍圖 → 儲存 → payload → 投影（淺合併）。落地：06 §6.3。（後續修訂：D-77——投影軌移除；`projectionFirst` 更名 `payloadFirst`。）

## 13.7 SSR

- **D-46（`collectAttributes`）** server 端投影輸出 API：null-host 記錄投影 frame，具體化為屬性映射（dataset/attr/id/class/style；`text` 不參與）。落地：07 §7.3、09 §9.7。（後續修訂：D-77——`collectAttributes` 退役。）
- **D-47（payload id 與讀取）** `__dc_state:<token>`（keyed）／`__dc_state`（匿名）；client 由 PayloadResolver 讀取；`mount({ ssrPayload: 'auto' | 'off' })` 預設 auto（無 resolver 時退化 off）。落地：07 §7.3/§7.4。
- **D-48（JSON 逃逸）** `<`、`>`、`&`、U+2028/U+2029 以 `\uXXXX` 轉義。落地：07 §7.3。
- **D-49（SSR 不執行 onMount）** 純水合契約；資料載入以 eager providers / `mount` 或 render 前自行取得。`onDispose` 照常。落地：07 §7.7。
- **D-50（per-request Application）** 根入口單例僅供瀏覽器；SSR 每請求 `createApplication`。落地：09 §9.1、02b §2b.7。
- **D-51（mismatch 策略值）** `reconcile`（預設，client 勝出 + 回報）／`throw`（dev）。落地：07 §7.5。（後續修訂：D-77——mismatch 隨投影退役。）

## 13.8 打包、工具鏈與流程

- **D-52（RxJS 依賴）** 必要 `peerDependencies`：`"rxjs": "^7.8.0 || ^8.0.0"`；不 bundle；devDependency 供測試。落地：14 §14.1。
- **D-53（exports 條件）** 每個子入口補 `types` / `import` / `default`；`./package.json` 匯出；`"type": "module"`、`"sideEffects": false`。落地：14 §14.2。
- **D-54（瀏覽器基線）** Baseline 2023；`WeakRef` / `FinalizationRegistry` 為硬需求；ERM 漸進增強（feature-detect）；BroadcastChannel / Web Locks 可選降級。落地：14 §14.3。
- **D-55（TS 基線）** 型別層 ≥ TS 5.2；建議 `lib: ES2022 + DOM`（使用 `using` 加 `ESNext.Disposable`）。落地：14 §14.4。
- **D-56（體積預算）** 根入口 ≤ 15 kB gzip（不含 RxJS）；全子入口合計 ≤ 25 kB；CI 以 size-limit 檢核。落地：14 §14.5。
- **D-57（CI 閘門）** test（coverage ≥ 90%）/ typecheck / build / publint / attw / size-limit；GitHub Actions、Node 22。落地：14 §14.6、10 §10.6。
- **D-58（發佈流程）** 手動 semver + `CHANGELOG.md`（Keep a Changelog）+ tag + `npm publish --provenance`；0.x 期 minor 可含 BREAKING（標註）。落地：14 §14.7。
- **D-59（舊資產處置）** `DESIGN.md`、`docs/core-concepts.md`、`docs/lifecycles.md`、`docs/w3c-protocol.md` 移入 `docs/archive/`；`README.md` 重寫；`AGENTS.md` 於 M0 改寫；`TASK.md` 由新世代 TASK 取代。落地：14 §14.8。
- **D-60（testing subpath）** v0.1.0 不公開 `testing` subpath；契約套件與 fakes 先留 repo（P1 評估公開）。落地：10 §10.4。

## 13.9 歷史問卷對照

早期問卷（Q 編號）僅以行內引用存在於正文；對照如下：

| 問卷 | 本登錄 | 內容 |
| :--- | :--- | :--- |
| Q13 | D-34 | 不提供投影 DSL（不承擔文法維護成本）。 |
| Q14 | D-34、D-46 | 保留投影原語 + 薄運算子；SSR 維持雙軌並補 `collectAttributes`。（後續修訂：D-76～D-77——整題廢止。） |
| Q20 | D-27 | `defineToken` 採驗證式單參（選項 A）。 |
| Q23 | D-34、D-37 | `project` 單向；DOM → state 經 `observe` 明示；表單雙向另給 opt-in helper。 |

## 13.10 晚綁定解析（v0.1.0 方向修訂）

> 背景：DOM 自上而下解析、script 順序不可控、框架掛載時間點各異——「先 inject、後 mount」必須是一等公民且**順序無關**。同步函式無法返回尚未存在的 Provider 值，故解析改以 async-first 為主入口。本節修訂 §13.2 / §13.3 中與同步解析有關的段落。

- **D-61（晚綁定為一等公民）** 元素目標的解析與 `mount` 順序完全無關（先 inject 後 mount、並行 script、跨框架、re-parent、detached→連線皆正確）；缺席 = pending，不是錯誤。落地：[09b-late-binding.md](./09b-late-binding.md)、00 §0.2。
- **D-62（async-first 解析 API）** `inject$` / `injectAll$`：冷串流、resolve-once（首次解析後 complete）；`inject` / `injectAll`：預設無限等待 + `timeoutMs` / `signal`；`session$(el)`：熱流追蹤最近已 Mounted Session；`injectSync` / `injectAllSync` 收縮為 Session-only 同步投影，元素目標同步解析移除；`injectAll$` / `injectAll` 首次非空集合後發射 / settle；`injectRef` handle 與 `reconnect` 動態重解析列 P1。落地：03 §3.1/§3.3.1、04 §4.3。（後續修訂：D-71～D-75——同步面定為二等投影；命名見 D-75。）
- **D-63（pending registry 機制）** per-Document、DOM-native、token 索引、`WeakRef(host)`、微任務批次、無輪詢、無 pending 零開銷；喚醒來源：`context-mount` + 集中觀察者（childList / 連線變化）；只有 Mounted（水合 + eager 完成）Session 應答；`ScopeTransportPort` 追加 `watch` / `watchAll` 冷通道。落地：09b §9b.3/§9b.4、02 §2.6.4。
- **D-64（錯誤分類調整）** 新增 `RESOLUTION_TIMEOUT`（僅顯式 `timeoutMs` 逾時）；退役 `UNRESOLVED_SESSION`；`UNCONNECTED_NODE` 限 `mount` 宿主未連線；`DISPOSED_SESSION` 涵蓋 `injectSync` 與以已銷毀 Session 為目標的 async 解析。落地：02 §2.7。
- **D-65（外部限制與 SSR）** 外庫消費者的一次性 `context-request` 無法追回（事件無 replay）；server 端無 element 晚綁定，資料載入走 eager providers / `mount`。落地：09b §9b.8、07 §7.7。
- **D-66（規範性生命週期事件）** `context-mount` / `context-dispose` 為公共契約：`bubbles: true, composed: true, cancelable: false`，detail `{ token: string | null }`；跨 bundle 喚醒的唯一媒介。落地：09b §9b.5、09 §9.2。

## 13.11 取消與終止（AbortSignal 一等公民）

> 背景：解析與掛載都是 async-first 的等待操作，取消必須與解析同級。全 async 公共面接受 `signal`；終止方式由「容器」與「觸發者」共同決定，且與 pending registry 清理冪等。本節追加於 §13.10 之後。

- **D-67（全 async 面接受 `signal`）** `inject$` / `injectAll$` / `inject` / `injectAll` / `session$` 的 options 與 `MountOptions.signal`（僅 `mount` 消費）皆接受 `AbortSignal`；同步動詞無取消概念（`mountSync` 不讀取 `signal`）。`ScopeTransportPort.watch` / `watchAll` 的 options 追加 `signal` 向下傳遞。落地：03 §3.3/§3.3.1、02 §2.6.4。
- **D-68（終止語意：容器決定；取消 vs 目標死亡）** 消費者取消（`signal` abort / unsubscribe）：Observable 以 `complete()` 終止（等同退訂，`signal.reason` 不進串流）、Promise 以 `signal.reason` 拒絕（預設平台 `AbortError`；自訂 reason 與 `AbortSignal.timeout` 的 `TimeoutError` 原樣傳遞）——容器語意：Promise 無「完成無值」通道，故只能拒絕。目標 Session 死亡（明確 Session 目標）：以 `DISPOSED_SESSION` 終止（Observable error / Promise reject）。兩者皆不推送 `errors$`；呼叫前已 aborted → 立即結案。落地：03 §3.3.1、09b §9b.2。
- **D-69（多通道冪等與清理）** unsubscribe / `signal` / `timeoutMs` / 目標死亡多通道競爭時**先到者勝出、僅結案一次**；pending 條目即時移除，無殘留計時器與監聽。`mount` 等待期 abort：丟棄水合 / eager 結果、走 `dispose` 清理（同步階段 + fire-and-forget）、以 `signal.reason` 拒絕；進入 `Mounted` 後不可取消。落地：09b §9b.3/§9b.7、05 §5.1。
- **D-70（不新增錯誤碼）** 取消不屬錯誤分類學（02 §2.7 表下註記）；`timeoutMs` 維持 `RESOLUTION_TIMEOUT`；`AbortSignal.timeout` 為平台 `TimeoutError`——兩者並存、先到者勝。落地：02 §2.7。

## 13.12 異步流為主、同步為二等（Async-First Pivot）

> 背景：本專案的設計身份是**異步流**（順序無關、可取消、可等待、可組合）。接受 API 雙面性的笨重是刻意的取捨；以梯隊政策、投影模型與移除演練控制風險。本節追加於 §13.11 之後。

- **D-71（API 梯隊）** 一等（穩定契約）：藍圖運算子（含非同步工廠 `provide`）、`mount`（非同步默認）、異步解析家族、流家族、命令（`update` / `dispose`）、`attach`。二等（同步投影）：凡帶 `Sync` 後缀者——`provideSync` / `mountSync` / `injectSync` / `injectAllSync` / `selectSync` / `getSessionSync`；不列入穩定契約，可於任何 minor 移除或改語意（CHANGELOG 標註即為充分告知），不提供遷移承諾；新程式碼導向異步對應；接近移除時再掛 `@deprecated`（避免 IDE 噪音）；實際移除前需先確立渲染（SSR）與同步工廠（改以 `provide` 宣告）等場景的替代路徑。落地：03 §3.1/§3.1.1。（命名與清單修訂：D-75。）
- **D-72（同步即投影；核心不依賴）** 同步動詞是異步流管線的熱快照投影：值已就緒時等於最新投影，未就緒時拋（`ASYNC_SERVICE_NOT_READY` 等，不等待）。domain 與 application 核心不得以同步動詞實現功能；移除同步面不得改變核心行為；同步投影實作不得進入流路徑的必要 bundle（可 tree-shake）。驗證：parity 測試 + 移除演練（stub 全部 `*Sync` 動詞後核心全綠）。落地：02 §2.8 #14、10 §10.5。
- **D-73（文檔主導原則）** 全部章節、範例、README 的主線寫法使用異步流；同步僅可出現於「同步工廠內已持有 Session」與「快照一致性」語境，且必須標註二等身分（03 §3.1.1）。落地：03、11、README。
- **D-74（取捨明示）** 接受 API 雙面性的笨重（學習成本、維護面、體積）作為刻意取捨；護欄 = 梯隊政策（D-71）、移除演練（D-72）、文檔主導（D-73）、體積預算（14 §14.5）。落地：00 §0.3、12 §12.4。

## 13.13 命名公約（Async 無後缀、Sync 帶後缀）

> 背景：異步流為一等（§13.12）。命名採 **Node 慣例**：非同步為默認、不帶標記；同步變體帶 `Sync` 後缀；`$` 保留給 Observable。本節為 API 名稱的唯一權威對照；歷史決策中的舊名依此解讀。

- **D-75（命名公約）** 異步一等**無 `Async` 後缀**（`inject` / `mount` / `provide`）；同步二等**必帶 `Sync` 後缀**（`injectSync` / `injectAllSync` / `provideSync` / `mountSync` / `selectSync` / `getSessionSync`）；`$` 保留給 Observable（與 `Sync` 正交）。對照表如下。落地：03 §3.1/§3.1.1、11 §11.2、README。

| 舊名 | 新名 | 梯隊 | 備註 |
| :--- | :--- | :--- | :--- |
| `mountAsync` | `mount` | 一等 | 非同步默認：等待水合 / eager 完成後 resolve；可 `signal` 取消 |
| `mount`（舊同步版） | `mountSync` | 二等 | 立即回傳 Session（同步投影） |
| `injectAsync` | `inject` | 一等 | `Promise<T>`；元素目標晚綁定 |
| `inject`（舊同步版） | `injectSync` | 二等 | 熱快照投影；僅 Session |
| `injectAllAsync` | `injectAll` | 一等 | 首次非空集合後 settle |
| `injectAll`（舊同步版） | `injectAllSync` | 二等 | 熱快照投影；僅 Session |
| `provideAsync` | `provide` | 一等 | 非同步工廠（默認） |
| `provide`（舊同步版） | `provideSync` | 二等 | 同步工廠；`injectSync` 之來源 |
| `select`（舊同步版） | `selectSync` | 二等 | `select$` 不變（一等） |
| `getSession` | `getSessionSync` | 二等 | `session$` 不變（一等） |
| `inject$` / `injectAll$` | 不變 | 一等 | `$` = Observable；resolve-once |

- 判定規則：**帶 `Sync` 後缀即二等（機械可辨）；其餘為一等**。`Async` 後缀自此不再使用。
- 兩個後缀正交：`inject$`（流・一等）、`inject`（Promise・一等）、`injectSync`（同步投影・二等）。
- 落地：03 §3.1/§3.1.1、11 §11.2、README。

## 13.14 投影非目標（Projection Non-Goal）

> 背景：DOM 投影與雙向綁定屬視圖層職責；本庫收斂為「狀態與身分」，DOM 表現交還使用者。本節追加於 §13.13 之後；§13.5 整節依本節廢止。

- **D-76（投影與雙向綁定為非目標）** 全面移除 `project` / `twoWay` / `HostPort.project` / `read` / `observe` 與 locator 詞彙；狀態 → DOM 由使用者以 `subscribe$` / `select$` + DOM API 自行組合，DOM → 狀態由使用者 `addEventListener`（或 `HostPort.on`）+ `update`；官方配方見改寫後的 [08-projection.md](./08-projection.md)。歷史：v0.0.1 `withBridge` 與草案 `project` / `twoWay` 一併廢止。落地：08（改寫）、00 §0.4/§0.5/§0.6、02 §2.1/§2.3/§2.5/§2.6.1、03、11 §11.5。
- **D-77（SSR 單軌化）** 水合來源收斂為儲存 / payload / 藍圖種子；策略更名 `storageFirst` / `payloadFirst`（原 `projectionFirst`）/ `blueprintFirst` / `merge`；`collectAttributes`、投影 frame、`MountOptions.hydrationMismatch` / `HYDRATION_MISMATCH` 與 mismatch 策略退役；payload 讀取或解析失敗安全退化至次順位來源。落地：07（改寫）、06 §6.3、03 §3.3/§3.3.3。
- **D-78（HostPort 瘦身）** 移除 `project` / `read` / `observe`；介面收斂為 `token` / `isConnected` / `parent` / `lifecycle$` / `on` / `native()`（`on` 保留：adapter 無關的薄事件封裝，回傳解除函式）。落地：02 §2.6.1、09 §9.2。
- **D-79（錯誤分類學 10 碼）** 退役 `PROJECTION_SECURITY` / `PROJECTION_RULE_INVALID` / `HYDRATION_MISMATCH`；其餘 10 碼不變（單一事實來源 02 §2.7）。落地：02 §2.7、12、10。

## 13.15 補遺與裝配契約（Gap Closure）

> 背景：實作前審計之遺留項（組合根契約、工廠邊界、等待期斷開、可見性、順序與並發細節、協議保留）統一收斂。本節追加於 §13.14 之後。

- **D-80（組合根裝配契約）** `ApplicationPorts = { host: HostAdapter, storage: StorageRegistry, ssr?: SsrAdapter }`；`HostAdapter = { toHost(node): HostPort, scheduler: SchedulerPort, scopeTransport: ScopeTransportPort }`（集中觀察者為 host adapter 內部實作；非 DOM host 可缺省）；`StorageRegistry.resolve(keyword): StoragePort | null`（null → `UNKNOWN_SERVICE`）；`SsrAdapter = { nullHost, payloadResolver: PayloadResolver | null, serialize }`；`PayloadResolver = (token: string | null) => unknown | null`；`SerializeOptions<S> = { select?: (s: S) => unknown }`（預設全量）；`createApplication(ports): Application`，`Application` 成員 = 03 §3.1 全表；`createApplication` 於根入口 re-export（SSR 以自訂 ports 每請求呼叫；根入口單例僅供瀏覽器不變）。落地：09 §9.1/§9.1.1/§9.7、01 §1.4、15。
- **D-81（工廠解析邊界）** 工廠內不得以 element 目標等待「自己所在會話」的掛載（eager 工廠必死鎖：`mount` 等 eager、eager 等 `Mounted`）；一律以 `session` 參數作 Session 目標；`timeoutMs` 僅為逃生、不作設計。落地：03 §3.3.1、09b §9b.8、10 §10.5。
- **D-82（mount 等待期斷開）** 不中止掛載；初始化完成時判定：keyed → 直接 `Suspended`（不派發 `context-mount`、不執行 `onMount` / `onSuspend`；Promise resolve 該 Session，待復甦）；匿名 → 直接 `Disposed`（走清理；Promise 拒絕 `UNCONNECTED_NODE`）。`UNCONNECTED_NODE` 觸發擴充（02 §2.7）。落地：05 §5.1/§5.1.1、03 §3.3、02 §2.5.1/§2.7、10 §10.5。
- **D-83（會話可見性與 Session 目標缺席）** `getSessionSync` / `session$` 僅可見「Mounted 且已連線」——Initializing 不可見（`mountSync` 同步完成、無可觀測窗口）、Suspended 不可見；Session 目標解析缺席 = pending（不拋 `UNKNOWN_SERVICE`；祖先會話後續掛載經 `context-mount` 喚醒）。落地：03 §3.3.1、09b §9b.2。
- **D-84（順序與可用性補遺）** 鉤子先於事件（進入 `Mounted`：`onMount` FIFO → `context-mount` → `lifecycle$「mounted」`；其餘狀態同構；`abort$` 例外即時先行）；清理閉包（LIFO）先於 `onDispose`（LIFO）；`Suspended` 期間同步投影（`selectSync` / `injectSync` / `update`）可用、元素目標不可見；`onConflict: 'evict'` 對舊會話直接 `dispose`（不經 `Suspended`、不執行 `onSuspend`）；`mountSync` 完整繼承 keyed / TTL / 復甦 / `onConflict` 規則。落地：05 §5.1.1/§5.2/§5.5、02 §2.5.1、03 §3.3。
- **D-85（解析並發細節）** `injectAllSync` 遇任一 multi 條目未就緒 → **整體**拋 `ASYNC_SERVICE_NOT_READY`（不局部跳過）；快取命中時 `mount` 的 Promise 立即 resolve（微任務）；`session$`：Suspended 期間發射 `null`、復甦後重發**同一 Session 物件**。落地：03 §3.3/§3.3.1。
- **D-86（協議保留與逃生口）** `subscribe: true` 標記 **P1 保留**（v0.1.0 無公共 API 消費；長期值串流 P1 再定）；`HostPort.on` 的 options 追加 `signal?: AbortSignal`（透傳 `addEventListener`）。落地：09 §9.2/§9.3、02 §2.6.1。
