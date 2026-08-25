#!/usr/bin/env node
/**
 * good-first-issue tracker
 *
 * GitHub Search API 로 "초심자가 손대기 좋은" 프론트엔드 이슈를 찾아
 * 이미 본 이슈를 걸러낸 뒤(중복 알림 방지) 새 이슈만 알려준다.
 *
 *   node scripts/track.mjs                 # 검색 → 알림 → 상태 저장
 *   node scripts/track.mjs --dry-run       # 검색만 (알림/저장 없음)
 *   node scripts/track.mjs --since-days=7  # 최근 7일치로 넓혀서 검색
 *   node scripts/track.mjs --no-notify     # 알림만 끄고 상태는 저장
 *
 * 필요한 환경변수
 *   GITHUB_TOKEN         (필수) public_repo 권한이면 충분
 *   DISCORD_WEBHOOK_URL  (선택) 디스코드 채널 웹훅
 *   SLACK_WEBHOOK_URL    (선택) 슬랙 incoming webhook
 *   GITHUB_REPOSITORY    (선택) "owner/repo" — 이 리포에 다이제스트 이슈를 생성
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const P = {
  config: process.env.CONFIG_PATH || path.join(ROOT, 'config.json'),
  seen: path.join(DATA_DIR, 'seen.json'),
  repoCache: path.join(DATA_DIR, 'repo-cache.json'),
  found: path.join(DATA_DIR, 'found.json'),
  digest: process.env.DIGEST_PATH || path.join(ROOT, 'DIGEST.md'),
};

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const DRY_RUN = has('dry-run');
const NO_NOTIFY = DRY_RUN || has('no-notify');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = 24 * 60 * 60 * 1000;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && (err.code === 'ENOENT' || err instanceof SyntaxError)) return fallback;
    throw err;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

/* ------------------------------------------------------------------ API -- */

async function api(url, init = {}, attempt = 0) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'good-first-issue-tracker',
      'x-github-api-version': '2022-11-28',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(init.headers || {}),
    },
  });

  const rateLimited =
    res.status === 429 ||
    (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

  if (rateLimited && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after') || 0);
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    const waitMs = retryAfter
      ? retryAfter * 1000
      : reset
        ? Math.max(0, reset * 1000 - Date.now()) + 1000
        : 5000 * (attempt + 1);
    console.warn(`  · rate limit — ${Math.round(waitMs / 1000)}초 대기 후 재시도`);
    await sleep(Math.min(waitMs, 90_000));
    return api(url, init, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${url} → ${res.status}\n${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

/* --------------------------------------------------------------- 검색 -- */

const quoteLabel = (label) => (/[\s:]/.test(label) ? `"${label}"` : label);

function buildQuery({ cfg, search, language, since }) {
  const parts = ['is:issue', 'is:open', 'is:public', 'archived:false'];
  if (cfg.requireUnassigned) parts.push('no:assignee');
  parts.push(`label:${search.labels.map(quoteLabel).join(',')}`);
  if (language) parts.push(`language:${language}`);
  parts.push(`created:>=${since}`);
  if (cfg.maxComments != null) parts.push(`comments:<${cfg.maxComments}`);
  if (search.extraQualifiers) parts.push(search.extraQualifiers);
  for (const org of cfg.excludeOrgs || []) parts.push(`-org:${org}`);
  for (const repo of cfg.excludeRepos || []) parts.push(`-repo:${repo}`);
  return parts.join(' ');
}

async function searchIssues(q, perPage) {
  const url = `${API}/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${perPage}&advanced_search=true`;
  const body = await api(url);
  return body.items || [];
}

/* ------------------------------------------------- 저장소 정보 (캐시) -- */

async function loadRepoCache() {
  const cache = await readJson(P.repoCache, {});
  const fresh = {};
  for (const [key, value] of Object.entries(cache)) {
    if (Date.now() - new Date(value.cachedAt).getTime() < 7 * day) fresh[key] = value;
  }
  return fresh;
}

async function getRepo(fullName, cache) {
  if (cache[fullName]) return cache[fullName];
  const r = await api(`${API}/repos/${fullName}`);
  cache[fullName] = {
    fullName,
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    archived: r.archived,
    fork: r.fork,
    language: r.language,
    openIssues: r.open_issues_count,
    cachedAt: new Date().toISOString(),
  };
  return cache[fullName];
}

function repoPasses(repo, f) {
  if (!repo) return false;
  if (!f.allowArchived && repo.archived) return false;
  if (!f.allowForks && repo.fork) return false;
  if (f.minStars != null && repo.stars < f.minStars) return false;
  if (f.maxStars != null && repo.stars > f.maxStars) return false;
  if (f.activeWithinDays != null) {
    const pushed = new Date(repo.pushedAt).getTime();
    if (!Number.isFinite(pushed) || Date.now() - pushed > f.activeWithinDays * day) return false;
  }
  return true;
}

/* --------------------------------------------------------------- 표시 -- */

const ago = (iso) => {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
  if (hours < 1) return '방금';
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
};

const shortStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function lineFor(item) {
  return `[${item.repo}] ${item.title}\n  ${item.url}\n  ⭐ ${shortStars(item.stars)} · 💬 ${item.comments} · ⏱ ${ago(item.createdAt)} · 🏷 ${item.labels.slice(0, 4).join(', ')}`;
}

/* --------------------------------------------------------------- 알림 -- */

async function notifyDiscord(items, cfg) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || cfg.notify.discord === false) return false;

  for (let i = 0; i < items.length; i += 10) {
    const chunk = items.slice(i, i + 10);
    const payload = {
      username: 'good first issue',
      content: i === 0 ? `**새로 올라온 이슈 ${items.length}건**` : null,
      embeds: chunk.map((item) => ({
        title: `${item.title.slice(0, 240)}`,
        url: item.url,
        description: `\`${item.repo}\` · ⭐ ${shortStars(item.stars)} · 💬 ${item.comments} · ${ago(item.createdAt)}`,
        color: item.tier === 1 ? 0x2ea043 : item.tier === 2 ? 0xd29922 : 0x8b949e,
        footer: { text: `${cfg.notify.tierLabels[item.tier] || ''} · ${item.labels.slice(0, 4).join(' / ')}`.slice(0, 2040) },
      })),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`  ! Discord ${res.status}: ${await res.text()}`);
    await sleep(600);
  }
  return true;
}

async function notifySlack(items, cfg) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || cfg.notify.slack === false) return false;

  const lines = items.map(
    (item) =>
      `${cfg.notify.tierLabels[item.tier] || ''}\n<${item.url}|${item.title.replace(/[<>&]/g, ' ')}>\n\`${item.repo}\` ⭐ ${shortStars(item.stars)} · 💬 ${item.comments} · ${ago(item.createdAt)}`,
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: `새로 올라온 이슈 ${items.length}건`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `새로 올라온 이슈 ${items.length}건` } },
        ...lines.slice(0, 40).map((text) => ({ type: 'section', text: { type: 'mrkdwn', text } })),
      ],
    }),
  });
  if (!res.ok) console.error(`  ! Slack ${res.status}: ${await res.text()}`);
  return true;
}

