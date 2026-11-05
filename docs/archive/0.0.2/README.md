# `@sandlada/document-context` — 生產級 API 宏觀設計

本目錄是一份**新的**宏觀設計。它只定義使用者看得見的契約：API、生命週期、鉤子、DOM 宿主、Promise、懶載入與 SSR。

它不描述內部資料結構、佇列、批次或 adapter 拆檔。實作可以換任何滿足本契約的做法。

[`docs/next-version-deprecated/`](../../next-version-deprecated/README.md) 與目前套件原始碼都不是本目錄的輸入。三者不一致時，以本目錄描述的產品行為為設計目標。

## 怎麼讀

| 文件 | 回答的問題 |
| :--- | :--- |
| [00-overview.md](./00-overview.md) | 這套庫是什麼、兩階段模型、不做什麼 |
| [01-api.md](./01-api.md) | 公共 API、功能面、失敗時使用者看到什麼 |
| [02-lifecycle.md](./02-lifecycle.md) | 會話狀態、鉤子順序、暫停與恢復 |
| [03-dom.md](./03-dom.md) | 宿主、祖先作用域、跨 bundle（事件見 10） |
| [04-promise-lazy.md](./04-promise-lazy.md) | Promise、懶載入、eager、取消、依賴環 |
| [05-ssr.md](./05-ssr.md) | 伺服器掛載。狀態留在記憶體，HTML 由呼叫者寫 |
| [06-glossary.md](./06-glossary.md) | 術語 |
| [07-tokens.md](./07-tokens.md) | 多 script / 多 bundle 下的 token 身分與 TypeScript |
| [08-injection.md](./08-injection.md) | singleton / scoped / transient（prototype）、任意值注入 |
| [09-mount-host.md](./09-mount-host.md) | 掛載對象：Element、serverHost、嵌套、與 inject 目標的差別 |
| [10-events.md](./10-events.md) | Context Protocol、串流與 DOM 三條事件通道 |
| [11-composition.md](./11-composition.md) | `createApplication`、ports、每頁 / 每請求幾個實例 |
| [12-errors.md](./12-errors.md) | 錯誤分類學：識別碼、觸發條件、出現位置（規範源） |
| [13-reactivity.md](./13-reactivity.md) | RxJS 語義：冷熱、重播、推送時機、完成條件（規範源） |
| [14-ports.md](./14-ports.md) | ports 職責、跨平台連線語意、Application 級上限（規範源） |
| [15-testing.md](./15-testing.md) | 測試矩陣、不變式 ID、假排程器與互操作測試 |
| [16-packaging.md](./16-packaging.md) | 匯出地圖、peer 依賴、tree-shaking 衛生、發布閘門 |
| [17-migration.md](./17-migration.md) | 從舊版線遷移到 `0.1.x`：破壞性變更對照 |
| [18-recipes.md](./18-recipes.md) | 可直接使用的配方：渲染、受控輸入、派生狀態、跨 bundle |

## 一句話

以物理 DOM 節點為宿主的函式式狀態與依賴庫：藍圖純資料，`mount` 同步交還 `Session`，`session.ready` 表示初始化完成；依賴預設懶建立；伺服器與瀏覽器共用同一組動詞。

## 兩層文件

| 層 | 檔案 | 性質 |
| :--- | :--- | :--- |
| **敘事層** | `00`–`11` | 產品行為的說明。給人讀 |
| **規範層** | `12`–`14` | 錯誤、RxJS、ports 的**單一事實來源**。給實作者與測試對齊用 |

規範層的條目帶穩定編號（`ERR #3`、`RX #7`、`PORT #2`），測試以編號引用它們，形成「文件條目 ↔ 測試」的一對一映射。見 [15-testing.md](./15-testing.md)。

**型別**不在設計期定案：這套文件固定的是**語義與行為**，TypeScript 的型別形狀、泛型與匯出地圖在**實作期**決定（[16-packaging.md](./16-packaging.md)）。

## 維護者：實作分層（非公共契約）

本目錄 `00`–`11` 描述**使用者看得見的行為**，不展開 adapter 拆檔。實作與貢獻者仍遵守：

- **敘事**：函式式 API + 兩階段 + **ports 組合根**（見 [11-composition.md](./11-composition.md) §11.9）；不以「六邊形架構」作對外或設計 doc 主標題。
- **依賴**：`domain` ← `application` ← `infrastructure`；**唯一**組合根裝配 `createApplication({ host, ssr? })`。
- **取捨**：data-last 動詞與 ports **不衝突**；**禁止** `application` 直接 import DOM adapter 這類 shortcut。
- **細節**：[`AGENTS.md`](../../../AGENTS.md) §1、`packages/document-context` 原始碼與測試；歷史「六邊形 / Clean」用語僅見 [`docs/next-version-deprecated/`](../../next-version-deprecated/README.md)。

## 審查記錄（非契約）

| 文件 | 說明 |
| :--- | :--- |
| [REVIEW.md](./REVIEW.md) | 本代文件的缺口審查與架構建議：待補規範章節、契約矛盾裁定清單、跨平台生命週期建議、執行順序 |

## 用語

敘述使用繁體中文，技術名詞保留英文。範例不含尾隨分號、4 空格縮排、單引號。

情態：**必須** / **不得** 是契約；**應該** 是建議；未使用這兩個詞的句子是說明。
