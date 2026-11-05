# 14 — Ports 契約

ports 是**架構邊界**，不是公共 API。本章說明每個埠**負責什麼**，以及跨平台時連線事實從哪裡來。

> 本章固定的是**職責與邊界**。介面的確切簽章、泛型參數與方法名稱於**實作期**決定。

分層方向：**`domain` ← `application` ← `infrastructure`**。`application` **不得** import `infrastructure`；DOM 細節只能經 ports 進入 Phase 2。唯一的組合根在套件根入口。

---

## 14.1 埠的清單

| 埠 | 職責 | 誰提供 |
| :--- | :--- | :--- |
| **host adapter** | 把掛載對象與注入目標正規成內部宿主表徵；掛載連線性 | `createApplication` 的呼叫者 |
| **connectivity** | 回答「這個宿主現在連線嗎」，並在事實變化時通知 | 隨 host adapter 一起提供 |
| **scheduler** | 微任務、逾時、影格；庫內所有時間行為 | 隨 host adapter 一起提供 |
| **scope transport** | 作用域傳輸與 Context Protocol 事件匯流排 | 隨 host adapter 一起提供 |
| **tokens** | keyed 身分在宿主上的讀寫 | 隨 host adapter 一起提供 |
| **ssr** | 伺服器占位宿主與請求級隔離 | 選填 |

## 14.2 連線性：跨平台的關鍵

**整個生命週期模型都由「宿主是否連線」驅動**：`active → suspended → disposed`。因此「連線」必須是**可插拔的**，否則這個庫只能是 DOM 專用。

| 環境 | 連線的語意 | 誰提供 |
| :--- | :--- | :--- |
| 瀏覽器 | 節點在文件中（`isConnected`） | DOM adapter，內建集中觀察者 |
| 非 DOM 平台（Canvas、原生 view、WebView、測試替身） | 由 adapter 自行定義 | 平台 adapter，或 `attach` 的等價機制 |
| SSR | 永遠連線；請求結束即 `dispose` | SSR adapter |

連線埠必須提供兩件事：

1. **當下狀態**：這個宿主現在算不算連線。
2. **變化通知**：狀態改變時通知執行期，執行期再走「微任務重掛確認 → 暫停或銷毀」流程。

這兩件事在 DOM adapter 裡由集中觀察者實作；在非 DOM 平台則由 adapter 自行實作。`attach`（[03-dom](./03-dom.md) §3.4）是**使用者端**的轉發通道，與觀察者描述同一個事實、後到者不重複觸發——它**不是**取代連線埠的手段，而是讓已有會話接受外部連線訊號的途徑。

## 14.3 排程

庫內**不在動詞裡裸用** `setTimeout` / `queueMicrotask` / `requestAnimationFrame`。需要時間的地方只有四處，全部經排程埠：斷線的微任務重掛確認、keyed 會話的暫停 TTL、pending 注入的批次喚醒、觀察者的重檢。

| 能力 | 用途 | 退化規則 |
| :--- | :--- | :--- |
| 微任務 | 重掛確認、批次喚醒、觀察者重檢 | 不可退化 |
| 逾時 | 暫停 TTL | 不可退化 |
| 影格 | 保留給使用者側高頻渲染自組 | 沒有時退化為微任務 |

SSR 與測試注入假排程器，使時間行為確定化。

## 14.4 作用域傳輸

作用域傳輸埠負責兩件事：**在同一個 Application 內**解析作用域鏈，以及**跨 Application / 跨 bundle** 的 Context Protocol 事件匯流排。

### 兩層傳輸

| 層 | 通路 | 範圍 |
| :--- | :--- | :--- |
| **同 Application** | 記憶體內的宿主索引 + composed 祖先鏈 walk | 同一 Application 內的會話 |
| **跨 Application** | DOM `context-request` 事件 | 同一 Document 內，不論哪個 Application 掛載 |

同 Application 走記憶體索引是**效能與確定性**考量；跨 Application 才繞 DOM 事件。

**nearest-wins 在兩層都成立**：同 Application 內由祖先鏈的近→遠順序決定；跨 Application 時由 DOM 冒泡順序決定（內側祖先先收到事件）。因此同頁多個 Application 不需要額外的協調機制。

### 傳輸埠的權威性

傳輸埠宣告自己是否**看得到環境中的每一個提供者**（`authoritative`）：

| 環境 | `authoritative` | 意義 |
| :--- | :--- | :--- |
| 伺服器（每請求一個 Application） | `true` | 伺服器沒有事件匯流排，找不到就是找不到 |
| 測試用的假傳輸 | `true` | 假環境完整索引 |
| 瀏覽器 DOM 傳輸 | `false` | 同一份 Document 可能還有**另一個 bundle** 提供本 bundle 看不到的 token |

`authoritative: false` 的傳輸在記憶體索引**落空**時必須先問一次事件匯流排，才把「落空」當成最終結果。這是跨 bundle 解析與跨 bundle 晚綁定成立的條件：消費端 bundle 看不到提供者 bundle 的索引，只能靠 `context-request` 問（[10-events.md](./10-events.md) §10.5）。

