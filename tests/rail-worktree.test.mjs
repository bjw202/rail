// 작업자마다 git worktree(isolation=worktree, M14 시험) 시험: 만들기 → 작업자 커밋 → 합치기 → 지우기,
// 부딪히면 되돌리고 남김, 안 합쳐진 브랜치는 지우지 않음, 남은 worktree 가 있으면 닫기 거절, 기본(shared)은 지금 그대로.
// 규칙: 저장소의 .rail/config.json 값을 단언하지 않는다. 설정·저장소·가짜 orca 는 모두 임시 폴더에 만든다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { RAIL, events, git, planDoc, put, state, tmp } from './helpers.mjs'

const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
const PLAN = planDoc([['M0'], ['M1']])
const ROW = (step, status = '⏳ 진행 중', role = '기능') => `| ${step} | ${role} | 화면 | src/ | 없음 | 보인다 | ${status} |`

// 레일 저장소(git) 하나와 그 바깥의 worktree 폴더, 가짜 orca.
function repo({ isolation = 'worktree', rows = [ROW('M0-1')] } = {}) {
  const base = tmp('railwt-')
  const root = path.join(base, 'main')
  const config = { railVersion: '2.9', commitPolicy: 'auto-local', worktreeDir: path.join(base, 'wts'), ...(isolation ? { isolation } : {}) }
  put(root, '.rail/config.json', JSON.stringify(config))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {}, rehearsed: {} } }))
  put(root, '.rail/log.jsonl', '')
  put(root, '.gitignore', '.orchestration/\n.rail/.lock\n.rail/state.json.*.tmp\n')
  put(root, 'docs/PLAN.md', PLAN)
  put(root, 'docs/RAIL.md', '# 레일\n')
  put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}${rows.join('\n')}\n`)
  put(root, 'src/a.mjs', 'export const a = 1\n')
  put(root, '.orchestration/M0-1-spec.md', '# M0-1 화면\n- 하지 말 것: 커밋\n')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'wt@example.com')
  git(root, 'config', 'user.name', 'wt')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  const fake = path.join(base, 'fake-orca.mjs')
  put(base, 'fake-orca.mjs', `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
