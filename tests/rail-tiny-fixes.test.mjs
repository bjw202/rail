// tiny 리허설(2026-11-27)에서 나온 고칠 점: ① 중간 마일스톤 기획 안내와 관문 ② 창 나누기 실패 뒤 정리·새 탭 다시 띄우기
// ③ 폴더 믿음 화면 ④ 스킬에만 있던 장치를 "다음 할 일"로 ⑤ 기능 아닌 줄의 닫힌 작업자 ⑦ 고침 뒤 커밋 ⑧ 살아 있는 세 줄 지문.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { RAIL, events, planDoc, put, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const DONE = '✅ 끝(2026-11-27) 됨'
const line = (event, milestone, data = {}, ago = 0) => JSON.stringify({ t: new Date(Date.now() - ago).toISOString(), event, stage: 'milestone', milestone, ...data })
function run(root, args, env = {}) {
  const base = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_ALLOW_TEST_EDIT', 'RAIL_STATUSLINE_DIR']) delete base[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...base, ORCA_CLI_COMMAND: '/nonexistent/orca', RAIL_ROOT: root, ...env } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)
const status = (root) => JSON.parse(run(root, ['status', '--json']).out)
// M1 장면이 자리표시인 기획서(tiny 리허설 M0 때와 같은 꼴). filled 면 M1 장면을 채운다.
const tinyPlan = (filled = false) =>
  planDoc([['M0'], ['M1']]).replace(
    /### S2 M1 장면이 보인다\n- 자동 확인: node --test\n/,
    filled ? '### S2 말투를 고르면 반말 인사가 보인다\n- 자동 확인: node src/cli.mjs 민지 --tone 반말 → 안녕, 민지!\n' : '### S2 (예상) 말투를 고른다\n- 자동 확인: M1 을 기획할 때 정한다\n'
  )
function repo({ stage = 'milestone', milestone = 'M0', plan = planDoc(), rows = [], log = [], config = { commitPolicy: 'auto-local' }, gates = {}, claude = null } = {}) {
  const root = tmp('railtiny-')
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage, milestone, step: null, closed: [], gates: { scene_checked: {}, ...gates } }))
  put(root, 'docs/PLAN.md', plan)
  if (rows.length) put(root, `docs/plan/${milestone}.md`, `# ${milestone}\n\n${HEAD}${rows.join('\n')}\n`)
  put(root, '.rail/log.jsonl', log.map((l) => l + '\n').join(''))
  if (claude !== null) put(root, 'CLAUDE.md', claude)
  return root
}

