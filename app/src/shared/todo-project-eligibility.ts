/** Historical links remain valid; only new suggestions/default choices exclude closed projects. */
export function isActiveTodoProject(project: { trashedAt?: string | null; status?: string; topicStageRole?: string | null; ledgerOnly?: boolean }): boolean {
  return !project.trashedAt && !project.ledgerOnly && !['published', 'archived'].includes(project.status ?? '') && !['completed', 'archived', 'shelved'].includes(project.topicStageRole ?? '')
}
