# 19. 不變式對照表索引與裁定一致性追蹤

> 本文為 `@sandlada/document-context` 規範不變式與實作的一致性追蹤矩陣（依據 `TASK1.md` 與 2026-11-06 稽核結論）。
> 狀態定義：
> - **已實作**：實作完全符合規範，且有測試保護。
> - **已修正中**：實作與契約存在偏差，排定於 TASK1 Milestone M1–M5 執行修復與補測。
> - **已裁決為文件漂移**：實作行為屬刻意設計或最優解，契約經裁定予以更新（見 [15-testing.md](./15-testing.md) §15.2.7）。

---

## 19.1 生命週期與鉤子 (`LC #n`)

| ID | 不變式簡述 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- |
| `LC #1` | `mount` 同步回傳 `Session`（狀態為 `starting`） | **已實作** | [01-api](./01-api.md) §1.1 |
| `LC #2` | `ready` 初始化完成條件與斷線分流 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.1 |
| `LC #3` | 斷線後微任務重掛確認 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.3 |
| `LC #4` | 匿名斷線 disposed、keyed 轉 suspended 保留狀態 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.3 |
| `LC #5` | keyed 會話在 TTL 內以同一 token 復甦 | **已實作** | A-1 `onMount` 不重跑；A-2 恢復後重掛連線觀察 |
| `LC #6` | TTL 到期 disposed、`pinned` 豁免 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.3 |
| `LC #7` | Application 級暫停上限（最舊淘汰、不跨實例合併） | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.3 |
| `LC #8` | 鉤子順序（FIFO / LIFO）與清理函式單次執行 | **已實作** | A-1 清理函式不因復甦重複登記 |
| `LC #9` | `onMount` 失敗 fatal 拒絕；其餘鉤子失敗走 `errors$` 繼續執行 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.2 |
| `LC #10` | `dispose` 同步中止 abort 邊界與串流完成 | **已實作** | B-1 Session 目標 pending 在 dispose 時以 `DISPOSED_SESSION` 結束 |
| `LC #11` | 復甦時重新派發 `context-mount` | **已實作** | `context-protocol.integration-test.ts`「恢復時重新派發 context-mount」 |
| `LC #12` | `starting` 期間 `update` 依序重放 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.1 |
| `LC #13` | `onConflict: 'reset'` 以舊狀態作種子換源 | **已實作** | [02-lifecycle](./02-lifecycle.md) §2.3 |

---

## 19.2 作用域、解析與注入生命週期 (`SCOPE #n`)

| ID | 不變式簡述 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- |
| `SCOPE #1` | composed 祖先鏈解析、近者勝、單值永遠 nearest-wins | **已實作** | [03-dom](./03-dom.md) §3.2 |
| `SCOPE #2` | 作用域鏈不跨 Document；ShadowRoot 穿透 | **已實作** | [03-dom](./03-dom.md) §3.2 |
| `SCOPE #3` | 同 Application 走記憶體索引、跨 Application 走 DOM 事件 | **已實作** | [14-ports](./14-ports.md) §14.4 |
| `SCOPE #4` | 跨 Application nearest-wins 依冒泡順序與 `detail.resolved` 結算 | **已實作** | [10-events](./10-events.md) §10.1.1 |
| `SCOPE #5` | 僅 `multi: true` 註冊被 `injectAll` 收集 | **已實作** | [04-promise-lazy](./04-promise-lazy.md) §4.5 |
| `SCOPE #6` | `injectAll` 順序反轉與宿主內保持 FIFO | **已實作** | 跨 bundle 只反轉宿主分組，宿主內註冊順序保持 |
| `SCOPE #7` | `uses` 依賴在工廠前就緒、`use()` 同步存取 | **已實作** | [01-api](./01-api.md) §1.4 |
| `SCOPE #8` | `uses` 環拒絕且環上工廠不執行；動態自我等待環偵測 | **已實作** | `uses` 環與工廠同步 `inject` 自己都拒絕 `CIRCULAR_DEPENDENCY` |
| `SCOPE #9` | scoped / singleton / transient 語義與 singleton 先註冊者勝 | **已實作** | 後註冊的 singleton 在解析期不執行工廠 |
| `SCOPE #10` | 進行中 Promise 合併、失敗清快取重試 | **已實作** | [08-injection](./08-injection.md) §8.1 |
| `SCOPE #11` | keyed 身分載體 `data-context-key` 與名稱驗證 | **已實作** | A-3 換宿主屬性搬移；D-2 寫入時拒絕非法 key 名 |
| `SCOPE #12` | 元素目標 pending；Session 目標立即拒絕除非 `wait: true` | **已實作** | `injectAll` 在 Session 上帶 `wait: true` 時進入 pending |
| `SCOPE #13` | Application 級 pending 數量上限與拒絕 | **已實作** | [04-promise-lazy](./04-promise-lazy.md) §4.5 |
| `SCOPE #14` | 跨 Application 操作 Session 嚴格拒絕 | **已實作** | [11-composition](./11-composition.md) §11.4 |

