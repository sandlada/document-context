# 09b — 晚綁定解析 (Late-Binding Resolution)

> 本節是「先 inject、後 mount」場景的規範：**解析請求與 Provider 掛載的順序完全無關**；並定義**取消**（消費者主動，`AbortSignal` / unsubscribe）與**目標死亡**（系統事實）的終止語意（見 §9b.2）。
> 決策見 [13-decisions.md](./13-decisions.md) §13.10（D-61–D-66）與 §13.11（D-67–D-70）。

## 9b.1 為何需要

DOM 的客觀事實：

- 文檔自上而下解析，多個 `<script>` 塊的執行順序不受應用控制；
- 框架（React / Vue / Astro islands / Custom Elements）掛載時間點各不相同；
- 模組腳本（`type="module"`）並行下載，執行順序不保證；
- 元素可能先建立、後連線。

因此「消費者在 Provider 掛載之前發起解析」是常態而非例外。同時：**同步函式無法返回尚未存在的 Provider 值**——晚綁定必然以 async-first 的流 / Promise 為主入口；同步 API 收縮為「已就緒範圍」的熱快照投影（**二等**，不列入穩定契約、可於任何 minor 移除；見 [03-application-api.md](./03-application-api.md) §3.1.1）。

對應場景（全部必須正確；「負責機制」列標明每排的主人，兩路共用同一微任務批次，排序只定義一次）：

| 場景 | 解析路徑 | 負責機制 |
| :--- | :--- | :--- |
| 多 script：inject 先、mount 後 | pending → `context-mount` 喚醒重派發 | Provider 出現喚醒（§9b.4 第一排） |
| vanilla JS inject + React/Vue mount | 跨 bundle：原生事件喚醒 | Provider 出現喚醒（§9b.4 第一排） |
| 並行 script：mount 先、inject 後 | 同步冒泡命中（當下即解） | 同步冒泡（無需喚醒） |
| consumer 當時未連線 | 等待連線事件後再派發 | 消費者搬移重估（§9b.4 第二排） |
| consumer 被 re-parent 到已掛載 Session 下 | 集中觀察者（childList）喚醒 | 消費者搬移重估（§9b.4 第二排） |
| keyed 復甦到新宿主 | 新宿主的 `context-mount` 喚醒 | Provider 出現喚醒（§9b.4 第一排） |

## 9b.2 狀態語意

- **Pending（缺席）不是錯誤**：pending 期間不拋錯、不失敗；只有顯式 `timeoutMs` 逾期才產生 `RESOLUTION_TIMEOUT`。element 與 **Session 目標**皆同——Session 目標的 token 若不存在亦不拋 `UNKNOWN_SERVICE`（藍圖固定，但祖先會話可能後續掛載並經 `context-mount` 喚醒，D-83）。同步面維持現狀：sync 照舊即時錯（見 [03-application-api.md](./03-application-api.md) §3.3.1）。
- **命中定義（全庫逐字同句）**：`single first-emit / multi first-non-empty; empty never settles`（單值首次發射 / 多值首次非空後 `complete()`；空數組永不結案）。同步快照不違反本規則：`requestAll` / `injectAllSync` 的空快照是「當下快照」而非「等待承諾」，空是誠實回答（見 [03-application-api.md](./03-application-api.md) §3.3.1 disambiguator）。
- **空過濾在 port 層**：transport 永不產出空 `complete` / 空發射；空 multi 在用戶視角與缺席無異，繼續 pending（第三方 transport 的空 `complete` 須改為繼續 pending）。
- **Late-provider-miss 誠實行**：settle 後掛載的新 multi provider 不回填已結案消費者；需持續跟蹤請待 P1 `reconnect`（見 [12-roadmap.md](./12-roadmap.md) §12.5）。
- **只由 Mounted Session 應答**：水合與 eager 服務完成、Session 進入 `Mounted` 並派發 `context-mount` 之後才可能命中；消費者永遠拿不到半初始化的 Session。
- **Resolve-once**：`inject$` / `injectAll$` 首次解析（單值發射 / 多值首次非空）後 `complete()`；`inject` / `injectAll` settle 後即完成。Provider 事後離場不影響已 settle 的消費者（跨作用域生命週期由 `abort$` 治理，見 [04-reactivity-rxjs.md](./04-reactivity-rxjs.md) §4.4）。
- **取消與終止**：消費者取消（`signal` abort / unsubscribe）即移除 pending 條目——Observable 面以 `complete()` 終止（理由不進串流）、Promise 面以 `signal.reason` 拒絕（預設平台 `AbortError`）。以明確 Session 為目標的等待，在該 Session 死亡時以 `DISPOSED_SESSION` 終止（Observable error / Promise reject；經 `abort$` 鏈結觀測，facade 本身永不失效故不得輪詢 facade）。多通道競爭（unsubscribe / `signal` / `timeoutMs` / 目標死亡）先到者勝出、僅結案一次。
- **`session$` 是 hot 追蹤器**：`session$` 為永不完成的連續追蹤（host-indexed），不是 token-indexed resolve-once 條目，不佔 `maxPendingPerDocument`（見 §9b.3）；Suspended 期吐 null，resuscitation 重吐同一對象（見 [05-lifecycle-host.md](./05-lifecycle-host.md) §5.5）。

