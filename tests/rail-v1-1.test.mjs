// step 상태 칸을 코드가 채우기, 표 검사, 커밋 정책, 커밋 전 시험 잠금, 시험 먼저 step 뒤 예정된 실패.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { denied, events, git, markRehearsed, planDoc, put, rail, runHook, state, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const HEAD = '| step | 맡는 쪽 | 할 일 | 고쳐도 되는 파일 | 완료 기준 | 상태 |\n|---|---|---|---|---|---|\n'
const plan = (...rows) => `# M0\n\n## step\n${HEAD}${rows.map((r) => `${r}\n`).join('')}`
const ROWS = ['| M0-1 | 시험 | 시험 쓰기 | tests/** | 모듈 없음으로만 실패 | |', '| M0-2 | 구현 | 만들기 | src/** | 전부 통과 | |', '| M0-3 | 리뷰 | 읽기 | (없음) | 보고 | |']
const MILESTONE = { stage: 'milestone', milestone: 'M0', step: null, closed: [] }
const PLAN = planDoc([['M0'], ['M1']])

// milestone 단계의 임시 레일 폴더. git 을 쓰려면 withGit.
function railRoot({ rows = ROWS, st = MILESTONE, withGit = false } = {}) {
  const root = tmp('rail11-')
  put(root, '.rail/state.json', JSON.stringify(st))
  put(root, 'docs/plan/M0.md', plan(...rows))
  put(root, '.rail/config.json', '{}')
  if (withGit) {
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'rail@example.com')
    git(root, 'config', 'user.name', 'rail')
  }
  return root
}
const planText = (root) => readFileSync(path.join(root, 'docs/plan/M0.md'), 'utf8')
const rowOf = (root, step) => planText(root).split('\n').find((l) => l.startsWith(`| ${step} |`))
const statusOf = (root, step) => rowOf(root, step).split('|').slice(1, -1).map((c) => c.trim())[5]

describe('step 상태 칸을 코드가 채운다', () => {
  test('step-start 는 ⏳ 진행 중, step-done 은 ✅ 끝(날짜) <note> 로 채우고 사건을 남긴다', () => {
    const root = railRoot()
    assert.equal(rail(root, 'step-start', 'M0-1').code, 0)
    assert.equal(statusOf(root, 'M0-1'), '⏳ 진행 중')
    assert.equal(state(root).step, 'M0-1')
    const r = rail(root, 'step-done', 'M0-1', '--note', '새 시험 3개는 모듈 없음으로만 실패')
    assert.equal(r.code, 0, r.err)
    assert.equal(statusOf(root, 'M0-1'), `✅ 끝(${today()}) 새 시험 3개는 모듈 없음으로만 실패`)
    assert.equal(rowOf(root, 'M0-1').split('|').length - 2, 6, '칸 수는 그대로 6칸')
    assert.equal(state(root).step, null)
    const ev = events(root)
    assert.deepEqual(ev.filter((e) => e.event.startsWith('step_')).map((e) => [e.event, e.step]), [['step_start', 'M0-1'], ['step_done', 'M0-1']])
    assert.equal(ev.find((e) => e.event === 'step_done').note, '새 시험 3개는 모듈 없음으로만 실패')
  })

  test('step 거절: milestone 단계가 아님, 다른 마일스톤, 없는 step, 이미 끝남, note 에 | , note 없음', () => {
    assert.match(rail(railRoot({ st: { ...MILESTONE, stage: 'decide' } }), 'step-start', 'M0-1').err, /"milestone" 단계에서만/)
    const root = railRoot()
    assert.match(rail(root, 'step-start', 'M1-1').err, /지금 마일스톤\(M0\)의 step 이 아닙니다/)
    assert.match(rail(root, 'step-start', 'M0-9').err, /M0-9 줄이 없습니다/)
    assert.equal(rail(root, 'step-done', 'M0-1', '--note', 'a | b').code, 2)
    assert.equal(rail(root, 'step-done', 'M0-1').code, 2)
    rail(root, 'step-done', 'M0-1', '--note', '됨')
    assert.match(rail(root, 'step-done', 'M0-1', '--note', '또').err, /이미 끝났습니다/)
  })

  test('step-done --commit 은 해시를 칸과 사건에 남기고, git 저장소에 없는 해시는 거절한다', () => {
    const root = railRoot()
    assert.equal(rail(root, 'step-done', 'M0-1', '--note', '됨', '--commit', 'abc1234def').code, 0)
    assert.match(statusOf(root, 'M0-1'), /· 커밋 abc1234$/)
    assert.equal(events(root).at(-1).commit, 'abc1234def')
    assert.equal(rail(root, 'step-done', 'M0-2', '--note', '됨', '--commit', 'zzz').code, 2)
    const g = railRoot({ withGit: true })
    git(g, 'add', '-A')
    git(g, 'commit', '-q', '-m', 'init')
    assert.match(rail(g, 'step-done', 'M0-1', '--note', '됨', '--commit', '0000000').err, /커밋 0000000 이 이 저장소에 없습니다/)
    const head = git(g, 'rev-parse', 'HEAD').trim()
    assert.equal(rail(g, 'step-done', 'M0-1', '--note', '됨', '--commit', head).code, 0)
  })

  test('status 는 지금 마일스톤의 step 을 ✅/⏳/빈칸으로 한 줄씩 보여 준다', () => {
    const root = railRoot()
    rail(root, 'step-done', 'M0-1', '--note', '됨')
    rail(root, 'step-start', 'M0-2')
    const lines = rail(root, 'status').out.trim().split('\n')
    assert.match(lines[2], /^다음 할 일: step M0-2 진행 중/)
    assert.deepEqual(lines.slice(3), ['step (M0):', '  ✅ M0-1 시험', '  ⏳ M0-2 구현', '     M0-3 리뷰'])
    const j = JSON.parse(rail(root, 'status', '--json').out)
    assert.deepEqual(j.steps.map((s) => s.mark), ['✅', '⏳', '  '])
  })

  test('마일스톤은 모든 step 이 ✅ 여야 check 로 가고, 닫으면 기획서 마일스톤 지도 줄에 ✅ (끝 날짜)를 붙인다', () => {
    const root = railRoot({ rows: [ROWS[0]] })
    put(root, 'docs/PLAN.md', PLAN)
    rail(root, 'step-start', 'M0-1')
    rail(root, 'step-done', 'M0-1', '--note', '됨')
    assert.equal(rail(root, 'advance', 'check').code, 0)
    markRehearsed(root)
    rail(root, 'scene', 'M0', '--result', 'pass', '--note', '봤다')
    assert.equal(rail(root, 'advance', 'close').code, 0)
    const rm = readFileSync(path.join(root, 'docs/PLAN.md'), 'utf8')
    assert.ok(rm.includes(`- M0 뼈대 · 장면 S1 · 예상 1일 ✅ (${today()})\n`), rm)
    assert.ok(rm.includes('- M1 기능 · 장면 S2 · 예상 1일\n'), '다른 마일스톤은 그대로')
    assert.equal(events(root).find((e) => e.event === 'milestone_closed').sheet_marked, true)
  })
})

