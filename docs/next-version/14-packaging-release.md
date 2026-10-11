# 14 — 打包、相容性與發佈 (Packaging, Compatibility & Release)

本節固定建置產物、依賴、執行環境基線、品質閘門與發佈流程；決策編號見 [13-decisions.md](./13-decisions.md) §13.8。

## 14.1 依賴策略

- **RxJS 為必要 peerDependency**：`"rxjs": "^7.8.0 || ^8.0.0"`；本庫**不** bundle RxJS（避免多實例）；devDependency 供測試。
- 其餘零 runtime 依賴。

## 14.2 套件 exports

```jsonc
{
    ".":                        { "types": "./build/index.d.ts",                    "import": "./build/index.js",                     "default": "./build/index.js" },
    "./domain":                 { "types": "./build/domain/index.d.ts",             "import": "./build/domain/index.js",              "default": "./build/domain/index.js" },
    "./application":            { "types": "./build/application/index.d.ts",        "import": "./build/application/index.js",         "default": "./build/application/index.js" },
    "./infrastructure/dom":     { "types": "./build/infrastructure/dom/index.d.ts",     "import": "./build/infrastructure/dom/index.js",     "default": "./build/infrastructure/dom/index.js" },
    "./infrastructure/storage": { "types": "./build/infrastructure/storage/index.d.ts", "import": "./build/infrastructure/storage/index.js", "default": "./build/infrastructure/storage/index.js" },
    "./infrastructure/ssr":     { "types": "./build/infrastructure/ssr/index.d.ts",     "import": "./build/infrastructure/ssr/index.js",     "default": "./build/infrastructure/ssr/index.js" },
    "./package.json": "./package.json"
}
```

- `"type": "module"`、`"sideEffects": false`、`"files": ["build"]`；`main` / `types` 指向根入口（相容舊工具鏈）。
- ESM-only（不做 CJS 雙軌）；型別由 tsdown 產出 `.d.ts`。

## 14.3 執行環境基線

- 瀏覽器：**Baseline 2023**（Chrome/Edge 111+、Safari 16.4+、Firefox 112+）。
- 硬需求：`WeakRef`、`FinalizationRegistry`、`AbortController`（基線內建）。
- **ERM 漸進增強**：runtime feature-detect `Symbol.dispose`；缺席時不掛載資源管理符號，改用顯式 `dispose(session)`（文件明示；`await using` 需 `ESNext.Disposable` lib，見 §14.4）。
- 可選能力：`BroadcastChannel`、Web Locks（缺席時跨標籤退回僅 `storage` 事件）。
- Node（僅建置 / 測試 / SSR 執行）：≥ 22.12。

## 14.4 TypeScript

- 型別層最低 **TS ≥ 5.2**；repo 以最新版驗證（`npm run typecheck`）。
- 建議 `lib`: `ES2022` + `DOM`；使用 `using` 者加 `ESNext.Disposable`（ERM 缺席的運行時改用顯式 `dispose(session)`）。

## 14.5 體積預算

- 根入口（不含 RxJS）**gzip ≤ 15 kB**；全部子入口合計 **≤ 25 kB**。
- 以 size-limit（或同等）於 CI 檢核；超出即紅燈（預算可依量測結果調整，但調整需在 PR 說明）。

## 14.6 CI 品質閘門

```
npm ci
npm run typecheck      # tsc --noEmit（build / test 兩份 project）
npm test               # 分層 vitest（coverage ≥ 90% lines/branches）
npm run build          # tsdown → ESM + .d.ts
npx publint            # 打包正確性
npx attw               # 型別解析（Are The Types Wrong）
npx size-limit         # §14.5 預算
```

- GitHub Actions：`ubuntu-latest`、Node 22；全綠方可合併。

## 14.7 發佈流程

- 手動 semver + `CHANGELOG.md`（Keep a Changelog 格式）。
- 步驟：更新版本與 changelog → `npm run build` → git tag `vX.Y.Z` → `npm publish --access public --provenance`。
- 0.x 期：minor 可包含 BREAKING CHANGE（於 changelog 標明）；patch 僅修補。
- 版本範圍：0.x 二等移除走 any-minor-with-gate；1.0 後二等移除視同 BREAKING，須 major。現行政策（D-114）：`0.1.x` 全程 `@deprecated`，`0.2.0` 全面移除。
- 二等（同步投影）API（見 [03-application-api.md](./03-application-api.md) §3.1.1）：不列入穩定契約；`0.1.x` 實作落地即標記 `@deprecated`，`0.2.0` 全面移除；實際移除前需先確立 SSR / 渲染與同步工廠替代路徑（見 [13-decisions.md](./13-decisions.md) D-71 增補 D-112、D-114）；CHANGELOG 標註必要不充分。
- 發佈前檢查：`docs/next-version/` 與實作一致（12 §12.5）。

## 14.8 舊資產處置

- v0.1.0 發佈時，`DESIGN.md`、`docs/core-concepts.md`、`docs/lifecycles.md`、`docs/w3c-protocol.md` 移入 `docs/archive/`（標註為 v0.0.1 歷史文件）。
- 根 `README.md` 重寫為 v0.1.0 對外文案；`AGENTS.md` 於 M0 改寫為新分層規範；`TASK.md` 由新世代 TASK 檔取代。
- `site/` 於 P1 評估重做，不阻塞 v0.1.0。
