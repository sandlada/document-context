# 01 — 架構與分層 (Architecture)

## 1.1 分層模型

本專案採 **嚴格六邊形（Ports & Adapters）+ Clean Architecture** 精神，收斂為三層：

```
┌──────────────────────────────────────────────────────────────┐
│  infrastructure  (被驅動端實作 / adapters)                    │
│  dom · storage · ssr                                          │
├──────────────────────────────────────────────────────────────┤
│  application     (編排 + 公共 API 組裝)                        │
│  usecase 動詞與運算子、對外 API 匯出點                          │
├──────────────────────────────────────────────────────────────┤
│  domain          (複雜模型 + 契約)                             │
│  model（實體/狀態機） · ports（被驅動埠） · usecases（純編排）   │
└──────────────────────────────────────────────────────────────┘
```

本專案 **不需要** presentation / API 層（它是函式庫，不是應用），也 **不設** 通用 `infrastructure` 大雜燴——`infrastructure` 在本專案的唯一職責是「實作 domain 所定義的被驅動埠」。

## 1.2 依賴規則（不可違逆）

```
domain  ←  application  ←  infrastructure
```

- `domain` **不得** import `application` 或 `infrastructure`；**不得** 觸碰 `window` / `document` / `localStorage` / `MutationObserver` / `queueMicrotask` / `setTimeout`。
- `application` **不得** import `infrastructure`（否則形成反向依賴，破壞可替換性）。
- `infrastructure` 只依賴 `domain`（埠契約）與 `application`（型別/組合工具，如需要）。
- 唯一允許同時接觸兩側的是最外側的 **組合根（composition root）**。

> 註：RxJS 是純計算工具，不被視為「infrastructure」。domain 可直接使用 RxJS。
> 註：運行時契約以**異步流**為核心（`watch` / 晚綁定管線是解析的規範路徑）；同步動詞為熱快照投影（二等，見 [03-application-api.md](./03-application-api.md) §3.1.1）——移除同步面不得影響分層依賴與核心行為。

## 1.3 埠與轉接器的對偶

| 被驅動埠（domain/ports） | 語意 | 轉接器（infrastructure） |
| :--- | :--- | :--- |
| `HostPort<Native>` | 抽象宿主節點：身分、連線狀態、祖先、事件、生命週期 | `infrastructure/dom/host-adapter.ts` |
| `StoragePort` | 鍵值持久化 + 外部變更觀察 | `infrastructure/storage/*` |
| `SchedulerPort` | 微任務 / 計時 / 動畫幀 | `infrastructure/dom/scheduler-adapter.ts` |
| `ScopeTransportPort` | 沿祖先解析依賴的傳輸（同步 `request` + 晚綁定 `watch`／pending registry） | `infrastructure/dom/scope-transport.ts`、`late-binding.ts` |

domain 只認這些埠；DOM、W3C 事件、MutationObserver、localStorage 的細節全部被封裝在 adapters 內。

## 1.4 組合根（Composition Root）

由於 `application` 不能 import `infrastructure`，預設 DOM adapter 的「自動裝配」發生在最外側的套件入口：

```ts
// src/index.ts（套件根入口 / composition root）
import { createApplication } from './application/index'
import { createDomAdapter } from './infrastructure/dom/index'
import { createStorageAdapters } from './infrastructure/storage/index'
import { createSsrAdapter } from './infrastructure/ssr/index'

// 以預設 adapters 裝配出開箱即用的 API（完整清單見 09 §9.1）
export const { createContext, pipe, provide, provideSync, mount, mountSync, /* ... */ } =
    createApplication({
        host: createDomAdapter(),
        storage: createStorageAdapters(),
        ssr: createSsrAdapter()
    })
```

