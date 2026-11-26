# 리뷰 must 고치기와 덜어내기 보고 (3단계 준비)

## 쉬운 말 요약

최종 리뷰 두 개가 "다음 제품 전에 고쳐라"고 한 것들을 고쳤습니다. 이제 가정 시험이 실패했거나 결정이 미정이면 마일스톤이 시작되지 않고, 비용 명령이 비어도 자율 모드가 멈추지 않고, 계획 밖 결정 수를 레일이 직접 셉니다. 진행 중에 주인 결정이 바뀌어, 레일을 플러그인이 아니라 **레포마다 설치하는 방식**(`node scripts/install.mjs <레포>`)으로 바꾸고 Windows 를 대비했으며, README 를 처음부터 다시 썼습니다. 실제 Claude 세션과 Orca 창에 띄운 실제 작업자 모두에서 이미 있는 시험 파일 고치기가 막히는 것을 직접 확인했습니다. 다만 줄 수는 레일 실행 코드만 보면 3,368줄로 목표(3,369줄 미만)를 지켰지만, 설치 도구 95줄을 더하면 3,463줄이라 94줄이 넘습니다. 그 까닭은 아래 "숫자"에 적었습니다.

## 바뀐 일의 범위

처음 할 일은 아홉 개였고, 일하는 도중 코디네이터를 통해 주인 결정이 세 번 바뀌었습니다.

- 공개하지 않습니다(README 권한 문단은 짧게 → 뒤에 README 전체를 자세히 다시 쓰기로 바뀜).
- 2번(레일 없는 저장소에서 훅 조용히)과 3번(작업자에게 플러그인 훅 싣기)은 **"레포마다 설치"와 그 확인**으로 바뀌었습니다. 레포마다 설치하면 훅이 그 레포 설정에만 있으므로, 원래 2번의 목적(레일 없는 레포에서 아무 일도 없음)은 저절로 이뤄집니다. 처음 만든 플러그인용 2·3번 코드는 커밋하지 않았습니다.
- Windows PC 에서도 같은 GitHub 비공개 저장소를 받아 쓰고, 그 PC 에도 Orca 가 있으므로 `worker start` 가 Windows 에서도 돌아야 합니다.

## 아홉 개 각각

### 1. 착수 전 결정·시험을 바로 시작에서도 본다

- **바꾼 것:** `docs.mjs` 의 `decisionStatus` 가 상태 말을 정해진 말과 정확히 맞을 때만 인정합니다. 결정은 `선택함 (<고른 것>)`·`AI가 고름(위임)`·`미룸(YYYY-MM-DD)`, 시험은 `통과`·`통과(작은 예제 범위까지만)`·`판단 보류(YYYY-MM-DD)` 만 풀린 것입니다. "통과 못함", 기한 없는 미룸·판단 보류는 풀린 것이 아니고, 기한이 오늘보다 앞이면 "기한이 지났습니다"로 다시 막습니다. 마일스톤의 풀리지 않은 항목을 모으는 `openRisks` 를 새로 두고, 미리 승인(`queue.mjs`), 바로 시작(`gates.mjs` 의 기존 `ORDER.milestone` 관문 함수), `status` 의 다음 할 일이 모두 이 하나를 씁니다. 새 관문은 만들지 않았습니다. 관문이 막으므로 실패한 시험 번호가 `risks_decided` 에 들어가지 않습니다.
- **확인:** `tests/rail-plan.test.mjs` 의 "상태 말은 정해진 말과 정확히 맞아야 하고, 기한 없는·지난 미룸과 판단 보류는 풀린 것이 아니다", "advance milestone 은 미리 승인과 같은 판정으로 … 막고, 풀리면 시작한다"(미실행·실패·통과 못함·지난 판단 보류 네 가지가 막히고 `risks_decided` 가 비어 있음을 봄), `tests/rail-v2-9b.test.mjs` 의 관문 시험(미정 결정이 `advance milestone` 을 막음). examples/tiny 한 바퀴에서 `시험: 실패` → 막힘(종료 1), `시험: 통과(작은 예제 범위까지만)` → 시작(종료 0)을 직접 봤습니다.

### 2. (바뀜) 레포마다 설치하는 명령

