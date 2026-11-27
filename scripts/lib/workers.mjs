// 작업자 띄우기와 닫기, 열린 작업자 읽기.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WIN, fail, lastLines, out, read, unquote } from './core.mjs'
import { autonomyOn, workerModel } from './config.mjs'
import { isSettled, orca } from './orca.mjs'
import { isActive, isDone, readPlan } from './plan.mjs'
import { staleGrant } from './stale.mjs'
import { appendLog, loadState, readEvents, sleepMs, withLock } from './state.mjs'
import { createWorktree, isolated, leftWorktrees, mergeWorktree, removeWorktree } from './worktree.mjs'


// 아직 닫지 않은 작업자: worker_start 뒤에 같은 step 의 worker_closed 가 없는 것. 닫힌 마일스톤의 기록은 보지 않는다.
export function openWorkers(st, ev = readEvents()) {
  const open = new Map()
  for (const e of ev) {
    if (typeof e.step !== 'string' || (e.milestone && st.closed.includes(e.milestone))) continue
    if (e.event === 'worker_start') open.set(e.step, e)
    else if (e.event === 'worker_closed') open.delete(e.step)
  }
  return [...open.values()]
}

// ---------- 작업자 띄우기와 닫기 ----------
// 작업자 띄우기·닫기 절차의 원본. Orca CLI 는 orca.mjs 한 곳에서 부르고, Orca 의 동작은 바꾸지 않는다.
// 결과 JSON 안에서 열쇠 key 의 값이 re 에 맞는 첫 문자열.
export function findIn(obj, key, re) {
  if (!obj || typeof obj !== 'object') return null
  if (typeof obj[key] === 'string' && re.test(obj[key])) return obj[key]
  for (const v of Object.values(obj)) {
    const f = findIn(v, key, re)
    if (f) return f
  }
  return null
}
// 창 배치(visualLayouts)의 탭들과, 탭 안 창들의 깊이·생긴 방향.
export function layoutTabs(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) return node.forEach((n) => layoutTabs(n, out)), out
  if (Array.isArray(node.tabs)) for (const t of node.tabs) if (t?.panes) out.push(t)
  for (const [k, v] of Object.entries(node)) if (k !== 'tabs' && k !== 'panes' && v && typeof v === 'object') layoutTabs(v, out)
  return out
}
export function paneLeaves(node, depth = 0, dir = null, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.first || node.second) {
    paneLeaves(node.first, depth + 1, node.direction ?? null, out)
    paneLeaves(node.second, depth + 1, node.direction ?? null, out)
  } else if (typeof node.handle === 'string') out.push({ handle: node.handle, title: node.title ?? '', depth, dir })
  return out
}
export const MAX_TAB_WORKERS = 3
// 균형 규칙: 리더 탭에서 가장 얕은 창을 나누고(같으면 작업자 창 먼저), 그 창이 생긴 방향과 반대로 나눈다.
// 리더가 채팅이라 탭이 없거나, 탭에 작업자가 3명이면 새 탭을 연다(작업자만 있는 탭이 있으면 그 탭을 나눈다).
export function chooseSplit(layout, leader, workerTerms) {
  const tabs = layoutTabs(layout?.result?.visualLayouts ?? [])
  const isWorker = (l) => workerTerms.has(l.handle) || /^M\d+-/.test(l.title)
  const room = (t) => paneLeaves(t.panes).filter((l) => l.handle !== leader).length < MAX_TAB_WORKERS
  const leaderTab = leader ? tabs.find((t) => paneLeaves(t.panes).some((l) => l.handle === leader)) : null
  const tab = [leaderTab, ...tabs.filter((t) => t !== leaderTab && paneLeaves(t.panes).length && paneLeaves(t.panes).every(isWorker))].find((t) => t && room(t))
  if (!tab) return { create: true }
  const leaves = paneLeaves(tab.panes)
  const top = Math.min(...leaves.map((l) => l.depth))
  const shallow = leaves.filter((l) => l.depth === top)
  const target = shallow.find((l) => l.handle !== leader) ?? shallow[0]
  return { handle: target.handle, direction: target.dir === 'vertical' ? 'horizontal' : 'vertical' }
}
// Orca 창에 넣는 작업자 명령. 셸 문법이 다르므로 Windows 는 PowerShell(5.1·7), 그 밖은 sh 계열(bash·zsh)로 쓴다.
// 작업자는 무인 진행을 위해 권한 확인을 끄고 뜬다(README "안전장치").
export const shq = (s, win = WIN) => (win ? `'${String(s).replace(/'/g, "''")}'` : `'${String(s).replace(/'/g, `'\\''`)}'`)
export function agentCommand(agent, name, testEdit = false, { win = WIN, cd = null, model = 'opus' } = {}) {
  const pre = `${cd ? `cd ${shq(cd, win)}${win ? '; ' : ' && '}` : ''}${testEdit ? (win ? "$env:RAIL_ALLOW_TEST_EDIT='1'; " : 'RAIL_ALLOW_TEST_EDIT=1 ') : ''}`
  if (agent === 'codex') return `${pre}codex --dangerously-bypass-approvals-and-sandbox -c check_for_update_on_startup=false`
  return `${pre}claude --model ${/^[\w.-]+$/.test(model) ? model : shq(model, win)} --dangerously-skip-permissions --name ${shq(name, win)}`
}
const EXT = WIN ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : ['']
export const onPath = (bin) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && EXT.some((x) => fs.existsSync(path.join(d, bin + x))))
// 이 마일스톤에서 step 이름과 시험 고치기(RAIL_ALLOW_TEST_EDIT 또는 "시험 고치")가 든 질문에 사람이 허락했으면
// { at, by: 'human' }. 허락 한 번에 작업자 하나다(그 뒤 test_edit 로 띄운 worker_start 가 있으면 다 쓴 것).
// 사람 허락이 없고 staleTests 가 agent 면 판정 작업자의 판정을 본다(stale.mjs: 허락 또는 { refused }).
export function testEditGrant(st, step) {
  const named = new RegExp(`(?:^|[^\\w-])${step}(?![\\w-])`)
  const ev = readEvents().filter((x) => x.milestone === st.milestone)
  let grant = null
  for (const e of ev) {
    const a = unquote(e.text ?? '')
    if (e.event === 'human_answer' && /RAIL_ALLOW_TEST_EDIT|시험\s*고치/.test(e.q) && named.test(e.q))
      grant = /^(?:허락|고쳐|고치|진행|네|예|응|좋|그래|해|ok|yes)/i.test(a) && !/아니|안\s*(?:돼|되|됨|해)|말(?:아|고|자)|하지\s*마|다른\s*방법|거절/.test(a) ? e.t : null
    else if (e.event === 'worker_start' && e.step === step && e.test_edit) grant = null
  }
  return grant ? { at: grant, by: 'human' } : staleGrant(st, step, ev)
}
// 일 이름: --name, 없으면 명세의 첫 "# " 제목(step 으로 시작하지 않으면 앞에 붙인다), 없으면 "<step> <role>".
export function workName(step, role, spec, given) {
  if (typeof given === 'string' && given.trim()) return given.trim()
  const h = (read(spec) ?? '').match(/^#\s+(.+)$/m)?.[1]?.trim()
  const name = h ? (h.startsWith(step) ? h : `${step} ${h}`) : `${step} ${role}`
  return name.length > 48 ? `${name.slice(0, 47)}…` : name
}

export function cmdWorker({ pos, flags }) {
  const [verb, ...steps] = pos
  const usage = '사용법: worker start <step> [<step> ...] --agent claude|codex --role <feature|check|fix|test|impl|review|final-review|rehearsal|stale> [--spec-file <path>] [--name "<일 이름>"] [--leader <term_...>]\n       worker done <step> [<step> ...] [--note "<한 줄>"] [--result ok|fail] [--force]'
  if (!['start', 'done'].includes(verb) || !steps.length) fail(usage, 2)
  if (steps.some((s) => !/^M\d+-[\w-]+$/.test(s) && !(verb === 'done' && /^D-\d+:[\w-]+$/.test(s)))) fail(`step 이름은 M6-2a 꼴입니다(시제품 작업자 닫기는 D-09:p1 꼴): ${steps.join(' ')}`, 2)
  return verb === 'start' ? workerStart(steps, flags, usage) : workerDone(steps, flags)
}

export function workerStart(steps, flags, usage) {
  let agent = flags.agent
  const role = typeof flags.role === 'string' ? flags.role.trim() : ''
  if (!['claude', 'codex'].includes(agent) || !role) fail(usage, 2)
  // Codex 가 없으면 Claude 로 대신 띄운다. 다른 회사 모델의 시각은 없어진다.
  if (agent === 'codex' && !onPath('codex')) {
    agent = 'claude'
    out(`[경고] codex 명령이 PATH 에 없어 ${steps.join(', ')} 를 Claude 작업자로 띄웁니다 (다른 회사 모델 시각 없음)`)
    withLock(() => appendLog('codex_missing', loadState(), { steps, role, note: '다른 회사 모델 시각 없음' }))
  }
  if (flags['spec-file'] && steps.length > 1) fail('--spec-file 은 step 하나일 때만 씁니다. 여러 step 이면 .orchestration/<step>-spec.md 를 읽습니다.', 2)
  // 먼저 모두 확인하고, 하나라도 틀리면 아무 창도 띄우지 않는다.
  const plans = withLock(() => {
    const st = loadState()
    const plan = st.milestone ? readPlan(st.milestone) : null
    const open = openWorkers(st)
    return steps.map((step) => {
      const spec = path.resolve(ROOT, flags['spec-file'] ?? `.orchestration/${step}-spec.md`)
      if (!fs.existsSync(spec)) fail(`[작업자] ${step}: 명세 파일 ${path.relative(ROOT, spec)} 이 없습니다. 먼저 명세를 쓰세요.`)
      const row = plan?.rows.find((r) => r.step === step)
      if (row && st.stage === 'milestone' && !isActive(row.status) && st.step !== step)
        fail(`[작업자] ${step} 는 아직 시작하지 않았습니다. 먼저 step-start ${step} 을 부르세요.`)
      if (row && isDone(row.status)) fail(`[작업자] ${step} 는 이미 끝났습니다 (${row.status}).`)
      const dup = open.find((w) => w.step === step)
      if (dup) fail(`[작업자] ${step} 에는 닫지 않은 작업자가 있습니다 (창 ${dup.terminal}, 일 ${dup.dispatch}). 먼저 worker done ${step} 으로 닫으세요.`)
      return { step, spec, name: workName(step, role, spec, steps.length === 1 ? flags.name : null), grant: testEditGrant(st, step) }
    })
  })
  const leader = typeof flags.leader === 'string' ? flags.leader : /^term_/.test(process.env.ORCA_TERMINAL_HANDLE ?? '') ? process.env.ORCA_TERMINAL_HANDLE : null
  let failed = 0
  for (const p of plans) {
    // isolation=worktree 이고 만드는 역할이면 그 step 의 worktree 를 만들고, 창이 그 폴더에서 시작하게 한다.
    const wt = isolated(role) ? withLock(() => createWorktree(p.step)) : null
    if (wt?.error) {
      failed++
      appendLog('worker_start_failed', loadState(), { step: p.step, agent, role, stage_failed: 'worktree', error: wt.error })
      out(`[작업자 실패] ${p.step}: worktree 를 만들지 못했습니다 (${wt.error}).`)
      continue
    }
    if (wt && !read(p.spec).includes('(레일이 붙임)'))
      fs.appendFileSync(p.spec, `\n\n## 작업 폴더와 커밋 (레일이 붙임, 앞의 "커밋하지 마라"보다 우선)\n- 이 일은 git worktree ${wt.worktree} (브랜치 ${wt.branch}) 에서 한다. main 작업 폴더는 고치지 마라.\n- 끝나면 이 step 의 파일만 git add 해서 이 브랜치에 커밋하라(conventional commits). 푸시·합치기는 하지 마라. 커밋 안 된 변경이 남으면 리더가 합치지 못한다.\n`)
    const undo = () => wt && withLock(() => removeWorktree({ step: p.step, branch: wt.branch, path: wt.worktree }))
    const g = p.grant?.at ? p.grant : null
    if (p.grant?.refused) out(`[시험 고치기] ${p.step}: ${p.grant.refused}`)
    if (g?.by === 'stale' && !read(p.spec).includes(`(판정 ${g.file})`))
      fs.appendFileSync(p.spec, `\n\n## 고쳐도 되는 시험 줄 (레일이 붙임, 판정 ${g.file})\n${g.lines.map((l) => `- ${l.file}:${l.line} — ${l.changed_by} 로 바뀐 동작(옛 값: ${l.pinned})`).join('\n')}\n이 줄들만 새 동작에 맞게 고친다. 판정 파일의 keep 줄과 다른 시험은 고치지 말고, 걸리면 코드를 고치거나 worker_done 에 까닭을 적는다.\n`)
    const cmd = agentCommand(agent, p.name, !!g, { cd: wt?.worktree, model: workerModel(role) })
    // 창 고르기와 나누기는 잠금 안에서 한다(동시에 불린 두 명령이 같은 창을 나누지 않게).
    const made = withLock(() => {
      const st = loadState()
      const terms = new Set(openWorkers(st).map((w) => w.terminal).filter(Boolean))
      const layout = orca(['terminal', 'list', '--worktree', 'current', '--include-visual-layouts', '--json'], 30_000)
      const pick = layout.ok ? chooseSplit(layout.json, leader, terms) : { create: true }
      const tab = (how = '새 탭') => {
        const r = orca(['terminal', 'create', '--worktree', 'current', '--title', p.name, '--command', cmd, '--json'])
        return { r, handle: findIn(r.json, 'handle', /^term_/), how, tab: true }
      }
      if (pick.create) return tab()
      const base = ['terminal', 'split', '--terminal', pick.handle, '--direction', pick.direction, '--command', cmd, '--json']
      let r = orca(base)
      // 시간 초과는 실패가 아니다. 오류의 --retry-split <leafId>(없으면 "pane <leafId> in tab")로 같은 창을 기다린다. 새로 나누지 않는다.
      const leaf = r.text.match(/--retry-split\s+([\w-]+)/)?.[1] ?? r.text.match(/pane\s+([\w-]+)\s+in tab/)?.[1]
      for (let i = 0; !r.ok && leaf && i < 2; i++) r = orca([...base, '--retry-split', leaf])
      if (r.ok) return { r, handle: findIn(r.json, 'handle', /^term_/), how: `${pick.handle} 를 ${pick.direction === 'vertical' ? '좌우' : '위아래'}로 나눔` }
      // 끝내 나누지 못하면 그 사이 생긴 창(그 leafId 의 창, leafId 를 모르면 목록에 새로 생긴 창이 하나일 때 그 창)을 닫고,
      // 새 탭(--leader none 과 같은 길)으로 한 번 다시 띄운다. 창이 늦게 열릴 수 있어 leafId 를 알면 3초씩 두 번 더 찾는다.
      const before = new Set((layout.json?.result?.terminals ?? []).map((x) => x.handle))
      let orphans = []
      for (let i = 0; i < (leaf ? 3 : 1) && !orphans.length; i++) {
        if (i) sleepMs(3000)
        const rows = (orca(['terminal', 'list', '--worktree', 'current', '--json'], 30_000).json?.result?.terminals ?? []).filter((x) => typeof x.handle === 'string' && !before.has(x.handle) && !terms.has(x.handle))
        orphans = rows.some((x) => leaf && x.leafId === leaf) ? rows.filter((x) => x.leafId === leaf) : rows.length === 1 ? rows : []
      }
      const closed = orphans.filter((x) => orca(['terminal', 'close', '--terminal', x.handle, '--json'], 30_000).ok).map((x) => x.handle)
      const note = `리더 탭 나누기 실패(${r.error}), 그 사이 생긴 창 ${closed.length ? `${closed.join(', ')} 닫음` : leaf ? `못 찾음(leafId ${leaf}: 늦게 열리면 orca terminal list 로 찾아 닫는다)` : '없음'}`
      return { ...tab(`새 탭 — ${note}`), splitError: r.error }
    })
    if (!made.r.ok || !made.handle) {
      failed++
      undo()
      appendLog('worker_start_failed', loadState(), { step: p.step, agent, role, stage_failed: 'split', error: made.r.error ?? '새 창 핸들이 없습니다', ...(made.splitError ? { split_error: made.splitError } : {}) })
      out(`[작업자 실패] ${p.step}: 창을 열지 못했습니다 (${made.r.error ?? '새 창 핸들이 없습니다'}${made.splitError ? ` · ${made.how}` : ''}).`)
      continue
    }
    const term = made.handle
    orca(['terminal', 'set-pane-title', '--terminal', term, '--title', p.name, '--json'], 30_000)
    const wait = orca(['terminal', 'wait', '--terminal', term, '--for', 'tui-idle', '--timeout-ms', '60000', '--json'], 75_000)
    // 업데이트를 묻는 화면에서 멈추면 Esc 로 건너뛴다. 업데이트는 사람이 따로 한다.
    if (/agent-update-prompt/.test(wait.text)) orca(['terminal', 'send', '--terminal', term, '--text', '\x1b', '--json'], 30_000)
    // "이 폴더를 믿습니까?" 화면(Orca tui-idle 결과의 blockedReason agent-trust-workspace·codex-trust-workspace)이면 일을 맡기지 않고 실패로 적는다.
    // 믿음은 보안 결정이라 레일이 고르지 않는다. 사람이 있으면(자율 아님, worktree 아님) 그 창을 남겨 거기서 고르게 하고, 아니면 닫는다.
    const trust = wait.text.match(/[\w-]*trust-workspace/)?.[0]
    if (trust) {
      const keep = !autonomyOn() && !wt
      const c = keep ? null : orca(['terminal', 'close', '--terminal', term, '--json'], 30_000)
      failed++
      undo()
      appendLog('worker_start_failed', loadState(), { step: p.step, agent, role, terminal: term, stage_failed: 'trust', error: trust, pane_closed: c?.ok ?? false })
      out(`[작업자 실패] ${p.step}: 작업자 창 ${term} 이 "이 폴더를 믿습니까?" 화면에 멈췄습니다 (Orca: ${trust}). 레일은 믿음을 대신 고르지 않습니다. ${keep ? `주인이 그 창에서 믿음을 고른 뒤 창을 닫고(orca terminal close --terminal ${term}) 다시 worker start 하거나, ` : `창은 ${c.ok ? '닫았습니다' : `닫지 못했습니다(${c.error})`}. `}주인이 리더 Claude 를 그 폴더(${wt?.worktree ?? ROOT})에서 한 번 열어 믿게 한 뒤 다시 worker start 합니다. 주인에게 이 줄을 그대로 전한다.`)
      continue
    }
    const ws = orca(['orchestration', 'worker-start', '--spec-file', p.spec, '--terminal', term, '--worktree', 'current', '--task-title', p.name, '--json'], 120_000)
    const dispatch = findIn(ws.json, 'dispatchId', /^ctx_/)
    if (!ws.ok || !dispatch) {
      // 일을 맡기지 못한 창은 그 창 하나만 닫는다.
      const c = orca(['terminal', 'close', '--terminal', term, '--json'], 30_000)
      failed++
      undo()
      appendLog('worker_start_failed', loadState(), { step: p.step, agent, role, terminal: term, stage_failed: 'worker-start', error: ws.error ?? 'dispatchId 가 없습니다', pane_closed: c.ok })
      out(`[작업자 실패] ${p.step}: 일을 맡기지 못했습니다 (${ws.error ?? 'dispatchId 가 없습니다'}). 창 ${term} 은 ${c.ok ? '닫았습니다' : `닫지 못했습니다(${c.error})`}.${/omit --on and --terminal/.test(ws.text) ? ' 리더 자신이 작업자라서 --terminal 을 쓸 수 없습니다. 코디네이터에게 알리세요.' : ''}`)
      continue
    }
    withLock(() => {
      const st = loadState()
      const data = { step: p.step, agent, role, terminal: term, dispatch, name: p.name, spec: path.relative(ROOT, p.spec).split(path.sep).join('/'), via: 'worker start', ...(wt ? { worktree: wt.worktree, branch: wt.branch } : {}), ...(g ? { test_edit: true, allowed_at: g.at, allowed_by: g.by, ...(g.by === 'stale' ? { stale_file: g.file, judged_by: g.judge, stale_lines: g.lines } : {}) } : {}) }
      appendLog('worker_start', st, data)
    })
    out(`[작업자] ${p.step} 시작 — ${agent}, ${role}, 창 ${term} (${made.how}), 일 ${dispatch}, 이름 "${p.name}"${made.tab ? `\n[새 탭] 리더 탭을 나누지 못해 새 탭 "${p.name}" 에 띄웠습니다. 주인에게 이 탭 이름을 한 줄로 알린다` : ''}${wt ? ` · worktree ${wt.worktree} (브랜치 ${wt.branch})${wt.untracked.length ? `\n[경고] main 의 커밋 안 된 새 파일은 worktree 에 없습니다: ${wt.untracked.join(', ')}` : ''}` : ''}${g ? (g.by === 'stale' ? ` · 판정으로 허락한 시험 고치기(RAIL_ALLOW_TEST_EDIT=1, ${g.file}, 줄 ${g.lines.length}개)` : ` · 사람이 허락한 시험 고치기(RAIL_ALLOW_TEST_EDIT=1, ${g.at} 답)`) : ''}`)
  }
  if (failed) process.exitCode = 1
}

