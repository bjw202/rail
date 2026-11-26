// 레일 2.6판(빼기 판) 시험: 닫기 관문이 "다시 잰 예상" 줄을 요구하지 않음, 장면 답 앞뒤 따옴표 걷기,
// 사람이 step 이름을 넣은 질문에 시험 고치기를 허락하면 worker start 가 그 작업자 하나의 명령 앞에 RAIL_ALLOW_TEST_EDIT=1 을 붙임.
// 모두 임시 저장소에서 돌린다(이 저장소의 .rail/config.json 값을 단언하지 않는다).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { DECIDED, GOOD_ROADMAP, RAIL, events, put, state, tmp } from './helpers.mjs'

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_ALLOW_TEST_EDIT']) if (!(k in extra)) delete env[k]
  if (!('ORCA_CLI_COMMAND' in extra)) env.ORCA_CLI_COMMAND = '/nonexistent/orca'
  return env
}
function run(root, args, env = {}) {
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...cleanEnv(env), RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, `${r.out}\n${r.err}`)

// 닫기 직전(check 단계, 장면 확인 pass, step 모두 ✅)인 저장소. ROADMAP 에 "다시 잰 예상" 절이 없다.
function closeRoot() {
  const root = tmp('rail26c-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.6' }))
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  put(root, 'docs/decisions/D-01.md', DECIDED)
  put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | 가 | src/a.mjs | 기준 | ✅ 끝(2026-11-24) 됨 |\n')
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { scene_checked: { M0: { result: 'pass', note: '봤다' } }, rehearsed: {} } }))
  return root
}

describe('닫기 관문: 다시 잰 예상', () => {
  test('ROADMAP 에 "- M0 끝:" 줄이 없어도 닫히고, status 도 그 줄을 쓰라고 하지 않는다', () => {
    const root = closeRoot()
    const s = run(root, ['status'])
    ok(s)
    assert.doesNotMatch(s.out, /다시 재|다시 잰/)
    assert.match(s.out, /advance close/)
    ok(run(root, ['check', 'close']))
    ok(run(root, ['advance', 'close']))
    assert.deepEqual(state(root).closed, ['M0'])
  })

  test('로드맵 꼴 안내에 "다시 잰 예상" 절이 없다', () => {
    const root = tmp('rail26r-')
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'roadmap', milestone: null, step: null, closed: [], gates: { scene_checked: {} } }))
    const s = run(root, ['status'])
    ok(s)
    assert.match(s.out, /ROADMAP\.md 꼴/)
    assert.doesNotMatch(s.out, /다시 잰 예상/)
  })
})

// 장면 질문이 열린 check 단계 저장소(1.x판처럼 리허설·검증기 요구 없이 판정만 본다).
function sceneRoot() {
  const root = tmp('rail26s-')
  put(root, '.rail/config.json', '{}')
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  put(root, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 구현 | 가 | src/a.mjs | 기준 | ✅ 끝(2026-11-24) 됨 |\n')
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  ok(run(root, ['ask', '--scene']))
  return root
}

describe('장면 답 앞뒤 따옴표', () => {
  for (const [name, text, result, note] of [
    ['큰따옴표째 붙여 넣은 답', '"됨. 본 것: 합계 $3.20"', 'pass', '합계 $3.20'],
    ['앞에만 큰따옴표', '"됨. 본 것: 합계 $3.20', 'pass', '합계 $3.20'],
    ['둥근 큰따옴표', '“됨. 본 것: 합계 $3.20”', 'pass', '합계 $3.20'],
    ['홑따옴표와 안 됨', "'안 됨. 본 것: 빈 화면'", 'fail', '빈 화면'],
    ['둥근 홑따옴표', '‘됨. 본 것: 7일 막대’', 'pass', '7일 막대'],
    ['본 것 안의 따옴표는 남긴다', '됨. 본 것: 제목 "주간 비용"', 'pass', '제목 "주간 비용"']
  ]) {
    test(`${name}: 되묻지 않고 판정을 읽는다`, () => {
      const root = sceneRoot()
      const r = run(root, ['answer', text])
      ok(r)
      assert.doesNotMatch(r.out, /다시 묻기/)
      const sc = state(root).gates.scene_checked.M0
      assert.deepEqual([sc.result, sc.note], [result, note])
    })
  }
})

// 가짜 Orca CLI: 부른 인자를 calls.jsonl 에 남기고 창 나누기·일 맡기기·결과 읽기·닫기에 답한다.
function fakeOrca(root) {
  const dir = path.join(root, 'fake')
  put(root, 'fake/layout.json', JSON.stringify({ type: 'terminal', handle: 'term_leader', title: '리더' }))
  const body = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const dir = ${JSON.stringify(dir)}
const args = process.argv.slice(2)
appendFileSync(dir + '/calls.jsonl', JSON.stringify(args) + '\\n')
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const layout = () => JSON.parse(readFileSync(dir + '/layout.json', 'utf8'))
const save = (t) => writeFileSync(dir + '/layout.json', JSON.stringify(t))
const [a, b] = args
if (a === 'terminal' && b === 'list') say({ ok: true, result: { terminals: [], visualLayouts: [{ root: { type: 'group', tabs: [{ tabId: 'tab1', panes: layout() }] } }] } })
else if (a === 'terminal' && b === 'split') {
  const h = 'term_w' + Math.random().toString(16).slice(2, 8)
  const put = (n) => (n.handle === opt('--terminal') ? { type: 'pane-split', direction: opt('--direction'), first: n, second: { type: 'terminal', handle: h, title: '' } } : n.first ? { ...n, first: put(n.first), second: put(n.second) } : n)
  save(put(layout()))
  say({ ok: true, result: { split: { handle: h, tabId: 'tab1', leafId: 'leaf' } } })
} else if (a === 'terminal' && b === 'close') {
  const drop = (n) => (n.first ? (n.first.handle === opt('--terminal') ? n.second : n.second.handle === opt('--terminal') ? n.first : { ...n, first: drop(n.first), second: drop(n.second) }) : n)
  save(drop(layout()))
  say({ ok: true, result: { close: { handle: opt('--terminal') } } })
} else if (a === 'terminal') say({ ok: true, result: { wait: { satisfied: true } } })
else if (a === 'orchestration' && b === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + opt('--terminal').slice(5), terminal: opt('--terminal') } })
else if (a === 'orchestration' && b === 'worker-read') say({ ok: true, result: { report: '한 줄 고침' } })
else if (a === 'orchestration' && b === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else { process.stderr.write('알 수 없는 명령'); process.exit(2) }
`
  put(root, 'fake/orca.mjs', body)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  const calls = () => (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  const commands = () => calls().filter((c) => c[0] === 'terminal' && c[1] === 'split').map((c) => c[c.indexOf('--command') + 1])
  return { env: { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs'), ORCA_TERMINAL_HANDLE: 'term_leader' }, commands }
}
function workerRoot() {
  const root = tmp('rail26w-')
  put(root, '.rail/config.json', JSON.stringify({ commitPolicy: 'auto-local' }))
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 시험 | 시험 한 줄 | tests/m0-a.test.mjs | 없음 | 기준 | |\n| M0-2 | 시험 | 다른 시험 | tests/m0-b.test.mjs | 없음 | 기준 | |\n`)
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
  for (const s of ['M0-1', 'M0-2']) put(root, `.orchestration/${s}-spec.md`, `# ${s} 시험 고치기\n\n할 일\n`)
  const orca = fakeOrca(root)
  ok(run(root, ['step-start', 'M0-1'], orca.env))
  ok(run(root, ['step-start', 'M0-2'], orca.env))
  return { root, orca }
}
const askAnswer = (root, env, q, a) => {
  ok(run(root, ['ask', q, '--kind', 'approve'], env))
  ok(run(root, ['answer', a], env))
}
const ENV = 'RAIL_ALLOW_TEST_EDIT=1 '

