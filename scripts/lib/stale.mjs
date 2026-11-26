// 낡은 시험 판정: 판정 작업자(<step>-stale)가 잠긴 시험 줄마다 stale/keep 을 가르고, stale 줄만 그 step 의 다음 작업자 하나에 시험 고치기를 허락한다. 사람은 마일스톤 끝 장면 질문(자율 밤샘이면 판정 대기 안내)에서 목록을 한 번 본다.
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { ROOT, gitIn, read } from './core.mjs'
import { readEvents } from './state.mjs'

// 한 마일스톤에서 판정으로 허락하는 시험 파일 수. 넘으면 예전처럼 사람에게 묻는다.
export const STALE_MAX = 5
export const staleMode = () => (loadConfig().staleTests === 'agent' ? 'agent' : 'human')
const rel = (step) => `.rail/stale/${step}.json`
const s = (v) => typeof v === 'string' && v.trim()
// {"lines":[{"file","line","verdict":"stale|keep","pinned","changed_by"(stale 이면),"why"}]}. 한 줄이라도 꼴이 틀리면 깨진 것이다.
export function readStale(step) {
  let lines = null
  try {
    lines = JSON.parse(read(path.join(ROOT, rel(step))) ?? 'null')?.lines
  } catch {}
  const good = (l) => s(l?.file) && Number.isInteger(l?.line) && ['stale', 'keep'].includes(l?.verdict) && s(l?.pinned) && s(l?.why) && (l.verdict === 'keep' || s(l?.changed_by))
  if (!Array.isArray(lines) || !lines.length || !lines.every(good)) return { error: `판정 파일 ${rel(step)} 이 없거나 꼴이 틀렸습니다` }
  return { stale: lines.filter((l) => l.verdict === 'stale') }
}
// 판정 작업자 <step>-stale 이 닫힌 뒤 그 step 에 시험 고치기로 띄운 작업자가 아직 없으면 판정 파일을 본다.
// 돌려주는 값: null(판정 없음) | { refused } | { at, by: 'stale', file, judge, lines }
export function staleGrant(st, step, ev) {
  if (staleMode() !== 'agent') return null
  let judge = null
  const used = new Set()
  for (const e of ev) {
    if (e.event === 'worker_closed' && e.step === `${step}-stale`) judge = e
    else if (e.event === 'worker_start' && e.test_edit) {
      if (e.step === step) judge = null
      for (const l of e.stale_lines ?? []) used.add(l.file)
    }
  }
  if (!judge) return null
  const j = readStale(step)
  if (j.error) return { refused: `${j.error}. 시험 고치기를 허락하지 않습니다` }
  if (!j.stale.length) return { refused: '판정이 모두 keep 입니다. 시험은 그대로 두고 코드를 고칩니다' }
  const files = new Set([...used, ...j.stale.map((l) => l.file)])
  if (files.size > STALE_MAX)
    return { refused: `이번 마일스톤에서 판정으로 허락할 시험 파일이 ${files.size}개라 한도 ${STALE_MAX}개를 넘습니다. 사람에게 묻습니다: ask "${step} 에서 시험 고치기를 허락할까요? (그 줄과 까닭)" --kind approve` }
  return { at: judge.t, by: 'stale', file: rel(step), judge: judge.dispatch ?? null, lines: j.stale.map(({ file, line, pinned, changed_by }) => ({ file, line, pinned, changed_by })) }
}
// 이번 마일스톤에서 판정으로 허락해 고친 시험 줄(장면 질문, 닫기 관문, 마지막 리뷰가 본다).
export const staleList = (st) =>
  readEvents()
    .filter((e) => e.milestone === st.milestone && e.event === 'worker_start' && e.allowed_by === 'stale')
    .flatMap((e) => (e.stale_lines ?? []).map((l) => ({ ...l, step: e.step })))
// 판정 대기로 닫을 때는 커밋을 그때 붙여 두고(withCommit), 나중에 보일 때 그 값을 쓴다.
export const withCommit = (l) => ({ ...l, commit: l.commit ?? (gitIn(['log', '-1', '--format=%h', '--', l.file]).out.trim() || '없음') })
export const staleText = (list) => list.map(withCommit).map((l) => `- ${l.file}:${l.line} — ${l.changed_by} 로 바뀐 동작(옛 값: ${l.pinned}) · ${l.step}, 커밋 ${l.commit}`).join('\n')
