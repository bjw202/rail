# rail

AI 코딩 작업을 **브리프 → 로드맵 → 결정 카드 → 마일스톤 → 장면 확인**의 레일로 끌고 가는 Claude Code 플러그인입니다. "지금 어디이고 다음에 뭘 할지"를 알려 주고, 단계를 건너뛰면 넘어가지 않게 막습니다. 막을지는 AI의 판단이 아니라 `scripts/rail.mjs` 스크립트가 정합니다. 의존성은 없고 Node 내장 모듈만 씁니다.

자세한 사용법은 [templates/docs/RAIL.md](templates/docs/RAIL.md)(프로젝트에 복사해 두는 한 쪽 설명서)에 있습니다.

## 들어 있는 것

| 자리 | 하는 일 |
|---|---|
| `.claude-plugin/plugin.json` | 플러그인 이름과 판 |
| `skills/rail*/` | `/rail` 진입점과 단계별 판단(브리프 인터뷰, 로드맵, 결정 카드와 step 표, 장면 확인) |
| `scripts/rail.mjs`, `scripts/lib/` | 상태 파일과 관문을 판정하는 명령. 모듈마다 맨 위 한 줄이 그 일 |
| `hooks/hooks.json`, `hooks/*.mjs` | 세션 시작 때 위치 세 줄, 이미 있는 시험 파일 잠금, 멈추기 전 마무리 검사, 압축 직전 요약 지시 |
| `templates/` | 레일로 진행할 프로젝트에 복사해 넣는 시작 파일(`.rail/config.json`, 확인·판정·시제품 지시서 틀, `docs/RAIL.md`, `.gitignore` 줄) |
| `examples/tiny/` | 아주 작은 예제 프로젝트 |
| `tests/` | 레일 시험 (`node --test 'tests/*.test.mjs'`) |

## 프로젝트에 쓰기

1. 프로젝트 맨 위 폴더에 시작 파일을 복사합니다: `cp -R <rail>/templates/. <프로젝트>/` (이미 `.gitignore` 가 있으면 줄만 더합니다).
2. `<프로젝트>/.rail/config.json` 에 프로젝트마다 다른 값을 적습니다(아래 표).
3. 플러그인을 **그 프로젝트에서만** 켭니다. 지금은 마켓플레이스에 올리기 전이라 `claude --plugin-dir <rail>` 로 띄웁니다. 레일 훅은 켜진 세션의 모든 git 저장소에서 일하므로(시험 파일 잠금 포함), 모든 프로젝트에 켜 두지 마세요.
4. 세션에서 `/rail` 을 칩니다.

레일 명령은 프로젝트 안 어느 폴더에서 불러도 됩니다. 저장소는 `RAIL_ROOT`, 없으면 지금 폴더에서 위로 올라가며 처음 만나는 `.rail/` 폴더로 찾습니다.

## 프로젝트 쪽 설정 (`.rail/config.json`)

| 칸 | 뜻 | 기본 |
|---|---|---|
| `railVersion` | 레일 판 번호. 판에 따라 켜지는 관문이 있다 | 없음 |
| `checkCommand` | 마무리 검사 훅과 커밋 관문이 돌리는 시험 명령. 비면 건너뜀 | 빈 값 |
| `verify` | 바깥 정답 검증기 목록 `[{ name, command, why }]` (종료 0 통과, 3 건너뜀) | 없음 |
| `appStart` | 확인·리허설 작업자가 앱을 띄우는 명령(스킬과 지시서 틀이 읽으라고 안내) | 없음 |
| `autonomy.budget.costCommand` | 예산 규칙이 비용을 재는 명령. 표준 입력 `{intervals:[{from,to}]}` → 출력 `{usd:[...]}` | 빈 값(비용 못 읽음) |
| `notify.bot` | 닫힘·폭주 알림을 보낼 Orca 봇 이름 | 없음(안 보냄) |
| `commitPolicy` | `ask` 또는 `auto-local` (사람만 바꿈) | `ask` |
| `isolation` | `shared` 또는 `worktree` (사람만 바꿈) | `shared` |
| `worktreeDir` | worktree 를 만들 폴더 | `~/orca/workspaces/<저장소 이름>` |
| `staleTests` | 잠긴 시험 고치기 판정을 `human` 이 할지 `agent` 가 할지 | `human` |
| `codexRoles`, `proto`, `insurance`, `disabled`, `autonomy.*` | 설명서 `docs/RAIL.md` 참고 | |

## 시험

```sh
node --test 'tests/*.test.mjs'
```
