# 레일 옮기기 보고 (1단계: 옮기기만)

## 쉬운 말 요약

레일을 원래 저장소에서 떼어 이 저장소로 옮기고, Claude Code 플러그인 모양(`.claude-plugin/`, `skills/`, `hooks/hooks.json`, `scripts/`)으로 바꿔 놓았습니다. 원래 저장소는 읽기만 했고 그곳에서 레일 명령은 하나도 돌리지 않았습니다. 옮긴 레일 시험 214개가 모두 통과했고(직접 실행), 원래 시험 218개 중 빠진 4개는 원래 제품의 비용 계산·검증 스크립트를 시험하던 것이라 옮기지 않았습니다. 작은 예제 프로젝트에서 시작 → 기능 하나 → 커밋 관문 → 확인까지 돌려 보았고, 확인 기록이 없으면 관문이 막는 것도 보았습니다. 가장 걱정되는 점은, 플러그인을 모든 프로젝트에 켜 두면 레일 훅이 레일을 쓰지 않는 저장소에서도 일한다는 것입니다(아래 "걱정되는 곳").

## 옮긴 파일 (원래 자리 → 새 자리)

| 원래 자리 | 새 자리 | 바꾼 것 |
|---|---|---|
| `.rail/bin/rail.mjs` | `scripts/rail.mjs` | 없음 |
| `.rail/bin/lib/*.mjs` (27개) | `scripts/lib/*.mjs` | `core.mjs`, `config.mjs`, `status.mjs`, `usage.mjs`, `verify.mjs` 다섯 개 (아래 "동작이 달라진 곳") |
| `.rail/hooks/{guard-tests,lib,pre-compact,stop-check}.mjs` | `hooks/*.mjs` | 세 파일에서 `../bin/rail.mjs` → `../scripts/rail.mjs` 한 줄씩 |
| `.claude/settings.json` 의 `hooks` 칸 | `hooks/hooks.json` | 경로를 `${CLAUDE_PROJECT_DIR}/.rail/...` → `${CLAUDE_PLUGIN_ROOT}/...` 로. 훅 종류·matcher·timeout 은 그대로 |
| `.claude/skills/rail*/SKILL.md` (5개)와 `rail-milestone/workers.md` | `skills/rail*/` | 명령 경로를 `node "${CLAUDE_PLUGIN_ROOT}/scripts/rail.mjs"` 로, rail-check 의 앱 띄우기 줄을 설정 칸으로 |
| `tests/rail*.test.mjs` (18개), `tests/hooks.test.mjs`, `tests/helpers.mjs` | `tests/` | 아래 "시험" |
| `.rail/check/template.md`, `.rail/check/stale-template.md`, `.rail/proto/template.md` | `templates/.rail/...` | 제품 전용 글 빼기 (아래) |
| `docs/RAIL.md` (한 쪽 설명서) | `templates/docs/RAIL.md` | 경로 6줄 |
| `.gitignore` 의 레일 줄 | `templates/.gitignore` | 없음 |
| (새로) | `.claude-plugin/plugin.json`, `package.json`, `README.md`, `templates/.rail/config.json`, `examples/tiny/` | |

## 설정으로 뺀 항목

레일 코드에 남아 있던 제품 전용 값은 프로젝트 쪽 `.rail/config.json` 한 파일로 옮겼습니다. 시작 틀은 `templates/.rail/config.json` 입니다.

- 비용 재기: 코드의 기본값 `node .rail/bin/cost.mjs`(원래 제품의 비용 계산기) → 빈 값. 프로젝트가 `autonomy.budget.costCommand` 에 적는다.
- 앱 띄우기: rail-check 스킬과 확인 지시서 틀에 적혀 있던 원래 제품의 서버 명령 → `appStart` 칸. 코드는 이 칸을 읽지 않고, 스킬과 틀이 작업자에게 읽으라고 안내한다.
- 검증 명령(`verify`), 알림 봇(`notify.bot`), 판 번호, 커밋 정책, worktree 방식, 낡은 시험 판정 방식은 원래도 config 에 있었다. 원래 제품의 값은 옮기지 않았고 틀에는 기본값만 두었다.

## 옮기지 않은 것과 까닭

