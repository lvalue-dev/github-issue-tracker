#!/usr/bin/env node
/**
 * 가짜 GitHub API 서버를 띄워 track.mjs 를 통째로 돌려보는 통합 테스트.
 *   node scripts/selftest.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKER = path.join(ROOT, 'scripts', 'track.mjs');

const REPOS = {
  'acme/good-ui': { stargazers_count: 4200, pushed_at: new Date().toISOString(), archived: false, fork: false, language: 'TypeScript', open_issues_count: 12 },
  'acme/tiny-lib': { stargazers_count: 12, pushed_at: new Date().toISOString(), archived: false, fork: false, language: 'JavaScript', open_issues_count: 1 },
  'acme/dead-lib': { stargazers_count: 9000, pushed_at: new Date(Date.now() - 400 * 864e5).toISOString(), archived: false, fork: false, language: 'CSS', open_issues_count: 3 },
  'acme/archived-lib': { stargazers_count: 9000, pushed_at: new Date().toISOString(), archived: true, fork: false, language: 'CSS', open_issues_count: 3 },
};

const issue = (repo, number, title, extra = {}) => ({
  number,
  title,
  html_url: `https://github.com/${repo}/issues/${number}`,
  repository_url: `${BASE}/repos/${repo}`,
  comments: 0,
  created_at: new Date(Date.now() - 3600e3).toISOString(),
  labels: [{ name: 'good first issue' }],
  ...extra,
});

let BASE = '';
const received = { queries: [], discord: [], slack: [], issues: [] };

function start() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = req.method === 'POST' ? JSON.parse(await text(req)) : null;
      const json = (data, code = 200) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (url.pathname === '/search/issues') {
        const q = url.searchParams.get('q');
        received.queries.push(q);
        // tier 1 검색에만 결과를 준다 (검색별로 다른 결과가 나오는지 확인)
        const items = q.includes('first-timers-only')
          ? [
              issue('acme/good-ui', 101, '문서의 오타 수정'),
              issue('acme/good-ui', 102, 'add translation for ko'), // 제목 키워드로 제외
              issue('acme/tiny-lib', 103, '스타 부족으로 제외'),
              issue('acme/dead-lib', 104, '방치된 저장소라 제외'),
              issue('acme/archived-lib', 105, '아카이브된 저장소라 제외'),
              { ...issue('acme/good-ui', 106, 'PR 은 제외'), pull_request: { url: 'x' } },
            ]
          : [];
        return json({ total_count: items.length, items });
      }

      const repoMatch = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/);
      if (repoMatch && req.method === 'GET') {
        const repo = REPOS[repoMatch[1]];
        return repo ? json(repo) : json({ message: 'Not Found' }, 404);
      }

      if (url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues$/) && req.method === 'POST') {
        received.issues.push(body);
        return json({ number: 1, html_url: 'https://github.com/x/y/issues/1' }, 201);
      }

      if (url.pathname === '/hook/discord') {
        received.discord.push(body);
        return json({ ok: true }, 204);
      }
      if (url.pathname === '/hook/slack') {
        received.slack.push(body);
        return json({ ok: true });
      }

      json({ message: `unexpected ${req.method} ${url.pathname}` }, 500);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const text = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data || '{}'));
  });

function run(env, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TRACKER, ...extraArgs], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}\n${out}`))));
  });
}

const server = await start();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
BASE = base;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gfi-test-'));

const config = {
  lookbackDays: 3,
  maxComments: 6,
  requireUnassigned: true,
  perSearchLimit: 30,
  seenRetentionDays: 60,
  digestKeep: 50,
  repoFilters: { minStars: 200, maxStars: 400000, activeWithinDays: 90, allowForks: false, allowArchived: false },
  excludeOrgs: ['evilcorp'],
  excludeRepos: [],
  excludeTitleKeywords: ['translation'],
  notify: { githubIssue: true, discord: true, slack: true, tierLabels: { 1: '🥇 good first issue', 2: '🥈 쉬운 이슈' } },
  searches: [
    { id: 'tier1', tier: 1, labels: ['good first issue', 'first-timers-only'], languages: ['typescript'] },
    { id: 'tier2', tier: 2, labels: ['help wanted'], languages: ['typescript'], extraQualifiers: 'comments:<3' },
  ],
};
const configPath = path.join(tmp, 'config.json');
await fs.writeFile(configPath, JSON.stringify(config));

const env = {
  GITHUB_API_URL: base,
  CONFIG_PATH: configPath,
  DATA_DIR: path.join(tmp, 'data'),
  DIGEST_PATH: path.join(tmp, 'DIGEST.md'),
  GITHUB_TOKEN: 'test-token',
  GITHUB_REPOSITORY: 'me/tracker',
  DISCORD_WEBHOOK_URL: `${base}/hook/discord`,
  SLACK_WEBHOOK_URL: `${base}/hook/slack`,
  SEARCH_DELAY_MS: '0',
  GITHUB_STEP_SUMMARY: '',
};

/* --- 1회차 -------------------------------------------------------------- */
const first = await run(env);

