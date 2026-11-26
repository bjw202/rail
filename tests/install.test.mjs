// 레포마다 설치: node scripts/install.mjs <대상>. 다시 돌리면 업데이트이고, 레일 훅은 한 번만 들어가며, 상태·기획서와 다른 설정은 그대로다.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { denied, git, put, tmp } from './helpers.mjs'

const INSTALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/install.mjs')
const install = (target) => {
  const r = spawnSync(process.execPath, [INSTALL, target], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = (root, rel) => readFileSync(path.join(root, rel), 'utf8')
const settings = (root) => JSON.parse(read(root, '.claude/settings.json'))
const railCommands = (s) => Object.values(s.hooks).flat().flatMap((e) => e.hooks.map((h) => h.command)).filter((c) => c.includes('.rail/'))

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

describe('설치', () => {
  test('레일 파일·스킬·시작 틀을 깔고, settings.json 에 레일 훅과 명령 허용만 더한다', () => {
    const root = repo()
    const r = install(root)
    assert.equal(r.code, 0, r.err)
    for (const f of ['.rail/bin/rail.mjs', '.rail/bin/lib/core.mjs', '.rail/hooks/guard-tests.mjs', '.claude/skills/rail/SKILL.md', '.claude/skills/rail-milestone/workers.md', '.rail/config.json', '.rail/plan/template.md', 'docs/RAIL.md', '.rail/installed.json'])
      assert.ok(existsSync(path.join(root, f)), f)
    assert.ok(!existsSync(path.join(root, '.rail/bin/install.mjs')), '설치 도구는 깔지 않는다')
    const s = settings(root)
    assert.deepEqual([s.env, s.permissions.allow], [{ A: '1' }, ['Bash(npm test)', 'Bash(node .rail/bin/rail.mjs *)']])
    assert.equal(s.hooks.Stop[0].hooks[0].command, 'echo 내 훅', '다른 훅은 그대로')
    assert.deepEqual(railCommands(s).sort(), [
      'node "${CLAUDE_PROJECT_DIR}/.rail/bin/rail.mjs" status --hook',
      'node "${CLAUDE_PROJECT_DIR}/.rail/bin/rail.mjs" status --hook --compact',
      'node "${CLAUDE_PROJECT_DIR}/.rail/hooks/guard-tests.mjs"',
      'node "${CLAUDE_PROJECT_DIR}/.rail/hooks/pre-compact.mjs"',
      'node "${CLAUDE_PROJECT_DIR}/.rail/hooks/stop-check.mjs"'
    ])
    assert.equal(s.hooks.SessionStart[1].matcher, 'compact')
    const gi = read(root, '.gitignore').split('\n')
    assert.deepEqual(gi.slice(0, 3), ['node_modules/', '.orchestration/', '.rail/.lock'], '있는 줄은 그대로, 없는 줄만 더한다')
    assert.equal(gi.filter((l) => l === '.orchestration/').length, 1)
    assert.match(read(root, '.rail/installed.json'), /"files": \[/)
  })

  test('두 번 돌려도 훅·허용·.gitignore 줄이 두 번 들어가지 않고 "바뀐 파일 없음"이다', () => {
    const root = repo()
    install(root)
    const first = read(root, '.claude/settings.json')
    const again = install(root)
    assert.equal(again.code, 0, again.err)
    assert.match(again.out, /바뀐 파일 없음/)
    assert.equal(read(root, '.claude/settings.json'), first)
    assert.equal(railCommands(settings(root)).length, 5)
    assert.equal(read(root, '.gitignore').split('\n').filter((l) => l === '.rail/.lock').length, 1)
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

  test('대상이 없으면 실패하고, 인자가 없으면 사용법을 알린다', () => {
    assert.equal(install(path.join(tmp(), 'nope')).code, 1)
    assert.equal(spawnSync(process.execPath, [INSTALL], { encoding: 'utf8' }).status, 2)
  })
})
