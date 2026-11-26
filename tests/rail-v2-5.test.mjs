// 레일 2.5판 시험: M7 시제품 단계에서 드러난 빈틈 셋(사건 기록 11-24 09:24~09:28 의 rail_gap).
// 1) (M14 뒤 덜어내기에서 시제품 브랜치 합치기 막기 훅을 지워 그 시험도 지웠다.)
// 2) worker-start 응답에 작업 공간 경로가 없으면 Orca 작업 공간 목록에서 이름으로 찾아 기록한다. 못 찾으면 null. (비용 상한 proto check 는 M15 중 덜어내기에서 지웠다.)
// 3) proto pick 은 접두어까지 든 실제 브랜치 이름을 기록하고, Orca 가 남긴 로컬 브랜치를 그 이름으로 지운다.
// 가짜 Orca CLI 와 임시 저장소만 쓴다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { RAIL, events, git, planDoc, put, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAN = (marks) => planDoc([['M0'], ['M7', 'D-09']], marks)
const CARD = `# D-09 프로젝트 카드 배치
상태: 제안
마일스톤: M7
시제품: 예
## 질문
프로젝트 카드를 어떻게 늘어놓을지 정한다.
## 변주
- p1-grid: 같은 크기 카드 3열
- p2-big: 비싼 프로젝트는 큰 카드
## 스크린샷
- d-1124.png: 2026-11-24, 데스크톱 폭 1280
## 후보
### A 같은 크기
### B 큰 카드
## 추천
B. 이유: 비싼 것이 먼저 보인다.
`
const VARIANTS = ['p1-grid', 'p2-big']
const PREFIX = 'user7'

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'ORCA_TERMINAL_HANDLE', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH']) if (!(k in extra)) delete env[k]
  return env
}
const run = (root, args, env = {}) => {
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env: { ...cleanEnv(env), RAIL_ROOT: root } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = (r) => assert.equal(r.code, 0, r.err + r.out)

// 가짜 Orca CLI: 진짜 Orca 처럼 worker-start 응답에 작업 공간 경로·브랜치를 싣지 않는다.
// worktree list 는 listed 에 든 변주만 보여 준다(경로는 wt/<이름>, 브랜치는 refs/heads/user7/<이름>). worktree rm 은 브랜치를 지우지 않는다.
function fakeOrca(root, listed = VARIANTS) {
  const dir = path.join(root, 'fake')
  const rows = listed.map((v) => ({ displayName: `proto-D-09-${v}`, path: path.join(root, 'wt', `proto-D-09-${v}`), branch: `refs/heads/${PREFIX}/proto-D-09-${v}` }))
  put(root, 'fake/orca.mjs', `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(dir)} + '/calls.jsonl', JSON.stringify(args) + '\\n')
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const [a, b] = args
if (a === 'orchestration' && b === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + opt('--name'), worktree: { id: 'wt-' + opt('--name') } } })
else if (a === 'orchestration' && b === 'worker-show') say({ ok: true, result: { state: 'succeeded', stage: 'settled' } })
else if (a === 'orchestration' && b === 'worker-read') say({ ok: true, result: { report: '시제품 끝' } })
else if (a === 'orchestration' && ['worker-release', 'worker-stop'].includes(b)) say({ ok: true, result: {} })
else if (a === 'worktree' && b === 'list') say({ ok: true, result: { worktrees: [{ displayName: 'main', path: '/x/main', branch: 'refs/heads/main' }, ...${JSON.stringify(rows)}] } })
else if (a === 'worktree' && b === 'rm') say({ ok: true, result: { removed: opt('--worktree') } })
else { process.stderr.write('알 수 없는 명령'); process.exit(2) }
`)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  const calls = () => (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  return { env: { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs') }, calls }
}
const sub = (calls, a, b) => calls.filter((c) => c[0] === a && c[1] === b)
const opt = (c, k) => c[c.indexOf(k) + 1]
const costCmd = (root, body) => {
  put(root, 'cost.mjs', `import { readFileSync } from 'node:fs'\nconst i = JSON.parse(readFileSync(0, 'utf8'))\nprocess.stdout.write(JSON.stringify(${body}))\n`)
  return `node ${JSON.stringify(path.join(root, 'cost.mjs'))}`
}

// 결정 단계(M7)의 저장소. git 저장소로 만들어 두면 시제품 브랜치를 실제로 만들 수 있다.
function protoRoot({ listed = VARIANTS, withGit = false } = {}) {
  const root = tmp('rail25-')
  put(root, '.rail/config.json', JSON.stringify({ railVersion: '2.5' }))
  put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'decide', milestone: 'M7', step: null, closed: ['M0'], gates: { scene_checked: {} } }))
  mkdirSync(path.join(root, '.rail/proto'), { recursive: true })
  copyFileSync(path.join(REPO, 'templates/.rail/proto/template.md'), path.join(root, '.rail/proto/template.md'))
  put(root, 'docs/PLAN.md', PLAN())
  put(root, 'docs/decisions/D-09-cards.md', CARD)
  if (withGit) {
    put(root, '.gitignore', '.rail/\nfake/\n')
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 'rail@example.com')
    git(root, 'config', 'user.name', 'rail')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
  }
  return { root, orca: fakeOrca(root, listed) }
}

