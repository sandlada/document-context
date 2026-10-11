# 15 — 術語表 (Glossary)

本表固定 `docs/next-version/` 的用語；與其他文件衝突時以此為準。情態力度見 README conventions legend（必須/不得 = normative，應該/建議 = recommended，可/允許 = permitted，其餘 informative）。

## 架構與模型

| 術語 | 定義 |
| :--- | :--- |
| **Port（埠）/ Adapter（轉接器）** | domain 定義的被驅動介面 / infrastructure 對其的實作。 |
| **Composition Root（組合根）** | 套件根入口；唯一同時接觸 application 與 infrastructure 的裝配點。 |
| **Application 實例** | `createApplication(ports)` 的產物（`ports = { host, storage, ssr? }`，見 09 §9.1.1）；承載 registry 與公共 API。 |
| **Blueprint（藍圖）** | Phase 1 的 100% 純不可變資料；零 DOM、零 I/O、零監聽器。 |
| **Phase 1 / Phase 2** | 純藍圖宣告期 / `mount` 掛載執行邊界。 |
| **Session** | Phase 2 的執行期句柄；branded handle（欄位公開可讀、不可構造，僅經 `mount` 取得）；單次掛載句柄、狀態邊界，非容器；持有 `state$` / `errors$` / `lifecycle$` / `abort$` / `abortSignal`。 |
| **Anonymous Session** | `token: null` 的 Session；無 keyed 身分；無跨宿主復甦；同宿主重掛回傳快取；斷開即 Disposed 不經 Suspended。 |
| **Container（禁用）** | 禁用詞；以 Application 實例 / Session / ancestry-chain 表述。 |
| **Host / HostPort** | 抽象宿主節點；DOM 組合下為 `HTMLElement`。`Session.host` 為穩定代理（facade）。公開面一律 `host` / `element`；`Native` 僅保留於 `HostPort<Native>` 定義處；`node` 僅限 adapter 內部變數名。 |
| **`HOST_INVALID`** | `toHost` 對非宿主輸入拋出的致命碼（未連線 vs 非宿主語意不同，不復用 `UNCONNECTED_NODE`）。 |
| **Scope（作用域）** | 沿 `host.parent` 祖先鏈的解析範圍；物理 DOM 即作用域階層。`Scope` 僅此義；生命週期值一律全稱 `lifecycle: 'scoped'`。state 永不跨 Session；服務解析沿祖先鏈上行；單例橫跨 Document（見 02 §2.4）。 |
| **Provider（提供者）** | 藍圖中對 token 的服務註冊；分單值與 multi。 |
| **Eager / Lazy** | 建立期（`onMount` 前）實例化 / 首次解析時實例化（預設 lazy）。`lifecycle` / `mode` 靜態，僅 resolution 遷移（`Idle → InFlight → Resolved | Rejected | Aborted`）。 |
| **Context（多義，裸用禁用）** | 裸 `context` 保留給包名；其餘一律限定形：`ContextBlueprint`（藍圖型別）、`data-context-key`（身分屬性）、`context-mount` / `context-dispose`（DOM 事件）、W3C Context Protocol（傳輸協議）、`createContext`（建構函式）、`DocumentContextError`（錯誤型別詞幹）。正文裸用視為違規。 |
| **Data-Last / Curried** | `operation(config)(target)` 柯里化簽名；所有公共 API 統一風格。 |

## Token 與身分

| 術語 | 定義 |
| :--- | :--- |
| **ServiceToken\<T\>** | 公開 token：branded string，字串相等即等價，可序列化、跨 bundle/realm/文件可用。 |
| **PrivateToken\<T\>** | 私有 token：frozen branded 物件，引用即身分，不可序列化。 |
| **Token** | 統一 union：`ServiceToken | PrivateToken | string`；埠與解析簽名接受。字串形式一律驗證（命名空間/字元集/黑名單）；`PrivateToken` 物件豁免（`name` 不構成身分）。統一命名空間指驗證與威脅模型共用同一規則；查詢空間獨立（單例與 keyed 各自 map，見 D-113）。 |
| **ServiceRegistry** | 供宣告合併（declaration merging）的介面，提供字串 token → 服務型別對應。 |
| **Keyed Session Token** | Session 的權威身分（`mount({ token })` / `data-context-key`）；強制為可序列化公開 token（`ServiceToken<string>` 語意，與 `defineToken` 共用驗證器）。 |

## 生命週期

