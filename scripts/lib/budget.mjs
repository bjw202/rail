// 자율 모드의 예산 규칙과 비용 읽기.
import { spawnSync } from 'node:child_process'
import { autonomy } from './config.mjs'
import { ROOT, childEnv, clock, lastLines, median, now, usd } from './core.mjs'

// 진척: step 끝, 단계 넘김, 마일스톤 닫힘, 장면 확인 기록, 그리고 마무리 검사가 본 시험 통과 수가 늘어난 때.
export const PROGRESS = new Set(['step_done', 'stage_advance', 'milestone_closed', 'scene_check'])

// 예산 규칙 셋을 잰다. 비용은 costCommand 를 한 번 불러 모든 구간을 함께 잰다. 읽지 못하면 { error }.
// costCommand 가 비었으면 예산 규칙을 쓰지 않는다(멈추지 않고 status 가 경고한다). 있는데 실패하면 { error } 로 멈춘다.
export const NO_COST = '비용 명령(autonomy.budget.costCommand)이 비어 예산 규칙을 쓰지 않습니다'
export function budgetStatus(st, ev, a, cache) {
  const rules = a.budget
  if (!rules.costCommand) return { rules: {}, over: null, note: NO_COST }
  const lim = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  const on = {
    sinceProgress: rules.sinceProgress.on === true && lim(rules.sinceProgress.usd) !== null,
    milestone: rules.milestone.on === true && lim(rules.milestone.times) !== null,
    daily: rules.daily.on === true && lim(rules.daily.usd) !== null
  }
  if (!on.sinceProgress && !on.milestone && !on.daily) return { rules: on, over: null, note: '예산 규칙이 모두 꺼져 있습니다' }
  const first = ev[0]?.t ?? now()
  const marks = ev.filter((e) => PROGRESS.has(e.event)).map((e) => e.t)
  if (typeof cache?.passUpAt === 'string') marks.push(cache.passUpAt)
  const progressAt = marks.length ? marks.reduce((x, y) => (Date.parse(y) > Date.parse(x) ? y : x)) : first
  const closes = ev.filter((e) => e.event === 'milestone_closed')
  const past = closes.map((c, i) => ({ milestone: c.milestone, from: i ? closes[i - 1].t : first, to: c.t }))
  const current = st.stage !== 'done' && st.milestone ? { milestone: st.milestone, from: closes.at(-1)?.t ?? first, to: null } : null
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const asks = []
  const ask = (iv) => asks.push(iv) - 1
  const idx = {
    progress: on.sinceProgress ? ask({ from: progressAt, to: null }) : -1,
    past: on.milestone ? past.map((p) => ask({ from: p.from, to: p.to })) : [],
    current: on.milestone && current ? ask({ from: current.from, to: null }) : -1,
    daily: on.daily ? ask({ from: midnight.toISOString(), to: null }) : -1
  }
  const cost = readCost(asks)
  if (cost.error) return { rules: on, error: cost.error }
  const v = cost.usd
  const res = { rules: on, cost_ms: cost.ms, over: null }
  const overs = []
  if (on.sinceProgress) {
    const limit = lim(rules.sinceProgress.usd)
    res.since_progress = { from: progressAt, spent: v[idx.progress], limit }
    if (v[idx.progress] > limit) overs.push(`마지막 진척(${clock(progressAt)}) 뒤 이 프로젝트에 ${usd(v[idx.progress])} 를 썼습니다 (상한 ${usd(limit)})`)
  }
  if (on.milestone) {
    const times = lim(rules.milestone.times)
    const costs = idx.past.map((i) => v[i])
    const m = costs.length ? median(costs) : null
    const limit = m === null ? null : Math.round(m * times * 100) / 100
    res.milestone = {
      milestone: current?.milestone ?? null,
      from: current?.from ?? null,
      spent: current ? v[idx.current] : null,
      median: m,
      times,
      limit,
      past: past.map((p, i) => ({ milestone: p.milestone, spent: costs[i] })),
      ...(!past.length ? { note: '닫힌 마일스톤이 없어 비교하지 않습니다' } : !current ? { note: '진행 중인 마일스톤이 없습니다' } : {})
    }
    if (current && limit !== null && v[idx.current] > limit)
      overs.push(`${current.milestone} 에 ${usd(v[idx.current])} 를 썼습니다 (지난 마일스톤 ${past.length}개 비용 중간값 ${usd(m)} 의 ${times}배 ${usd(limit)} 초과)`)
  }
  if (on.daily) {
    const limit = lim(rules.daily.usd)
    res.daily = { from: midnight.toISOString(), spent: v[idx.daily], limit }
    if (v[idx.daily] > limit) overs.push(`오늘 이 프로젝트에 ${usd(v[idx.daily])} 를 썼습니다 (하루 상한 ${usd(limit)})`)
  }
  res.over = overs[0] ?? null
  return res
}
// costCommand 에 { intervals:[{from,to}] } 를 표준 입력으로 주고 { usd:[...] } 를 받는다. 45초 안에 끝나야 한다.
// cwd 를 주면(시제품) 그 작업 공간의 기록만 잰다. 그렇게 재는 명령은 출력에 같은 cwd 를 돌려준다.
export function readCost(intervals, cwd = null) {
  const cmd = autonomy().budget.costCommand
  const t0 = Date.now()
  const r = spawnSync(cmd, { shell: true, cwd: ROOT, input: JSON.stringify({ intervals, ...(cwd ? { cwd } : {}) }), encoding: 'utf8', env: { ...childEnv(), RAIL_ROOT: ROOT }, timeout: 45_000, maxBuffer: 16 * 1024 * 1024 })
  if (r.error || r.status !== 0) return { error: `비용 읽기 실패(${r.error?.message ?? (lastLines(r.stderr || r.stdout, 2).join(' / ') || `종료 코드 ${r.status}`)})` }
  let v = null
  let got = null
  try {
    got = JSON.parse(r.stdout)
    v = got?.usd
  } catch {}
  if (!Array.isArray(v) || v.length !== intervals.length || !v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0))
    return { error: `비용 읽기 실패(출력을 읽지 못했습니다: ${lastLines(r.stdout, 1)[0] ?? '빈 출력'})` }
  return { usd: v, ms: Date.now() - t0, cwd: got?.cwd ?? null }
}
