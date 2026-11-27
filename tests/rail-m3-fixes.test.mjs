// hbo-tube M3 리더가 낸 고칠 점(2026-11-27): 배포에 달린 완료 기준, 확인 틀의 코드 밖 사정, 작업자 지시서의
// 서버·돈 드는 호출, 새 탭 알림, 이미 있는 제품에 더할 때의 기획 순서.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { GOOD_PLAN, RAIL, put, rail, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')

describe('배포에 달린 완료 기준', () => {
  test('step 표 만들기 안내는 장면의 자동 확인 가운데 배포 주소 같은 바깥 상태는 마일스톤 끝으로 두고 로컬로 재는 부분만 줄에 옮기게 한다', () => {
    const root = tmp()
    put(root, 'docs/PLAN.md', GOOD_PLAN)
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
    const next = JSON.parse(rail(root, 'status', '--json').out).next
    assert.match(next, /그 장면의 자동 확인 그대로\(그 확인이 배포된 주소처럼 바깥 상태를 보면 그 부분은 마지막 리뷰·리허설 전 배포 뒤의 마일스톤 끝 확인으로 두고, 줄의 완료 기준에는 로컬로 재는 부분만 옮긴다\)/)
    assert.doesNotMatch(next, /확인 전에 배포/)
    assert.match(read('skills/rail-milestone/SKILL.md'), /배포된 주소처럼 바깥 상태를 보는 부분은 마지막 리뷰·리허설 전 배포 뒤의 확인으로 두고, 줄에는 로컬로 재는 부분만 옮긴다/)
  })
  test('확인 틀은 코드 밖 사정으로 볼 수 없는 기준을 must 로 세지 않고 "배포 뒤 볼 것"으로 적게 한다', () => {
    assert.match(read('templates/.rail/check/template.md'), /^ {2}코드 밖 사정\(배포 안 됨, 키 없음\)으로 볼 수 없는 기준은 must 가 아니다\. nice 에 "배포 뒤 볼 것: <기준>"으로 적는다\.$/m)
  })
})

describe('작업자 지시서 문구', () => {
  const w = read('skills/rail-milestone/workers.md')
  test('서버는 자기가 띄운 것으로 확인하고 끄며, 서버가 하나뿐인 도구면 리더 서버를 쓴다', () => {
    assert.match(w, /^- 서버: 확인이 필요하면 자기 서버를 띄우고 그 주소로 확인한 뒤 끄고, 포트와 끈 것을 보고에 적는다\. 이미 떠 있는 남의 서버에 기대지 않는다\. 같은 폴더에서 서버를 하나만 띄울 수 있는 도구\(예: Next\.js dev\)면 리더가 띄운 하나를 쓰고 끄지 않는다\.$/m)
    assert.doesNotMatch(w, /포트 열기/, '서버 지침과 어긋나는 옛 금지 문구는 없다')
  })
  test('돈 드는 호출은 무료로 대상을 먼저 확인하고 정해 준 대상·횟수 안에서만', () => {
    const always = w.split('## 맡는 쪽마다')[0]
    assert.match(always, /^- 돈 드는 호출\(바깥 유료 API\): 무료로 대상이 맞는지 먼저 확인한 뒤, 정해 준 대상·횟수 안에서만 부른다\.$/m)
  })
  test('새 탭 줄이 나오면 주인에게 탭 이름을 전하라고 한다', () => {
    assert.match(w, /출력에 `\[새 탭\]` 줄이 있으면 주인에게 그 탭 이름을 한 줄로 전한다/)
  })
})

describe('이미 있는 제품에 더할 때 (rail-plan)', () => {
  test('닿는 코드·앞 장면을 먼저 읽고, 맨 위 네 줄·화면 줄을 고치고, 남은 nice 를 훑게 한다', () => {
    const s = read('skills/rail-plan/SKILL.md')
    assert.match(s, /^- 이미 있는 제품에 더할 때: 그 기능이 닿는 지금 코드·시험과 앞 장면·결정을 먼저 읽는다\./m)
    assert.match(s, /맨 위 네 줄\("이번엔 어디까지" 등\)과 "## 화면" 은 덧붙이지 않고 지금 제품 상태로 다시 쓰고, .*남은 nice\(확인 기록\)와 "## 나중에" 를 훑어/)
  })
})

