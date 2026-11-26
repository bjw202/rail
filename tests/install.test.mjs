// 레포마다 설치: node scripts/install.mjs <대상>. 다시 돌리면 업데이트이고, 레일 훅은 한 번만 들어가며, 상태·기획서와 다른 설정은 그대로다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { COMMIT_HINT, GIT_BASH_WARNING, hasGitBash } from '../scripts/install.mjs'
import { denied, git, put, tmp } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = path.join(ROOT, 'scripts/install.mjs')
// 대상을 주면 인자로, 안 주면(undefined) cwd 에서 인자 없이 부른다. file 로 다른 경로(링크)의 install.mjs 를 부를 수 있다.
const install = (target, { cwd, file = INSTALL, flags = [] } = {}) => {
  const r = spawnSync(process.execPath, [file, ...(target === undefined ? [] : [target]), ...flags], { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8')
const settings = (root) => JSON.parse(read(root, '.claude/settings.json'))
const railCommands = (s) => Object.values(s.hooks).flat().flatMap((e) => e.hooks.map((h) => [h.command, ...(h.args ?? [])].join(' '))).filter((c) => c.includes('.rail/'))
const ALLOW = ['Bash(node .rail/bin/rail.mjs *)', 'Bash(node .rail\\bin\\rail.mjs *)', 'PowerShell(node .rail/bin/rail.mjs *)', 'PowerShell(node .rail\\bin\\rail.mjs *)']

function repo() {
  const root = tmp('rail-inst-')
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'inst@example.com')
  git(root, 'config', 'user.name', 'inst')
  put(root, 'tests/old.test.mjs', "import { test } from 'node:test'\ntest('옛 시험', () => {})\n")
  put(root, '.gitignore', 'node_modules/\n.orchestration/')
  put(root, '.claude/settings.json', JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo 내 훅' }] }] } }))
  return root
}
const commitAll = (root) => (git(root, 'add', '-A'), git(root, 'commit', '-q', '-m', 'rail'))

describe('설치', () => {
  test('레일 파일·스킬·시작 틀을 깔고, settings.json 에 레일 훅과 명령 허용만 더한다', () => {
    const root = repo()
    const r = install(root)
    assert.equal(r.code, 0, r.err)
    for (const f of ['.rail/bin/rail.mjs', '.rail/bin/lib/core.mjs', '.rail/hooks/guard-tests.mjs', '.claude/skills/rail/SKILL.md', '.claude/skills/rail-milestone/workers.md', '.rail/config.json', '.rail/plan/template.md', 'docs/RAIL.md', '.rail/installed.json'])
      assert.ok(existsSync(path.join(root, f)), f)
    assert.ok(!existsSync(path.join(root, '.rail/bin/install.mjs')), '설치 도구는 깔지 않는다')
    const s = settings(root)
    assert.deepEqual([s.env, s.permissions.allow], [{ A: '1' }, ['Bash(npm test)', ...ALLOW]])
    assert.equal(s.hooks.Stop[0].hooks[0].command, 'echo 내 훅', '다른 훅은 그대로')
    assert.deepEqual(railCommands(s).sort(), [
      'node ${CLAUDE_PROJECT_DIR}/.rail/bin/rail.mjs status --hook',
      'node ${CLAUDE_PROJECT_DIR}/.rail/bin/rail.mjs status --hook --compact',
      'node ${CLAUDE_PROJECT_DIR}/.rail/hooks/guard-tests.mjs',
      'node ${CLAUDE_PROJECT_DIR}/.rail/hooks/pre-compact.mjs',
      'node ${CLAUDE_PROJECT_DIR}/.rail/hooks/stop-check.mjs'
    ])
    assert.equal(s.hooks.SessionStart[1].matcher, 'compact')
    assert.equal(s.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell', '시험 잠금은 PowerShell 도구도 본다')
    const gi = read(root, '.gitignore').split('\n')
    assert.deepEqual(gi.slice(0, 3), ['node_modules/', '.orchestration/', '.rail/.lock'], '있는 줄은 그대로, 없는 줄만 더한다')
    assert.equal(gi.filter((l) => l === '.orchestration/').length, 1)
    assert.match(read(root, '.rail/installed.json'), /"files": \[/)
  })

  test('두 번 돌려도 훅·허용·.gitignore 줄이 두 번 들어가지 않고 "바뀐 파일 없음"이다', () => {
    const root = repo()
    assert.ok(install(root).out.trimEnd().endsWith(COMMIT_HINT), '바뀐 것이 있으면 마지막 줄에 따로 커밋하라는 안내')
    commitAll(root)
    const first = read(root, '.claude/settings.json')
    const again = install(root)
    assert.equal(again.code, 0, again.err)
    assert.match(again.out, /바뀐 파일 없음/)
    assert.ok(!again.out.includes(COMMIT_HINT), '바뀐 것이 없으면 커밋 안내도 없다')
    assert.equal(read(root, '.claude/settings.json'), first)
    assert.equal(railCommands(settings(root)).length, 5)
    assert.equal(read(root, '.gitignore').split('\n').filter((l) => l === '.rail/.lock').length, 1)
  })

  test('옛 셸 문자열 레일 훅은 exec 형식(command: node, args)으로 바뀌고 두 번 들어가지 않으며, 옛 허용 줄도 한 번만 남는다', () => {
    const root = repo()
    const old = (f, a = '') => ({ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.rail/${f}"${a}`, timeout: 30 })
    put(root, '.claude/settings.json', JSON.stringify({
      permissions: { allow: ['Bash(node .rail/bin/rail.mjs *)'] },
      hooks: { SessionStart: [{ hooks: [old('bin/rail.mjs', ' status --hook')] }], PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [old('hooks/guard-tests.mjs')] }], Stop: [{ hooks: [{ type: 'command', command: 'echo 내 훅' }, old('hooks/stop-check.mjs')] }] }
    }))
    assert.equal(install(root).code, 0)
    const s = settings(root)
    assert.equal(railCommands(s).length, 5)
    const rail = Object.values(s.hooks).flat().flatMap((e) => e.hooks).filter((h) => h.command !== 'echo 내 훅')
    assert.ok(rail.every((h) => h.command === 'node' && h.args[0].startsWith('${CLAUDE_PROJECT_DIR}/.rail/')), JSON.stringify(rail))
    assert.deepEqual(s.hooks.Stop.map((e) => e.hooks.map((h) => h.command)), [['echo 내 훅'], ['node']])
    assert.deepEqual(s.permissions.allow, ALLOW)
    // Claude Code 처럼 args 의 자리표시자만 바꿔 셸 없이 부르면 시험 잠금이 돈다.
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'rail')
    const guard = s.hooks.PreToolUse[0].hooks[0]
    const env = { ...process.env }
    delete env.RAIL_ALLOW_TEST_EDIT
    const r = spawnSync(guard.command, guard.args.map((a) => a.replace('${CLAUDE_PROJECT_DIR}', root)), { input: JSON.stringify({ cwd: root, tool_name: 'PowerShell', tool_input: { command: 'Remove-Item tests\\old.test.mjs' } }), encoding: 'utf8', env })
    assert.ok(denied({ stdout: r.stdout }), r.stdout + r.stderr)
  })

  test('Windows 에서 Git Bash 를 찾는다: CLAUDE_CODE_GIT_BASH_PATH, PATH 의 git 옆 bash, 흔한 설치 자리. 없으면 경고 글을 낸다', () => {
    const base = tmp('rail-gb-')
    put(base, 'Git/bin/bash.exe', '')
    mkdirSync(path.join(base, 'Git/cmd'))
    assert.equal(hasGitBash({ PATH: path.join(base, 'nothing') }), false)
    assert.equal(hasGitBash({ CLAUDE_CODE_GIT_BASH_PATH: path.join(base, 'Git/bin/bash.exe') }), true)
    assert.equal(hasGitBash({ PATH: `${path.join(base, 'x')};${path.join(base, 'Git/cmd')}` }), true, 'git.exe 가 있는 cmd 폴더 옆 bin')
    assert.equal(hasGitBash({ ProgramFiles: base }), true)
    put(base, 'System32/bash.exe', '')
    assert.equal(hasGitBash({ PATH: path.join(base, 'System32'), CLAUDE_CODE_GIT_BASH_PATH: path.join(base, 'none.exe') }), false, 'System32 의 bash.exe 는 WSL 것')
    assert.match(GIT_BASH_WARNING, /Git for Windows 를 깔기를 권합니다: 없으면 Claude Code 가 Bash 도구 대신 PowerShell 을 씁니다/)
  })

  test('업데이트는 레일 파일만 새로 쓰고, 상태·기록·기획서·설정과 고친 시작 틀은 덮지 않으며, 레일에서 빠진 파일은 지운다', () => {
    const root = repo()
    install(root)
    for (const [f, body] of [['.rail/state.json', '{"stage":"milestone"}'], ['.rail/log.jsonl', '{}\n'], ['docs/PLAN.md', '# 내 기획서\n'], ['.rail/config.json', '{"checkCommand":"npm test"}'], ['docs/RAIL.md', '내가 고친 설명서\n']]) put(root, f, body)
    put(root, '.rail/bin/lib/core.mjs', '// 낡은 판\n')
    put(root, '.rail/bin/cost.mjs', '// 프로젝트의 비용 명령\n')
    const info = JSON.parse(read(root, '.rail/installed.json'))
    writeFileSync(path.join(root, '.rail/installed.json'), JSON.stringify({ ...info, files: [...info.files, '.rail/bin/lib/old.mjs'] }))
    put(root, '.rail/bin/lib/old.mjs', '// 지난 판에만 있던 파일\n')
    commitAll(root)
    const r = install(root)
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /바꿈 \.rail\/bin\/lib\/core\.mjs/)
    assert.match(r.out, /지움 \.rail\/bin\/lib\/old\.mjs/)
    assert.ok(!existsSync(path.join(root, '.rail/bin/lib/old.mjs')))
    assert.equal(read(root, '.rail/bin/cost.mjs'), '// 프로젝트의 비용 명령\n', '설치 목록에 없던 파일은 지우지 않는다')
    for (const [f, body] of [['.rail/state.json', '{"stage":"milestone"}'], ['docs/PLAN.md', '# 내 기획서\n'], ['.rail/config.json', '{"checkCommand":"npm test"}'], ['docs/RAIL.md', '내가 고친 설명서\n']]) assert.equal(read(root, f), body, f)
  })

  test('설치된 레포에서는 RAIL_ROOT 없이 .rail/bin/rail.mjs 가 그 레포를 쓰고, .rail/hooks 의 시험 잠금이 막고 기록한다', () => {
    const root = repo()
    install(root)
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'rail')
    const env = { ...process.env }
    for (const k of ['RAIL_ROOT', 'NODE_TEST_CONTEXT']) delete env[k]
    put(root, 'docs/PLAN.md', '# 기획서\n')
    const st = spawnSync(process.execPath, [path.join(root, '.rail/bin/rail.mjs'), 'status'], { cwd: path.join(root, 'tests'), encoding: 'utf8', env })
    assert.equal(st.status, 0, st.stderr)
    assert.match(st.stdout, /다음 할 일: 기획서 마무리/, '하위 폴더에서 불러도 설치된 레포의 기획서를 읽는다')
    const r = spawnSync(process.execPath, [path.join(root, '.rail/hooks/guard-tests.mjs')], { input: JSON.stringify({ cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'tests/old.test.mjs') } }), encoding: 'utf8', env })
    assert.ok(denied({ stdout: r.stdout }))
    assert.match(read(root, '.rail/log.jsonl'), /"event":"hook_blocked"/)
  })

  test('대상이 없으면 실패하고, git 레포가 아니거나 레포의 하위 폴더거나 레일 원본 자신이면 깔지 않고 쉬운 말로 알린다', () => {
    assert.equal(install(path.join(tmp(), 'nope')).code, 1)
    const plain = tmp('rail-plain-')
    const r = install(undefined, { cwd: plain })
    assert.equal(r.code, 1)
    assert.match(r.err, /git 레포가 아닙니다\. 제품 레포 폴더에서 치거나, 먼저 git init 하세요/)
    assert.ok(!existsSync(path.join(plain, '.rail')), '아무것도 깔지 않는다')
    const root = repo()
    const sub = install(undefined, { cwd: path.join(root, 'tests') })
    assert.equal(sub.code, 1)
    assert.ok(sub.err.includes(`레포 맨 위 폴더(${root})에서 다시 치세요`), sub.err)
    const self = install(undefined, { cwd: ROOT })
    assert.equal(self.code, 1)
    assert.match(self.err, /레일 원본 폴더입니다/)
  })

  test('인자 없이 부르면 지금 폴더(cwd)의 레포에 깐다', () => {
    const root = repo()
    const r = install(undefined, { cwd: root })
    assert.equal(r.code, 0, r.err)
    assert.ok(r.out.startsWith(`[레일 설치] ${root} `), r.out)
    assert.ok(existsSync(path.join(root, '.rail/bin/rail.mjs')))
  })

  test('npm link 처럼 심볼릭 링크(Windows 는 junction)를 거쳐 package.json 의 bin(rail-install)을 불러도 본문이 돌아 지금 폴더에 깐다', () => {
    const { bin } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.equal(bin['rail-install'], 'scripts/install.mjs')
    assert.match(readFileSync(path.join(ROOT, bin['rail-install']), 'utf8'), /^#!\/usr\/bin\/env node\n/, 'npm 이 껍데기를 만들 수 있게 첫 줄이 node shebang')
    const link = path.join(tmp('rail-link-'), 'rail')
    symlinkSync(ROOT, link, 'junction')
    const root = repo()
    const r = install(undefined, { cwd: root, file: path.join(link, bin['rail-install']) })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /\[레일 설치\]/, '링크 경로로 불러도 "직접 실행" 으로 알아본다')
    assert.ok(existsSync(path.join(root, '.rail/bin/rail.mjs')))
  })

  test('settings.json 이 깨져 있으면(주석·끝 쉼표) 아무것도 쓰지 않고 까닭과 함께 멈춘다', () => {
    const root = repo()
    put(root, '.claude/settings.json', '{\n  // 내 설정\n  "env": { "A": "1" },\n}\n')
    const before = read(root, '.gitignore')
    const r = install(root)
    assert.equal(r.code, 1)
    assert.match(r.err, /settings\.json 을 읽지 못했습니다: .+\. 고친 뒤 다시 치세요/)
    assert.ok(!existsSync(path.join(root, '.rail')), '레일 파일이 하나도 생기지 않는다')
    assert.ok(!existsSync(path.join(root, 'docs/RAIL.md')))
    assert.equal(read(root, '.gitignore'), before)
    assert.equal(git(root, 'status', '--porcelain', '-uall', '--', '.claude/skills'), '')
  })

  test('레일을 쓰는 레포에 커밋 안 된 변경(레일 기록 빼고)이 있으면 무엇이 바뀌었는지 보이며 거절하고, --force 면 깐다', () => {
    const root = repo()
    install(root)
    commitAll(root)
    put(root, '.rail/state.json', '{"stage":"milestone"}')
    put(root, '.rail/log.jsonl', '{}\n')
    assert.equal(install(root).code, 0, '레일 기록만 바뀐 것은 막지 않는다')
    put(root, 'src/app.mjs', '// 하던 일\n')
    put(root, '.rail/bin/lib/core.mjs', '// 낡은 판\n')
    const r = install(root)
    assert.equal(r.code, 1)
    assert.match(r.err, /커밋 안 된 변경이 2개 있습니다:\n {2}\.rail\/bin\/lib\/core\.mjs\n {2}src\/app\.mjs\n먼저 커밋하거나 치운 뒤 다시 치세요/)
    assert.match(r.err, /--force/)
    assert.equal(read(root, '.rail/bin/lib/core.mjs'), '// 낡은 판\n', '아무것도 덮지 않는다')
    const f = install(root, { flags: ['--force'] })
    assert.equal(f.code, 0, f.err)
    assert.match(f.out, /바꿈 \.rail\/bin\/lib\/core\.mjs/)
  })

  test('작업자가 도는 중이면(열린 worker_start) 거절하고, --force 면 깐다. 닫힌 작업자는 막지 않는다', () => {
    const root = repo()
    install(root)
    put(root, '.rail/state.json', JSON.stringify({ stage: 'milestone', milestone: 'M0', closed: [] }))
    put(root, '.rail/log.jsonl', [{ event: 'worker_start', step: 'M0-1', milestone: 'M0' }, { event: 'worker_start', step: 'M0-2', milestone: 'M0' }].map((e) => JSON.stringify(e)).join('\n') + '\n')
    commitAll(root)
    const r = install(root)
    assert.equal(r.code, 1)
    assert.match(r.err, /작업자 2명이 도는 중입니다\. 끝난 뒤 다시 치세요/)
    assert.equal(install(root, { flags: ['--force'] }).code, 0)
    put(root, '.rail/log.jsonl', read(root, '.rail/log.jsonl') + [{ event: 'worker_closed', step: 'M0-1' }, { event: 'worker_closed', step: 'M0-2' }].map((e) => JSON.stringify(e)).join('\n') + '\n')
    const ok = install(root)
    assert.equal(ok.code, 0, ok.err)
  })

  test('처음 설치(레일 흔적 없음)는 커밋 안 된 변경이 있어도 검사 없이 깐다', () => {
    const root = repo()
    assert.notEqual(git(root, 'status', '--porcelain'), '', '시험 레포에는 커밋 안 된 파일이 있다')
    const r = install(root)
    assert.equal(r.code, 0, r.err)
    assert.ok(existsSync(path.join(root, '.rail/installed.json')))
  })
})
