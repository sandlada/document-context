# 重构 @sandlada/document-context 为函数式通用 HTML IoC 容器 — 设计规格

- 日期：2026-07-26
- 状态：待用户最终批准
- 作者：通过 brainstorming / 系统分析生成

## 1. 背景与目标

`@sandlada/document-context` 当前版本把整个库绑死在 Material 3 的 theme 配置上：

- 主题状态形状 (`IThemeRaw` / `ThemeEntity`) 写死在 `src/domain/entities/theme.entity.ts`。
- 仓库对外暴露固定的用例：`updateThemeConfig` / `toggleIsDark` / `loadThemeConfig` / `saveThemeConfig` / `syncThemeAttr` / `isThemeConfig` 等。
- 旧版本 (`697fa63`) 曾使用 `dispatchEvent` + 字段级 setter 来支持变更，导致事件类型与 setter 函数膨胀，难以在 TypeScript 中保持参数类型推断。

本次重构要解决的核心问题：

1. **库要成为基于 HTML 的通用 IoC 容器**——状态形状由开发者决定，库不再提供任何默认业务字段。
2. **更新机制要类型友好**——开发者只要调用 `updateState(session, partial)` 即可更新任意状态字段，无需新增 setter / event 类型。
3. **库要函数式**——核心全部为顶层纯函数；副作用通过会话 token + 可选适配器管理。
4. **HTML 端双向同步**——JS 状态与 HTML 对象内部 property (`lang`, `dataset.x`, `innerText` 等) 双向流动，并默认开启循环守卫、批处理、冲突策略。

## 2. 设计原则（根约束）

1. **库 = 通用 IoC 容器**：宿主从纯代码抽象转移到 HTML 对象；除“HTML 端 property 同步”外，不内置任何业务语义。
2. **库 = 函数式 + 不可变**：核心不含类，无 `this`，所有状态变更必须返回新对象。
3. **会话 (`session`) = 不透明 token**：仅由 `mount()` 创建，外部不可自构，禁止伪造。
4. **副作用可选**：所有副作用（DOM 同步、localStorage、MutationObserver 清理）通过适配器登记；核心运行时可独立运行。

## 3. 包结构

```
src/
    core/
        index.ts            // 顶层 exports 聚合
        context.ts          // createContext<S>(initial?)
        session.ts          // mount(target, ctx, options?)
        readState.ts
        updateState.ts
        subscribeState.ts
        bridgeState.ts      // 双向 property 同步
        provide.ts
        inject.ts
        dispose.ts
        scope.ts            // defineScope + IScopeToken
    adapters/
        localStorage.ts     // loadState/saveState 适配器
        domMutation.ts      // MutationObserver 触发 dispose
    errors.ts
    index.ts                // 重新导出
test/
    setup.ts                // 保留现有结构 + 多 Symbol 重置
    core.test.ts            // 纯逻辑（无 DOM 依赖）
    integration.test.ts     // DOM + 双向 property 同步
docs/
    superpowers/
        specs/
            2026-07-26-document-context-refactor.md  // 本规格
```

构建工具保持：

- `tsdown.config.ts`：单入口 `src/index.ts`，ESM only，浏览器平台，dts 生成，clean `build/`。
- `tsconfig.json`：保留现有 `strict / exactOptionalPropertyTypes / noUncheckedIndexedAccess / verbatimModuleSyntax / isolatedModules`。
- `rxjs` 仍放在 `devDependencies`；公共 bundle 仅重导出 `Observable` / `Subscription` 类型。

## 4. 核心数据模型

