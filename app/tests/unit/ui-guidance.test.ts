import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const root = resolve(import.meta.dirname, '../..')
const removed = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/removed-ui-guidance.json'), 'utf8')) as { file: string; text: string }[]
describe('intentional removal of static instructional copy', () => {
 it('removes reviewed guidance from its source, not by hiding all text', () => {
  for (const {file,text} of removed) expect(readFileSync(resolve(root,'src/renderer/src',file),'utf8'),file).not.toContain(text)
 })
 it('removes fixed stage descriptions and preserves editable user fields', () => {
  const stage=readFileSync(resolve(root,'src/renderer/src/components/ProjectStageWorkspace.tsx'),'utf8')
  expect(stage).not.toContain('projectStageDescriptions');expect(stage).not.toContain('stage-card-description')
  const overview=readFileSync(resolve(root,'src/renderer/src/components/ProjectOverview.tsx'),'utf8')
  expect(overview).toContain('value={description}');expect(overview).toContain('cancelDescription')
  const safety=readFileSync(resolve(root,'src/renderer/src/components/BusinessLedgerPage.tsx'),'utf8')
  expect(safety).toContain('无法恢复');expect(safety).toContain('role="alert"')
 })
})
