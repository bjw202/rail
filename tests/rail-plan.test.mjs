// 기획서 판 시험: 기획서(docs/PLAN.md) 한 장이 BRIEF·ROADMAP 을 대신한다. 기획(plan) 단계의 다음 할 일,
// 착수 전 결정(D)·가정 시험(T)의 상태 말, 살아 있는 세 줄과 기획 성적(계획 밖 결정 수).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { events, planDoc, put, rail, state, tmp } from './helpers.mjs'

const next = (root) => JSON.parse(rail(root, 'status', '--json').out).next

describe('기획 단계: 기획서 한 장', () => {
  test('빠진 칸을 하나씩 알려 주고, 승인되면 첫 마일스톤의 착수 전 단계로 간다', () => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc().replace('- 다음 장면: 파일 하나가 보인다\n', '').replace('- 진짜 자료: 없음 — 작은 예제 범위까지만\n', ''))
    assert.match(next(root), /^기획서 마무리 — 기획서 맨 위에 "- 다음 장면:" 줄이 없습니다/)
    put(root, 'docs/PLAN.md', planDoc().replace('- 진짜 자료: 없음 — 작은 예제 범위까지만\n', ''))
    assert.match(next(root), /S1: "- 진짜 자료:" 줄이 없습니다 \(없으면 "없음 — 작은 예제 범위까지만"\)/)
    put(root, 'docs/PLAN.md', planDoc([['M0', 'T-01']]).replace('- T-01 방법 — 시험: 미실행\n', ''))
    assert.match(next(root), /T-01: "## 결정과 시험" 에 줄이 없습니다/)
    put(root, 'docs/PLAN.md', planDoc(undefined, {}, false))
    assert.match(next(root), /승인 날짜가 없습니다.*ask "이 기획서대로 갈까요\? \(맞음 \/ 고칠 문장\)" --kind approve/)
    put(root, 'docs/PLAN.md', planDoc())
    assert.match(next(root), /^기획서가 승인됐습니다\. M0 착수 전 결정·시험으로 넘어갑니다 \(advance decide --milestone M0\)/)
    assert.equal(rail(root, 'advance', 'decide', '--milestone', 'M0').code, 0)
    assert.deepEqual([state(root).stage, state(root).gates.sheet_approved], ['decide', '2026-11-24'])
  })
})

describe('착수 전: 결정과 시험의 상태 말', () => {
  const at = (marks) => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc([['M0', 'D-01', 'T-01'], ['M1']], marks))
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'decide', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
    return root
  }
  test('결정 미정이면 기획서 줄에 후보와 추천을 붙여 묻게 하고, 위임·미룸도 결정으로 본다', () => {
    assert.match(next(at({})), /남은 것: D-01, T-01\. 지금: D-01 \("결정: 미정" 입니다 \(사람이 아직 고르지 않음\)\) — 기획서 D-01 줄 아래에 후보 2~3개/)
    for (const d of ['결정: 선택함 (A)', '결정: AI가 고름(위임) (B)', '결정: 미룸(2026-12-10)']) assert.match(next(at({ 'D-01': d })), /지금: T-01 /, d)
  })
  test('시험 미실행·실패는 가정 시험 틀로 안내하고, 통과·판단 보류면 마일스톤을 시작한다', () => {
    const D = { 'D-01': '결정: 선택함 (A)' }
    assert.match(next(at({ ...D, 'T-01': '시험: 미실행' })), /가정 시험 — \.rail\/trial\/template\.md .*verify 에 넣는다$/)
    assert.match(next(at({ ...D, 'T-01': '시험: 실패 · 30MB 9초' })), /"시험: 실패" 입니다 .*지금 실패라 다른 방법을 시험하거나 그 장면의 착수 전에서 빼고 범위를 줄인다/)
    for (const t of ['시험: 통과(작은 예제 범위까지만) · 1.2초 · 감수: 첫 화면 빈칸', '시험: 판단 보류(2026-12-01)']) assert.match(next(at({ ...D, 'T-01': t })), /M0 착수 전 결정·시험이 모두 풀렸습니다/, t)
  })
})

describe('살아 있는 세 줄', () => {
  const closing = (living) => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc([['M0'], ['M1']]) + living)
    put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 기능 | a | b | c | ✅ 끝(2026-11-26) 됨 |\n')
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { scene_checked: { M0: { result: 'pass', note: '봤다' } } } }))
    return root
  }
  test('닫기 전에 이 마일스톤 기준으로 고치라고 알리고, 고친 뒤에는 바로 닫기를 안내한다(관문은 아니다)', () => {
    const old = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음\n- 계획 밖 결정: 0번 · 계획 변경: 없음\n- 다음 장면: S1\n')
    assert.match(next(old), /^M0 를 닫습니다 — 먼저 기획서 "## 살아 있는 세 줄"을 M0 기준으로 고친다/)
    const now = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 2번 (M0 2) · 계획 변경: M1 을 둘로 나눔\n- 다음 장면: S2 목록이 보인다\n')
    assert.match(next(now), /^M0 를 닫습니다 — advance close\./)
    assert.match(rail(now, 'status').out, /\n기획 성적: 계획 밖 결정 2번\n/)
    assert.equal(rail(now, 'advance', 'close').code, 0)
    assert.equal(events(now).find((e) => e.event === 'milestone_closed').grade, '2번')
  })
})
