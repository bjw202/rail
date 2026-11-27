# rail (레일)

AI 코딩 작업을 **기획 → 마일스톤 → 확인**의 순서로 끌고 가는 작은 도구입니다.

이 문서는 설치하고 쓰는 법입니다. 속이 어떻게 돌아가는지(명령마다 어떤 파일과 훅이 움직이는지, 누가 무엇을 판정하는지, 모듈 지도, 상태와 기록의 칸)는 [HOW-IT-WORKS.md](HOW-IT-WORKS.md)에 있습니다.

## 목차

1. [레일이 무엇인가](#1-레일이-무엇인가)
2. [한눈에 보는 흐름](#2-한눈에-보는-흐름)
3. [사람이 하는 일](#3-사람이-하는-일)
4. [준비물](#4-준비물)
5. [설치](#5-설치)
6. [업데이트](#6-업데이트)
7. [명령](#7-명령)
8. [설정 (.rail/config.json)](#8-설정-railconfigjson)
9. [자율 모드 (밤새 돌리기)](#9-자율-모드-밤새-돌리기)
10. [안전장치](#10-안전장치)
11. [한계와 알려진 문제](#11-한계와-알려진-문제)
12. [문제 해결](#12-문제-해결)
13. [저장소 구조와 개발](#13-저장소-구조와-개발)

---

## 1. 레일이 무엇인가

레일은 Claude Code 로 제품을 만들 때 "지금 어디이고 다음에 무엇을 할지"를 알려 주고, 순서를 건너뛰면 넘어가지 못하게 막는 도구입니다. 기차가 레일 위로만 달리듯, AI 가 기획을 건너뛰고 바로 코드를 쓰거나 확인 없이 "끝났다"고 하지 못하게 합니다.

핵심 생각은 세 가지입니다.

- **만든 쪽이 스스로 합격 판정을 내리지 않습니다.** 기능을 만든 작업자가 아닌 다른 작업자가 확인하고, 마지막에는 다른 회사 모델(Codex)이 리뷰하고, 또 다른 작업자가 실제 화면을 눌러 보고(리허설), 마지막 판정은 사람이 직접 해 보고 내립니다.
- **막을지는 AI 의 기분이 아니라 스크립트가 정합니다.** 상태는 `.rail/state.json` 한 파일에 있고, 단계를 넘어가도 되는지는 `.rail/bin/rail.mjs` 가 판정합니다.
- **장치는 적게 둡니다.** 하나를 더하면 하나를 빼고, 부품마다 실제로 몇 번 막았는지(증거를 만드는 부품은 몇 번 돌았는지) 세어 쓰이지 않는 것을 덜어냅니다.

## 2. 한눈에 보는 흐름

```
 ┌──────────┐   ┌────────────────────┐   ┌──────────────────────────┐   ┌──────────────┐   ┌──────────────┐
 │ 1. 기획   │ → │ 2. 착수 전 결정과   │ → │ 3. 마일스톤               │ → │ 4. 장면 확인  │ → │ 5. 닫기       │
 │ 인터뷰 →  │   │    가정 시험        │   │ 기능 줄 표대로 작업자가   │   │ 리허설 →      │   │ 살아 있는     │
 │ docs/     │   │ 고를 것은 사람이,   │   │ 만들고, 다른 작업자가     │   │ 사람이 직접   │   │ 세 줄 고치기  │
 │ PLAN.md   │   │ 기술 가정은 버리는  │   │ 확인, 마지막에 Codex 리뷰 │   │ 해 보고 판정  │   │              │
 └──────────┘   │ 코드로 미리 시험    │   └──────────────────────────┘   └──────────────┘   └──────┬───────┘
                └────────────────────┘                                                              │
                          ▲                       다음 마일스톤                                       │
                          └─────────────────────────────────────────────────────────────────────────┘
```

말로 풀면 이렇습니다.

1. **기획** — 레일이 인터뷰(보여 주고 반응 받는 질문)를 해서 기획서 `docs/PLAN.md` 한 장을 씁니다. 기획서에는 맨 위 네 줄(누가 무엇을, 이번엔 어디까지, 다음 장면, 모양), 성공 장면(사람이 직접 해 보고 눈으로 확인하는 한 문장, 예: "이름 목록 파일을 넣으면 한 줄에 하나씩 인사가 보인다"), 첫날 실패 장면, 결정과 시험, 마일스톤 지도가 들어갑니다. 사람이 "맞음"이라고 하면 승인입니다.
2. **착수 전 결정과 가정 시험** — 마일스톤(제품을 나눠 만드는 한 덩어리, M0·M1…)을 시작하기 전에 풀어야 할 것을 풉니다. 결정(D-01 같은 번호)은 사람이 후보 중에서 고릅니다. 가정 시험(T-01 같은 번호, "깨지면 다시 만들어야 할 기술 가정"을 버리는 코드로 진짜 자료에 미리 해 보는 것)은 AI 가 합니다. 시험이 실패하거나 결정이 미정이면 마일스톤이 시작되지 않습니다.
3. **마일스톤** — 이번 마일스톤만 step 표(`docs/plan/M0.md`, 할 일 줄의 목록)로 나눕니다. 기본은 "기능 줄 하나 = 사용자가 알아볼 기능 하나"이고, 작업자(Orca 창에 띄운 Claude 또는 Codex 세션) 하나가 시험과 구현을 함께 합니다. 끝나면 만들지 않은 새 작업자가 완료 기준을 어기는 경우를 찾습니다(확인). 마지막 줄은 Codex 의 마지막 리뷰입니다.
4. **장면 확인** — 리허설 작업자(구현하지 않은 작업자)가 실제 앱을 띄워 점검표를 해 보고 스크린샷을 남깁니다. 사람은 그 결과를 보고 "됨/안 됨"과 본 것 한 줄을 답합니다(장면 판정).
5. **닫기** — 기획서 끝의 "살아 있는 세 줄"(깨진 가정, 계획 밖 결정 수와 계획 변경, 다음 장면)을 고치고 마일스톤을 닫습니다. "계획 밖 결정"은 마일스톤을 시작한 뒤 기획서 "결정과 시험"에 새로 생긴 번호 수이고, 레일이 직접 셉니다.

각 순간에 어떤 명령·파일·훅이 움직이는지는 [HOW-IT-WORKS 2절](HOW-IT-WORKS.md#2-한-바퀴-따라가기)에 한 줄씩 적었습니다.

## 3. 사람이 하는 일

사람이 답하거나 보는 순간은 이것뿐입니다. 나머지는 AI 가 하고, 사람에게는 한 번에 질문 하나만 합니다.

- **인터뷰에 반응하기.** 레일이 보여 주는 화면 초안·예시 숫자에 반응하고, 실제 파일로 평소 하던 일을 한 번 해 보입니다. 가정마다 "깨지면 얼마나 아픈가(큼/중간/작음)"만 답합니다.
- **기획서 승인.** 맨 위 네 줄, 성공 장면, 첫날 실패 장면, 마일스톤 지도를 보고 "맞음" 또는 고칠 문장을 말합니다.
- **착수 전 결정 고르기.** 후보 2~3개 중 하나를 고릅니다("B"만, "추천대로"도 됩니다). "나중에"라면 기한을 함께 말합니다(기한이 지나면 다시 묻습니다).
- **기능 목록 시작.** step 표가 나오면 "시작"이라고 말합니다(자율 모드면 묻지 않습니다).
- **커밋은 묻지 않습니다(새로 깐 레포).** 시작 틀의 커밋 정책이 `auto-local` 이라, 리더는 검사 명령이 통과하고 바뀐 파일이 그 step 의 범위 안이면 그 step 의 파일만 로컬 커밋합니다. 푸시는 하지 않습니다. 커밋마다 묻게 하려면 리더 세션에 "커밋마다 물어봐"라고 말합니다(`policy set commit ask`). 이미 레일을 쓰던 레포는 설치가 설정을 건드리지 않으므로 전의 정책 그대로입니다.
- **장면 판정.** 마일스톤 끝에 리허설 결과(스크린샷과 통과 수)를 보고 "됨. 본 것: …" 처럼 답합니다. 실패한 항목이 있으면 그것부터 봅니다.
- **정책 바꾸기.** 커밋 정책, 자율 모드, 부품 끄기, 작업자마다 worktree 쓰기, 다음 마일스톤 미리 승인은 사람이 리더 세션(사람이 직접 대화하는 Claude Code 창)에 직접 말할 때만 바뀝니다.
- **기능을 묻거나 제안할 때·이상할 때.** 말하면 리더가 먼저 답·후보·추천을 보이고 "지금 / 나중에 / 안 함"을 묻습니다. 나중에면 기획서 "## 나중에"에 한 줄 남기고 다음 마일스톤을 기획할 때 읽습니다. 지금이면 작업자를 띄우기 전에 앞 결정(그 "다시 볼 조건")·깨진 가정·한도와 대 보고, 어느 장면이 어떻게 달라지고 무엇으로 확인할지를 기획서에 쓴 뒤 더한 기능 줄을 보이고 승인을 받습니다(자율 모드면 더한 기능은 기본으로 "## 나중에"로 갑니다). 지금 장면이 깨졌다고 하면 고침 step 을 만듭니다. 모든 마일스톤을 닫은 뒤라면 리더가 기획서의 앞 장면·결정·남은 일과 지금 코드를 먼저 읽고, 지금 되는 것과 바뀔 것을 보여 준 뒤 같은 기획서를 고쳐 승인 질문을 합니다. 그 답을 들은 뒤에 새 마일스톤을 시작합니다.

## 4. 준비물

| 것 | 왜 필요한가 | 꼭 있어야 하나 |
|---|---|---|
| Node.js 22 이상 | 레일 스크립트와 설치 명령이 Node 로 돕니다(의존성 없음, 내장 모듈만 씀) | 예 |
| Git | 상태 비교, 시험 잠금, worktree, 커밋 | 예. Windows 는 Git for Windows 를 권합니다(Git Bash 가 따라옵니다. 없으면 Claude Code 가 Bash 도구 대신 PowerShell 을 쓰고, 설치 명령이 경고를 냅니다) |
| Claude Code | 리더와 작업자 세션 | 예 |
| Orca | 작업자를 창에 띄우고 닫기, 끝난 작업자의 알림으로 리더 깨우기, 밤샘 자동화 | 작업자를 쓰려면 예 |
| Codex CLI | 마지막 리뷰를 다른 회사 모델로 받기 | 아니요. 없으면 Claude 작업자로 대신 띄우고 경고합니다 |
| ego-browser 스킬 | 리허설 작업자가 실제 화면을 눌러 보고 스크린샷을 찍기 | 아니요. 없으면 리허설 작업자가 멈추고 까닭을 적습니다 |

## 5. 설치

레일은 레포(제품 저장소)마다 설치합니다. 컴퓨터마다 한 번 원본을 받아 `rail-install` 명령을 만들어 두고, 제품 레포마다 그 폴더에서 `rail-install` 을 칩니다.

### 한 번만: 원본 받기와 `rail-install` 만들기

맥(터미널):

```sh
git clone https://github.com/bjw202/rail ~/tools/rail
cd ~/tools/rail && npm link
```

Windows(PowerShell):

```powershell
git clone https://github.com/bjw202/rail C:\tools\rail
cd C:\tools\rail; npm link
```

`npm link` 는 어느 폴더에서나 `rail-install` 을 칠 수 있게 해 줍니다(원본 폴더를 가리키는 연결만 만들고, 파일을 복사하지 않습니다). nvm 같은 도구로 Node 판을 바꾸면 그 판에는 연결이 없으므로 원본 폴더에서 `npm link` 를 다시 합니다.

### 레포마다: 그 폴더에서 `rail-install`

맥:

```sh
cd ~/projects/my-app
rail-install
```

Windows(PowerShell):

```powershell
cd C:\projects\my-app
rail-install
```

대상은 git 레포의 맨 위 폴더여야 합니다. git 레포가 아닌 폴더, 레포의 하위 폴더, 레일 원본 폴더에서 치면 아무것도 깔지 않고 이유를 알려 줍니다. 설치는 Node 만으로 돌고 셸 명령을 쓰지 않으므로 맥과 Windows 에서 같은 명령입니다. Windows 에서 경로의 드라이브 문자는 대소문자가 달라도 됩니다(`c:\projects\my-app` 과 `C:\projects\my-app` 은 같은 폴더로 봅니다). 출력에 새로 만들거나 바꾼 파일이 한 줄씩 나옵니다.

`npm link` 없이 긴 명령으로도 됩니다. 원본의 설치 도구에 레포 경로를 줍니다.

```sh
node ~/tools/rail/scripts/install.mjs ~/projects/my-app
```

```powershell
node C:\tools\rail\scripts\install.mjs C:\projects\my-app
```

### 설치 뒤 생기는 파일

| 자리 | 뜻 | 설치를 다시 돌리면 |
|---|---|---|
| `.rail/bin/rail.mjs`, `.rail/bin/lib/*.mjs` | 레일 본체. 상태 판정과 "다음 할 일" 문구가 모두 여기 있습니다 | 새 판으로 바뀜 |
| `.rail/hooks/*.mjs` | 훅(Claude Code 가 정해진 순간에 저절로 부르는 작은 스크립트) | 새 판으로 바뀜 |
| `.claude/skills/rail/`, `rail-plan/`, `rail-milestone/`, `rail-check/` | `/rail` 스킬과 단계별 판단 지침 | 새 판으로 바뀜 |
| `.claude/settings.json` | 레일 훅 다섯 개(셸을 거치지 않는 `"command": "node", "args": [...]` 꼴)와 명령 허용 네 줄(`Bash(node .rail/bin/rail.mjs *)`, 같은 것의 `PowerShell(…)` 판, 그리고 둘 다 `.rail\bin\rail.mjs` 로 쓴 판) | 레일 훅만 바꿈. 다른 설정과 다른 훅은 그대로 |
| `.rail/config.json` | 프로젝트마다 다른 값(아래 8절) | 있으면 건드리지 않음 |
| `.rail/plan/template.md` | 기획서 틀 | 새 판으로 바뀜 |
| `.rail/trial/template.md` | 가정 시험 지시서 틀 | 새 판으로 바뀜 |
| `.rail/check/template.md`, `stale-template.md` | 확인 작업자·낡은 시험 판정 작업자 지시서 틀. 확인 틀은 배포 안 됨·키 없음처럼 코드 밖 사정으로 볼 수 없는 기준을 `must` 로 세지 않고 "배포 뒤 볼 것"으로 적게 합니다 | 새 판으로 바뀜 |
| `.rail/proto/template.md` | 시제품 지시서 틀 | 새 판으로 바뀜 |
| `docs/RAIL.md` | 프로젝트에 두는 한 쪽 사용법 | 새 판으로 바뀜 |
| `CLAUDE.md` | 모든 세션(리더·작업자)이 처음 읽는 열한 줄짜리 개발 메모 틀. 빈칸 `<…>`(제품 한 줄, 실행·시험·배포 명령, 되돌리기 어려운 일)은 기획서를 승인받은 뒤 리더가 채웁니다 | 있으면 건드리지 않음. 이미 `CLAUDE.md` 가 있던 레포는 처음 설치 때도 그대로 |
| `.gitignore` | 레일 기록 중 git 에 넣지 않을 줄 | 없는 줄만 더함 |
| `.rail/installed.json` | 설치한 레일 커밋, 커밋 안 된 변경이 있었는지, 설치한 파일 목록 | 새로 씀 |

설치는 상태·기록·기획서(`.rail/state.json`, `.rail/log.jsonl`, `docs/PLAN.md`, `docs/plan/` 등)와 이미 있는 `CLAUDE.md` 를 절대 덮지 않습니다. `.rail/` 과 `.claude/` 는 커밋해 두세요. 그래야 다른 컴퓨터에서 레포를 받아도 같은 레일이 돕니다.

### 처음 시작

1. 제품 레포 폴더에서 Claude Code 를 엽니다(`claude`).
2. 처음 열면 "이 폴더를 믿습니까?"(workspace trust)를 묻습니다. "Yes, I trust this folder" 를 고르세요. 이것을 해야 레일 명령 허용 줄이 적용됩니다.
3. `/rail` 을 칩니다. 세 줄(위치 / 기다리는 것 / 다음 할 일)이 나오고 인터뷰가 시작됩니다.
4. `.rail/config.json` 의 `checkCommand` 를 제품의 시험 명령(예: `npm test`)으로 채웁니다. 제품 스택이 아직 없으면 나중에 채워도 됩니다.

## 6. 업데이트

레일 원본을 새로 받고, 레포마다 그 폴더에서 `rail-install` 을 다시 칩니다. `npm link` 는 다시 하지 않아도 됩니다(연결이 원본 폴더를 가리키므로 `git pull` 한 새 판이 그대로 쓰입니다).

맥:

```sh
cd ~/tools/rail && git pull
cd ~/projects/my-app && rail-install
```

Windows(PowerShell):

```powershell
cd C:\tools\rail; git pull
cd C:\projects\my-app; rail-install
```

긴 명령(`node ~/tools/rail/scripts/install.mjs ~/projects/my-app`)도 그대로 됩니다.

- **바뀌는 것:** `.rail/bin/`, `.rail/hooks/`, `.claude/skills/rail*/` 의 레일 파일, 레일 틀 다섯 개(`.rail/plan/`·`trial/`·`check/` 둘·`proto/` 의 `template.md`)와 사용법 `docs/RAIL.md`, `.claude/settings.json` 의 레일 훅 줄, `.rail/installed.json`. 지난 판에만 있던 레일 파일은 지웁니다(설치 목록에 있던 것만 지우므로 `.rail/bin/` 에 직접 둔 비용 명령 같은 파일은 남습니다).
- **안 바뀌는 것:** `.rail/config.json`, `CLAUDE.md`, 상태와 기록, 기획서와 step 표. 레일 틀과 `docs/RAIL.md` 는 레일이 쓰는 글이라 고쳐 두어도 새 판으로 덮입니다. 프로젝트 규칙은 `CLAUDE.md` 에 둡니다.
- 다시 돌렸는데 바뀐 것이 없으면 "바뀐 파일 없음"이 나옵니다. 두 번 돌려도 훅이 두 번 들어가지 않습니다.
- 이미 레일을 쓰는 레포(`.rail/installed.json` 이나 `.rail/state.json` 이 있는 레포)에 커밋 안 된 변경이 있거나 작업자가 도는 중이면, 업데이트하지 않고 까닭을 보여 줍니다. 커밋 안 된 변경에는 새 파일도 들고, 레일 기록(`.rail/state.json`, `.rail/log.jsonl`, `.rail/test-baseline.json`)과 step 표 폴더(`docs/plan/`)는 뺍니다. 먼저 커밋하거나 작업자가 끝나기를 기다린 뒤 다시 칩니다. 그 상태를 알고도 꼭 지금 바꿔야 할 때만(예: 레일 고장 때문에 작업자를 닫을 수 없을 때) `rail-install --force` 를 씁니다.
- `.claude/settings.json` 이 깨져 있으면(주석, 끝 쉼표 등) 아무 파일도 쓰지 않고 멈춥니다. 고친 뒤 다시 칩니다.
- 바뀐 파일이 있으면 마지막 줄에 따로 커밋하라는 안내가 나옵니다: `git add .rail .claude docs/RAIL.md CLAUDE.md .gitignore` 를 한 뒤 `git commit -m "rail 업데이트"`. 제품 작업과 섞지 않으면 나중에 무엇이 레일 때문에 바뀌었는지 가려 보기 쉽습니다.
- `.rail/config.json` 이나 `CLAUDE.md` 를 새 틀로 바꾸고 싶으면 그 파일을 지운 뒤 설치를 다시 돌립니다.

## 7. 명령

### 사람이 쓰는 것

| 명령 | 언제 |
|---|---|
| `/rail` | 거의 모든 순간. "다음 뭐 해?", "어디까지 했지?"도 됩니다 |
| `node .rail/bin/rail.mjs status` | 터미널에서 위치 세 줄만 보고 싶을 때 |
| `node .rail/bin/rail.mjs usage [--json]` | 부품마다 마일스톤별로 몇 번 일하고 막았는지와 빼기 후보를 볼 때. 최근 닫힌 마일스톤 셋 동안 한 번도 막지 않은 부품이 후보이고, 검증기·리허설은 막지 않았어도 돌았으면 후보가 아닙니다. 자율 모드가 꺼져 있던 마일스톤의 멈춤 규칙은 "잴 수 없음"으로 보이고 후보가 되지 않습니다 |
| `rail-install` (제품 레포 폴더에서), 또는 `node <원본>/scripts/install.mjs <레포>` | 설치와 업데이트. 일이 진행 중인데도 밀어붙일 때만 `--force` |

정책 바꾸기(`policy set …`, `plan approve …`)는 사람이 리더 세션에 말하면 리더가 사람 말을 `--said` 에 그대로 넣어 부릅니다. 사람이 직접 칠 일은 거의 없습니다. 코드가 `--said` 를 꼭 요구하는 것은 `isolation` 바꾸기, 부품 끄기, `plan approve` 이고, 커밋 정책과 자율 모드는 리더가 스킬 규칙으로 지킵니다.

### 리더가 쓰는 것 (`node .rail/bin/rail.mjs <명령>`)

리더는 `status` 의 "다음 할 일"이 알려 주는 명령을 그대로 부릅니다. 자주 나오는 것만 적습니다.

| 명령 | 하는 일 |
|---|---|
| `status [--json]` | 위치, 기다리는 것, 다음 할 일, 기획 성적, 열린 작업자, step 표 |
| `next [--json] [--precheck] [--budget]` | 자율 모드의 할 일과 멈춤 까닭. `--precheck` 는 종료 코드로 답한다(9절). `--budget` 은 다른 까닭으로 멈춰도 예산을 잰다 |
| `ask "<질문>" [--kind interview\|approve\|decide]`, `ask --scene`, `ask --replace …` | 사람에게 묻는 질문 하나를 기록. 앞 질문에 답이 없으면 거절하고, `--replace` 만 바꿔 묻는다 |
| `answer "<사람의 답>"` | 사람의 답을 그대로 기록 |
| `check <단계>`, `advance <decide\|milestone\|check\|close> [--milestone Mx]` | 다음 단계로 가도 되는지 보기 / 가기 |
| `step-start <step>`, `step-done <step> --note "<한 줄>" [--commit <해시>]` | step 표의 상태 칸을 채움 |
| `worker start <step> --agent claude\|codex --role <역할> [--spec-file …] [--name …]`, `worker done <step> [--note …] [--result ok\|fail] [--force]` | 작업자 창을 띄우고 닫음. 역할은 `feature`·`check`·`fix`·`test`·`impl`·`review`·`final-review`·`rehearsal`·`stale`. `--force` 는 아직 일하는 작업자를 버릴 때만(사람이 정함) |
| `verify` | 바깥 정답 검증기를 돌림 |
| `rehearsal-record <Mx>` | 리허설 결과를 기록 |
| `scene <Mx> --result pass\|fail --note "<본 것>"` | 질문 밖에서 받은 장면 판정을 기록 |
| `reopen [--self-fix]` | 장면 실패 뒤 step 진행으로 되돌림 |
| `policy [show]`, `policy set …` | 커밋 정책, 자율 모드, isolation, 부품 끄고 켜기(사람만 정함) |
| `plan approve <Mx> … --said "<사람 말>"` | 뒤 마일스톤 기능 목록 미리 승인 |
| `worktree [list] \| merge <step> \| clean` | 작업자 worktree 다루기 |
| `log <사건> [json]` | 사건 기록에 한 줄 |
| `proto start\|record\|card\|pick` | 시제품(봐야 아는 결정에 붙이는 버리는 화면) |

`leader`, `precompact` 는 훅이 부르는 명령이라 직접 쓸 일이 없습니다. 명령마다 어느 모듈이 일하는지는 [HOW-IT-WORKS 4절](HOW-IT-WORKS.md#4-모듈-지도)에 있습니다.

## 8. 설정 (`.rail/config.json`)

설치하면 기본값이 든 파일이 생깁니다. 칸이 없으면 아래 기본값으로 봅니다.

| 칸 | 뜻 | 기본 |
|---|---|---|
| `railVersion` | 레일 판 이름표. `status` 첫 줄과 훅 머리에 보입니다. 동작은 바꾸지 않습니다 | 틀에는 `"2.9"` |
| `checkCommand` | 마무리 검사 훅이 돌리는 시험 명령. 리더도 커밋 전에 이것이 통과하는지 봅니다. 비면 마무리 검사를 건너뜁니다 | 틀에는 `"node --test"` |
| `verify` | 바깥 정답 검증기 목록 `[{ "name", "command", "why", "timeoutSec" }]`. 종료 코드 0 통과, 3 건너뜀, 그 밖은 실패. `timeoutSec` 은 하나당 시간 상한 | `[]`, `timeoutSec` 은 900초 |
| `appStart` | 확인·리허설 작업자가 앱을 띄우는 명령. 레일 코드는 읽지 않고 작업자 지시서가 이 명령을 쓰라고 합니다 | `""` |
| `commitPolicy` | `ask`(커밋마다 묻기) 또는 `auto-local`(묻지 않고 그 step 의 파일만 로컬 커밋, 푸시 안 함). 사람만 바꿈. `auto-local` 이어도 자율 모드는 켜지지 않습니다(`autonomy.mode` 따로) | 틀에는 `"auto-local"`, 칸이 없으면 `ask` |
| `isolation` | `shared`(모두 한 폴더) 또는 `worktree`(만드는 작업자마다 git worktree). 사람만 바꿈 | `shared` |
| `worktreeDir` | worktree 를 만들 폴더 | `~/orca/workspaces/<레포 폴더 이름>` |
| `codexRoles` | Codex 로 띄울 역할 | `["final-review"]` |
| `workerModels` | 작업자 역할별 Claude 모델. 예 `{"default": "opus", "check": "sonnet"}`. 역할 → `default` → `opus` 순으로 찾습니다. Codex 작업자에는 쓰지 않습니다 | 없음(모두 `opus`) |
| `staleTests` | 잠긴 시험을 고쳐야 할 때 판정을 사람(`human`)이 할지 판정 작업자(`agent`)가 할지. `agent` 여도 한 마일스톤에 시험 파일 5개를 넘으면 사람에게 묻습니다 | `human` |
| `notify.bot` | 마일스톤 닫힘·폭주 알림을 보낼 Orca 봇 이름 | 없음(안 보냄) |
| `insurance` | 보험 부품(끄지 않고 빼기 후보에도 올리지 않음). 순서 검사 `gate:order` 는 여기 없어도 끄지 않고 후보에 올리지 않습니다 | `["guard-tests", "stop-check", "gate:close"]` |
| `disabled` | 한 마일스톤 동안 꺼 둔 부품. 닫으면 다시 켜집니다 | `[]` |
| `proto.maxMinutes`, `proto.maxUSD` | 시제품 지시서에 실리는 시간·비용 안내 | 15분, $3 |
| `autonomy.mode` | 자율 모드 `on`/`off`. 사람만 바꿈 | `off` |
| `autonomy.maxSameFailure` | 마무리 검사가 같은 실패로 몇 번 이어 붙잡으면 멈출지 | 3 |
| `autonomy.busyMinutes` | 다른 세션의 작업 중 표시를 몇 분 동안 존중할지 | 20 |
| `autonomy.alertWorkerMinutes` | 작업자가 몇 분 넘게 돌면 알릴지 | 60 |
| `autonomy.budget.costCommand` | 비용을 재는 명령. 표준 입력 `{"intervals":[{"from","to"}]}` → 출력 `{"usd":[…]}`. **비면 예산 규칙을 쓰지 않습니다** | `""` |
| `autonomy.budget.sinceProgress` | 마지막 진척 뒤 지출 상한 `{ "on", "usd" }` | `{ on: true, usd: 10 }` |
| `autonomy.budget.milestone` | 지난 마일스톤 비용 중간값의 몇 배 `{ "on", "times" }` | `{ on: true, times: 3 }` |
| `autonomy.budget.daily` | 하루 상한 `{ "on", "usd" }` | `{ on: false }` |

`checkCommand`, `verify` 의 `command`, `autonomy.budget.costCommand` 는 셸에서 돕니다. 맥·리눅스는 `sh`, **Windows 는 cmd.exe** 입니다. cmd.exe 는 작은따옴표를 따옴표로 읽지 않으므로, 두 OS 에서 같이 쓰려면 따옴표는 큰따옴표로 쓰세요(JSON 안에서는 `\"`). 예: `"checkCommand": "node --test \"tests/*.test.mjs\""`. `worktreeDir` 는 `~/` 나 `~\` 로 시작하면 홈 폴더로 풉니다.

## 9. 자율 모드 (밤새 돌리기)

자율 모드는 사람이 자리를 비운 동안 리더가 멈추지 않고 다음 일을 이어 가게 합니다.

**켜는 법.** 리더 세션에 "밤새 맡길게"처럼 직접 말합니다. 리더가 `policy set autonomy on --said "…"` 를 부릅니다. 커밋 정책이 `ask` 인 예전 레포라면 먼저 "묻지 말고 로컬 커밋해"라고 말해 `policy set commit auto-local --said "…"` 를 부르게 합니다. 커밋 정책이 `auto-local` 이 아니면 자율 모드는 켜져 있어도 쓰지 않습니다(커밋마다 물으면 멈추기 때문입니다). 밤새 맡길 때는 다음 마일스톤 2~3개의 기능 목록도 미리 승인해 둘 수 있습니다(`plan approve`). 그러면 리허설이 모두 통과한 마일스톤은 사람 판정을 "장면 판정 대기"에 올려 두고 다음으로 넘어갑니다.

**멈추는 조건.** 리더는 턴마다 `next` 를 부르고, 아래 중 하나면 까닭을 한 줄 쓰고 멈춥니다.

| 까닭 | 뜻 | `next --precheck` 종료 코드 |
|---|---|---|
| (할 일 있음) | 멈추지 않음 | 0 |
| `done` | 모든 마일스톤이 닫힘 | 10 |
| `human` | 사람의 답을 기다림, 또는 판정 대기였던 장면이 "안 됨" | 11 |
| `budget` | 예산 규칙을 넘음 | 12 |
| `same_failure` | 마무리 검사가 같은 실패로 이어 붙잡음 | 13 |
| `busy` | 작업자가 도는 중이거나 다른 세션이 레일 일을 하는 중 | 14 |
| `error` | 상태 파일을 못 읽음, 또는 비용 명령이 있는데 실패 | 15 |
| `off` | 자율 모드가 꺼짐 | 16 |

까닭이 여럿 겹치면 처음 걸린 하나만 나옵니다. 보는 순서는 done → human → busy → same_failure → off → budget 이라서, 자율 모드가 꺼져 있어도 열린 질문이 있으면 `off`(16) 대신 `human`(11)이 나옵니다. 예산은 앞에서 멈추지 않았을 때만 잽니다. 자세한 조건은 [HOW-IT-WORKS 7절](HOW-IT-WORKS.md#7-자율-모드-고리)에 있습니다.

**비용 명령.** `autonomy.budget.costCommand` 가 비어 있으면 예산 규칙을 쓰지 않고, `status` 에 "[경고] 비용 명령(…)이 비어 예산 규칙을 쓰지 않습니다" 한 줄만 냅니다. 멈추지는 않습니다. 비용 명령이 있는데 실패하면 안전한 쪽으로 멈춥니다(`error`).

**Orca 자동화로 리더 깨우기 (예시).** 30분마다 `next --precheck` 를 돌려 할 일이 있을 때만 리더에게 "/rail 로 이어서 진행"을 보내게 합니다. 아래는 모양을 보이는 예시이고, 정확한 옵션은 `orca automations create --help` 로 확인하세요.

맥(터미널):

```sh
orca automations create --name "my-app 밤샘" --trigger "*/30 * * * *" \
  --workspace "path:$HOME/projects/my-app" --provider claude --reuse-session \
  --precheck "node .rail/bin/rail.mjs next --precheck" \
  --prompt "/rail 로 이어서 진행"
```

Windows(PowerShell, 줄 끝 백틱이 줄 이음입니다):

```powershell
orca automations create --name "my-app 밤샘" --trigger "*/30 * * * *" `
  --workspace "path:$env:USERPROFILE\projects\my-app" --provider claude --reuse-session `
  --precheck "node .rail/bin/rail.mjs next --precheck" `
  --prompt "/rail 로 이어서 진행"
```

작업자가 끝나면 Orca 가 리더를 깨우고, 깨우지 못한 경우에도 `next` 가 Orca 쪽에서 끝난 작업자를 찾아 "알림 읽고 이어 가기"를 줍니다. `notify.bot` 이 있으면 작업자가 오래 돌거나 진척 없이 돈을 쓰면 알림만 보냅니다(멈추지는 않습니다).

## 10. 안전장치

설치하면 `.claude/settings.json` 에 훅 다섯 개가 들어갑니다. 레일을 설치하지 않은 레포에는 아무 훅도 없으므로 그 레포에서는 아무 일도 일어나지 않습니다.

| 훅 | 언제 | 무엇을 막거나 하는가 |
|---|---|---|
| 세션 시작 (`status --hook`) | Claude Code 세션을 열 때 | 위치 세 줄을 보여 주고 "레일로 진행합니다"를 알립니다 |
| 압축 직후 (`status --hook --compact`) | 대화가 압축된 뒤 | 위치와 다시 읽을 파일을 알려 이어받게 합니다 |
| 시험 잠금 (`.rail/hooks/guard-tests.mjs`) | 파일을 고치거나 셸 명령(Bash 도구, Windows 의 PowerShell 도구)을 쓰기 직전 | 이미 있는 시험 파일(git 이 추적하는 `tests/`·`test/`·`fixtures/`·`__tests__/`·`*.test.*`·`*.spec.*`, 그리고 시험 step 이 끝날 때 찍은 기준선에 든 파일)을 고치거나 지우지 못하게 합니다. 새 시험 파일은 만들 수 있습니다. 우회는 `RAIL_ALLOW_TEST_EDIT=1` 을 붙여 띄운 세션만 됩니다 |
| 마무리 검사 (`.rail/hooks/stop-check.mjs`) | 세션이 멈추려 할 때 | 제품 파일이 바뀌었으면(문서 `.md` 만 바뀐 것은 빼고) `checkCommand` 를 돌리고, 실패하면 멈추지 못하게 붙잡아 고치게 합니다. 같은 실패는 이어서 두 번까지만 붙잡고, 사람 답을 기다리는 동안은 붙잡지 않고, 5분이 넘으면 경고만 합니다 |
| 압축 직전 (`.rail/hooks/pre-compact.mjs`) | 대화를 압축하기 직전 | 위치·열린 작업자·열린 질문을 요약에 글자 그대로 남기라고 지시합니다 |

작업자도 같은 레포 설정을 읽으므로 같은 훅이 걸립니다. 작업자 창에서 이미 있는 시험 파일을 고치려 하면 막힙니다. 훅마다 무엇을 보고 무엇을 남기는지는 [HOW-IT-WORKS 6절](HOW-IT-WORKS.md#6-훅-다섯-개)에 있습니다.

**작업자는 권한 확인을 끄고 뜹니다.** `worker start` 는 Claude 작업자를 `--dangerously-skip-permissions` 로, Codex 작업자를 `--dangerously-bypass-approvals-and-sandbox` 로 띄웁니다. 사람이 자는 동안 작업자가 권한 질문에서 멈추지 않게 하려는 것입니다. 그 대신 작업자는 레포 안에서 묻지 않고 파일을 고치고 명령을 돌립니다. 시험 잠금과 마무리 검사 훅은 권한 확인과 상관없이 걸립니다. 믿을 수 있는 레포에서만 쓰세요.

## 11. 한계와 알려진 문제

- **Node 웹앱을 전제합니다.** 마무리 검사의 통과 수 읽기, 확인 틀의 `node --test`, 리허설 스크린샷 필수는 Node 와 웹 화면을 생각하고 만들었습니다. 다른 스택은 `checkCommand` 를 바꾸면 돌지만 진척(시험 통과 수) 읽기는 Node 출력만 압니다. 시험 잠금은 `tests/` 밖의 `test_*.py` 를 시험 파일로 알아보지 못합니다.
- **시험 잠금은 최선의 노력입니다.** 셸 명령을 훑어 막으므로 `node -e "…writeFileSync…"` 나 PowerShell 의 `[IO.File]::WriteAllText(…)` 처럼 프로그램 안에서 쓰거나, 변수로 만든 경로를 쓰면 지나갑니다.
- **계획 밖 결정 수는 근사값입니다.** 마일스톤을 시작할 때의 "결정과 시험" 번호와 닫을 때의 번호를 견줘 새 번호 수를 셉니다. 이번 마일스톤과 상관없는 뒤 마일스톤의 번호를 미리 더해도 이번 수로 셉니다. 시작 기록이 없는 마일스톤(이 기능 전에 시작한 것)은 세지 않습니다.
- **가정 시험의 "통과(작은 예제 범위까지만)"도 시작을 허락합니다.** 진짜 자료가 없을 때의 통과라는 표시일 뿐, 실제 자료에서 다시 확인하는 관문은 없습니다.
- **step 표가 아예 없으면 `advance check` 가 막지 않습니다.** 머리줄만 있는 빈 표는 막지만, 파일이 없을 때는 보지 않습니다(닫을 때는 막힙니다).
- **관문이 보지 않는 안내가 있습니다.** 기획서의 `승인:` 줄이 없어도 `advance decide` 는 넘어갑니다. `step-done` 은 커밋 여부를 보지 않습니다(커밋 전의 검사 명령 통과는 마무리 검사 훅이 봅니다). 리뷰 작업자가 쓰는 `.rail/review/<step>.json` 을 읽는 코드가 없습니다. 이것들은 리더가 "다음 할 일"과 스킬을 따라 지킵니다. 무엇을 코드가 막고 무엇을 리더가 지키는지는 [HOW-IT-WORKS 3절](HOW-IT-WORKS.md#3-판정은-누가-하나)의 표에 있습니다.
- **`isolation: worktree` 에서는 새 worktree 폴더마다 Claude Code 가 "이 폴더를 믿습니까?"를 물을 수 있습니다.** 기본 선택이 "No, exit" 라서, 사람이 없으면 작업자가 뜨자마자 끝날 수 있습니다. 믿은 레포의 worktree 도 묻는지는 확인하지 못했습니다. `shared` 방식(기본)은 리더와 같은 폴더라 묻지 않습니다.
- **리더가 Orca 오케스트레이션의 작업자로 떠 있으면 `worker start` 가 일을 맡기지 못합니다.** Orca 가 작업자 안에서 `--terminal` 로 일을 맡기는 것을 막기 때문입니다. 리더는 사람이 연 Orca 창에서 띄우세요.
- **Windows 는 일부만 직접 확인했습니다.** Windows 11 에서 설치, 명령, 훅, `npm test` 를 확인했습니다. `/rail` 대화형 진행, Orca 작업자, automations, Codex 는 아직 보지 않았습니다. 작업자 명령은 Windows 면 PowerShell 문법(`$env:RAIL_ALLOW_TEST_EDIT='1'; claude …`, `cd '…'; …`)으로 씁니다. Orca 의 Windows 터미널 셸이 cmd.exe 이면 이 문법이 맞지 않습니다. 레일 시험은 CI 의 windows-latest 에서 돌지만, 실제 Orca 창에 작업자를 띄우는 부분과 Claude Code 의 Windows 훅 실행은 CI 로 확인할 수 없습니다.
- **Orca 없이 쓰면** 기획과 상태 명령은 되지만, 작업자 띄우기·닫기와 리더 깨우기는 손으로 해야 합니다(하위 에이전트에 명세를 주고 `log worker_start` 로 남기라고 `status` 가 안내합니다. 이때 `log` 는 "손으로 쓰지 마세요" 경고를 내지만 기록은 남깁니다).

## 12. 문제 해결

- **레일 명령마다 권한을 묻습니다.** 그 폴더를 아직 믿지 않아서 `.claude/settings.json` 의 허용 줄이 무시되는 경우입니다. 그 폴더에서 Claude Code 를 한 번 열고 "Yes, I trust this folder" 를 고르세요. 허용 줄이 없으면 설치를 다시 돌립니다.
- **훅이 안 걸리는 것 같습니다.** `.claude/settings.json` 에 `.rail/hooks/` 를 부르는 줄이 있는지, `.rail/hooks/` 에 파일이 있는지 봅니다. 없으면 설치를 다시 돌립니다. Claude Code 는 세션을 시작할 때 훅을 읽으므로, 설치한 뒤에는 세션을 새로 여세요.
- **작업자 창이 안 보입니다.** 리더 탭에 자리가 없으면(작업자 세 명) `worker start` 가 작업자만 있는 탭을 나누거나 새 탭을 엽니다. 새 탭이면 출력에 `[새 탭]` 줄과 탭 이름이 나옵니다. 리더가 그 이름을 전하니 Orca 에서 그 탭을 엽니다.
- **작업자가 안 뜹니다.** `node .rail/bin/rail.mjs status` 의 작업자 줄과 출력의 `[작업자 실패]` 까닭을 봅니다. "명세 파일이 없습니다"면 `.orchestration/<step>-spec.md` 를 먼저 씁니다. "리더 자신이 작업자라서"면 11절의 Orca 제한입니다. Codex 를 고른 step 인데 `codex` 명령이 없으면 Claude 로 대신 띄우고 "[경고] codex 명령이 PATH 에 없어…"를 냅니다.
- **마일스톤이 시작되지 않습니다.** `advance milestone` 의 "빠진 것"을 봅니다. 기획서 "결정과 시험" 줄의 상태 말은 정해진 말이어야 합니다. 결정은 `선택함 (<고른 것>)`, `AI가 고름(위임)`, `미룸(2026-12-01)`, 시험은 `통과`, `통과(작은 예제 범위까지만)`, `판단 보류(2026-12-01)` 만 풀린 것으로 봅니다. "통과 못함"이나 기한 없는 "미룸", 뒤 결정에 바뀐 `바뀜 (→ D-xx)` 은 풀린 것이 아니고(바뀜이면 새 번호를 착수 전에 적습니다), 기한이 지나면 다시 막힙니다.
- **Windows 에서 시험 잠금이 이미 있는 시험 파일 고치기를 막지 못합니다.** 증상: 같은 파일인데 경로를 다르게 적으면(Git Bash 꼴 `/c/Users/…`, `RUNNER~1` 같은 8.3 짧은 이름, `TESTS\X.TEST.MJS` 처럼 대소문자만 다른 꼴) 잠금이 지나갑니다. 까닭: 옛 훅은 경로를 글자 그대로 저장소 뿌리와 견줬습니다. 지금 훅(`.rail/hooks/lib.mjs` 의 `canonPath`)은 이런 꼴을 `C:\…` 실제 경로로 풀고 소문자로 견줍니다. 확인법: 레일을 업데이트한 뒤 레포 폴더의 PowerShell 에서 `'{"cwd":".","tool_name":"Edit","tool_input":{"file_path":"/c/projects/my-app/tests/x.test.mjs"}}' | node .rail/hooks/guard-tests.mjs` 처럼 이미 있는 시험 파일을 Git Bash 꼴 경로로 넣어 봅니다. `"permissionDecision":"deny"` 가 나오면 막힌 것입니다. 아무것도 안 나오면 `.rail/hooks/lib.mjs` 에 `canonPath` 가있는지 봅니다.
- **Windows 에서 줄바꿈이 섞입니다.** 이 저장소는 `.gitattributes` 로 LF 를 고정합니다. 제품 레포에서도 같은 줄(`* text=auto eol=lf`)을 두면 시험 잠금과 상태 비교가 안정합니다. 레일은 파일을 읽을 때 CRLF 를 LF 로 바꿔 읽습니다.
- **자율 모드가 바로 멈춥니다.** `node .rail/bin/rail.mjs next` 가 멈춤 까닭을 한 줄로 알려 줍니다. `next --precheck` 는 리더 세션 자신이 남긴 작업 중 표시도 남의 것으로 보므로, 방금 레일 명령을 부른 뒤면 `busy` 가 나옵니다. `busyMinutes`(기본 20분)가 지나면 풀립니다.

## 13. 저장소 구조와 개발

레일 자체를 고칠 때 보는 절입니다.

| 자리 | 하는 일 |
|---|---|
| `scripts/rail.mjs` | 명령을 받아 넘기는 입구 |
| `scripts/lib/*.mjs` | 하는 일 하나씩(상태와 기록, 관문, 위치와 다음 할 일 문구, 작업자, 자율 모드 등). 파일마다 맨 위 한 줄이 그 일이고, 한 줄 설명·줄 수·쓰는 명령은 [HOW-IT-WORKS 4절](HOW-IT-WORKS.md#4-모듈-지도)의 표에 있습니다 |
| `scripts/install.mjs` | 설치·업데이트 도구. `npm link` 하면 `rail-install` 명령이 됨(제품 레포에는 깔리지 않음) |
| `hooks/*.mjs` | 훅. 설치하면 `.rail/hooks/` 로 갑니다 |
| `skills/rail*/` | 스킬. 설치하면 `.claude/skills/` 로 갑니다 |
| `templates/` | 레일 틀·`docs/RAIL.md`(설치 때마다 새 판), 설정·`CLAUDE.md`(없을 때만) |
| `examples/tiny/` | 아주 작은 예제 프로젝트 |
| `tests/` | 레일 시험 |
| `reports/` | 작업 보고서 |
| `HOW-IT-WORKS.md` | 레일의 속: 흐름, 판정, 모듈 지도, 상태와 기록, 훅, 자율 모드, 설치, OS 차이, 크기 |

시험 돌리기:

```sh
npm test
```

푸시하면 GitHub Actions(`.github/workflows/test.yml`)가 ubuntu-latest 와 windows-latest 에서 `npm test` 만 돌립니다(AI 는 쓰지 않습니다). 레일 코드를 고친 뒤 제품 레포에 반영하려면 설치를 다시 돌립니다.