appendFileSync(${JSON.stringify(path.join(base, 'calls.jsonl'))}, JSON.stringify(a) + '\\n')
const say = (v) => process.stdout.write(JSON.stringify(v))
if (a[0] === 'terminal' && ['create', 'split'].includes(a[1])) say({ ok: true, result: { terminal: { handle: 'term_w1' } } })
else if (a[1] === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_w1' } })
else if (a[1] === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else say({ ok: true, result: {} })
`)
  spawnSync('chmod', ['+x', fake])
  const calls = () => (existsSync(path.join(base, 'calls.jsonl')) ? readFileSync(path.join(base, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { root, base, wt: (step) => path.join(base, 'wts', `rail-${step}`), fake, calls }
}
function run(r, args) {
  const env = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH']) delete env[k]
  const p = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...env, ORCA_CLI_COMMAND: r.fake, RAIL_ROOT: r.root } })
  return { code: p.status, out: p.stdout, err: p.stderr }
}
const ok = (x) => assert.equal(x.code, 0, x.err + x.out)
const start = (r, step = 'M0-1', role = 'feature') => run(r, ['worker', 'start', step, '--agent', 'claude', '--role', role, ...(step === 'M0-1' ? [] : ['--spec-file', '.orchestration/M0-1-spec.md'])])
const branches = (root) => git(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/rail/').split('\n').filter(Boolean)
// 작업자 흉내: worktree 에서 파일을 고쳐 자기 브랜치에 커밋하고, 그 세션의 훅처럼 레일 기록도 건드린다.
function workerCommits(dir, body = 'export const a = 2\n') {
  put(dir, 'src/a.mjs', body)
  put(dir, '.rail/state.json', '{"touched":"by worker hook"}')
  appendFileSync(path.join(dir, '.rail/log.jsonl'), JSON.stringify({ t: new Date().toISOString(), event: 'hook_held', stage: 'milestone', milestone: 'M0', hook: 'stop-check', reason: 'x' }) + '\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'feat: a 를 2 로')
}

describe('worktree 방식: 만들기 → 작업자 커밋 → 합치기 → 지우기', () => {
  test('worker start 가 rail/<step> worktree 를 main HEAD 에서 만들고, 창은 그 폴더에서 시작하며, 명세에 커밋 안내를 붙인다', () => {
    const r = repo()
    const head = git(r.root, 'rev-parse', 'HEAD').trim()
    ok(start(r))
    const dir = r.wt('M0-1')
    assert.ok(existsSync(dir))
    assert.deepEqual(branches(r.root), ['rail/M0-1'])
    assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), head)
    const create = r.calls().find((c) => c[0] === 'terminal' && c[1] === 'create')
    assert.match(create[create.indexOf('--command') + 1], new RegExp(`^cd '${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' && claude `))
    assert.match(readFileSync(path.join(r.root, '.orchestration/M0-1-spec.md'), 'utf8'), /## 작업 폴더와 커밋 \(레일이 붙임.*\n- 이 일은 git worktree .*rail-M0-1 \(브랜치 rail\/M0-1\)/)
    const ws = events(r.root).find((e) => e.event === 'worker_start')
    assert.equal(ws.worktree, dir)
    assert.equal(ws.branch, 'rail/M0-1')
    assert.ok(events(r.root).some((e) => e.event === 'worktree_created' && e.base === head))
    // 레일 기록 파일은 worktree 에서 git 이 보지 않는다(S = skip-worktree).
    assert.match(git(dir, 'ls-files', '-v', '.rail/state.json', '.rail/log.jsonl'), /^S \.rail\/log\.jsonl\nS \.rail\/state\.json/)
    assert.match(run(r, ['status']).out, /남은 worktree 1개: rail-M0-1\(작업 중\)/)
  })

  test('worker done 이 작업자 브랜치를 앞으로 감기로 합치고, 곧바로 worktree 와 브랜치를 지우며, 작업자 세션의 사건을 main 기록으로 옮긴다', () => {
    const r = repo()
    ok(start(r))
    const dir = r.wt('M0-1')
    workerCommits(dir)
    assert.doesNotMatch(git(dir, 'show', '--stat', 'HEAD'), /\.rail\//)
    const d = run(r, ['worker', 'done', 'M0-1'])
    ok(d)
    assert.match(d.out, /\[worktree\] M0-1 합침, worktree 와 브랜치 지움/)
    assert.equal(readFileSync(path.join(r.root, 'src/a.mjs'), 'utf8'), 'export const a = 2\n')
    assert.match(git(r.root, 'log', '--oneline', '-1'), /feat: a 를 2 로/)
    assert.ok(!existsSync(dir))
    assert.deepEqual(branches(r.root), [])
    assert.doesNotMatch(git(r.root, 'worktree', 'list'), /rail-M0-1/)
    const ev = events(r.root)
    assert.ok(ev.some((e) => e.event === 'worktree_merged' && e.step === 'M0-1'))
    assert.ok(ev.some((e) => e.event === 'worktree_removed' && e.step === 'M0-1' && e.branch_deleted === true && e.moved_events === 1))
    assert.ok(ev.some((e) => e.event === 'hook_held' && e.from_worktree === 'M0-1'))
    assert.equal(state(r.root).project, 'demo', 'main 의 상태 파일은 작업자 세션이 건드린 것으로 바뀌지 않는다')
    assert.doesNotMatch(run(r, ['status']).out, /남은 worktree/)
  })

  test('main 이 앞서 갔으면 합치기 커밋으로 합친다', () => {
    const r = repo()
    ok(start(r))
    workerCommits(r.wt('M0-1'))
    put(r.root, 'src/b.mjs', 'export const b = 1\n')
    git(r.root, 'add', 'src/b.mjs')
    git(r.root, 'commit', '-qm', 'feat: b')
    ok(run(r, ['worker', 'done', 'M0-1']))
    assert.match(git(r.root, 'log', '--oneline', '-1'), /chore: M0-1 작업자 브랜치 합치기 \(rail\/M0-1\)/)
    assert.ok(existsSync(path.join(r.root, 'src/b.mjs')))
    assert.equal(readFileSync(path.join(r.root, 'src/a.mjs'), 'utf8'), 'export const a = 2\n')
    assert.deepEqual(branches(r.root), [])
  })
})

describe('worktree 방식: 거절하고 남기기', () => {
  test('부딪히면 합치기를 되돌리고(종료 1) worktree 와 브랜치를 남기며, 부딪힌 파일과 풀 방법을 알린다. step-done·닫기도 거절하고, 풀면 worktree merge 가 합치고 지운다', () => {
    const r = repo()
    ok(start(r))
    const dir = r.wt('M0-1')
    workerCommits(dir)
    put(r.root, 'src/a.mjs', 'export const a = 3\n')
    git(r.root, 'commit', '-qam', 'feat: a 를 3 으로')
    const d = run(r, ['worker', 'done', 'M0-1'])
    assert.equal(d.code, 1, d.out + d.err)
    assert.match(d.out, /\[worktree 합치기 거절\] M0-1: 합치다 부딪혔습니다: src\/a\.mjs\. 되돌렸고 worktree 는 남겼습니다\. 풀 방법: main 폴더에서 git merge rail\/M0-1/)
    assert.ok(!existsSync(path.join(r.root, '.git/MERGE_HEAD')), '합치기는 되돌려졌다')
    assert.equal(git(r.root, 'status', '--porcelain', '-uno', '--', 'src').trim(), '')
    assert.equal(readFileSync(path.join(r.root, 'src/a.mjs'), 'utf8'), 'export const a = 3\n')
    assert.ok(existsSync(dir))
    assert.deepEqual(branches(r.root), ['rail/M0-1'])
    const blocked = events(r.root).find((e) => e.event === 'gate_blocked' && e.target === 'worktree-merge')
    assert.deepEqual(blocked.files, ['src/a.mjs'])
    assert.match(JSON.parse(run(r, ['status', '--json']).out).next, /남은 worktree 1개: rail-M0-1\(안 합쳐짐\) — 안 합쳐진 것은 worktree merge <step>/)
    // step-done 거절
    const sd = run(r, ['step-done', 'M0-1', '--note', '됨'])
    assert.equal(sd.code, 1)
    assert.match(sd.err, /안 합쳐진 작업자 브랜치가 있습니다: rail\/M0-1/)
    // 닫기 관문 거절
    put(r.root, 'docs/plan/M0.md', `# M0\n\n${HEAD}${ROW('M0-1', '✅ 끝(2026-11-25) 됨')}\n`)
    put(r.root, '.rail/state.json', JSON.stringify({ ...state(r.root), stage: 'check', gates: { scene_checked: { M0: { result: 'pass', note: '봄' } }, rehearsed: {} } }))
    const c = run(r, ['check', 'close'])
    assert.equal(c.code, 1)
    assert.match(c.err, /안 합쳐진 worktree rail-M0-1 가 남아 있습니다/)
    // 리더가 main 폴더에서 풀어 커밋하면 worktree merge 가 합쳐진 것으로 보고 지운다.
    assert.equal(spawnSync('git', ['merge', 'rail/M0-1'], { cwd: r.root }).status, 1)
    put(r.root, 'src/a.mjs', 'export const a = 4\n')
    git(r.root, 'add', 'src/a.mjs')
    git(r.root, 'commit', '-qm', 'fix: 부딪힘 풀기')
    const m = run(r, ['worktree', 'merge', 'M0-1'])
    ok(m)
    assert.match(m.out, /M0-1 합침, worktree 와 브랜치 지움/)
    assert.deepEqual(branches(r.root), [])
    assert.equal(readFileSync(path.join(r.root, 'src/a.mjs'), 'utf8'), 'export const a = 4\n')
    assert.ok(!existsSync(dir))
    ok(run(r, ['check', 'close']))
  })

  test('main 에 커밋 안 된 제품 파일이 있거나 작업자가 커밋하지 않은 변경이 있으면 합치지 않는다(레일 기록 파일은 예외)', () => {
    const r = repo()
    ok(start(r))
    const dir = r.wt('M0-1')
    workerCommits(dir)
    put(r.root, 'src/a.mjs', 'export const a = 9\n')
    const d = run(r, ['worker', 'done', 'M0-1'])
    assert.equal(d.code, 1)
    assert.match(d.out, /main 폴더에 커밋 안 된 파일: src\/a\.mjs/)
    assert.ok(existsSync(dir))
    git(r.root, 'checkout', 'src/a.mjs')
    put(dir, 'src/c.mjs', 'new\n')
    const m = run(r, ['worktree', 'merge', 'M0-1'])
    assert.equal(m.code, 1)
    assert.match(m.err, /작업자가 커밋하지 않은 변경: src\/c\.mjs/)
    rmSync(path.join(dir, 'src/c.mjs'))
    ok(run(r, ['worktree', 'merge', 'M0-1']))
    assert.ok(!existsSync(dir))
  })

  test('worktree clean 은 합쳐진 것만 지우고, 안 합쳐진 브랜치와 폴더는 남긴다. 폴더가 사라진 기록도 치운다. advance close 는 합쳐진 것을 지우고 닫는다', () => {
    const r = repo({ rows: [ROW('M0-1'), ROW('M0-2', '⏳ 진행 중'), ROW('M0-3', '⏳ 진행 중')] })
    ok(start(r))
    ok(start(r, 'M0-2'))
    ok(start(r, 'M0-3'))
    workerCommits(r.wt('M0-2')) // 안 합쳐짐
    rmSync(r.wt('M0-3'), { recursive: true, force: true }) // 폴더가 사라짐(합쳐진 것과 같음: 새 커밋 없음)
    const c = run(r, ['worktree', 'clean'])
    ok(c)
    assert.match(c.out, /rail-M0-1 지움/)
    assert.match(c.out, /남은 worktree 1개: rail-M0-2\(안 합쳐짐\)/)
    assert.deepEqual(branches(r.root), ['rail/M0-2'])
    assert.ok(existsSync(r.wt('M0-2')))
    assert.ok(!existsSync(r.wt('M0-1')))
    assert.doesNotMatch(git(r.root, 'worktree', 'list', '--porcelain'), /rail-M0-3/)
    assert.equal(git(r.root, 'log', '--oneline', 'main', '-1').includes('feat: a 를 2 로'), false, '안 합쳐진 커밋은 main 에 없다')

    // 합쳐진 것만 남은 채로 닫기: advance close 가 지우고 넘어간다.
    const r2 = repo({ rows: [ROW('M0-1', '✅ 끝(2026-11-25) 됨')] })
    git(r2.root, 'worktree', 'add', '-q', '-b', 'rail/M0-1', r2.wt('M0-1'), 'HEAD')
    put(r2.root, '.rail/state.json', JSON.stringify({ ...state(r2.root), stage: 'check', gates: { scene_checked: { M0: { result: 'pass', note: '봄' } }, rehearsed: {} } }))
    const a = run(r2, ['advance', 'close'])
    ok(a)
    assert.match(a.out, /합쳐진 rail-M0-1 지움/)
    assert.ok(!existsSync(r2.wt('M0-1')))
    assert.deepEqual(branches(r2.root), [])
  })
})

