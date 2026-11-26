import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { denied, git, makeRepo, put, runHook } from './helpers.mjs'

const repo = makeRepo()
const call = (tool_name, tool_input, env = {}) => runHook('guard-tests.mjs', { hook_event_name: 'PreToolUse', cwd: repo, tool_name, tool_input }, env)
const bash = (command, env = {}) => call('Bash', { command }, env)

describe('시험 파일 잠금: 파일 도구', () => {
  test('이미 있는 시험 파일 Edit 은 거절하고 우회 변수를 안내한다', () => {
    const r = call('Edit', { file_path: path.join(repo, 'tests/x.test.mjs') })
    assert.equal(r.code, 0)
    assert.ok(denied(r))
    assert.match(r.stdout, /RAIL_ALLOW_TEST_EDIT=1/)
  })
  test('fixtures/ 의 기존 파일도 잠근다', () => {
    assert.ok(denied(call('Write', { file_path: path.join(repo, 'fixtures/doc.txt'), content: 'z' })))
  })
  test('새 시험 파일과 일반 소스는 허용한다', () => {
    assert.equal(denied(call('Write', { file_path: path.join(repo, 'tests/new.test.mjs'), content: 'z' })), false)
    assert.equal(denied(call('Edit', { file_path: path.join(repo, 'src/a.mjs') })), false)
  })
  test('우회 변수 RAIL_ALLOW_TEST_EDIT=1 이면 통과한다', () => {
    assert.equal(denied(call('Edit', { file_path: path.join(repo, 'tests/x.test.mjs') }, { RAIL_ALLOW_TEST_EDIT: '1' })), false)
  })
  test('옛 이름(PLEXUS_ALLOW_TEST_EDIT)으로는 우회되지 않는다', () => {
    assert.ok(denied(call('Edit', { file_path: path.join(repo, 'tests/x.test.mjs') }, { PLEXUS_ALLOW_TEST_EDIT: '1' })))
  })
  test('git 저장소 밖은 건드리지 않는다', () => {
    const r = runHook('guard-tests.mjs', { cwd: '/', tool_name: 'Edit', tool_input: { file_path: '/tests/x.test.mjs' } })
    assert.equal(denied(r), false)
  })
})

describe('시험 파일 잠금: Bash', () => {
  for (const [name, cmd] of [
    ['sed -i', "sed -i '' 's/a/b/' tests/x.test.mjs"],
    ['리다이렉트', 'echo hi > tests/x.test.mjs'],
    ['rm', 'rm -f tests/x.test.mjs'],
    ['fixtures rm', 'rm fixtures/doc.txt'],
    ['git restore', 'git restore tests/x.test.mjs'],
    ['sh -c 안', 'sh -c "rm tests/x.test.mjs"']
  ])
    test(`${name} → 거절`, () => assert.ok(denied(bash(cmd))))
  for (const [name, cmd] of [
    ['cat', 'cat tests/x.test.mjs'],
    ['새 시험 파일', 'echo hi > tests/brand-new.test.mjs'],
    ['2>&1', 'node --test 2>&1 | tail -5'],
    ['따옴표 안 글', 'git commit -m "rm tests/x.test.mjs"']
  ])
    test(`${name} → 허용`, () => assert.equal(denied(bash(cmd)), false))
  test('우회 변수가 있으면 Bash 도 통과한다', () => assert.equal(denied(bash('rm tests/x.test.mjs', { RAIL_ALLOW_TEST_EDIT: '1' })), false))
})

// Windows 의 Claude Code 는 PowerShell 도구를 기본으로 켤 수 있다. 같은 잠금을 PowerShell 명령에도 건다(최선의 노력, 대소문자·별칭·\ 경로).
describe('시험 파일 잠금: PowerShell', () => {
  const ps = (command) => call('PowerShell', { command })
  for (const [name, cmd] of [
    ['Set-Content', "Set-Content -Path tests\\x.test.mjs -Value 'z'"],
    ['Add-Content', 'Add-Content tests/x.test.mjs "z"'],
    ['파이프 Out-File', "'z' | Out-File -FilePath tests\\x.test.mjs"],
    ['리다이렉트 >>', "echo 'z' >> tests\\x.test.mjs"],
    ['Remove-Item 대소문자', 'remove-item -Force fixtures\\doc.txt'],
    ['del 별칭', 'del tests\\x.test.mjs'],
    ['Move-Item', 'Move-Item tests\\x.test.mjs tests\\z.mjs'],
    ['Rename-Item', 'Rename-Item tests\\x.test.mjs z.test.mjs'],
    ['Copy-Item 대상', 'Copy-Item src\\a.mjs -Destination tests\\x.test.mjs'],
    ['New-Item -Force', 'New-Item -Force -ItemType File tests\\x.test.mjs'],
    ['폴더 통째로', 'Remove-Item -Recurse tests'],
    ['git checkout', 'git checkout -- tests\\x.test.mjs'],
    ['pwsh -Command 안', 'pwsh -NoProfile -Command "Remove-Item tests\\x.test.mjs"']
  ])
    test(`${name} → 거절`, () => assert.ok(denied(ps(cmd))))
  for (const [name, cmd] of [
    ['Get-Content', 'Get-Content tests\\x.test.mjs'],
    ['Copy-Item 원본', 'Copy-Item tests\\x.test.mjs src\\copy.mjs'],
    ['새 시험 파일', "Set-Content tests\\brand-new.test.mjs 'z'"],
    ['변수 경로', 'Remove-Item $env:TEMP\\x'],
    ['따옴표 안 글', 'git commit -m "Remove-Item tests/x.test.mjs"']
  ])
    test(`${name} → 허용`, () => assert.equal(denied(ps(cmd)), false))
})