// 가짜 Orca: fake/mode 가 tab 이면 리더 탭을 나누고, 아니면 배치가 비어 새 탭을 연다.
function fakeOrca(root, mode) {
  const dir = path.join(root, 'fake')
  put(root, 'fake/orca.mjs', `#!/usr/bin/env node
const args = process.argv.slice(2)
const opt = (k) => args[args.indexOf(k) + 1]
const say = (o) => process.stdout.write(JSON.stringify(o))
const tabs = ${mode === 'tab' ? "[{ root: { type: 'group', tabs: [{ tabId: 'tab1', panes: { type: 'terminal', handle: 'term_leader', title: '리더' } }] } }]" : '[]'}
const [a, b] = args
if (a === 'terminal' && b === 'list') say({ ok: true, result: { terminals: [], visualLayouts: tabs } })
else if (a === 'terminal' && b === 'create') say({ ok: true, result: { terminal: { handle: 'term_new1' } } })
else if (a === 'terminal' && b === 'split') say({ ok: true, result: { split: { handle: 'term_split1', tabId: 'tab1', leafId: 'leaf' } } })
else if (a === 'terminal') say({ ok: true, result: {} })
else if (b === 'worker-start') say({ ok: true, result: { dispatchId: 'ctx_' + opt('--terminal').slice(5) } })
else process.exit(2)
`)
  spawnSync('chmod', ['+x', path.join(dir, 'orca.mjs')])
  return { ORCA_CLI_COMMAND: path.join(dir, 'orca.mjs'), ORCA_TERMINAL_HANDLE: 'term_leader' }
}
function run(root, args, extra) {
  const env = { ...process.env, ...extra, RAIL_ROOT: root }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'ORCA_AGENT_SESSION_ID', 'NODE_TEST_CONTEXT', 'RAIL_NO_TOUCH', 'RAIL_ALLOW_TEST_EDIT']) delete env[k]
  const r = spawnSync(process.execPath, [RAIL, ...args], { encoding: 'utf8', env })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
describe('새 탭 알림', () => {
  const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 기다리는 step | 완료 기준 | 상태 |\n|---|---|---|---|---|---|---|\n'
  const start = (mode) => {
    const root = tmp('railtab-')
    put(root, '.rail/config.json', JSON.stringify({ commitPolicy: 'auto-local' }))
    put(root, 'docs/PLAN.md', GOOD_PLAN)
    put(root, 'docs/plan/M0.md', `# M0\n\n${HEAD}| M0-1 | 기능 | 목록 보기 | src/a.mjs | 없음 | 기준 | |\n`)
    put(root, '.rail/state.json', JSON.stringify({ project: 'demo', stage: 'milestone', milestone: 'M0', step: null, closed: [], gates: { scene_checked: {} } }))
    put(root, '.orchestration/M0-1-spec.md', '# M0-1 목록 보기\n\n할 일\n')
    const env = fakeOrca(root, mode)
    assert.equal(run(root, ['step-start', 'M0-1'], env).code, 0)
    const r = run(root, ['worker', 'start', 'M0-1', '--agent', 'claude', '--role', 'feature'], env)
    assert.equal(r.code, 0, `${r.out}\n${r.err}`)
    return r.out
  }
  test('리더 탭을 나누지 못해 새 탭에 띄우면 그 사실과 탭 이름을 한 줄로 낸다', () => {
    assert.match(start('new'), /\(새 탭\), 일 ctx_new1, 이름 "M0-1 목록 보기"\n\[새 탭\] 리더 탭을 나누지 못해 새 탭 "M0-1 목록 보기" 에 띄웠습니다\. 주인에게 이 탭 이름을 한 줄로 알린다/)
  })
  test('리더 탭을 나눴으면 새 탭 줄을 내지 않는다', () => {
    const o = start('tab')
    assert.match(o, /term_leader 를 .*나눔/)
    assert.doesNotMatch(o, /\[새 탭\]/)
  })
})