## 9b.3 Pending Request Registry

- **per-Document**：登記表隨 Document 而生；以 `WeakMap<Document, …>` 掛載，不依賴模組全域可變狀態。
- **條目內容**：`{ token, host: WeakRef, callback, kind: 'single' | 'multi' }`；以 token 索引（`Map<tokenString, Set<entry>>`；`PrivateToken` 條目以引用身份成桶、永不跨 bundle 索引）。索引維護紀律：hit / cancel / timeout / death 皆增刪索引；detail 缺 `providedTokens` → 全掃 fallback。
- **捕獲紀律（規範）**：pending 回調 MUST NOT 強 capture host / element / session；重試時由條目 `WeakRef` 重推 ancestry（deref → walk → dispatch，空 → 剪除）；閉包只許捕 token + weak refs + 純量選項（`timeoutMs`、`kind`）。違規 = 非 conformant 實現（實現者義務，非用戶錯誤）。
- **新增時機**：`inject$` 訂閱、`inject` 呼叫、`session$` 訂閱時，若當下無法命中。
- **移除時機**：命中、取消（unsubscribe / `signal` abort）、逾時（`timeoutMs`）、目標 Session 死亡、host 被 GC（WeakRef deref 為空時批次剪除）；冪等——多通道競爭先到者勝出。
- **剪除機制**：每批次先 prune（deref 空 → 連 callback 一起丟 + 拆 abort / timeout 鉤，不重派）；集中觀察者每次回調搭便車 prune，即使不觸發喚醒亦然；插入越過水位武裝一次性 microtask prune-only pass（無重派、無 timer）。`FinalizationRegistry` 僅為既有 backstop，永不作主機制。
- **數量有界**：`maxPendingPerDocument`（機制本次定，數值由 D1 調參）；溢出 oldest-first → 以 `RESOLUTION_TIMEOUT` 結算（Observable error / Promise reject + 移除，附 `errors$` / ledger 註記）。`03 §3.3.1` 的 infinite 讀作時間無界、數量有界；bound 只計 resolve-once token 條目。
- **批次有界**：token 桶選擇 + 每批 K 上限（常數由 D1 調參）、超量鏈式下一個 microtask（全經 `SchedulerPort.microtask`，無 timer、可 fake）、FIFO 防餓死（deferred 先於新 wake）。排序語句：桶內先、餘 FIFO、新 wake 排後。
- **Dev ledger**：dev 構建在 count 越線或 oldest 超齡時警告（count + oldest age + token 樣本，永不含值；warn ≠ settle，永非 determinism point）；prod 剝除零成本。
- **零輪詢**：不設 interval；只在事件發生時以 **微任務批次**（`SchedulerPort.microtask`）合併重試。no-polling / no-resident-timer 不變式保留（見 [02-domain-model.md](./02-domain-model.md) §2.8 #12）。
- **無 pending 時零開銷**：沒有待決條目即不做任何掃描或監聽工作。

