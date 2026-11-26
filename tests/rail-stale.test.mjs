// 낡은 시험 판정 시험: 판정 작업자(<step>-stale)의 .rail/stale/<step>.json 이 stale 줄을 낼 때만 다음 작업자 하나에
// RAIL_ALLOW_TEST_EDIT=1 을 붙이고, keep·없는 파일·깨진 파일·한도 넘음은 거절하며, 장면 질문이 목록을 싣고 닫기 관문이 그 답을 본다.
// 모두 임시 저장소와 가짜 Orca 에서 돌린다(이 저장소의 .rail/config.json 값을 단언하지 않는다).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { GOOD_ROADMAP, RAIL, events, put, state, tmp } from './helpers.mjs'

function run(root, args, extra = {}) {
  const env = { ...process.env, ...extra, RAIL_ROOT: root }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_ALLOW_TEST_EDIT']) delete env[k]
  if (!extra.ORCA_CLI_COMMAND) env.ORCA_CLI_COMMAND = '/nonexistent/orca'
  if (!extra.ORCA_TERMINAL_HANDLE) delete env.ORCA_TERMINAL_HANDLE
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, `${r.out}\n${r.err}`)

// 가짜 Orca: 창을 새 탭으로 열고(--command 를 남김) 일을 맡기고 끝났다고 답한다.
function fakeOrca(root) {
  const dir = path.join(root, 'fake')
  put(root, 'fake/orca.mjs', `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(dir)} + '/calls.jsonl', JSON.stringify(args) + '\\n')
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const [a, b] = args
if (a === 'terminal' && b === 'list') say({ ok: true, result: { terminals: [], visualLayouts: [] } })
else if (a === 'terminal' && b === 'create') say({ ok: true, result: { terminal: { handle: 'term_' + Math.random().toString(16).slice(2, 8) } } })
else if (a === 'terminal') say({ ok: true, result: {} })
else if (b === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + opt('--terminal').slice(5) } })
else if (b === 'worker-read') say({ ok: true, result: { report: '판정 끝' } })
else if (b === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else process.exit(2)
`)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  const commands = () =>
    (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
      .filter((c) => c[0] === 'terminal' && c[1] === 'create')
      .map((c) => c[c.indexOf('--command') + 1])
  return { env: { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs'), ORCA_TERMINAL_HANDLE: 'term_leader' }, commands }
}

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
function workerRoot(staleTests = 'agent') {
  const root = tmp('railstale-')
  put(root, '.rail/config.json', JSON.stringify({ commitPolicy: 'auto-local', staleTests }))
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 구현 | 합계 칸 바꾸기 | src/a.mjs | 없음 | 기준 | |\n`)
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
  for (const s of ['M0-1', 'M0-1-stale']) put(root, `.orchestration/${s}-spec.md`, `# ${s} 일\n\n할 일\n`)
  const orca = fakeOrca(root)
  ok(run(root, ['step-start', 'M0-1'], orca.env))
  return { root, orca }
}
const line = (file, n, verdict) => ({ file, line: n, verdict, pinned: `${file} ${n}줄 옛 값`, changed_by: verdict === 'stale' ? 'M0-1 할 일 "합계 칸 바꾸기"' : undefined, why: '한 줄' })
// 판정 작업자를 띄우고 판정 파일을 쓰고(text 가 null 이면 쓰지 않음) 닫는다.
function judge(root, orca, text) {
  ok(run(root, ['worker', 'start', 'M0-1-stale', '--agent', 'claude', '--role', 'stale'], orca.env))
  if (text !== null) put(root, '.rail/stale/M0-1.json', typeof text === 'string' ? text : JSON.stringify({ lines: text }))
  ok(run(root, ['worker', 'done', 'M0-1-stale'], orca.env))
}
const start = (root, orca) => run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'impl'], orca.env)
const ENV = 'RAIL_ALLOW_TEST_EDIT=1 '
const granted = (root) => events(root).filter((e) => e.event === 'worker_start' && e.step === 'M0-1' && e.test_edit)

describe('판정으로 시험 고치기 허락', () => {
  test('stale 줄이 있으면 다음 작업자 하나에만 붙이고, 기록과 명세에는 stale 줄만 남긴다', () => {
    const { root, orca } = workerRoot()
    judge(root, orca, [line('tests/a.test.mjs', 3, 'stale'), line('tests/b.test.mjs', 9, 'keep')])
    const r = start(root, orca)
    ok(r)
    assert.match(r.out, /판정으로 허락한 시험 고치기.*\.rail\/stale\/M0-1\.json/)
    const cmd = orca.commands().at(-1)
    assert.ok(cmd.startsWith(ENV), cmd)
    const [g] = granted(root)
    assert.equal(g.allowed_by, 'stale')
    assert.equal(g.stale_file, '.rail/stale/M0-1.json')
    assert.match(g.judged_by, /^ctx_/)
    assert.deepEqual(g.stale_lines.map((l) => `${l.file}:${l.line}`), ['tests/a.test.mjs:3'])
    const spec = readFileSync(path.join(root, '.orchestration/M0-1-spec.md'), 'utf8')
    assert.match(spec, /tests\/a\.test\.mjs:3/)
    assert.doesNotMatch(spec, /tests\/b\.test\.mjs:9/)
    // 같은 판정으로 다시 띄우면 붙이지 않는다.
    ok(run(root, ['worker', 'done', 'M0-1'], orca.env))
    ok(start(root, orca))
    assert.ok(!orca.commands().at(-1).includes('RAIL_ALLOW_TEST_EDIT'))
    assert.equal(granted(root).length, 1)
  })

  for (const [name, text, why] of [
    ['모두 keep', [line('tests/a.test.mjs', 3, 'keep')], /모두 keep/],
    ['판정 파일 없음', null, /없거나 꼴이 틀렸습니다/],
    ['깨진 판정 파일', '{"lines":[{"file":"tests/a.test.mjs"', /없거나 꼴이 틀렸습니다/],
    ['증거 없는 stale', [{ ...line('tests/a.test.mjs', 3, 'stale'), changed_by: '' }], /없거나 꼴이 틀렸습니다/]
  ]) {
    test(`${name}: 허락하지 않는다`, () => {
      const { root, orca } = workerRoot()
      judge(root, orca, text)
      const r = start(root, orca)
      ok(r)
      assert.match(r.out, why)
      assert.ok(!orca.commands().at(-1).includes('RAIL_ALLOW_TEST_EDIT'))
      assert.equal(granted(root).length, 0)
    })
  }

  test('한 마일스톤에서 판정으로 허락할 시험 파일이 5개를 넘으면 사람에게 묻게 하고, 사람 허락 길은 그대로다', () => {
    const { root, orca } = workerRoot()
    judge(root, orca, [1, 2, 3, 4, 5, 6].map((i) => line(`tests/f${i}.test.mjs`, i, 'stale')))
    const r = start(root, orca)
    assert.match(r.out, /한도 5개를 넘습니다.*사람에게 묻습니다/)
    assert.equal(granted(root).length, 0)
    ok(run(root, ['worker', 'done', 'M0-1'], orca.env))
    ok(run(root, ['ask', 'M0-1 에서 시험 고치기를 허락할까요?', '--kind', 'approve'], orca.env))
    ok(run(root, ['answer', '허락'], orca.env))
    ok(start(root, orca))
    assert.equal(granted(root)[0].allowed_by, 'human')
  })

  test('staleTests 가 human 이면 판정 파일을 보지 않는다', () => {
    const { root, orca } = workerRoot('human')
    judge(root, orca, [line('tests/a.test.mjs', 3, 'stale')])
    const r = start(root, orca)
    ok(r)
    assert.doesNotMatch(r.out, /판정/)
    assert.ok(!orca.commands().at(-1).includes('RAIL_ALLOW_TEST_EDIT'))
  })
})

// 장면 확인 단계: 판정으로 허락한 worker_start 기록이 하나 있는 저장소(git 저장소가 아니라 커밋은 "없음").
function checkRoot(withStale = true) {
  const root = tmp('railstalec-')
  put(root, '.rail/config.json', JSON.stringify({ staleTests: 'agent' }))
  put(root, 'docs/ROADMAP.md', GOOD_ROADMAP)
  put(root, 'docs/plan/M0.md', `${HEAD}| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | ✅ 끝(2026-11-25) 됨 |\n`)
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  const ev = { t: '2026-11-25T00:00:00.000Z', event: 'worker_start', stage: 'milestone', milestone: 'M0', step: 'M0-1', test_edit: true, allowed_by: 'stale', stale_file: '.rail/stale/M0-1.json', stale_lines: [{ file: 'tests/a.test.mjs', line: 3, pinned: '합계 $3.20', changed_by: 'M0-1 할 일 "합계 칸 바꾸기"' }] }
  if (withStale) put(root, '.rail/log.jsonl', JSON.stringify(ev) + '\n')
  return root
}

describe('사람은 마일스톤 끝에 한 번', () => {
  test('장면 질문에 목록이 실리고, "됨"이면 목록도 승인으로 남아 닫힌다', () => {
    const root = checkRoot()
    const q = run(root, ['ask', '--scene'])
    ok(q)
    assert.match(q.out, /에이전트 판정으로 고친 시험 1건/)
    assert.match(q.out, /tests\/a\.test\.mjs:3 — M0-1 할 일 "합계 칸 바꾸기" 로 바뀐 동작\(옛 값: 합계 \$3\.20\) · M0-1, 커밋 /)
    ok(run(root, ['answer', '됨. 본 것: 합계 $3.40']))
    assert.equal(state(root).gates.scene_checked.M0.stale, 1)
    const ap = events(root).find((e) => e.event === 'stale_approved')
    assert.deepEqual(ap.lines, [{ file: 'tests/a.test.mjs', line: 3, step: 'M0-1' }])
    ok(run(root, ['advance', 'close']))
  })

  test('"안 됨"이면 승인으로 남기지 않는다', () => {
    const root = checkRoot()
    ok(run(root, ['ask', '--scene']))
    ok(run(root, ['answer', '안 됨. 본 것: a.test 3줄은 버그를 덮었다']))
    assert.ok(!events(root).some((e) => e.event === 'stale_approved'))
    assert.notEqual(run(root, ['advance', 'close']).code, 0)
  })

  test('목록을 보인 장면 질문 없이(scene 명령) 닫으려 하면 거절한다', () => {
    const root = checkRoot()
    ok(run(root, ['scene', 'M0', '--result', 'pass', '--note', '봤다']))
    const r = run(root, ['advance', 'close'])
    assert.notEqual(r.code, 0)
    assert.match(r.out + r.err, /판정으로 고친 시험 1건을 보인 장면 질문/)
  })

  test('판정으로 고친 시험이 없으면 장면 질문과 닫기는 예전 그대로다', () => {
    const root = checkRoot(false)
    const q = run(root, ['ask', '--scene'])
    assert.doesNotMatch(q.out, /판정으로 고친 시험/)
    ok(run(root, ['answer', '됨. 본 것: 합계']))
    ok(run(root, ['advance', 'close']))
  })

  test('마지막 리뷰 안내에 목록이 실린다', () => {
    const root = checkRoot()
    const s = JSON.parse(readFileSync(path.join(root, '.rail/state.json'), 'utf8'))
    put(root, '.rail/state.json', JSON.stringify({ ...s, stage: 'milestone' }))
    put(root, 'docs/plan/M0.md', `${HEAD}| M0-1 | 구현 | 가 | src/a.mjs | 없음 | 기준 | ✅ 끝(2026-11-25) 됨 |\n| M0-2 | 마지막 리뷰 | 리뷰 | .rail/review/ | | 기준 | |\n`)
    const r = run(root, ['status'])
    ok(r)
    assert.match(r.out, /판정으로 고친 시험 1건.*느슨하게/s)
    assert.match(r.out, /tests\/a\.test\.mjs:3/)
  })
})