同一 Application 內的**解析成功**永遠走記憶體索引，不產生 `context-request` 事件（`PORT #5`）。

## 14.5 keyed 身分

keyed 身分寫在宿主上（瀏覽器預設是 `data-context-key`）。令牌埠只負責兩件事：

1. 從宿主**讀取**既有的 keyed 身分（外部工具可能先寫好）。
2. 把本次 `mount` 的 `token` **寫回**宿主。

讀寫都走與 `defineToken` 共用的名稱驗證（[12-errors](./12-errors.md) §12.4 的 `TOKEN_INVALID`）。會話最終銷毀且屬性仍等於自己的 token 時移除該屬性。

## 14.6 Application 級狀態與上限

以下狀態**歸 Application 實例所有**，不得放在 module 全域：

| 狀態 | 說明 |
| :--- | :--- |
| 宿主 → 會話索引 | `sessionAt` / `session$` 的資料來源 |
| keyed 暫存表 | 暫停中的 keyed 會話，TTL 內可恢復 |
| singleton 槽 | 每個 Application 一份；先註冊者勝 |
| pending 注入表 | 尚未解析的元素目標請求 |
| 作用域傳輸狀態 | 晚綁定路徑的索引與失效記錄 |

### 上限

| 上限 | 預設 | 超出時 |
| :--- | :--- | :--- |
| 同時暫停的 keyed 會話數 | 32 | 最舊的一份銷毀，`reason: 'cap'` |
| 同時 pending 的注入請求數 | 1024 | 新的等待請求以 `PENDING_LIMIT_EXCEEDED` 拒絕 |

兩者都是 **Application 級**設定，可在建立 Application 時調整。暫停上限的歸屬必須與 singleton 一致——**同一 Application 內計數**，不跨 Application 合併。

## 14.7 Application 的生命週期

`Application` 是已裝配好的執行期殼層。它持有 §14.6 的全部狀態，因此**必須能被整體釋放**：

- `Application` 提供**冪等**的釋放操作，釋放索引、暫存表、singleton 槽與它建立的監聽器。
- SSR 每個請求一個 Application；請求結束時先 `dispose(session)`，再釋放 Application 實例。singleton 不得活過請求。
- 瀏覽器端通常整頁一個 Application，隨頁面生命存在，不主動釋放。

## 14.8 預設與便捷入口

`createApplication` 需要一組埠。使用者不該為了「正常用一次」而自組 adapter，因此：

- 根入口預先裝好一個**預設 Application**，其 verbs 作用於這一份實例。
- 提供**便捷入口**取得內建 adapter 的 Application：瀏覽器用的、SSR 用的各一個。
- 進階使用者仍可自組 adapter 呼叫 `createApplication`。

### 跨 Application 操作的規則

對某個 `Session` 做 `update` / `inject` / `dispose` 的 Application，**必須是 mount 出該 Session 的那一個**。跨實例操作同一 `Session` 的結果是**未定義的**，實作**應當拒絕**（拋錯），不得靜默 no-op。

根入口的 verbs 只作用於根 Application。若頁面上另有自建的 Application 實例，兩者的 Session **不得**混用。

## 14.9 SSR 埠

SSR 埠提供：

- **占位宿主**：每請求一個，沒有父子鏈、不派發事件、不參與暫停表。
- **請求級隔離**：singleton 槽與 keyed 暫存表歸屬本請求的 Application。

SSR 上沒有元素目標的晚綁定；`inject` 以 `Session` 為目標，缺席即 `UNKNOWN_SERVICE`。細節見 [05-ssr](./05-ssr.md)。

## 14.10 不變式

| # | 不變式 |
| :--- | :--- |
| `PORT #1` | `domain` 不得 import `application` / `infrastructure`，不得觸碰 DOM 全域。 |
| `PORT #2` | `application` 不得 import `infrastructure`；DOM 細節只經 ports 進入 Phase 2。 |
| `PORT #3` | 不得在 module 全域放 mutable 狀態；隔離邊界是 Application 實例。 |
| `PORT #4` | 庫內所有時間行為經排程埠；動詞裡不得裸用 `setTimeout` / `queueMicrotask`。 |
| `PORT #5` | 同一 Application 內的解析走記憶體索引；跨 Application 才走 DOM 事件。 |
| `PORT #6` | singleton 槽、keyed 暫存表、pending 注入表、暫停上限全部歸 Application 實例。 |
| `PORT #7` | 連線事實必須可插拔；DOM 之外的平台由 adapter 自訂語意。 |
| `PORT #8` | 每個 adapter 都可被假實作替換，以進行確定性測試。 |

## 14.11 與其它章節的分工

- 組合根與 Application 個數：[11-composition](./11-composition.md)
- DOM 連線與 `attach`：[03-dom](./03-dom.md) §3.4
- 掛載對象與 SSR 宿主：[09-mount-host](./09-mount-host.md)
- 排程語意：[13-reactivity](./13-reactivity.md) §13.8
- 測試替身：[15-testing](./15-testing.md)
