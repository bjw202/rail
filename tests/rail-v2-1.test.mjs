// 레일 2.0판 뒤 더함(2026-11-24): 모든 마일스톤을 닫은 뒤(done) ROADMAP 에 새 마일스톤을 더하면 그 결정 단계로 갈 수 있다.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GOOD_ROADMAP, events, put, rail, state, tmp } from './helpers.mjs'

// M0·M1 을 모두 닫아 done 이 된 저장소.
function finished(roadmap = GOOD_ROADMAP) {
  const root = tmp()
  put(root, 'docs/ROADMAP.md', roadmap)
  put(root, 'docs/decisions/D-01.md', '# D-01\n상태: 결정됨\n선택: A\n')
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, step: null, gates: { scene_checked: {} }, closed: ['M0', 'M1'] }))
  return root
}
const M2 = '## M2 정리\n- 끝나는 장면: 미뤄 둔 지적이 고쳐져 보인다\n- 위험 질문: 없음\n- 예상 기간: 반나절\n'

test('남은 마일스톤이 없으면 done 에서 decide 로 가지 않는다', () => {
  const root = finished()
  const r = rail(root, 'check', 'decide', '--milestone', 'M2')
  assert.notEqual(r.code, 0)
  assert.match(r.err + r.out, /시작할 마일스톤이 남아 있지 않습니다/)
  assert.match(rail(root, 'status').out, /남은 일이 없습니다/)
})

test('ROADMAP 에 새 마일스톤을 더하면 done 에서 그 마일스톤의 decide 로 간다', () => {
  const root = finished(GOOD_ROADMAP + M2)
  assert.match(rail(root, 'status').out, /새 마일스톤 M2 이 있습니다/)
  const r = rail(root, 'advance', 'decide', '--milestone', 'M2')
  assert.equal(r.code, 0, r.err)
  const st = state(root)
  assert.equal(st.stage, 'decide')
  assert.equal(st.milestone, 'M2')
  assert.ok(events(root).some((e) => e.event === 'stage_advance' && e.from === 'done' && e.to === 'decide'))
})

test('done 에서도 닫히지 않은 다음 마일스톤만 고를 수 있다', () => {
  const root = finished(GOOD_ROADMAP + M2 + M2.replace('M2', 'M3'))
  const r = rail(root, 'check', 'decide', '--milestone', 'M3')
  assert.notEqual(r.code, 0)
  assert.match(r.err + r.out, /다음 마일스톤은 M2 입니다/)
})
