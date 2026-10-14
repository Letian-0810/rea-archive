# REA Archive

由 Letian-0810 维护的 REA 固定版本公开备份。原项目：[morluto/rea](https://github.com/morluto/rea)，原作者 morluto，原许可证 MIT。

本仓库保存原项目及恢复资料。归档基线：`96e7c22a9cc917448ed080e11cde4dacd2a2d70a`（2026-10-14）。

## 从这里开始

- [REA 原项目](REA/README.md)：固定版本源码和原文档；原作者与许可保留。
- [研读笔记](REA-研读笔记.md)：定位、架构、调用链、Evidence、provider 和使用边界。
- [恢复与验收](本地复现与验收.md)：独立恢复步骤、已验证行为与未验证范围。
- [归档清单](provenance/archives.json)：源码、5 个固定子模块、运行环境与二进制的校验摘要。

## 独立恢复

真实源码归档、大文件实体、离线 npm 缓存和 Windows x64 运行材料保存在本仓库。原 REA 仓库不可访问时，仍可使用这里固定的材料恢复。

在 PowerShell 7 / .NET 8 或以上环境运行：

```powershell
pwsh -NoProfile -File .\recovery\Restore-Local.ps1 -Destination C:\work\rea-restored
```

恢复目录必须尚不存在。脚本会校验归档、离线安装、应用独立兼容补丁、重新构建，并运行 CLI/MCP 的 JavaScript 与 SQLite 验证。

## 已验证范围

已在 Windows x64 全新目录完成离线安装、源码构建、CLI/MCP 初始化、静态 JavaScript 分析、SQLite 查询与 Evidence 导出。两份相关上游验收文件合计 11 项通过、1 项按设计跳过。全套测试未完成，停止前存在其他未归因失败；完整外部引擎与其他平台未逐项验证。详见验收记录。

## 保存范围与署名

当前保存两个固定源码状态，其中主基线在 REA/ 下可直接浏览；另一个正式发布状态作为归档保存。未保存全部历史提交图、所有历史 release、issue 或 PR。REA 内的子模块保留固定 Git 引用，其实际源码和 LFS 文件也另存为本仓库中的归档与内容实体。

REA 使用原 MIT 许可证，见 [LICENSE](LICENSE) 与 [REA/LICENSE](REA/LICENSE)。第三方组件保留各自原有许可与通知。
