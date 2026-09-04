# C3 安全与 Secret 扫描 CI — 验收记录

> 日期：2026-09-03 ｜ 责任人：dorotheaqxq-code ｜ 当前分支：`main`
>
> 当前基线 commit：`341005650096779eb32a10d9059951df32868b23`。C3 变更尚未提交，因此该 SHA 仅表示实施前基线，不是最终验收版本。
>
> 任务状态以 [`docs/project-division/task-list.md`](../../project-division/task-list.md) 为准。本记录只把已经执行的本机检查记为通过；PR、GitHub Actions、Secret 负向测试和分支保护仍待完成。

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

结果：两条命令均以状态码 0 结束，C3 的 high/critical 门禁通过。

- 根项目发现 `qs` 的 1 个 moderate 漏洞，命中两条安全公告：
  - `GHSA-x5fp-wj9c-mxmx`：通过带逗号的 bracket key 绕过 `arrayLimit` 限制。攻击者可能构造异常查询参数，使解析结果突破应用预期的数组数量限制，增加资源消耗或绕过依赖该限制的输入约束。
  - `GHSA-4mjr-xmp4-gh2g`：`isBuffer` 判断可被攻击者控制的对象触发，形成拒绝服务风险。恶意查询输入可能使解析过程抛出异常或消耗资源，影响服务可用性。
- `moderate` 严重级别来自 2026-09-03 本机执行 `npm audit` 时 npm Registry 返回的公告数据，并非项目成员主观判断。npm 将当前受影响的 `qs` 依赖节点汇总为 `1 moderate severity vulnerability`。
- C3 当前使用 `npm audit --audit-level=high`：high 和 critical 会返回非零状态并阻断 CI，moderate 会被报告但不会使该命令失败。因此本次审计状态码为 0，表示通过 high/critical 门禁，不表示依赖树完全没有漏洞。
- 当前处理决定：该 moderate 漏洞不阻塞 C3 合并，但必须保留记录并安排兼容升级；若漏洞等级升高、确认存在可利用的公网查询参数入口，或风险评估发生变化，应立即提升修复优先级。升级时先执行 `npm audit fix --dry-run` 评估变更，不直接使用可能引入破坏性升级的 `npm audit fix --force`。
- `web/`：0 个漏洞。

完整命令、npm 原始输出与退出码见 [`2026-09-03-npm-audit-output.txt`](./2026-09-03-npm-audit-output.txt)。

### 工作树检查

`git diff --check` 通过，无空白错误。当前 C3 修改仍在工作树中，尚未提交或推送。

## 尚待补齐的 GitHub 验收证据

以下内容不能由本机检查替代，在全部完成前不得把 C3 标记为“已完成”：

- [ ] 创建独立 C3 分支和 Pull Request，并补充最终 commit SHA、分支名及 PR 链接。
- [ ] 保存正常 PR 中 `Dependency audit`、`Dependency review` 和 `Secret scan` 全部通过的 Actions 链接或截图。
- [ ] 使用 Gitleaks 官方测试假凭证完成 Secret 负向测试，证明 `Secret scan` 会失败；不得使用真实密钥。
- [ ] 临时引入经确认的 high 漏洞测试依赖，证明 `Dependency audit` 或 `Dependency review` 会失败；测试后恢复依赖和 lockfile。
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

本机实现及本机正常/过期豁免验证已通过；GitHub PR 实跑、Secret 与漏洞依赖负向测试、Required Checks 和最终版本信息尚待补齐。全部完成并归档后，才能更新任务清单中的 C3 状态。
