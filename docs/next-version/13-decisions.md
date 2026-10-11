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

## 13.16 M2 修訂增補（B-01～B-27 落地）

> 本節僅追加；§13.1～§13.15 原文不動。後續變更另開新編號，不覆寫歷史。

- **D-87（B-01 晚綁定喚醒範圍與 token 過濾）** 子樹範圍為規範快徑（pending host 為 mount-host 自身或後代），全文件批次重試為具名正確性 fallback；token 索引分派為規範效能規則，`context-mount` payload 加可選 `provided-tokens`（缺席走全掃 fallback）；兩層成本陳述（最壞 Σ + 快徑典型段）。落地：09b 全面、03 §3.3.1、10 §10.5。
- **D-88（B-02 async 一律 pending）** async 平面缺席一律 pending（含 multi-only 誤用）；同步 `injectSync` / `injectAllSync` 即時 `UNKNOWN_SERVICE` 不變；server 真缺席例外由 D-92 承接。落地：02 §2.7、03 §3.3.1、09b §9b.2、10 §10.5。
- **D-89（B-03 token 驗證範圍）** 驗證僅適用字串形式，`PrivateToken` 物件豁免；裸字串逃逸口同樣驗證；`MountOptions.token` 型別為 `ServiceToken<string> | string` 並註 `@throws TOKEN_INVALID`；全部單段範例重寫為命名空間形。落地：02b §2b.8/§2b.9、03 §3.1/§3.3.1、15 Token/Keyed 行。
- **D-90（B-04 埠之家與宿主委派）** 埠合約歸 `domain/ports`（application 僅 type-only 重出口）；infra→application runtime 嚴禁（`import type` 守衛另見 D-111）；`mount` 全委派 `host.toHost(node)`；domain 擁有晚綁定狀態機 + store-behind-ports，handoff 為 `ScopeTransportPort.watch` / `watchAll` + `SchedulerPort.microtask`。落地：01 §1.2/§1.3/§1.5、09 §9.1.1/§9.2、02 §2.6.4、10 §10.2。
- **D-91（B-05 時間語義歸埠）** domain 僅用非時間 RxJS 核心，時間算子黑名單；`timeoutMs`、TTL、儲存批窗口、重試批處理全經 `SchedulerPort`；lint + node 行為測試雙守衛；observer 重檢走 `scheduler.microtask()`；scheduler recipe 標 DOM-only 並附 fake 片段。落地：01 §1.2、04 §4.7、09 §9.4/§9.5、10 §10.5、12 §12.5。
- **D-92（B-06 server 缺席語義）** server Session-target 僅等同 session 訂閱時已 InFlight 的項，真缺席在 ssr adapter 下 fast-reject `UNKNOWN_SERVICE`；「server 無 element-target 晚綁定」定語插 07 §7.7 + 09b §9b.8；SSR 註冊表由 per-request Application 擁有；未釋放請求顯式 dispose + 掃蕩兜底；07 §7.7 加 5 行標準 server 片段。落地：02 §2.7、03 §3.3.1、07 §7.2/§7.7、09 §9.7、09b §9b.2/§9b.8。
- **D-93（B-07 單值 direction 移除）** 刪除單值 `request` 的 `direction`（multi 保留，附 tiebreak 句）；`detail` 不加欄位；單值 nearest-wins 一句話落 03 §3.3.1（farthest 經 `injectAll` 繞行）。落地：02 §2.6.4、09 §9.3、03 §3.3.1。
- **D-94（B-08 async 環為 deadlock-until-timeout）** `CIRCULAR_DEPENDENCY` 嚴格 sync-only；async 環（自環與 A↔B）為規範 deadlock，唯一出口為顯式 `timeoutMs` → `RESOLUTION_TIMEOUT`；無 chain 規則，一律 coalesce；v0.1.0 無 dev 警告（waiter-graph + same-chain 偵測 + dev-ledger 記 P1）；10 §10.5 加 6 列全矩陣。落地：02 §2.5.2/§2.7、03 §3.3.1、09b §9b.8、10 §10.5、12 §12.1。
- **D-95（B-09 Session-target 死亡鏈結）** entry 加 `targetSession: WeakRef` + `abort$` 訂閱，死亡結算 `DISPOSED_SESSION`；09b:50 按 target 切分（element-target 不受 dispose 影響，Session-target 隨目標死亡結算）；`session$` 移出 token registry 成獨立追蹤小節；同 batch 死亡檢查先於命中投遞。落地：09b §9b.2/§9b.3、02 §2.3、03 §3.3.1。
- **D-96（B-10 Suspended 強留存）** Suspended 條目持強引用槽 `{ ref, weak }`（Application 擁有，resuscitate / dispose / TTL-expiry 釋放）；facade 強 native 降為 `WeakRef`，`native()` 取 deref-or-throw；`maxSuspendedPerDocument` 預設 100（oldest-first 經 `lifecycle$ disposed` 可觀測）；`Infinity` 須配 `retention: 'pinned'` + 具名 owner，裸 `Infinity` 拋配置錯。落地：02 §2.5.1、05 §5.5、03 §3.3、10 §10.5、15 Suspended 行。
- **D-97（B-11 Suspended 同步可用）** 刪連接性檢查（Mounted / Suspended 皆可，Disposed → `DISPOSED_SESSION`）；Suspended 行與 `session$` 行逐字鏡像進 glossary（supremacy 註：02 §2.5.1 為規範源）；Suspended 期 service-plane 全活、僅 element-target 路徑盲，附 lazy/transient `native()`-capture 與 `subscribe$` 背壓兩註腳。落地：05 §5.1.1/§5.5、02 §2.5.1、03 §3.3.1、10 §10.5、15 Suspended/`session$` 行。
- **D-98（B-12 multi 邊界）** 全庫统一 hit = first non-empty，空完全壓制（不發射不結案，`single first-emit / multi first-non-empty; empty never settles` 五處逐字同句：02 §2.6.4、03 §3.3.1、09b §9b.2、10 §10.5、15:49）；過濾職責在 port 層；同步空快照合法另加免責句；09b §9b.2 明示 late-provider-miss + P1 `reconnect` 指針。落地：02 §2.6.4、03 §3.3.1、09b §9b.2、10 §10.5、15:49。
- **D-99（B-13 水合先於 eager）** hydration-first，串行可測；`onConflict: 'reset'` 舊態替代策略鏈中的藍圖種子槽位（其餘不變，HMR 保熱態請用 `blueprintFirst`）；resuscitation / reset / 全新掛載三者正交；L1/L2 逐字復用（03 §3.3 + 06 §6.3、05 §5.5 + 06 §6.3）。落地：03 §3.3、05 §5.5、06 §6.3、10 §10.5。
- **D-100（B-14 儲存排序與回聲）** BC 信封 `{ kind, key, v, d, ts, tabId, seq }`，`last` = `(ts, seq, tabId)` 全序；`(tabId)` 真自回聲過濾，同 tab 兄弟 session 視為合法外部變更；flush-then-compare；Web Locks 鎖名 `dc-storage:<key>`（`exclusive`，僅包 read-modify-write 節）；`(tabId, seq)` + 字節相等雙重去重；`StorageOptions.conflict` 預設 `'lww'`；counter 示例改 `crossTab: false`。落地：06 §6.2/§6.3/§6.4/§6.5。
- **D-101（B-15 水合管線）** 四階段管線（read → migrate → merge → seed-fill）寫進 06 §6.3；頂層淺合併（與 `update` 同深互指）；聯合鍵集；migrate 只吃 storage 原始 `d`（單步同步無目標版本）；partial 空洞下探 + 水合中外部更新排隊走 B-14 管線。落地：06 §6.3、07 §7.4。
- **D-102（B-16 錯誤稅制增補）** quota/寫失敗 → `INVALID_STORAGE_DATA`（`details.op/key/storageKind`），鉤子/清理異常 → 新碼 `HOOK_ERROR`，eager reject 以裸因拒絕；02 §2.7 表追加 `details` 列；`versionNewer` 寫 guard（`v > version` 後該 key 只讀後端）；`onMount` 失敗即 mount 失敗；緩衝滿丟最舊保最新 + 計數 + drain-once；`SINGLETON_CONFLICT` 路由至輸家 `errors$`（`mounted` 前）；無人訂閱的終態錯誤保留至首訂否則 `reportError`。落地：02 §2.4/§2.7、03 §3.3、04 §4.1、05 §5.2、06 §6.4/§6.5、10 §10.5、15 ERM 行之外另見 D-113。
- **D-103（B-17 keyed 衝突裁決）** 首 resuscitate 先跑遞延 `onMount`（`details.setup: 'deferred-mount'`，事件仍為 `resuscitated`）；microtask-pending 視同 Suspended-in-waiting（resuscitate 勝）；四格 precedence 表（跨 host Suspended resuscitate 勝，同 host swap evict 勝）；genuine dual-active 一律拋 `KEYED_SESSION_CONFLICT`（`onConflict` 僅同 host swap 與 token 矛盾，互引 D-14 並加 same-host-only 限定；D-82 等待期語義不變）。落地：05 §5.1/§5.5、02b §2b.9、02:138/03:175 限定句、08 recipe-4。
- **D-104（B-18 掛載併發）** 同 host + token in-flight coalesce（首 blueprint 勝）；窗口內 `mountSync` 拋 `ASYNC_SERVICE_NOT_READY`（`details.phase: 'Initializing'`）；Initializing 可 dispose（顯式拒 `DISPOSED_SESSION`，abort 仍以 `signal.reason` 拒）；同 task abort-check 先於 hydration-settle 交付；內部 `disposePromise` + 晚訂 `errors$` 即時 complete + `mountSync` + `signal` 明式 warn + `frame` MUST 退化 microtask。落地：03 §3.3、02 §2.6.3、04 §4.1、05 §5.1.1、10 §10.5。
- **D-105（B-19 待決有界）** 水位武裝一次性 microtask prune（無重派無 timer）；每 batch 先 prune（含中央 observer 搭便車）；回調 MUST-NOT 強捕 host / element；`maxPendingPerDocument` + oldest → `RESOLUTION_TIMEOUT`；雙維 bounding（token 桶 + 每批 K，超量鏈式下一個 microtask）；dev 警告非結算（count + oldest age，貼 D-83 旁）。落地：09b §9b.3/§9b.4/§9b.7、03 §3.3.1、10 §10.5。
- **D-106（B-20 宿主命名與驗證）** README:41 升規範（公開面一律 `host` / `element`，`Native` 僅 `HostPort<Native>` 定義處，`node` 僅 adapter 內部）；`LateTarget<Native = HTMLElement> = Session | HostPort<Native> | Native` 兩處逐字同句；接受廣義 `Element`（含 SVG/MathML），`toHost` 非宿主輸入拋新碼 `HOST_INVALID`；`09:36` 改寫為全委派；全禁 `instanceof` 判定（duck-typing）；公共面預設 `Native = HTMLElement`。落地：09 §9.2、02 §2.3/§2.6.1/§2.7、02b §2b.8、03 §3.3/§3.3.1、15 Host/element 行。
- **D-107（B-21 詞彙收斂）** glossary 立 `Context (polysemous — bare use banned)` 六義表（裸 `context` 保留給包名）；`ContextRequestDetail.context` 改名 `token`；glossary 加 `Container (banned)` / `Scope (ancestry-range only)` / `Session (single mount handle)` 三行 + 02 §2.4 containment 句逐字雙寫；Session 行改 branded handle；加 `Anonymous Session (token: null)`；Disposal 行補四動詞表（`03:242` 三分同文）。落地：15 全面、02 §2.3/§2.4/§2.5.1、09 §9.3、00:5。
- **D-108（B-22 mount 字族與圖）** 05 §5.1.1 立字族迷你表（03 §3.1 掛指針）；sequence 首箭頭改 `User->>S: mount(bp)(host)`；hook→event 單一序 `onMount FIFO → context-mount → lifecycle$ mounted`（`abort$` 例外先行）四處同文；`resuscitate` / `resuscitated` / `resuscitation` 三形拆分；Dimension-3 重寫為正交積（`Evicted` 退役改稱）；adopt 自迴圈加註。落地：05 §5.1.1/§5.2、02 §2.3、15:18/15:36。
- **D-109（B-23 通道優先級與根安全）** 預設 DOM root 開集中 observer（宿主轉發為可選增強，雙通道冪等；非 DOM 自組裝下轉發為唯一通道）；adapter 工廠到方法調用前零 DOM/全局觸碰（node 根 import 不拋測試）；`observer: 'auto' | 'off'`（應用級）+ `MountOptions.observer`（逐 mount，mount 贏）；`data-context-key` 自致回寫過濾、外寫喚醒。落地：05 §5.4/§5.5/§5.6、03 §3.3、09 §9.1.1/§9.4、09b §9b.4、10 §10.2/§10.5。
- **D-110（B-24 範例可運行門）** 預設每段 `ts` fence 可運行（`tsc --noEmit --strict`），真片段以 `sketch` 標記豁免；flagship 原地修（命名空間 token + 完整 imports）；`pipe<S>(bp, ...operators)` 同質簽名；`native()` cast + stub；projection/migrate/BYO 三處自包含；scheduler recipe 標 DOM-only；07 加 5 行 server 片段；`Session<S> | HostPort<Native> | Native` 全參數化；`*.json*` / mermaid 豁免 + BYO 展開；11 steps 3–4 加 flagship 指針。落地：03 §3.1、05 §5.2、06 §6.3/§6.4、07 §7.2/§7.7、08 §8.2、09 §9.5、11 §11.9、README conventions。
- **D-111（B-25 情態 legend 與單源）** README conventions 立 5 行 legend（必須/不得 = normative，應該/建議 = recommended，可/允許 = permitted，其餘 informative；glossary 頭加指針）；十一條絕對聲明 sweep 改寫；`09:168` 改寫為 runtime 禁止 + `import type` 允許（lint/load 守衛；與 D-90 搬遷同 PR 對賬）；02 §2.8 為唯一規範源（10 §10.5 改 `covers 02 #n` 單向 checklist，`10:86` 改 `covers 02 #14`）；storage 靜默例外互指；描述性禁令升 MUST；每不變式綁 DoD/CI（見 12 §12.5）。落地：README、15 頭、01/02/06/09/10/12。
- **D-112（B-26 Sync 門與地平線）** D-71 增補（不改寫 D-71 原文）：03 §3.1.1 與 14 §14.7 兩處綁定同一門（實際移除前先確立 SSR/渲染與同步工廠替代路徑，先標記不少於 1 個 minor 的 deprecation window，CHANGELOG 必要不充分）；版本範圍句（0.x any-minor-with-gate，1.0 後二等移除視同 BREAKING 須 major）；12 加 horizon 行（v0.1.x 不移除，最早 v0.2.0 + codemod）；11 steps 3–4 標 interim + 內聯 async 對應；drill 明確 seam/suite/criterion；三處加範圍句（演練證核心獨立，下游安全另由 D-71 門控）；`接近移除` 觸發器定義為 horizon window opened。落地：03 §3.1.1、10 §10.5、11 §11.9、12 §12.1/§12.5、14 §14.7、README:32-35、00:48。
- **D-113（B-27 API 面與型別）** 03 §3.1 加一等 `serialize` row（curry 形 `serialize(opts?)(session)`，`select` 預設全量；09:22-28 destructure 列出；07 重述）；ERM symbols 改可選（runtime feature-detect 保留，缺席改顯式 `dispose(session)`，`await using` 需 `ESNext.Disposable`，14:31/38 為源）；新增 `StorageKeywords` 聲明合併（`storage: keyof StorageKeywords | StoragePort`）；`resolve → null → mount-time UNKNOWN_SERVICE` 保留 + tree-shake 衛生句；雙 map 拓撲（singleton 與 keyed 獨立，same string MAY 共存但 MUST NOT 跨可見，互引 D-28 共享本意與 S-12 monitor）；`統一命名空間` 首用處加兩句消歧（驗證共享、查詢獨立，落 02b §2b.1/§2b.9 + 15 指針）。落地：02 §2.3、02b §2b.1/§2b.9、03 §3.1/§3.3、06 §6.2、07 §7.4、09 §9.1/§9.6、14 §14.3/§14.4、15 ERM/Token 行。
- **D-114（Sync 即時棄用與 0.2.0 移除）** D-71、D-112 增補（不改寫歷史原文）：全部 `*Sync`（`provideSync` / `mountSync` / `injectSync` / `injectAllSync` / `selectSync` / `getSessionSync`）實作落地即全程標記 `@deprecated`（`0.1.x` 全程為 deprecation window，不等接近移除）；`0.2.0` 全面移除（含 `provideSync`），附 codemod；移除前仍須確立 SSR / 渲染與同步工廠替代路徑（D-71 gate 保留為移除前置）；`1.0` 後新增二等移除視同 BREAKING 須 major。落地：03 §3.1.1、00 §0.2/§0.3/§0.4、02 §2.8 #14、10 §10.5、11 §11.9、12 §12.1、14 §14.7、README 一句話定位。
- **D-115（subscribe 保留名額與提供側一次性回應）** D-86 增補（不改寫歷史原文）：`subscribe?: boolean` 保留（P1 長期值串流名額，不做 v0.1.0 移除）；v0.1.0 僅容忍不消費——消費側永不派發，提供側收到外部 `subscribe: true` 一律一次性回應並忽略該旗標，不維護長期訂閱。落地：09 §9.3（含 `ContextRequestDetail.subscribe` 內聯註解）、02 §2.6.4 `request` options 內聯註解。
- **D-116（跨標籤公平排序延後至 P1）** D-100 增補（不改寫歷史原文）：`(ts, seq, tabId)` 全序公平比較延後至 P1（需 `StoragePort` 元數據表面變更以攜帶 `ts` / `seq` / `tabId`）；v0.1.0（P0）以到達序為準，輔以 `conflict` 鉤子、字節相等去重與 flush-then-apply（先刷本地待寫批次、再套用遠端）。落地：06 §6.5。
