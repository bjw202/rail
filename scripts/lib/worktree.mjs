// 작업자마다 git worktree(isolation=worktree, M14 시험): 만들기, 합치기, 지우기, 남은 것 찾기. 모두 이 코드가 한다.
// 이름 규칙: 브랜치 rail/<step>, 폴더 <worktreeDir>/rail-<step>. git 으로 만들므로 Orca 목록에 없고, git 으로 지운다.
// 안 합쳐진 브랜치는 저절로 지우지 않는다(git branch -d 도 한 번 더 막는다).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BASELINE } from '../../hooks/lib.mjs'
import { isolation, loadConfig } from './config.mjs'
import { F, ROOT, fail, lastLines, out } from './core.mjs'
import { appendLog, loadState, readEvents, withLock } from './state.mjs'

export const MAKER_ROLES = ['feature', 'impl', 'test', 'fix']
export const isolated = (role) => isolation() === 'worktree' && MAKER_ROLES.includes(role)
export const wtDir = (step) => path.resolve(ROOT, loadConfig().worktreeDir || path.join(os.homedir(), 'orca/workspaces', path.basename(ROOT)), `rail-${step}`)
// 레일 기록 파일: 작업자 세션의 훅도 쓰므로 worktree 에서는 git 이 보지 않게 한다(작업자 커밋·합치기에 섞이지 않게).
const RECORDS = ['.rail/state.json', '.rail/log.jsonl', BASELINE]
function g(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, out: r.stdout ?? '', err: lastLines(r.stderr || r.stdout, 3).join(' / ') }
}
// 커밋 안 된 변경(레일 기록과 step 표 빼고: step-start·step-done 이 리더 폴더의 표 상태 칸을 바로 쓴다). withNew 면 새 파일도 센다(worktree 를 지우면 사라지므로).
const dirty = (cwd, withNew) =>
  g(cwd, 'status', '--porcelain', withNew ? '-uall' : '-uno', '--', '.', ...[...RECORDS, 'docs/plan'].map((f) => `:(exclude)${f}`)).out.split('\n').filter(Boolean).map((l) => l.slice(3))

// 레일 이름 규칙의 브랜치와 그 worktree. 폴더가 사라진 기록은 먼저 치운다(prune).
export function leftWorktrees() {
  if (!g(ROOT, 'rev-parse', '--git-dir').ok) return []
  g(ROOT, 'worktree', 'prune')
  const where = new Map()
  let cur = null
  for (const l of g(ROOT, 'worktree', 'list', '--porcelain').out.split('\n'))
    if (l.startsWith('worktree ')) cur = l.slice(9)
    else if (l.startsWith('branch refs/heads/rail/')) where.set(l.slice(18), cur)
  return g(ROOT, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/rail/').out.split('\n').filter(Boolean)
    .map((branch) => ({ step: branch.slice(5), branch, path: where.get(branch) ?? null, merged: g(ROOT, 'merge-base', '--is-ancestor', branch, 'HEAD').ok }))
}
// status·next 에 붙는 한 줄. working = 작업자가 아직 열린 step.
export function leftLine(list, working = new Set()) {
  if (!list.length) return ''
  const what = list.map((w) => `rail-${w.step}(${working.has(w.step) ? '작업 중' : w.merged ? '합쳐짐' : '안 합쳐짐'})`).join(', ')
  const todo = list.some((w) => !w.merged && !working.has(w.step)) ? ' — 안 합쳐진 것은 worktree merge <step> (부딪히면 main 폴더에서 git merge rail/<step> 으로 풀어 커밋한 뒤 다시)' : ''
  return `남은 worktree ${list.length}개: ${what}${todo}${list.some((w) => w.merged) ? ' · 합쳐진 것은 worktree clean' : ''}`
}

export function createWorktree(step) {
  const dir = wtDir(step)
  const branch = `rail/${step}`
  const d = dirty(ROOT, false)
  if (d.length) return { error: `main 폴더에 커밋 안 된 파일이 있어 worktree 에 들어가지 않습니다: ${d.join(', ')}. 먼저 커밋하세요` }
  if (fs.existsSync(dir) || g(ROOT, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).ok) return { error: `${branch} 또는 ${dir} 가 이미 있습니다 (worktree list)` }
  const base = g(ROOT, 'rev-parse', 'HEAD').out.trim()
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  const r = g(ROOT, 'worktree', 'add', '-b', branch, dir, base)
  if (!r.ok) return { error: `git worktree add 실패: ${r.err}` }
  const recs = RECORDS.filter((f) => fs.existsSync(path.join(ROOT, f)) && g(dir, 'ls-files', '--error-unmatch', f).ok)
  for (const f of recs) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f))
  if (recs.length) g(dir, 'update-index', '--skip-worktree', ...recs)
  const info = { step, worktree: dir, branch, base, log_lines: lineCount(path.join(dir, '.rail/log.jsonl')) }
  appendLog('worktree_created', loadState(), info)
  return { ...info, untracked: dirty(ROOT, true) } // main 의 커밋 안 된 새 파일은 worktree 에 없다(경고용)
}
const lineCount = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0)