## 9b.4 喚醒來源

| 來源 | 事實 | 用途 | 負責場景 |
| :--- | :--- | :--- | :--- |
| `context-mount` | Session 進入 Mounted（派發於宿主） | 喚醒該宿主子樹上的所有 pending（子樹快徑；host GC 中 / 跨 Document adopt 中 / closed-shadow 重定向歧義時走全文件 fallback） | 新 provider 出現於既有消費者之上（§9b.1 第一、二、六排） |
| 集中觀察者（childList / 連線變化） | consumer 被搬移到新祖先、或由 detached 轉為已連線 | 重新評估 ancestry | 既有消費者搬移到既有 provider 之下（§9b.1 第四、五排） |
| `context-dispose` | Session 最終 Disposed | `session$` 追蹤需要；element pending 本身不受影響（Session-target 死亡經 `abort$` 鏈結結算，非事件匹配） | 追蹤面（§9b.2 `session$` 行） |
| 外部 `data-context-key` 變更 | SSR 序列化身份等外部 key 寫入 | 入列重估（自致回寫 / 移除被過濾，不喚醒） | Key 身份握手（見 [09-infrastructure.md](./09-infrastructure.md) §9.4） |

重試流程（微任務批次；兩路共用同一 microtask batch，排序只定義一次）：

```
批次開始 → 先 prune（deref 空即丟，見 §9b.3）
        → 對每個 pending 條目重派發 context-request（沿祖先鏈；token 桶快徑，無 token 資訊時全掃 fallback）
        → 命中：回呼、移除條目；未命中：保留（超 K 鏈式下一個 microtask）
批次結束（同一幀內的喚醒合併為一次）
```

## 9b.5 規範性生命週期事件

以下 CustomEvent 是**公共契約**（跨 bundle / 框架共用），必須完整實作：

```ts
export interface ContextLifecycleEventDetail {
    readonly token: string | null   // keyed 身分（匿名為 null）
    readonly providedTokens?: ReadonlyArray<string>   // 本次掛載提供的 service-token 字串；缺席即 keyed-only / legacy 派發，走 Q2-C fallback
}

// Session 進入 Mounted（水合 + eager 完成）後，於宿主派發：
new CustomEvent('context-mount', {
    bubbles: true,
    composed: true,
    cancelable: false,
    detail: { token, providedTokens } satisfies ContextLifecycleEventDetail
})

// Session 最終 Disposed 後，於宿主派發：
new CustomEvent('context-dispose', {
    bubbles: true,
    composed: true,
    cancelable: false,
    detail: { token } satisfies ContextLifecycleEventDetail
})
```

- `composed: true` 保證穿透 Shadow DOM；`bubbles: true` 保證祖先鏈可攔截。
- 跨 bundle 規則：未知欄位忽略；缺 `providedTokens` → fallback 路徑（全掃）；`PrivateToken` 永不進 `providedTokens`（引用身份桶走子樹掃描）。
- `suspend` / `resuscitate` / `adopt` 的生命週期事實由集中觀察者內部處理；是否另立原生事件保留 P1（不影響本節語意）。

## 9b.6 跨 bundle / 跨框架

- 喚醒訊號是**原生 DOM 事件**：不同 library 副本（多 bundle、多版本並存）各自持有 registry，也能互相喚醒——副本 A 的 pending 由副本 B 掛載時派發的 `context-mount` 喚醒。子樹快徑 + token 桶快徑生效以 `providedTokens` 出現為條件；keyed-only / legacy 派發走 fallback，行為仍正確。
- 不作模組級共享狀態；`context-request` / `context-mount` / `context-dispose` 是唯一媒介。

