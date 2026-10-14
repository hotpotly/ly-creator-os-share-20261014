import { z } from 'zod'

export const providerContentFactAnnotationSchema = z.object({
  text: z.string().min(1).max(8_000),
  provenance: z.enum(['ai_supplement', 'web_supplement', 'needs_confirmation']),
  note: z.string().min(1).max(2_000),
  claim: z.string().min(1).max(4_000).nullable().optional().default(null),
  factType: z.enum(['fact', 'price']).nullable().optional().default(null),
  priceKind: z.enum(['launch_official', 'current_official', 'current_channel', 'user_actual']).nullable().optional().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable().optional().default(null),
  confirmationKind: z.enum(['user_only']).nullable().optional().default(null),
  placeholderId: z.string().min(1).max(256).nullable().optional().default(null),
  webSources: z.array(z.object({
    title: z.string().min(1).max(500),
    url: z.string().url().max(8_000)
  }).strict()).max(20)
}).strict()

export const providerContentFactAnnotationsSchema = z.array(providerContentFactAnnotationSchema).max(500).default([])
export type ProviderContentFactAnnotation = z.infer<typeof providerContentFactAnnotationSchema>

export const providerContentFactAnnotationJsonSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    provenance: { type: 'string', enum: ['ai_supplement', 'web_supplement', 'needs_confirmation'] },
    note: { type: 'string' },
    claim: { type: ['string', 'null'] },
    factType: { type: ['string', 'null'], enum: ['fact', 'price', null] },
    priceKind: { type: ['string', 'null'], enum: ['launch_official', 'current_official', 'current_channel', 'user_actual', null] },
    currency: { type: ['string', 'null'] },
    confirmationKind: { type: ['string', 'null'], enum: ['user_only', null] },
    placeholderId: { type: ['string', 'null'] },
    webSources: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' } },
        required: ['title', 'url'],
        additionalProperties: false
      }
    }
  },
  required: ['text', 'provenance', 'note', 'claim', 'factType', 'priceKind', 'currency', 'confirmationKind', 'placeholderId', 'webSources'],
  additionalProperties: false
} as const

export const CONTENT_FACT_ANNOTATION_PROMPT = '如果本轮结果主动补入了需要感知的精确事实，必须在annotations中标出正文中逐字存在的text。可核验公开事实使用web_supplement，填写claim、factType和本轮真实HTTPS来源；价格还必须填写priceKind（launch_official｜current_official｜current_channel）及ISO 4217币种，不得用公开网页生成user_actual。只有用户本人的实际购买价、购买时间、使用时长、亲身体验或故障才能使用needs_confirmation并填写confirmationKind=user_only。处理PLACEHOLDERS中的公开、用户专属或普通补写占位时，必须把对应id填入placeholderId；普通补写使用ai_supplement，非占位补写填null。查不到公开事实时不得编造，也不得改成红色待填。其他不适用字段返回null；无标注时返回空数组。'