describe('기본(shared)과 켜고 끄기', () => {
  test('isolation 칸이 없으면 shared: worktree 를 만들지 않고 창 명령에 cd 가 없다(지금 동작 그대로)', () => {
    const r = repo({ isolation: null })
    ok(start(r))
    assert.deepEqual(branches(r.root), [])
    assert.ok(!existsSync(path.join(r.base, 'wts')))
    const create = r.calls().find((c) => c[0] === 'terminal' && c[1] === 'create')
    assert.match(create[create.indexOf('--command') + 1], /^claude --model opus /)
    assert.doesNotMatch(readFileSync(path.join(r.root, '.orchestration/M0-1-spec.md'), 'utf8'), /레일이 붙임/)
    assert.equal(events(r.root).find((e) => e.event === 'worker_start').worktree, undefined)
    assert.match(run(r, ['policy']).out, /작업 폴더\(isolation\): shared/)
  })

  test('worktree 방식에서도 확인·리뷰·리허설 작업자는 main 폴더에서 일한다', () => {
    const r = repo()
    ok(start(r, 'M0-1-check', 'check'))
    ok(start(r, 'M0-9', 'final-review'))
    assert.deepEqual(branches(r.root), [])
    for (const c of r.calls().filter((x) => x[0] === 'terminal' && x[1] === 'create')) assert.doesNotMatch(c[c.indexOf('--command') + 1], /^cd /)
  })

  test('policy set isolation 은 사람 말(--said)이 있어야 바꾼다', () => {
    const r = repo({ isolation: null })
    const no = run(r, ['policy', 'set', 'isolation', 'worktree'])
    assert.equal(no.code, 1)
    assert.ok(events(r.root).some((e) => e.event === 'policy_refused' && e.key === 'isolation'))
    ok(run(r, ['policy', 'set', 'isolation', 'worktree', '--said', 'M14 는 worktree 로']))
    assert.equal(JSON.parse(readFileSync(path.join(r.root, '.rail/config.json'), 'utf8')).isolation, 'worktree')
    assert.ok(events(r.root).some((e) => e.event === 'policy_change' && e.key === 'isolation' && e.to === 'worktree' && e.said === 'M14 는 worktree 로'))
    ok(run(r, ['policy', 'set', 'isolation', 'shared', '--said', '끄자']))
    assert.match(run(r, ['policy']).out, /isolation\): shared/)
  })
})
