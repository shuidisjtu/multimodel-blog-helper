#!/usr/bin/env node
/**
 * Documentation-code consistency gate.
 *
 * Rules:
 * 1. Path references -- every `path/file.{ts,md}` in docs must exist on disk.
 * 2. Structure consistency -- docs/project-structure.md tree must match
 *    git-tracked .ts files (bidirectional, reuses generate-structure).
 * 4. Index completeness -- README.md must list all doc files under docs/
 *    (directly or via a listed ancestor directory).
 * 5. Markdown links -- every md link target must exist on disk
 *    (external URLs and # anchors are skipped).
 *
 * CLAUDE.md is gitignored (absent in CI) and intentionally out of scope.
 * docs/superpowers/ is a local-only scratch area and excluded.
 *
 * Usage:
 *   tsx scripts/check-docs.ts
 *
 * Exit 0 when all checks pass, 1 otherwise.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, STRUCTURE_MD, trackedFiles } from './generate-structure.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(PROJECT_ROOT, 'docs');
const PATH_ROOTS = ['src', 'tests', 'scripts', 'docs', 'fixtures', '.github'];
const PATH_PATTERN = new RegExp(`\`((${PATH_ROOTS.join('|')})/[^\`]+\\.(?:ts|md))\``, 'g');
const MD_LINK_PATTERN = /\[[^\]]+\]\(([^)]+)\)/g;

export interface Issue {
  rule: string;
  file: string;
  line: number | null;
  message: string;
  severity: 'error' | 'warning';
}

/** README.md + docs/**\/ 下全部 .md(排除 superpowers 本地目录),repo 相对路径,排序。 */
export function mdFiles(): string[] {
  const result: string[] = [];
  const readme = path.join(PROJECT_ROOT, 'README.md');
  if (existsSync(readme)) result.push('README.md');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'superpowers') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        result.push(path.relative(PROJECT_ROOT, full).replace(/\\/g, '/'));
      }
    }
  };
  walk(DOCS_DIR);
  return result.sort();
}

function lineNo(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/** Rule 1: 反引号路径引用必须存在于磁盘。 */
export function checkPathRefs(text: string, file: string): Issue[] {
  const issues: Issue[] = [];
  for (const m of text.matchAll(PATH_PATTERN)) {
    const ref = m[1] ?? '';
    if (/[{*?]/.test(ref)) continue; // 列表简写,非单个文件声明
    if (!existsSync(path.join(PROJECT_ROOT, ref))) {
      issues.push({
        rule: 'rule-1',
        file,
        line: lineNo(text, m.index ?? 0),
        message: `referenced file not found: \`${ref}\``,
        severity: 'error',
      });
    }
  }
  return issues;
}

/** Rule 5: markdown 链接目标必须存在(外链/mailto/# 锚点跳过)。 */
export function checkMdLinks(text: string, file: string): Issue[] {
  const issues: Issue[] = [];
  const fileDir = path.dirname(path.join(PROJECT_ROOT, file));
  for (const m of text.matchAll(MD_LINK_PATTERN)) {
    const raw = (m[1] ?? '').trim().split('#', 1)[0]?.trim() ?? '';
    if (
      !raw ||
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('mailto:')
    ) {
      continue;
    }
    if (raw === 'CLAUDE.md') continue; // gitignored,CI 中不存在
    if (!existsSync(path.join(fileDir, raw))) {
      issues.push({
        rule: 'rule-5',
        file,
        line: lineNo(text, m.index ?? 0),
        message: `markdown link target not found: \`${raw}\``,
        severity: 'error',
      });
    }
  }
  return issues;
}

/** Rule 4: README.md 的链接必须覆盖 docs/ 下全部 .md(自身或祖先目录)。 */
export function checkIndexCompleteness(readmeText: string): Issue[] {
  const targets = new Set<string>();
  for (const m of readmeText.matchAll(MD_LINK_PATTERN)) {
    const raw = (m[1] ?? '').trim().split('#', 1)[0]?.trim() ?? '';
    if (raw.startsWith('docs/')) targets.add(raw);
  }
  const issues: Issue[] = [];
  for (const file of mdFiles()) {
    if (!file.startsWith('docs/')) continue;
    const parts = file.split('/');
    let covered = targets.has(file);
    for (let i = 2; i < parts.length && !covered; i++) {
      if (targets.has(`${parts.slice(0, i).join('/')}/`)) covered = true;
    }
    if (!covered) {
      issues.push({
        rule: 'rule-4',
        file: 'README.md',
        line: null,
        message: `\`${file}\` exists under docs/ but is not listed in README.md`,
        severity: 'error',
      });
    }
  }
  return issues;
}

/** Rule 2: 结构文档与 git-tracked .ts 双向一致(复用 generate)。 */
export function checkStructureConsistency(): Issue[] {
  if (!existsSync(STRUCTURE_MD)) {
    return [
      {
        rule: 'rule-2',
        file: 'docs/project-structure.md',
        line: null,
        message: 'project-structure.md not found',
        severity: 'error',
      },
    ];
  }
  const text = readFileSync(STRUCTURE_MD, 'utf8');
  const { missing, stale } = generate(text, trackedFiles());
  const issues: Issue[] = [];
  for (const rel of missing) {
    issues.push({
      rule: 'rule-2',
      file: 'docs/project-structure.md',
      line: null,
      message: `\`${rel}\` exists on disk but is missing from project-structure.md`,
      severity: 'error',
    });
  }
  for (const rel of stale) {
    issues.push({
      rule: 'rule-2',
      file: 'docs/project-structure.md',
      line: null,
      message: `\`${rel}\` is listed in project-structure.md but does not exist on disk -- remove it or mark (planned)`,
      severity: 'error',
    });
  }
  return issues;
}

export function main(): number {
  const issues: Issue[] = [];
  for (const file of mdFiles()) {
    const text = readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    issues.push(...checkPathRefs(text, file));
    issues.push(...checkMdLinks(text, file));
  }
  issues.push(
    ...checkIndexCompleteness(readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8')),
  );
  issues.push(...checkStructureConsistency());

  const byRule = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = byRule.get(issue.rule) ?? [];
    list.push(issue);
    byRule.set(issue.rule, list);
  }
  const order = ['rule-1', 'rule-2', 'rule-4', 'rule-5'];
  for (const rule of order) {
    const list = byRule.get(rule) ?? [];
    console.log(`-- ${rule} (${list.length}) --`);
    for (const issue of list) {
      const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
      console.log(
        `  [${issue.severity === 'error' ? 'ERROR' : 'WARN'}] ${loc} -- ${issue.message}`,
      );
    }
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  if (errors === 0) {
    console.log('All checks passed.');
    return 0;
  }
  console.log(`${errors} error(s) found.`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