describe('proto start: 작업 공간 경로를 Orca 목록에서 찾기', () => {
  test('worker-start 응답에 경로가 없으면 작업 공간 목록에서 이름으로 찾아 경로와 접두어 든 브랜치를 기록한다', () => {
    const { root, orca } = protoRootWithCost()
    ok(run(root, ['proto', 'start', 'D-09'], orca.env))
    const starts = events(root).filter((e) => e.event === 'worker_start')
    assert.deepEqual(
      starts.map((e) => [e.worktree, e.branch]),
      VARIANTS.map((v) => [path.join(root, 'wt', `proto-D-09-${v}`), `${PREFIX}/proto-D-09-${v}`])
    )
    assert.ok(sub(orca.calls(), 'worktree', 'list').length >= 1, 'Orca 작업 공간 목록을 본다')
  })

  test('목록에도 없으면 지금처럼 경로를 null 로 둔다', () => {
    const { root, orca } = protoRootWithCost({ listed: [] })
    ok(run(root, ['proto', 'start', 'D-09'], orca.env))
    assert.ok(events(root).filter((e) => e.event === 'worker_start').every((e) => e.worktree === null && e.branch === null))
  })
})

describe('proto pick: 실제 브랜치 이름으로 지우기', () => {
  function decided(root, orca) {
    ok(run(root, ['proto', 'start', 'D-09'], orca.env))
    for (const v of VARIANTS) {
      ok(run(root, ['worker', 'done', `D-09:${v}`], orca.env))
      put(root, `.rail/proto/D-09/${v}/d-1124.png`, `PNG ${v}`)
      put(root, `.rail/proto/D-09/${v}/result.json`, JSON.stringify({ shots: ['d-1124.png'], measured: { 'd-1124.png 뜨는 시간': '1초' }, good: ['좋음 1', '좋음 2'], bad: ['거슬림 1', '거슬림 2'], minutes: 5, usd: 1 }))
      ok(run(root, ['proto', 'record', 'D-09', v], orca.env))
    }
    ok(run(root, ['proto', 'card', 'D-09'], orca.env))
    ok(run(root, ['answer', 'p2-big'], orca.env))
    put(root, 'docs/PLAN.md', PLAN({ 'D-09': '결정: 선택함 (B p2-big)' }))
  }
  const branches = (root) => git(root, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').trim().split('\n')

  test('Orca 가 접두어 든 브랜치를 남겨도 기록된 실제 이름으로 지우고, 그 이름을 proto_picked 에 남긴다', () => {
    const { root, orca } = protoRoot({ withGit: true })
    for (const v of VARIANTS) git(root, 'branch', `${PREFIX}/proto-D-09-${v}`)
    decided(root, orca)
    ok(run(root, ['proto', 'pick', 'D-09', 'p2-big'], orca.env))
    assert.deepEqual(branches(root), ['main'], '시제품 브랜치가 남지 않는다')
    const rm = sub(orca.calls(), 'worktree', 'rm')
    assert.deepEqual(rm.map((c) => opt(c, '--worktree')), VARIANTS.map((v) => `path:${path.join(root, 'wt', `proto-D-09-${v}`)}`))
    const picked = events(root).find((e) => e.event === 'proto_picked')
    assert.deepEqual(picked.removed.map((x) => [x.branch, x.branch_deleted, x.ok]), VARIANTS.map((v) => [`${PREFIX}/proto-D-09-${v}`, true, true]))
  })

  test('기록에도 Orca 목록에도 브랜치가 없으면 로컬 브랜치에서 "/<이름>" 으로 끝나는 것을 찾아 지운다', () => {
    const { root, orca } = protoRoot({ withGit: true, listed: [] })
    for (const v of VARIANTS) git(root, 'branch', `${PREFIX}/proto-D-09-${v}`)
    git(root, 'branch', 'feature/keep-me')
    decided(root, orca)
    ok(run(root, ['proto', 'pick', 'D-09', 'p2-big'], orca.env))
    assert.deepEqual(branches(root).sort(), ['feature/keep-me', 'main'])
    const picked = events(root).find((e) => e.event === 'proto_picked')
    assert.deepEqual(picked.removed.map((x) => x.branch), VARIANTS.map((v) => `${PREFIX}/proto-D-09-${v}`))
  })
})

// 비용 명령이 작업 공간(cwd)마다 p2-big 은 $5, 나머지는 $1 을 돌려주는 저장소.
function protoRootWithCost({ listed = VARIANTS } = {}) {
  const made = protoRoot({ listed })
  const cmd = costCmd(made.root, "{ usd: i.intervals.map(() => (i.cwd.endsWith('p2-big') ? 5 : 1)), cwd: i.cwd }")
  put(made.root, '.rail/config.json', JSON.stringify({ railVersion: '2.5', autonomy: { budget: { costCommand: cmd } } }))
  return made
}
