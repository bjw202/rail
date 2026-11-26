// 시식용 시제품 (2.4판).
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { F, ROOT, fail, gitIn, isGitTop, now, out, read, today, usd } from './core.mjs'
import { cardFile, decisionStatus, items, section } from './docs.mjs'
import { appendLog, loadState, readEvents, saveState, withLock } from './state.mjs'
import { orca } from './orca.mjs'
import { findIn, openWorkers } from './workers.mjs'

// ---------- 시식용 시제품 (2.4판) ----------
// 화면·배치·속도처럼 봐야 아는 결정은 카드에 "시제품: 예", "## 변주"(2~3개), "## 스크린샷"(찍을 화면)을 둔다.
// 변주마다 새 작업 공간에 작업자를 띄워 버릴 시제품을 실제 데이터로 만들고, 기록이 다 모이면 카드에 표와 비교 페이지를 붙여 한 번 묻는다.
export const PROTO_DIR = path.join(ROOT, '.rail/proto')
export const relRoot = (f) => path.relative(ROOT, f).split(path.sep).join('/')
export const pairs = (lines) =>
  items(lines).flatMap((l) => {
    const m = l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').match(/^`?([A-Za-z0-9][\w.-]*)`?\s*[:：]\s*(\S.*)$/)
    return m ? [{ name: m[1], desc: m[2].trim() }] : []
  })