- **바꾼 것:** `scripts/install.mjs` 를 새로 만들었습니다. Node 내장 모듈만 쓰고 셸 명령을 부르지 않습니다. 레일 스크립트를 `.rail/bin/`, 훅을 `.rail/hooks/`, 스킬을 `.claude/skills/rail*/` 로 복사합니다. `.claude/settings.json` 은 `hooks` 에서 레일 훅(명령에 `.rail/bin/`·`.rail/hooks/` 가 든 것)만 빼고 다시 넣고, `permissions.allow` 에 `Bash(node .rail/bin/rail.mjs *)` 를 없을 때만 더합니다. 다른 설정과 훅은 그대로입니다. 훅 명령은 `node "${CLAUDE_PROJECT_DIR}/.rail/hooks/…"` 꼴입니다. 시작 틀은 없을 때만 만들고, `.gitignore` 는 없는 줄만 더합니다. 다시 돌리면 업데이트이고, 바뀐 파일 목록을 출력하며, `.rail/installed.json` 에 레일 커밋·커밋 안 된 변경 여부·설치한 파일 목록을 남깁니다. 지난 설치 목록에 있었는데 이번에 없는 레일 파일은 지웁니다(목록 밖 파일은 지우지 않음). 플러그인 전용 파일(`.claude-plugin/plugin.json`, `hooks/hooks.json`)과 플러그인 경로 코드를 지우고, 스킬·status 안의 명령 경로를 `node .rail/bin/rail.mjs` 로 되돌렸습니다. 저장소 위치는 `RAIL_ROOT`, 없으면 `.rail/bin/lib/core.mjs` 에서 세 단계 위입니다.
- **확인:** `tests/install.test.mjs` 다섯 개 — 다른 훅·설정을 지키며 레일 훅 다섯 개와 허용 한 줄만 더함, 두 번 돌려도 훅·허용·`.gitignore` 줄이 두 번 들어가지 않고 "바뀐 파일 없음", 업데이트가 상태·기록·기획서·설정과 고친 시작 틀을 덮지 않고 빠진 레일 파일만 지움, 설치된 레포의 하위 폴더에서 `RAIL_ROOT` 없이 불러도 그 레포 기획서를 읽고 `.rail/hooks/guard-tests.mjs` 가 막고 기록함, 대상이 없으면 실패. 직접 실행: examples/tiny 복사본에 두 번 설치해 두 번째가 "바뀐 파일 없음"인 것을 봤습니다.

### 3. (바뀜) 확인: 실제 Claude 세션과 실제 작업자

