# Windows 경로·셸 의존성 고치기 보고서 (2026-11-26)

## 쉬운 말 요약

Windows 에서 레일의 안전장치가 소리 없이 꺼질 수 있는 곳 일곱 군데를 고쳤습니다. 가장 큰 것은 두 가지입니다. 첫째, 훅을 셸을 거치지 않고 `node` 를 바로 부르는 꼴로 바꿔서, Windows 의 Claude Code 가 훅을 Git Bash 로 돌리든 PowerShell 로 돌리든 경로가 그대로 전해집니다. 둘째, 시험 잠금이 PowerShell 도구의 명령(`Set-Content`, `Remove-Item` 같은 것)도 보고 막습니다. 맥에서 시험 250개 중 249개가 통과했고(1개는 원래 Windows 전용이라 건너뜀), GitHub CI 는 첫 실행에서 Ubuntu 와 Windows 가 모두 통과했습니다. 진짜 Windows PC 의 Claude Code 로는 아직 확인하지 못했으므로, 맨 아래에 주인이 해 볼 점검 단계를 적었습니다.

## 일곱 가지: 바꾼 것과 확인한 시험

시험 이름은 `tests/` 안 파일과 `test(...)` 의 이름입니다.

| # | 바꾼 것 | 확인한 시험 |
|---|---|---|
| 1 | `scripts/install.mjs` 가 레일 훅을 `{"type":"command","command":"node","args":["${CLAUDE_PROJECT_DIR}/.rail/…", …]}` 꼴로 씁니다. 레일 훅 알아보기(`isRail`)가 `command` 와 `args` 를 함께 보므로, 다시 설치하면 옛 셸 문자열 레일 훅을 지우고 새 꼴 하나만 넣습니다. | `install.test.mjs`: "레일 파일·스킬·시작 틀을 깔고, settings.json 에 레일 훅과 명령 허용만 더한다", "옛 셸 문자열 레일 훅은 exec 형식(command: node, args)으로 바뀌고 두 번 들어가지 않으며, 옛 허용 줄도 한 번만 남는다"(Claude Code 처럼 `args` 의 자리표시자만 바꿔 셸 없이 불러 시험 잠금이 도는 것까지 봅니다), "두 번 돌려도 …" |
| 2 | 시험 잠금 matcher 에 `PowerShell` 을 더했습니다. `hooks/guard-tests.mjs` 는 PowerShell 명령을 같은 낱말 쪼개기로 읽되 이스케이프 글자를 `` ` `` 로, 경로의 `\` 를 구분자로 봅니다. 쓰기·지우기·옮기기 cmdlet 과 별칭(대소문자 무시): Remove-Item·ri·del·erase·rd, Move-Item·mi·move, Rename-Item·ren·rni, Set-Content·sc, Add-Content·ac, Clear-Content·clc, Out-File, New-Item·ni, Tee-Object, Copy-Item·cpi·copy(대상만: `-Destination` 뒤 또는 마지막 낱말). `>`·`>>` 는 원래 쪼개기가 봅니다. `pwsh`/`powershell -Command "…"` 안도 한 번 더 봅니다. | `hooks.test.mjs` 의 "시험 파일 잠금: PowerShell" 묶음 18개: 거절 13개(Set-Content, Add-Content, 파이프 Out-File, 리다이렉트 >>, Remove-Item 대소문자, del 별칭, Move-Item, Rename-Item, Copy-Item 대상, New-Item -Force, 폴더 통째로, git checkout, pwsh -Command 안), 허용 5개(Get-Content, Copy-Item 원본, 새 시험 파일, 변수 경로, 따옴표 안 글) |
| 3 | 명령 허용 줄을 네 줄로: `Bash(node .rail/bin/rail.mjs *)`, `Bash(node .rail\bin\rail.mjs *)`, `PowerShell(node .rail/bin/rail.mjs *)`, `PowerShell(node .rail\bin\rail.mjs *)`. 이미 있는 줄은 다시 넣지 않습니다. 스킬과 `status` 안내는 그대로 `/` 꼴입니다. | `install.test.mjs`: 위 첫 시험과 "옛 셸 문자열 …" 시험이 네 줄과 순서를 단언합니다 |
| 4 | README 8절 표 아래와 `templates/docs/RAIL.md` 에 "`checkCommand`·`verify`·`costCommand` 는 셸에서 돌고 Windows 는 cmd.exe 이니 따옴표는 큰따옴표로" 를 적었습니다. 코드는 바꾸지 않았습니다. | 문서만 바꿈(설치가 시작 틀 `docs/RAIL.md` 를 까는 것은 기존 설치 시험이 봄) |
| 5 | README 9절 Orca 자동화 예시에 Windows(PowerShell) 판을 나란히 두었습니다(`$env:USERPROFILE`, 줄 끝 백틱). | 문서만 바꿈 |
| 6 | `scripts/lib/worktree.mjs` 에서 `worktreeDir` 가 `~/`·`~\`·`~` 로 시작하면 `os.homedir()` 로 풉니다(한 곳, 두 줄). 경로 설정은 지금 `worktreeDir` 하나뿐입니다. | `rail-worktree.test.mjs`: "worktreeDir 가 ~/ 나 ~\ 로 시작하면 홈 폴더 아래로 푼다"(`~\` 는 Windows 에서만 돌림. CI Windows 에서 건너뜀 0개로 돌았음) |
| 7 | `install.mjs` 가 Windows 에서 Git Bash 를 찾지 못하면, 설치는 그대로 하고 출력 끝에 `!` 줄로 둘러싼 경고를 한 번 냅니다. 찾는 곳: `CLAUDE_CODE_GIT_BASH_PATH`, PATH 의 `bash.exe`(System32 의 WSL 것은 뺌)와 `git.exe` 폴더 옆 `..\bin\bash.exe`, `%ProgramFiles%`·`%ProgramW6432%`·`%LOCALAPPDATA%\Programs` 아래 `Git\bin\bash.exe`. README 준비물 표의 Git 줄에 "Windows 는 Git for Windows 권장"을 적었습니다. | `install.test.mjs`: "Windows 에서 Git Bash 를 찾는다: CLAUDE_CODE_GIT_BASH_PATH, PATH 의 git 옆 bash, 흔한 설치 자리. 없으면 경고 글을 낸다" |

README 의 "설치 뒤 생기는 파일" 표(훅 꼴과 허용 네 줄)와 10절 안전장치 표(시험 잠금이 PowerShell 도구도 봄)도 맞춰 고쳤습니다.

## 공식 문서를 다시 확인한 결과

- **exec 형식 칸 이름** (https://code.claude.com/docs/en/hooks.md): 칸은 `command` 와 `args` 입니다. 문서 문장: "A command hook runs as exec form when `args` is set, and shell form when `args` is omitted." 자리표시자는 "substituted into `command` and into each `args` element as plain strings" 이고, "Set `args` whenever the hook references a path placeholder" 라고 권합니다. 훅마다 `shell` 칸(`"bash"`/`"powershell"`)이 있지만 "Ignored when `args` is set" 입니다. 셸 형식은 "Git Bash on Windows, or PowerShell when Git Bash isn't installed" 로 돕니다. Windows 에서 exec 형식의 `command` 는 진짜 실행 파일이어야 하고 `.cmd`·`.bat` 는 안 된다고 합니다. `node` 는 `node.exe` 이므로 괜찮습니다. `timeout` 은 exec 형식에서도 그대로 쓰는 공통 칸입니다.
- **PowerShell 도구 이름** (https://code.claude.com/docs/en/tools-reference.md, hooks.md): 도구 이름은 `PowerShell` 이고, 훅 문서 예시가 `"matcher": "Bash|PowerShell"` 과 `tool_input.command` 를 씁니다. setup.md 는 "When Git for Windows is installed, the PowerShell tool is available alongside Bash: on by default for claude.ai and Console accounts" 라고 적습니다. PreToolUse 입력의 `tool_name` 이 정확히 `"PowerShell"` 이라고 따로 적은 문장은 찾지 못했습니다(matcher 예시로 미루어 같다고 봤습니다).
- **권한 규칙 문법** (https://code.claude.com/docs/en/permissions.md): `Bash(...)` 는 "matches everything before the first `*` as written" 이고, 끝의 ` *` 는 맨 명령도 맞춥니다. `PowerShell(...)` 은 "use the same shape as Bash rules" 이고 대소문자를 가리지 않으며 흔한 별칭을 바꿔 맞춥니다. 규칙 안의 역슬래시를 어떻게 읽는지(이스케이프인지 글자 그대로인지)는 문서에 없습니다. 그래서 `\` 판은 글자 그대로 적었고(settings.json 안에서는 JSON 이스케이프로 `\\`), 실제로 맞는지는 Windows 에서만 확인됩니다.
- **Git for Windows** (https://code.claude.com/docs/en/setup.md): "recommended on native Windows so Claude Code can use the Bash tool. If Git for Windows is not installed, Claude Code uses PowerShell as the shell tool instead." 찾지 못할 때는 settings.json 의 `CLAUDE_CODE_GIT_BASH_PATH` 를 쓰라고 합니다.

## 숫자

- 레일 실행 코드(`scripts/rail.mjs`, `scripts/lib/*.mjs`, `hooks/*.mjs`): 3,399줄 → 3,408줄(+9). 늘어난 곳은 `hooks/guard-tests.mjs`(+7, PowerShell 이름 목록·Copy-Item 대상·pwsh 안), `scripts/lib/worktree.mjs`(+2, `~` 풀기).
- `scripts/install.mjs`: 95줄 → 106줄(+11). exec 형식·허용 네 줄·옛 훅 알아보기에 몇 줄, Git Bash 찾기와 경고에 나머지.
- 시험: 229개 → 250개(+21: PowerShell 잠금 18, 설치 2, worktree 1). 맥 로컬 `npm test` 249 통과·1 건너뜀(원래 있던 Windows 전용 시험), 실패 0.
- CI(코드 커밋 6386bab): https://github.com/bjw202/rail/actions/runs/45744754005 — ubuntu 249 통과·1 건너뜀, windows 250 통과·0 건너뜀. 첫 실행에서 초록이었습니다.
- 새 명령·새 설정 칸·새 관문은 없습니다.

## Windows 실물에서만 확인되는 것

- Claude Code 가 exec 형식 훅의 `args` 안 `${CLAUDE_PROJECT_DIR}` 를 Windows 경로(`C:\…`)로 바꿔 넣고, `node` 를 PATH 에서 찾는지. 시험은 같은 바꾸기를 흉내 내서 확인했을 뿐입니다.
- PowerShell 도구의 PreToolUse 입력에 `tool_name: "PowerShell"` 과 `tool_input.command` 가 오는지.
- `PowerShell(node .rail\bin\rail.mjs *)` 같은 역슬래시 규칙이 권한 질문 없이 맞는지. 문서가 역슬래시 처리를 말하지 않습니다.
- Git Bash 찾기가 실제 설치(Git for Windows 기본 자리, scoop·winget 설치 자리)에서 맞게 찾는지.
- 시험 잠금의 PowerShell 판정은 최선의 노력입니다. `[IO.File]::WriteAllText(…)`, `-Path:tests\x` 꼴, 변수로 만든 경로는 지나갑니다(Bash 쪽 `node -e "…"` 가 지나가는 것과 같은 한계).

## `reports/windows-report.md` 의 5단계 점검에 더할 단계

기존 2단계(Claude Code 에게 `tests/` 파일을 고치라고 시켜 보기) 뒤에 아래 두 단계를 더하기를 권합니다.

- **2-1. PowerShell 도구로 막히는지.** 같은 창에서 Claude Code 에게 "PowerShell 도구로 `Set-Content tests\<있는 시험 파일> 'x'` 를 돌려" 라고 시킵니다. 거절되고 `.rail/log.jsonl` 에 `"tool":"PowerShell"` 인 `hook_blocked` 가 남으면 matcher 와 판정이 둘 다 맞습니다. Git Bash 가 없는 PC(또는 PowerShell 도구만 켠 세션)에서 한 번 더 하면 셸 형식과 상관없이 훅이 도는 것도 확인됩니다.
- **2-2. 권한 질문 없이 레일 명령이 도는지.** `--dangerously-skip-permissions` 없이 띄운 리더 세션에서 `/rail` 을 칩니다. `node .rail/bin/rail.mjs status` 가 Bash 로든 PowerShell 로든 권한 질문 없이 돌면 허용 줄이 맞습니다. 질문이 나오면 그 명령 글자를 그대로 적어 둡니다(역슬래시 규칙을 고칠 자료).