## 9b.7 複雜度與無洩漏

- 規範界 = Σ（被重試集合 × 祖先鏈長度）：fallback 路徑為全 registry，token 桶 + 子樹快徑下為匹配 token 子樹 pendings × 深度（快徑段以 `providedTokens` 生效為條件）。
- registry 條目僅以 `WeakRef` 持有宿主，且回調不得強持 host / element / session（捕獲紀律見 §9b.3）；宿主 GC 後條目於下一批次剪除。
- 取消（unsubscribe / `signal`）、逾時與目標死亡皆即時移除條目；不殘留計時器與監聽。
- 不保留任何已 settle 的請求。
- 誠實殘留句：全靜默文件（無喚醒、無插入活動）的死條目滯留到下一個無關 wake；實質保護靠 `maxPendingPerDocument` 背壓（見 §9b.3），非掃描。

## 9b.8 限制（誠實聲明）

- **外庫消費者無法被追回**：第三方（不使用本庫）在 Provider 掛載前送出的一次性 `context-request` 沒有 replay 機制，社區協議本身如此；本庫的晚綁定保證僅覆蓋本庫消費者。
- **Observable 取消不攜帶理由**：串流面取消一律 `complete()`（與退訂一致）；`signal.reason` 只透過 Promise 面傳遞。需要理由請用 `inject` / `injectAll`。
- **自引用等待（死鎖）**：`eager` 工廠內以 element 目標等待「自己所在會話」掛載 = 互等死鎖（`mount` 等 eager、eager 等 `Mounted`）；工廠內一律用 Session 目標，`timeoutMs` 僅作逃生（D-81）。
- **Async 環 = 設計上 deadlock**：跨服務 async 等待環（A↔B）無規範偵測，唯一規範出口為顯式 `timeoutMs` → `RESOLUTION_TIMEOUT`；預設無限 = 預設掛起（hang 是規範行為，不是 bug）；`CIRCULAR_DEPENDENCY` 嚴格 sync-only，same-chain async 偵測記 P1（見 [12-roadmap.md](./12-roadmap.md)）。工廠面建議配 `timeoutMs` 作逃生。
- **SSR 無元素目標晚綁定**：server 端無 DOM 事件與元素消費者；伺服器資料載入走 eager providers / `mount`（見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.7）。Session-target server 等待僅限訂閱時已 InFlight 的同 session 項，真缺席在 ssr adapter 下 fast-reject `UNKNOWN_SERVICE`（與 [09-infrastructure.md](./09-infrastructure.md) §9.7 / [03-application-api.md](./03-application-api.md) §3.3.1 同字）。
- **`getSessionSync(el)` 為快照**：需要「等待 Session 出現」請用 `session$(el)` / `inject`。

## 9b.9 不變式

1. 元素目標的解析與 `mount` 順序無關：先 inject 後 mount、先 mount 後 inject、被搬移、先 detached 後連線，皆正確。
2. 缺席 = pending，不是錯誤；錯誤僅來自顯式 `timeoutMs` 或銷毀等明確事實。
3. 只有 Mounted Session 應答；`context-mount` 於水合完成後派發。
4. pending registry 為 per-Document：無輪詢、無強引用、無常駐計時器；數量有界（`maxPendingPerDocument`）、批次有界（token 桶 + K + FIFO）。
5. `context-mount` / `context-dispose` 為規範性公共事件（`bubbles` + `composed`）；`providedTokens` 缺席即 fallback，行為仍正確。
6. `inject$` / `injectAll$` resolve-once：`single first-emit / multi first-non-empty; empty never settles`；不因 Provider 離場重新解析。
7. 全 async 解析 API 與 `mount` 接受 `signal`；取消、逾時、目標死亡皆即時結案且冪等，無殘餘資源。
