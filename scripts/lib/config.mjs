// .rail/config.json 읽기: 커밋 정책, 자율 모드 설정, 판 번호, 검증기 목록.
import { F, read } from './core.mjs'

// isolation(M14 시험): worktree 면 만드는 역할의 작업자가 저마다 git worktree 에서 일한다(worktree.mjs). 사람만 바꾼다(--said).
export const POLICIES = { commit: { key: 'commitPolicy', values: ['ask', 'auto-local'], default: 'ask' }, isolation: { key: 'isolation', values: ['shared', 'worktree'], default: 'shared' } }
export function loadConfig() {
  try {
    const c = JSON.parse(read(F.config) ?? '{}')
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  } catch {
    return {}
  }
}
export const commitPolicy = () => {
  const v = loadConfig()[POLICIES.commit.key]
  return POLICIES.commit.values.includes(v) ? v : POLICIES.commit.default
}
export const isolation = () => (loadConfig().isolation === 'worktree' ? 'worktree' : 'shared')
// 자율 모드(2.2판). 커밋 정책처럼 사람만 바꾼다(policy set autonomy on|off). 기본 off.
// 예산 규칙 셋은 저마다 켜고 끈다: 마지막 진척 뒤 지출, 지난 마일스톤 비용 중간값의 몇 배, 하루 상한.
// 비용은 costCommand 가 잰다(표준 입력으로 구간을 받고 금액을 낸다). 무엇으로 잴지는 프로젝트마다 달라 .rail/config.json 에 둔다. 비면 비용을 읽지 못한 것으로 본다.
export const AUTONOMY_DEFAULT = {
  mode: 'off',
  maxSameFailure: 3,
  busyMinutes: 20,
  alertWorkerMinutes: 60,
  budget: {
    costCommand: '',
    sinceProgress: { on: true, usd: 10 },
    milestone: { on: true, times: 3 },
    daily: { on: false, usd: null }
  }
}
export function autonomy() {
  const c = loadConfig().autonomy
  const a = c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  const b = a.budget && typeof a.budget === 'object' ? a.budget : {}
  const rule = (k) => ({ ...AUTONOMY_DEFAULT.budget[k], ...(b[k] && typeof b[k] === 'object' ? b[k] : {}) })
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  return {
    mode: a.mode === 'on' ? 'on' : 'off',
    maxSameFailure: num(a.maxSameFailure, AUTONOMY_DEFAULT.maxSameFailure),
    busyMinutes: num(a.busyMinutes, AUTONOMY_DEFAULT.busyMinutes),
    alertWorkerMinutes: num(a.alertWorkerMinutes, AUTONOMY_DEFAULT.alertWorkerMinutes),
    budget: {
      costCommand: typeof b.costCommand === 'string' ? b.costCommand.trim() : AUTONOMY_DEFAULT.budget.costCommand,
      sinceProgress: rule('sinceProgress'),
      milestone: rule('milestone'),
      daily: rule('daily')
    }
  }
}
// 커밋 정책이 auto-local 이 아니면 켜져 있어도 쓰지 않는다(자율인데 커밋마다 물으면 멈춘다).
export const autonomyOn = () => autonomy().mode === 'on' && commitPolicy() === 'auto-local'
// ---------- 2.0판 설정 ----------
// 판 번호가 2 이상이면 2.0판 관문(리허설 기록)을 쓴다. 닫힌 마일스톤에는 소급하지 않는다.
export const isV2 = () => Number.parseFloat(loadConfig().railVersion) >= 2
// 2.3판부터 켜는 것(닫힘 알림의 새 줄, rail_size 기록, 크기 경고). 예전 판 저장소는 예전 그대로다.
export const atLeast = (v) => Number.parseFloat(loadConfig().railVersion) >= v
// 바깥 정답 검증기: [{ name, command, why }]. 종료 코드 0 통과, SKIP_CODE 건너뜀(실제 기록 없음 등), 그 밖은 실패.
export const SKIP_CODE = 3
export const verifiers = () => {
  const v = loadConfig().verify
  return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string' && typeof x.command === 'string' && x.command.trim()) : []
}
// 레일 판 번호의 원본은 config 의 railVersion 하나다. 없으면 null.
export const railVersion = () => {
  const v = loadConfig().railVersion
  return (typeof v === 'string' || typeof v === 'number') && String(v).trim() ? String(v).trim() : null
}
export const versionLabel = () => (railVersion() ? `레일 ${railVersion()}판` : '레일 판 번호 없음')
