# Windows 测试兼容性修正：第一批

日期：2026-10-27（Asia/Shanghai）。

这批工作修正了三个测试文件中的平台预设，没有修改 REA 生产代码。原始源码、归档、依赖锁、恢复工具，以及 `0001-materialize-catalog-identity` 均保持原样。补丁是可选的，现有恢复流程不会自动应用它。

基线是归档 main `321959e7f2d790337054bb3deef97b4fcc84706d`，原始 REA 源码提交 `96e7c22a9cc917448ed080e11cde4dacd2a2d70a`。修改前已用 Git blob 摘要核对三个文件与最新 main 一致。

## 已验证的修正

| 问题 | 修改 | 实际验证 |
|---|---|---|
| ADB 的 POSIX 文件名用例使用了宿主默认平台 | 明确传入 linux，保留 Windows 非法文件名检查 | 原单例失败；修正后整个小文件 32 项通过 |
| WABT 路径关联夹具写死 POSIX 绝对路径 | 使用宿主绝对路径，保留精确匹配、歧义、未解析与语法错误断言 | 原单例失败；修正后整个小文件 12 项通过 |
| 变量捕获用例把 Windows 盘符路径直接交给动态 import | 使用 pathToFileURL(path).href | 原生控制由 ERR_UNSUPPORTED_ESM_URL_SCHEME 失败变为两份作者夹具通过，每份核对 9 个字段 |

以上是 **44 项 Vitest 测试通过，加上 2 份原生控制夹具通过**，不能合并称为“46项完整验收通过”。变量捕获的完整 CLI/MCP 流程没有复跑，后续仍可能有其他失败。

补丁：[0002-windows-test-fixtures.patch](../../patches/optional/0002-windows-test-fixtures.patch)。

## 本次进一步确定的阻断点

### WABT provider 单例

选中 `owns private artifact bytes and retains success outcome`，每次只有这一例执行。

1. 源码副本缺少 `native/windows/build/manifest.json` 时，返回明确的 Windows 原生能力不可用错误。
2. 从已有归档补入版本匹配、SHA-256 校验一致的原生组件后，进入子进程启动阶段；模拟工具使用的 Node 因 `ncrypto::CSPRNG(nullptr, 0)` 断言退出。
3. 仅给模拟 Node 启动器补充宿主环境后，启动阻断消失，但后续仍返回 `AnalysisAccessDeniedError / EPERM`，清理未报告不完整。

因此不能说“安装 WABT 就解决了”，也不能说该用例已修好。尚未确定具体缺少哪个环境变量，也未证明普通 Windows 环境下仍有相同的权限失败。探索性修改全部撤回，没有随本补丁发布。未启动真实 WABT 引擎。

### 客户端注册单例

`registers, reads back, and uninstalls opencode` 在配置写入阶段就失败。临时诊断 stderr 显示 `EPERM / rename`：测试目录中的临时配置不能重命名为最终配置。它尚未进入注册命令的 aligned 断言。

该异常发生于本次受限运行环境，不能反推原始 full-suite.log 的具体错误，也不能据此判定普通 Windows 用户必然不能配置客户端。只使用测试临时目录，没有读取或修改真实用户配置。用于诊断的生产代码改动已撤回。

## 如何在已有源码副本中应用

只针对已经保留的源码工作副本；不要为了这一步重新执行恢复验收。不要把补丁应用到封存的原始 ZIP，也不要修改原始基线来隐藏差异。

在已有源码目录执行，使用补丁实际绝对路径：

```powershell
git apply --check 'C:\REA_ARCHIVE\patches\optional\0002-windows-test-fixtures.patch'
git apply 'C:\REA_ARCHIVE\patches\optional\0002-windows-test-fixtures.patch'
```

这三处只修改测试，不需要重新编译 REA。应用前保留工作区已有修改；若检查失败，先核对版本，不要强行应用。

## 低资源复现

本次只从已有缓存物化锁定版本的必要依赖，没有联网下载依赖，没有运行 npm ci、源码构建、恢复验收或完整套件。