- **실제 Claude 세션(직접 실행):** examples/tiny 를 임시 git 레포 두 개로 복사해 하나에만 설치하고, 두 곳에서 `claude -p --dangerously-skip-permissions` 에게 "tests/greet.test.mjs 끝에 한 줄을 Edit 도구로 더해 줘"를 시켰습니다. 설치한 레포에서는 "막혔습니다. 레일의 시험 파일 잠금 때문에…"라고 답했고 파일은 그대로였으며 `.rail/log.jsonl` 에 `hook_blocked`(guard-tests, Edit)가 남았습니다. 설치하지 않은 레포에서는 같은 Edit 가 그대로 됐고 아무 레일 파일도 생기지 않았습니다.
- **실제 작업자(직접 실행, 일부 대체):** 설치한 tiny 레포를 이 Orca 작업 공간 안의 임시 폴더에 두고 `isolation: worktree` 로 `node .rail/bin/rail.mjs worker start M0-1 --agent claude --role feature` 를 불렀습니다. 레일은 worktree 를 만들고 Orca 창을 열었지만, Orca 가 "A worker starts helpers in a new agent on this host; omit --on and --terminal" 로 일 맡기기를 거절했고 레일은 그 창을 닫았습니다. 까닭: 이 일을 하는 저 자신이 Orca 오케스트레이션의 작업자라서, 작업자 안에서 `--terminal` 로 일을 맡길 수 없습니다(레일의 기존 안내 문구가 이 경우를 이미 알립니다). 그래서 레일의 `agentCommand` 가 만든 실행문(`cd '<worktree>' && claude --model opus --dangerously-skip-permissions --name 'M0-1 시험 잠금 확인'`)을 그대로 `orca terminal create` 로 띄우고, 명세를 창에 직접 넣었습니다. 그 작업자는 worktree 안에서 `tests/greet.test.mjs` 를 Edit 하려다 "PreToolUse:Edit hook error: 시험 파일 잠금: …"으로 막혔고, worktree 의 `.rail/log.jsonl` 에 `hook_blocked` 가 남았습니다. 즉 작업자도 같은 레포 설정(커밋된 `.claude/settings.json`)을 읽어 잠금에 걸립니다. 확인 뒤 창·worktree·임시 폴더를 모두 지웠습니다.
- **이때 찾은 것:** 새 worktree 폴더에서 Claude Code 가 "이 폴더를 믿습니까?"를 물었고 **기본 선택이 "No, exit"** 였습니다. 레일의 `worker start` 흐름대로라면 이 화면에 명세가 들어가 작업자가 끝날 수 있습니다. 이번 확인에서는 제가 만든 임시 폴더라 "Yes"를 골랐습니다. 아래 "걱정되는 곳"에 적었습니다.
- **두 번 설치해도 훅이 두 번 들어가지 않음:** 위 `tests/install.test.mjs` 의 두 번째 시험.
- **CI:** `.github/workflows/test.yml` — 푸시·PR 때 ubuntu-latest 와 windows-latest 에서 Node 22 로 `npm test` 만 돕니다. 푸시하지 않았으므로 아직 한 번도 돌지 않았습니다.
- **Windows 대비로 고친 곳:** `npm test` 의 glob 을 큰따옴표로(cmd.exe 는 홑따옴표를 따옴표로 보지 않음), `.gitattributes` 로 LF 고정, 가짜 orca(`.mjs`)를 `#!` 줄 대신 node 로 부르기(Windows 는 `#!` 를 읽지 않음), `codex` 찾기에 PATHEXT(`.EXE`·`.CMD`), 시험의 셸 명령 중 cmd.exe 에서 다르게 도는 것(`echo 'ℹ pass 7'`, `true`, 한글 `echo`)을 `node -e` 로, 임시 폴더 경로를 `realpathSync.native` 로(Windows 짧은 이름 `RUNNER~1` 과 git 이 주는 긴 이름이 어긋나지 않게).
- **작업자 명령의 셸:** `agentCommand` 가 Windows 면 **PowerShell(5.1·7)** 문법(`cd '…'; $env:RAIL_ALLOW_TEST_EDIT='1'; claude … --name '…'`, 홑따옴표는 `''` 로), 그 밖은 sh 계열(bash·zsh) 문법을 씁니다. Orca CLI 에는 환경 변수를 넘기는 옵션이 없어(`orca terminal create/split --help` 확인) 셸 문법으로 갈랐습니다. 두 꼴은 `tests/rail-autonomy.test.mjs` 의 "작업자 명령은 Windows 면 PowerShell, 그 밖은 sh 문법으로 쓴다"가 직접 확인합니다. 작업자 명령을 단언하는 다른 시험은 지금 플랫폼의 꼴을 기대하게 고쳤습니다.
- **CI 로 확인 못 하는 것:** Windows Orca 터미널의 기본 셸이 정말 PowerShell 인지, 실제 Orca 창에서 작업자가 뜨는지, Claude Code 가 Windows 에서 `node "${CLAUDE_PROJECT_DIR}/.rail/hooks/…"` 훅을 Git Bash 로 제대로 부르는지. CI 의 windows-latest 도 시험 안의 경로·줄바꿈 문제를 처음 드러낼 수 있으며, 첫 푸시 뒤 결과를 봐야 합니다.

### 4. 비용 명령이 비어도 자율 모드가 멈추지 않게

- **바꾼 것:** `budget.mjs` 의 `budgetStatus` 가 `costCommand` 가 비면 비용을 읽지 않고 `{ over: null, note }` 를 돌려줍니다. `next` 는 그 한 줄을 보이고, `status` 는 자율 모드일 때 "[경고] 비용 명령(autonomy.budget.costCommand)이 비어 예산 규칙을 쓰지 않습니다"를 냅니다. 비용 명령이 있는데 실패하면 예전처럼 `error` 로 멈춥니다.
- **확인:** `tests/rail-autonomy.test.mjs` 의 "비용 명령이 비었으면 예산 규칙을 쓰지 않고 멈추지 않는다. status 는 경고 한 줄을 낸다"(precheck 종료 0, 비용 명령이 있으면 경고 없음)와 기존 "비용을 읽지 못하면 안전한 쪽으로 멈춘다"(그대로 통과). examples/tiny 에서 틀 설정 그대로 자율을 켜고 `next` 가 "할 일: …"과 경고 한 줄로 끝나는 것(종료 0)을 봤습니다.

