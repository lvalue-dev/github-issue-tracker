# 프론트엔드 초심자용 GitHub 이슈 트래커

오픈소스 기여를 시작할 때 가장 어려운 건 "코드"가 아니라 **내가 할 수 있는 이슈를 제때 찾는 것**입니다.
`good first issue` 는 인기 저장소일수록 올라온 지 몇 시간 만에 다른 사람이 가져갑니다.
그래서 **새로 올라오자마자 알림을 받는 것**이 초심자에게는 사실상 전부입니다.

이 문서는 세 단계로 되어 있습니다.

| 단계 | 방법 | 걸리는 시간 | 알림 |
| --- | --- | --- | --- |
| 1 | 이미 있는 사이트 둘러보기 | 0분 | ❌ (직접 들어가서 봐야 함) |
| 2 | GitHub 기본 기능 (Watch + 저장된 검색) | 10분 | 🔺 (특정 저장소만) |
| 3 | **이 저장소의 자동 트래커** | 15분 | ✅ (새 이슈마다 푸시 알림) |

---

## 1단계 — 지금 바로 볼 수 있는 사이트

| 사이트 | 특징 |
| --- | --- |
| <https://goodfirstissue.dev> | 언어별 `good first issue` 모아보기. 가장 깔끔함 |
| <https://goodfirstissues.com> | 최신순 정렬 + 댓글 수 표시(= 아직 아무도 안 잡은 이슈 찾기 좋음) |
| <https://up-for-grabs.net> | 프로젝트 단위로 초심자 환영 저장소 모음 |
| <https://www.codetriage.com> | **저장소를 구독하면 매일 이메일로 이슈를 하나씩 보내줌** |
| <https://github.com/MunGell/awesome-for-beginners> | 초심자 친화적인 저장소 큐레이션 목록 |

한계가 뚜렷합니다. 대부분 **푸시 알림이 없고**, 언어 필터는 있어도 "스타 수 / 담당자 없음 / 댓글 0개"
같은 세밀한 조건을 걸 수 없습니다. 그래서 3단계가 필요합니다.

---

## 2단계 — GitHub 기본 기능만으로 하기

### (a) 관심 저장소를 라벨 단위로 Watch

저장소 상단 **Watch → Custom → Issues** 만 체크하세요.
그 저장소에 이슈가 새로 열릴 때마다 GitHub 알림함 + 이메일 + GitHub Mobile 푸시가 옵니다.

- 장점: 설정이 1분, 지연 없음
- 단점: **라벨별 구독이 안 됩니다.** 큰 저장소를 Watch 하면 하루 수십 개가 쏟아집니다
- 권장: 스타 1k~20k 정도의 "적당한" 저장소 5~10개만 Watch

### (b) 검색 쿼리를 북마크해두기

<https://github.com/issues> 또는 <https://github.com/search> 에서 아래 쿼리를 붙여넣고,
결과 페이지 URL을 그대로 북마크하면 "나만의 피드"가 됩니다.

```text
# 1순위: 최근 3일 안에 올라온, 아무도 안 잡은 good first issue (TS)
is:issue is:open archived:false no:assignee label:"good first issue" language:typescript comments:<3 sort:created-desc

# CSS / 마크업 쪽
is:issue is:open archived:false no:assignee label:"good first issue" language:css sort:created-desc

# 2순위: 난이도 쉬움 계열 라벨
is:issue is:open archived:false no:assignee label:"help wanted","easy","beginner friendly" language:javascript comments:<3 sort:created-desc

# 특정 저장소만 콕 집어서
repo:vitejs/vite is:issue is:open no:assignee label:"good first issue"
```

핵심 검색 문법 치트시트:

| 문법 | 뜻 |
| --- | --- |
| `label:"a","b"` | a **또는** b 라벨 (콤마 = OR) |
| `no:assignee` | 담당자가 아직 없음 → **내가 잡을 수 있음** |
| `comments:<3` | 댓글이 거의 없음 → 아직 경쟁이 없음 |
| `created:>2026-08-20` | 그 날짜 이후에 생성된 이슈만 |
| `archived:false` | 보관 처리된 죽은 저장소 제외 |
| `-org:이름` / `-repo:a/b` | 특정 조직·저장소 제외 |
| `sort:created-desc` | 최신순 |

