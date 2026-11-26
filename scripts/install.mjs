#!/usr/bin/env node
// 레일을 레포 하나에 설치·업데이트한다: node scripts/install.mjs <대상 레포>. Node 내장 모듈만 쓰고 셸 명령을 부르지 않는다(macOS·Windows 같은 명령).
// 레일 파일(.rail/bin, .rail/hooks, .claude/skills/rail*)은 늘 새로 쓰고, 시작 틀은 없을 때만 만든다. 상태·기록·기획서는 건드리지 않는다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = (file, args = '') => ({ type: 'command', command: `node "\${CLAUDE_PROJECT_DIR}/.rail/${file}"${args}` })
// 레일 훅: 사건마다 [matcher, 명령, 시간 상한(초)].
export const RAIL_HOOKS = {
  SessionStart: [[null, HOOK('bin/rail.mjs', ' status --hook'), 10], ['compact', HOOK('bin/rail.mjs', ' status --hook --compact'), 10]],
  PreToolUse: [['Edit|Write|MultiEdit|NotebookEdit|Bash', HOOK('hooks/guard-tests.mjs'), 30]],
  Stop: [[null, HOOK('hooks/stop-check.mjs'), 400]],
  PreCompact: [[null, HOOK('hooks/pre-compact.mjs'), 30]]
}
export const RAIL_ALLOW = 'Bash(node .rail/bin/rail.mjs *)'
const isRail = (h) => /\.rail[\\/](?:bin|hooks)[\\/]/.test(h?.command ?? '')
const list = (dir, rel = '') => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`])) : [])

// 설치할 파일: [원본 절대 경로, 대상 상대 경로]. 레일 파일과 없을 때만 만드는 시작 틀로 나눈다.
function plan() {
  const own = [
    ...list(path.join(SRC, 'scripts')).filter((f) => f !== 'install.mjs').map((f) => [path.join(SRC, 'scripts', f), `.rail/bin/${f}`]),
    ...list(path.join(SRC, 'hooks')).filter((f) => f.endsWith('.mjs')).map((f) => [path.join(SRC, 'hooks', f), `.rail/hooks/${f}`]),
    ...list(path.join(SRC, 'skills')).map((f) => [path.join(SRC, 'skills', f), `.claude/skills/${f}`])
  ]
  const seed = list(path.join(SRC, 'templates')).filter((f) => f !== '.gitignore').map((f) => [path.join(SRC, 'templates', f), f])
  return { own, seed }
}
// .claude/settings.json 의 hooks 에서 레일 훅만 빼고 다시 넣는다. 다른 훅과 설정은 그대로 둔다.
export function mergeSettings(s) {
  const out = { ...s, hooks: { ...(s.hooks ?? {}) }, permissions: { ...(s.permissions ?? {}) } }
  for (const [event, entries] of Object.entries(out.hooks)) {
    const kept = (Array.isArray(entries) ? entries : []).map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isRail(h)) })).filter((e) => e.hooks.length)
    if (kept.length) out.hooks[event] = kept
    else delete out.hooks[event]
  }
  for (const [event, rows] of Object.entries(RAIL_HOOKS))
    out.hooks[event] = [...(out.hooks[event] ?? []), ...rows.map(([matcher, h, timeout]) => ({ ...(matcher ? { matcher } : {}), hooks: [{ ...h, timeout }] }))]
  const allow = Array.isArray(out.permissions.allow) ? out.permissions.allow : []
  out.permissions.allow = allow.includes(RAIL_ALLOW) ? allow : [...allow, RAIL_ALLOW]
  return out
}

export function install(target) {
  const T = path.resolve(target)
  if (!fs.existsSync(T) || !fs.statSync(T).isDirectory()) throw new Error(`대상 폴더가 없습니다: ${T}`)
  const changed = []
  const write = (rel, body) => {
    const f = path.join(T, rel)
    const old = fs.existsSync(f) ? fs.readFileSync(f) : null
    if (old && Buffer.compare(old, Buffer.from(body)) === 0) return
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, body)
    changed.push(`${old ? '바꿈' : '새로'} ${rel}`)
  }
  const { own, seed } = plan()
  for (const [src, rel] of own) write(rel, fs.readFileSync(src))
  for (const [src, rel] of seed) if (!fs.existsSync(path.join(T, rel))) write(rel, fs.readFileSync(src))
  // 지난 설치에 있었는데 이번 레일에 없는 파일은 지운다.
  let prev = {}
  try {
    prev = JSON.parse(fs.readFileSync(path.join(T, '.rail/installed.json'), 'utf8'))
  } catch {}
  const now = own.map(([, rel]) => rel)
  for (const rel of (prev.files ?? []).filter((r) => !now.includes(r) && fs.existsSync(path.join(T, r)))) fs.rmSync(path.join(T, rel)), changed.push(`지움 ${rel}`)
  const gi = path.join(T, '.gitignore')
  const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').replace(/\r\n/g, '\n') : ''
  const add = fs.readFileSync(path.join(SRC, 'templates/.gitignore'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() && !have.split('\n').includes(l))
  if (add.length) write('.gitignore', `${have}${have && !have.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
  const sf = path.join(T, '.claude/settings.json')
  write('.claude/settings.json', JSON.stringify(mergeSettings(fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, 'utf8')) : {}), null, 2) + '\n')
  const git = (...a) => spawnSync('git', a, { cwd: SRC, encoding: 'utf8' })
  const commit = git('rev-parse', '--short', 'HEAD').stdout?.trim() || null
  const dirty = commit ? Boolean(git('status', '--porcelain').stdout?.trim()) : null
  if (changed.length || prev.commit !== commit || prev.dirty !== dirty) write('.rail/installed.json', JSON.stringify({ commit, dirty, at: new Date().toISOString(), files: now }, null, 2) + '\n')
  return { target: T, changed, commit, dirty }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  if (!target) {
    process.stderr.write('사용법: node scripts/install.mjs <대상 레포 경로>\n')
    process.exit(2)
  }
  try {
    const r = install(target)
    process.stdout.write(`[레일 설치] ${r.target} — 레일 ${r.commit ?? '(커밋 모름)'}${r.dirty ? ' (커밋 안 된 변경 있음)' : ''}\n${r.changed.length ? r.changed.map((c) => `  ${c}`).join('\n') : '  바뀐 파일 없음'}\n`)
  } catch (e) {
    process.stderr.write(`[레일 설치 실패] ${e.message}\n`)
    process.exit(1)
  }
}