- `.rail/bin/cost.mjs`: 원래 제품의 기록 읽기 코드(`src/`)를 불러 쓰는 제품 전용 비용 계산기다.
- 원래 제품의 `scripts/verify/` 검증기와 그것을 시험하던 3개, `cost.mjs` 를 시험하던 1개.
- `.rail/state.json`, `.rail/log.jsonl`, `.rail/test-baseline.json`, `.rail/check/M*`, `.rail/review/`(리뷰 결과와 `calibration.md`), `.rail/rehearsal/`, `.rail/reference/`, `.rail/stale/`, `.rail/proto/*/`: 실행 기록이거나 원래 제품의 데이터다. `calibration.md` 는 원래 제품의 결함 예로 채워져 있어 옮기지 않았다(스킬이 "있으면 읽어라"로 가리킨다).
- `.claude/settings.json` 의 `env`(압축 창 크기)와 `permissions`: 주인의 세션 설정이고 플러그인이 정할 일이 아니다.
- 원래 저장소의 `CLAUDE.md`: 제품 설명과 레일 규칙이 섞여 있다. 레일 규칙은 이미 `templates/docs/RAIL.md` 와 스킬에 있다.
- 제품 시험: 옮기지 않았다.

## 숫자 (직접 센 값)

| 무엇 | 원래 | 지금 |
|---|---|---|
| 레일 코드 줄 수 (`scripts/`·`hooks/` 의 .mjs, 시험 제외) | 3,454 (`cost.mjs` 65 포함) | **3,392** (32파일) |
| 스킬 문서 줄 수 (`SKILL.md` 5개) | 122 | **122** (`workers.md` 27줄은 따로) |
| 레일 시험 줄 수 (`*.test.mjs` 19개) | 3,681 | **3,628** (+ `helpers.mjs` 88) |
| 레일 시험 개수 | 218 | **214** |
| 플러그인 설정 (`hooks.json` + `plugin.json`) | (settings.json 의 일부) | 66 |
| 시작 틀 (`templates/` 전체) | | 173 |

코드가 원래보다 늘어난 곳은 `core.mjs` 하나로 +3줄이다(빠진 3줄, 들어온 6줄). 저장소 찾기 두 줄과 플러그인 폴더·레일 명령 상수 두 줄, 그 설명 두 줄이다. 나머지 고침은 줄을 바꿔 쓴 것이라 줄 수가 같다. `cost.mjs` 65줄이 빠졌으므로 3,454 − 65 + 3 = 3,392 다.

시험 실행:

```
$ node --test 'tests/*.test.mjs'      (npm test 와 같음)
ℹ tests 214
ℹ pass 214
ℹ fail 0
```

비교 기준으로, 원래 저장소의 main 을 임시 폴더에 풀어(원래 저장소 자신이 아님) 같은 19개 파일을 돌리면 218개가 통과했다. 빠진 4개는 위 "옮기지 않은 것"의 제품 전용 시험이다.

`claude plugin validate .` 는 "Validation passed with warnings" 를 냈다. 경고는 LICENSE 없음(이번 일에서 넣지 않기로 함), 아이콘 없음, 작성자 칸 없음, 마켓플레이스 설치 줄 없음이다.

## 예제 프로젝트에서 돌려 본 것

`examples/tiny/` 는 인사 함수 하나와 시험 하나뿐이다. 임시 폴더에 복사하고 `templates/` 를 얹은 뒤 git 저장소로 만들어 돌렸다. 사람의 답("맞음", "시작", "예")은 내가 대신 넣었고, Orca 작업자 대신 내가 작업자 일을 했다(`status` 가 안내하는 대로 `log worker_start`·`log worker_closed`). `RAIL_ROOT` 없이 프로젝트 안의 하위 폴더에서 불러도 저장소를 찾는 것을 먼저 보았다.

