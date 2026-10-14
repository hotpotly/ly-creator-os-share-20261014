import { z } from 'zod'
import { isValidLocalDate } from './domain/coarse-time'

export const todoDaySchema = z.object({
  day: z.string().refine(isValidLocalDate),
  smallStep: z.string().trim().min(1).max(300),
  smallCompleted: z.boolean(),
  view: z.enum(['small', 'regular']),
  showExtra: z.boolean(),
  entered: z.boolean(),
  regularDone: z.boolean(),
  revision: z.number().int().nonnegative()
}).strict()
export type TodoDay = z.infer<typeof todoDaySchema>
export const todoDayWriteSchema = z.object({
  day: z.string().refine(isValidLocalDate),
  expectedRevision: z.number().int().nonnegative(),
  patch: todoDaySchema.omit({ day: true, revision: true }).partial().strict()
}).strict()
export type TodoDayWrite = z.infer<typeof todoDayWriteSchema>
export function defaultTodoDay(day: string): TodoDay {
  return { day, smallStep: '先推进一小步', smallCompleted: false, view: 'small', showExtra: false, entered: false, regularDone: false, revision: 0 }
}
