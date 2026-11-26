// 레일 2.9판 덜어내기 둘째(M12 뒤): 관문은 순서만 본다. 지운 내용 검사가 다시 생기지 않는지, 남긴 검사가 그대로인지 본다.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다. 설정은 모두 임시 저장소에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { DECIDED, GOOD_ROADMAP, RAIL, events, git, put, runHook, state, tmp } from './helpers.mjs'

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

function root(st = {}, rows = null) {
  const dir = tmp('rail29b-')
  put(dir, '.rail/config.json', JSON.stringify(CONFIG))
  put(dir, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'brief', milestone: null, step: null, closed: [], ...st, gates: { scene_checked: {}, rehearsed: {}, ...(st.gates ?? {}) } }))
  if (rows) put(dir, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}\n`)
  return dir
}
const MS = { stage: 'milestone', milestone: 'M0' }

describe('단계 관문은 순서만 본다', () => {
  test('브리프·로드맵 형식, 승인 날짜, 위험 질문 결정, 다음 마일스톤 표를 보지 않고, 건너뛰기만 막는다', () => {
    const r = root()
    blocked(run(r, ['advance', 'decide', '--milestone', 'M0']), /"brief" 단계라 "decide" 로 갈 수 없습니다/)
    ok(run(r, ['advance', 'roadmap']))
    assert.equal(state(r).gates.brief_approved, null, '브리프가 없으면 승인 날짜도 없다')
    blocked(run(r, ['advance', 'decide', '--milestone', 'M0']), /ROADMAP\.md 가 없어 다음 마일스톤을 알 수 없습니다/)
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP.replace('승인: 2026-11-24\n', '').replace('M0 뼈대', 'M0 기초'))
    blocked(run(r, ['advance', 'decide']), /--milestone Mx 를 붙이세요/)
    blocked(run(r, ['advance', 'decide', '--milestone', 'M1']), /다음 마일스톤은 M0 입니다/)
    ok(run(r, ['advance', 'decide', '--milestone', 'M0']))
    put(r, 'docs/plan/M1.md', `${HEAD}| M1-1 | 기능 | 가 | src/a.mjs | 없음 | 보인다 | |\n`)
    blocked(run(r, ['advance', 'milestone', '--milestone', 'M1']), /지금 시작 전 마일스톤은 M0 입니다/)
    ok(run(r, ['advance', 'milestone']))
    assert.equal(state(r).stage, 'milestone')
    ok(run(r, ['advance', 'check']))
    const ev = events(r).filter((e) => ['gate_passed', 'gate_blocked'].includes(e.event)).map((e) => `${e.event}:${e.target}`)
    assert.deepEqual(ev.filter((x) => x.startsWith('gate_blocked')).length, 5, '막힘도 그대로 기록한다')
  })

  test('남은 마일스톤이 없으면 decide 로 가지 않는다', () => {
    const r = root({ stage: 'done', closed: ['M0', 'M1'] })
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP)
    blocked(run(r, ['check', 'decide', '--milestone', 'M2']), /시작할 마일스톤이 남아 있지 않습니다/)
  })

  test('장면 관문은 그대로: 모든 step ✅ 와 사람 장면 판정이 있어야 닫는다', () => {
    const r = root({ stage: 'check', milestone: 'M0' }, ['| M0-1 | 기능 | 가 | src/a.mjs | 없음 | 보인다 | |'])
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP)
    const c = run(r, ['advance', 'close'])
    blocked(c, /아직 끝나지 않은 step: M0-1/)
    assert.match(c.err, /사람 장면 확인 기록이 없습니다/)
  })
})

describe('step 시작·끝은 표에 있고 안 끝났는지만 본다', () => {
  test('기다리는 step 이 안 끝나도, 칸이 넘쳐도 시작하고 끝낸다', () => {
    const r = root(MS, ['| M0-1 | 구현 | 가 | src/** | 없음 | 기준 | |', '| M0-2 | 구현 | 나 | docs/a.md | M0-1 | 기준 | |', '| M0-3 | 구현 | 다 | src/b.mjs | M0-9 | 기준 | | 넘침 |'])
    ok(run(r, ['step-start', 'M0-1']))
    ok(run(r, ['step-start', 'M0-2']))
    ok(run(r, ['step-done', 'M0-2', '--note', '됨']))
    assert.ok(events(r).some((e) => e.event === 'gate_passed' && e.target === 'step-start'))
  })

  test('표에 없는 step, 이미 끝난 step, 저장소에 없는 커밋은 거절한다', () => {
    const r = root(MS, ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | |'])
    blocked(run(r, ['step-start', 'M0-9']), /M0-9 줄이 없습니다/)
    ok(run(r, ['step-done', 'M0-1', '--note', '됨']))
    blocked(run(r, ['step-start', 'M0-1']), /이미 끝났습니다/)
    const g = root(MS, ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | |'])
    git(g, 'init', '-q')
    blocked(run(g, ['step-done', 'M0-1', '--note', '됨', '--commit', '0000000']), /커밋 0000000 이 이 저장소에 없습니다/)
  })
})

describe('지운 것', () => {
  test('validate 명령이 없고, 마무리 검사 훅은 칸이 넘친 표를 붙잡지 않는다', () => {
    const r = root(MS, ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | | 넘침 |'])
    assert.equal(run(r, ['validate']).code, 2)
    git(r, 'init', '-q')
    const h = runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: r, stop_hook_active: false }, {})
    assert.equal(h.code, 0, h.stderr)
    assert.doesNotMatch(h.stderr, /계획 표 검사/)
  })

  test('시제품 카드여도 결정 질문을 막지 않는다', () => {
    const r = root({ stage: 'decide', milestone: 'M0' })
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP.replace('- 위험 질문: D-01', '- 위험 질문: D-09'))
    put(r, 'docs/decisions/D-09-cards.md', '# D-09 카드 배치\n상태: 제안\n마일스톤: M0\n시제품: 예\n## 질문\n어느 배치?\n## 변주\n- p1-grid: 격자\n- p2-big: 큰 카드\n## 스크린샷\n- d-1124.png: 2026-11-24, 폭 1280\n')
    ok(run(r, ['ask', 'D-09 는 A/B 중 무엇으로 할까요?', '--kind', 'decide']))
    assert.ok(!events(r).some((e) => e.target === 'proto'))
  })

  test('부품 목록에서 빠졌고, 단계 순서 검사는 끌 수 없다', () => {
    const r = root(MS)
    const ids = JSON.parse(run(r, ['usage', '--json']).out).parts.map((p) => p.id)
    for (const gone of ['gate:step-start', 'validate', 'proto']) assert.ok(!ids.includes(gone), gone)
    for (const kept of ['gate:order', 'gate:close', 'stop-check', 'guard-tests', 'verify', 'rehearsal', 'feature-check']) assert.ok(ids.includes(kept), kept)
    blocked(run(r, ['policy', 'set', 'disable', 'gate:order', '--said', '꺼 봐']), /끌 것이 없습니다/)
    assert.equal(events(r).at(-1).why, 'fixed')
    put(r, '.rail/config.json', JSON.stringify({ ...CONFIG, disabled: ['gate:order'] }))
    assert.deepEqual(JSON.parse(run(r, ['status', '--json']).out).disabled, [], 'config 에 손으로 적어도 끄지 않는다')
  })

  test('예전 표 검사가 붙잡은 기록은 마무리 검사의 막음으로 세지 않는다', () => {
    const r = root({ stage: 'done', closed: ['M0'] })
    const line = (event, data) => JSON.stringify({ t: '2026-11-24T00:00:00Z', event, stage: 'milestone', milestone: 'M0', ...data })
    put(r, '.rail/log.jsonl', [line('gate_passed', { target: 'step-start' }), line('hook_held', { hook: 'stop-check', reason: '계획 표 검사(`node .rail/bin/rail.mjs validate`)' }), line('milestone_closed', {})].join('\n') + '\n')
    const u = JSON.parse(run(r, ['usage', '--json']).out)
    assert.equal(u.parts.find((p) => p.id === 'stop-check').by.M0.blocked, 0)
  })
})

describe('남긴 것: 검증기는 장면 질문 앞에서 본다', () => {
  test('관문 check 는 검증기를 보지 않지만, 검증기가 실패하면 장면 판정을 기록하지 않는다', () => {
    const r = root(MS, ['| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | |'])
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP)
    put(r, '.rail/config.json', JSON.stringify({ ...CONFIG, verify: [{ name: 'bad', command: `"${process.execPath}" -e "process.exit(1)"` }] }))
    ok(run(r, ['step-done', 'M0-1', '--note', '됨']))
    assert.match(JSON.parse(run(r, ['status', '--json']).out).next, /먼저 바깥 정답 검증기/)
    ok(run(r, ['advance', 'check']))
    assert.equal(run(r, ['verify']).code, 1)
    blocked(run(r, ['scene', 'M0', '--result', 'pass', '--note', '봤다']), /검증기 bad 이\(가\) 실패했습니다/)
    assert.equal(state(r).gates.scene_checked.M0, undefined)
  })
})

describe('다음 할 일 문장은 지운 명령을 시키지 않는다', () => {
  test('step 표를 만들 때와 고칠 줄을 더할 때 validate 를 부르라고 하지 않는다', () => {
    const r = root({ ...MS, stage: 'milestone' })
    put(r, 'docs/ROADMAP.md', GOOD_ROADMAP)
    put(r, 'docs/decisions/D-01.md', DECIDED)
    const next = JSON.parse(run(r, ['status', '--json']).out).next
    assert.match(next, /step 표 만들기/)
    assert.doesNotMatch(next, /validate/)
  })
})
