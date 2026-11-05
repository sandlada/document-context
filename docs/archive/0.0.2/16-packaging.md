# 16 — 匯出地圖、依賴與發布契約

本章固定**使用者看得見的打包面**：有哪些匯出子路徑、依賴是什麼、能不能 tree-shake、SSR 匯入安不安全、發布前要過哪些閘門、版本怎麼走。

> 本章固定的是**匯出意圖與約束**。**確切的 export map 於實作期定案**；本章在此之前先鎖定「有哪些子路徑、各承載什麼、哪些明確不存在」。

---

## 16.1 匯出地圖

### 16.1.1 子路徑

| 子路徑 | 承載 | 誰該用 |
| :--- | :--- | :--- |
| `.` | 公共動詞 + 預設 Application（[11-composition.md](./11-composition.md) §11.4） | 一般使用者；不需要自組 ports 時 |
| `./application` | `createApplication` 與 Application 表面 | 自組 ports、測試裝配 |
| `./domain` | 領域模型與 port 契約 | port 實作者、進階整合 |
| `./infrastructure/dom` | DOM adapter：集中觀察者、Context Protocol、keyed 身分讀寫 | 瀏覽器環境 |
| `./infrastructure/ssr` | SSR adapter：`serverHost` 占位與請求級隔離 | 伺服器環境 |
| `./package.json` | 版本等套件 metadata | 工具鏈 |

### 16.1.2 明確**沒有**的子路徑

| 子路徑 | 狀態 | 理由 |
| :--- | :--- | :--- |
| `./infrastructure/storage` | **本代沒有** | 不做 persist / serialize / hydrate；狀態只活在會話記憶體（[00-overview.md](./00-overview.md) §0.4、[08-injection.md](./08-injection.md) §8.3） |
| v0.0.1 的 `/core` `/bridge` `/storage` `/dom` `/signals` | 已移除 | 見套件 CHANGELOG 的 `Removed` 段 |

> 舊套件的 `./infrastructure/storage` 子路徑**沒有**對應項。呼叫者若需要持久化，自己訂 `state$` 或 `read` 後自行處理（[01-api.md](./01-api.md) §1.5）。

### 16.1.3 匯出面的約束

1. 根入口**不得** re-export 內部模組（`domain` 的內部類別、中介層 util）。
2. 根入口**不得**提供 `*Sync` 動詞（[01-api.md](./01-api.md) §1.1；`API #2`）。
3. 根入口**不得**提供 persist / serialize / hydrate（[08-injection.md](./08-injection.md) §8.3）。
4. 每一個子路徑**必須**自帶型別產物（`.d.ts`），且型別只引用該子路徑自己宣告的東西——不得讓 `./domain` 的型別反向引用 `./infrastructure/dom`。
5. 子路徑**不得**改變行為語意：走子路徑拿到的動詞與根入口的同名動詞**必須**是同一套語意，只是掛在不同的 Application 上（[11-composition.md](./11-composition.md) §11.4）。

### 16.1.4 實際 export map

```jsonc
// 實際值；與 packages/document-context/package.json 一致
{
    "type": "module",
    "sideEffects": false,
    "exports": {
        ".": {
            "types": "./build/index.d.ts",
            "import": "./build/index.js"
        },
        "./application": {
            "types": "./build/application/index.d.ts",
            "import": "./build/application/index.js"
        },
        "./domain": {
            "types": "./build/domain/index.d.ts",
            "import": "./build/domain/index.js"
        },
        "./infrastructure/dom": {
            "types": "./build/infrastructure/dom/index.d.ts",
            "import": "./build/infrastructure/dom/index.js"
        },
        "./infrastructure/ssr": {
            "types": "./build/infrastructure/ssr/index.d.ts",
            "import": "./build/infrastructure/ssr/index.js"
        },
        "./package.json": "./package.json"
    }
}
```

**只提供 `import` 條件**：`require` / CJS 條目**不**出現（見 §16.2）。