**단점: 북마크는 알림을 주지 않습니다.** 매번 직접 들어가서 봐야 합니다.

---

## 3단계 — 이 저장소의 자동 트래커 (권장)

`GitHub Actions` 가 **1시간마다** 위 검색을 대신 돌려서,
**한 번도 알려준 적 없는 새 이슈만** 골라 알림을 보냅니다.

```
매시 25분  →  GitHub 검색 API (라벨 × 언어 조합)
           →  저장소 필터 (스타 수, 최근 활동, 아카이브 여부)
           →  이미 알린 이슈 제거 (data/seen.json)
           →  🔔 Discord / Slack / GitHub 이슈로 알림
           →  DIGEST.md 갱신 후 자동 커밋
```

### 설치 (5분)

1. **이 브랜치를 기본 브랜치(main)에 머지하세요.**
   GitHub Actions 의 `schedule` 은 **기본 브랜치에 있는 워크플로만** 실행합니다.

2. **Actions 권한 확인** — 저장소 `Settings → Actions → General`
   - *Workflow permissions* 를 **Read and write permissions** 로 설정
     (트래커가 `DIGEST.md` 를 커밋하고 알림 이슈를 만들기 위해 필요합니다)

3. **알림 채널을 최소 하나 고릅니다.**

   | 채널 | 준비물 | 설정 |
   | --- | --- | --- |
   | **GitHub 이슈** (가장 쉬움) | 없음 | 기본 켜짐. 이 저장소를 **Watch** 하면 GitHub Mobile 푸시로 옵니다 |
   | **Discord** | 채널 → 설정 → 연동 → 웹후크 만들기 | 저장소 Secret 에 `DISCORD_WEBHOOK_URL` 추가 |
   | **Slack** | Incoming Webhook 앱 설치 | 저장소 Secret 에 `SLACK_WEBHOOK_URL` 추가 |

   Secret 추가 위치: `Settings → Secrets and variables → Actions → New repository secret`

4. **`config.json` 을 취향에 맞게 손봅니다.** (아래 표 참고)

5. **`Actions` 탭 → `새 이슈 트래킹` → `Run workflow`** 로 한 번 수동 실행해서 확인하세요.
   처음에는 `since_days` 를 `7`, `dry_run` 을 켜고 돌려보면 어떤 이슈가 잡히는지만 볼 수 있습니다.

### 내 컴퓨터에서 바로 돌려보기

```bash
export GITHUB_TOKEN=ghp_...        # public_repo 권한이면 충분
node scripts/track.mjs --dry-run --since-days=7
```

```bash
node scripts/track.mjs --dry-run          # 검색만 (알림 X, 저장 X)
node scripts/track.mjs --no-notify        # 알림만 끄기
node scripts/track.mjs --since-days=14    # 2주치 훑기
npm test                                  # 가짜 API 서버로 전체 동작 검증
```

---

## config.json 설정값

| 키 | 뜻 | 조정 팁 |
| --- | --- | --- |
| `lookbackDays` | 며칠 전까지 거슬러 검색할지 | 3이면 충분. 놓친 게 걱정되면 7 |
| `maxComments` | 댓글 N개 미만만 | 낮출수록 "아직 아무도 안 잡은" 이슈만 |
| `requireUnassigned` | 담당자 없는 이슈만 | `true` 유지 권장 |
| `repoFilters.minStars` | 최소 스타 수 | 알림이 너무 많으면 500~1000으로 올리기 |
| `repoFilters.activeWithinDays` | 최근 N일 안에 커밋된 저장소만 | 방치된 저장소에 PR 넣는 낭비를 막아줍니다 |
| `excludeOrgs` / `excludeRepos` | 제외 목록 | 관심 없는 곳이 반복해서 뜨면 여기에 추가 |
| `excludeTitleKeywords` | 제목 키워드 제외 | 번역·현상금 이슈 등 |
| `searches[].tier` | 우선순위 | **1 = good first issue**, 2 = 쉬운 이슈, 3 = 문서/타입/a11y |
| `searches[].labels` | OR 로 묶일 라벨들 | 저장소마다 라벨 이름이 다릅니다. 발견하면 추가하세요 |
| `searches[].languages` | 언어 | 검색은 `검색 개수 × 언어 개수` 만큼 호출됩니다. 너무 늘리지 마세요 |

