# tiny — 레일 예제 프로젝트

인사 한 줄을 만드는 함수 하나(`src/greet.mjs`)와 시험 하나뿐인 프로젝트입니다. 레일의 기본 흐름(시작 → 기능 하나 → 확인 → 커밋 관문)을 손으로 따라가 보는 데 씁니다.

## 따라가기

이 폴더를 그대로 쓰지 말고 빈 곳에 복사해서 돌립니다(레일은 `.rail/state.json`·`.rail/log.jsonl` 같은 실행 기록을 남깁니다).

```sh
cp -R examples/tiny /tmp/tiny && cp -R templates/. /tmp/tiny/
cd /tmp/tiny && git init -q && git add -A && git commit -qm init
R="node <rail>/scripts/rail.mjs"
$R status                      # 위치: 기획 · 브리프
```

그다음은 `status` 의 "다음 할 일"을 그대로 따릅니다. 사람의 답은 `ask` / `answer` 로 남깁니다.

1. 브리프: `ask "..."` → `answer "..."`, `docs/BRIEF.md` 를 쓰고 승인을 받아 `승인: <날짜>` 줄을 더한 뒤 `advance roadmap`.
2. 로드맵: `docs/ROADMAP.md`(M0 하나, 위험 질문 없음)를 쓰고 승인 → `advance decide --milestone M0` → `advance milestone`.
3. 기능 하나: `docs/plan/M0.md` 에 기능 줄 `M0-1`(큰 소리 인사)과 마지막 리뷰 줄을 쓰고 "시작" 승인 → `step-start M0-1` → 작업자가 `src/greet.mjs` 와 새 시험 `tests/greet-loud.test.mjs` 를 쓴다. 이때 이미 있는 `tests/greet.test.mjs` 를 고치려 하면 시험 잠금 훅이 거절한다.
4. 커밋 관문: `part commit` → `node --test` 통과 → `log commit_gate '{"step":"M0-1","ok":true}'` → 커밋 정책(`ask`)대로 물은 뒤 이 step 의 파일만 커밋.
5. 확인: `.rail/check/template.md` 를 채운 지시서로 확인 작업자가 `.rail/check/M0-1.json` 을 쓴다. 이 기록 없이 `step-done M0-1` 을 부르면 관문이 막는다. 기록을 커밋한 뒤 `step-done M0-1 --note "..."`.

Orca 가 없으면 `worker start`·`worker done` 대신 하위 에이전트에 명세를 주고 `log worker_start` / `log worker_closed` 로 남깁니다(`status` 가 그렇게 안내합니다).