describe('사람이 허락한 시험 고치기 작업자', () => {
  test('step 이름을 넣은 질문에 허락하면 그 step 의 작업자 명령 앞에만 env 를 붙이고, 허락 한 번에 작업자 하나다', () => {
    const { root, orca } = workerRoot()
    askAnswer(root, orca.env, 'M0-1 의 잠긴 시험 한 줄을 고치도록 시험 고치기(RAIL_ALLOW_TEST_EDIT=1)를 허락할까요?', '"허락"')
    const r = run(root, ['worker', 'start', 'M0-1', 'M0-2', '--agent', 'claude', '--role', 'test'], orca.env)
    ok(r)
    assert.match(r.out, /M0-1 시작 .*사람이 허락한 시험 고치기/)
    const [c1, c2] = orca.commands()
    assert.ok(c1.startsWith(`${ENV}claude --model opus`), c1)
    assert.ok(!c2.includes('RAIL_ALLOW_TEST_EDIT'), c2)
    const starts = events(root).filter((e) => e.event === 'worker_start')
    assert.deepEqual(starts.map((e) => [e.step, e.test_edit ?? false]), [['M0-1', true], ['M0-2', false]])
    // 같은 허락으로 다시 띄우면 env 를 붙이지 않는다.
    ok(run(root, ['worker', 'done', 'M0-1', '--note', '고침'], orca.env))
    ok(run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'test'], orca.env))
    assert.ok(!orca.commands()[2].includes('RAIL_ALLOW_TEST_EDIT'))
  })

  test('허락하지 않았거나 질문에 step 이름이 없거나 시험 고치기 질문이 아니면 붙이지 않는다', () => {
    for (const [q, a] of [
      ['M0-1 의 시험 고치기를 허락할까요? (허락 / 다른 방법)', '다른 방법'],
      ['M0-1 의 시험 고치기를 허락할까요?', '아니, 구현을 고쳐'],
      ['잠긴 시험 한 줄을 시험 고치기 작업자로 고쳐도 될까요?', '고쳐'],
      ['M0-1 을 다시 시작할까요?', '진행해']
    ]) {
      const { root, orca } = workerRoot()
      askAnswer(root, orca.env, q, a)
      ok(run(root, ['worker', 'start', 'M0-1', '--agent', 'codex', '--role', 'test'], orca.env))
      assert.ok(!orca.commands()[0].includes('RAIL_ALLOW_TEST_EDIT'), `${q} / ${a}`)
      assert.ok(!events(root).some((e) => e.event === 'worker_start' && e.test_edit))
    }
  })

  test('Codex 작업자에도 같은 자리에 붙인다', () => {
    const { root, orca } = workerRoot()
    askAnswer(root, orca.env, 'M0-2 에서 시험 고치기를 허락할까요?', '진행해')
    ok(run(root, ['worker', 'start', 'M0-2', '--agent', 'codex', '--role', 'test'], orca.env))
    assert.ok(orca.commands()[0].startsWith(`${ENV}codex --dangerously-bypass-approvals-and-sandbox`))
  })
})