describe('커밋 정책', () => {
  test('기본값은 ask 다', () => {
    const root = tmp()
    assert.match(rail(root, 'policy').out, /commitPolicy\): ask/)
    assert.equal(JSON.parse(rail(root, 'status', '--json').out).commit_policy, 'ask')
  })
  test('policy set commit auto-local 은 config 의 다른 칸을 지키며 바꾸고 policy_change 를 남긴다', () => {
    const root = tmp()
    put(root, '.rail/config.json', '{"checkCommand": "node --test"}')
    const r = rail(root, 'policy', 'set', 'commit', 'auto-local', '--said', '묻지 말고 로컬 커밋해')
    assert.equal(r.code, 0, r.err)
    const c = JSON.parse(readFileSync(path.join(root, '.rail/config.json'), 'utf8'))
    assert.deepEqual(c, { checkCommand: 'node --test', commitPolicy: 'auto-local' })
    const e = events(root).at(-1)
    assert.deepEqual([e.event, e.key, e.from, e.to, e.said], ['policy_change', 'commitPolicy', 'ask', 'auto-local', '묻지 말고 로컬 커밋해'])
    assert.equal(rail(root, 'policy', 'set', 'commit', 'push').code, 2, '없는 값은 거절')
  })
})

describe('시험 기준선: 커밋 안 된 새 시험도 잠근다', () => {
  function afterTestStep() {
    const root = railRoot({ withGit: true })
    put(root, 'src/a.mjs', 'export const a = 1\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    put(root, 'tests/new.test.mjs', "import '../src/b.mjs'\n")
    put(root, 'fixtures/x/one.jsonl', '{}\n')
    assert.equal(rail(root, 'step-done', 'M0-1', '--note', '새 시험').code, 0)
    return root
  }
  const call = (root, tool_name, tool_input, env = {}) => runHook('guard-tests.mjs', { hook_event_name: 'PreToolUse', cwd: root, tool_name, tool_input }, env)

  test('시험 step 이 끝나면 그때의 시험 파일 목록과 해시를 .rail/test-baseline.json 에 찍는다', () => {
    const root = afterTestStep()
    const b = JSON.parse(readFileSync(path.join(root, '.rail/test-baseline.json'), 'utf8'))
    assert.equal(b.step, 'M0-1')
    assert.deepEqual(Object.keys(b.files).sort(), ['fixtures/x/one.jsonl', 'tests/new.test.mjs'])
    assert.match(b.files['tests/new.test.mjs'], /^[0-9a-f]{64}$/)
    assert.equal(events(root).at(-1).baseline, 2)
  })

  test('기준선에 든 커밋 안 된 시험 파일은 Edit 도 Bash 도 거절한다. 기준선 파일 자신도 잠근다', () => {
    const root = afterTestStep()
    assert.equal(git(root, 'ls-files', 'tests').trim(), '', '정말 커밋 전이다')
    const r = call(root, 'Edit', { file_path: path.join(root, 'tests/new.test.mjs') })
    assert.ok(denied(r))
    assert.match(r.stdout, /RAIL_ALLOW_TEST_EDIT=1/)
    assert.ok(denied(call(root, 'Bash', { command: 'rm tests/new.test.mjs' })))
    assert.ok(denied(call(root, 'Bash', { command: 'rm -rf tests' })))
    assert.ok(denied(call(root, 'Write', { file_path: path.join(root, '.rail/test-baseline.json'), content: '{}' })))
    assert.equal(denied(call(root, 'Write', { file_path: path.join(root, 'tests/later.test.mjs'), content: 'x' })), false, '기준선 뒤 새 파일은 허용')
    assert.equal(denied(call(root, 'Edit', { file_path: path.join(root, 'tests/new.test.mjs') }, { RAIL_ALLOW_TEST_EDIT: '1' })), false, '우회 변수는 그대로')
  })

  test('구현 step 이 끝날 때 기준선 뒤 바뀐 시험 파일이 있으면 경고하고 사건에 남긴다', () => {
    const root = afterTestStep()
    put(root, 'tests/new.test.mjs', '// 몰래 고침\n')
    const r = rail(root, 'step-done', 'M0-2', '--note', '구현')
    assert.equal(r.code, 0)
    assert.match(r.out, /\[경고\] .*tests\/new\.test\.mjs/)
    assert.deepEqual(events(root).at(-1).tests_changed, ['tests/new.test.mjs'])
  })
})

describe('마무리 검사: 표 검사와 붙잡기', () => {
  // 진짜 node --test 를 도는 git 저장소. 커밋된 옛 시험 하나는 통과한다.
  function repo(rows) {
    const root = railRoot({ rows, withGit: true })
    put(root, 'src/have.mjs', 'export const a = 1\n')
    put(root, 'tests/old.test.mjs', "import { test } from 'node:test'\ntest('옛 시험', () => {})\n")
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'init')
    return root
  }
  const DONE1 = '| M0-1 | 시험 | 시험 쓰기 | tests/** | 모듈 없음으로만 실패 | ✅ 끝(2026-11-24) 됨 |'
  const NEW_MISSING = "import { test } from 'node:test'\nimport { b } from '../src/b.mjs'\ntest('b', () => b())\n"
  const NEW_NO_EXPORT = "import { test } from 'node:test'\nimport { nope } from '../src/have.mjs'\ntest('n', () => nope())\n"
  const NEW_ASSERT = "import { test } from 'node:test'\nimport assert from 'node:assert'\ntest('틀림', () => assert.equal(1, 2))\n"
  const stop = (root, extra = {}) =>
    runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: root, stop_hook_active: false, ...extra }, { RAIL_STOP_CHECK_CMD: 'node --test' })

  test('짝 구현 step 이 끝났으면 창이 닫혀 모듈 없음도 붙잡는다', () => {
    const root = repo([DONE1, '| M0-2 | 구현 | 만들기 | src/** | 전부 통과 | ✅ 끝(2026-11-24) 됨 |', ROWS[2]])
    put(root, 'tests/new.test.mjs', NEW_MISSING)
    const r = stop(root)
    assert.equal(r.code, 2)
    assert.doesNotMatch(r.stderr, /예정된 실패로 보고/)
  })

})

describe('1판 표와의 호환', () => {
  test('머리줄 없는 표는 기본 6칸으로 보고, "끝"으로 시작하는 칸은 끝난 것으로 센다', () => {
    const root = railRoot({ rows: [] })
    writeFileSync(path.join(root, 'docs/plan/M0.md'), '| M0-1 | 구현 | a | b | c | 끝(11-24) |\n| M0-2 | 구현 | a | b | c | |\n')
    assert.deepEqual(JSON.parse(rail(root, 'status', '--json').out).steps.map((s) => s.mark), ['✅', '  '])
    assert.equal(rail(root, 'step-start', 'M0-2').code, 0)
  })
})
