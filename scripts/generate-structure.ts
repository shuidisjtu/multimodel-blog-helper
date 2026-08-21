#!/usr/bin/env node
/**
 * Regenerate the src/ and tests/ tree blocks of docs/project-structure.md.
 *
 * The structure source is the set of git-tracked .ts files (git ls-files),
 * which automatically excludes temp/, coverage/ and other ignored files.
 * Hand-written annotations and directory order are preserved from the
 * current document; files new on disk appear with a `<<< 新文件,补注释`
 * placeholder so the missing annotation stays visible.
 *
 * Usage:
 *   tsx scripts/generate-structure.ts --check   # verify (exit 0/1)
 *   tsx scripts/generate-structure.ts --update  # rewrite the document
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STRUCTURE_MD = path.join(PROJECT_ROOT, 'docs', 'project-structure.md');

const GENERATABLE_ROOTS = ['src', 'tests'];
export const PLACEHOLDER = '<<< 新文件,补注释';
export const FILES_KEY = '__files__';

export type FileMap = Record<string, string>;
export type Tree = { [key: string]: Tree | FileMap };
export interface GenerateResult {
  newText: string;
  missing: string[]; // 磁盘有、文档无（需补注释）
  stale: string[]; // 文档有、磁盘无（除非标 (planned)）
}

function joinPath(pathStr: string, name: string): string {
  return pathStr ? `${pathStr}/${name}` : name;
}

/** 取子目录节点,不存在则创建。 */
function childDir(node: Tree, key: string): Tree {
  const child = node[key];
  if (child !== undefined) return child as Tree;
  const created: Tree = {};
  node[key] = created;
  return created;
}

/** 取文件表,不存在则创建。 */
function ensureFileMap(node: Tree): FileMap {
  const files = node[FILES_KEY];
  if (files !== undefined) return files as FileMap;
  const created: FileMap = {};
  node[FILES_KEY] = created;
  return created;
}

/** 解析 ```text 块内容为 (嵌套树, 目录注释表)。目录注释表: 目录完整路径 -> 行尾注释。 */
export function parseTree(content: string[]): { tree: Tree; dirAnn: Record<string, string> } {
  const tree: Tree = {};
  const dirAnn: Record<string, string> = {};
  const stack: Array<[number, Tree, string]> = [];
  for (const line of content) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const ws = trimmed.search(/\s/);
    const name = ws === -1 ? trimmed : trimmed.slice(0, ws);
    const ann = ws === -1 ? '' : trimmed.slice(ws).trim();
    while (stack.length > 0) {
      const top = stack.at(-1);
      if (!top || top[0] < indent) break;
      stack.pop();
    }
    if (name.endsWith('/')) {
      const dir = name.slice(0, -1);
      const top = stack.at(-1);
      const parent = top?.[1] ?? tree;
      const node: Tree = {};
      parent[dir] = node;
      const full = top ? `${top[2]}/${dir}` : dir;
      stack.push([indent, node, full]);
      if (ann) dirAnn[full] = ann;
    } else if (name.endsWith('.ts')) {
      const parent = stack.at(-1)?.[1] ?? tree;
      const files = ensureFileMap(parent);
      files[name] = ann;
    }
  }
  return { tree, dirAnn };
}

/** 从磁盘相对路径构建嵌套树。 */
export function buildNewTree(relPaths: string[]): Tree {
  const tree: Tree = {};
  for (const p of relPaths) {
    const parts = p.split('/');
    let node = tree;
    for (const part of parts.slice(0, -1)) {
      node = childDir(node, part);
    }
    const files = ensureFileMap(node);
    files[parts.at(-1) ?? ''] = '';
  }
  return tree;
}

/** 子树是否含 (planned) 条目(文件注释或目录自身注释): 磁盘不存在的目录若仍记录待建条目,需保留在文档中。 */
function hasPlanned(tree: Tree | undefined, dirAnn: Record<string, string>, full: string): boolean {
  if (!tree) return false;
  if ((dirAnn[full] ?? '').includes('(planned)')) return true;
  for (const [k, v] of Object.entries(tree)) {
    if (k === FILES_KEY) {
      for (const ann of Object.values(v as FileMap)) {
        if (ann.includes('(planned)')) return true;
      }
    } else if (hasPlanned(v as Tree, dirAnn, joinPath(full, k))) {
      return true;
    }
  }
  return false;
}