### 5. 계획 밖 결정 수를 코드가 센다

- **바꾼 것:** `advance milestone` 때 기획서 "결정과 시험"의 번호 목록을 `gates.plan_marks[Mx]` 에 남기고, `advance close` 때 새로 생긴 번호 수를 `gates.unplanned[Mx]` 에 남깁니다. `status` 의 기획 성적 줄은 "계획 밖 결정 이번(Mx) N · 누적 M (코드가 셈)"이고, 기획서에 리더가 적은 누적 수가 다르면 "기획서에 적은 누적 K번과 D 차이"를 붙입니다. 닫기 출력에도 `[기획 성적]` 한 줄이 나오고 `milestone_closed` 기록에 `unplanned: { now, total }` 이 남습니다. 닫기 전 안내는 코드가 센 수를 그대로 적으라고 알립니다. 기획서 틀의 처음 값 "0번"은 "아직 없음"으로 바꿨습니다.
- **확인:** `tests/rail-plan.test.mjs` 의 "닫기 전에 코드가 센 수로 세 줄을 고치라고 알리고…"(이번·누적, 닫힘 기록, 닫은 뒤 표시), "리더가 적은 누적 수가 코드가 센 수와 다르면 차이를 보인다", `tests/rail-version.test.mjs` 의 시작 틀 시험("아직 없음"). examples/tiny 에서 마일스톤 중에 D-02 를 더하고 리더가 "0번"이라 적은 채 닫으니 `[기획 성적] 계획 밖 결정 이번(M0) 1 · 누적 1 (코드가 셈, 기획서에 적은 누적 0번과 1 차이)` 가 나왔습니다.

### 6. Codex 가 없으면 Claude 로 대신한다

- **바꾼 것:** `worker start --agent codex` 에서 `codex` 가 PATH 에 없으면 Claude 작업자로 바꿔 띄우고, "[경고] codex 명령이 PATH 에 없어 … 를 Claude 작업자로 띄웁니다 (다른 회사 모델 시각 없음)"을 내고 사건 기록에 `codex_missing` 을 남깁니다. `codexRoles` 로 Codex 가 골라진 경우도 리더가 `--agent codex` 로 부르므로 같은 길을 탑니다. 새 설정 칸은 없습니다.
- **확인:** `tests/rail-autonomy.test.mjs` 의 "codex 가 PATH 에 없으면 Claude 작업자로 대신 띄우고 경고와 codex_missing 을 남긴다"(빈 PATH). Codex 가 있는 경우의 시험들은 진짜 codex 설치에 기대지 않게 가짜 `codex` 만 든 PATH 로 바꿨습니다(CI 에는 codex 가 없음).

### 7. `request` 명령을 뺀다

- **바꾼 것:** `log.mjs` 의 `cmdRequest`, `rail.mjs` 의 명령·잠금 목록, 레일 스킬의 change·bug 줄과 `argument-hint`, 설명서의 change·bug 줄을 지웠습니다. 레일 스킬에 "주인이 기능을 바꾸자고 하면 기획서를 고치고 살아 있는 세 줄의 계획 변경에 적는다. 이상하다고 하면 고침 step 을 만든다." 한 줄을 두었습니다.
- **확인:** `tests/rail.test.mjs` 의 "log: 임의 사건을 남긴다. request 명령은 없다(사용법 오류 2)".

### 8. 판 번호 갈래를 뺀다

- **바꾼 것:** `config.mjs` 의 `isV2`·`atLeast` 를 지우고, 장면 리허설 요구(`scene.mjs`), 닫힘 알림의 새 줄과 닫은 뒤 덜어내기(`advance.mjs`), 레일 크기 기록(`usage.mjs`)을 늘 지금 판 동작으로 했습니다. `railVersion` 은 이름표로만 남겼습니다(status 머리에 보임, 동작은 안 바꿈). 장면 질문에 붙이던 판 번호(`human_ask.rail`, 아무도 읽지 않음)도 지웠습니다.
- **확인:** 판 번호에 따라 옛 동작을 기대하던 시험("1.x판은 리허설 없이")을 지우고, 리허설 기록이 필요한 시험은 기록을 넣게 고쳤습니다(`tests/helpers.mjs` 의 `markRehearsed`). `git grep isV2 atLeast` 결과 없음.

