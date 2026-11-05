# 06 — 術語

本表只服務 `docs/next-version/`。

| 術語 | 定義 |
| :--- | :--- |
| **Blueprint** | Phase 1 的不可變描述。包含種子狀態、依賴註冊與鉤子。 |
| **Application** | `createApplication(ports)` 的產物。Phase 2 動詞與 session 索引綁在同一實例上。 |
| **createApplication** | 組合根：注入 `host`（與可選 `ssr`）ports，回傳 `Application`。 |
| **Session** | `mount` 同步交還的句柄。狀態、依賴快取與 `ready` 都掛在它上面。 |
| **ready** | 初始化完成的 Promise。fulfill 不表示此後狀態不再變。 |
| **starting** | 已有 Session，種子、`update` 重放與 eager 尚未結束。 |
| **active** | 初始化已成功，宿主已連線。`onMount` 已跑過，或即將在同一輪跑完。 |
| **suspended** | keyed 會話確認離開文件，TTL 內仍保留狀態。 |
| **disposed** | 不再接受更新與注入。 |
| **Host** | 會話綁定的節點外觀。恢復後仍是同一個 `host` 物件。 |
| **掛載對象** | `mount(...)(target)` 的最後一段：瀏覽器為已連線 `Element`；SSR 為 `serverHost`。 |
| **serverHost** | 非 DOM 占位宿主；每請求一個；不支援元素晚綁定。 |
| **LateTarget** | `inject` 的目標：`Element`（瀏覽器）或 `Session`。與掛載對象不同。`HostPort` 是內部概念，不出現在公共面。 |
| **Scope** | 從目標沿父節點與 shadow host 向上的那條鏈。 |
| **Token** | 依賴或 keyed 身分的名字。公開 token 由 `defineToken<T>(visibility?)(name)` 定義；runtime 為字串，跨 script 散落可用。 |
| **Scatter-usable** | 各 script 獨立 `defineToken` 同名即等價，無全域 token 物件 registry。 |
| **uses** | 工廠宣告的依賴。執行期在呼叫工廠前把它們做成值。 |
| **Lazy** | 預設。第一次 `inject` 才執行工廠。 |
| **Eager** | 掛載初始化的一部分。`ready` 會等待。 |
| **scoped** | 每個 Session 一份依賴。對應 .NET Scoped。 |
| **singleton** | 每個 Document 一份；SSR 上每個請求一份。對應 Spring / .NET Singleton。 |
| **transient / prototype** | 每次 `inject` 新建。`prototype` 是 `transient` 的別名。對應 .NET Transient 與 Spring prototype。 |
| **multi** | `provide` 選項。`true` 時只由 `injectAll` / `injectAll$` 收集；與單值 `inject` 並存時，單值仍 nearest-wins。 |
| **from-bottom-to-top** | `injectAll` 的預設 `direction`：作用域鏈由近到遠（自底向頂）。 |
| **from-top-to-bottom** | `injectAll` 的 `direction`：作用域鏈由遠到近（自頂向底）。 |
| **Late binding** | 元素上的 `inject` 可以早於提供者的 `mount`。提供者進入 `active` 後請求再問一次。 |
| **context-request** | 晚綁定消費者派發的 DOM 事件；沿 composed 祖先鏈冒泡。`detail.context` 為 token。 |
| **context-mount** | 提供者宿主在 Session **active** 後派發；喚醒 pending 的 inject。 |
| **context-dispose** | 提供者宿主在 Session **disposed** 後派發。 |
| **merge** | 純函式。純物件按鍵遞迴合併，不刪鍵，不寫入會話。 |
| **pinned** | `retention: 'pinned'`：這份 keyed 會話不受暫停上限影響，也不因 TTL 到期而銷毀；只會被明確 `dispose` 或因衝突而銷毀。 |
| **pending 注入** | 已經發出、尚未解析的注入請求。元素目標上可能長期存在；有 Application 級上限。 |
| **resolved 旗標** | `context-request` 的 `detail` 上的旗標。第一個有效回應者設為 `true`，後續提供者因此跳過——nearest-wins 不依賴 `stopPropagation`。 |
| **ConnectivityPort** | 回答「這個宿主現在連線嗎」、並在連線事實變化時通知的埠。DOM 之外的平台由此自訂語意。 |
| **cap** | 暫停中的 keyed 會話超過上限時，最舊的一份以此理由銷毀。 |
| **onResume** | 暫停的 keyed 會話在 TTL 內回到連線宿主。狀態保留，不回到種子。 |
| **匿名會話** | 沒有 `token`。確認斷線即銷毀，不暫停。 |
