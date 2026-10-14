import { _electron as electron } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(appRoot, '.local-evidence/r4-visual')
const userData = resolve(appRoot, 'test-results/r4-visual-user-data')
await rm(userData, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

const electronApp = await electron.launch({
  args: ['.'],
  cwd: appRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    CREATOR_OS_TEST_BACKGROUND: '1',
    CREATOR_OS_USER_DATA: userData
  }
})

try {
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => globalThis.creatorOS?.getWorkspace !== undefined)
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setSize(1440, 900))

  const secondProjectId = await page.evaluate(async () => {
    const second = await globalThis.creatorOS.createProject({
      title: '桌面支架商单', description: '用于展示合并发票和共用转账记录。',
      contentTypeId: 'type-commercial', templateId: 'template-commercial', colorToken: 'project-5', platformTargets: ['小红书']
    })
    await globalThis.creatorOS.saveBusinessRecord('sponsor', {
      orderPlatform: '花火', orderDate: '2026-07-20', quotedAmountCents: 7_000_000, platformOrderAmountCents: 6_800_000,
      finalRebateRatePercent: 20, finalRebateAmountCents: null, rebateRequirement: 'required',
      rebateRecipientType: 'corporate', rebateRecipientName: '合作代理公司', rebateProcedureStatus: 'complete',
      plannedRebateDate: '2026-07-25', paymentStatus: 'received', paymentReceivedDate: '2026-07-24',
      invoiceRequirement: 'not_required', videoProductionCostCents: 100_000, trafficPromotionCostCents: 50_000,
      incomeAttributionDate: '2026-07-20', notes: 'R4视觉验收数据'
    })
    const rebate = await globalThis.creatorOS.saveRebatePayment('sponsor', null, { amountCents: 1_360_000, paidDate: '2026-07-25', notes: '单次返点' })
    await globalThis.creatorOS.importBusinessFile(
      'sponsor',
      'rebate_payment_proof',
      '返点转账记录.pdf',
      new TextEncoder().encode('%PDF-1.7\nR4 visual transfer proof'),
      { rebatePaymentId: rebate.rebatePayment.id, linkedProjectIds: [second.id] }
    )
    return second.id
  })

  await page.evaluate(() => { globalThis.location.hash = '#/project/sponsor/business' })
  await page.getByRole('heading', { name: '商单', exact: true }).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'business-project-light-1440x900.png'), fullPage: true })

  await page.evaluate(() => { globalThis.location.hash = '#/business?project=sponsor' })
  await page.getByRole('complementary', { name: '商单详情' }).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'business-ledger-light-1440x900.png') })

  await page.evaluate(async () => globalThis.creatorOS.setPreferences({ theme: 'dark' }))
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await nativeWindow.evaluate((window) => window.setSize(880, 720))
  await page.getByRole('button', { name: /无线麦克风商单/ }).click()
  await page.getByRole('complementary', { name: '商单详情' }).waitFor()
  await page.screenshot({ path: resolve(outputDirectory, 'business-ledger-dark-880x720.png') })

  console.log(`R4 visual evidence captured: ${outputDirectory}; linked project ${secondProjectId}`)
} finally {
  await electronApp.close()
}