// 합치기: main 이 깨끗하고 작업자가 다 커밋했을 때만. 앞으로 감기, 안 되면 합치기 커밋. 부딪히면 되돌리고 worktree 를 남긴다.
export function mergeWorktree(step) {
  const w = leftWorktrees().find((x) => x.step === step)
  if (!w) return { ok: true, none: true }
  const st = loadState()
  const refuse = (why, files = []) => (appendLog('gate_blocked', st, { target: 'worktree-merge', step, problems: [why], files }), { ok: false, why })
  const md = dirty(ROOT, false)
  if (md.length) return refuse(`main 폴더에 커밋 안 된 파일: ${md.join(', ')}. 커밋하거나 되돌린 뒤 worktree merge ${step}`, md)
  const wd = w.path ? dirty(w.path, true) : []
  if (wd.length) return refuse(`작업자가 커밋하지 않은 변경: ${wd.join(', ')}. ${w.path} 에서 커밋한 뒤 worktree merge ${step}`, wd)
  if (!w.merged) {
    let r = g(ROOT, 'merge', '--ff-only', w.branch)
    if (!r.ok) r = g(ROOT, 'merge', '--no-ff', '-m', `chore: ${step} 작업자 브랜치 합치기 (${w.branch})`, w.branch)
    if (!r.ok) {
      const files = g(ROOT, 'diff', '--name-only', '--diff-filter=U').out.split('\n').filter(Boolean)
      g(ROOT, 'merge', '--abort')
      return refuse(`합치다 부딪혔습니다${files.length ? `: ${files.join(', ')}` : ` (${r.err})`}. 되돌렸고 worktree 는 남겼습니다. 풀 방법: main 폴더에서 git merge ${w.branch} → 부딪힌 파일을 고쳐 git commit → worktree merge ${step}(합쳐졌으면 지운다)`, files)
    }
  }
  appendLog('worktree_merged', st, { step, branch: w.branch, head: g(ROOT, 'rev-parse', 'HEAD').out.trim() })
  const rm = removeWorktree({ ...w, merged: true }, st)
  return { ok: true, removed: rm.ok, why: rm.why }
}

// 지우기: 합쳐진 것만. 작업자 세션이 worktree 쪽 기록에 남긴 사건(훅의 붙잡음 등)은 main 기록으로 옮긴다.
export function removeWorktree(w, st = loadState()) {
  if (!g(ROOT, 'merge-base', '--is-ancestor', w.branch, 'HEAD').ok) return { ok: false, why: `${w.branch} 가 아직 합쳐지지 않아 지우지 않습니다` }
  let moved = 0
  if (w.path) {
    const wd = dirty(w.path, true)
    if (wd.length) return { ok: false, why: `커밋 안 된 변경이 있어 지우지 않습니다: ${wd.join(', ')}` }
    const made = readEvents().findLast((e) => e.event === 'worktree_created' && e.step === w.step)
    const log = path.join(w.path, '.rail/log.jsonl')
    if (made && fs.existsSync(log)) {
      const extra = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).slice(made.log_lines ?? Infinity)
      const lines = extra.flatMap((l) => { try { return [JSON.stringify({ ...JSON.parse(l), from_worktree: w.step })] } catch { return [] } })
      if (lines.length) withLock(() => fs.appendFileSync(F.log, lines.join('\n') + '\n'))
      moved = lines.length
    }
    const r = g(ROOT, 'worktree', 'remove', '--force', w.path)
    if (!r.ok) return { ok: false, why: `git worktree remove 실패: ${r.err}` }
  }
  const b = g(ROOT, 'branch', '-d', w.branch)
  g(ROOT, 'worktree', 'prune')
  appendLog('worktree_removed', st, { step: w.step, worktree: w.path, branch: w.branch, branch_deleted: b.ok, moved_events: moved })
  return { ok: true }
}
export const cleanMerged = (st) => leftWorktrees().filter((w) => w.merged).map((w) => ({ w, r: removeWorktree(w, st) }))

export function cmdWorktree({ pos }) {
  const [verb, step] = pos
  if (verb === 'merge' && step) {
    const r = withLock(() => mergeWorktree(step))
    if (!r.ok) fail(`[worktree] ${step} 합치지 못했습니다 — ${r.why}`)
    return out(r.none ? `[worktree] ${step} 의 worktree 가 없습니다.` : `[worktree] ${step} 합침${r.removed ? ', worktree 와 브랜치 지움' : ` — 지우지 못함: ${r.why}`}`)
  }
  if (verb === 'clean') {
    const done = withLock(() => cleanMerged(loadState()))
    for (const { w, r } of done) out(`[worktree] rail-${w.step} ${r.ok ? '지움' : `남김 — ${r.why}`}`)
    const left = leftWorktrees()
    return out(left.length ? leftLine(left) : `[worktree] 남은 worktree 가 없습니다.${done.length ? '' : ' (지울 것 없음)'}`)
  }
  if (verb && verb !== 'list') fail('사용법: worktree [list] | worktree merge <step> | worktree clean', 2)
  const left = leftWorktrees()
  out(left.length ? `${leftLine(left)}\n${left.map((w) => `  ${w.branch} ${w.path ?? '(폴더 없음)'}`).join('\n')}\n안 합쳐진 것을 버리는 일은 사람이 정한다: git worktree remove --force <폴더> && git branch -D <브랜치>` : `남은 worktree 없음 (작업 폴더 방식: ${isolation()})`)
}