```ts
// src/core/session.ts
export interface IState extends Record<PropertyKey, unknown> {}

// 不透明 brand，禁止外部构造
export interface ISession<S extends IState> {
    readonly [SessionBrand]: unique symbol;
    readonly target: object;
    readonly schema: S;                       // 提供给 inject 的类型上下文
    readonly options: Readonly<IMountOptions<S>>;
}

export interface IMountOptions<S extends IState> {
    readonly scope?: IScopeToken<unknown>;
    readonly sync?: IBridgeOptions<S>;
    readonly lenient?: boolean;               // 默认 false
}

export interface IBridgeOptions<S extends IState> {
    readonly target: object;
    readonly properties:
        | { readonly [K in keyof S]?: string }
        | { readonly selectAll: true };
    readonly events?: readonly string[];       // 默认 ['input', 'change']
    readonly batch?: boolean;                  // 默认 true
    readonly conflict?: 'lastWriteWins'        // 默认 lastWriteWins
        | 'statePrecedence'
        | 'domPrecedence';
    readonly ignoreInternalWrite?: boolean;    // 默认 true
    readonly deepFreeze?: boolean;             // 默认 false
}

export interface IScopeToken<T> {
    readonly [ScopeBrand]: unique symbol;
    readonly __scope: true;
    readonly __type: T;
    readonly name: string;
}
```

### 设计要点

- `ISession<S>` 的泛型 `S` 由 `createContext(initial)` 或 `createContext<T>()` 推导；`mount()` 不重新推断 S。
- `selectAll: true` 用于**全字段同步**：状态中所有键都投影到 `target` 上同名 property。
- `IBridgeOptions.properties` 是 **字段 → property 路径** 的映射；property 路径用点号语法 `dataset.dark` / `style.color`。

## 5. 顶层 API（公共）

```ts
// src/core/context.ts
export function createContext<S extends IState>(): IContextSeed<S>;
export function createContext<S extends IState>(initial: S): IContext<S>;

// 起始 token
export function defineScope<T = unknown>(name: string): IScopeToken<T>;

// 会话挂载
export function mount<S extends IState>(
    target: object,
    ctx: IContext<S> | IContextSeed<S>,
    options?: IMountOptions<S>,
): ISession<S>;

// 状态操作
export function readState<S extends IState>(session: ISession<S>): S;            // 冻结快照
export function updateState<S extends IState>(
    session: ISession<S>,
    partial: Partial<S>,
): S;

export function subscribeState<S extends IState>(
    session: ISession<S>,
    fn: (state: S) => void,
): () => void;                  // 返回 unsubscribe

export function bridgeState<S extends IState>(
    session: ISession<S>,
    options: IBridgeOptions<S>,
): void;                        // 允许 mount 后再添加一次（不允许覆盖）

// 持久化（基于适配器）
export function saveState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void;

export function loadState<S extends IState>(
    session: ISession<S>,
    opts: { adapter: 'localStorage'; key: string },
): void;

// IoC 核心
export function provide<T, S extends IState>(
    session: ISession<S>,
    token: IScopeToken<T> | string,
    factory: () => T,
    options?: { lifecycle?: 'singleton' | 'transient' | 'scoped' },
): void;

export function inject<T, S extends IState>(
    session: ISession<S>,
    token: IScopeToken<T> | string,
): T;

// 生命周期
export function dispose<S extends IState>(session: ISession<S>): void;
```

### 模式示例

```ts
// 1. 完整状态 + 服务 + 双向 sync
interface CounterState extends IState { count: number; dark: boolean }
const COUNTER = Symbol('counter') as IScopeToken<CounterState>;

const ctx = createContext({ count: 0, dark: false });
const session = mount(document, ctx, {
    sync: {
        target: document.documentElement,
        properties: {
            dark: 'dataset.dark',
            count: 'dataset.count',
        },
        events: ['input', 'change'],
        batch: true,
        conflict: 'lastWriteWins',
        ignoreInternalWrite: true,
    },
});

provide(session, COUNTER, () => ({ sayHi: () => `count = ${readState(session).count}` }));
const counter = inject(session, COUNTER);

subscribeState(session, (s) => console.log(s.count));
updateState(session, { count: 1 });
```

