import { readFile } from 'node:fs/promises';

interface SecurityException {
  type: 'dependency' | 'secret';
  id: string;
  issue: string;
  owner: string;
  expires: string;
  reason: string;
}

interface SecurityExceptionsFile {
  exceptions: SecurityException[];
}

const exceptionsUrl = new URL('../.github/security-exceptions.json', import.meta.url);
const repositoryIssuePattern =
  /^https:\/\/github\.com\/shuidisjtu\/multimodel-blog-helper\/issues\/\d+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const content = await readFile(exceptionsUrl, 'utf8');
const data = JSON.parse(content) as SecurityExceptionsFile;

if (!Array.isArray(data.exceptions)) {
  throw new Error('security-exceptions.json: exceptions must be an array');
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const seenIds = new Set<string>();

for (const exception of data.exceptions) {
  if (exception.type !== 'dependency' && exception.type !== 'secret') {
    throw new Error(`${exception.id || 'unknown'}: invalid exception type`);
  }

  if (!exception.id?.trim()) {
    throw new Error('security exception is missing an id');
  }

  if (seenIds.has(exception.id)) {
    throw new Error(`${exception.id}: duplicate exception id`);
  }
  seenIds.add(exception.id);

  if (!repositoryIssuePattern.test(exception.issue)) {
    throw new Error(`${exception.id}: issue must link to this repository`);
  }

  if (!exception.owner?.trim()) {
    throw new Error(`${exception.id}: owner is required`);
  }

  if (!exception.reason?.trim()) {
    throw new Error(`${exception.id}: reason is required`);
  }

  if (!datePattern.test(exception.expires)) {
    throw new Error(`${exception.id}: expires must use YYYY-MM-DD`);
  }

  const expires = new Date(`${exception.expires}T00:00:00Z`);
  if (Number.isNaN(expires.getTime())) {
    throw new Error(`${exception.id}: expires is not a valid date`);
  }

  if (expires <= today) {
    throw new Error(`${exception.id}: exception expired on ${exception.expires}`);
  }
}

console.log(`Validated ${data.exceptions.length} security exception(s).`);
