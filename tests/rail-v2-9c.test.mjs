// 레일 2.9판 고침(2.9c): 빈 step 표를 "모두 끝남"으로 읽지 않는지 본다. 2.9c 에서 되살린 step-start 의 파일 겹침 거절은 M14 뒤에 다시 지웠다.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다. 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { GOOD_ROADMAP, RAIL, events, put, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const CONFIG = { railVersion: '2.9', commitPolicy: 'auto-local', autonomy: { mode: 'off' } }

function run(root, args) {
  const env = { ...process.env, ORCA_CLI_COMMAND: '/nonexistent/orca', RAIL_ROOT: root }
  for (const k of ['NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH']) delete env[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const blocked = (r, re) => (assert.equal(r.code, 1, r.out), assert.match(r.err, re))

function root(rows, config = CONFIG) {
  const dir = tmp('rail29c-')
  put(dir, '.rail/config.json', JSON.stringify(config))
  put(dir, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  put(dir, 'docs/ROADMAP.md', GOOD_ROADMAP)
  if (rows) put(dir, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}${rows.length ? '\n' : ''}`)
  return dir
}

describe('step-start 는 파일 겹침을 보지 않는다 (M14 뒤 덜어내기)', () => {
  test('진행 중인 step 과 "고쳐도 되는 파일"이 겹쳐도 시작하고 gate_blocked 를 남기지 않는다', () => {
    const r = root([
      '| M0-1 | 기능 | 가 | src/timeline/activity.mjs | 없음 | 보인다 | |',
      '| M0-2 | 기능 | 나 | src/timeline/ | 없음 | 보인다 | |'
    ])
    ok(run(r, ['step-start', 'M0-1']))
    ok(run(r, ['step-start', 'M0-2']))
    assert.ok(!events(r).some((e) => e.event === 'gate_blocked'))
    assert.deepEqual(events(r).filter((e) => e.event === 'step_start').map((e) => e.step), ['M0-1', 'M0-2'])
  })

  test('기다리는 step 은 되살리지 않는다: 앞 step 이 안 끝나도 파일이 안 겹치면 시작한다', () => {
    const r = root(['| M0-1 | 기능 | 가 | src/a.mjs | | 보인다 | |', '| M0-2 | 기능 | 나 | src/b.mjs | | 보인다 | |'])
    ok(run(r, ['step-start', 'M0-2']))
  })
})

describe('빈 step 표', () => {
  for (const [name, rows, word] of [
    ['머리줄만 있는 표', [], '채우기'],
    ['표가 없음', null, '만들기']
  ])
    test(`${name}: 다음 할 일은 "step 표" 안내이고 "모두 끝났습니다"가 아니다`, () => {
      const r = root(rows)
      const s = run(r, ['status'])
      ok(s)
      assert.match(s.out, new RegExp(`M0 step 표 ${word} — docs/plan/M0\\.md`))
      assert.doesNotMatch(s.out, /step 이 모두 끝났습니다/)
    })

  test('머리줄만 있는 표면 advance check 가 넘기지 않는다', () => {
    const r = root([])
    blocked(run(r, ['advance', 'check']), /docs\/plan\/M0\.md 에 step 줄이 없습니다/)
    assert.equal(state(r).stage, 'milestone')
    assert.equal(events(r).filter((e) => e.event === 'gate_blocked' && e.target === 'check').length, 1)
  })

  test('step 줄이 있으면 advance check 는 그대로 넘긴다', () => {
    const r = root(['| M0-1 | 기능 | 가 | src/a.mjs | 없음 | 보인다 | ✅ 끝(2026-11-25) 됨 |'])
    ok(run(r, ['advance', 'check']))
    assert.equal(state(r).stage, 'check')
  })
})