## 6. 双向 HTML Property 同步

### 6.1 JS → DOM

1. `updateState(session, partial)` 提交后，库对比新状态对 `properties` 中声明的字段。
2. 对每个字段读取 `target[path]` 或 `target.dataset[key]`，仅当现有值与新值不等时写入。
3. 写入前在 `target` 上标记 `InternalWriteSymbol`；写完移除标记。
4. 当 `batch: true` 时所有写入合并为一个 microtask。

### 6.2 DOM → JS

1. `mount(session, { sync })` 时在 `target` 上添加监听 `events` 中的事件；默认 `input`、`change`。
2. 事件触发后读取 `target[propertyPath]` 当前值，对比 `selectState(s => s[field])`；不等则调用 `updateState`。
3. **循环守卫**：若读取时 `target` 上仍存在 `InternalWriteSymbol`，跳过本次回流。
4. **冲突策略**：
   - `lastWriteWins`：后写入者覆盖（默认）。
   - `statePrecedence`：JS 端值始终优先；DOM 端变更在 JS 显式调用 `syncFromDOM(session)` 之前不写回。
   - `domPrecedence`：DOM 端值始终优先；JS 端变更被推迟到下一次 DOM 事件。

### 6.3 自动清理

- `mount(target, ctx, options)` 通过 `MutationObserver` 监测 `target` 从 DOM 树中移除：
  - 移除时调用 `dispose(session)`，等价于 `unsubscribe` 所有监听与回流。
  - `dispose()` 也可被库使用者手动调用。

## 7. IoC 容器行为

### 7.1 作用域

- `defineScope(name)` 返回一个 `IScopeToken<T>`；开发者以 token 引用作用域。
- `mount(target, ctx, { scope })` 把会话绑定到该作用域。
- `inject(session, token)` 沿作用域链上溯查找：
  ```
  当前作用域 → 父作用域（声明 scope 时显式 parent） → 根作用域
  ```

### 7.2 生命周期

| 选项          | 行为                                |
| ------------- | ----------------------------------- |
| `singleton`   | 每个根容器内只一个实例（默认）       |
| `transient`   | 每次 `inject` 都新建实例             |
| `scoped`      | 每个 session 内只一份；跨 session 独立 |

### 7.3 销毁

- `dispose(session)` 移除该 session 注册的所有 service / 同步绑定 / 订阅，并向 `error$` 发 `disposed` 事件。
- 跨 session 的 singleton 不会被销毁；transient / scoped 在宿主 dispose 时被一并销毁。

### 7.4 循环依赖

- `provide(factoryA)` 调用 `inject(tokenB)`，而 `provide(factoryB)` 又调用 `inject(tokenA)` —— 第二次 `inject` 抛 `CircularDependencyError`，错误对象含调用链 `[A → B → A]`。

## 8. 错误处理

| 名称                          | 触发场景                                        | 默认行为                              |
| ----------------------------- | ----------------------------------------------- | ------------------------------------- |
| `CircularDependencyError`     | provide → inject → provide 同一 token 循环     | 抛错 + `error$`                       |
| `UnknownScopeError`           | 未 `defineScope` 的 token 直接用于 `mount()`    | 抛错                                  |
| `UnknownServiceError`         | `inject()` 沿作用域链找不到 token               | 抛错                                  |
| `InvalidInitialStateError`    | `createContext(initial)` 校验失败（zod 风格）   | 抛错                                  |
| `InvalidStoredStateError`     | `loadState()` 反序列化失败或校验不通过          | 保留当前内存状态 + 发出 `error$`       |
| `InvalidPropertyError`        | 同步到不存在的 property                          | 抛错                                  |
| `PropertySyncError`           | DOM 端 setter 抛错（被 ignoreInternalWrite 守卫）| 控制台 error + `error$`               |

库默认在 `session` 上保留 `error$: Observable<LibraryError>` 用于订阅。

