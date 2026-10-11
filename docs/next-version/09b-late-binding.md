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

對應場景（全部必須正確）：

| 場景 | 解析路徑 |
| :--- | :--- |
| 多 script：inject 先、mount 後 | pending → `context-mount` 喚醒重派發 |
| vanilla JS inject + React/Vue mount | 跨 bundle：原生事件喚醒 |
| 並行 script：mount 先、inject 後 | 同步冒泡命中（當下即解） |
| consumer 當時未連線 | 等待連線事件後再派發 |
| consumer 被 re-parent 到已掛載 Session 下 | 集中觀察者（childList）喚醒 |
| keyed 復甦到新宿主 | 新宿主的 `context-mount` 喚醒 |

## 9b.2 狀態語意

- **Pending（缺席）不是錯誤**：pending 期間不拋錯、不失敗；只有顯式 `timeoutMs` 逾期才產生 `RESOLUTION_TIMEOUT`。element 與 **Session 目標**皆同——Session 目標的 token 若不存在亦不拋 `UNKNOWN_SERVICE`（藍圖固定，但祖先會話可能後續掛載並經 `context-mount` 喚醒，D-83）。
- **只由 Mounted Session 應答**：水合與 eager 服務完成、Session 進入 `Mounted` 並派發 `context-mount` 之後才可能命中；消費者永遠拿不到半初始化的 Session。
- **Resolve-once**：`inject$` / `injectAll$` 首次解析（單值發射 / 多值首次非空）後 `complete()`；`inject` / `injectAll` settle 後即完成。Provider 事後離場不影響已 settle 的消費者（跨作用域生命週期由 `abort$` 治理，見 [04-reactivity-rxjs.md](./04-reactivity-rxjs.md) §4.4）。
- **取消與終止**：消費者取消（`signal` abort / unsubscribe）即移除 pending 條目——Observable 面以 `complete()` 終止（理由不進串流）、Promise 面以 `signal.reason` 拒絕（預設平台 `AbortError`）。以明確 Session 為目標的等待，在該 Session 死亡時以 `DISPOSED_SESSION` 終止（Observable error / Promise reject）。多通道競爭（unsubscribe / `signal` / `timeoutMs` / 目標死亡）先到者勝出、僅結案一次。

## 9b.3 Pending Request Registry

- **per-Document**：登記表隨 Document 而生；以 `WeakMap<Document, …>` 掛載，不依賴模組全域可變狀態。
- **條目內容**：`{ token, host: WeakRef, callback, kind: 'single' | 'multi' }`；以 token 索引。
- **新增時機**：`inject$` 訂閱、`inject` 呼叫、`session$` 訂閱時，若當下無法命中。
- **移除時機**：命中、取消（unsubscribe / `signal` abort）、逾時（`timeoutMs`）、目標 Session 死亡、host 被 GC（WeakRef deref 為空時批次剪除）；冪等——多通道競爭先到者勝出。
- **零輪詢**：不設 interval；只在事件發生時以 **微任務批次**（`SchedulerPort.microtask`）合併重試。
- **無 pending 時零開銷**：沒有待決條目即不做任何掃描或監聽工作。

## 9b.4 喚醒來源

| 來源 | 事實 | 用途 |
| :--- | :--- | :--- |
| `context-mount` | Session 進入 Mounted（派發於宿主） | 喚醒該宿主祖先鏈上的所有 pending |
| 集中觀察者（childList / 連線變化） | consumer 被搬移到新祖先、或由 detached 轉為已連線 | 重新評估 ancestry |
| `context-dispose` | Session 最終 Disposed | `session$` 追蹤需要；pending 本身不受影響 |

重試流程（微任務批次）：

```
批次開始 → 對每個 pending 條目重派發 context-request（沿祖先鏈）
        → 命中：回呼、移除條目；未命中：保留
批次結束（同一幀內的喚醒合併為一次）
```

## 9b.5 規範性生命週期事件

以下 CustomEvent 是**公共契約**（跨 bundle / 框架共用），必須完整實作：

```ts
export interface ContextLifecycleEventDetail {
    readonly token: string | null   // keyed 身分（匿名為 null）
}

// Session 進入 Mounted（水合 + eager 完成）後，於宿主派發：
new CustomEvent('context-mount', {
    bubbles: true,
    composed: true,
    cancelable: false,
    detail: { token } satisfies ContextLifecycleEventDetail
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
- `suspend` / `resuscitate` / `adopt` 的生命週期事實由集中觀察者內部處理；是否另立原生事件保留 P1（不影響本節語意）。

## 9b.6 跨 bundle / 跨框架

- 喚醒訊號是**原生 DOM 事件**：不同 library 副本（多 bundle、多版本並存）各自持有 registry，也能互相喚醒——副本 A 的 pending 由副本 B 掛載時派發的 `context-mount` 喚醒。
- 不作模組級共享狀態；`context-request` / `context-mount` / `context-dispose` 是唯一媒介。

## 9b.7 複雜度與無洩漏

- 單次重試成本 = Σ(pending 條目 × 祖先鏈長度)；批次合併 + token 索引使典型成本極低。
- registry 僅以 `WeakRef` 持有宿主，**零強引用**；宿主 GC 後條目於下一批次剪除。
- 取消（unsubscribe / `signal`）、逾時與目標死亡皆即時移除條目；不殘留計時器與監聽。
- 不保留任何已 settle 的請求。

## 9b.8 限制（誠實聲明）

- **外庫消費者無法被追回**：第三方（不使用本庫）在 Provider 掛載前送出的一次性 `context-request` 沒有 replay 機制，社區協議本身如此；本庫的晚綁定保證僅覆蓋本庫消費者。
- **Observable 取消不攜帶理由**：串流面取消一律 `complete()`（與退訂一致）；`signal.reason` 只透過 Promise 面傳遞。需要理由請用 `inject` / `injectAll`。
- **自引用等待（死鎖）**：`eager` 工廠內以 element 目標等待「自己所在會話」掛載 = 互等死鎖（`mount` 等 eager、eager 等 `Mounted`）；工廠內一律用 Session 目標，`timeoutMs` 僅作逃生（D-81）。
- **SSR 無晚綁定**：server 端無 DOM 事件與元素消費者；伺服器資料載入走 eager providers / `mount`（見 [07-ssr-hydration.md](./07-ssr-hydration.md) §7.7）。
- **`getSessionSync(el)` 為快照**：需要「等待 Session 出現」請用 `session$(el)` / `inject`。

## 9b.9 不變式

1. 元素目標的解析與 `mount` 順序無關：先 inject 後 mount、先 mount 後 inject、被搬移、先 detached 後連線，皆正確。
2. 缺席 = pending，不是錯誤；錯誤僅來自顯式 `timeoutMs` 或銷毀等明確事實。
3. 只有 Mounted Session 應答；`context-mount` 於水合完成後派發。
4. pending registry 為 per-Document：無輪詢、無強引用、無常駐計時器。
5. `context-mount` / `context-dispose` 為規範性公共事件（`bubbles` + `composed`）。
6. `inject$` / `injectAll$` resolve-once：首次解析後 `complete()`，不因 Provider 離場重新解析。
7. 全 async 解析 API 與 `mount` 接受 `signal`；取消、逾時、目標死亡皆即時結案且冪等，無殘餘資源。
