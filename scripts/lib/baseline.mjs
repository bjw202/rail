// 시험 기준선(.rail/test-baseline.json): 시험 잠금 훅이 커밋 전의 새 시험까지 잠그는 데 쓰는 시험 파일 목록과 해시.
// 2.9판: 시험 먼저 step 뒤의 "예정된 실패" 창과 그 창이 쓰던 시작 기록(starts·changed·changed_by)을 뺐다.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isTestPath } from '../../hooks/lib.mjs'
import { F, ROOT, gitIn, isGitTop, read, walk } from './core.mjs'

// 지금 있는 시험 파일과 내용 해시. git 저장소면 추적 파일과 무시되지 않은 새 파일, 아니면 폴더를 훑는다.
export function testFileHashes() {
  const list = isGitTop()
    ? gitIn(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).out.split('\0').filter(Boolean)
    : walk(ROOT)
  const files = {}
  for (const f of [...new Set(list)].filter(isTestPath).sort()) {
    const abs = path.join(ROOT, f)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files[f] = createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
  }
  return files
}
export function readBaseline() {
  try {
    return JSON.parse(read(F.baseline) ?? 'null')
  } catch {
    return null
  }
}
export function writeBaseline(b) {
  fs.mkdirSync(path.dirname(F.baseline), { recursive: true })
  fs.writeFileSync(F.baseline, JSON.stringify(b, null, 2) + '\n')
}