const q1 = received.queries[0];
assert.match(q1, /is:issue/, '이슈만 검색해야 한다');
assert.match(q1, /no:assignee/, '담당자 없는 이슈만');
assert.match(q1, /label:"good first issue",first-timers-only/, '라벨은 OR(콤마)로 묶여야 한다');
assert.match(q1, /language:typescript/);
assert.match(q1, /created:>=\d{4}-\d{2}-\d{2}/);
assert.match(q1, /comments:<6/);
assert.match(q1, /-org:evilcorp/, '제외 조직이 반영되어야 한다');
assert.match(received.queries[1], /comments:<3/, 'extraQualifiers 가 붙어야 한다');
assert.equal(received.queries.length, 2, '검색 × 언어 조합만큼 호출');

assert.match(first, /필터 통과 · 새 이슈 1건/, `1건만 통과해야 함:\n${first}`);
assert.match(first, /문서의 오타 수정/);
for (const excluded of ['translation', 'tiny-lib', 'dead-lib', 'archived-lib', 'PR 은 제외']) {
  assert.ok(!first.includes(excluded), `${excluded} 는 걸러져야 한다`);
}

assert.equal(received.discord.length, 1, '디스코드 알림 1회');
assert.equal(received.discord[0].embeds.length, 1);
assert.equal(received.discord[0].embeds[0].url, 'https://github.com/acme/good-ui/issues/101');
assert.equal(received.slack.length, 1, '슬랙 알림 1회');
assert.equal(received.issues.length, 1, '다이제스트 이슈 1건 생성');
assert.match(received.issues[0].body, /🥇 good first issue/);
assert.match(received.issues[0].title, /새 이슈 1건/);

const seen = JSON.parse(await fs.readFile(path.join(tmp, 'data', 'seen.json'), 'utf8'));
assert.deepEqual(Object.keys(seen), ['acme/good-ui#101'], 'seen 에 기록되어야 한다');
const digest = await fs.readFile(path.join(tmp, 'DIGEST.md'), 'utf8');
assert.match(digest, /문서의 오타 수정/);
const cache = JSON.parse(await fs.readFile(path.join(tmp, 'data', 'repo-cache.json'), 'utf8'));
assert.ok(cache['acme/good-ui'].stars === 4200, '저장소 정보가 캐시되어야 한다');

/* --- 2회차: 같은 이슈는 다시 알리지 않는다 ------------------------------ */
received.discord.length = 0;
received.slack.length = 0;
received.issues.length = 0;
const second = await run(env);
assert.match(second, /필터 통과 · 새 이슈 0건/, '중복 알림이 없어야 한다');
assert.equal(received.discord.length, 0);
assert.equal(received.issues.length, 0);

/* --- 3회차: --dry-run 은 알림도 저장도 하지 않는다 ---------------------- */
await fs.writeFile(path.join(tmp, 'data', 'seen.json'), '{}');
const third = await run(env, ['--dry-run']);
assert.match(third, /새 이슈 1건/);
assert.equal(received.discord.length, 0, 'dry-run 은 알림을 보내지 않는다');
const seenAfterDry = JSON.parse(await fs.readFile(path.join(tmp, 'data', 'seen.json'), 'utf8'));
assert.deepEqual(seenAfterDry, {}, 'dry-run 은 상태를 저장하지 않는다');

server.close();
await fs.rm(tmp, { recursive: true, force: true });
console.log('✅ selftest 통과 — 검색 쿼리 / 필터 / 중복제거 / 알림 / 상태저장 모두 정상');
