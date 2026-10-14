import { basename, extname } from 'node:path'

export const OUTLINE_TEMPLATE_KIND = 'outline_template'
export const MAX_OUTLINE_TEMPLATE_ITEMS = 200
export const MAX_OUTLINE_TEMPLATE_ITEM_LENGTH = 4000

export function outlineTemplateName(sourceName: string): string {
  const fileName = basename(sourceName).trim()
  const extension = extname(fileName)
  const name = (extension ? fileName.slice(0, -extension.length) : fileName).trim()
  if (!name) throw new Error('大纲模板名称不能为空')
  return name.slice(0, 120)
}

export function extractOutlineTemplateItems(rawText: string): string[] {
  const items = rawText
    .split('\u0000').join('')
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim())
    .filter(Boolean)

  if (items.length === 0) throw new Error('Word模板中没有可用的大纲结构')
  if (items.length > MAX_OUTLINE_TEMPLATE_ITEMS) throw new Error(`大纲模板最多保留${MAX_OUTLINE_TEMPLATE_ITEMS}项结构`)
  if (items.some((item) => item.length > MAX_OUTLINE_TEMPLATE_ITEM_LENGTH)) throw new Error(`大纲模板单项不能超过${MAX_OUTLINE_TEMPLATE_ITEM_LENGTH}字`)
  return items
}