**本代沒有 `./infrastructure/storage`。** 儲存是明列在外的範圍；舊線的 `./infrastructure/storage` 子路徑**不得**被帶回來（§16.5）。

---

## 16.2 依賴與目標環境

### 16.2.1 依賴

| 類型 | 內容 | 說明 |
| :--- | :--- | :--- |
| **peerDependencies** | `rxjs: ^7.8.0 \|\| ^8.0.0` | **必需**。RxJS 是狀態、錯誤與生命週期的串流媒介，不是選用的互操作層（[13-reactivity.md](./13-reactivity.md)） |
| **dependencies** | **無** | 零 runtime 依賴 |
| **devDependencies** | 建置與測試工具鏈 | 不進入使用者 bundle |

規則：

- `rxjs` **不得**列在 `dependencies`；它必須由使用者提供，避免同一頁兩份 RxJS 實例破壞 `instanceof` 與 symbol 對應。
- **不得**引入 DOM polyfill、zone.js 或任何帶副作用的全域安裝套件。
- 使用者的 bundler **應該**能只挑出實際用到的 RxJS 運算子；本庫不強制整包匯入。

### 16.2.2 模組格式

| 項目 | 值 | 理由 |
| :--- | :--- | :--- |
| `type` | `module` | ESM only |
| 產物格式 | ESM only | **不**提供 CJS 產物；`exports` 只列 `import`（與 `types`） |
| `sideEffects` | `false` | 見 §16.3 |
| 副檔名 | 不加 `.mjs` / `.cjs` | 單一 `type: module` 即可 |

### 16.2.3 目標環境

| 環境 | 支援 | 入口 | 限制 |
| :--- | :--- | :--- | :--- |
| 現代瀏覽器（ES2022 + DOM） | 是 | `.` / `./infrastructure/dom` | — |
| Node **>= 22.12**（SSR、測試、工具） | 是 | `.` / `./infrastructure/ssr` | 根入口匯入**不得**觸及 DOM（§16.3） |
| Node < 22.12 | 否 | — | `engines` 會擋；不提供 polyfill |
| 老舊瀏覽器 / 無 ES2022 | 否 | — | 不承諾 polyfill |
| Deno / Bun | 未承諾 | — | 未列入環境矩陣的驗證範圍 |

`engines.node` 為 `>=22.12.0`。

---

## 16.3 tree-shaking 與 SSR 安全匯入

### 16.3.1 `sideEffects: false` 的前提

宣告 `sideEffects: false` 等於向 bundler 承諾「匯入這個模組不會產生可觀察的副作用」。因此：

- 模組層級**不得**註冊全域監聽器、**不得**建立 Application 實例、**不得**讀 DOM、**不得**寫 `globalThis`。
- 根入口的**預設 Application**（[11-composition.md](./11-composition.md) §11.4）**必須**是**延遲**建立的：第一次呼叫 Phase 2 動詞時才組裝，不是在 import 時。
- 所有 DOM 觸點（`document`、`window`、`Element`、`MutationObserver`、`requestAnimationFrame`）**不得**在根入口的 module 求值階段被讀取。

### 16.3.2 SSR 安全匯入的可觀察契約

這是**可以被測試固定**的契約（對應 [15-testing.md](./15-testing.md) §15.10.2 的根入口 smoke 測試）：

> 在 Node 環境（`globalThis.document === undefined`）匯入 `@sandlada/document-context` **必須**成功，且**不得**拋出、**不得**觸發任何 DOM 全域存取。

| 面向 | 要求 |
| :--- | :--- |
| 根入口在 Node 的行為 | 匯入成功；DOM adapter **不**被求值 |
| 模組載入順序 | `import` 語句的**求值順序**不得決定 DOM adapter 是否被載入 |
| 失敗模式 | Node 端 `import` 根入口後呼叫瀏覽器專屬路徑 → 拋明確錯誤，而不是 `document is not defined` 的意外 |
| SSR bundle 內容 | 使用者**不應該**被迫把 DOM adapter 打進 SSR bundle |

