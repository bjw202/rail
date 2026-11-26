# Windows CI 실패 고치기 보고

## 쉬운 말 요약

첫 CI 실행에서 Windows 만 실패한 시험 묶음 8개를 고쳤고, 고친 뒤의 CI 실행에서 Ubuntu 와 Windows 가 모두 통과했습니다. 도중에 Windows 에서만 가끔 흔들리는 시험 하나도 찾아 고쳤습니다. 실패의 절반은 레일 코드가 실제로 Windows 에서 틀리게 돌던 것이었습니다. 훅이 넘겨주는 입력을 읽지 못했고, `C:\…` 꼴의 경로를 경로로 알아보지 못했습니다. 나머지는 시험 쪽 문제로, 시험이 맥의 줄 끝과 경로 구분자를 전제하고 있었습니다. 고치는 김에, Windows 의 Orca 명령은 배치 파일(`orca.cmd`)이라 레일이 Orca 를 아예 부르지 못했을 문제도 찾아 고쳤습니다. 다만 진짜 Orca 와 진짜 Claude Code 훅으로는 Windows 에서 확인하지 못했습니다. 그래서 주인이 Windows PC 에서 처음 해 볼 점검 순서를 맨 아래에 적었습니다.

## 실패별 원인과 고친 것

| 실패한 묶음 | 원인 | 고친 것 |
|---|---|---|
| 닫힘 알림 (2.3판) | **레일 코드 문제.** 훅 입력 읽기 | 아래 1 |
| 압축 이어받기 (2개) | **레일 코드 문제.** 훅 입력 읽기 | 아래 1 |
| proto start | **레일 코드 문제.** 절대 경로 판정 + 시험의 가짜 orca 가 `/` 로 경로를 이음 | 아래 2, 시험 고침 |
| proto card 와 proto pick | **레일 코드 문제.** 절대 경로 판정(경로 대신 브랜치로 지움) | 아래 2 |
| proto start: 작업 공간 경로를 Orca 목록에서 찾기 | **레일 코드 문제.** 절대 경로 판정 | 아래 2 |
| proto pick: 실제 브랜치 이름으로 지우기 | **레일 코드 문제.** 절대 경로 판정 | 아래 2 |
| worktree 방식: 만들기 → … → 지우기 (2개) | **시험 문제.** CRLF 줄 끝 | 아래 3 |
| worktree 방식: 거절하고 남기기 | **시험 문제.** CRLF 줄 끝 | 아래 3 |

### 1. 훅 입력을 읽지 못함 (레일 코드, `scripts/lib/session.mjs`)

- **증상:** `status --hook` 와 `precompact` 가 Claude Code 훅이 표준 입력으로 주는 JSON(세션 번호, 압축 계기)을 빈 값으로 읽었습니다. 그래서 리더 세션이 기록되지 않았고, `compact_started` 의 계기와 세션 칸이 비었습니다. 또 압축 뒤 세션 시작(`source: compact`)을 알아보지 못해, 같은 상태 세 줄을 두 번 넣었습니다.
- **원인:** `hookInput()` 은 표준 입력이 파이프(FIFO)인지 보고, `readFileSync(0)` 로 한 번에 읽었습니다. Windows 에서는 파이프가 FIFO 로 알려지지 않을 수 있고, 파이프 끝에서 `readFileSync(0)` 가 EOF 오류를 낼 수 있습니다. 둘 중 어느 쪽이었는지는 로그만으로 가를 수 없었습니다. 그래서 두 경우를 모두 막았습니다.
- **고친 것:** Windows 에서는 터미널(`tty.isatty(0)`)일 때만 읽지 않습니다. 읽기는 조각으로 하고, EOF 오류는 끝으로 봅니다. 맥과 리눅스의 판정은 그대로입니다. 이 함수는 훅에서 부를 때만 쓰이므로(`status --hook`, `precompact`), 열린 터미널에서 멈춰 기다리는 일은 없습니다.

### 2. `C:\…` 경로를 경로로 보지 않음 (레일 코드, `scripts/lib/proto.mjs`)

- **증상:** `proto start` 가 Orca 에게서 받은 작업 공간 경로를 버리고 `null` 로 적었습니다. 그래서 `proto pick` 이 작업 공간을 경로가 아니라 브랜치 이름으로 지웠습니다.
- **원인:** 절대 경로를 "`/` 로 시작하는가"로만 가렸습니다(두 군데).
- **고친 것:** `/…`, `C:\…`, `C:/…`, `\\서버\…` 를 모두 절대 경로로 보는 정규식 하나를 두고 두 군데에서 씁니다.
- **시험도 고침:** `tests/rail-v2-4.test.mjs` 의 가짜 orca 가 경로를 `'/'` 로 이어 붙여 `C:\…\wt/proto-…` 를 돌려줬습니다. 진짜 Orca 는 플랫폼의 구분자를 쓰므로, 가짜도 `path.sep` 를 쓰게 했습니다.