### 9. 설명서의 판 기록을 뺀다

- **바꾼 것:** `templates/docs/RAIL.md` 에서 판별 변경 이력 절 전체, "2.5판부터 빼기 판" 문단, 손으로 맞추는 판 번호 줄, change·bug 줄을 지우고, 처음 보는 사람이 읽을 사용법(명령, 흐름, 사람이 하는 일, 관문에 막혔을 때, 자율 모드, 파일, 훅)만 남겼습니다. `.claude-plugin/plugin.json` 은 2번에서 파일째 지웠으므로 설명을 고칠 곳이 없어졌습니다.
- **확인:** `tests/rail-version.test.mjs` 의 "시작 틀: 설명서에는 판 기록·change·bug 줄이 없고…".

### 더한 일: README 다시 쓰기

주인 요청대로 README.md 를 목차와 13절(무엇인가, 흐름 그림, 사람이 하는 일, 준비물, 맥·Windows 설치와 생기는 파일, 업데이트, 명령 표, 설정 표, 자율 모드와 Orca 자동화 예시, 안전장치와 권한 끄기 까닭, 한계, 문제 해결, 저장소 구조)로 다시 썼습니다. 설정 기본값은 `config.mjs`·`proto.mjs`·`stale.mjs`·`worktree.mjs` 에서 읽어 적었습니다. Orca 자동화 예시는 `orca automations create --help` 의 옵션으로 썼지만 실제로 만들어 보지는 않았습니다. `examples/tiny/README.md` 의 따라가기도 설치 명령으로 고쳤습니다.

## 숫자

| 무엇 | 전 | 후 |
|---|---|---|
| 레일 실행 코드 (`scripts/rail.mjs`, `scripts/lib/*.mjs`, `hooks/*.mjs`) | 3,369 | **3,368** |
| 설치 도구 (`scripts/install.mjs`) | 0 | **95** |
| 합계 | 3,369 | **3,463** (+94) |
| SKILL.md 4개 합계 | 114 | **113** |
| 레일 시험 | 218 개, 218 통과 | **228 개, 228 통과** (`npm test`, 직접 실행) |

**커밋별 줄 수(.mjs, 시험 제외):**

- `cf64249` 일곱 개 고침: +84 −58 = **+26**. 더한 곳: 착수 전 판정과 기한(docs.mjs +8 안팎), 계획 밖 결정 세기와 성적 줄(docs.mjs·advance.mjs·status.mjs 약 +20), Codex 대신(workers.mjs +7), 비용 명령 빈 경우(budget·status·autonomy 약 +4). 뺀 곳: request 명령(−8), 판 번호 갈래(약 −10), 옛 안내 줄.
- `2d8c84a` 레포마다 설치: +190 −122 = **+68**. 설치 도구 +95, Windows 작업자 명령·PATHEXT·가짜 orca 부르기 약 +6. 뺀 곳: 플러그인 경로 찾기(core −3), 레일 크기 계산(usage −2), 훅 안 중복(`RAIL_BIN`·`childEnv` 한 곳으로, 훅 셋 합쳐 약 −12), 옛 판 이력만 적은 주석 줄(−8), 쓰이지 않는 호환 코드(아래, 약 −10).

**(B) 뺀 호환 코드와 까닭** — 모두 지금 레일이 만들지 않는 기록이나 꼴을 위한 것이었습니다.

- `parts.mjs` 의 `TABLE_HOLD`: 2.9판에 지운 표 검사(`validate`)가 붙잡은 옛 기록을 마무리 검사의 막음으로 세지 않으려던 거르기. 지금 레일은 그런 기록을 만들지 않습니다.
- `parts.mjs` 의 `hook !== 'proto-merge'`: M14 뒤 지운 시제품 브랜치 합치기 막기 훅의 옛 기록 거르기.
- `usage.mjs` 의 `RECORDING`·`recorded`·"기록 없음 (2.2판 전)": 2.2판 전 마일스톤(관문 통과 기록이 없음)을 빼고 세던 갈래. 지금은 모든 마일스톤이 관문 통과 기록을 남깁니다.
- `ask.mjs`·`scene.mjs` 의 `human_ask.rail`: 장면 질문에 적던 판 번호. 아무 코드도 읽지 않았습니다.