function mergeTree(
  oldTree: Tree | undefined,
  newTree: Tree,
  dirAnn: Record<string, string>,
  pathStr: string,
  level: number,
  out: string[],
  missing: string[],
): void {
  const newDirs = Object.keys(newTree).filter((k) => k !== FILES_KEY);
  const newFiles = Object.keys((newTree[FILES_KEY] ?? {}) as FileMap);
  const seenDirs = new Set<string>();
  for (const k of Object.keys(oldTree ?? {})) {
    if (k === FILES_KEY) continue;
    const oldChild = oldTree?.[k] as Tree | undefined;
    if (!newDirs.includes(k)) {
      // 目录在磁盘已不存在:仅当仍记录 (planned) 待建条目时保留
      if (hasPlanned(oldChild, dirAnn, joinPath(pathStr, k))) {
        const ann = dirAnn[joinPath(pathStr, k)] ?? '';
        out.push(`${'  '.repeat(level)}${k}/${ann ? ` ${ann}` : ''}`);
        mergeTree(oldChild, {} as Tree, dirAnn, joinPath(pathStr, k), level + 1, out, missing);
      }
      continue;
    }
    const ann = dirAnn[joinPath(pathStr, k)] ?? '';
    out.push(`${'  '.repeat(level)}${k}/${ann ? ` ${ann}` : ''}`);
    mergeTree(oldChild, newTree[k] as Tree, dirAnn, joinPath(pathStr, k), level + 1, out, missing);
    seenDirs.add(k);
  }
  for (const k of newDirs.filter((d) => !seenDirs.has(d)).sort()) {
    out.push(`${'  '.repeat(level)}${k}/`);
    mergeTree(undefined, newTree[k] as Tree, dirAnn, joinPath(pathStr, k), level + 1, out, missing);
  }
  const oldFiles = (oldTree?.[FILES_KEY] ?? {}) as FileMap;
  const seenFiles = new Set<string>();
  for (const [name, ann] of Object.entries(oldFiles)) {
    if (!newFiles.includes(name)) {
      if (ann.includes('(planned)')) out.push(`${'  '.repeat(level)}${name} ${ann}`);
      continue; // stale 条目由 generate() 报告
    }
    if (ann === PLACEHOLDER) {
      // 占位符不算真实注释:持续报 missing,直至补上真实注释
      out.push(`${'  '.repeat(level)}${name} ${PLACEHOLDER}`);
      missing.push(joinPath(pathStr, name));
    } else {
      out.push(`${'  '.repeat(level)}${name}${ann ? ` ${ann}` : ''}`);
    }
    seenFiles.add(name);
  }
  for (const name of newFiles.filter((f) => !seenFiles.has(f)).sort()) {
    out.push(`${'  '.repeat(level)}${name} ${PLACEHOLDER}`);
    missing.push(joinPath(pathStr, name));
  }
}

function walkTree(
  tree: Tree | undefined,
  pathStr: string,
  acc: Set<string>,
  onlyPlanned: boolean,
): void {
  if (!tree) return;
  for (const [k, v] of Object.entries(tree)) {
    if (k === FILES_KEY) {
      for (const [name, ann] of Object.entries(v as FileMap)) {
        if (!onlyPlanned || ann.includes('(planned)')) acc.add(joinPath(pathStr, name));
      }
    } else {
      walkTree(v as Tree, joinPath(pathStr, k), acc, onlyPlanned);
    }
  }
}

function rebuildBlock(
  block: string[],
  diskSet: Set<string>,
  missing: string[],
  stale: string[],
): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < block.length) {
    const line = block[i] ?? '';
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (!trimmed || indent > 0 || !trimmed.endsWith('/')) {
      out.push(line);
      i++;
      continue;
    }
    const name = trimmed.slice(0, -1);
    if (!GENERATABLE_ROOTS.includes(name)) {
      out.push(line);
      i++;
      continue;
    }
    const sub: string[] = [];
    let j = i + 1;
    while (j < block.length) {
      const subLine = block[j] ?? '';
      if (!subLine.trim() || !subLine.startsWith(' ')) break;
      sub.push(subLine);
      j++;
    }
    const { tree: oldTree, dirAnn } = parseTree(sub);
    // dirAnn 键相对块根(bootstrap/…),mergeTree 以完整路径(src/bootstrap)查找,这里统一加根前缀
    const prefixedDirAnn: Record<string, string> = {};
    for (const [k, v] of Object.entries(dirAnn)) prefixedDirAnn[`${name}/${k}`] = v;
    const rootFiles = [...diskSet]
      .filter((f) => f.startsWith(`${name}/`))
      .map((f) => f.slice(name.length + 1));
    const newTree: Tree = { [name]: buildNewTree(rootFiles) };
    const blockLines: string[] = [`${name}/`];
    mergeTree(oldTree, newTree[name] as Tree, prefixedDirAnn, name, 1, blockLines, missing);
    const docEntries = new Set<string>();
    const planned = new Set<string>();
    walkTree(oldTree, name, docEntries, false);
    walkTree(oldTree, name, planned, true);
    for (const entry of docEntries) {
      if (!diskSet.has(entry) && !planned.has(entry)) stale.push(entry);
    }
    out.push(...blockLines);
    i = j;
  }
  return out;
}