describe('① 중간 마일스톤 기획', () => {
  // M0 을 닫는 자리까지 만든다: 장면 확인 됨, step 표 끝.
  const closing = (plan) => repo({ stage: 'check', plan, rows: [`| M0-1 | 기능 | a | src/a.mjs | 없음 | 기준 | ${DONE} |`], gates: { scene_checked: { M0: { result: 'pass', note: '봤다' } } } })
  test('다음 마일스톤 장면이 자리표시면 닫은 뒤 그 마일스톤 기획을 안내하고 advance milestone 을 막는다', () => {
    const root = closing(tinyPlan())
    ok(run(root, ['advance', 'close']))
    assert.deepEqual(events(root).findLast((e) => e.event === 'stage_advance').replan, ['S2'])
    const s = status(root)
    assert.match(s.next, /^M1 기획 — 장면 S2 이\(가\) 아직 자리표시라 advance milestone 이 막힙니다: 기획서의 관련 장면·결정/)
    assert.match(s.next, /장면 채우기, 맨 위 네 줄·화면 다시 쓰기, 지도 줄, 바뀐 옛 결정은 "결정: 바뀜 \(→ D-xx\)"/)
    assert.match(s.next, /ask "이렇게 고친 기획서대로 갈까요\? \(맞음 \/ 고칠 문장\)" --kind approve/)
    assert.equal(s.skill, 'rail-plan')
    const g = run(root, ['advance', 'milestone'])
    assert.equal(g.code, 1)
    assert.match(g.err, /장면 S2 이\(가\) 아직 자리표시입니다/)
    // 장면을 채워도 다시 승인받기 전에는 기획 안내가 남는다(관문은 장면만 본다).
    put(root, 'docs/PLAN.md', tinyPlan(true))
    assert.match(status(root).next, /^M1 기획 — 장면 S2 을\(를\) 채웠으면 고친 기획서를 다시 승인받는다/)
    ok(run(root, ['ask', '이렇게 고친 기획서대로 갈까요? (맞음 / 고칠 문장)', '--kind', 'approve']))
    ok(run(root, ['answer', '맞음']))
    assert.match(status(root).next, /^M1 착수 전 결정·시험이 모두 풀렸습니다\. 마일스톤을 시작합니다 \(advance milestone\)/)
    ok(run(root, ['advance', 'milestone']))
  })
  test('장면이 처음부터 다 채워진 기획서는 닫은 뒤 곧바로 착수 전·시작으로 간다(전과 같음)', () => {
    const root = closing(planDoc())
    ok(run(root, ['advance', 'close']))
    assert.equal(events(root).findLast((e) => e.event === 'stage_advance').replan, undefined)
    assert.match(status(root).next, /^M1 착수 전 결정·시험이 모두 풀렸습니다/)
    ok(run(root, ['advance', 'milestone']))
  })
  test('미리 승인(plan approve)도 자리표시 장면을 막는다', () => {
    const root = repo({ plan: tinyPlan(), rows: [`| M0-1 | 기능 | a | src/a.mjs | 없음 | 기준 | |`] })
    put(root, 'docs/plan/M1.md', `# M1\n\n${HEAD}| M1-1 | 기능 | b | src/b.mjs | 없음 | 기준 | |\n`)
    const r = run(root, ['plan', 'approve', 'M1', '--said', '좋아요'])
    assert.equal(r.code, 1)
    assert.match(r.err, /M1: 장면 S2 이\(가\) 아직 자리표시입니다/)
  })
})

// 가짜 Orca: 부른 인자를 calls.jsonl 에 남긴다. split 이 시간 초과로 실패하고(retry 도), terminal list 에 그 사이 생긴 창이 보인다.
function fakeOrca(root, { split = 'timeout', create = 'ok', wait = {}, orphan = { handle: 'term_orphan', leafId: 'leafX' } } = {}) {
  const f = path.join(root, 'fake-orca.mjs')
  put(root, 'fake-orca.mjs', `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(root)} + '/calls.jsonl', JSON.stringify(a) + '\\n')
const say = (v) => process.stdout.write(JSON.stringify(v))
const tabs = [{ root: { type: 'group', tabs: [{ tabId: 'tab1', panes: { type: 'terminal', handle: 'term_leader', title: '리더' } }] } }]
const [x, y] = a
if (x === 'terminal' && y === 'list') say({ ok: true, result: a.includes('--include-visual-layouts') ? { terminals: [{ handle: 'term_leader', leafId: 'leaf0' }], visualLayouts: tabs } : { terminals: [{ handle: 'term_leader', leafId: 'leaf0' }, ${JSON.stringify(orphan)}] } })
else if (x === 'terminal' && y === 'split') ${split === 'timeout' ? "{ say({ ok: false, error: { message: 'Timed out waiting for split pane handle: pane leafX in tab tab1 may still open and run its command.' } }); process.exit(1) }" : split === 'other' ? "{ say({ ok: false, error: { message: 'split refused' } }); process.exit(1) }" : "say({ ok: true, result: { split: { handle: 'term_split1' } } })"}
else if (x === 'terminal' && y === 'create') ${create === 'ok' ? "say({ ok: true, result: { terminal: { handle: 'term_new1' } } })" : "{ say({ ok: false, error: { message: 'create refused' } }); process.exit(1) }"}
else if (x === 'terminal' && y === 'wait') say({ ok: true, result: { handle: a[a.indexOf('--terminal') + 1], condition: 'tui-idle', satisfied: true, status: 'running', ...${JSON.stringify(wait)} } })
else if (x === 'terminal') say({ ok: true, result: {} })
else if (y === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + a[a.indexOf('--terminal') + 1].slice(5) } })
else process.exit(2)
`)
  spawnSync('chmod', ['+x', f])
  const calls = () => (existsSync(path.join(root, 'calls.jsonl')) ? readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { env: { ORCA_CLI_COMMAND: f, ORCA_TERMINAL_HANDLE: 'term_leader' }, calls }
}
const workerRepo = (config) => {
  const root = repo({ config, rows: ['| M0-1 | 기능 | 목록 보기 | src/a.mjs | 없음 | 기준 | ⏳ 진행 중 |'] })
  put(root, '.orchestration/M0-1-spec.md', '# M0-1 목록 보기\n\n할 일\n')
  return root
}
const start = (root, env) => run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'feature'], env)
const closedTerms = (calls) => calls().filter((c) => c[0] === 'terminal' && c[1] === 'close').map((c) => c[c.indexOf('--terminal') + 1])