---

## 19.3 公共動詞語義 (`API #n`)

| ID | 不變式簡述 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- |
| `API #1` | 動詞柯里化資料後置、四種例外 | **已實作** | [01-api](./01-api.md) §1.1 |
| `API #2` | 無 `Sync`/`Async` 後綴；`$` 僅指 Observable | **已實作** | `public-surface.unit-test.ts` 掃描五個入口 |
| `API #3` | `update` 整份替換、disposed 回傳 `false` | **已實作** | [01-api](./01-api.md) §1.5 |
| `API #4` | updater 拋錯原樣外拋、狀態不變 | **已實作** | [01-api](./01-api.md) §1.5 |
| `API #5` | updater 必須同步、型別不含 Promise | **已實作** | `@ts-expect-error` 守住回傳 `Promise` |
| `API #6` | `merge` 純函式純物件遞迴、禁用原型鍵、循環引用拋錯 | **已實作** | 未改到的巢狀純物件也複製，改結果不影響來源 |
| `API #7` | 快照不可變性保證與種子複製 | **已裁決為文件漂移** | E-2（種子複製；呼叫者不得主動修改，無 Object.freeze） |
| `API #8` | `suspended` 期間允許 `update` 並推送 `state$` | **已實作** | [01-api](./01-api.md) §1.5 |
| `API #9` | `read` 同步快照、disposed 回傳最後一筆 | **已實作** | [01-api](./01-api.md) §1.5 |
| `API #10` | `inject` 家族不接受 signal / timeoutMs | **已實作** | `@ts-expect-error` 守住 `timeoutMs` 與 `signal` |
| `API #11` | `inject$` / `injectAll$` resolve-once | **已實作** | [13-reactivity](./13-reactivity.md) §13.6 |
| `API #12` | `defineToken` 冪等、私有 token 退役 | **已實作** | [07-tokens](./07-tokens.md) §7.1 |
| `API #13` | 非法 token 名拋 `TOKEN_INVALID`、私有不驗證 | **已實作** | `provide` / `inject` 對公開名呼叫 `validateTokenName` |
| `API #14` | 未連線元素 throw UNCONNECTED_HOST、非元素 HOST_INVALID | **已實作** | [09-mount-host](./09-mount-host.md) §9.2 |
| `API #15` | `Infinity` 未搭配 `pinned` 拋 `INVALID_OPTIONS` | **已實作** | [01-api](./01-api.md) §1.3 |
| `API #16` | signal 僅在 `starting` 生效，abort 拒絕 `signal.reason` | **已實作** | [01-api](./01-api.md) §1.3 |
| `API #17` | 身分衝突依 `onConflict` 處理；跨宿主硬失敗 | **已實作** | 跨宿主 `KEYED_CONFLICT` 在銷毀同宿主會話之前拒絕；`replace` 復甦暫停會話時不留舊會話 |
| `API #18` | disposed 會話 inject 拒絕 DISPOSED_SESSION、update 回傳 false | **已實作** | [12-errors](./12-errors.md) §12.4 |
| `API #19` | 注入目標僅限 Element / Session；SSR 禁元素目標 | **已實作** | [09-mount-host](./09-mount-host.md) §9.9 |
| `API #20` | `session.ready` fulfill 不代表狀態不再變 | **已實作** | [06-glossary](./06-glossary.md) |

---

## 19.4 串流反應式語義 (`RX #n`)

