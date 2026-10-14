import { describe, expect, it } from 'vitest'
import { buildContentInstructionRequest, freezeStructuredReference, structuredReferenceSourceKey } from '../../src/main/content-instruction-request'
import {
  assertContentPlaceholderResolution,
  buildContentProviderInput,
  classifyContentFactText,
  contentProviderInputFingerprint,
  formatContentProviderInput,
  parseContentProviderInput,
  validateStyleFactIsolation
} from '../../src/main/content-provider-input'
import type { ContentInstructionRequestTarget, StructuredReferenceUse } from '../../src/shared/domain'

function use(sourceId: string, role: 'hard_constraint' | 'ordinary_reference' | 'style_reference'): StructuredReferenceUse {
  return {
    occurrenceId: `occurrence-${sourceId}`,
    sourceKey: structuredReferenceSourceKey('ios', role === 'style_reference' ? 'style_resource' : 'project_material', sourceId),
    sourceKind: role === 'style_reference' ? 'style_resource' : 'project_material',
    sourceId,
    sourceLocator: {},
    label: sourceId,
    role,
    roleOrigin: 'manual',
    runtimeRole: role,
    aspect: role === 'style_reference' ? '语气和节奏' : null,
    scope: 'whole_source',
    ruleEvidence: null,
    ruleConflicts: [],
    manualConflictResolution: null
  }
}

function target(requestId: string): ContentInstructionRequestTarget {
  return {
    id: 'target-codex', requestId, provider: 'codex_cli', providerConfigId: 'codex-cli-writing-v1',
    providerSecurityFingerprint: 'fingerprint', providerPolicyVersion: 'policy', runtimeVersion: 'runtime',
    requestedModel: 'gpt-5.6', actualModel: 'gpt-5.6-sol', requestedReasoningEffort: 'xhigh', actualReasoningEffort: 'xhigh',
    historyThreadId: null, providerThreadId: null, historyMessageIds: [], historyHash: 'a'.repeat(64),
    historyEstimatedTokens: 0, estimatedInputTokens: 0, taskId: null, status: 'queued'
  }
}

