#!/usr/bin/env node
/**
 * Builds the job tables for the public GitHub jobs repo:
 *   README.md  - remote developer jobs open worldwide
 *   JUNIOR.md  - remote junior and internship developer jobs (any location)
 *
 * Reads the boards' public API (no keys, no database), so it runs anywhere,
 * including the repo's own scheduled GitHub Action. No dependencies.
 *
 *   node generate.mjs [outDir]        # default: current directory
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BOARDS = [
  { key: 'frontend', name: 'Frontend', domain: 'https://www.remotefrontendjobs.com' },
  { key: 'backend', name: 'Backend', domain: 'https://www.remotebackendjobs.com' },
  { key: 'java', name: 'Java', domain: 'https://www.remotejavajobs.com' },
];
/** The API is the same behind every board domain; one host keeps it simple. */
const API = 'https://www.remotefrontendjobs.com/api/jobs';
// The site challenges requests from hosting networks (GitHub's runners
// included). A firewall rule lets this header through; the value is the
// repo secret JOBS_REPO_KEY. Unset (a laptop), no header is sent.
const API_HEADERS = {
  Accept: 'application/json',
  ...(process.env.JOBS_REPO_KEY ? { 'x-jobs-repo-key': process.env.JOBS_REPO_KEY } : {}),
};
const PAGE = 50;
const MAX_PER_TABLE = 150;
const MAX_AGE_DAYS = 21;
const UTM = 'utm_source=github&utm_medium=referral&utm_campaign=jobs-repo';

const slugify = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The API answers an occasional 5xx under load: retry before giving up. */
async function getJson(url) {
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: API_HEADERS });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
  }
  // Fail the run rather than publish a half-empty table.
  throw new Error(`${last} for ${url}`);
}

async function fetchJobs(board, params) {
  const jobs = [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  // The listing API serves the first 250 ranked jobs and answers 500 past that.
  for (let offset = 0; jobs.length < MAX_PER_TABLE && offset + PAGE <= 250; offset += PAGE) {
    const query = new URLSearchParams({ board, limit: String(PAGE), offset: String(offset), ...params });
    const page = await getJson(`${API}?${query}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const job of page) {
      if (new Date(job.isoDate ?? job.createdAt).getTime() >= cutoff) jobs.push(job);
    }
    if (page.length < PAGE) break;
  }
  const seen = new Set();
  return jobs
    .filter((job) => (seen.has(job.id) ? false : seen.add(job.id)))
    .sort((a, b) => new Date(b.isoDate ?? b.createdAt) - new Date(a.isoDate ?? a.createdAt))
    .slice(0, MAX_PER_TABLE);
}

function pay(job) {
  const k = (n) => `$${Math.round(n / 1000)}k`;
  if (job.salaryMinYearly && job.salaryMaxYearly && job.salaryMinYearly !== job.salaryMaxYearly) {
    return `${k(job.salaryMinYearly)}–${k(job.salaryMaxYearly)}`;
  }
  if (job.salaryMinYearly || job.salaryMaxYearly) return k(job.salaryMinYearly || job.salaryMaxYearly);
  return '';
}

function openTo(job) {
  if ((job.geoRegions ?? '').includes(',worldwide,')) return 'Worldwide';
  return job.geoLabel || 'Not stated';
}

const day = (job) =>
  new Date(job.isoDate ?? job.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function table(board, jobs, { showLocation }) {
  if (!jobs.length) return '_Nothing in the last three weeks._\n';
  const head = showLocation
    ? '| Company | Role | Open to | Level | Pay / year | Posted |\n|---|---|---|---|---|---|\n'
    : '| Company | Role | Level | Pay / year | Posted |\n|---|---|---|---|---|\n';
  const rows = jobs.map((job) => {
    const url = `${board.domain}/${job.id}-${slugify(job.title)}?${UTM}`;
    const cols = [
      cell(job.company?.name ?? job.author),
      `[${cell(job.title)}](${url})`,
      ...(showLocation ? [cell(openTo(job))] : []),
      cell(job.seniority ?? ''),
      pay(job),
      day(job),
    ];
    return `| ${cols.join(' | ')} |`;
  });
  return head + rows.join('\n') + '\n';
}

async function build({ title, intro, params, showLocation, other }) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const sections = [];
  let total = 0;
  for (const board of BOARDS) {
    const jobs = await fetchJobs(board.key, params);
    total += jobs.length;
    sections.push(
      `## ${board.name} (${jobs.length})\n\n${table(board, jobs, { showLocation })}\n` +
        `More on [${board.domain.replace('https://www.', '')}](${board.domain}/?${UTM}).\n`,
    );
  }
  const body = [
    `# ${title}`,
    '',
    intro,
    '',
    `**${total} jobs, updated ${today}.** Rebuilt every day from live postings; jobs older than three weeks drop off.`,
    '',
    other,
    '',
    sections.join('\n'),
    '---',
    '',
    'Each link opens the job page, where Apply goes to the employer or the original listing. "Open to" is read from the posting; check the job page before you apply.',
    '',
    'Star or watch the repo to get the daily update in your feed.',
    '',
  ];
  return { total, text: body.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n') };
}

const outDir = process.argv[2] ?? '.';
await mkdir(outDir, { recursive: true });

const worldwide = await build({
  title: 'Remote developer jobs open worldwide',
  intro:
    'Most "remote" developer jobs only hire in one country. This list is the ones that say they hire anywhere: frontend, backend and Java roles tagged worldwide, newest first.',
  params: { regions: 'worldwide' },
  showLocation: false,
  other: 'Looking for a first job? See [remote junior and internship developer jobs](JUNIOR.md).',
});
await writeFile(join(outDir, 'README.md'), worldwide.text);

const junior = await build({
  title: 'Remote junior and internship developer jobs',
  intro:
    'Entry-level and internship developer roles that are fully remote. Only about 3% of remote developer postings are junior, so they are collected here, newest first, with where each one hires.',
  params: { seniorities: 'entry,intern' },
  showLocation: true,
  other: 'Not junior? See [remote developer jobs open worldwide](README.md).',
});
await writeFile(join(outDir, 'JUNIOR.md'), junior.text);

console.log(`README.md: ${worldwide.total} jobs, JUNIOR.md: ${junior.total} jobs -> ${outDir}`);
