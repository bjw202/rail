// 레일 61 시험: ① 빼기 후보 — 기능 확인은 막지 않아도 확인 기록에 must 가 있었으면 일한 것, ② 허락 답 넓히기 — "맞음"과
// "시험 고치"가 적힌 보기의 기호(A 등) 답, ③ 이번 마일스톤에 생긴 시험을 must 가 가리키면 고침 작업자 하나에 묻지 않고 허락,
// ④ 닫기 안내의 크기 줄(막지 않음)과 결정 접기·CLAUDE.md 지침.
// 모두 임시 저장소에서 돌린다(이 저장소의 .rail/config.json 값을 단언하지 않는다).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, test } from 'node:test'
import { RAIL, TEST_EDIT_ENV, events, git, planDoc, put, tmp } from './helpers.mjs'

const LIB = path.join(path.dirname(RAIL), 'lib')
function run(root, args, extra = {}) {
  const env = { ...process.env, ...extra, RAIL_ROOT: root }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_ALLOW_TEST_EDIT']) delete env[k]
  if (!extra.ORCA_CLI_COMMAND) env.ORCA_CLI_COMMAND = '/nonexistent/orca'
  if (!extra.ORCA_TERMINAL_HANDLE) delete env.ORCA_TERMINAL_HANDLE
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, `${r.out}\n${r.err}`)
// 레일 모듈 함수를 그 저장소(RAIL_ROOT)에서 부른 값.
function call(root, mod, expr) {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(path.join(LIB, mod)).href)}); const st = JSON.parse((await import('node:fs')).readFileSync(${JSON.stringify(path.join(root, '.rail/state.json'))}, 'utf8')); process.stdout.write(JSON.stringify(${expr}) ?? 'null')`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, RAIL_ROOT: root } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const T = (n) => new Date(Date.UTC(2026, 10, 26, 0, n)).toISOString()
const ev = (n, event, milestone, data = {}) => JSON.stringify({ t: T(n), event, stage: 'milestone', milestone, ...data })

describe('① 빼기 후보: 기능 확인의 must', () => {
  // hbo-tube M4~M6 과 같은 꼴: 마일스톤마다 기능 확인 관문은 통과만(gate_blocked 0), 확인 기록의 must 는 1·1·4.
  function root(withChecks) {
    const lines = []
    let n = 10
    for (const m of ['M4', 'M5', 'M6'])
      lines.push(ev(n++, 'gate_passed', m, { target: 'feature-check', step: `${m}-1` }), ev(n++, 'verify_run', m, { ok: true }), ev(n++, 'gate_passed', m, { target: 'scene' }), ev(n++, 'milestone_closed', m))
    const r = tmp('rail61u-')
    put(r, '.rail/config.json', '{}')
    put(r, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'done', milestone: null, closed: ['M4', 'M5', 'M6'] }))
    put(r, '.rail/log.jsonl', lines.join('\n') + '\n')
    const must = (k) => JSON.stringify({ must: Array.from({ length: k }, (_, i) => ({ what: `결함 ${i}`, repro: 'x' })), nice: [] })
    if (withChecks) for (const [f, k] of [['M4-1', 1], ['M4-2', 0], ['M5-3', 1], ['M6-1', 1], ['M6-2', 1], ['M6-4', 1], ['M6-5', 1], ['M6-7', 0], ['M60-1', 0]]) put(r, `.rail/check/${f}.json`, must(k))
    if (withChecks) put(r, '.rail/check/M5-9.json', '{깨진 파일')
    return r
  }
  test('막은 일이 없어도 must 를 찾은 마일스톤이 있으면 후보가 아니고, 칸에 "찾음n" 이 보인다', () => {
    const r = root(true)
    const u = JSON.parse(run(r, ['usage', '--json']).out)
    assert.ok(!u.candidates.list.includes('feature-check'), u.candidates.list.join(','))
    const fc = u.parts.find((p) => p.id === 'feature-check')
    assert.deepEqual(['M4', 'M5', 'M6'].map((m) => [fc.by[m].blocked, fc.by[m].found]), [[0, 1], [0, 1], [0, 4]])
    assert.match(run(r, ['usage']).out, /feature-check\s+1\/0 찾음1\s+1\/0 찾음1\s+1\/0 찾음4/)
  })
  test('확인 기록이 없거나 must 가 모두 0 이면 예전처럼 후보다', () => {
    assert.ok(JSON.parse(run(root(false), ['usage', '--json']).out).candidates.list.includes('feature-check'))
  })
})

describe('② 허락 답 넓히기', () => {
  // M5 기획을 마치고 M5-2 를 하는 중인 저장소. 질문과 답 하나를 사건 기록에 남긴다.
  function asked(q, a) {
    const r = tmp('rail61a-')
    put(r, '.rail/config.json', '{}')
    put(r, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M5', step: 'M5-2', closed: [], gates: { scene_checked: {} } }))
    put(r, '.rail/log.jsonl', [ev(1, 'human_ask', 'M5', { q, kind: 'approve' }), ev(2, 'human_answer', 'M5', { q, kind: 'approve', text: a })].join('\n') + '\n')
    return call(r, 'workers.mjs', "m.testEditGrant(st, 'M5-2')")
  }
  // hbo-tube 기록 609·624줄과 같은 꼴: 시험 고치기를 묻는 질문에 사람이 보기 기호 "A" 로 답함. 보기를 질문에 적었다.
  const Q = 'M5-2 에서 시험 고치기를 두 곳 더 허락할까요? A 시험 고치기 허락(tests/transcript-peek.test.mjs 164줄을 새 규칙으로) / B 시험은 그대로 두고 코드 기본값을 엄격하게'
  test('"시험 고치"가 적힌 보기의 기호로 답하면 허락이다', () => {
    for (const a of ['A', 'a', '"A"', 'A로 해 주세요', 'A)']) assert.equal(asked(Q, a)?.by, 'human', a)
  })
  test('"맞음" 도 허락이다', () => {
    assert.equal(asked('M5-2 에서 시험 고치기를 허락할까요? (맞음 / 다른 방법)', '맞음')?.by, 'human')
  })
  test('그 말이 없는 보기의 기호, 거절 섞인 답, step 이름 없는 질문은 허락이 아니다', () => {
    assert.equal(asked(Q, 'B'), null)
    assert.equal(asked(Q, 'A 말고 B'), null)
    assert.equal(asked('M5-2 에서 시험 고치기를 허락할까요? (A 새 규칙으로 코드만 / B 옛 규칙 그대로)', 'A'), null)
    assert.equal(asked('잠긴 시험 고치기를 허락할까요? A 시험 고치기 허락 / B 그대로', 'A'), null)
    assert.equal(asked('M5-2 의 화면을 바꿀까요? A 바꾼다 / B 그대로', 'A'), null)
  })
})

describe('③ 이번 마일스톤에 생긴 시험을 must 가 가리키면 고침 작업자에 묻지 않고 허락', () => {
  const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
  // M2 를 2025-06-01 에 시작한 git 저장소. old 시험은 그 전(M1)에, new 시험은 지금 커밋했다.
  function repo(must) {
    const r = tmp('rail61n-')
    git(r, 'init', '-q')
    git(r, 'config', 'user.email', 't@t'), git(r, 'config', 'user.name', 't')
    put(r, 'tests/old.test.mjs', 'old\n')
    git(r, 'add', '.')
    spawnSync('git', ['commit', '-qm', 'M1'], { cwd: r, env: { ...process.env, GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z' } })
    put(r, 'tests/new.test.mjs', 'new\n')
    git(r, 'add', '.')
    git(r, 'commit', '-qm', 'M2-1')
    put(r, '.rail/config.json', JSON.stringify({ commitPolicy: 'auto-local' }))
    put(r, 'docs/plan/M2.md', `# M2\n\n${HEAD}| M2-1 | 기능 | 인사 | src/a.mjs, tests/new.test.mjs | 없음 | 기준 | ⏳ 진행 중 |\n`)
    put(r, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M2', step: 'M2-1', closed: ['M0', 'M1'], gates: { scene_checked: {} } }))
    put(r, '.rail/log.jsonl', JSON.stringify({ t: '2025-06-01T00:00:00.000Z', event: 'stage_advance', stage: 'milestone', milestone: 'M2', from: 'decide', to: 'milestone' }) + '\n')
    put(r, '.rail/check/M2-1.json', JSON.stringify({ must, nice: [] }))
    put(r, '.orchestration/M2-1-fix-spec.md', '# M2-1-fix 고침\n\n할 일\n')
    return r
  }
  const grant = (r, step = 'M2-1-fix') => call(r, 'workers.mjs', `m.testEditGrant(st, '${step}')`)
  const NEW = [{ what: 'tests/new.test.mjs 20줄이 빈 이름에 "안녕, " 을 못박음(버그)', repro: '.rail/check/M2-1/empty.test.mjs' }]
  test('must 가 이번 마일스톤에 생긴 시험을 가리키면 그 고침 작업자에 허락하고, .rail/check 의 재현 시험·옛 시험은 넣지 않는다', () => {
    const g = grant(repo([...NEW, { what: 'tests/old.test.mjs 도 봄', repro: '.rail/check/M2-1/old.test.mjs' }]))
    assert.deepEqual([g.by, g.files], ['new-test', ['tests/new.test.mjs']])
  })
  test('옛 시험만 가리키거나, 고침 작업자가 아니거나, must 가 없으면 허락하지 않는다(지금 규칙 그대로)', () => {
    assert.equal(grant(repo([{ what: 'tests/old.test.mjs 가 버그를 못박음', repro: 'x' }])), null)
    assert.equal(grant(repo(NEW), 'M2-1'), null)
    assert.equal(grant(repo([])), null)
  })
  test('worker start 는 그 작업자 명령에 env 를 붙이고 명세에 파일을 적고, 한 번 쓰면 다시 붙이지 않는다', () => {
    const r = repo(NEW)
    const dir = path.join(r, 'fake')
    put(r, 'fake/orca.mjs', `#!/usr/bin/env node
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
else if (b === 'worker-read') say({ ok: true, result: { report: '끝' } })
else if (b === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else process.exit(2)
`)
    spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
    const env = { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs'), ORCA_TERMINAL_HANDLE: 'term_leader' }
    const cmds = () => readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c[1] === 'create').map((c) => c[c.indexOf('--command') + 1])
    const s = run(r, ['worker', 'start', 'M2-1-fix', '--agent', 'claude', '--role', 'fix'], env)
    ok(s)
    assert.match(s.out, /이번 마일스톤에 생긴 시험이라 묻지 않고 허락한 시험 고치기\(RAIL_ALLOW_TEST_EDIT=1, tests\/new\.test\.mjs\)/)
    assert.ok(cmds()[0].startsWith(TEST_EDIT_ENV), cmds()[0])
    assert.match(readFileSync(path.join(r, '.orchestration/M2-1-fix-spec.md'), 'utf8'), /## 고쳐도 되는 시험 \(레일이 붙임, 이번 마일스톤에 생긴 시험\)\n- tests\/new\.test\.mjs\n/)
    const w = events(r).find((e) => e.event === 'worker_start')
    assert.deepEqual([w.test_edit, w.allowed_by, w.new_tests], [true, 'new-test', ['tests/new.test.mjs']])
    ok(run(r, ['worker', 'done', 'M2-1-fix'], env))
    ok(run(r, ['worker', 'start', 'M2-1-fix', '--agent', 'claude', '--role', 'fix'], env))
    assert.ok(!cmds()[1].includes('RAIL_ALLOW_TEST_EDIT'), cmds()[1])
  })
})

