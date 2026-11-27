// 레일 판 표시: 원본은 설치 도구가 적은 .rail/installed.json 의 레일 커밋 하나. status 가 그것을 보인다(손으로 쓴 판 번호는 읽지 않는다).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { put, rail, railRepo, tmp } from './helpers.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const doc = (v) => `# 레일 사용법 (한 쪽)\n레일 ${v}판\n\n본문\n`

describe('status 의 판 표시', () => {
  test('installed.json 의 레일 커밋을 첫 줄과 훅 머리에 보이고, config 의 손 번호(railVersion)는 보이지 않는다', () => {
    const root = railRepo(tmp(), JSON.stringify({ railVersion: '9.9' }))
    put(root, '.rail/installed.json', JSON.stringify({ commit: 'abc1234', dirty: false, files: [] }))
    const r = rail(root, 'status')
    assert.equal(r.code, 0)
    assert.match(r.out.split('\n')[0], /^위치: .*\(레일 abc1234\)$/)
    assert.doesNotMatch(r.out, /9\.9/)
    const h = JSON.parse(rail(root, 'status', '--hook').out)
    assert.match(h.systemMessage, /^\[레일 abc1234\]/)
    assert.match(h.hookSpecificOutput.additionalContext, /^\[레일 abc1234 상태\]/)
    assert.equal(JSON.parse(rail(root, 'status', '--json').out).rail_version, 'abc1234')
    put(root, '.rail/installed.json', JSON.stringify({ commit: 'abc1234', dirty: true, files: [] }))
    assert.match(rail(root, 'status').out.split('\n')[0], /\(레일 abc1234 고친 판\)$/)
  })

  test('설치 기록이 없거나 깨졌으면 죽지 않고 "설치 기록 없음" 이라고 알린다', () => {
    const root = railRepo(tmp(), '{"checkCommand": ""}')
    for (const body of [null, '{깨짐']) {
      if (body) put(root, '.rail/installed.json', body)
      const r = rail(root, 'status')
      assert.equal(r.code, 0)
      assert.match(r.out.split('\n')[0], /레일 설치 기록 없음/)
      assert.match(JSON.parse(rail(root, 'status', '--hook').out).systemMessage, /설치 기록 없음/)
      assert.equal(JSON.parse(rail(root, 'status', '--json').out).rail_version, null)
    }
  })
})

test('시작 틀: config 에 손으로 쓴 판 번호(railVersion)가 없고, 설명서에는 판 기록·change·bug 줄이 없고, 기획서 틀의 계획 밖 결정 처음 값은 "아직 없음"이다', () => {
  const doc = readFileSync(path.join(REPO, 'templates/docs/RAIL.md'), 'utf8')
  assert.doesNotMatch(doc, /\d\.\d판|빼기 판|\/rail (?:change|bug)/)
  assert.equal('railVersion' in JSON.parse(readFileSync(path.join(REPO, 'templates/.rail/config.json'), 'utf8')), false)
  assert.match(readFileSync(path.join(REPO, 'templates/.rail/plan/template.md'), 'utf8'), /^- 계획 밖 결정: 아직 없음 · /m)
})