### 16.3.3 達成方式（實作期選）

以下都是**允許**的機制，擇一或並行：

1. **延遲建立**：預設 Application 在第一次 Phase 2 動詞呼叫時才建立。
2. **動態匯入**：DOM adapter 以 `import()` 邊界隔離，Node 路徑永遠不觸發它。
3. **能力探測**：Phase 2 的 DOM 相關路徑在使用前檢查環境能力，缺能力時拋明確錯誤。

**不得**採用：把 DOM adapter 靜態匯入根入口再靠 `typeof document === 'undefined'` 掩蓋——那會讓 SSR bundle 仍然包含 DOM adapter，並讓 tree-shaking 失效。

### 16.3.3.1 本代採用：機制 1 + 機制 3

`0.1.0-alpha.0` 的根入口採用**延遲建立**與**能力探測**：

- 預設 Application 在**第一次 Phase 2 動詞呼叫**時才建立（`getDefaultApplication()`），匯入階段不建立實例。
- DOM adapter 的 module 層級**不**讀取任何 DOM 全域；`document` 只在建立 adapter 時被讀取，讀不到就拋 `DocumentContextError('HOST_INVALID')` 並說明「沒有可用的 document」——**不是** `document is not defined` 的意外。
- 根入口的 smoke 測試固定這個契約：Node 環境匯入根入口**不**觸及 `document` / `window` / `MutationObserver` / `requestAnimationFrame`（`src/index.unit-test.ts`）。

**取捨（要寫在實作文件裡）**：DOM adapter 與根入口在同一個 module graph 內，因此**只**匯入根入口的 SSR bundle 會帶著約 1.7 KB（gzip、minified）的 DOM 程式碼。不想帶它的 SSR 使用者應改用子路徑匯入：`@sandlada/document-context/application` + `@sandlada/document-context/domain` + `@sandlada/document-context/infrastructure/ssr`——那條路徑**不**包含 DOM adapter。`sideEffects: false` 的承諾仍然成立：模組求值階段沒有任何可觀察副作用。

### 16.3.4 按需子路徑

| 情境 | 應該 import |
| :--- | :--- |
| 一般 SPA | `.` |
| SSR | `.`（+ 需要時 `./infrastructure/ssr`） |
| 自組 ports | `./application` + `./domain`（+ 需要的 adapter 子路徑） |
| 只想要 Phase 1 純運算子 | `.` 的 Phase 1 匯出；Phase 1 **不**依賴任何 adapter（[11-composition.md](./11-composition.md) §11.1） |

---

## 16.4 體積預算

### 16.4.1 建議預算

下列是**建議值**，在實作落地前依實測調整。單位為 **gzip 壓縮後**；**不含 `rxjs`**（它是 peer dependency，由使用者的 bundler 決定）。

| 產物 | 建議預算 | 實測（`0.1.0-alpha.0`） |
| :--- | :--- | :--- |
| 根入口 `.` | <= 12 KB | **11.8 KB** |
| `./application` | <= 4 KB | **10.4 KB** |
| `./domain` | <= 3 KB | **0.9 KB** |
| `./infrastructure/dom` | <= 8 KB | **1.7 KB** |
| `./infrastructure/ssr` | <= 2 KB | **10.2 KB** |
| 全部合計 | <= 20 KB | **11.8 KB**（根入口閉包） |

實測方式：以 rolldown 對建置產物做 minify + tree-shake 後取 gzip；**不含 `rxjs`**。

預算的理由：根入口要裝下 Phase 1 運算子 + Phase 2 動詞 + 預設 Application 的骨架，因此給到 12 KB；`./domain` 與 `./application` 是「自組 ports」使用者的入口，必須輕；`./infrastructure/dom` 承載觀察者與 Context Protocol，是最大的一塊。

> 預算**不含** `rxjs`。使用者實際付出的代價取決於他的 bundler 能挑出多少運算子；本庫**不得**為了省體積而自行 re-export 大量 RxJS 表面。