| 차례 | 명령 | 결과 |
|---|---|---|
| 시작 | `status` | 위치: 기획 · 브리프 (질문 0/8) (레일 2.9판) |
| 브리프 | `ask` → `answer`, BRIEF.md 쓰기, `ask --kind approve` → `answer 맞음`, 승인 줄, `advance roadmap` | `[관문] 통과. 단계: brief → roadmap` |
| 로드맵 | ROADMAP.md, 승인, `advance decide --milestone M0`, `advance milestone` | 두 관문 모두 통과 |
| 기능 하나 | step 표(기능 M0-1, 마지막 리뷰 M0-2), "시작" 승인, `step-start M0-1` | `[step] M0-1 시작 (기능). 상태 칸: ⏳ 진행 중` |
| 시험 잠금 훅 | 이미 있는 `tests/greet.test.mjs` Edit / 새 `tests/greet-loud.test.mjs` Write | 앞은 deny, 뒤는 허용 |
| 마무리 검사 훅 | 기능을 쓴 뒤 Stop 훅 | 종료 0, `node --test` 통과 수 2 를 남김 |
| 커밋 관문 | `part commit`, `node --test`(2 통과), `log commit_gate '{"step":"M0-1","ok":true}'`, 커밋 묻기, 이 step 파일만 커밋 | `[부품] commit 켜짐`, 커밋 1개 |
| 확인 | 확인 기록을 치우고 `step-done M0-1 --note ...` | 종료 1, `M0-1 의 확인 기록 .rail/check/M0-1.json 이 없습니다` |
| 확인 | 확인 기록(must 0, nice 1)을 커밋하고 `step-done` | `[step] M0-1 끝. 상태 칸: ✅ ...`, 다음 할 일은 M0-2 마지막 리뷰 |
| 훅 | `status --hook`, PreCompact 훅 | 세 줄과 압축 지시가 나옴 |

마지막으로 `claude -p --plugin-dir <이 저장소>` 로 예제 사본에서 `/rail:rail` 을 불렀다. 스킬 본문의 상태 칸이 `${CLAUDE_PLUGIN_ROOT}` 치환으로 채워져 "위치: M0 · step 진행" 과 M0-2 안내가 그대로 나왔다.

## 개인 정보·비밀값 검사

저장소에 들어갈 파일 73개(이 보고서 포함, `.gitignore` 로 빠지는 것 제외)를 grep 으로 훑었다. 아래 건수는 이 보고서 자신을 뺀 값이다. 이 보고서는 찾은 낱말(`/Users/`, `secret` 같은 것)을 표에 적고 있어서 그 낱말로만 걸린다.

| 찾아본 것 | 건수 |
|---|---|
| 개인 경로 `/Users/`, `/home/` | 0 |
| 주인 사용자 이름 | 0 |
| 이메일 꼴 | 6 — 모두 시험의 가짜 git 사용자(`*@example.com`) |
| 원래 제품 이름 | 0 |
| 토큰·키 꼴(`sk-`, `ghp_`, `github_pat_`, `xoxb-`, `AKIA`, `PRIVATE KEY`, `api_key`, `secret`, `password`, `bearer`) | 0 |
| 실행 기록 파일(`.rail/state.json`, `.rail/log.jsonl`, `*.jsonl`, 마무리 검사 캐시) | 0개 (이름을 가리키는 코드·문서 글은 있음) |

## 옮기며 동작이 달라진 곳