将本目录的 [vitest.low-memory.config.ts](vitest.low-memory.config.ts) 复制到已有源码根目录。它保留项目原有 runner 和项目设置，只将每个项目的 worker 和文件并发压到 1，关闭覆盖率，并把 worker 的 V8 堆限制设为 384 MiB。

在已有源码根目录中逐条运行；`$reaNode` 指向已有 Node 24.18.0，`$reaReport` 指向可写的单次 JSON 输出文件：

```powershell
& $reaNode --max-old-space-size=384 .\scripts\run-exact-tests.mjs run src/adb/AdbHostFileName.test.ts --config .\vitest.low-memory.config.ts --project adapters --reporter=default --reporter=json --outputFile.json $reaReport

& $reaNode --max-old-space-size=384 .\scripts\run-exact-tests.mjs run src/wasm/WabtOutput.test.ts --config .\vitest.low-memory.config.ts --project adapters --reporter=default --reporter=json --outputFile.json $reaReport
```

两条命令应使用不同的输出文件，且前一条完成后再执行下一条。修改前定位时，分别添加：

- ADB：`-t 'accepts the POSIX device path /data/local/tmp/report:2024'`
- WABT 路径：`-t 'keeps exact local, ambiguous URL, computed and unparseable glue distinct'`

变量捕获的 [capture-native-probe.mjs](capture-native-probe.mjs) 从指定源码文件提取原测试的作者夹具、写入方法和原生结果断言，执行实际 Node 动态 import。它不调用 REA，也不替代完整工作流验收：

```powershell
& $reaNode --max-old-space-size=128 'C:\REA_ARCHIVE\verification\windows-compatibility-20261027\capture-native-probe.mjs' 'C:\EXISTING_SOURCE' 'C:\TEST_OUTPUT\capture.json'
```

此脚本同样在未修改文件上验证过失败、在修改后文件上验证过通过。输出包含源码文件 SHA-256 和验证范围。Node 会对 stripTypeScriptTypes 打印实验性功能提示。

堆限制不是整个进程树的内存上限。本次未测量所有进程合计的峰值内存，也未宣称完成完整类型检查、lint 或全平台检查。完整检查按既定资源约束未执行。

## 待解决

- 验证完整变量捕获 CLI/MCP 用例，而不只验证原生控制。
- 分离并核对 Windows Node 模块解析语义；不能仅修改预期让测试变绿。
- 测量大型内联 Evidence 参数长度，确认是否在创建 CLI 子进程前失败。
- 在允许原子重命名的受控测试环境中核实客户端配置，再修正平台命令预期。
- 继续定位 WABT 访问拒绝；随后每次只检查一个 Ghidra/GDB 等 provider 用例。
- 参考源码导入仍是明确的 Windows 能力边界；符号链接、信号、捕获与录制的剩余问题保持未完成状态。

## 证据索引

[result.json](result.json) 记录范围和未完成项。

- [ADB 修改前](adb-before.json) / [修改后](adb-after.json)
- [WABT 路径修改前](wasm-path-before.json) / [修改后](wasm-path-after.json)
- [捕获原生控制修改前](capture-native-reproducible-before.json) / [修改后](capture-native-reproducible-after.json)
- [WABT 缺少原生组件](wabt-provider-diagnostic-without-native.json)
- [补入原生组件后](wabt-provider-with-native.json)
- [提供宿主环境后](wabt-provider-host-diagnostic.json)
- [客户端配置写入失败](client-write-diagnostic.json)
- [原生组件身份](native-artifact.json)
- [补丁与格式校验](patch-validation.json)

发布的 JSON 仅将机器相关源码、固定 Node 和临时目录路径替换为标记；保留测试名称、状态与错误。按名称过滤而未执行的用例会被 Vitest 记作 skipped/pending，这不是新增跳过规则。客户端 JSON 不包含 console.error，上述 rename 系统异常摘录自同一次运行的 stderr。