### 16.4.1.1 實測後的調整（`0.1.0-alpha.0`）

`./application` 與 `./infrastructure/ssr` **超出**建議預算，理由與處理：

- `./application`（10.4 KB）：這是整個組合根的骨架——會話執行期、解析器、作用域生命週期、三條串流與全部 Phase 2 動詞都在這裡。建議預算 4 KB 是**在實作落地前**給的估計值，落地後依 §16.4.2 的流程檢查過依賴圖：沒有重量級 runtime 依賴（僅 `rxjs` peer）、沒有阻擋 tree-shaking 的 module 層級副作用、DOM adapter **不在**這個子路徑裡。放寬到 **12 KB**。
- `./infrastructure/ssr`（10.2 KB）：SSR 入口本身只有 1.7 KB 的自有程式碼，但它**必須**帶著 `./application`（同一個組合根），因此數字與 `./application` 相同。SSR 使用者本來就會用到 application 層，實際增量只有 1.7 KB。建議預算由 2 KB 改為 **12 KB**（= `./application` + SSR 自有程式碼）。
- 根入口閉包 **11.8 KB**，仍在 12 KB 的建議預算之內。

放寬理由依 §16.4.2 記錄於此，並在 CHANGELOG 標記為 `BREAKING` 級的預算調整（非行為變更）。

### 16.4.2 超預算時的處理流程

**依序**處理，不得跳步：

1. **看依賴圖**（bundle analyzer / 建置器的 metafile）：是不是 DOM adapter 被拉進根入口？
2. **檢查 module 層級副作用**：有沒有東西因為副作用而阻止 tree-shaking？
3. **確認沒有重量級 runtime 依賴**：是否誤引入 polyfill 或工具庫？
4. **拆子路徑**：把不常用或明顯屬於某一環境的模組移到子路徑。
5. **最後**才調整程式結構（例如把某些路徑改成 lazy）。

預算調整**必須**在 PR 中寫明理由與新數字。預算**不得**無聲放寬——放寬等於放棄這個閘門。

---

## 16.5 發布閘門

### 16.5.1 必跑閘門

| 閘門 | 指令 | 檢查什麼 | 失敗時 |
| :--- | :--- | :--- | :--- |
| 型別 | `pnpm run typecheck` | 來源型別 | **阻擋**發布 |
| 建置型別 | `pnpm run typecheck:build` | 建置用 tsconfig 的型別 | **阻擋** |
| 測試型別 | `pnpm run typecheck:test` | 測試型別 | **阻擋** |
| 測試 | `pnpm test` | unit → integration → e2e | **阻擋** |
| 建置 | `pnpm run build` | 產物生成 | **阻擋** |

執行順序與失敗定位見 [15-testing.md](./15-testing.md) §15.10。

### 16.5.2 建議閘門

| 工具 | 檢查什麼 | 什麼時候必跑 |
| :--- | :--- | :--- |
| `publint` | `exports` / `engines` / `sideEffects` / 副檔名一致性 | rc 之前必跑 |
| `@arethetypes/wrong` | 型別產物與實際 runtime 行為是否一致 | rc 之前必跑 |
| `size-limit` | §16.4 的體積預算 | rc 之前必跑 |

### 16.5.3 產物校驗

建置後**必須**逐一確認：

| 檢查項 | 期望 |
| :--- | :--- |
| 根入口 | `build/index.js`、`build/index.d.ts` 存在 |
| `./application` | `build/application/index.js`、`build/application/index.d.ts` 存在 |
| `./domain` | `build/domain/index.js`、`build/domain/index.d.ts` 存在 |
| `./infrastructure/dom` | `build/infrastructure/dom/index.js`、`build/infrastructure/dom/index.d.ts` 存在 |
| `./infrastructure/ssr` | `build/infrastructure/ssr/index.js`、`build/infrastructure/ssr/index.d.ts` 存在 |
| **不得存在** | `build/infrastructure/storage/` |
| 外部依賴 | 每個產物**不得** import `rxjs` 以外的套件 |
| SSR 安全 | 根入口產物在 Node 環境可匯入且**不**觸及 DOM 全域（§16.3.2） |
| 內部路徑 | 產物**不得**殘留指向 `src/` 的相對 import |