export function protoCard(id) {
  const file = cardFile(id)
  const text = file ? read(path.join(F.decisions, file)) : null
  if (!text) return null
  const sec = (re) => section(text, re)
  return {
    id, file, text,
    on: /^\s*(?:[-*]\s*)?시제품\s*[:：]\s*예/m.test(text),
    title: text.match(/^#\s+(.+)$/m)?.[1].trim() ?? id,
    milestone: text.match(/^\s*(?:[-*]\s*)?마일스톤\s*[:：]\s*(M\d+)/m)?.[1] ?? null,
    variants: pairs(sec(/^#+\s*변주\s*$/)),
    shots: pairs(sec(/^#+\s*스크린샷\s*$/)),
    question: sec(/^#+\s*질문\s*$/).join('\n').trim(),
    extra: sec(/^#+\s*시제품 지시\s*$/).join('\n').trim()
  }
}
export function cardProblems(c, id) {
  if (!c) return [`${id} 결정 카드 파일이 없습니다`]
  const p = []
  if (!c.on) p.push(`${id} 에 "시제품: 예" 줄이 없습니다 (화면·배치·속도처럼 봐야 아는 결정만 시제품을 붙입니다)`)
  if (c.variants.length < 2 || c.variants.length > 3) p.push(`"## 변주" 절에 변주가 2~3개여야 합니다 (지금 ${c.variants.length}개, "- p1-grid: 한두 줄 설명" 꼴)`)
  if (!c.shots.length) p.push('"## 스크린샷" 절에 찍을 화면이 없습니다 ("- d-1124.png: 2026-11-24, 폭 1280" 꼴)')
  return p
}
export const protoLimits = () => {
  const p = loadConfig().proto ?? {}
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return { maxMinutes: num(p.maxMinutes, 15), maxUSD: num(p.maxUSD, 3) }
}
export const lastOf = (ev, id, v, event) => ev.findLast((e) => e.event === event && e.proto === id && e.variant === v)
// 기록(proto_record)이 없는 변주.
export const protoMissing = (c, ev = readEvents()) => c.variants.map((v) => v.name).filter((v) => !lastOf(ev, c.id, v, 'proto_record'))
export const protoFail = (st, via, id, head, p) => (appendLog('gate_blocked', st, { target: 'proto', via, proto: id, problems: p }), fail(`[시제품] ${head}. 빠진 것:\n${p.map((x) => `  - ${x}`).join('\n')}`))

// status 의 다음 할 일(결정 단계).
export function protoNext(id) {
  const c = protoCard(id)
  if (!c?.on) return null
  const ev = readEvents()
  const open = openWorkers(loadState(), ev).filter((w) => w.proto === id)
  const miss = protoMissing(c, ev)
  if (open.length) return `시제품 작업자 진행 중 (${open.map((w) => w.step).join(', ')}) — 끝나는 대로 worker done <D-xx:변주> 와 proto record ${id} <변주>`
  if (miss.length && !ev.some((e) => e.event === 'worker_start' && e.proto === id)) return `시제품 만들기 — proto start ${id} (변주 ${c.variants.length}개를 새 작업 공간에 띄웁니다)`
  if (miss.length) return `시제품 기록 남기기 — proto record ${id} <변주> (남은 변주: ${miss.join(', ')})`
  if (!ev.some((e) => e.event === 'proto_card' && e.proto === id)) return `시제품 결과를 카드에 붙이고 묻기 — proto card ${id}`
  return null
}

export function cmdProto({ pos, flags }) {
  const [verb, id, ...rest] = pos
  const usage = '사용법: proto start <D-xx> [--agent claude|codex] [--base main] | proto record <D-xx> <변주> [--file <결과 json>] | proto card <D-xx> | proto pick <D-xx> <변주> [<변주> ...]'
  if (!['start', 'record', 'card', 'pick'].includes(verb) || !/^D-\d+$/.test(id ?? '')) fail(usage, 2)
  if (verb === 'start') return protoStart(id, flags)
  if (verb === 'record') return withLock(() => protoRecord(id, rest[0], flags, usage))
  if (verb === 'card') return withLock(() => protoCardWrite(id))
  return protoPick(id, rest, usage)
}

export function protoSpec(c, v, dir, lim, base) {
  const tpl = read(path.join(PROTO_DIR, 'template.md'))
  if (!tpl) fail('[시제품] 공통 틀 .rail/proto/template.md 가 없습니다')
  const example = { shots: c.shots.map((s) => s.name), measured: { [`${c.shots[0].name} 뜨는 시간`]: '1.2초' }, good: ['…', '…'], bad: ['…', '…'], minutes: 9, usd: null }
  const vals = {
    id: c.id, card: `docs/decisions/${c.file}`, title: c.title, question: c.question || c.title, variant: v.name, desc: v.desc,
    others: c.variants.filter((x) => x !== v).map((x) => `${x.name}(${x.desc})`).join(', '), extra: c.extra || '(카드에 더 적은 것 없음)',
    base, minutes: lim.maxMinutes, usd: lim.maxUSD, dir, result: path.join(dir, 'result.json'), example: JSON.stringify(example),
    shots: c.shots.map((s) => `   - \`${s.name}\` — ${s.desc}`).join('\n')
  }
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? String(vals[k]) : m))
}
// 변주마다 Orca 의 새 작업 공간(new-child)에 작업자를 띄운다. 시제품은 같은 파일을 서로 다르게 고치므로 작업 공간을 함께 쓰지 않는다.
export function protoStart(id, flags) {
  const st = loadState()
  const c = protoCard(id)
  const p = cardProblems(c, id)
  if (c && decisionStatus(id).ok) p.push(`${id} 는 이미 결정됐습니다`)
  const open = openWorkers(st).filter((w) => w.proto === id)
  if (open.length) p.push(`닫지 않은 시제품 작업자가 있습니다: ${open.map((w) => w.step).join(', ')} (worker done 으로 닫기)`)
  if (p.length) protoFail(st, 'start', id, `${id} 시제품을 시작할 수 없습니다`, p)
  const agent = flags.agent ?? 'claude'
  if (!['claude', 'codex'].includes(agent)) fail('--agent 는 claude 또는 codex 입니다.', 2)
  const base = typeof flags.base === 'string' ? flags.base : 'main'
  const baseSha = isGitTop() ? gitIn(['rev-parse', base]).out.trim() || null : null
  const lim = protoLimits()
  let failed = 0
  for (const v of c.variants) {
    const dir = path.join(PROTO_DIR, id, v.name)
    fs.mkdirSync(dir, { recursive: true })
    const spec = path.join(dir, 'spec.md')
    fs.writeFileSync(spec, protoSpec(c, v, dir, lim, base))
    const name = `proto-${id}-${v.name}`
    const step = `${id}:${v.name}`
    const ws = orca(['orchestration', 'worker-start', '--spec-file', spec, '--worktree', 'new-child', '--name', name, '--base-branch', base, '--agent', agent, '--task-title', `${id} 시제품 ${v.name}`, '--json'], 180_000)
    const dispatch = findIn(ws.json, 'dispatchId', /^ctx_/)
    if (!ws.ok || !dispatch) {
      failed++
      appendLog('worker_start_failed', loadState(), { step, proto: id, variant: v.name, agent, role: 'proto', stage_failed: 'worker-start', error: ws.error ?? 'dispatchId 가 없습니다' })
      out(`[시제품 실패] ${step}: 작업자를 띄우지 못했습니다 (${ws.error ?? 'dispatchId 가 없습니다'}).`)
      continue
    }
    let worktree = findIn(ws.json, 'worktreePath', /^\//) ?? findIn(ws.json, 'path', /^\//)
    let branch = shortBranch(findIn(ws.json, 'branch', /\S/))
    // 2.5판: 응답에 경로나 브랜치가 없으면 Orca 의 작업 공간 목록에서 이름으로 찾는다(정리에 쓴다). 그래도 없으면 null.
    if (!worktree || !branch) {
      const found = protoWorktree(name)
      worktree ??= found?.path ?? null
      branch ??= found?.branch ?? null
    }
    withLock(() => appendLog('worker_start', loadState(), { step, agent, role: 'proto', dispatch, name, spec: relRoot(spec), worktree, branch, base_sha: baseSha, proto: id, variant: v.name, via: 'proto start' }))
    out(`[시제품] ${step} 시작 — 새 작업 공간 ${worktree ?? name}${branch ? ` (브랜치 ${branch})` : ''}, 일 ${dispatch}, 지시서 ${relRoot(spec)}`)
  }
  if (failed) process.exitCode = 1
}

// 작업자 결과 JSON: { shots:[변주 폴더 안 파일], measured:{이름:값}, good:[2+], bad:[2+], minutes:숫자, usd:숫자|null|"모름" }
export function protoRecord(id, v, flags, usage) {
  const st = loadState()
  const c = protoCard(id)
  if (!c?.on) fail(`[시제품] ${id} 는 시제품 카드가 아닙니다 ("시제품: 예" 없음).`)
  if (!v || !c.variants.some((x) => x.name === v)) fail(`${usage}\n${id} 의 변주: ${c.variants.map((x) => x.name).join(', ')}`, 2)
  const dir = path.join(PROTO_DIR, id, v)
  const file = path.resolve(ROOT, typeof flags.file === 'string' ? flags.file : path.join(dir, 'result.json'))
  let r = null
  try {
    r = JSON.parse(read(file) ?? 'null')
  } catch (e) {
    protoFail(st, 'record', id, `${relRoot(file)} 를 읽지 못했습니다`, [`JSON 이 아닙니다: ${e.message}`])
  }
  const strs = (x, n) => Array.isArray(x) && x.length >= n && x.every((s) => typeof s === 'string' && s.trim())
  const inDir = (s) => {
    const f = path.resolve(dir, s)
    return !path.relative(dir, f).startsWith('..') && fs.existsSync(f)
  }
  const p = []
  if (!r || typeof r !== 'object' || Array.isArray(r)) p.push(`${relRoot(file)} 가 없거나 JSON 객체가 아닙니다`)
  else {
    if (!strs(r.shots, 1)) p.push('shots: 스크린샷 파일 목록이 없습니다')
    else for (const s of r.shots) if (!inDir(s)) p.push(`shots: ${s} 가 ${relRoot(dir)}/ 안에 없습니다`)
    if (!r.measured || typeof r.measured !== 'object' || Array.isArray(r.measured) || !Object.keys(r.measured).length) p.push('measured: 잰 값이 없습니다 ({"d-1124.png 뜨는 시간": "1.2초"} 꼴)')
    if (!strs(r.good, 2)) p.push('good: 좋은 점이 2개 있어야 합니다')
    if (!strs(r.bad, 2)) p.push('bad: 거슬린 점이 2개 있어야 합니다')
    if (typeof r.minutes !== 'number' || !(r.minutes >= 0)) p.push('minutes: 걸린 분이 숫자가 아닙니다')
    if (!(r.usd === null || r.usd === '모름' || (typeof r.usd === 'number' && r.usd >= 0))) p.push('usd: 비용은 숫자이거나 모르면 null 입니다')
  }
  if (p.length) protoFail(st, 'record', id, `${id} ${v} 의 기록을 받을 수 없습니다`, p)
  const shots = r.shots.map((s) => path.relative(dir, path.resolve(dir, s)).split(path.sep).join('/'))
  const rec = { shots, measured: r.measured, good: r.good, bad: r.bad, minutes: r.minutes, usd: typeof r.usd === 'number' ? r.usd : null, missing: c.shots.map((s) => s.name).filter((n) => !shots.includes(n)) }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(rec, null, 2) + '\n')
  appendLog('proto_record', st, { proto: id, variant: v, ...rec })
  const left = protoMissing(c)
  out(`[시제품] ${id} ${v} 기록 — 스크린샷 ${shots.length}장${rec.missing.length ? ` (빠진 화면: ${rec.missing.join(', ')})` : ''}, ${rec.minutes}분, 비용 ${rec.usd === null ? '모름' : usd(rec.usd)}`)
  out(left.length ? `[시제품] 남은 변주: ${left.join(', ')}` : `[시제품] 모든 변주의 기록이 모였습니다. 다음: proto card ${id}`)
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
export const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ')
// 기록이 다 모이면: 카드 아래에 변주별 표를 붙이고(다시 부르면 바꿔 씀), 비교 페이지 compare.html 을 만들고, 결정 질문을 연다.
export function protoCardWrite(id) {
  const st = loadState()
  const c = protoCard(id)
  if (!c?.on) fail(`[시제품] ${id} 는 시제품 카드가 아닙니다 ("시제품: 예" 없음).`)
  const ev = readEvents()
  const miss = protoMissing(c, ev)
  if (miss.length) protoFail(st, 'card', id, `${id} 의 시제품 기록이 다 모이지 않았습니다`, miss.map((v) => `${v}: proto record ${id} ${v}`))
  const rows = c.variants.map((v) => ({ v, rec: lastOf(ev, id, v.name, 'proto_record') }))
  const shotPath = (v, s) => `.rail/proto/${id}/${v}/${s}`
  const cost = (r) => `${r.rec?.minutes ?? '?'}분 · ${typeof r.rec?.usd === 'number' ? usd(r.rec.usd) : '비용 모름'}`
  const old = section(c.text, /^#+\s*시제품 결과/).find((l) => /^\s*-\s*공통 문제\s*[:：]/.test(l) && !/리더가 한 줄로/.test(l))
  const table = [
    `## 시제품 결과 (proto card, ${today()})`,
    `비교 페이지: \`.rail/proto/${id}/compare.html\` (스크린샷은 git 에 넣지 않습니다)`,
    '',
    '| 변주 | 설명 | 잰 값 | 좋은 점 | 거슬린 점 | 시간·비용 | 스크린샷 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.v.name} | ${cell(r.v.desc)} | ${cell(Object.entries(r.rec?.measured ?? {}).map(([k, x]) => `${k} ${x}`).join('; ') || '없음')} | ${cell((r.rec?.good ?? []).join('; ') || '없음')} | ${cell((r.rec?.bad ?? []).join('; ') || '없음')} | ${cell(cost(r))} | ${(r.rec?.shots ?? []).map((s) => shotPath(r.v.name, s)).join(', ') || '없음'} |`),
    '',
    old ?? '- 공통 문제: (리더가 한 줄로 적는다 — 여러 변주의 거슬린 점에 같은 말이 나온 것)',
    '- 질문: 어느 변주로 할까요(또는 섞어서)?',
    ''
  ].join('\n')
  const lines = c.text.split('\n')
  const at = lines.findIndex((l) => /^#+\s*시제품 결과/.test(l))
  const end = at < 0 ? -1 : lines.findIndex((l, i) => i > at && /^##?\s/.test(l))
  const body = at < 0 ? `${c.text.replace(/\s*$/, '')}\n\n${table}` : [...lines.slice(0, at), table.trimEnd(), ...(end < 0 ? [''] : ['', ...lines.slice(end)])].join('\n')
  fs.writeFileSync(path.join(F.decisions, c.file), body)
  const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(id)} 시제품 비교</title>
<style>:root{--bg:#fff;--fg:#1d1d1f;--mute:#6e6e73;--line:#d2d2d7}@media (prefers-color-scheme:dark){:root{--bg:#161617;--fg:#f5f5f7;--mute:#a1a1a6;--line:#3a3a3c}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
section{border:1px solid var(--line);border-radius:8px;padding:12px}h2{margin:0 0 4px}p,li{color:var(--mute)}img{width:100%;border:1px solid var(--line);border-radius:4px}figure{margin:8px 0}figcaption{font-size:13px;color:var(--mute)}</style></head><body>
<h1>${esc(c.title)}</h1><p>${esc(c.question)}</p><p><b>어느 변주로 할까요(또는 섞어서)?</b></p><div class="grid">
${rows.map((r) => `<section><h2>${esc(r.v.name)}</h2><p>${esc(r.v.desc)}</p><p>${esc(cost(r))}</p>
<ul>${Object.entries(r.rec?.measured ?? {}).map(([k, x]) => `<li>${esc(k)}: ${esc(x)}</li>`).join('')}</ul>
<b>좋은 점</b><ul>${(r.rec?.good ?? []).map((g) => `<li>${esc(g)}</li>`).join('')}</ul><b>거슬린 점</b><ul>${(r.rec?.bad ?? []).map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
${(r.rec?.shots ?? []).map((s) => `<figure><img src="${esc(`${r.v.name}/${s}`)}" alt="${esc(s)}" loading="lazy"><figcaption>${esc(s)} — ${esc(c.shots.find((x) => x.name === s)?.desc ?? '')}</figcaption></figure>`).join('\n')}</section>`).join('\n')}
</div></body></html>\n`
  fs.mkdirSync(path.join(PROTO_DIR, id), { recursive: true })
  fs.writeFileSync(path.join(PROTO_DIR, id, 'compare.html'), page)
  appendLog('proto_card', st, { proto: id, variants: rows.map((r) => r.v.name), file: `docs/decisions/${c.file}` })
  out(`[시제품] docs/decisions/${c.file} 아래에 변주 ${rows.length}개의 표를 붙이고 .rail/proto/${id}/compare.html 을 만들었습니다. 공통 문제 한 줄은 리더가 적습니다.`)
  const q = `어느 변주로 할까요(또는 섞어서)? ${id} ${c.title} — 시제품 ${rows.map((r) => r.v.name).join(', ')} 의 실제 화면: .rail/proto/${id}/compare.html`
  if (st.human_ask) return out(`[시제품] 이미 열린 질문이 있어 새로 묻지 않았습니다: "${st.human_ask.q}". 답을 받은 뒤 ask "${q}" --kind decide`)
  st.human_ask = { q, kind: 'decide', at: now(), proto: id }
  st.waiting_for = 'human'
  saveState(st)
  appendLog('human_ask', st, { q, kind: 'decide', proto: id })
  out(`[질문] ${q}`)
}

// 사람이 고르고 기획서 그 줄이 "결정: 선택함" 이 된 뒤: 고른 변주의 스크린샷을 .rail/reference/Mx/ 로 옮기고(git 에 넣는다), 시제품 작업 공간과 브랜치를 지운다.
export function protoPick(id, picks, usage) {
  const st = loadState()
  const c = protoCard(id)
  if (!c?.on) fail(`[시제품] ${id} 는 시제품 카드가 아닙니다 ("시제품: 예" 없음).`)
  const d = decisionStatus(id)
  if (!d.ok) protoFail(st, 'pick', id, `${id} 의 결정이 아직 기록되지 않았습니다`, [`${d.why}. answer 로 사람의 답을 남기고 기획서 ${id} 줄을 "결정: 선택함 (<변주>)" 으로 고친 뒤 부르세요`])
  const names = c.variants.map((v) => v.name)
  if (!picks.length || picks.some((v) => !names.includes(v))) fail(`${usage}\n${id} 의 변주: ${names.join(', ')}`, 2)
  const ev = readEvents()
  const ms = c.milestone ?? st.milestone ?? 'M0'
  const dest = path.join(ROOT, '.rail/reference', ms)
  fs.mkdirSync(dest, { recursive: true })
  const copied = []
  for (const v of picks)
    for (const s of lastOf(ev, id, v, 'proto_record')?.shots ?? []) {
      const to = `${id}-${v}-${s.split('/').join('-')}`
      fs.copyFileSync(path.join(PROTO_DIR, id, v, s), path.join(dest, to))
      copied.push({ file: to, shows: c.shots.find((x) => x.name === s)?.desc ?? '' })
    }
  const readme = path.join(dest, 'README.md')
  const head = read(readme) ?? `# ${ms} 기준 화면\n장면 리허설은 이 화면들과 비교합니다(rail-check). 시제품에서 사람이 고른 변주의 스크린샷입니다. 버린 코드의 화면이라 숫자·글자보다 배치를 봅니다.\n`
  fs.writeFileSync(readme, `${head.replace(/\s*$/, '')}\n\n## ${id} — 고른 변주 ${picks.join(', ')} (${today()})\n${copied.map((x) => `- \`${x.file}\` — ${x.shows}`).join('\n') || '- (스크린샷 없음)'}\n`)
  // 정리: 남은 작업자는 멈추고, 작업 공간과 브랜치를 지운다(Orca worktree rm --delete-branch --force).
  const removed = []
  const starts = ev.filter((e) => e.event === 'worker_start' && e.proto === id)
  for (const w of openWorkers(st, ev).filter((x) => x.proto === id)) orca(['orchestration', 'worker-stop', '--dispatch', w.dispatch, '--json'], 60_000)
  const seen = new Set()
  for (const w of starts) {
    // 2.5판: 기록에 경로나 브랜치가 없으면 지우기 전에 Orca 의 작업 공간 목록에서 이름으로 찾는다. 브랜치는 접두어(user/ 등)까지 실제 이름으로 쓴다.
    const found = (!w.worktree || !w.branch) && w.name ? protoWorktree(w.name) : null
    const where = w.worktree ?? found?.path ?? null
    const branch = shortBranch(w.branch) ?? found?.branch ?? protoLocalBranch(w.name)
    const sel = where ? `path:${where}` : branch ? `branch:${branch}` : `name:${w.name}`
    if (seen.has(sel)) continue
    seen.add(sel)
    const r = orca(['worktree', 'rm', '--worktree', sel, '--delete-branch', '--force', '--json'], 120_000)
    // Orca 가 브랜치를 남겼으면(접두어를 못 찾은 경우) 레일이 그 실제 이름으로 지운다.
    const left = branch && isGitTop() && gitIn(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok
    const del = left ? gitIn(['branch', '-D', branch]) : null
    const branchOk = branch ? !left || del.ok : null
    removed.push({ worktree: sel, ok: r.ok, branch, branch_deleted: branchOk, ...(r.ok ? {} : { error: r.error }), ...(del && !del.ok ? { branch_error: 'git branch -D 실패' } : {}) })
    out(`[시제품] 작업 공간 ${sel} ${r.ok ? '지움' : `지우지 못함(${r.error}) — 사람이 orca worktree rm 으로 지웁니다`}${branch ? ` · 브랜치 ${branch} ${branchOk ? '지움' : '지우지 못함 — 사람이 git branch -D 로 지웁니다'}` : ''}`)
  }
  withLock(() => {
    const s = loadState()
    for (const w of openWorkers(s).filter((x) => x.proto === id)) appendLog('worker_closed', s, { step: w.step, terminal: null, dispatch: w.dispatch, via: 'proto pick' })
    appendLog('proto_picked', s, { proto: id, picked: picks, milestone: ms, copied: copied.map((x) => x.file), removed })
  })
  out(`[시제품] ${id}: ${picks.join(', ')} 의 스크린샷 ${copied.length}장을 .rail/reference/${ms}/ 에 옮겼습니다(git 에 넣습니다). 장면 리허설이 이 화면과 비교합니다.`)
}

// 2.5판: Orca 의 작업 공간 목록에서 이름(표시 이름, 폴더 이름, 브랜치 끝 이름)으로 시제품 작업 공간을 찾는다. { path, branch } 또는 null.
export const shortBranch = (b) => (typeof b === 'string' && b.trim() ? b.trim().replace(/^refs\/heads\//, '') : null)
export function protoWorktree(name) {
  const r = orca(['worktree', 'list', '--json'], 60_000)
  const list = r.json?.result?.worktrees ?? r.json?.worktrees ?? []
  if (!r.ok || !Array.isArray(list)) return null
  const hit = list.find((w) => w && (w.displayName === name || path.basename(String(w.path ?? '')) === name || shortBranch(w.branch)?.split('/').pop() === name))
  return hit ? { path: typeof hit.path === 'string' && hit.path.startsWith('/') ? hit.path : null, branch: shortBranch(hit.branch) } : null
}
// 기록에도 Orca 목록에도 브랜치가 없을 때: 로컬 브랜치 가운데 이름이 같거나 "/<이름>" 으로 끝나는 것.
export function protoLocalBranch(name) {
  if (!name || !isGitTop()) return null
  return gitIn(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).out.split('\n').find((b) => b === name || b.endsWith(`/${name}`)) ?? null
}