export function workerDone(steps, flags) {
  const note = typeof flags.note === 'string' ? flags.note.trim() : ''
  if (flags.result !== undefined && !['ok', 'fail'].includes(flags.result)) fail('--result 는 ok 또는 fail 입니다.', 2)
  const targets = withLock(() => {
    const open = openWorkers(loadState())
    return steps.map((step) => open.find((w) => w.step === step) ?? fail(`[작업자] ${step} 에 기록된 열린 작업자가 없습니다 (worker start 로 띄운 것만 닫습니다).`))
  })
  let failed = 0
  for (const w of targets) {
    // 1) 결과부터 확보 2) 끝났는지 확인 3) 그 창 하나만 닫기(--tab, --all 은 쓰지 않는다) 4) 기록.
    const report = w.dispatch ? orca(['orchestration', 'worker-read', '--dispatch', w.dispatch, '--source', 'auto', '--json'], 60_000) : null
    const show = w.dispatch ? orca(['orchestration', 'worker-show', '--dispatch', w.dispatch, '--json'], 30_000) : null
    const state = show?.json?.result?.state ?? null
    const settled = isSettled(show)
    if (!settled && flags.force !== true) {
      failed++
      out(`[작업자] ${w.step}: 아직 끝나지 않았습니다 (${show?.ok ? `state ${state ?? '?'}, stage ${show.json?.result?.stage ?? '?'}` : `확인 실패: ${show?.error ?? 'dispatch 없음'}`}). 일하는 창은 닫지 않습니다. 끝난 뒤 다시 부르거나, 사람이 정했으면 --force.`)
      continue
    }
    if (report?.ok) out(`[작업자 보고] ${w.step}\n${lastLines(report.json ? JSON.stringify(report.json.result ?? report.json, null, 2) : report.text, 40).join('\n')}`)
    // 새 작업 공간에 띄운 시제품 작업자는 창 핸들이 없다. 그 일의 창을 놓아 준다(worker-release).
    const close = w.terminal ? orca(['terminal', 'close', '--terminal', w.terminal, '--json'], 30_000) : w.proto && w.dispatch ? orca(['orchestration', 'worker-release', '--dispatch', w.dispatch, '--json'], 30_000) : { ok: false, error: '창 핸들이 없습니다' }
    const result = flags.result ?? (state === 'failed' ? 'fail' : 'ok')
    withLock(() => {
      const st = loadState()
      appendLog('worker_done', st, { step: w.step, result, ...(note ? { note } : {}), dispatch: w.dispatch ?? null, state, via: 'worker done', ...(settled ? {} : { forced: true }) })
      appendLog('worker_closed', st, { step: w.step, terminal: w.terminal ?? null, dispatch: w.dispatch ?? null, ...(close.ok ? {} : { close_error: close.error }) })
    })
    out(`[작업자] ${w.step} 끝 (${result}) — 창 ${w.terminal ?? '(새 작업 공간)'} ${close.ok ? '닫음' : `닫기 실패(${close.error}), 기록은 남김`}`)
    // worktree 작업자: 끝났으면 곧바로 main 폴더에 합치고 worktree 와 브랜치를 지운다. 실패면 합치지 않고 남긴다.
    if (!w.branch || !leftWorktrees().some((x) => x.step === w.step)) continue
    if (result !== 'ok' || !settled) {
      out(`[worktree] ${w.step}: 작업자 결과가 ${settled ? result : '끝나지 않음(--force)'}라 합치지 않고 남겼습니다 (worktree merge ${w.step} 로 합치거나, 버리는 일은 사람이 정한다).`)
      continue
    }
    const m = withLock(() => mergeWorktree(w.step))
    if (!m.ok) failed++
    out(m.ok ? `[worktree] ${w.step} 합침${m.removed ? ', worktree 와 브랜치 지움' : ` — 지우지 못함: ${m.why}`}` : `[worktree 합치기 거절] ${w.step}: ${m.why}`)
  }
  if (failed) process.exitCode = 1
}
