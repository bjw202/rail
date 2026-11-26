# tiny — 레일 예제 프로젝트

인사 한 줄을 만드는 함수 하나(`src/greet.mjs`)와 시험 하나뿐인 프로젝트입니다. 레일의 기본 흐름(시작 → 기능 하나 → 확인 → 커밋 관문)을 손으로 따라가 보는 데 씁니다.

## 따라가기

이 폴더를 그대로 쓰지 말고 빈 곳에 복사해서 돌립니다(레일은 `.rail/state.json`·`.rail/log.jsonl` 같은 실행 기록을 남깁니다).

```sh
cp -R examples/tiny /tmp/tiny && cp -R templates/. /tmp/tiny/
cd /tmp/tiny && git init -q && git add -A && git commit -qm init
R="node <rail>/scripts/rail.mjs"
$R status                      # 위치: 기획 · 기획서 (질문 0)
```

그다음은 `status` 의 "다음 할 일"을 그대로 따릅니다. 사람의 답은 `ask` / `answer` 로 남깁니다.

1. 인터뷰와 기획서: 보여 주고 반응 받는 질문을 `ask` → `answer` 로 남기고(세 번마다 되짚기), `.rail/plan/template.md` 꼴로 `docs/PLAN.md` 를 쓴다. 예: 장면 S1 "이름 목록 파일을 넣으면 한 줄에 하나씩 인사가 보인다", 첫날 실패 장면 "메모장 꼴(BOM·CRLF) 파일의 첫 이름이 깨진다", 착수 전 D-01(어디에 보일까)·T-01(500줄을 0.2초 안에). 승인을 받아 `승인: <날짜>` 줄을 더한 뒤 `advance decide --milestone M0`.
2. 착수 전: D-01 은 기획서 줄 아래 후보와 추천을 보이고 묻는다("추천대로"면 `결정: AI가 고름(위임)`). T-01 은 `.rail/trial/template.md` 로 버리는 코드 두 방법(한 번에 읽기 / 줄씩 흘려 읽기)을 재고, 진짜 자료가 없으니 `시험: 통과(작은 예제 범위까지만)` 로 적는다. 재는 스크립트 `checks/T-01.mjs` 를 `.rail/config.json` 의 `verify` 에 넣고 `advance milestone`.
3. 기능 하나: `docs/plan/M0.md` 에 기능 줄 `M0-1`(완료 기준 = S1 의 자동 확인)과 마지막 리뷰 줄을 쓰고 "시작" 승인 → `step-start M0-1` → 작업자가 `src/greet-all.mjs` 와 새 시험 `tests/greet-all.test.mjs` 를 쓴다. 이미 있는 `tests/greet.test.mjs` 를 고치려 하면 시험 잠금 훅이 거절한다.
4. 커밋 관문: `part commit` → `node --test` 통과 → `log commit_gate '{"step":"M0-1","ok":true}'` → 커밋 정책(`ask`)대로 물은 뒤 이 step 의 파일만 커밋.
5. 확인: `.rail/check/template.md` 를 채운 지시서로 확인 작업자가 `.rail/check/M0-1.json` 을 쓴다. 이 기록 없이 `step-done M0-1` 을 부르면 관문이 막는다. 기록을 커밋한 뒤 `step-done M0-1 --note "..."`.
6. 닫기: `verify`(T-01 검증기) → 리허설 → 장면 질문 → 기획서 "살아 있는 세 줄"을 M0 기준으로 고친 뒤 `advance close`. `status` 에 "기획 성적: 계획 밖 결정 N번" 이 보인다.

Orca 가 없으면 `worker start`·`worker done` 대신 하위 에이전트에 명세를 주고 `log worker_start` / `log worker_closed` 로 남깁니다(`status` 가 그렇게 안내합니다).
