import { describe, expect, it } from 'vitest';
import { buildNewTree, generate, parseTree } from '../../scripts/generate-structure.js';

describe('parseTree', () => {
  it('解析目录、文件与行尾注释', () => {
    const { tree } = parseTree([
      '  application/',
      '    submit-audio.ts # 用例编排',
      '    process-job.ts',
      '  shared/',
      '    logger.ts',
    ]);
    const app = tree.application;
    expect(app).toBeDefined();
    const files = app?.__files__ as Record<string, string> | undefined;
    expect(files?.['submit-audio.ts']).toBe('# 用例编排');
    expect(files?.['process-job.ts']).toBe('');
  });
});

describe('buildNewTree', () => {
  it('按路径构建嵌套树', () => {
    const tree = buildNewTree(['application/process-job.ts', 'shared/logger.ts']);
    const appFiles = tree.application?.__files__ as Record<string, string> | undefined;
    expect(appFiles?.['process-job.ts']).toBe('');
    const sharedFiles = tree.shared?.__files__ as Record<string, string> | undefined;
    expect(sharedFiles?.['logger.ts']).toBe('');
  });
});

describe('generate', () => {
  const doc = `# 工程目录结构

## 目录总览

\`\`\`text
src/
  application/
    process-job.ts # 用例编排
  shared/
    logger.ts      # 与领域无关的基础工具
fixtures/
  audio-sample.mp3        # E2E 测试音频 fixture
\`\`\`
`;

  it('新文件追加占位符并报告 missing', () => {
    const disk = ['src/application/process-job.ts', 'src/shared/logger.ts', 'src/shared/ids.ts'];
    const { newText, missing, stale } = generate(doc, disk);
    expect(newText).toContain('ids.ts');
    expect(newText).toContain('<<< 新文件,补注释');
    expect(missing).toEqual(['src/shared/ids.ts']);
    expect(stale).toEqual([]);
  });

  it('stale 条目报错,标 (planned) 的豁免', () => {
    const disk = ['src/application/process-job.ts'];
    const { stale } = generate(doc, disk);
    expect(stale).toEqual(['src/shared/logger.ts']);
    const plannedDoc = doc.replace('logger.ts      # 与领域无关的基础工具', 'logger.ts (planned)');
    const { stale: stalePlanned } = generate(plannedDoc, disk);
    expect(stalePlanned).toEqual([]);
    expect(generate(plannedDoc, disk).newText).toContain('logger.ts (planned)');
  });

  it('保留旧顺序与行尾注释', () => {
    const disk = ['src/shared/logger.ts', 'src/application/process-job.ts'];
    const { newText } = generate(doc, disk);
    expect(newText).toContain('process-job.ts # 用例编排');
    // 旧顺序: application 在 shared 前
    expect(newText.indexOf('application/')).toBeLessThan(newText.indexOf('shared/'));
  });

  it('非生成根(fixtures)原样保留', () => {
    const { newText } = generate(doc, ['src/application/process-job.ts']);
    expect(newText).toContain('audio-sample.mp3        # E2E 测试音频 fixture');
  });

  it('只处理 .ts 文件,幂等:生成后再次生成无变化', () => {
    const disk = ['src/application/process-job.ts', 'src/shared/logger.ts', 'notes.txt'];
    const first = generate(doc, disk);
    expect(first.missing).toEqual([]);
    expect(generate(first.newText, disk).newText).toBe(first.newText);
  });
});