describe('R16e content Provider layered input', () => {
  it.each([
    '我买的时候花了XXX',
    '我花了XXX买的',
    '这台是我花XXX买的',
    '我当时买了XXX元',
    '我觉得XXX',
    '我的看法是XXX',
    '我认为XXX'
  ])('recognizes personal purchase wording: %s', (text) => {
    expect(classifyContentFactText(text)).toBe('user_only_fact')
  })

  it.each(['产品价格XXX', '官网价格XXX', '首发价XXX'])('recognizes public price wording: %s', (text) => {
    expect(classifyContentFactText(text)).toBe('public_fact')
  })

  it('separates allowed facts from style-only data and blocks unique style fact leakage', () => {
    const fact = freezeStructuredReference({
      use: use('事实资料', 'hard_constraint'), sourceVersion: 'v1', textContent: '官方型号为MX Master 4，用户实测滚轮手感顺滑。',
      managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null, availability: 'ready'
    })
    const style = freezeStructuredReference({
      use: use('历史风格稿', 'style_reference'), sourceVersion: 'v2',
      textContent: '张伟认为ABX900、iPhone 17 Pro和Surface Laptop 7最值得买，原价1299元。这款产品不适合小手用户。李雷使用这款产品一周后换回旧设备。王明指出这款产品续航很差。赵强直言这款产品按键容易误触。周琳补充这款产品容易发热。这款产品综合体验不好，续航也令人失望。',
      managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null, availability: 'ready'
    })
    const request = buildContentInstructionRequest({
      id: 'request-r16e-style', projectId: 'ios', sessionScope: 'r16e', surface: 'script_material_chat',
      generationId: null, target: null, materialRevisionId: 'revision', materialRevisionContentHash: 'b'.repeat(64),
      displayText: '参考这份语气，XXX处主动补齐公开参数\n[补充原价]\n【补充成交价】\n我实际到手是[补充成交价]\n【请填写实际到手价】\n我的实际成交价XXX\n我买的时候花了XXX',
      editorDocument: { type: 'doc' }, references: [fact, style], constraints: [],
      projectContextSnapshot: { supportingMaterials: [{ id: 'project-fact', content: 'Brief确认型号为Surface Laptop 7，另一个型号为ABX9000' }] },
      resourceSnapshot: {
        automaticResources: [{ id: '历史风格稿', payload: { content: '张伟认为ABX900值得买，原价1299元' } }],
        recommendedResources: [], manualResources: []
      },
      webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
    })
    const snapshot = buildContentProviderInput({ request, target: target(request.id), images: [], createdAt: '2026-08-05T00:00:01.000Z' })
    expect(snapshot.allowedFactReferences.map((reference) => reference.label)).toEqual(['事实资料'])
    expect(snapshot.styleReferences.map((reference) => reference.label)).toEqual(['历史风格稿'])
    expect(snapshot.forbiddenStyleFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'model', value: 'ABX900' }),
      expect.objectContaining({ kind: 'model', value: 'iPhone 17 Pro' }),
      expect.objectContaining({ kind: 'person_name', value: '张伟' }),
      expect.objectContaining({ kind: 'person_name', value: '李雷' }),
      expect.objectContaining({ kind: 'person_name', value: '王明' }),
      expect.objectContaining({ kind: 'person_name', value: '赵强' }),
      expect.objectContaining({ kind: 'person_name', value: '周琳' }),
      expect.objectContaining({ kind: 'price', value: '1299元' })
    ]))
    expect(snapshot.forbiddenStyleFacts.some((item) => item.value.includes('MX Master 4'))).toBe(false)
    expect(snapshot.forbiddenStyleFacts.some((item) => item.kind === 'model' && item.value === 'Surface Laptop 7')).toBe(false)
    expect(snapshot.forbiddenStyleFacts.some((item) => item.kind === 'person_name' && item.value === '闭眼')).toBe(false)
    expect(snapshot.systemResources).toMatchObject({ automaticResources: [] })
    expect(snapshot.placeholders).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '[补充原价]', kind: 'public_fact' }),
      expect.objectContaining({ text: '【补充成交价】', kind: 'public_fact' }),
      expect.objectContaining({ text: '【请填写实际到手价】', kind: 'user_only_fact' }),
      expect.objectContaining({ text: '我的实际成交价XXX', kind: 'user_only_fact' }),
      expect.objectContaining({ text: '[补充成交价]', kind: 'user_only_fact' }),
      expect.objectContaining({ text: '我买的时候花了XXX', kind: 'user_only_fact' })
    ]))
    expect(snapshot.placeholders.every((placeholder) => placeholder.id.startsWith('placeholder-'))).toBe(true)
    expect(snapshot.factPolicy).toMatchObject({ publicPlaceholderResearch: true, realExperiencePrecedence: 'user_real_experience_over_web_opinion' })
    expect(formatContentProviderInput(snapshot)).toContain('<STYLE_REFERENCES>')
    expect(formatContentProviderInput(snapshot)).toContain('<ALLOWED_FACT_REFERENCES>')
    expect(() => validateStyleFactIsolation(snapshot, ['新稿继续使用ABX900，原价1299元。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['张伟这次用了iPhone 17 Pro。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['小手用户用起来并不合适。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['李雷换回了之前的设备。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['王明指出这款产品续航很差。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['赵强直言这款产品按键容易误触。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['周琳补充这款产品容易发热。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(() => validateStyleFactIsolation(snapshot, ['这款产品综合体验很好，续航也令人满意。'])).not.toThrow()
    expect(() => validateStyleFactIsolation(snapshot, ['这款产品适合小手用户。'])).not.toThrow()
    expect(() => validateStyleFactIsolation(snapshot, ['新稿只保留MX Master 4和用户实测滚轮手感。'])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '已经补完全部内容。', [])).toThrow('PROVIDER_PUBLIC_PLACEHOLDER_EVIDENCE_MISSING')
    const placeholderAnnotations = snapshot.placeholders
      .map((placeholder) => {
        const publicValue = placeholder.expectedPublicKind === 'spec' ? '参数容量为16GB' : '999元'
        return {
          text: placeholder.kind === 'public_fact' ? publicValue : placeholder.kind === 'user_only_fact' ? '我的实际信息' : '已补写表达',
          claim: placeholder.kind === 'public_fact' ? publicValue : null,
          factType: placeholder.expectedFactType,
          priceKind: placeholder.expectedFactType === 'price' ? placeholder.expectedPriceKind ?? 'current_channel' as const : null,
          provenance: placeholder.kind === 'public_fact' ? 'web_supplement' as const
            : placeholder.kind === 'user_only_fact' ? 'needs_confirmation' as const : 'ai_supplement' as const,
          placeholderId: placeholder.id
        }
      })
    expect(() => assertContentPlaceholderResolution(snapshot, '已经补完全部内容。', placeholderAnnotations)).not.toThrow()

    for (const [index, displayText] of [
      '不要带入旧型号ABX900，只参考语气',
      '不要把旧型号ABX900带入，只参考语气',
      '禁止在正文中使用ABX900，只参考语气',
      '不要在新稿里写ABX900，只参考语气',
      '不要出现旧型号ABX900，只参考语气'
    ].entries()) {
      const negativeInstructionRequest = buildContentInstructionRequest({
        ...request,
        id: `request-r16e-negative-style-fact-${index}`,
        displayText,
        references: [style],
        projectContextSnapshot: null,
        resourceSnapshot: null,
        maxInputTokens: 20_000
      })
      const negativeInstructionSnapshot = buildContentProviderInput({
        request: negativeInstructionRequest,
        target: target(negativeInstructionRequest.id),
        images: []
      })
      expect(() => validateStyleFactIsolation(negativeInstructionSnapshot, ['ABX900值得买。']))
        .toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    }
  })

  it('deduplicates one logical placeholder and rejects wrong or unproved proactive facts', () => {
    const request = buildContentInstructionRequest({
      id: 'request-r16e-placeholder', projectId: 'ios', sessionScope: 'r16e-placeholder', surface: 'script_material_chat',
      generationId: null, target: null, materialRevisionId: 'revision', materialRevisionContentHash: 'c'.repeat(64),
      displayText: '请把官方原价XXX补上', editorDocument: { type: 'doc' }, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
    })
    const snapshot = buildContentProviderInput({
      request,
      target: target(request.id),
      images: [],
      placeholderTexts: [{ text: '官方原价XXX', source: 'material_source' }],
      createdAt: '2026-08-05T00:00:01.000Z'
    })
    expect(snapshot.placeholders.filter((placeholder) => placeholder.kind === 'public_fact')).toHaveLength(1)
    const placeholder = snapshot.placeholders[0]!
    expect(placeholder).toMatchObject({ expectedFactType: 'price', expectedPriceKind: 'launch_official' })
    expect(() => assertContentPlaceholderResolution(snapshot, '型号ABX900', [{
      text: 'ABX900', provenance: 'web_supplement', claim: '型号为ABX900', factType: 'fact', priceKind: null,
      placeholderId: placeholder.id
    }])).toThrow('PROVIDER_PLACEHOLDER_FACT_KIND_INVALID')
    expect(() => assertContentPlaceholderResolution(snapshot, '官方原价999元', [{
      text: '999元', provenance: 'web_supplement', claim: '官方原价为999元', factType: 'price',
      priceKind: 'launch_official', placeholderId: placeholder.id
    }])).not.toThrow()

    for (const [index, instruction] of [
      '官方原价那个XXX帮我查一下',
      '请把素材里官方原价待补的位置查清楚',
      '请把首发价格那个XXX查一下'
    ].entries()) {
      const dedupeRequest = buildContentInstructionRequest({
        ...request,
        id: `request-r16e-placeholder-dedupe-${index}`,
        displayText: instruction,
        maxInputTokens: 20_000
      })
      const deduped = buildContentProviderInput({
        request: dedupeRequest,
        target: target(dedupeRequest.id),
        images: [],
        placeholderTexts: [{ text: '官方原价XXX', source: 'material_source' }]
      })
      expect(deduped.placeholders.filter((item) => item.kind === 'public_fact')).toHaveLength(1)
    }

    const specRequest = buildContentInstructionRequest({
      ...request,
      id: 'request-r16e-spec-placeholder',
      displayText: '查清产品重量[补充重量]',
      maxInputTokens: 20_000
    })
    const specSnapshot = buildContentProviderInput({ request: specRequest, target: target(specRequest.id), images: [] })
    const specPlaceholder = specSnapshot.placeholders[0]!
    expect(specPlaceholder).toMatchObject({ expectedFactType: 'fact', expectedPublicKind: 'spec', expectedSpecKinds: ['weight'] })
    expect(() => assertContentPlaceholderResolution(specSnapshot, '产品重量为ABX900', [{
      text: 'ABX900', provenance: 'web_supplement', claim: '产品型号为ABX900', factType: 'fact', priceKind: null,
      placeholderId: specPlaceholder.id
    }])).toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(specSnapshot, '产品重量为12小时', [{
      text: '12小时', provenance: 'web_supplement', claim: '产品重量为12小时', factType: 'fact', priceKind: null,
      placeholderId: specPlaceholder.id
    }])).toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')

    const materialRequest = buildContentInstructionRequest({
      ...request,
      id: 'request-r16e-material-placeholder',
      displayText: '查清[补充材质]',
      maxInputTokens: 20_000
    })
    const materialSnapshot = buildContentProviderInput({ request: materialRequest, target: target(materialRequest.id), images: [] })
    const materialPlaceholder = materialSnapshot.placeholders[0]!
    expect(materialPlaceholder).toMatchObject({ expectedSpecKinds: ['material'] })
    expect(() => assertContentPlaceholderResolution(materialSnapshot, '机身采用铝合金', [{
      text: '铝合金', provenance: 'web_supplement', claim: '机身采用铝合金', factType: 'fact', priceKind: null,
      placeholderId: materialPlaceholder.id
    }])).not.toThrow()

    const proactiveRequest = buildContentInstructionRequest({
      ...request,
      id: 'request-r16e-proactive',
      displayText: '主动扩写一段体验',
      maxInputTokens: 20_000
    })
    const proactive = buildContentProviderInput({ request: proactiveRequest, target: target(proactiveRequest.id), images: [] })
    expect(() => assertContentPlaceholderResolution(proactive, 'R16b统一候选已生成。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(proactive, 'OPPO R9s是一款值得购买的手机。', []))
      .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')
    expect(() => assertContentPlaceholderResolution(proactive, 'R5C阶段使用体验很轻松。', []))
      .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')
    for (const claim of [
      '机身采用铝合金材质。', '配有三个USB-C接口。', '搭载M4芯片。',
      '机身是铝合金。', '接口一共有三个。', '设备共有3个接口。', '机身由铝合金打造。',
      '外壳为铝合金。', '接口数量总共三个。', 'M4芯片性能更强。', '芯片型号M4。',
      '屏幕刷新率一百二十赫兹。', '电池容量五千毫安时。'
    ]) {
      expect(() => assertContentPlaceholderResolution(proactive, claim, []))
        .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')
    }
    expect(() => assertContentPlaceholderResolution(proactive, '机身采用铝合金材质。', [{
      text: '铝合金材质', provenance: 'web_supplement', claim: '官方确认机身材质为铝合金', factType: 'fact', priceKind: null,
      placeholderId: null
    }])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(proactive, '10. 总结\n## 10. 总结\n（10）总结\n00:30 进入外观部分。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(proactive, '官方续航为12小时。', []))
      .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')

    const polarityRequest = buildContentInstructionRequest({
      ...proactiveRequest,
      id: 'request-r16e-public-claim-polarity',
      displayText: '设备不支持防水，请润色',
      maxInputTokens: 20_000
    })
    const polaritySnapshot = buildContentProviderInput({ request: polarityRequest, target: target(polarityRequest.id), images: [] })
    expect(() => assertContentPlaceholderResolution(polaritySnapshot, '设备支持防水。', []))
      .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')
  })

  it('validates every requested spec field against its own evidence clause', () => {
    const baseRequest = buildContentInstructionRequest({
      id: 'request-r16e-spec-fields', projectId: 'ios', sessionScope: 'r16e-spec-fields', surface: 'script_material_chat',
      generationId: null, target: null, materialRevisionId: 'revision', materialRevisionContentHash: 'd'.repeat(64),
      displayText: '[补充续航时间]', editorDocument: { type: 'doc' }, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
    })
    const build = (id: string, displayText: string) => {
      const request = buildContentInstructionRequest({ ...baseRequest, id, displayText, maxInputTokens: 20_000 })
      return buildContentProviderInput({ request, target: target(request.id), images: [] })
    }
    const annotationFor = (snapshot: ReturnType<typeof buildContentProviderInput>, text: string) => [{
      text,
      claim: text,
      provenance: 'web_supplement' as const,
      factType: 'fact' as const,
      priceKind: null,
      placeholderId: snapshot.placeholders[0]!.id
    }]

    const batteryLife = build('request-r16e-battery-life', '[补充续航时间]')
    expect(batteryLife.placeholders[0]).toMatchObject({ expectedPublicKind: 'spec', expectedSpecKinds: ['battery_life'] })
    expect(() => assertContentPlaceholderResolution(batteryLife, '续航为12小时', annotationFor(batteryLife, '续航为12小时'))).not.toThrow()
    expect(() => assertContentPlaceholderResolution(batteryLife, '续航为两周', annotationFor(batteryLife, '续航为两周'))).not.toThrow()

    const twoFields = build('request-r16e-two-spec-fields', '[补充重量和尺寸]')
    expect(twoFields.placeholders[0]).toMatchObject({ expectedSpecKinds: ['dimension', 'weight'] })
    expect(() => assertContentPlaceholderResolution(twoFields, '尺寸为10mm', annotationFor(twoFields, '尺寸为10mm')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(twoFields, '重量为1.2kg，尺寸为10mm', annotationFor(twoFields, '重量为1.2kg，尺寸为10mm')))
      .not.toThrow()
    expect(() => assertContentPlaceholderResolution(twoFields, '重量为1.2kg，尺寸为10mm', [{
      text: '1.2kg', claim: '重量为1.2kg', provenance: 'web_supplement', factType: 'fact', priceKind: null,
      placeholderId: twoFields.placeholders[0]!.id
    }, {
      text: '10mm', claim: '尺寸为10mm', provenance: 'web_supplement', factType: 'fact', priceKind: null,
      placeholderId: twoFields.placeholders[0]!.id
    }])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(twoFields, '重量和尺寸分别为1.2kg和10mm', annotationFor(twoFields, '重量和尺寸分别为1.2kg和10mm')))
      .not.toThrow()
    expect(() => assertContentPlaceholderResolution(twoFields, '重量和尺寸分别为10mm和1.2kg', annotationFor(twoFields, '重量和尺寸分别为10mm和1.2kg')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')

    const weight = build('request-r16e-weight-clause', '[补充重量]')
    expect(() => assertContentPlaceholderResolution(weight, '产品重量为12小时，包装内另有5g干燥剂', annotationFor(weight, '产品重量为12小时，包装内另有5g干燥剂')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(weight, '产品重量为12小时并附带5g配件', annotationFor(weight, '产品重量为12小时并附带5g配件')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(weight, '产品重量为12小时且配件为5g', annotationFor(weight, '产品重量为12小时且配件为5g')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(weight, '产品重量为5GB', annotationFor(weight, '产品重量为5GB')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(weight, '产品重量为12小时而配件重5g', annotationFor(weight, '产品重量为12小时而配件重5g')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')

    const power = build('request-r16e-power', '[补充功率]')
    expect(() => assertContentPlaceholderResolution(power, '功率为65瓦时', annotationFor(power, '功率为65瓦时')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(power, '功率为65W·h', annotationFor(power, '功率为65W·h')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')
    expect(() => assertContentPlaceholderResolution(power, '功率为65瓦特时', annotationFor(power, '功率为65瓦特时')))
      .toThrow('PROVIDER_PLACEHOLDER_FACT_VALUE_INVALID')

    for (const [index, material] of ['聚碳酸酯（PC）', 'PC+ABS', '镁合金'].entries()) {
      const materialSnapshot = build(`request-r16e-material-${index}`, '[补充材质]')
      expect(() => assertContentPlaceholderResolution(materialSnapshot, `机身材质为${material}`, annotationFor(materialSnapshot, `机身材质为${material}`)))
        .not.toThrow()
    }

    const interfaceCount = build('request-r16e-interface-count', '[接口数量XXX]')
    expect(interfaceCount.placeholders[0]).toMatchObject({ kind: 'public_fact', expectedPublicKind: 'spec', expectedSpecKinds: ['count'] })
    expect(() => assertContentPlaceholderResolution(interfaceCount, '设备有三个接口', annotationFor(interfaceCount, '接口数量为三个'))).not.toThrow()
  })

  it('deduplicates equivalent price labels without merging different products', () => {
    const build = (id: string, displayText: string, materialText: string) => {
      const request = buildContentInstructionRequest({
        id, projectId: 'ios', sessionScope: id, surface: 'script_material_chat', generationId: null, target: null,
        materialRevisionId: 'revision', materialRevisionContentHash: 'e'.repeat(64), displayText,
        editorDocument: { type: 'doc' }, references: [], constraints: [], projectContextSnapshot: null,
        resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
        factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
      })
      return buildContentProviderInput({
        request,
        target: target(request.id),
        images: [],
        placeholderTexts: [{ text: materialText, source: 'material_source' }]
      })
    }
    expect(build('request-r16e-distinct-price', 'A款原价XXX', 'B款首发价格XXX').placeholders).toHaveLength(2)
    expect(build('request-r16e-substring-price', '基础款原价XXX', '非基础款首发价格XXX').placeholders).toHaveLength(2)
    expect(build('request-r16e-equivalent-price', '售价XXX', '价格XXX').placeholders).toHaveLength(1)
    expect(build('request-r16e-deictic-price', '这台设备售价XXX', '这台设备的价格XXX').placeholders).toHaveLength(1)
    expect(build('request-r16e-launch-pricing', '首发定价XXX', '首发价XXX').placeholders).toHaveLength(1)
    expect(build('request-r16e-list-pricing', '上市定价XXX', '首发价XXX').placeholders).toHaveLength(1)
    expect(build('request-r16e-official-launch-price', '官方首发价格XXX', '首发价XXX').placeholders).toHaveLength(1)
  })

  it('continues to parse immutable R16e snapshots written with the legacy single spec field', () => {
    const request = buildContentInstructionRequest({
      id: 'request-r16e-legacy-spec', projectId: 'ios', sessionScope: 'r16e-legacy-spec', surface: 'script_material_chat',
      generationId: null, target: null, materialRevisionId: 'revision', materialRevisionContentHash: '9'.repeat(64),
      displayText: '[补充重量]', editorDocument: { type: 'doc' }, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
    })
    const current = buildContentProviderInput({ request, target: target(request.id), images: [] })
    const legacy = structuredClone(current) as unknown as Record<string, unknown>
    const legacyPlaceholders = legacy.placeholders as Array<Record<string, unknown>>
    legacyPlaceholders.forEach((placeholder) => {
      const kinds = placeholder.expectedSpecKinds as string[]
      delete placeholder.expectedSpecKinds
      placeholder.expectedSpecKind = kinds[0] ?? null
    })
    delete legacy.inputFingerprint
    legacy.inputFingerprint = contentProviderInputFingerprint(legacy as never)

    expect(parseContentProviderInput(legacy).placeholders[0]).toMatchObject({ expectedSpecKind: 'weight' })
  })

  it('requires evidence for active product facts while ignoring structural prose', () => {
    const request = buildContentInstructionRequest({
      id: 'request-r16e-active-facts', projectId: 'ios', sessionScope: 'r16e-active-facts', surface: 'script_material_chat',
      generationId: null, target: null, materialRevisionId: 'revision', materialRevisionContentHash: 'f'.repeat(64),
      displayText: '主动扩写体验', editorDocument: { type: 'doc' }, references: [], constraints: [],
      projectContextSnapshot: null, resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
      factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
    })
    const snapshot = buildContentProviderInput({ request, target: target(request.id), images: [] })
    for (const claim of [
      '支持无线充电。', '还支持杜比视界。', '最高可以录制4K视频。',
      '电池可拆卸。', '键盘支持热插拔。', '鼠标支持蓝牙连接。',
      '支持NFC。', '可以无线充电。', '具备eSIM功能。',
      '带NFC。', '可无线充电。', '兼容eSIM。',
      '有NFC。', '没有NFC。', '能无线充电。'
    ]) {
      expect(() => assertContentPlaceholderResolution(snapshot, claim, []))
        .toThrow('PROVIDER_PUBLIC_FACT_EVIDENCE_MISSING')
    }
    expect(() => assertContentPlaceholderResolution(snapshot, '机身这一部分，我会分三个角度来讲。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '## 第10章 机身设计', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '关于机身，我准备从三个角度聊。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '机身部分会从三个方面展开。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '先从机身的三个方面说起。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '机身很有质感。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '屏幕能带来很舒服的观感。', [])).not.toThrow()
    expect(() => assertContentPlaceholderResolution(snapshot, '电池没有让我失望。', [])).not.toThrow()
  })

  it('keeps positive user facts across wording changes and excludes only true negative instructions', () => {
    const build = (id: string, displayText: string, references: ReturnType<typeof freezeStructuredReference>[] = []) => {
      const request = buildContentInstructionRequest({
        id, projectId: 'ios', sessionScope: id, surface: 'script_material_chat', generationId: null, target: null,
        materialRevisionId: 'revision', materialRevisionContentHash: '1'.repeat(64), displayText,
        editorDocument: { type: 'doc' }, references, constraints: [], projectContextSnapshot: null,
        resourceSnapshot: null, webSearchMode: 'automatic', factRegion: '中国大陆',
        factAsOf: '2026-08-05T00:00:00.000Z', maxInputTokens: 20_000, aiCount: 1
      })
      return buildContentProviderInput({ request, target: target(request.id), images: [] })
    }

    const positiveFact = build('request-r16e-positive-fact', '设备支持IP68防水')
    expect(() => assertContentPlaceholderResolution(positiveFact, '设备具备IP68防水。', [])).not.toThrow()

    const userExperience = build('request-r16e-user-experience', '我的实际体验是续航不够用')
    expect(() => assertContentPlaceholderResolution(userExperience, '我实际使用时续航不够用。', [])).not.toThrow()

    const style = freezeStructuredReference({
      use: use('边界风格稿', 'style_reference'), sourceVersion: 'v1',
      textContent: '王明确认并演示旧型号ABX900的使用方式。李雷说明这台设备握持很舒服。赵强告诉我这台设备很轻巧。', managedAssetId: null, binarySha256: null,
      visualCapability: null, visualSummaryVersion: null, availability: 'ready'
    })
    const negative = build('request-r16e-negative-appearance', '不要出现旧型号ABX900，只参考语气', [style])
    expect(() => validateStyleFactIsolation(negative, ['ABX900值得买。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    expect(negative.forbiddenStyleFacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'person_name', value: '王明' })]))
    expect(negative.forbiddenStyleFacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'person_name', value: '李雷' })]))
    expect(negative.forbiddenStyleFacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'person_name', value: '赵强' })]))

    const discourseStyle = freezeStructuredReference({
      use: use('衔接风格稿', 'style_reference'), sourceVersion: 'v1',
      textContent: '这里说明一下这段体验的背景。下面介绍具体使用过程。', managedAssetId: null, binarySha256: null,
      visualCapability: null, visualSummaryVersion: null, availability: 'ready'
    })
    const discourse = build('request-r16e-discourse-style', '参考衔接方式', [discourseStyle])
    expect(discourse.forbiddenStyleFacts.some((fact) => fact.kind === 'person_name')).toBe(false)
    expect(() => validateStyleFactIsolation(discourse, ['这里说明一下背景，下面介绍具体使用过程。'])).not.toThrow()

    for (const [index, sentence] of ['下面介绍使用过程。', '这里说明使用过程。'].entries()) {
      const shortDiscourseStyle = freezeStructuredReference({
        use: use(`短衔接风格稿${index}`, 'style_reference'), sourceVersion: 'v1', textContent: sentence,
        managedAssetId: null, binarySha256: null, visualCapability: null, visualSummaryVersion: null, availability: 'ready'
      })
      const shortDiscourse = build(`request-r16e-short-discourse-${index}`, '参考衔接方式', [shortDiscourseStyle])
      expect(shortDiscourse.forbiddenStyleFacts.some((fact) => fact.kind === 'person_name')).toBe(false)
      expect(() => validateStyleFactIsolation(shortDiscourse, [sentence])).not.toThrow()
    }

    for (const [index, instruction] of ['移除旧型号ABX900', '别提ABX900', '去除旧型号ABX900', '不提ABX900', '把ABX900拿掉', 'ABX900不用写'].entries()) {
      const excluding = build(`request-r16e-direct-negative-${index}`, instruction, [style])
      expect(() => validateStyleFactIsolation(excluding, ['ABX900值得买。'])).toThrow('PROVIDER_STYLE_FACT_LEAKAGE')
    }

    for (const [index, instruction] of ['不要忘记写型号ABX900', '别忘了写ABX900', '不要改语气但要写ABX900体验', '禁止漏写ABX900'].entries()) {
      const positive = build(`request-r16e-positive-style-${index}`, instruction, [style])
      expect(positive.allowedFacts, instruction).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'model', value: 'ABX900' })]))
      expect(positive.forbiddenStyleFacts.some((fact) => fact.kind === 'model' && fact.value === 'ABX900'), instruction).toBe(false)
      expect(() => validateStyleFactIsolation(positive, ['保留ABX900体验。'])).not.toThrow()
    }
  })
})
