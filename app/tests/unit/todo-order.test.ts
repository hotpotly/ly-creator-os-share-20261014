import { expect, test } from 'vitest'
import type { TodoItem } from '../../src/shared/domain'
import { moveTodoWithinList, sortTodosByOrder } from '../../src/shared/todo-order'
const rows = ['a','hidden','b','c'].map((id,index) => ({id,createdAt:String(index),status:'open'} as TodoItem))
test('group reorder keeps other dates and groups in their existing slots', () => {
 expect(moveTodoWithinList(rows,[],['a','b','c'],'c','a',false)).toEqual(['c','hidden','a','b'])
 expect(moveTodoWithinList(rows,[],['a','b'],'a','c',false)).toEqual(['a','hidden','b','c'])
 expect(moveTodoWithinList(rows,[],['a','b','c'],'a','c',true)).toEqual(['b','hidden','c','a'])
})
test('completion never reorders manually sorted todos', () => {
 expect(sortTodosByOrder(rows.map(row => ({...row,status:'completed'})), ['c','a','hidden','b']).map(row=>row.id)).toEqual(['c','a','hidden','b'])
})
