# `@sandlada/document-context` v0.1.0 — 下一世代宏觀藍圖

本目錄是 `@sandlada/document-context` 下一世代（`0.1.0`）的宏觀設計藍圖。
這是一次 **greenfield 全刪重寫**：舊 `src/` 與舊 `DESIGN.md` 僅作設計素材，不構成任何相容約束。

## 文件索引

| # | 文件 | 內容 |
| :--- | :--- | :--- |
| 00 | [overview.md](./00-overview.md) | 定位、核心支柱、與 v0.0.1 的差異 |
| 01 | [architecture.md](./01-architecture.md) | 六邊形 / Clean 分層、依賴規則、埠與轉接器 |
| 02 | [domain-model.md](./02-domain-model.md) | Blueprint / Session / Scope / Service / 生命週期狀態機 / 錯誤分類學 |
| 02b | [02b-tokens.md](./02b-tokens.md) | Token 系統：可序列化、SSR 安全、散落可用 |
| 03 | [application-api.md](./03-application-api.md) | 公共 API 全表（柯里化、data-last） |
| 04 | [reactivity-rxjs.md](./04-reactivity-rxjs.md) | RxJS 響應式核心與串流契約 |
| 05 | [lifecycle-host.md](./05-lifecycle-host.md) | 四維生命週期與宿主綁定 `attach` |
| 06 | [storage.md](./06-storage.md) | 儲存契約、瀏覽器 adapters、策略、跨標籤同步 |
| 07 | [ssr-hydration.md](./07-ssr-hydration.md) | 載入安全、水合（儲存 / payload / 藍圖種子）、`ssr` adapter |
| 08 | [projection.md](./08-projection.md) | 投影：非目標與自行組合食譜 |
| 09 | [infrastructure.md](./09-infrastructure.md) | DOM / storage / ssr adapters 與組合根 |
| 09b | [09b-late-binding.md](./09b-late-binding.md) | 晚綁定解析：pending registry、生命週期事件、順序無關注入 |
| 10 | [testing.md](./10-testing.md) | TDD、分層測試環境、埠契約測試套件 |
| 11 | [migration.md](./11-migration.md) | 自 v0.0.1 的破壞性變更與遷移指引 |
| 12 | [roadmap.md](./12-roadmap.md) | v0.1.0 範圍與里程碑 |
| 13 | [13-decisions.md](./13-decisions.md) | 決策登錄（單一事實來源）與勘誤 |
| 14 | [14-packaging-release.md](./14-packaging-release.md) | 打包、相容性、CI 與發佈 |
| 15 | [15-glossary.md](./15-glossary.md) | 術語表 |

## 一句話定位

> 以 **物理 DOM 為宿主**、**嚴格六邊形分層**、**函式優先 / 柯里化 data-last**、**RxJS 第一公民**、**SSR 安全** 的 IoC/DI 與響應式狀態庫。
>
> 設計身份：**異步流為主**——同步動詞為二等投影（見 [03 §3.1.1](./03-application-api.md) 與 [13 §13.12](./13-decisions.md)）。`0.1.x` 全程 `@deprecated`（實作落地即標記），`0.2.0` 全面移除（見 D-114）；版本範圍：`0.1.x` deprecation window，`0.2.0` 移除，`1.0` 後新增二等移除視同 BREAKING 須 major；支援地平線見 [12 §12.1](./12-roadmap.md)。
>
> 命名公約：異步一等**無 `Async` 後缀**（`inject` / `mount` / `provide`；`$` = Observable）；同步二等**必帶 `Sync` 後缀**（`injectSync` / `injectAllSync` / `provideSync` / `mountSync` / `selectSync` / `getSessionSync`）。

## 文件用語約定

- 敘述使用繁體中文，技術名詞保留英文原文。
- 程式碼範例遵循專案規範：**不含尾隨分號**、**4 空格縮排**、**單引號**（`*.json*` / mermaid fence 豁免：JSON 保持雙引號可解析，mermaid 依其語法）。
- `host`（小寫）指 `HostPort` 抽象宿主；`element` 指具體 DOM 節點。本句為規範：公開簽名與正文一律 `host` / `element`；`Native` 僅保留於 `HostPort<Native>` 定義處；`node` 僅限 adapter 內部變數名（見 [15-glossary.md](./15-glossary.md) Host 行）。
- 情態 legend（全 corpus 規範，術語定義見 [15-glossary.md](./15-glossary.md) 頭指針）：**必須** / **不得** = normative（MUST / MUST NOT，以 test 或 lint 強制）；**應該** / **建議** = recommended（SHOULD，偏離需理由）；**可** / **允許** = permitted（MAY，無 conformance 主張）；其餘（禁止/一律/請/…)一律視為 informative，除非改寫成 legend 詞。
