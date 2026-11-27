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
    assert.match(next(root), /^기획서가 승인됐습니다\. 먼저 \.rail\/config\.json 의 checkCommand\(비어 있음\)가 제품의 시험 명령인지 본다\. 타입 검사\(예: tsc --noEmit\)·린터가 있으면 함께 넣고 너무 느리면 빠른 것만\. 그다음 M0 착수 전 결정·시험으로 넘어갑니다 \(advance decide --milestone M0\)/)
    assert.equal(rail(root, 'advance', 'decide', '--milestone', 'M0').code, 0)
    assert.deepEqual([state(root).stage, state(root).milestone], ['decide', 'M0'])
    assert.ok(!('sheet_approved' in state(root).gates), '아무도 읽지 않는 승인 날짜 사본은 상태에 남기지 않는다(원본은 기획서의 승인 줄)')
  })
})

describe('착수 전: 결정과 시험의 상태 말', () => {
  const at = (marks) => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc([['M0', 'D-01', 'T-01'], ['M1']], marks))
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'decide', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
    return root
  }
  const D = { 'D-01': '결정: 선택함 (A)' }
  test('결정 미정이면 기획서 줄에 후보와 추천을 붙여 묻게 하고, 위임·미룸(기한)도 결정으로 본다', () => {
    assert.match(next(at({})), /남은 것: D-01, T-01\. 지금: D-01 \("결정: 미정" 입니다 \(사람이 아직 고르지 않음\)\) — 기획서 D-01 줄 아래에 후보 2~3개/)
    for (const d of ['결정: 선택함 (A)', '결정: AI가 고름(위임) (B)', '결정: 미룸(2099-12-10)']) assert.match(next(at({ 'D-01': d })), /지금: T-01 /, d)
  })
  test('시험 미실행·실패는 가정 시험 틀로 안내하고, 통과·판단 보류(기한)면 마일스톤을 시작한다', () => {
    assert.match(next(at({ ...D, 'T-01': '시험: 미실행' })), /가정 시험 — \.rail\/trial\/template\.md .*verify 에 넣는다$/)
    assert.match(next(at({ ...D, 'T-01': '시험: 실패 · 30MB 9초' })), /"시험: 실패" 입니다 .*지금 실패라 다른 방법을 시험하거나 그 장면의 착수 전에서 빼고 범위를 줄인다/)
    for (const t of ['시험: 통과 · 0.4초', '시험: 통과(작은 예제 범위까지만) · 1.2초 · 감수: 첫 화면 빈칸', '시험: 판단 보류(2099-12-01)']) assert.match(next(at({ ...D, 'T-01': t })), /M0 착수 전 결정·시험이 모두 풀렸습니다/, t)
  })
  test('상태 말은 정해진 말과 정확히 맞아야 하고, 기한 없는·지난 미룸과 판단 보류는 풀린 것이 아니다', () => {
    const cases = [
      [{ ...D, 'T-01': '시험: 통과 못함 · 9초' }, /T-01 \("시험: 통과 못함" 입니다 \(정해진 말이 아닙니다: 통과 · 통과\(작은 예제 범위까지만\) · 판단 보류\(<기한>\)\)\)/],
      [{ ...D, 'T-01': '시험: 판단 보류' }, /T-01 \("시험: 판단 보류" 입니다 \(기한을 "\(2026-12-01\)" 꼴로 붙인다\)\)/],
      [{ ...D, 'T-01': '시험: 판단 보류(2020-01-01)' }, /T-01 \("시험: 판단 보류\(2020-01-01\)" 의 기한 2020-01-01 이 지났습니다/],
      [{ 'D-01': '결정: 미룸', 'T-01': '시험: 통과' }, /D-01 \("결정: 미룸" 입니다 \(기한을/],
      [{ 'D-01': '결정: 미룸(2020-01-01)', 'T-01': '시험: 통과' }, /D-01 \("결정: 미룸\(2020-01-01\)" 의 기한 2020-01-01 이 지났습니다/],
      [{ 'D-01': '결정: 선택함인 듯', 'T-01': '시험: 통과' }, /D-01 \("결정: 선택함인 듯" 입니다 \(정해진 말이 아닙니다: 선택함/]
    ]
    for (const [marks, re] of cases) assert.match(next(at(marks)), re, JSON.stringify(marks))
  })
  test('advance milestone 은 미리 승인과 같은 판정으로 풀리지 않은 착수 전 항목이 있으면 막고, 풀리면 시작한다', () => {
    for (const t of ['시험: 미실행', '시험: 실패 · 30MB 9초', '시험: 통과 못함', '시험: 판단 보류(2020-01-01)']) {
      const root = at({ ...D, 'T-01': t })
      const r = rail(root, 'advance', 'milestone')
      assert.equal(r.code, 1, t)
      assert.match(r.err, /착수 전 T-01 가 풀리지 않았습니다/, t)
      assert.equal(state(root).stage, 'decide')
      assert.equal(events(root).findLast((e) => e.event === 'gate_blocked')?.target, 'milestone', t)
    }
    const root = at({ ...D, 'T-01': '시험: 통과 · 0.4초' })
    assert.equal(rail(root, 'advance', 'milestone').code, 0)
    assert.deepEqual([state(root).stage, state(root).gates.plan_marks.M0], ['milestone', ['D-01', 'T-01']])
    assert.ok(!('risks_decided' in state(root).gates), '아무도 읽지 않는 착수 전 번호 사본은 상태에 남기지 않는다')
  })
})

describe('살아 있는 세 줄과 계획 밖 결정 수', () => {
  const closing = (living, marks = ['D-01']) => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc([['M0', 'D-01', 'D-02', 'T-02'], ['M1']], { 'D-01': '결정: 선택함 (A)', 'D-02': '결정: 선택함 (B)', 'T-02': '시험: 통과' }) + living)
    put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 기능 | a | b | c | ✅ 끝(2026-11-26) 됨 |\n')
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { plan_marks: { M0: marks }, scene_checked: { M0: { result: 'pass', note: '봤다' } } } }))
    return root
  }
  test('닫기 전에 코드가 센 수로 세 줄을 고치라고 알리고, 고친 뒤에는 바로 닫기를 안내한다(관문은 아니다)', () => {
    const old = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음\n- 계획 밖 결정: 아직 없음 · 계획 변경: 없음\n- 다음 장면: S1\n')
    assert.match(next(old), /^M0 를 닫습니다 — 먼저 기획서 "## 살아 있는 세 줄"을 M0 기준으로 고친다\(.*- 계획 밖 결정: 누적 2번 \(M0 2\).*"## 나중에" 도 본다\. CLAUDE\.md "## 코드 지도" 를 이번까지 만든 코드에 맞게 만든다\(.*\)\. 그다음 advance close/)
    assert.match(rail(old, 'status').out, /\n기획 성적: 계획 밖 결정 이번\(M0\) 2 · 누적 2 \(코드가 셈\)\n/)
    const now = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 2번 (M0 2) · 계획 변경: M1 을 둘로 나눔\n- 다음 장면: S2 목록이 보인다\n')
    assert.match(next(now), /^M0 를 닫습니다 — 먼저 CLAUDE\.md "## 코드 지도" 를 이번까지 만든 코드에 맞게 만든다\(폴더·모듈마다 맡은 일 한 줄, 자료 길 하나, 깨면 안 되는 약속, 15줄 안쪽, 까닭은 결정 번호만\)\. 그다음 advance close\./)
    const r = rail(now, 'advance', 'close')
    assert.equal(r.code, 0)
    assert.match(r.out, /\[기획 성적\] 계획 밖 결정 이번\(M0\) 2 · 누적 2 \(코드가 셈\)/)
    const closed = events(now).find((e) => e.event === 'milestone_closed')
    assert.deepEqual([closed.grade, closed.unplanned], ['2번', { now: 2, total: 2 }])
    assert.deepEqual(state(now).gates.unplanned, { M0: 2 })
    assert.match(rail(now, 'status').out, /\n기획 성적: 계획 밖 결정 이번\(M0\) 2 · 누적 2 \(코드가 셈\)/, '닫은 뒤 다음 시작 전에는 마지막으로 닫은 마일스톤을 보인다')
  })
  test('리더가 적은 누적 수가 코드가 센 수와 다르면 차이를 보인다', () => {
    const root = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 1번 (M0 1) · 계획 변경: 없음\n- 다음 장면: S2\n', ['D-01', 'D-02'])
    assert.match(rail(root, 'status').out, /기획 성적: 계획 밖 결정 이번\(M0\) 1 · 누적 1 \(코드가 셈\)\n/)
    const off = closing('## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 0번 (M0 0) · 계획 변경: 없음\n- 다음 장면: S2\n')
    assert.match(rail(off, 'status').out, /기획 성적: 계획 밖 결정 이번\(M0\) 2 · 누적 2 \(코드가 셈, 기획서에 적은 누적 0번과 2 차이\)/)
  })
})