describe('② 창 나누기 실패', () => {
  test('시간 초과면 그 leafId 로 기다려 보고, 끝내 못 나누면 그 사이 생긴 창을 닫고 새 탭으로 한 번 다시 띄운다', () => {
    const root = workerRepo()
    const o = fakeOrca(root)
    const r = start(root, o.env)
    ok(r)
    const splits = o.calls().filter((c) => c[1] === 'split')
    assert.equal(splits.length, 3, '처음 한 번과 --retry-split 두 번')
    assert.deepEqual(splits.slice(1).map((c) => c[c.indexOf('--retry-split') + 1]), ['leafX', 'leafX'])
    assert.deepEqual(closedTerms(o.calls), ['term_orphan'])
    assert.match(r.out, /창 term_new1 \(새 탭 — 리더 탭 나누기 실패\(Timed out waiting for split pane handle: .*\), 그 사이 생긴 창 term_orphan 닫음\)/)
    assert.match(r.out, /\[새 탭\] 리더 탭을 나누지 못해 새 탭 "M0-1 목록 보기" 에 띄웠습니다/)
    assert.equal(events(root).findLast((e) => e.event === 'worker_start').terminal, 'term_new1')
  })
  test('leafId 가 없는 실패면 목록에 새로 생긴 창이 하나일 때만 그 창을 닫는다', () => {
    const root = workerRepo()
    const o = fakeOrca(root, { split: 'other', orphan: { handle: 'term_fresh' } })
    ok(start(root, o.env))
    assert.equal(o.calls().filter((c) => c[1] === 'split').length, 1, '--retry-split 할 leafId 가 없다')
    assert.deepEqual(closedTerms(o.calls), ['term_fresh'])
  })
  test('새 탭도 실패하면 실패로 적고 두 오류를 함께 남긴다', () => {
    const root = workerRepo()
    const o = fakeOrca(root, { create: 'fail' })
    const r = start(root, o.env)
    assert.equal(r.code, 1)
    assert.match(r.out, /\[작업자 실패\] M0-1: 창을 열지 못했습니다 \(create refused · 새 탭 — 리더 탭 나누기 실패/)
    const f = events(root).findLast((e) => e.event === 'worker_start_failed')
    assert.match(f.split_error, /Timed out waiting for split pane handle/)
    assert.deepEqual(closedTerms(o.calls), ['term_orphan'])
  })
})

describe('③ 폴더 믿음 화면', () => {
  test('tui-idle 결과가 trust-workspace 로 막히면 일을 맡기지 않고 실패로 적는다. 자율이 아니면 창을 남겨 주인이 고르게 한다', () => {
    const root = workerRepo()
    const o = fakeOrca(root, { split: 'ok', wait: { satisfied: false, blockedReason: 'agent-trust-workspace' } })
    const r = start(root, o.env)
    assert.equal(r.code, 1)
    assert.match(r.out, /\[작업자 실패\] M0-1: 작업자 창 term_split1 이 "이 폴더를 믿습니까\?" 화면에 멈췄습니다 \(Orca: agent-trust-workspace\)\. 레일은 믿음을 대신 고르지 않습니다\. 주인이 그 창에서 믿음을 고른 뒤 창을 닫고\(orca terminal close --terminal term_split1\) 다시 worker start 하거나, 주인이 리더 Claude 를 그 폴더\(.*\)에서 한 번 열어 믿게 한 뒤/)
    assert.ok(!o.calls().some((c) => c[1] === 'worker-start'), '일을 맡기지 않는다')
    assert.ok(!o.calls().some((c) => c[1] === 'send'), '믿음을 대신 누르지 않는다')
    assert.deepEqual(closedTerms(o.calls), [])
    const f = events(root).findLast((e) => e.event === 'worker_start_failed')
    assert.deepEqual([f.stage_failed, f.error, f.pane_closed], ['trust', 'agent-trust-workspace', false])
    assert.ok(!events(root).some((e) => e.event === 'worker_start'))
  })
  test('자율 모드면 기다릴 사람이 없으니 그 창을 닫는다', () => {
    const root = workerRepo({ commitPolicy: 'auto-local', autonomy: { mode: 'on' } })
    const o = fakeOrca(root, { split: 'ok', wait: { satisfied: false, blockedReason: 'codex-trust-workspace' } })
    const r = start(root, o.env)
    assert.equal(r.code, 1)
    assert.match(r.out, /창은 닫았습니다\. 주인이 리더 Claude 를 그 폴더/)
    assert.deepEqual(closedTerms(o.calls), ['term_split1'])
  })
})

describe('④ 스킬에만 있던 장치를 다음 할 일로', () => {
  test('기획 승인 직후 CLAUDE.md 빈칸과 checkCommand(채워져 있어도 타입 검사·린터)를 한 번 안내한다', () => {
    const root = repo({ stage: 'plan', milestone: null, config: { checkCommand: 'node --test' }, claude: '# 메모\n- 무엇: <한 줄>\n- 실행 `<명령>`\n\n## 코드 지도\n<M0 을 닫을 때>\n' })
    assert.match(status(root).next, /^기획서가 승인됐습니다\. 먼저 CLAUDE\.md 빈칸 2곳\(제품 한 줄, 명령, 되돌리기 어려운 일\)을 채우고, \.rail\/config\.json 의 checkCommand\(지금 "node --test"\)가 제품의 시험 명령인지 본다\. 타입 검사\(예: tsc --noEmit\)·린터가 있으면 함께 넣고/)
    put(root, 'CLAUDE.md', '# 메모\n- 무엇: 인사 도구\n\n## 코드 지도\n<M0 을 닫을 때>\n')
    assert.doesNotMatch(status(root).next, /빈칸/)
  })
  test('닫기 안내는 코드 지도가 틀 문구면 만들라고, 있으면 고치라고 한다', () => {
    const at = (claude) => repo({ stage: 'check', claude, rows: [`| M0-1 | 기능 | a | src/a.mjs | 없음 | 기준 | ${DONE} |`], gates: { scene_checked: { M0: { result: 'pass', note: '봤다' } } } })
    assert.match(status(at('## 코드 지도\n<M0 을 닫을 때 만든 코드>\n')).next, /CLAUDE\.md "## 코드 지도" 를 이번까지 만든 코드에 맞게 만든다/)
    assert.match(status(at('## 코드 지도\n- src/cli.mjs: 인자 읽기\n')).next, /CLAUDE\.md "## 코드 지도" 를 이번까지 만든 코드에 맞게 고친다/)
  })
  test('표 승인 질문은 기획서의 걸리는 시험 파일이 그 줄의 고쳐도 되는 파일 안이면 시험 고치기 허락을 묶는다', () => {
    const plan = planDoc().replace('- 자동 확인: node --test\n', '- 자동 확인: node --test\n- 걸리는 시험: tests/greet.test.mjs — 기대값 끝에 ! 가 붙음\n- 걸리는 시험: `tests/cli.test.mjs` — 출력 끝 !\n')
    const rows = ['| M0-1 | 기능 | 느낌표 | src/greet.mjs, tests/greet.test.mjs, tests/cli.test.mjs | 없음 | 기준 | |', '| M0-2 | 기능 | 빈 이름 | src/cli.mjs | 없음 | 기준 | |']
    const root = repo({ plan, rows, config: { commitPolicy: 'auto-local', autonomy: { mode: 'off' } } })
    const q = 'ask "이대로 시작할까요? M0-1 에서 시험 고치기도 허락할까요? (걸리는 시험: tests/greet.test.mjs, tests/cli.test.mjs) (허락하고 시작 / 바꿀 것)" --kind approve'
    assert.ok(status(root).next.includes(q), status(root).next)
    // 묶은 질문에 "허락하고 시작" 이면 그 step 의 작업자 하나에 시험 고치기가 붙는다(예전 판정 그대로).
    ok(run(root, ['ask', '이대로 시작할까요? M0-1 에서 시험 고치기도 허락할까요? (걸리는 시험: tests/greet.test.mjs, tests/cli.test.mjs) (허락하고 시작 / 바꿀 것)', '--kind', 'approve']))
    ok(run(root, ['answer', '허락하고 시작']))
    const o = fakeOrca(root, { split: 'ok' })
    ok(run(root, ['step-start', 'M0-1'], o.env))
    put(root, '.orchestration/M0-1-spec.md', '# M0-1 느낌표\n')
    assert.match(start(root, o.env).out, /사람이 허락한 시험 고치기\(RAIL_ALLOW_TEST_EDIT=1/)
    // 걸리는 시험이 없으면 예전 질문 그대로다.
    assert.ok(status(repo({ rows, config: { autonomy: { mode: 'off' } } })).next.includes('ask "이대로 시작할까요? (시작 / 바꿀 것)" --kind approve'))
    // 표를 만들기 전 안내는 걸리는 시험이 있으면 표를 쓴 뒤 status 를 다시 보라고 한다.
    assert.match(status(repo({ plan, config: { autonomy: { mode: 'off' } } })).next, /쓴 뒤 status 를 다시 본다\(기획서의 걸리는 시험 허락을 묶은 표 승인 질문이 나온다\)$/)
  })
})

describe('⑤ 기능이 아닌 줄의 닫힌 작업자', () => {
  test('마지막 리뷰 작업자를 닫았으면 다시 띄우라 하지 않고 커밋 관문·step-done 과 리뷰 must 를 안내한다', () => {
    const rows = [`| M0-1 | 기능 | a | src/a.mjs | 없음 | 기준 | ${DONE} |`, '| M0-2 | 마지막 리뷰 | 리뷰 | .rail/review/ | | must 없음 | ⏳ 진행 중 |']
    const log = [line('worker_start', 'M0', { step: 'M0-2', terminal: 'term_r', dispatch: 'ctx_r' }, 60_000), line('worker_closed', 'M0', { step: 'M0-2', terminal: 'term_r' })]
    const next = status(repo({ rows, log })).next
    assert.match(next, /^step M0-2 진행 중 — 작업자를 닫았습니다 — 커밋 관문: .* → step-done M0-2 --note "<시험 결과 한 줄>" \[--commit <해시>\]\. \.rail\/review\/M0-2\.json 에 must 가 있으면 step-done 뒤 표에 맡는 쪽 "고침" 줄/)
    assert.doesNotMatch(next, /명세 \.orchestration\/M0-2-spec\.md 를 쓰고/)
    // 아직 작업자를 띄우지 않았으면 예전처럼 명세와 worker start.
    assert.match(status(repo({ rows })).next, /명세 \.orchestration\/M0-2-spec\.md 를 쓰고 worker start M0-2/)
  })
})

describe('⑦ 고침 작업자를 닫은 뒤', () => {
  test('확인 must 를 고친 뒤 안내에 고친 코드의 커밋 관문이 있다. must 가 없으면 없다', () => {
    const rows = ['| M0-1 | 기능 | a | src/a.mjs | 없음 | 기준 | ⏳ 진행 중 |']
    const closed = (s) => [line('worker_start', 'M0', { step: s, terminal: 'term_x', dispatch: 'ctx_x' }, 60_000), line('worker_closed', 'M0', { step: s, terminal: 'term_x' })]
    const fixed = repo({ rows, log: [...closed('M0-1'), ...closed('M0-1-check'), ...closed('M0-1-fix')] })
    put(fixed, '.rail/check/M0-1.json', JSON.stringify({ must: [{ what: 'x', repro: 'y' }], nice: [] }))
    assert.match(status(fixed).next, /확인 끝\(must 1건, nice 0건\) — .*\(이미 했으면 건너뜀\)\. 고친 코드: 커밋 관문: checkCommand 가 통과하고.*\(고침 보고에 지도와 다른 구조가 있으면 코드 지도도 함께\)\. 그다음 step-done M0-1/)
    const clean = repo({ rows, log: [...closed('M0-1'), ...closed('M0-1-check')] })
    put(clean, '.rail/check/M0-1.json', JSON.stringify({ must: [], nice: [] }))
    assert.doesNotMatch(status(clean).next, /고친 코드/)
  })
})

describe('⑧ 살아 있는 세 줄을 이번 마일스톤에 고쳤나', () => {
  test('기획 때 적은 Mx 글자에 속지 않고, 장면 확인으로 갈 때 남긴 지문과 견준다', () => {
    const living = '## 살아 있는 세 줄\n- 깨진 가정: 없음 (M0)\n- 계획 밖 결정: 누적 0번 (M0 0) · 계획 변경: 느낌표 (M1 기획)\n- 다음 장면: S2 (M1)\n'
    const root = repo({ milestone: 'M1', plan: planDoc([['M0'], ['M1']]) + living, rows: [`| M1-1 | 기능 | a | src/a.mjs | 없음 | 기준 | ${DONE} |`], gates: { rehearsed: { M1: { pass: 1, total: 1, failed: [], at: '2026-11-27T00:00:00.000Z' } } } })
    const s = state(root)
    s.closed = ['M0']
    put(root, '.rail/state.json', JSON.stringify(s))
    ok(run(root, ['advance', 'check']))
    assert.match(events(root).findLast((e) => e.event === 'stage_advance').living, /^[0-9a-f]{12}$/)
    ok(run(root, ['scene', 'M1', '--result', 'pass', '--note', '봤다']))
    assert.match(status(root).next, /^M1 를 닫습니다 — 먼저 기획서 "## 살아 있는 세 줄"을 M1 기준으로 고친다/, '줄에 M1 이 있어도 기획 때 적은 것이면 다시 고치라고 한다')
    put(root, 'docs/PLAN.md', planDoc([['M0'], ['M1']]) + living.replace('- 깨진 가정: 없음 (M0)', '- 깨진 가정: T-01 방법 A 가 --tone 으로 깨짐 (M1)'))
    assert.match(status(root).next, /^M1 를 닫습니다 — 먼저 CLAUDE\.md "## 코드 지도"/)
  })
})
