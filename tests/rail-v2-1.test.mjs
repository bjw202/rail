// 레일 2.0판 뒤 더함(2026-11-24): 모든 마일스톤을 닫은 뒤(done) 기획서 마일스톤 지도에 새 마일스톤을 더하면 그 결정 단계로 갈 수 있다.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { events, planDoc, put, rail, state, tmp } from './helpers.mjs'

// M0·M1 을 모두 닫아 done 이 된 저장소.
function finished(ms = []) {
  const root = tmp()
  put(root, 'docs/PLAN.md', planDoc([['M0', 'D-01'], ['M1'], ...ms], { 'D-01': '결정: 선택함 (A)' }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, step: null, gates: { scene_checked: {} }, closed: ['M0', 'M1'] }))
  return root
}
const M2 = ['M2']

test('남은 마일스톤이 없으면 done 에서 decide 로 가지 않는다', () => {
  const root = finished()
  const r = rail(root, 'check', 'decide', '--milestone', 'M2')
  assert.notEqual(r.code, 0)
  assert.match(r.err + r.out, /시작할 마일스톤이 남아 있지 않습니다/)
  const st = JSON.parse(rail(root, 'status', '--json').out)
  assert.match(st.next, /^남은 일이 없습니다\. 주인이 기능을 더하자고 하면: 기획서의 관련 장면·결정\(다시 볼 조건\)·깨진 가정·"## 나중에"·확인 기록\(\.rail\/check\/\*\.json\)의 nice 를 읽고, 그 기능이 닿는 지금 코드와 시험을 확인한다/)
  assert.match(st.next, /지금 되는 것과 바뀔 것을 짧게 보여 주고 같은 기획서\(맨 위 네 줄·장면·화면·지도\)를 고친 뒤 고친 줄을 보여 주고 ask "이렇게 고친 기획서대로 갈까요\? \(맞음 \/ 고칠 문장\)" --kind approve/)
  assert.match(st.next, /맨 위 승인 줄을 "승인: \d{4}-\d\d-\d\d" 로 둔다\(없으면 더하고 있으면 날짜를 바꾼다/, '이미 있는 옛 승인 줄은 날짜를 오늘로 바꾼다')
  assert.equal(st.skill, 'rail-plan')
})

test('기획서 마일스톤 지도에 새 마일스톤을 더하면 done 에서 그 마일스톤의 decide 로 간다', () => {
  const root = finished([M2])
  // 승인 답은 코드로 가리지 않는다(고침 요구도 approve 답으로 남는다). 넘어가기 전에 보이고 승인받으라고 안내만 한다.
  assert.match(rail(root, 'status').out, /새 마일스톤 M2 이 있습니다 — 먼저 달라진 범위와 완료 기준을 주인에게 보여 주고 승인을 받았는지 본다\(아직이면 보여 주고 묻는다\)\. 받았으면 advance decide --milestone M2/)
  const r = rail(root, 'advance', 'decide', '--milestone', 'M2')
  assert.equal(r.code, 0, r.err)
  const st = state(root)
  assert.equal(st.stage, 'decide')
  assert.equal(st.milestone, 'M2')
  assert.ok(events(root).some((e) => e.event === 'stage_advance' && e.from === 'done' && e.to === 'decide'))
})

test('done 에서도 닫히지 않은 다음 마일스톤만 고를 수 있다', () => {
  const root = finished([M2, ['M3']])
  const r = rail(root, 'check', 'decide', '--milestone', 'M3')
  assert.notEqual(r.code, 0)
  assert.match(r.err + r.out, /다음 마일스톤은 M2 입니다/)
})