### 3. 줄 끝 CRLF (시험 문제, `tests/rail-worktree.test.mjs`)

- **원인:** GitHub 의 Windows 러너는 git 설정이 `core.autocrlf=true` 입니다. 그래서 합친 파일을 꺼낼 때 줄 끝이 `\r\n` 이 됐고, 시험은 바이트를 `\n` 으로 비교했습니다. 레일은 합치기를 git 에 맡기고, 문서를 읽을 때 이미 `\r\n` 을 `\n` 으로 바꾸므로(`core.mjs` 의 `read`) 레일 동작의 문제는 아닙니다.
- **고친 것:** 시험의 임시 저장소에서 `core.autocrlf` 를 끕니다. 시험을 건너뛰게 한 것은 없습니다.

### 4. (CI 실패 밖에서 찾음) Windows 에서 Orca 를 부르지 못함 (레일 코드, `scripts/lib/orca.mjs`)

- **찾은 것:** Orca 앱 안의 코드를 보면, Windows 의 Orca 명령 이름은 `orca.cmd` 이고, 내용은 Electron 으로 Orca CLI 를 부르는 배치 파일입니다. 레일은 Orca 를 셸 없이 `spawnSync('orca', …)` 로 불렀습니다. Node 는 셸 없이 배치 파일을 찾지도, 실행하지도 못합니다(`.cmd` 를 직접 주면 보안 수정 뒤로 EINVAL 오류). 그래서 Windows 에서는 작업자 띄우기, 알림 보내기, 시제품 정리가 모두 실패했을 것입니다. CI 의 시험은 가짜 orca 를 `.mjs` 로 주므로 이 문제를 드러내지 못했습니다.
- **고친 것:** Windows 에서 `.exe`·`.com`·`.mjs` 가 아닌 Orca 명령은 `cmd.exe /d /s /c` 를 거쳐 부릅니다. 인자는 cmd 가 다시 해석하지 못하게 막습니다(cross-spawn 과 같은 방식입니다. 배치 파일이 `%*` 로 한 번 더 읽으므로 두 번 막습니다). cmd 는 줄바꿈이 든 인자를 자르므로, 줄바꿈이 든 `--body`(닫힘 알림, 폭주 알림)는 `--body-file -` 로 바꿔 표준 입력으로 보냅니다. 이 선택은 맥의 `orca orchestration send --help` 로 확인했습니다.
- **확인:** Windows 에서만 도는 시험을 더했습니다(`tests/rail-v2-3.test.mjs` 의 "Windows 의 orca.cmd 부르기"). 빈칸이 든 폴더에 가짜 `orca.cmd` 를 두고, `& | < > " ( ) % %PATH% ! ^ ; ,`, 끝의 역슬래시, 한글, 빈 인자, 줄바꿈 든 본문을 넘깁니다. 가짜가 받은 인자와 표준 입력이 보낸 것과 똑같은지 봅니다. Windows CI 에서 실제로 돌았고 통과했습니다(건너뜀 0개).

### 5. (고친 뒤 한 번 나온) 동시 worker done 시험의 흔들림 (시험 문제, `tests/rail-autonomy.test.mjs`)

