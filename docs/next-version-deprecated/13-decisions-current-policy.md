# 13 附錄 — 現行政策速查（讀者入口）

> §13.1～§13.16 為**歷史決策追加日誌**（條款不刪改）。正文與實作衝突時，以本表「現行」欄為準；詳細理由仍見原編號條目。

| 主題 | 現行政策 | 權威正文 | 取代 / 增補 |
| :--- | :--- | :--- | :--- |
| 同步 API 梯隊 | `*Sync` 二等；`0.1.x` 落地即 `@deprecated`；`0.2.0` 移除 | 03 §3.1.1、README | D-114 增補 D-71、D-112 |
| 晚綁定 | 元素 / Session 目標 async 缺席 = pending；`UNRESOLVED_SESSION` 退役 | 09b、02 §2.7 | D-61～D-64 |
| **跨宿主雙活** | 一律 `KEYED_SESSION_CONFLICT`；`onConflict` 不含 evict 豁免 | 05 §5.5 | D-103、D-14 |
| 水合合併 | 四策略皆頂層淺合併 + 覆蓋順序（非「首包整源」） | 06 §6.3、`hydrate.ts` | D-99、B-13 |
| 跨標籤 LWW | P0：flush-then-apply + 到達序；P1：`(ts,seq,tabId)` 公平全序 | 06 §6.5 | D-116 增補 D-100 |
| 自回聲 | 丟本端 `(tabId,seq)`；同 tab 其他 seq 可收 | 06 §6.5、`sync.ts` | D-100 |
| 投影 / SSR 雙軌 | 非目標；水合 = 儲存 / payload / 種子 | 08、07 | D-76～D-77 |
| `LifecycleEvent` 載荷 | `resuscitated.details.setup`、`disposed.details.evicted` 可選 | 02 §2.3 | D-103、D-96 |
| Mount 配置 | 裸 `Infinity` TTL → 一般 `Error`（非十碼表） | 02 §2.7 表下註、03 §3.3 | D-96 |
| 宿主索引 | `HostSessionMap`（WeakMap host）+ keyed WeakRef 表 | 05 §5.5、`context.ts` | D-80、D-96 |

> 本附錄隨勘誤更新；新決策仍追加 §13.16 之後的編號，並同步增補本表一行。

（本文件由 [13-decisions.md](./13-decisions.md) 引用；勿在決策日誌內重複維護兩份表。）
