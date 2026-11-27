// 기획서는 "지금 사실"이다(2026-11-27): 바뀐 옛 결정은 "결정: 바뀜 (→ D-xx)" 로 남기고, 착수 전에 걸렸을 때만 막는다.
// 코드 지도는 CLAUDE.md 의 한 절이고, 코드는 검사하지 않는다(지침과 틀의 문장만 본다).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { planDoc, put, rail, state, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
const next = (root) => JSON.parse(rail(root, 'status', '--json').out).next

describe('바뀐 결정: 결정: 바뀜 (→ D-xx)', () => {
  const at = (ms, marks, st) => {
    const root = tmp()
    put(root, 'docs/PLAN.md', planDoc(ms, marks))
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', step: null, closed: [], ...st, gates: { scene_checked: {}, ...st.gates } }))
    return root
  }
  const marks = { 'D-01': '결정: 바뀜 (→ D-02) · 이유: 처음엔 버튼만 잠금', 'D-02': '결정: 선택함 (B 사이트 전체) · D-01 을 바꿈' }
  test('착수 전에 걸린 바뀜은 풀린 것이 아니라 막고, 새 번호를 적으라고 알린다', () => {
    const root = at([['M0', 'D-01'], ['M1', 'D-02']], marks, { stage: 'decide', milestone: 'M0' })
    assert.match(next(root), /지금: D-01 \("결정: 바뀜 \(→ D-02\)" 입니다 \(바뀜이면 새 번호를 착수 전에 적는다\)\)/)
    const r = rail(root, 'advance', 'milestone')
    assert.equal(r.code, 1)
    assert.match(r.err, /착수 전 D-01 가 풀리지 않았습니다/)
  })
  test('바뀐 줄이 착수 전에 없으면 막지 않고, 기획서 검사도 그대로 통과한다', () => {
    const root = at([['M0', 'D-02'], ['M1']], marks, { stage: 'decide', milestone: 'M0' })
    put(root, 'docs/PLAN.md', planDoc([['M0', 'D-02'], ['M1']], marks).replace('## 결정과 시험\n', `## 결정과 시험\n- D-01 방법 — ${marks['D-01']}\n`))
    assert.match(next(root), /M0 착수 전 결정·시험이 모두 풀렸습니다/)
    assert.equal(rail(root, 'advance', 'milestone').code, 0)
    assert.deepEqual(state(root).gates.plan_marks.M0, ['D-01', 'D-02'])
  })
  test('옛 줄을 바뀜으로 고쳐도 계획 밖 결정 수는 새 번호만 센다', () => {
    const plan = (extra) => planDoc([['M0', 'D-01']], { 'D-01': '결정: 바뀜 (→ D-02)' }).replace('## 마일스톤 지도', `${extra}## 마일스톤 지도`)
    const root = at([['M0']], {}, { stage: 'milestone', milestone: 'M0', gates: { plan_marks: { M0: ['D-01'] } } })
    put(root, 'docs/PLAN.md', plan(''))
    assert.match(rail(root, 'status').out, /계획 밖 결정 이번\(M0\) 0 · 누적 0/)
    put(root, 'docs/PLAN.md', plan('- D-02 방법 — 결정: 선택함 (B) · D-01 을 바꿈\n'))
    assert.match(rail(root, 'status').out, /계획 밖 결정 이번\(M0\) 1 · 누적 1/)
  })
})

describe('지금 사실과 코드 지도 (지침·틀 문장)', () => {
  test('기획서는 덧붙이지 않고 다시 쓰고, 옛 결정·장면은 지우지 않고 고친다', () => {
    const s = read('skills/rail-plan/SKILL.md')
    assert.match(s, /바뀐 까닭은 "살아 있는 세 줄"의 계획 변경에 한 줄로 남긴다/)
    assert.match(s, /바뀐 옛 결정은 지우지 않고 상태를 `결정: 바뀜 \(→ D-xx\)` 로 고치고/)
    assert.match(s, /동작이 바뀐 옛 장면은 지우지 않고\(앞 장면 회귀 기준이다\) 자동 확인·사람이 볼 점을 지금 동작으로 고친다/)
    assert.match(read('templates/.rail/plan/template.md'), /\| 미룸\(<기한>\) \| 바뀜 \(→ D-xx\)/)
  })
  test('코드 지도: 틀의 빈칸, 닫을 때 고치기(없으면 만들기), 작업자는 먼저 읽고, 마지막 리뷰는 맞는지 본다', () => {
    assert.match(read('templates/CLAUDE.md'), /^## 코드 지도\n<M0 을 닫을 때 만든 코드를 있는 그대로 적는다/m)
    assert.match(read('skills/rail-check/SKILL.md'), /"## 코드 지도" 를 이번까지 만든 코드에 맞게 고친다\. 절이 없거나 비었으면 이때 만든다/)
    const w = read('skills/rail-milestone/workers.md')
    assert.match(w, /`CLAUDE\.md` 의 코드 지도를 먼저 읽고, 지도와 다른 구조.*보고에 적어라/)
    assert.match(w, /기획서의 지금 사실\(맨 위 네 줄·화면·바뀐 결정 표시\)과 `CLAUDE\.md` 의 코드 지도가 이번 변경과 맞는지 본다/)
  })
})