1. 저장소 찾기(`core.mjs`): 원래는 스크립트가 놓인 자리(`.rail/bin/lib` 의 세 단계 위)를 저장소로 보았다. 이제 코드가 플러그인 폴더에 있으므로 `RAIL_ROOT` → 지금 폴더에서 위로 올라가며 처음 만나는 `.rail/` 폴더 → `CLAUDE_PROJECT_DIR` → 지금 폴더 차례로 찾는다. 원래 명령이 "프로젝트 맨 위 폴더에서 `node .rail/bin/rail.mjs`" 였으므로 그 경우는 결과가 같다.
2. 안내 문구의 레일 명령: `node .rail/bin/rail.mjs status` / `verify` 를 알려 주던 세 곳(압축 뒤 이어받기, 압축 지시, verify 기록 없음)이 이제 이 플러그인 `rail.mjs` 의 절대 경로를 넣은 `node "<경로>/scripts/rail.mjs"` 를 알려 준다. 압축 지시의 "요약하지 말 것" 줄도 `.claude/skills/rail*/` 대신 플러그인의 `skills/rail*/` 경로를 적는다. 시험 `rail-v2-3` 의 문구 확인 한 줄을 새 꼴로 바꿨다.
3. 레일 크기(`rail_size`, `usage.mjs`): 원래는 프로젝트 안의 `.rail/bin`, `.rail/hooks`, `.claude/skills/rail*`, `docs/RAIL.md` 를 셌다. 이제 플러그인 폴더(`CLAUDE_PLUGIN_ROOT`, 없으면 코드 자리에서 구함)의 `scripts`, `hooks`, `skills/rail*` 와 프로젝트의 `docs/RAIL.md` 를 센다. `hooks/hooks.json` 도 `hooks/` 안에 있어 함께 세진다. 예제에서 3,656줄·40파일로 기록됐다. 시험 `rail-v2-3` 은 가짜 플러그인 폴더를 `CLAUDE_PLUGIN_ROOT` 로 주도록 바꿨고 기대값(112줄, 3파일)은 그대로다.
4. 비용 명령 기본값: `node .rail/bin/cost.mjs` → 빈 값. 원래 기본값도 다른 프로젝트에서는 없는 파일이라 "비용 읽기 실패"였고, 이제는 "비용을 잴 명령이 비어 있습니다"라는 글로 같은 길을 간다.
5. 스킬 이름: 플러그인 스킬은 `rail:rail`, `rail:rail-brief` 처럼 앞에 플러그인 이름이 붙는다. `status` 의 `skill` 칸은 예전처럼 `rail-brief` 꼴로 낸다.
6. 틀과 설명서에서 뺀 제품 전용 글: 확인 지시서 틀의 빈 데이터 예("가격을 모르는 기록"), 서버 명령, 원래 제품의 채점 예시 다섯 줄(꼴은 남기고 제품 낱말을 일반 말로), 주인이 띄워 둔 서버 포트 번호. 시제품 틀의 "실제 기록 데이터" → "실제 데이터". 설명서의 "이 저장소의 설정" 같은 말과 경로 6줄.

## 걱정되는 곳

- **훅이 모든 저장소에서 일한다.** 원래는 레일 저장소의 `.claude/settings.json` 에만 훅이 있었다. 플러그인을 사용자 범위로 켜면 레일을 쓰지 않는 저장소에서도 세션 시작 때 "레일 판 번호 없음 · 브리프" 세 줄이 뜨고, 시험 잠금 훅이 그 저장소의 추적 중인 시험 파일 고치기를 막는다(파일은 만들지 않는다. 직접 확인). 이번에는 동작을 바꾸지 않고 README 에 "그 프로젝트에서만 켜라"고 적었다. `.rail/` 이 없으면 훅이 아무것도 하지 않게 하는 일은 다음 일로 남긴다.
- **명령 허용.** 원래 저장소는 `Bash(node .rail/bin/rail.mjs *)` 를 늘 허용했다. 플러그인에서는 스킬의 `allowed-tools`(치환된 플러그인 경로)가 스킬을 쓰는 동안만 허용한다. 자율 모드처럼 스킬 밖에서 레일 명령을 부르면 권한 질문이 뜰 수 있다.
- **안내 문구의 절대 경로.** 레일 명령 안내에 플러그인 설치 경로가 그대로 실린다. 사건 기록에는 남지 않지만, 플러그인을 다시 설치해 경로가 바뀌면 압축 전에 받은 안내는 옛 경로를 가리킨다.
- **Orca 전제.** worktree 기본 폴더(`~/orca/workspaces/<저장소>`), 작업자 띄우기, 알림은 Orca CLI 를 전제로 한다. 원래와 같은 동작이지만 공개하면 Orca 없는 사용자에게는 "하위 에이전트로 대신" 안내만 남는다.
- **상태줄 파일 자리.** 컨텍스트 사용률을 `~/.claude/cache/statusline/<세션>.json` 에서 읽는다(주인의 상태줄 스크립트가 쓰는 자리, `RAIL_STATUSLINE_DIR` 로 바꿈). 없으면 "모름"으로 두므로 고장은 아니다.
- **git 작성자 정보.** 이 저장소의 첫 커밋부터 커밋 작성자 칸에 주인의 개인 이메일이 들어 있다. 파일 내용이 아니라 git 기록이라 위 grep 에는 잡히지 않는다. 공개 전에 GitHub 의 noreply 주소로 바꿀지 주인이 정해야 한다.
- 원래 시험 수를 "18파일"이라고 들었는데, 세어 보니 `rail-*.test.mjs` 18개와 `hooks.test.mjs` 1개, 모두 19개이고 3,681줄이다.