「`build/infrastructure/storage/` **不得存在**」是一條**正面**的斷言：它保證舊的持久化子路徑不會被誤帶回來。

---

## 16.6 版本策略

### 16.6.1 `0.1.x` 階段

| 階段 | 允許的破壞性變更 | 對外保證 |
| :--- | :--- | :--- |
| `alpha` | **允許** | 無。每次發布在 CHANGELOG 列出 `BREAKING` |
| `beta` | 僅限修正回歸 | 公共 API 凍結 |
| `rc` | 僅限修正回歸 | 公共 API 凍結 |
| `0.1.0` | 無 | SemVer 生效 |

### 16.6.2 破壞性變更的界線

破壞性變更**只**發生在兩種情況：

1. **major** 升級。
2. **明確標示的 alpha 階段**。

因此 `0.1.0-beta.x` 之後若需要破壞性變更，**必須**推到 `0.2.0`（並在 alpha / beta 階段就明講），**不得**在 rc 階段偷改。

`0.1.x` 的 patch 版本只做非破壞性修正。

### 16.6.3 已經發生的破壞性變更

相對舊線（`0.1.0-alpha.0` 的舊實作），`0.1.0` 的破壞性變更已列在套件 CHANGELOG：

| 變更 | 方向 |
| :--- | :--- |
| `mount` 改為同步 | `await mount(bp)(host)` → `const session = mount(bp)(host)` + `await session.ready` |
| `update` 改為整份替換 | 需要深合併時用純函式 `merge` |
| `*Sync` 動詞**直接移除** | `mountSync` / `injectSync` / `selectSync` / `provideSync` / `injectAllSync` 全部消失 |
| `defineToken<T>(visibility?)(name)` | 取代 `defineToken` / `definePrivateToken` |
| `persist` / `serialize` / `hydrate` / storage 子路徑移除 | 持久化交給呼叫者 |

逐項的遷移步驟見 [17-migration.md](./17-migration.md)；本章只規定**何時**允許破壞性變更，不重複遷移寫法。

### 16.6.4 舊版 `*Sync` 動詞：直接移除，不做長期棄用

舊線的 `*Sync` 動詞**沒有**經過「標記 deprecated → 保留數個版本 → 移除」的流程，而是直接移除。理由：那一組是**整組語意分裂**（同步掛載 vs 異步掛載），保留兩條路徑比移除更危險；而且舊線從未作為穩定版發布，沒有外部承諾需要遵守。

未來的棄用**必須**走 §16.7 的流程。

### 16.6.5 版本號的單一來源

版本號只寫在 `packages/document-context/package.json`。根目錄的 `README` / `LICENSE` / `CHANGELOG` / `CODE_OF_CONDUCT` / `SECURITY` 是**符號連結**，不帶版本、不獨立維護。

---

## 16.7 棄用政策

適用於**未來**要棄用的動詞、選項或子路徑：

| 步驟 | 要求 |
| :--- | :--- |
| 1. 標記 | JSDoc `@deprecated` **必須**寫明「自哪個版本起棄用」與「改用什麼」 |
| 2. 觀察期 | **至少**兩個 minor 週期 |
| 3. 移除 | 只在 major（或明確的 alpha 階段）發生 |
| 4. 同步 | CHANGELOG 的 `Deprecated` 與 `Removed` 段、[遷移指南](./17-migration.md)、文件站**必須**同步更新 |

額外規則：

- 棄用期間**不得**在執行期印 console 警告——那會污染呼叫者的輸出，屬於未經請求的副作用。只有型別標記與文件。
- 棄用**不得**改變行為：棄用期的舊路徑**必須**與棄用前行為一致，直到被移除。
- 棄用**不得**用「行為變更 + 標記」的方式夾帶——行為變更屬於破壞性變更，走 §16.6.2。