**남은 차이(합계 +94)의 까닭:** 레일 실행 코드는 3,368줄로 줄었지만, 주인 결정으로 더한 설치 도구 95줄이 그대로 남습니다. 압축 이어받기는 주인이 고른 방식이라 빼지 않았고, 다른 기능은 억지로 빼지 않았습니다(코디네이터 답). 이 차이는 coach 가 주인에게 가져가 정합니다.

## 설계와 다르게 한 곳

- 2·3번은 주인 결정대로 "레포마다 설치"와 그 확인으로 바꿨습니다. 처음 만든 플러그인용 코드(레일 없는 저장소에서 훅 조용히, 작업자 실행문에 `--plugin-dir`)는 버렸습니다.
- 설치 도구 이름은 지시대로 `scripts/install.mjs` 로 두고, 레일 본체 폴더 이름(`scripts/`)은 바꾸지 않았습니다. 그래서 훅은 `rail.mjs` 를 설치된 레포에서는 `../bin/`, 이 저장소 안에서는 `../scripts/` 에서 찾습니다(`hooks/lib.mjs` 의 `RAIL_BIN`).
- 시작 틀의 `railVersion: "2.9"` 는 이름표로 남겼습니다.
- 실제 작업자 확인은 Orca 의 제한(작업자 안에서 `--terminal` 로 일 맡기기 금지) 때문에 `worker start` 끝까지는 못 하고, 레일이 만든 실행문으로 띄운 창에 명세를 직접 넣어 확인했습니다.
- 정해진 말이 아닌 상태("통과 못함" 등)의 안내를 "아직 시험하지 않음" 대신 "정해진 말이 아닙니다: …"로 바꿨습니다(tiny 한 바퀴에서 문구가 어색한 것을 보고 고침).

## 걱정되는 곳

- **worktree 방식의 폴더 신뢰 묻기.** 새 worktree 폴더에서 Claude Code 가 신뢰를 묻고 기본이 "No, exit" 입니다. `isolation: worktree` 로 밤새 돌리면 첫 작업자에서 멈출 수 있습니다. 믿은 레포의 worktree 도 묻는지는 확인하지 못했습니다(이번 확인의 원래 레포도 한 번도 믿은 적이 없음). 고치려면 `worker start` 가 이 화면을 알아보고 고르게 하거나, worktree 를 이미 믿은 폴더 아래에 만들어야 하는데, 보안 질문을 코드가 대신 고르는 일이라 주인이 정할 일입니다.
- **폴더를 믿기 전에는 명령 허용 줄이 무시됩니다.** `claude -p` 가 "Ignoring 1 permissions.allow entry … workspace has not been trusted" 를 냈습니다. 훅은 그래도 돌았습니다. 새 컴퓨터에서 처음 한 번은 사람이 직접 열어 믿어야 합니다(README 에 적음).
- **Windows 는 실제로 돌려 보지 못했습니다.** 위 3번의 "CI 로 확인 못 하는 것"이 그대로 남습니다. Orca 의 Windows 셸이 cmd.exe 이면 작업자 명령이 깨집니다.
- **step 표가 아예 없으면 `advance check` 가 통과합니다.** tiny 한 바퀴에서 실수로 표 없이 불렀을 때 넘어갔습니다. 원래부터 있던 동작이고 이번 일의 범위 밖이라 고치지 않았습니다.
- **계획 밖 결정 수는 근사값입니다.** 뒤 마일스톤의 결정을 미리 더해도 이번 수로 셉니다.
- **`reports/` 의 옛 보고서 두 개에 개인 경로가 남아 있습니다**(`move-report.md`, `planning-report.md`). reports/ 정리는 이번 일이 아니라 손대지 않았습니다. 이번에 더한 파일에는 개인 경로·이름·이메일·비밀값이 없습니다(`git grep` 확인). README 의 원본 받기 주소는 코디네이터가 준 비공개 저장소 주소 그대로입니다.
