import { describe, expect, it } from 'vitest';
import { checkIndexCompleteness, checkMdLinks, checkPathRefs } from '../../scripts/check-docs.js';

describe('checkPathRefs', () => {
  it('不存在的反引号路径报错,存在的通过', () => {
    const text = '见 `src/application/process-job.ts` 与 `src/does-not-exist.ts`';
    const issues = checkPathRefs(text, 'README.md');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('rule-1');
    expect(issues[0]?.message).toContain('src/does-not-exist.ts');
  });

  it('glob 列表简写跳过(如 src/application/{a,b}.ts)', () => {
    const text = '`src/application/{submit-audio,process-job}.ts`';
    expect(checkPathRefs(text, 'README.md')).toHaveLength(0);
  });
});

describe('checkMdLinks', () => {
  it('外链与 # 锚点跳过,相对路径必须存在', () => {
    const text = [
      '[官网](https://biomejs.dev)',
      '[锚点](#sec)',
      '[架构](docs/architecture/architecture-design.md)',
      '[坏链接](docs/architecture/does-not-exist.md)',
    ].join('\n');
    const issues = checkMdLinks(text, 'README.md');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('docs/architecture/does-not-exist.md');
  });
});

describe('checkIndexCompleteness', () => {
  it('docs/ 下每个 .md 必须被 README 精确链接或目录级覆盖', () => {
    const readme = '[架构](docs/architecture/)\n[任务清单](docs/project-division/task-list.md)';
    const issues = checkIndexCompleteness(readme);
    // 目录级覆盖与精确链接都应通过;缺 records/ 时报错
    expect(issues.filter((i) => i.message.includes('records/2026'))).toHaveLength(1);
  });
});