describe('④ 닫기 안내: 결정 접기, CLAUDE.md 지침, 크기 줄', () => {
  function closing(claude, extra = '') {
    const r = tmp('rail61c-')
    put(r, '.rail/config.json', '{}')
    put(r, 'docs/PLAN.md', planDoc([['M0', 'D-01'], ['M1']], { 'D-01': '결정: 선택함 (A)' }).replace('## 마일스톤 지도', `${extra}## 화면\n- 첫 화면\n\n## 마일스톤 지도`) + '## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 0번 (M0 0) · 계획 변경: 없음\n- 다음 장면: S2\n')
    put(r, 'CLAUDE.md', claude)
    put(r, 'docs/plan/M0.md', '| step | 맡는 쪽 | 할 일 | 파일 | 완료 | 상태 |\n|---|---|---|---|---|---|\n| M0-1 | 기능 | a | b | c | ✅ 끝(2026-11-26) 됨 |\n')
    put(r, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'check', milestone: 'M0', step: null, closed: [], gates: { plan_marks: { M0: ['D-01'] }, scene_checked: { M0: { result: 'pass', note: '봤다' } } } }))
    return r
  }
  const next = (r) => JSON.parse(run(r, ['status', '--json']).out).next
  test('크기 줄을 보이고 기준(CLAUDE.md 6KB, 결정과 시험 15KB)을 넘은 것에만 "접기·옮기기 대상"을 붙인다. 닫기는 막지 않는다', () => {
    const small = next(closing('# 메모\n'))
    assert.match(small, /크기\(막지 않음\): 기획서 성공 장면 \d+\.\dKB · 결정과 시험 \d+\.\dKB · 화면 \d+\.\dKB · 살아 있는 세 줄 \d+\.\dKB · CLAUDE\.md 0\.0KB\. 그다음 advance close/)
    assert.doesNotMatch(small, /접기·옮기기 대상/)
    const big = closing('# 메모\n' + '가'.repeat(2100), '- T-09 긴 시험 — 시험: 통과 · ' + '나'.repeat(5200) + '\n')
    const n = next(big)
    assert.match(n, /결정과 시험 1[56]\.\dKB 접기·옮기기 대상 · 화면/)
    assert.match(n, /CLAUDE\.md 6\.\dKB 접기·옮기기 대상/)
    assert.doesNotMatch(n, /성공 장면 \S+ 접기/)
    ok(run(big, ['advance', 'close']))
  })
  test('이번 마일스톤 결정의 접기와 CLAUDE.md 지침 두 줄을 말하고, 이미 상세 파일을 가리키는 줄은 접기에서 뺀다', () => {
    const n = next(closing('# 메모\n'))
    assert.match(n, /결정 접기\(D-01\) — 줄마다 아래 후보 줄.*docs\/decisions\/<번호>-<짧은 이름>\.md 에 글자 그대로 옮기고.*"결정: 바뀜 \(→ D-xx\) · 상세: <파일>" 한 줄만/)
    assert.match(n, /CLAUDE\.md 는 모든 세션·작업자가 처음 읽는다\. 지금 사실만 한 번 적고, 같은 사실이 기획서·코드에 있으면 가리키기만 하며, 명령 옵션 설명은 스크립트 도움말로 옮긴다\./)
    assert.match(n, /레일이 고쳐서 필요 없어진 배운 규칙, 기계 검사로 바뀐 배운 규칙은 닫을 때 지운다\./)
    const r = closing('# 메모\n')
    put(r, 'docs/PLAN.md', readFileSync(path.join(r, 'docs/PLAN.md'), 'utf8').replace('결정: 선택함 (A)', '결정: 선택함 (A) · 다시 볼 조건: 1만 개 · 상세: docs/decisions/D-01-방법.md'))
    put(r, 'docs/decisions/D-01-방법.md', '# D-01 방법\n  - A 가장 단순한 안\n')
    assert.doesNotMatch(next(r), /결정 접기/)
    assert.deepEqual(call(r, 'docs.mjs', "m.decisionStatus('D-01')"), { id: 'D-01', ok: true })
    assert.ok(existsSync(path.join(r, 'docs/decisions/D-01-방법.md')))
  })
})