- **증상:** 보고서만 더한 커밋의 CI 에서, 이 일에서 바꾸지 않은 "파일 잠금 › 동시에 부른 worker start 두 개와 step-start 두 개가 …" 시험이 Windows 에서 한 번 실패했습니다(https://github.com/bjw202/rail/actions/runs/45741041790). 그 앞뒤 실행에서는 통과했습니다.
- **원인:** 두 `worker done` 이 동시에 창을 닫을 때, 시험의 가짜 orca 가 창 배치 파일(`layout.json`)을 잠그지 않고 읽고-고치고-썼습니다. 그래서 한쪽의 닫기가 다른 쪽에 덮여, 닫힌 창 하나가 배치에 남았습니다. Windows 는 프로세스가 늦게 떠서 두 닫기가 겹치기 쉽습니다. 레일의 기록과 상태 파일은 깨지지 않았습니다(그 단언들은 모두 통과). 진짜 Orca 는 자기 서버에서 창 바꾸기를 차례로 처리하므로, 레일 동작의 문제가 아닙니다.
- **고친 것:** 가짜 orca 의 창 닫기를 폴더 잠금 안에서 합니다. 창 나누기 쪽은 그대로 두어, 레일이 나누기를 차례로 하는지 보는 힘은 줄이지 않았습니다.

## 줄 수

레일 실행 코드(`scripts/rail.mjs`, `scripts/lib/*.mjs`, `hooks/*.mjs`)는 3,368줄에서 **3,399줄로 31줄** 늘었습니다.

- `session.mjs` +15: Windows 판정 한 줄과, EOF 를 끝으로 보는 조각 읽기 함수 두 개.
- `orca.mjs` +14: 배치 파일을 cmd 로 부르는 함수 하나와 그 설명.
- `proto.mjs` +2: 절대 경로 정규식과 그 설명.

모두 Windows 에서 레일이 아예 돌지 않던 것을 고치는 데 필요한 줄입니다. 새 명령, 새 설정 칸, 새 장치는 없습니다.

## CI 와 로컬 시험

- **코드를 고친 마지막 CI 실행:** https://github.com/bjw202/rail/actions/runs/45741441560 — ubuntu-latest 통과, windows-latest 통과. Windows 에서 시험 229개 통과, 실패 0개, 건너뜀 0개(로그에서 직접 확인).
- **맥 로컬 `npm test`:** 229개 가운데 228개 통과, 실패 0개, 1개 건너뜀(Windows 전용 orca.cmd 시험). 직접 실행해 확인했습니다.
- **푸시 순서:** 첫 고침(두 OS 통과, https://github.com/bjw202/rail/actions/runs/45740755766) → 보고서(Windows 에서 흔들리는 시험 하나 실패, 위 5) → 그 시험 고침(두 OS 통과) → 이 보고서 고침. 이 보고서를 고친 커밋의 CI 결과는 worker_done 알림에 적습니다.

## CI 로도 확인하지 못한 부분

- **진짜 Orca 의 `orca.cmd`:** 시험은 Orca 의 배치 파일과 같은 꼴(`"<실행 파일>" "<스크립트>" %*`)의 가짜로 했습니다. 진짜 `orca.cmd` 가 Orca 판에 따라 다른 꼴일 수 있고, Orca 가 Windows 창에 `ORCA_CLI_COMMAND` 를 무엇으로 넣는지(이름인지, 전체 경로인지, 비워 두는지)도 확인하지 못했습니다.
- **Orca 창에 작업자 명령 넣기:** `worker start` 가 만드는 PowerShell 명령이 실제 Orca 창에서 Claude Code 를 제대로 띄우는지 보지 못했습니다. 이 명령은 cmd 를 거쳐 `--command` 인자로 넘어갑니다. ESC 글자를 보내는 `terminal send --text` 도 같습니다.
- **실제 Claude Code 훅:** Windows 의 Claude Code 가 `.claude/settings.json` 의 `node "${CLAUDE_PROJECT_DIR}/.rail/hooks/…"` 를 제대로 펼쳐 부르는지, 훅 입력 파이프가 CI 의 Node 파이프와 같은지 보지 못했습니다.
- **`--body-file -`:** 표준 입력으로 보낸 본문을 Windows 의 Orca CLI 가 UTF-8 로 읽는지 보지 못했습니다.

## 주인이 Windows PC 에서 처음 해 볼 점검 (5단계)

1. 레일 저장소에서 `npm test` 를 돌려, 시험 229개가 모두 통과하는지 봅니다. 건너뜀이 0개여야 합니다.
2. 작은 시험 레포(예: `examples/tiny` 복사본)에 `node scripts/install.mjs <레포>` 로 설치하고, 그 레포를 Orca 로 엽니다. Orca 창에서 Claude Code 를 띄워 `tests/` 안 파일을 고치라고 시켜 봅니다. 훅이 막고 `.rail/log.jsonl` 에 `hook_blocked` 가 남으면, 훅이 돈 것입니다.
3. 같은 Orca 창에서 `/compact` 를 한 번 하고, `.rail/log.jsonl` 끝에 `compact_started` 가 `trigger` 와 `session` 칸이 찬 채로 남는지 봅니다. 훅 입력 읽기를 확인하는 단계입니다.
4. Orca 창에서 `node .rail/bin/rail.mjs worker start M0-1 --agent claude --role feature` 를 부릅니다. 새 창이 열리고 Claude Code 가 지시서를 받는지 봅니다. 실패하면 출력의 오류 문구와 `echo $env:ORCA_CLI_COMMAND` 의 값을 적어 둡니다.
5. `.rail/config.json` 에 `notify.bot` 을 두고 마일스톤 하나를 닫아, 여러 줄 닫힘 알림이 줄바꿈과 한글이 깨지지 않은 채 도착하는지 봅니다.
