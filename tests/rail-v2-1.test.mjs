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
  assert.match(rail(root, 'status').out, /남은 일이 없습니다/)
})

test('기획서 마일스톤 지도에 새 마일스톤을 더하면 done 에서 그 마일스톤의 decide 로 간다', () => {
  const root = finished([M2])
  assert.match(rail(root, 'status').out, /새 마일스톤 M2 이 있습니다/)
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