| ID | 不變式簡述 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- |
| `RX #1` | `state$` 恆為熱流、新訂閱立即取得當前快照 | **已實作** | [13-reactivity](./13-reactivity.md) §13.2 |
| `RX #2` | 狀態推送同步發生、僅推送引用不同快照 | **已實作** | [13-reactivity](./13-reactivity.md) §13.2 |
| `RX #3` | `state$` / `lifecycle$` 在 disposed 完成；`errors$` 清理結算後完成 | **已實作** | [13-reactivity](./13-reactivity.md) §13.3 |
| `RX #4` | `errors$` 永不以 error 結束、緩衝上限 32 筆 | **已實作** | [13-reactivity](./13-reactivity.md) §13.3 |
| `RX #5` | `lifecycle$` 只背靠當前狀態那一筆 | **已實作** | [13-reactivity](./13-reactivity.md) §13.4 |
| `RX #6` | `inject$` / `injectAll$` 冷流 resolve-once | **已實作** | [13-reactivity](./13-reactivity.md) §13.6 |
| `RX #7` | 內部訂閱以 abort 邊界收斂、銷毀後無活動訂閱 | **已實作** | B-1 Session 目標 pending 監聽 `abortSignal` |
| `RX #8` | 時間行為經排程埠、狀態推送不同步排程 | **已實作** | [13-reactivity](./13-reactivity.md) §13.8 |
| `RX #9` | `session$` 只認 active 且宿主連線會話 | **已裁決為文件漂移** | E-4（冷流行為合理，文件更新標註） |
| `RX #10` | 取消退訂不寫入 `errors$`、不轉失敗識別碼 | **已實作** | [13-reactivity](./13-reactivity.md) §13.7 |

---

## 19.5 連接埠與架構邊界 (`PORT #n`)

| ID | 不變式簡述 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- |
| `PORT #1` | `domain` 不得 import application / infrastructure、不碰 DOM 全域 | **已實作** | [14-ports](./14-ports.md) §14.1 |
| `PORT #2` | `application` 不得 import infrastructure | **已實作** | [14-ports](./14-ports.md) §14.1 |
| `PORT #3` | module 全域無 mutable 狀態、隔離邊界為 Application 實例 | **已實作** | [14-ports](./14-ports.md) §14.6 |
| `PORT #4` | 時間行為經排程埠、禁裸用 setTimeout / queueMicrotask | **已實作** | [14-ports](./14-ports.md) §14.3 |
| `PORT #5` | 同 Application 走記憶體索引、跨 Application 走 DOM 事件 | **已實作** | [14-ports](./14-ports.md) §14.4 |
| `PORT #6` | singleton 槽、keyed 暫存表、pending 注入表歸 Application 實例 | **已裁決為文件漂移** | D-5（provider 索引維持 Document 級） |
| `PORT #7` | 連線事實可插拔、非 DOM 平台由 adapter 自訂 | **已實作** | [14-ports](./14-ports.md) §14.2 |
| `PORT #8` | 每個 adapter 皆可被假實作替換 | **已實作** | 假宿主可 `adopt`，並可配 SSR 埠掛載占位宿主 |

---

## 19.6 錯誤識別碼語義 (`ERR #n`)

| ID | 錯誤碼 | 致命 | 狀態 | 追蹤 / 備註 |
| :--- | :--- | :--- | :--- | :--- |
| `ERR #1` | `UNCONNECTED_HOST` | 是 | **已實作** | [12-errors](./12-errors.md) §12.4 |
| `ERR #2` | `HOST_INVALID` | 是 | **已裁決為文件漂移** | E-3（刪除暫停期間 native() 拋錯條件） |
| `ERR #3` | `TOKEN_INVALID` | 是 | **已實作** | 公開 `provide` / `inject` 與 key 寫入都拒絕非法名；私有 token 不驗證 |
| `ERR #4` | `KEYED_CONFLICT` | 是 | **已實作** | 跨宿主衝突在改動同宿主會話之前拒絕 |
| `ERR #5` | `SINGLETON_CONFLICT` | 否 | **已實作** | 先註冊者勝，解析期忽略後註冊的工廠 |
| `ERR #6` | `UNKNOWN_SERVICE` | 是 | **已實作** | Session 目標缺席立即拒絕；`injectAll` 的 `wait: true` 改走 pending |
| `ERR #7` | `CIRCULAR_DEPENDENCY` | 是 | **已實作** | `uses` 環與工廠同步自我 `inject` |
| `ERR #8` | `DISPOSED_SESSION` | 是 | **已實作** | B-1 Session 目標 pending 在 dispose 時拒絕 |
| `ERR #9` | `HOOK_ERROR` | 否 | **已實作** | [12-errors](./12-errors.md) §12.4 |
| `ERR #10` | `MOUNT_ABORTED` | 是 | **已裁決為文件漂移** | E-1（依平台慣例以 signal.reason 拒絕，代碼與文件廢止） |
| `ERR #11` | `FOREIGN_SESSION` | 是 | **已實作** | [12-errors](./12-errors.md) §12.4 |
| `ERR #12` | `INVALID_OPTIONS` | 是 | **已實作** | [12-errors](./12-errors.md) §12.4 |
| `ERR #13` | `PENDING_LIMIT_EXCEEDED` | 是 | **已實作** | [12-errors](./12-errors.md) §12.4 |