describe('마무리 검사', () => {
  const stop = (r, env = {}, extra = {}) => runHook('stop-check.mjs', { hook_event_name: 'Stop', cwd: r, stop_hook_active: false, ...extra }, env)
  const FAIL = { RAIL_STOP_CHECK_CMD: "node -e \"console.log('boom: 시험 실패'); process.exit(1)\"" }
  const PASS = { RAIL_STOP_CHECK_CMD: 'node -e "process.exit(0)"' }
  const touch = (r, f = 'src/a.mjs') => put(r, f, `changed ${Math.random()}\n`)

  test('checkCommand 가 비어 있으면(설정 없음 포함) 건너뛴다', () => {
    const r = makeRepo()
    touch(r)
    assert.equal(stop(r).code, 0)
    put(r, '.rail/config.json', '{"checkCommand": ""}')
    assert.equal(stop(r).code, 0)
    assert.equal(stop(r).stderr, '')
  })
  test('.rail/config.json 의 checkCommand 를 쓴다: 실패하면 종료 코드 2', () => {
    const r = makeRepo()
    put(r, '.rail/config.json', JSON.stringify({ checkCommand: FAIL.RAIL_STOP_CHECK_CMD }))
    touch(r)
    const res = stop(r)
    assert.equal(res.code, 2)
    assert.match(res.stderr, /boom: 시험 실패/)
  })
  test('바뀐 것이 없거나 문서만 바뀌면 돌리지 않는다', () => {
    const r = makeRepo()
    assert.equal(stop(r, FAIL).code, 0)
    touch(r, 'README.md')
    assert.equal(stop(r, FAIL).code, 0)
  })
  test('레일 상태·로그 파일만 바뀐 것은 제품 변경으로 보지 않는다', () => {
    const r = makeRepo()
    put(r, '.rail/state.json', '{}')
    put(r, '.rail/log.jsonl', '{}\n')
    assert.equal(stop(r, FAIL).code, 0)
  })
  test('통과하면 같은 상태에서는 다시 돌리지 않고, 바뀌면 다시 돌린다', () => {
    const r = makeRepo()
    touch(r)
    assert.equal(stop(r, PASS).code, 0)
    assert.equal(stop(r, FAIL).code, 0)
    touch(r)
    assert.equal(stop(r, FAIL).code, 2)
  })
  test('같은 실패는 두 번까지만 붙잡고 경고와 함께 통과시킨다', () => {
    const r = makeRepo()
    touch(r)
    assert.equal(stop(r, FAIL).code, 2)
    assert.equal(stop(r, FAIL, { stop_hook_active: true }).code, 2)
    const third = stop(r, FAIL, { stop_hook_active: true })
    assert.equal(third.code, 0)
    assert.match(third.stderr, /통과시킨다/)
  })
  test('시간 상한을 넘으면 막지 않고 경고만 한다', () => {
    const r = makeRepo()
    touch(r)
    const res = stop(r, { RAIL_STOP_CHECK_CMD: 'node -e "setTimeout(()=>{}, 30000)"', RAIL_STOP_CHECK_TIMEOUT_MS: '500' })
    assert.equal(res.code, 0)
    assert.match(res.stderr, /멈췄다/)
  })
  test('캐시 파일은 .git 아래에 둔다', () => {
    const r = makeRepo()
    touch(r)
    stop(r, PASS)
    const gitDir = git(r, 'rev-parse', '--absolute-git-dir').trim()
    assert.ok(JSON.parse(readFileSync(path.join(gitDir, 'rail-stop-check.json'), 'utf8')).passedHash)
  })
})