| 術語 | 定義 |
| :--- | :--- |
| **Suspended（暫停）** | keyed Session 隨宿主脫離；狀態 / 訂閱 / 儲存照常演進；DOM 綁定由使用者自管。sync projections usable（`selectSync` / `injectSync` / `update`），element-target invisible；resuscitation reuses blueprint without re-hydration（state wins）。規範源為 02 §2.5.1，本行鏡像（改此即改彼）。 |
| **Resuscitation（復甦）** | 過程義：同 token 於新宿主喚回 Suspended Session；狀態完整延續（state 勝出，不重跑水合）。轉換動詞為 `resuscitate`，事件為 `resuscitated`。 |
| **suspensionTtlMs** | Suspended 寬限期；預設 50；`0` = 立即銷毀；`Infinity` = 永不自動銷毀。 |
| **onConflict** | 身分衝突策略：`throw`（預設）/ `evict` / `reset`。 |
| **Disposal / Poisoning（銷毀 / 毒化）** | 兩相清理（同步階段 + 非同步結算）；毒化後 `update` 回 `false`；同步面拋（throw）、Promise 面拒（reject）、Observable 面錯（error）：`inject*` 觸 `DISPOSED_SESSION` 按此三分呈現。 |
| **attach** | 純函式宿主綁定：`attach(config)(session) → { connect, disconnect, adopt }`（冪等）。 |
| **ERM** | TC39 Explicit Resource Management：`using` / `await using` / `Symbol.dispose`（漸進增強）。ERM 缺席時符號未掛載，改用顯式 `dispose(session)`；`await using` 需 `ESNext.Disposable` lib（見 14 §14.4）。 |

## 解析與晚綁定

| 術語 | 定義 |
| :--- | :--- |
| **晚綁定解析（Late-Binding Resolution）** | 解析請求與 Provider 掛載順序無關；缺席 = pending，由 DOM 事件喚醒重試。 |
| **Pending Request Registry** | per-Document、DOM-native 的待決請求登記；WeakRef 追蹤、微任務批次、無輪詢。 |
| **resolve-once** | 單值首次發射 / 多值首次非空後 complete；空數組永不結案（`single first-emit / multi first-non-empty; empty never settles`）。 |
| **`session$(el)`** | 追蹤元素最近已 Mounted Session 的熱流（`null` ↔ `Session`）；Mounted + connected only；Suspended 期間發射 `null`、復甦後重發同一 Session 物件；`getSessionSync` 為同步快照。規範源為 02 §2.5.1 與 03 §3.3.1，本行鏡像。 |
| **`connect` / `mounted` / `context-mount`** | `connect` = HostPort 事件；`mounted` = Session `lifecycle$` 事件；`context-mount` = 宿主派發的 DOM CustomEvent（因果鏈見 05 §5.2）。 |
| **`context-mount` / `context-dispose`** | 規範性公共生命週期事件（bubbles + composed）；晚綁定喚醒媒介。 |
| **取消（AbortSignal）** | 全 async 解析 API 與 `mount` 接受 `signal`；Observable 面取消即 `complete()`（等同退訂），Promise 面以 `signal.reason` 拒絕（預設平台 `AbortError`）。 |
| **目標死亡終止** | 以明確 Session 為目標的等待，在該 Session 銷毀時以 `DISPOSED_SESSION` 結案（Observable error / Promise reject）。 |
| **多通道冪等** | unsubscribe / `signal` / `timeoutMs` / 目標死亡競爭時先到者勝出，僅結案一次，無殘留計時器與監聽。 |
| **API 梯隊** | 一等（異步流 / 命令，穩定契約）與二等（`*Sync` 後缀 API，可隨時移除）之分級；見 03 §3.1.1。 |
| **同步投影（Sync Projection）** | 同步動詞 = 異步流管線的熱快照視圖；值未就緒時拋、不等待。 |
| **移除演練（Removal Drill）** | 以 stub 替換全部 `*Sync` 動詞後核心套件仍全綠的測試，證明核心不依賴同步面。 |
| **命名公約（Sync 後缀）** | 異步一等：無 `Async` 後缀（`$` = Observable）；同步二等：必帶 `Sync` 後缀；見 13 §13.13。 |

## 響應式與錯誤

| 術語 | 定義 |
| :--- | :--- |
| **state$** | 熱狀態串流；訂閱即得當前快照。 |
| **errors$** | 非致命錯誤匯流；初始化期緩衝（≤ 32）、結算後 `complete()`。 |
| **abort$ / abortSignal** | Session 銷毀時即時發射的收斂訊號；內部訂閱一律 `takeUntil(abort$)`。 |
| **DocumentContextError** | 統一錯誤類別：`code` / `details` / `resolutionGuide`；致命性見 02 §2.7 對照表。 |

## 儲存與 SSR

| 術語 | 定義 |
| :--- | :--- |
| **Hydration（水合）** | 掛載時依策略（`storageFirst` / `payloadFirst` / `blueprintFirst` / `merge`）從儲存 / payload / 藍圖種子還原狀態。 |
| **Payload** | SSR 的 JSON 狀態軌；id 為 `__dc_state:<token>` / `__dc_state`，由 PayloadResolver 讀取。 |
| **LWW** | Last-Write-Wins；跨標籤外部變更以整快照替換。 |
| **投影 / 雙向綁定（非目標）** | 本庫不做 DOM 投影與雙向綁定；由使用者以 `subscribe$` / `select$` + DOM API 自行組合（見 08）。 |