## 9. 测试方案

- `test/core.test.ts`：状态不可变、`updateState` / `readState` / `subscribeState`、`provide/inject` 解析链与循环检测、生命周期（singleton / transient / scoped）。
- `test/integration.test.ts`：
  - `mount(document)` 重复检测
  - JS→DOM 同步：派发后 `target[property]` 反映新值
  - DOM→JS 同步：派发 `change` 后 `readState()` 反映新值
  - `ignoreInternalWrite` 防循环
  - `batch: true` 同帧合并
  - `conflict: 'lastWriteWins'` 后写覆盖
  - `MutationObserver` 触发 `dispose`
- `test/setup.ts`：保留现有 `localStorage` mock，新增重置所有自定义 Symbol，并删除任何上次 mount 留下的 listener。

## 10. 公开 API 与内部 API 边界

- 公开：仅 `src/index.ts` 顶层 re-export；任何文件不得直接 re-export 内部模块。
- `errors.ts` 暴露错误类构造函数以便开发者做 `instanceof` 捕获。
- `adapters/*` 默认全部不导出，由 `saveState/loadState` 通过字符串名称解析；保留测试时手动注入适配器实现的 capability（`__setAdapter()` 仅测试可见）。

## 11. 删除与新增清单

**删除**

- `src/domain/entities/theme.entity.ts`
- `src/domain/repositories/i-theme.repository.ts`
- `src/domain/repositories/i-dom-attr.repository.ts`
- `src/infrastructure/mappers/theme.mapper.ts`
- `src/infrastructure/mappers/local-storage.mapper.ts`
- `src/infrastructure/repositories/theme.repository.ts`
- `src/infrastructure/repositories/dom-attr.repository.ts`
- `src/infrastructure/stores/in-memory-theme.store.ts`
- `src/infrastructure/stores/local-storage-theme.store.ts`
- `src/application/use-cases/*.ts`
- 旧 `ContextSymbol` 公共类型
- `IBoundUseCases` / `IBinderDeps` / `IBinderResult` 接口

**新增**

- `src/core/*`：所有以动词命名的函数模块
- `src/adapters/localStorage.ts`、`src/adapters/domMutation.ts`
- `src/errors.ts`
- `test/core.test.ts`、`test/integration.test.ts`

**修改**

- `package.json`：`description` 与 `keywords`
- `README.md`：调整用途说明
- `CLAUDE.md`：重新写为新设计文档
- `src/index.ts`：替换为新顶层聚合

## 12. 风险与权衡

1. **类型推断的语义**：当 `createContext({ count: 0 })` 时 `S` 推导为 `{ count: number }`；若存在可选字段，开发者需用 `Partial<typeof initial>` 手工标注。文档里会显式说明。
2. **双向同步的事件选择**：默认只监听 `input` + `change`，不监听 `propertychange`（兼容旧 IE，但 happy-dom 不支持）。如需自定义 `transitionend` 等事件，开发者可用 `subscribeState` 自行桥接。
3. **适配器可扩展性**：默认仅内置 `localStorage`；IndexedDB、URL 状态等以后按适配器提供。
4. **`rxjs` 依赖**：升级 `rxjs` 与 happy-dom / vitest 兼容版本，错误处理要使用 v7+ API。

## 13. 验收标准

- 所有 `npm test` 通过。
- `npm run build` 输出与 `tsdown.config.ts` 期望一致：单 ESM，dts 完整。
- `package.json` 的 `description` / `keywords` 已更新。
- 删除的旧文件已从仓库中消失，旧依赖（如 `rxjs` 在生产侧的反向引用）已不存在。
- `test/integration.test.ts` 至少覆盖一条双向 property 同步用例。

## 14. 后续（不在本期范围内）

- IndexedDB 适配器
- 远程（HTTP）适配器
- `URL` 状态双向桥接
- `use(scope).effect(...)` 一类的辅助 helper