例外：`definePrivateToken` 與 `*Sync` 這類**同一代內的整組移除**不適用本政策——它們在 `0.1.0` 之前就不存在，沒有需要守護的外部承諾。

---

## 16.8 文件與站點

| 文件 | 位置 | 規則 |
| :--- | :--- | :--- |
| README | `packages/document-context/README.md` | **canonical**；根目錄為符號連結。**只**編輯套件內的檔案 |
| CHANGELOG | `packages/document-context/CHANGELOG.md` | Keep a Changelog 格式；每個 `BREAKING` 條目**必須**對應[遷移指南](./17-migration.md)的一節 |
| LICENSE / CODE_OF_CONDUCT / SECURITY | `packages/document-context/` | 同上；根目錄為符號連結 |
| 設計文件 | `docs/next-version/` | 行為契約的單一事實來源；實作期決定的事項（型別、匯出細節）**必須**回寫到相關章節 |
| 網站 | `packages/site/`（Starlight） | 目前是 **v0.0.1 快照**；刷新為 `0.1.x` 的後續工作，**不**阻擋發布 |

### 16.8.1 Starlight 網站

- `packages/site/` 目前的內容是 **v0.0.1 的快照**，不是 `0.1.x` 的契約，也不是相容性保證。
- 刷新網站屬於「下一版工作」：把 `docs/next-version/` 的敘事層與規範層轉成網站內容，標明版本對應。
- 網站**不得**先於文件改變行為語意；兩者不一致時以 `docs/next-version/` 為準。
- 網站更新**不得**阻擋 `0.1.x` 的 alpha / beta / rc 發布。

### 16.8.2 文件回寫的觸發點

| 事件 | 必須回寫 |
| :--- | :--- |
| 實作期定案了匯出地圖 | §16.1（把「示意」換成實際 export map） |
| 實作期定案了型別表面 | 對應章節的「示意」標記 |
| 新增或移除不變式 | [15-testing.md](./15-testing.md) §15.2 的對照表 |
| 體積預算調整 | §16.4 |
| 新的破壞性變更 | 套件 CHANGELOG + [遷移指南](./17-migration.md) + §16.6.3 |

---

## 16.9 與其他章節的分工

| 問題 | 章節 |
| :--- | :--- |
| 公共 API 總表與掛載選項 | [01-api.md](./01-api.md) |
| 生命週期與鉤子 | [02-lifecycle.md](./02-lifecycle.md) |
| DOM 宿主、作用域、連線性 | [03-dom.md](./03-dom.md) |
| 懶載入與 Promise | [04-promise-lazy.md](./04-promise-lazy.md) |
| SSR 的行為 | [05-ssr.md](./05-ssr.md) |
| Token 字串身分 | [07-tokens.md](./07-tokens.md) |
| 注入生命週期與「不序列化」 | [08-injection.md](./08-injection.md) |
| 掛載對象與 keyed 身分 | [09-mount-host.md](./09-mount-host.md) |
| Context Protocol 事件契約 | [10-events.md](./10-events.md) |
| 組合根、`createApplication`、根入口與子路徑 | [11-composition.md](./11-composition.md) §11.4 |
| 錯誤識別碼 | [12-errors.md](./12-errors.md) |
| RxJS 語意與 peer 依賴理由 | [13-reactivity.md](./13-reactivity.md) |
| ports 職責、Application 隔離、整體釋放 | [14-ports.md](./14-ports.md) |
| 測試分層、不變式 ID、執行閘門 | [15-testing.md](./15-testing.md) |
| 舊線到 `0.1.x` 的破壞性變更對照 | [17-migration.md](./17-migration.md) |
| 可直接使用的配方（含 SSR 與跨 bundle 的端到端寫法） | [18-recipes.md](./18-recipes.md) |