- 使用者 `import { mount } from '@sandlada/document-context'` 取得的是 **已裝配 DOM adapter** 的版本，零設定。
- 進階使用者可 `import { createApplication } from '@sandlada/document-context/application'` 自行以自訂 adapter 裝配。
- 測試可裝配 fake adapter（記憶體 host / 假排程器）。
- 裝配契約（`ApplicationPorts` / `HostAdapter` / `StorageRegistry` / `SsrAdapter`）見 [09-infrastructure.md](./09-infrastructure.md) §9.1.1。

## 1.5 目標原始碼骨架

```
src/
├─ domain/
│  ├─ model/
│  │   ├─ blueprint.ts        # Blueprint 純資料結構
│  │   ├─ session.ts          # Session 實體與不透明句柄
│  │   ├─ scope.ts            # 作用域拓撲與解析語意
│  │   ├─ service.ts          # 註冊、lifecycle、in-flight 合併、multi 集合
│  │   ├─ lifecycle.ts        # 四維生命週期狀態機
│  │   └─ errors.ts           # 錯誤分類學
│  ├─ ports/
│  │   ├─ host.ts
│  │   ├─ storage.ts
│  │   ├─ scheduler.ts
│  │   └─ scope-transport.ts
│  └─ usecases/
│      ├─ mount.ts
│      ├─ resolve.ts
│      ├─ resolve-async.ts
│      ├─ update.ts
│      ├─ suspend-resuscitate.ts
│      └─ hydrate.ts
├─ application/
│  ├─ api/
│  │   ├─ create-context.ts
│  │   ├─ pipe.ts
│  │   ├─ provide.ts
│  │   ├─ hooks.ts
│  │   ├─ mount.ts
│  │   ├─ get-session.ts
│  │   ├─ select.ts
│  │   ├─ update.ts
│  │   ├─ subscribe.ts
│  │   ├─ inject.ts
│  │   ├─ dispose.ts
│  │   ├─ persist.ts
│  │   ├─ attach.ts
│  ├─ create-application.ts   # 以 adapters 裝配公共 API
│  └─ index.ts                # 公共 API 型別匯出點
├─ infrastructure/
│  ├─ dom/
│  │   ├─ host-adapter.ts
│  │   ├─ scope-transport.ts  # W3C Context Protocol
│  │   ├─ scheduler-adapter.ts
│  │   ├─ observer.ts         # 集中式 MutationObserver（兼任晚綁定喚醒）
│  │   ├─ late-binding.ts     # pending registry 與重試排程
│  │   └─ attach.ts
│  ├─ storage/
│  │   ├─ local-storage.ts
│  │   ├─ session-storage.ts
│  │   └─ sync.ts             # 跨標籤同步
│  └─ ssr/
│      ├─ null-host.ts        # stub（供 server 端掛載）
│      ├─ payload-resolver.ts # 讀取 __dc_state payload
│      └─ serialize.ts
└─ index.ts                   # 組合根
```

## 1.6 套件 exports（按層）

```jsonc
{
    ".":                        "./build/index.js",              // 組合根（預設 DOM adapter）
    "./domain":                 "./build/domain/index.js",       // ports + model 型別
    "./application":            "./build/application/index.js",  // 純 application API
    "./infrastructure/dom":     "./build/infrastructure/dom/index.js",
    "./infrastructure/storage": "./build/infrastructure/storage/index.js",
    "./infrastructure/ssr":     "./build/infrastructure/ssr/index.js"
}
```

- `/domain` 公開埠契約與公開 model 型別供進階使用者實作自訂 adapter，但 **不** 公開內部演算法。
- 主入口 `.` re-export application 公共 API（已裝配 DOM adapter）。

## 1.7 為何不設 presentation / 通用 infra 層

- **無 presentation**：本庫不產生 UI，也不綁定任何視圖框架；視圖整合以純函式鉤子（`attach`）交還宿主。
- **infrastructure 即 adapters**：`infrastructure` 在此專案的定義收窄為「被驅動埠的實作」，避免 DDD 四層中 `infrastructure` 常見的無邊界膨脹。