> `hacktoberfest` 라벨은 10월에 노이즈가 폭증합니다. 그 시기엔 `easy-help-wanted` 검색에서 빼두세요.

### 알림이 너무 많을 때 / 너무 없을 때

| 증상 | 처방 |
| --- | --- |
| 알림이 하루 수십 개 | `minStars` ↑, `maxComments` ↓, tier 3 검색 삭제 |
| 알림이 거의 안 옴 | `minStars` ↓ (200 → 50), `lookbackDays` ↑, 언어 추가 |
| 관심 없는 저장소만 옴 | `excludeRepos` 에 추가, 또는 `searches[].languages` 를 좁히기 |

---

## 이슈를 잡았다면 — 초심자 체크리스트

1. **댓글을 먼저 읽습니다.** "I'd like to work on this" 가 이미 있으면 다른 이슈로 가세요.
2. **한 줄 남기고 시작합니다.** — `Hi, I'd like to work on this. Could you assign it to me?`
3. **`CONTRIBUTING.md` 를 읽습니다.** 커밋 컨벤션·테스트 명령어가 거기 다 있습니다.
4. **로컬에서 먼저 재현합니다.** 재현이 안 되는 버그는 손대지 마세요.
5. **PR은 작게.** 이슈에 적힌 것만 고칩니다. 포매터를 전체 파일에 돌리지 마세요.
6. **48시간 안에 답이 없어도 정상입니다.** 기다리는 동안 다음 이슈를 보세요.

### 프론트엔드 쪽에서 라벨 관리가 잘 되는 저장소 (Watch 후보)

`vitejs/vite` · `storybookjs/storybook` · `mui/material-ui` · `chakra-ui/chakra-ui` ·
`mantinedev/mantine` · `sveltejs/svelte` · `nuxt/nuxt` · `withastro/astro` ·
`TanStack/query` · `remix-run/react-router` · `excalidraw/excalidraw` ·
`primer/react` · `refinedev/refine` · `calcom/cal.com` · `n8n-io/n8n`

들어가서 `Issues → Labels` 에 `good first issue` 가 실제로 붙어 있는지, 최근에 붙은 게 있는지
확인한 다음 Watch 하세요. (라벨만 있고 몇 년째 안 쓰는 저장소도 많습니다.)

---

## 알아둘 것

- **스케줄 워크플로는 저장소가 60일간 활동이 없으면 자동으로 비활성화됩니다.**
  이 트래커는 상태를 커밋하므로 보통 문제없지만, Actions 탭에 "disabled" 배너가 뜨면 눌러서 다시 켜세요.
- `schedule` 은 GitHub 부하에 따라 **몇 분~십몇 분 늦게** 실행될 수 있습니다. 정시 보장이 아닙니다.
- GitHub 검색 API 는 **인증 시 분당 30회** 제한이 있어 검색 사이에 1.2초를 쉽니다.
  `searches × languages` 조합이 20개를 넘어가면 실행이 느려집니다.
- 검색 결과는 GitHub 인덱싱에 의존합니다. 이슈가 생성된 직후 몇 분간은 검색에 안 잡힐 수 있습니다.

## 파일 구조

```
config.json                       # 검색 조건 (여기만 고치면 됩니다)
scripts/track.mjs                 # 검색 → 필터 → 중복제거 → 알림 (의존성 0개)
scripts/selftest.mjs              # 가짜 API 서버로 돌리는 통합 테스트
.github/workflows/track-issues.yml # 1시간마다 실행
.github/workflows/test.yml        # push 시 selftest 실행
data/seen.json                    # 이미 알린 이슈 (중복 알림 방지, 60일 후 정리)
data/found.json                   # 최근에 찾은 이슈 목록
data/repo-cache.json              # 저장소 스타/활동 캐시 (7일)
DIGEST.md                         # 최근에 찾은 이슈 표 (자동 갱신)
```
