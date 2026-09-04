# C3 安全与 Secret 扫描 CI — 验收记录

> 日期：2026-09-04 ｜ 责任人：dorotheaqxq-code ｜ 验证分支：`feature/c3-security-ci`
>
> 实施前基线 commit：`341005650096779eb32a10d9059951df32868b23`；依赖负向测试 commit：`ff33f2a`；恢复 commit：`c0c00c8`；正式 Pull Request：#9；恢复成功的 Actions 运行：#30。
>
> 任务状态以 [`docs/project-division/task-list.md`](../../project-division/task-list.md) 为准。本记录区分正常门禁、预期失败的负向测试和仍待完成的分支保护配置。

## 目标

落实 C3“安全与 secret 扫描 CI”：依赖漏洞与 Secret 扫描作为合并门禁；临时豁免必须提供本仓库 Issue 链接、责任人、失效日期和原因，过期豁免必须使检查失败。

## 实现内容

- `.github/workflows/ci.yml`
  - 新增 `Dependency audit`，分别对根项目和 `web/` 执行 `npm audit --audit-level=high`。
  - 新增仅在 Pull Request 中运行的 `Dependency review`，阻止新引入的 high/critical 漏洞依赖。
  - 新增 `Secret scan`，以完整 Git 历史检出方式运行 `gitleaks/gitleaks-action@v3`。
  - 所有安全步骤均未配置 `continue-on-error` 或其他静默放行方式。
- `.github/security-exceptions.json`
  - 建立安全豁免清单；当前为零豁免。
- `scripts/check-security-exceptions.ts`
  - 校验豁免类型、唯一 ID、本仓库 Issue 链接、责任人、失效日期和原因。
  - 失效日期达到或早于执行当天时检查失败。
- `package.json`
  - 新增 `check:security-exceptions`，并接入现有 `verify` 门禁。
- `.env.example`
  - 将疑似密钥形式的示例值改为明确的非密钥占位符。

## 2026-09-03 本机验证

### 安全豁免正常路径

执行：

```powershell
npm run check:security-exceptions
```

结果：通过，输出 `Validated 0 security exception(s).`。

### 安全豁免负向测试

临时加入一条失效日期为 `2026-01-01` 的测试豁免后再次执行校验。

结果：命令以非零状态退出，并输出：

```text
Error: GHSA-test-test-test: exception expired on 2026-01-01
```

测试完成后已将 `.github/security-exceptions.json` 恢复为零豁免。

### 完整质量门禁

执行：

```powershell
npm run verify
```

结果：通过。

- Biome、OpenAPI、TypeScript、文档和结构检查全部通过。
- 后端 40 个测试文件、291 项测试全部通过。
- 前端 1 个测试文件、9 项测试全部通过。
- Web 生产构建通过。
- 覆盖率：Statements 92.61%、Branches 88.41%、Functions 93.82%、Lines 94.54%，均高于 80% 门槛。

### 依赖漏洞审计

执行：

```powershell
npm audit --audit-level=high
npm audit --prefix web --audit-level=high
```

基线结果：在未加入测试依赖时，两条命令均以状态码 0 结束，C3 的 high/critical 门禁通过。

- 根项目发现 `qs` 的 1 个 moderate 漏洞，命中两条安全公告：
  - `GHSA-x5fp-wj9c-mxmx`：通过带逗号的 bracket key 绕过 `arrayLimit` 限制。攻击者可能构造异常查询参数，使解析结果突破应用预期的数组数量限制，增加资源消耗或绕过依赖该限制的输入约束。
  - `GHSA-4mjr-xmp4-gh2g`：`isBuffer` 判断可被攻击者控制的对象触发，形成拒绝服务风险。恶意查询输入可能使解析过程抛出异常或消耗资源，影响服务可用性。
- `moderate` 严重级别来自 2026-09-03 本机执行 `npm audit` 时 npm Registry 返回的公告数据，并非项目成员主观判断。npm 将当前受影响的 `qs` 依赖节点汇总为 `1 moderate severity vulnerability`。
- C3 当前使用 `npm audit --audit-level=high`：high 和 critical 会返回非零状态并阻断 CI，moderate 会被报告但不会使该命令失败。因此本次审计状态码为 0，表示通过 high/critical 门禁，不表示依赖树完全没有漏洞。
- 初始处理决定：该 moderate 漏洞不阻塞 high/critical 门禁，但必须保留记录并优先采用兼容升级修复，不使用可能引入破坏性升级的 `npm audit fix --force`。
- `web/`：0 个漏洞。

完整命令、npm 原始输出与退出码见 [`2026-09-03-npm-audit-output.txt`](./2026-09-03-npm-audit-output.txt)。

### `qs` moderate 漏洞修复（2026-09-04）

执行 `npm audit fix --dry-run` 后确认唯一建议变更为 `qs 6.15.3 => 6.16.0`。`qs` 是 `express@5.2.1` 和 `body-parser@2.3.0` 的间接依赖，两者的兼容版本范围均允许 6.16.0，因此通过 `npm update qs` 只更新 `package-lock.json`，未修改业务代码或根 `package.json`。

修复后结果：

- `npm ls qs`：Express 与 body-parser 均使用去重后的 `qs@6.16.0`。
- `npm audit --audit-level=high`：`found 0 vulnerabilities`。
- `npm audit --prefix web --audit-level=high`：`found 0 vulnerabilities`。
- `npm run verify`：全部通过；后端 291 项测试、前端 9 项测试通过，覆盖率保持 Statements 92.61%、Branches 88.41%、Functions 93.82%、Lines 94.54%。