/** 重建文档树块: 只替换 src/ 与 tests/ 子树, 其余行原样保留。 */
export function generate(text: string, diskFiles: string[]): GenerateResult {
  const lines = text.split('\n');
  const diskSet = new Set(
    diskFiles.filter((f) => f.endsWith('.ts') && GENERATABLE_ROOTS.includes(f.split('/')[0] ?? '')),
  );
  const missing: string[] = [];
  const stale: string[] = [];
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('```')) {
      const fence = line;
      const block: string[] = [];
      i++;
      while (i < lines.length) {
        const blockLine = lines[i] ?? '';
        if (blockLine.trim() === '```') break;
        block.push(blockLine);
        i++;
      }
      out.push(fence);
      out.push(...rebuildBlock(block, diskSet, missing, stale));
      if (i < lines.length) {
        out.push(lines[i] ?? '');
        i++;
      }
    } else {
      out.push(line);
      i++;
    }
  }
  return {
    newText: `${out.join('\n').replace(/\n+$/, '')}\n`,
    missing: missing.sort(),
    stale: stale.sort(),
  };
}

/** Git-tracked .ts 文件(事实源);git 不可用时目录遍历兜底。 */
export function trackedFiles(): string[] {
  try {
    const stdout = execFileSync('git', ['ls-files'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
    const files = stdout.split('\n').filter((f) => f.endsWith('.ts'));
    if (files.length > 0) return files;
  } catch {
    // git 不可用,走目录遍历
  }
  const skip = new Set(['node_modules', 'temp', 'coverage', 'dist', '.git', 'book-examples']);
  const walk = (dir: string): string[] => {
    const result: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...walk(full));
      } else if (entry.name.endsWith('.ts')) {
        result.push(path.relative(PROJECT_ROOT, full).replace(/\\/g, '/'));
      }
    }
    return result;
  };
  return walk(PROJECT_ROOT).sort();
}

/** --check: 不一致即失败;--update: 重写文档并输出待补注释/待删条目。 */
export function main(argv: string[] = process.argv.slice(2)): number {
  const flag = argv[0];
  if (flag !== '--check' && flag !== '--update') {
    console.error('usage: generate-structure.ts --check | --update');
    return 2;
  }
  if (!existsSync(STRUCTURE_MD)) {
    console.error(`error: ${STRUCTURE_MD} not found`);
    return 1;
  }
  const text = readFileSync(STRUCTURE_MD, 'utf8');
  const disk = trackedFiles();
  const { newText, missing, stale } = generate(text, disk);
  const changed = newText !== text;
  if (flag === '--update') {
    if (changed) writeFileSync(STRUCTURE_MD, newText, 'utf8');
    if (missing.length > 0) {
      console.log('files without annotation (add one after the file name):');
      for (const f of missing) console.log(`  ${f}`);
    }
    if (stale.length > 0) {
      console.log('documented files missing from disk (removed by this update):');
      for (const f of stale) console.log(`  ${f}`);
    }
    return 0;
  }
  let problems = 0;
  if (changed) {
    console.error(`error: ${STRUCTURE_MD} is out of sync -- run 'npm run structure:update'`);
    problems++;
  }
  for (const f of missing) {
    console.error(`error: ${f} exists on disk but is missing from the document`);
    problems++;
  }
  for (const f of stale) {
    console.error(
      `error: ${f} is listed but does not exist on disk -- remove it or mark (planned)`,
    );
    problems++;
  }
  if (problems === 0) console.log('structure document is up to date');
  return problems === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