async function notifyGithubIssue(items, cfg) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || cfg.notify.githubIssue === false || !TOKEN) return false;

  const byTier = new Map();
  for (const item of items) {
    if (!byTier.has(item.tier)) byTier.set(item.tier, []);
    byTier.get(item.tier).push(item);
  }

  let body = '';
  for (const tier of [...byTier.keys()].sort()) {
    body += `## ${cfg.notify.tierLabels[tier] || `tier ${tier}`}\n\n`;
    for (const item of byTier.get(tier)) {
      body += `- [ ] **[${item.title.replace(/([[\]])/g, '\\$1')}](${item.url})**\n`;
      body += `  \`${item.repo}\` · ⭐ ${shortStars(item.stars)} · 💬 ${item.comments} · ${ago(item.createdAt)} · 🏷 ${item.labels.slice(0, 5).join(', ')}\n`;
    }
    body += '\n';
  }
  body += `\n<sub>자동 생성 — 처리했으면 이슈를 닫으세요.</sub>`;

  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await api(`${API}/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: `🔔 ${date} UTC · 새 이슈 ${items.length}건`, body }),
  });
  return true;
}

/* ------------------------------------------------------- 다이제스트 -- */

async function writeDigest(found, cfg) {
  const rows = found
    .slice(0, cfg.digestKeep)
    .map(
      (item) =>
        `| ${item.foundAt.slice(0, 10)} | ${cfg.notify.tierLabels[item.tier]?.slice(0, 2) || ''} | [${item.title.replace(/\|/g, '\\|').slice(0, 80)}](${item.url}) | \`${item.repo}\` | ⭐ ${shortStars(item.stars)} |`,
    )
    .join('\n');

  const md = `# 최근에 찾은 이슈\n\n> \`scripts/track.mjs\` 가 자동으로 갱신합니다. 최신 ${cfg.digestKeep}건.\n\n| 발견일 | 등급 | 이슈 | 저장소 | ⭐ |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
  await fs.writeFile(P.digest, md);
}

/* --------------------------------------------------------------- main -- */

async function main() {
  if (!TOKEN) {
    console.error('GITHUB_TOKEN 이 없습니다. 검색 API 호출량이 매우 작아 실패할 수 있습니다.');
  }

  const cfg = await readJson(P.config);
  const lookbackDays = Number(opt('since-days', cfg.lookbackDays ?? 3));
  const since = new Date(Date.now() - lookbackDays * day).toISOString().slice(0, 10);
  const seen = await readJson(P.seen, {});
  const repoCache = await loadRepoCache();

  console.log(`검색 기준일: ${since} 이후 생성된 이슈 (최근 ${lookbackDays}일)\n`);

  /* 1) 검색 ------------------------------------------------------------ */
  const candidates = new Map(); // key → item (낮은 tier 우선)
  for (const search of cfg.searches) {
    for (const language of search.languages) {
      const q = buildQuery({ cfg, search, language, since });
      let items = [];
      try {
        items = await searchIssues(q, cfg.perSearchLimit ?? 30);
      } catch (err) {
        console.error(`  ! 검색 실패 (${search.id}/${language}): ${err.message.split('\n')[0]}`);
        continue;
      }
      console.log(`  ${search.id.padEnd(18)} ${language.padEnd(12)} ${String(items.length).padStart(3)}건`);

      for (const raw of items) {
        if (raw.pull_request) continue;
        const repo = raw.repository_url.replace(`${API}/repos/`, '');
        const key = `${repo}#${raw.number}`;
        const existing = candidates.get(key);
        if (existing && existing.tier <= search.tier) continue;
        candidates.set(key, {
          key,
          tier: search.tier,
          repo,
          number: raw.number,
          title: raw.title,
          url: raw.html_url,
          comments: raw.comments,
          createdAt: raw.created_at,
          labels: (raw.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
          language,
        });
      }
      await sleep(Number(process.env.SEARCH_DELAY_MS ?? 1200)); // Search API: 분당 30회 제한
    }
  }
  console.log(`\n후보 ${candidates.size}건`);

  /* 2) 필터링 ---------------------------------------------------------- */
  const badWords = (cfg.excludeTitleKeywords || []).map((w) => w.toLowerCase());
  const fresh = [];
  for (const item of candidates.values()) {
    if (seen[item.key]) continue;
    if (badWords.some((w) => item.title.toLowerCase().includes(w))) continue;

    let repo;
    try {
      repo = await getRepo(item.repo, repoCache);
    } catch (err) {
      console.error(`  ! 저장소 조회 실패 (${item.repo}): ${err.message.split('\n')[0]}`);
      continue;
    }
    if (!repoPasses(repo, cfg.repoFilters || {})) continue;

    fresh.push({ ...item, stars: repo.stars, foundAt: new Date().toISOString() });
  }

  fresh.sort((a, b) => a.tier - b.tier || new Date(b.createdAt) - new Date(a.createdAt));
  console.log(`필터 통과 · 새 이슈 ${fresh.length}건\n`);
  for (const item of fresh) console.log(`${lineFor(item)}\n`);

  /* 3) 알림 ------------------------------------------------------------ */
  if (fresh.length && !NO_NOTIFY) {
    const sent = [];
    if (await notifyDiscord(fresh, cfg)) sent.push('discord');
    if (await notifySlack(fresh, cfg)) sent.push('slack');
    if (await notifyGithubIssue(fresh, cfg)) sent.push('github issue');
    console.log(sent.length ? `알림 전송: ${sent.join(', ')}` : '알림 채널이 설정되지 않았습니다 (콘솔 출력만).');
  }

  /* 4) 상태 저장 ------------------------------------------------------- */
  if (!DRY_RUN) {
    const now = new Date().toISOString();
    for (const item of fresh) seen[item.key] = now;
    const cutoff = Date.now() - (cfg.seenRetentionDays ?? 60) * day;
    const pruned = Object.fromEntries(
      Object.entries(seen).filter(([, at]) => new Date(at).getTime() >= cutoff),
    );

    const found = [...fresh, ...(await readJson(P.found, []))].slice(0, cfg.digestKeep ?? 100);
    await writeJson(P.seen, pruned);
    await writeJson(P.found, found);
    await writeJson(P.repoCache, repoCache);
    await writeDigest(found, cfg);
  }

  /* 5) Actions 요약 ---------------------------------------------------- */
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = fresh.length
      ? `## 새 이슈 ${fresh.length}건\n\n${fresh.map((i) => `- ${cfg.notify.tierLabels[i.tier] || ''} [${i.title}](${i.url}) — \`${i.repo}\` ⭐ ${shortStars(i.stars)}`).join('\n')}\n`
      : '## 새 이슈 없음\n';
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