结论：两条 `qs` moderate 公告已通过兼容升级修复，无需建立临时安全豁免。

### GitHub PR 依赖漏洞负向测试（2026-09-04）

为验证云端门禁，临时在 PR 分支加入 `lodash@4.17.20`，并推送测试 commit `ff33f2a`。该版本在当前 npm Registry 审计中命中 high 级别的命令注入、ReDoS 和原型污染公告。

截图显示本次 Pull Request 检查结果为：

- `Dependency audit (pull_request)`：失败（预期结果）。
- `Dependency review (pull_request)`：失败（预期结果）。
- `Secret scan (pull_request)`：通过。
- `Static quality gates (pull_request)`：通过。
- `Tests and coverage (pull_request)`：通过。
- PR 与 `main`：无冲突，可自动合并，但在安全检查失败期间不得合并。

这证明 high 级漏洞依赖能够被 npm 审计和 PR 依赖审查阻断。失败检查的 PR 页面截图/链接应在最终归档时补充到本节。

负向测试后已通过 commit `c0c00c8` 删除 `lodash`，`package.json` 和 `package-lock.json` 与加入测试依赖前一致。正式 PR #9 的 Actions 运行 #30 最终为 `Success`：`Dependency audit`、`Dependency review`、`Secret scan`、`Static quality gates` 和 `Tests and coverage` 五项检查全部通过，且 PR 与 `main` 无冲突。成功运行链接仍待补充。

### GitHub PR Secret 负向测试（2026-09-04）

为避免合成 Secret 留在正式 C3 分支历史中，从恢复后的 `feature/c3-security-ci` 创建独立分支 `test/c3-secret-negative`，只加入 `fixtures/gitleaks-negative-test.txt`，测试 commit 为 `a24460e`，并通过临时 PR #10 触发扫描。

`gitleaks/gitleaks-action@v3` 使用 Gitleaks 8.24.3 扫描后给出：

- `RuleID`：`generic-api-key`。
- 文件：`fixtures/gitleaks-negative-test.txt`。
- 行号：1。
- commit：`a24460eea0c78ec92ebcef2ab0fa7fe094694f87`。
- 指纹：`a24460eea0c78ec92ebcef2ab0fa7fe094694f87:fixtures/gitleaks-negative-test.txt:generic-api-key:1`。
- 扫描结果：`Leaks found: 1`，`Secret scan` 以非零状态失败，符合负向测试预期。

Action 因当前 `GITHUB_TOKEN` 权限不足而无法向 PR #10 自动写评论，日志显示 `Resource not accessible by integration`；该警告不影响 Secret 的实际检出、SARIF 结果上传或门禁失败结论。

临时 PR #10 仅用于负向验证，不得合并。保存失败截图和 Actions 链接后，应关闭该 PR、删除远程及本地测试分支，并确保正式 PR #9 保持全绿。

### 工作树检查

`git diff --check` 通过，无空白错误。当前 C3 修改仍在工作树中，尚未提交或推送。

## 尚待补齐的 GitHub 验收证据

以下内容不能由本机检查替代，在全部完成前不得把 C3 标记为“已完成”：

- [x] 创建独立 C3 分支和 Pull Request；已记录测试 commit `ff33f2a`，PR 链接待补充。
- [x] 正式 PR #9 的 Actions 运行 #30 在恢复 commit `c0c00c8` 上五项检查全部通过；截图已取得，Actions 运行链接待补充。
- [x] 在独立临时 PR #10 使用合成凭证完成 Secret 负向测试；Gitleaks 以 `generic-api-key` 检出测试文件并报告 `Leaks found: 1`，失败 Actions 链接待补充。
- [x] 临时引入 `lodash@4.17.20`，证明 `Dependency audit` 和 `Dependency review` 会失败；依赖及 lockfile 已恢复，并在 commit `c0c00c8` 上重新全绿。
- [ ] 确认全历史 Gitleaks 扫描不会因旧版 `.env.example` 占位符产生误报；如有告警，只做精确处理并保留审计记录。
- [ ] 在 `main` Ruleset 中要求通过 PR 合并，并将安全检查设为 Required；补充 Ruleset 截图。
- [ ] 若仓库属于 GitHub Organization，确认 Gitleaks Action 的许可证配置；不得用 `continue-on-error` 绕过失败。

## 临时豁免边界

当前豁免清单为空，CI 采用严格失败策略。现有校验脚本负责豁免元数据治理，但尚未自动过滤 `npm audit` 或 Gitleaks 的扫描结果。因此，在实现扫描结果与豁免 ID 的精确关联前，向 JSON 添加记录不会让扫描器自动放行，也不应被表述为已经生效的技术豁免。

确需临时豁免时，每项至少包含：

```json
{
  "type": "dependency",
  "id": "GHSA-xxxx-xxxx-xxxx",
  "issue": "https://github.com/shuidisjtu/multimodel-blog-helper/issues/123",
  "owner": "dorotheaqxq-code",
  "expires": "2026-09-30",
  "reason": "上游尚未发布兼容修复版本"
}
```

不得使用 `npm audit || true`、`continue-on-error`、永久忽略目录或宽泛 Secret 正则作为替代方案。

## 完成判定

本机实现、过期豁免验证、GitHub PR 依赖漏洞负向测试和独立 PR Secret 负向测试均已通过验收；测试依赖恢复后正式 PR 五项检查已重新全绿。仍需关闭并清理 Secret 临时 PR/分支、配置 Required Checks、补充 PR/Actions 链接及最终版本信息，之后才能更新任务清单中的 C3 状态。
