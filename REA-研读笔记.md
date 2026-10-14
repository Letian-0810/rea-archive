# REA 项目研读笔记

> 研读时间：2026-10-14（Asia/Shanghai）  
> 仓库：[morluto/rea](https://github.com/morluto/rea)  
> 固定源码版本：[main @ `96e7c22a9cc917448ed080e11cde4dacd2a2d70a`](REA/)  
> npm 包：`rea-agents` 6.4.0；许可证：MIT  
> GitHub API 查询时为 216,806 stars、53,536 forks；星数会持续变化。

> 后续按“原 GitHub 消失仍能恢复运行”的标准补充了本地源码、依赖和恢复验证。最新交付范围与证据见 [本地复现与验收](本地复现与验收.md)；下文最初研读时的限制已相应更新。

## 一句话理解

REA 不是单一反编译器，而是一个面向 AI agent 的本地逆向工程工作台：它把不同格式和引擎的分析能力统一成 MCP 工具与 CLI 工作流，再用可验证、可比较、可导出的 Evidence 保存“看到了什么、由谁看到、覆盖了什么、哪些问题仍未知”。核心价值是让 agent 能从用户提出的行为问题出发，逐步定位静态或运行时证据，而不是只返回一段没有来源的解释。

## 项目定位与主要使用方式

README 描述的典型任务是：用户指出某个应用中的功能，REA 帮 agent 在没有原始项目源码的情况下检查目标、追踪实现、展示证据，然后由 agent 解释或在用户自己的项目中实现类似行为。Agent 通过 MCP 调用工具；同一批分析工作流也能从终端 CLI 使用。

REA 的执行和主要分析都在本机。这个“local-only”定位不代表每个工作流都没有外部影响：浏览器观察、网络捕获、设备连接、进程运行或主动运行时观察，仍会访问用户选择的目标，并使用用户权限；不同工作流会调用用户安装或提供的引擎、浏览器和系统工具。静态 JavaScript/.NET 检查不会运行目标应用。运行时工作流应按各自文档判断效果、权限和清理行为。

### 能力版图

| 分析面 | 主要对象与结果 | 关键依赖或边界 |
|---|---|---|
| 原生二进制 | 函数、伪代码、汇编、符号、字符串、调用和交叉引用 | Hopper、Ghidra 或 IDA；格式、架构及宿主平台影响能力 |
| 离线二进制与崩溃 | ELF 布局、段/节/重定位、Go/Rust 构建信息、Linux crash 线程/寄存器/信号 | pwntools、GDB/pwndbg、objdump、Rizin 等按能力由调用方提供 |
| Web 与 JavaScript/Electron | 模块图、导入、source map、路由、IPC、native add-on、DOM/脚本/网络观察、运行时事件 | Node.js、Chrome-family 浏览器；主动场景使用 Playwright/CDP 等 |
| 托管与移动端 | .NET 元数据/CIL；Android APK 类、方法和清单；设备包、进程、日志、截图；Flutter 产物信息 | JADX/JDK、adb、Apktool、JEB 等按工作流提供 |
| 资源与固件 | Apple/Android 包资源、plist、文件清单与摘要、固件区域和提取结果 | Binwalk/Unblob 等按平台提供；提取与原生分析分层衔接 |
| 其他格式/协议 | WASM、EVM bytecode、SQLite、HAR/SAZ、PCAP、逻辑信号记录、进程行为 | WABT、TShark、sigrok-cli、Node SQLite 等有明确版本/平台要求 |

完整支持矩阵和逐项前提见 [README 的 What you can analyze](REA/README.md#what-you-can-analyze)；不要把“有工具”理解成任意系统、格式或引擎组合都已支持。

## 架构：外层适配，内层共享

仓库自己维护的架构图是最好的入口：[docs/architecture.mermaid](REA/docs/architecture.mermaid)。依赖大致从纯语义和合同向外流动：

```text
用户 / Agent
   ├── CLI: src/cli.ts
   └── MCP stdio: src/main.ts → src/server/
                  └── 共用 src/application/ 工作流
                       └── src/composition/ 装配 ports 与 provider
                            ├── src/domain/ 纯语义、Evidence、比较、Unknown
                            ├── src/contracts/ 输入输出合同与 JSON Schema
                            ├── src/<provider>/ 引擎/格式适配器
                            ├── bridge/ 引擎侧桥接代码
                            └── src/process/ 进程所有权、超时、输出上限、清理
```

- `scripts/rea.mjs` 是可执行入口分发器。它在加载 CLI 框架之前先识别 MCP 模式，再加载构建产物；缺少构建产物会给出构建/重装提示。
- `src/main.ts` 负责 MCP 进程生命周期：快照环境、解析配置、创建二进制 session、按配置打开初始目标、启动 stdio transport、安装关闭处理器。
- `src/cli.ts` 通过 `createDirectAnalysis` 和同一组 session/composition 使用应用工作流，再注册分域命令。CLI 与 MCP 是两种适配器，不是两套独立分析逻辑。
- `src/server/` 把严格的公开合同注册成 MCP 工具，并处理请求取消、分析准入、工具结果编码、Evidence 交付、session 状态及可用性。
- `src/application/` 编排用例与端口；`src/domain/` 放不依赖具体引擎的值、验证、错误和比较规则；`src/composition/` 是生产装配点；具体 provider 隔离在 `src/ghidra/`、`src/hopper/`、`src/ida/`、`src/browser/`、`src/wasm/` 等目录。
- 原生引擎桥接并不全部由 TypeScript 实现：仓库包含 Python Hopper bridge、Java Ghidra bridge、Windows Node-API 代码和若干平台/工具脚本。

这是一个边界较清晰的 ports-and-adapters 架构，但规模很大，根 `src/` 的 1,859 个文件并不等于一个小型 MCP server。

## 两条关键执行链

### 1. 一个二进制分析请求

1. CLI 或 MCP 解析输入目标并得到格式、摘要、架构等目标身份。
2. `AnalysisProviderRegistry` 汇总各深度 provider 的可用性、目标支持和能力。选择是确定性的：显式请求、环境默认或单一候选的 `auto`；`auto` 下没有可用 provider 时返回未绑定状态，有多个可用 provider 时报告歧义。项目原则是不在某引擎失败后悄悄换另一个引擎，因为结果语义可能改变。
3. `BinarySession` 绑定一个目标、provider、profile 和 run ID，启动时先执行 health；相同目标和 profile 可以复用符合条件的活动 session。请求会在 session 生命周期锁和待执行操作排空规则下处理。
4. provider adapter 把通用操作翻译到 Hopper/Ghidra/IDA 或其他分析引擎。引擎协议与格式专属逻辑不应泄漏到 domain/application 层。
5. MCP/CLI 适配器将结果转成 Evidence 和用户可读输出。资源清理失败会作为状态保留以便重试；失败打开目标时会尽量恢复先前绑定，同时保留调查记录。

### 2. 一个 MCP 工具如何变成 Evidence

`OFFICIAL_TOOL_CONTRACTS` 给出具名合同。`registerOfficialTools` 对输入执行合同 schema 校验，在 session 准入范围内执行相应 provider 操作；成功后创建标准 Evidence、写入 session 的 `InvestigationRecords`，最后由 `ToolResultDelivery` 编码成 MCP 成功结果。失败走统一的 tagged error / diagnostic 路径。结果既有 text 内容，也有 schema-validated structured content；空间不足时受传输预算约束，完整记录仍可通过保留的 Evidence 引用继续读取。

这条链的关键文件：

- [src/server/registerOfficialTools.ts](REA/src/server/registerOfficialTools.ts)
- [src/server/toolResult.ts](REA/src/server/toolResult.ts)
- [src/domain/evidence.ts](REA/src/domain/evidence.ts)
- [src/application/investigation/EvidenceLedger.ts](REA/src/application/investigation/EvidenceLedger.ts)
- [MCP runtime contracts](REA/docs/mcp-contracts.md)

## 关键抽象：把“证据”和“未知”做成一等数据

### Evidence

Evidence 是一个严格验证、不可变、可认证的观察记录，至少关联：

- 目标 subject（文件摘要、格式、架构和本地显示路径）、provider 身份及分析 profile；
- 操作/谓词、参数、provider 原始结果和规范化结果；
- `observed` / `derived` / `inferred` 置信类别、authority、执行环境、限制说明；
- 代码或产物位置、Evidence 之间的链接，以及可选的关系覆盖声明。

`evidence_id` 由 RFC 8785 风格 canonical JSON 上的语义投影计算摘要，解析时再次认证 ID；subject 的展示名称/本地路径不参与语义身份，内容摘要、格式、架构和观察语义会参与。`analysis_profile` 另行承诺 provider 版本与影响分析结果的参数，因此同一二进制在不同引擎/配置下的记录不会被误当成同一次观察。Evidence 记录可以去重；同一个 ID 对应不同语义内容则拒绝。

### Unknown 与部分覆盖

REA 也持久化“仍未回答的问题”，而非让遗漏被误读为否定证据。Unknown 有稳定 ID、递增 revision、前版摘要、当前状态、严重度、支撑/反驳证据、所需 authority/confidence/environment、建议 probes、关系和 resolution。状态包括 open、investigating、blocked、contradicted、resolved；每次更新记录 revision digest 并连接前版。

完整性是显式字段：

- 关系读取的 `relationship_coverage=complete` 只表示 provider 返回了其声明的直接关系集合，不代表所有运行时边都被发现。
- 函数 dossier 可逐 facet 声明 available/unavailable；“空数组”本身不能证明观察到了空结果。
- artifact traversal 会区分 `root` / `container-entries` 范围和 `complete` / `unknown` 状态。被省略的文件、未知哈希或部分遍历都保留成限制/未知。
- 比较只有在身份、输入范围和必要覆盖都能对齐时才得出 equality；证据不足时保持 unknown/truncated，而不把 unknown 降格成 unchanged。

### Session、Bundle 与复用

`InvestigationRecords` 通过 `EvidenceLedger` 统一拥有 Evidence 与 Unknown revisions。Bundle 有 artifact/provider/environment/scenario/capture manifests；导入会先整体校验身份、字段、关系图和冲突，再原子合并。导出按语义身份排序，使传输和比较可重复。分析 snapshot 还用于保存/复用 provider 原语与 workflow 结果，但复用键需包含目标与分析 profile。

这是 REA 的中心设计主张：agent 的结论应该能追溯回证据，比较必须知道自己比较了哪些东西，未观测部分必须继续以未知表示。

## Provider 与权限/副作用边界

架构图列出若干 provider 方向：

- 深度原生分析：Hopper、Ghidra、IDA adapter（对接外部 `ida-pro-mcp`）；Ghidra 可用临时数据库；IDA 只读，不能替用户保存或关闭已连接的 GUI 数据库。
- 离线/格式分析：pwntools/pwndbg、WABT、EVMole、GNU objdump、Rizin/GDB、.NET metadata、JADX/Apktool、Binwalk/Unblob、TShark/sigrok、SQLite 等。
- Web/app 观察：CDP/Playwright、Electron、V8 Inspector、source-map 解码与 JS artifact reconstruction。

根 [AGENTS.md](REA/AGENTS.md) 和 [CONTRIBUTING.md](REA/CONTRIBUTING.md) 明确约束了集成范围：支持一般软件结构/行为逆向和证据报告；不集成专门绕过商用保护、anti-debug/anti-instrumentation、DRM/license/access-control、攻击载荷自动化、凭据窃取、隐蔽持久化、未授权访问或批量攻击工作流。对会运行目标、注入、改内存/寄存器或恢复保护的能力，先判断真实权限、副作用、验证和维护范围；问题未解决时按 fail-closed 处理。

进程管理也做成基础设施：复用 `src/process/` 的进程所有权/身份、deadline、输出/文件上限、private runtime root 和清理机制。PID 加可执行路径不足以证明进程仍是原来的进程。资源清理失败不能装作成功，也不能丢掉 cleanup ownership。安装配置应是 additive、idempotent、有备份；`rea setup` 展示计划并要求批准后才改客户端配置或安装 Hopper，不会顺带安装/升级 Node、Java、Homebrew、Ghidra 等无关软件。Ghidra/IDA 由用户自备。

## 仓库规模与工程形态

基于固定提交的 Git tree API（`truncated=false`）统计，共 4,081 个 tree entries、3,722 个文件 blob。顶层大致分布：

| 路径 | 文件数 | 主要作用 |
|---|---:|---|
| `src/` | 1,859 | TypeScript 产品实现与模块测试 |
| `tests/` | 1,107 | boundary、acceptance、conformance、fixtures、evaluation 等 |
| `scripts/` | 365 | 构建、生成、验证、打包、CI 和安装辅助 |
| `docs/` | 98 | 用户手册、合同、架构图、平台/格式专册 |
| `website/` | 89 | 网站模板、示例、指南及本地化；`docs/` 另有 VitePress 配置 |
| `experiments/` | 58 | 分析效率等实验 |
| `bridge/` | 32 | 引擎侧/外部工具桥接（另有测试） |
| `native/` | 5 | Windows native Node-API 实现 |

TypeScript 是主体；另有大量 MJS 构建/验证脚本和 Python、Java、Swift、C/C++、C#、Solidity/WAT 等 fixtures/bridges。`package.json` 要求 Node `^22.19.0 || ^24.11.0 || >=26.0.0`，锁定 `npm@11.16.0`。项目把源码测试、边界测试、MCP 测试、acceptance/conformance、真实 provider 验证、文档生成检查等分成多条 lane。README 中的支持声明与真实 provider 验证范围应区分；模拟 provider 不能证明真实引擎行为。

## 建议的代码阅读顺序

1. 产品边界和能力：[`README.md`](REA/README.md)、[`AGENTS.md`](REA/AGENTS.md)、[`CONTRIBUTING.md`](REA/CONTRIBUTING.md)。
2. 分层与依赖：[`docs/architecture.mermaid`](REA/docs/architecture.mermaid)。
3. 两个入口：[`scripts/rea.mjs`](REA/scripts/rea.mjs)、[`src/main.ts`](REA/src/main.ts)、[`src/cli.ts`](REA/src/cli.ts)。
4. provider 与 session：[`src/composition/binary.ts`](REA/src/composition/binary.ts)、`src/application/binary/AnalysisProviderRegistry.ts`、`BinarySession.ts`、`SessionProviderRouter.ts`。
5. MCP 合同到运行时：`src/contracts/officialToolContracts.ts`、[`src/server/registerOfficialTools.ts`](REA/src/server/registerOfficialTools.ts)、`src/server/createServer.ts`、[`docs/mcp-contracts.md`](REA/docs/mcp-contracts.md)。
6. 可信记录：[`src/domain/evidence.ts`](REA/src/domain/evidence.ts)、`analysisProfile.ts`、`evidenceBundle.ts`、`residualUnknown.ts`、`src/application/investigation/EvidenceLedger.ts`。
7. 再按目标选一条垂直链深入：[`docs/native-investigation.md`](REA/docs/native-investigation.md)、[`docs/javascript-application-workflows.md`](REA/docs/javascript-application-workflows.md)、`docs/android-analysis.md`、`docs/firmware-analysis.md` 等，再跟到 provider 与 conformance fixtures。

## 这次研读的证据范围与限制

- 已确认仓库身份、默认分支、当前 stars/forks、包版本、完整 tree SHA 和 tree 未截断状态；已读取 README、根 AGENTS/CONTRIBUTING、架构图、MCP 合同、安装/CLI/native/JS 工作流文档，以及入口、provider 选择、session、Evidence/Unknown、MCP 注册/返回路径中的代表性实现。
- 已按顶层目录对完整文件树计数并做模块归类；这不是对 1,859 个 `src/` 文件逐行审读，也不是对每个 provider/平台做真实运行验证。
- 早期两次 `git clone` 失败后，已通过官方固定提交归档保存源码，并完成全部 3,722 个 Git blob 内容身份核对；5 个子模块及其 LFS 实体也已补存。原始归档、运行环境、依赖缓存和恢复脚本均在本地，详情见 [本地复现与验收](本地复现与验收.md)。
- 后续已在新目录以本地资料离线安装、构建，并运行 JavaScript/SQLite 的 CLI 和 MCP 验证及项目自带的相关测试；没有修改现有 agent 配置。其他引擎和平台的文档能力仍未逐项实测。

## 主要资料

- [REA GitHub repository](https://github.com/morluto/rea)
- [REA website](https://rea.tools/)
- [README at reviewed commit](REA/README.md)
- [Architecture map](REA/docs/architecture.mermaid)
- [MCP runtime contracts](REA/docs/mcp-contracts.md)
- [Tool design guide](REA/docs/tool-design.md)
- [Contributing scope](REA/CONTRIBUTING.md)
