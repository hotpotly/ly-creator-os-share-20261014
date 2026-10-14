import { expect, test } from 'vitest'
import { matchTodoProjects } from '../../src/shared/todo-project-match'
const projects = [{ id: 'mx4', title: '罗技MX Master 4体验测评' }, { id: 'oppo1', title: 'Demo Phone X9影像体验' }, { id: 'oppo2', title: 'Demo Watch 5健康测评' }, { id: 'color', title: 'SampleOS17动画细节' }, { id: 'old', title: '旧项目', trashedAt: '2026-09-01' }]
test('recognizes abbreviated names even after an action verb', () => {
  expect(matchTodoProjects('给罗技写文案', projects).projectId).toBe('mx4')
  expect(matchTodoProjects('拍摄SampleOS17', projects).projectId).toBe('color')
  expect(matchTodoProjects('Demo Phone X9写文案', projects).projectId).toBe('oppo1')
})
test('ambiguous brands suggest candidates rather than forcing an association', () => {
  expect(matchTodoProjects('Demo文案', projects)).toEqual({ projectId: null, candidateIds: ['oppo1', 'oppo2'] })
})
test('generic actions, daily errands and recycled projects remain optional', () => {
  for (const text of ['写文案', '剪辑视频', '取快递', '旧项目拍摄', '研究AI', '17分钟']) expect(matchTodoProjects(text, projects).projectId).toBe(null)
})
test('closed projects are excluded from automatic matches without removing their identities', () => {
 for (const extra of [{status:'published'}, {status:'archived'}, {topicStageRole:'completed'}, {ledgerOnly:true}]) {
   expect(matchTodoProjects('罗技文案', [{...projects[0]!, ...extra}]).projectId).toBeNull()
 }
 expect(matchTodoProjects('罗技文案', [{...projects[0]!,status:'producing'}]).projectId).toBe('mx4')
})
