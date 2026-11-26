#!/usr/bin/env node
// 레일을 레포 하나에 설치·업데이트한다: node scripts/install.mjs [대상 레포], 또는 npm link 뒤 그 레포 폴더에서 rail-install. 대상을 안 주면 지금 폴더. Node 내장 모듈만 쓰고 셸 명령을 부르지 않는다(macOS·Windows 같은 명령).
// 레일 파일(.rail/bin, .rail/hooks, .claude/skills/rail*)은 늘 새로 쓰고, 시작 틀은 없을 때만 만든다. 상태·기록·기획서는 건드리지 않는다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// exec 형식(args 가 있으면 셸을 거치지 않음): Windows 에서 훅이 Git Bash 로 돌든 PowerShell 로 돌든 경로 자리표시자가 한 인자로 그대로 간다.
const HOOK = (file, ...args) => ({ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/.rail/${file}`, ...args] })
// 레일 훅: 사건마다 [matcher, 명령, 시간 상한(초)].
export const RAIL_HOOKS = {
  SessionStart: [[null, HOOK('bin/rail.mjs', 'status', '--hook'), 10], ['compact', HOOK('bin/rail.mjs', 'status', '--hook', '--compact'), 10]],
  PreToolUse: [['Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell', HOOK('hooks/guard-tests.mjs'), 30]],
  Stop: [[null, HOOK('hooks/stop-check.mjs'), 400]],
  PreCompact: [[null, HOOK('hooks/pre-compact.mjs'), 30]]
}
// 명령 허용: Bash·PowerShell 도구마다, 경로를 / 로 쓰든 \ 로 쓰든.
export const RAIL_ALLOW = ['Bash', 'PowerShell'].flatMap((t) => [`${t}(node .rail/bin/rail.mjs *)`, `${t}(node .rail\\bin\\rail.mjs *)`])
// 레일 훅: 지금의 exec 형식(args)도, 옛 셸 문자열(command)도 알아본다.
const isRail = (h) => /\.rail[\\/](?:bin|hooks)[\\/]/.test([h?.command, ...(Array.isArray(h?.args) ? h.args : [])].join(' '))
// Windows 에서 Claude Code 가 쓸 Git Bash 가 보이는가: CLAUDE_CODE_GIT_BASH_PATH, PATH 의 git.exe 옆 bin\bash.exe 나 bash.exe(System32 의 WSL 것 빼고), 흔한 설치 자리.
export function hasGitBash(env = process.env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter((d) => d && !/system32/i.test(d))
  const at = [env.CLAUDE_CODE_GIT_BASH_PATH, ...dirs.flatMap((d) => [path.join(d, 'bash.exe'), path.join(d, '..', 'bin', 'bash.exe')]), ...['ProgramFiles', 'ProgramW6432', 'LOCALAPPDATA'].map((k) => env[k] && path.join(env[k], k === 'LOCALAPPDATA' ? 'Programs' : '', 'Git', 'bin', 'bash.exe'))]
  return at.some((f) => f && fs.existsSync(f))
}
export const GIT_BASH_WARNING = `\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n[레일 설치 경고] Git Bash 를 찾지 못했습니다. Git for Windows 를 깔기를 권합니다: 없으면 Claude Code 가 Bash 도구 대신 PowerShell 을 씁니다.\n레일은 그대로 설치했고 시험 잠금은 PowerShell 명령도 보지만, 그 판정은 Bash 쪽보다 거칩니다. 이미 깔았다면 settings.json 의 env 에 CLAUDE_CODE_GIT_BASH_PATH(bash.exe 경로)를 적으세요.\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`
// 실제 경로(심볼릭 링크·Windows junction 을 풀고 대소문자도 맞춘 것). 없는 경로는 그대로.
const real = (f) => {
  try {
    return fs.realpathSync.native(f)
  } catch {
    return path.resolve(f)
  }
}
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
  out.permissions.allow = [...allow, ...RAIL_ALLOW.filter((r) => !allow.includes(r))]
  return out
}

export function install(target) {
  const T = path.resolve(target)
  if (!fs.existsSync(T) || !fs.statSync(T).isDirectory()) throw new Error(`대상 폴더가 없습니다: ${T}`)
  if (real(T) === real(SRC)) throw new Error(`여기는 레일 원본 폴더입니다(${T}). 레일을 깔 제품 레포 폴더로 가서 다시 치세요.`)
  if (!fs.existsSync(path.join(T, '.git'))) {
    let top = path.dirname(T)
    while (!fs.existsSync(path.join(top, '.git')) && path.dirname(top) !== top) top = path.dirname(top)
    throw new Error(fs.existsSync(path.join(top, '.git')) ? `${T} 는 git 레포의 하위 폴더입니다. 레포 맨 위 폴더(${top})에서 다시 치세요.` : `${T} 는 git 레포가 아닙니다. 제품 레포 폴더에서 치거나, 먼저 git init 하세요.`)
  }
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

// 직접 실행됐나: npm link 의 심볼릭 링크나 Windows .cmd 껍데기로 부르면 argv[1] 이 링크 경로라, 양쪽을 실제 경로로 풀어(real) 비교한다.
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  try {
    const r = install(process.argv[2] ?? process.cwd())
    process.stdout.write(`[레일 설치] ${r.target} — 레일 ${r.commit ?? '(커밋 모름)'}${r.dirty ? ' (커밋 안 된 변경 있음)' : ''}\n${r.changed.length ? r.changed.map((c) => `  ${c}`).join('\n') : '  바뀐 파일 없음'}\n`)
    if (process.platform === 'win32' && !hasGitBash()) process.stdout.write(GIT_BASH_WARNING)
  } catch (e) {
    process.stderr.write(`[레일 설치 실패] ${e.message}\n`)
    process.exit(1)
  }
}
