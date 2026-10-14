import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import type { CreatorOSApi } from '../../src/shared/ipc'
type Globals = typeof globalThis & { creatorOS: CreatorOSApi }
let app:ElectronApplication,page:Page
let png:Buffer
test.beforeEach(async ({browserName},info)=>{
 expect(browserName).toBe('chromium')
 app=await electron.launch({args:['.'],cwd:join(import.meta.dirname,'../..'),env:{...process.env,NODE_ENV:'test',CREATOR_OS_TEST_BACKGROUND:'1',CREATOR_OS_TEST_DATE:'2026-09-27',CREATOR_OS_USER_DATA:info.outputPath('user-data')}})
 png=Buffer.from(await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.alloc(16,200),{width:2,height:2}).toPNG().toString('base64')),'base64')
 page=await app.firstWindow()
 await expect.poll(()=>page.evaluate(async()=>!!(await(globalThis as Globals).creatorOS.getWorkspace()).today)).toBe(true)
 await page.evaluate(()=>{location.hash='#/reviews?kind=weekly&anchor=2026-09-27'})
 await expect(page.locator('[data-canvas-kind="checkin"]')).toBeVisible()
})
test.afterEach(async()=>{await app?.close()})
async function transfer(selector:string,type:'drop'|'paste',name='HRV.png',bytes=png):Promise<void>{
 await page.locator(selector).evaluate((el,{type,name,bytes})=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],name,{type:'image/png'}));el.dispatchEvent(type==='drop'?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))},{type,name,bytes:Array.from(bytes)})
}
test('three columns, visible checkins, resizable widths and responsive themes',async({browserName},info)=>{
 expect(browserName).toBe('chromium')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setContentSize(1500,1000))
 const left=page.locator('.review-goals-column'),middle=page.locator('.review-hours'),right=page.locator('.review-schedule'),checkin=page.locator('[data-canvas-kind="checkin"]')
 await expect(right).toHaveAttribute('open','')
 await expect.poll(async()=>{const a=(await left.boundingBox())!,b=(await middle.boundingBox())!,c=(await right.boundingBox())!;return a.x+a.width<=b.x&&b.x+b.width<=c.x&&Math.abs(a.y-c.y)<2}).toBe(true)
 expect((await checkin.boundingBox())!.y).toBeLessThan(650)
 const divider=page.getByRole('separator',{name:'调整目标与打卡栏宽度'})
 const initial=Number(await divider.getAttribute('aria-valuenow'));await divider.focus();await page.keyboard.press('ArrowRight');await expect(divider).toHaveAttribute('aria-valuenow',String(initial+16))
 await page.reload();await expect(divider).toHaveAttribute('aria-valuenow',String(initial+16))
 for(const width of [1500,880,680]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0]!.setContentSize(width,1000),width)
  for(const theme of ['light','dark'])for(const visualStyle of ['warm','feishu']){
   await page.evaluate(([theme,visualStyle])=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.visualStyle=visualStyle},[theme,visualStyle])
   await expect.poll(()=>page.locator('.review-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
   if(width===1500&&visualStyle==='feishu')await page.screenshot({path:info.outputPath(`canvas-${theme}.png`)})
  }
 }
})
test('direct text, drop and paste images persist without modal; resize, reorder, delete and same-source daily',async()=>{
 const canvas=page.locator('[data-canvas-kind="checkin"]')
 await transfer('[data-canvas-kind="checkin"]','drop')
 await expect(canvas.locator('.review-inline-record[data-review-entry]')).toHaveCount(1)
 await expect(canvas.locator('.review-canvas-images .review-thumbnail img')).toBeVisible()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 const record=canvas.locator('.review-inline-record[data-review-entry]').first(),id=(await record.getAttribute('data-review-entry'))!
 await transfer(`[data-review-entry="${id}"]`,'paste','运动.png')
 await expect(record.locator('.review-canvas-images .review-thumbnail img')).toHaveCount(2)
 const text=page.getByRole('textbox',{name:`打卡记录正文${id}`,exact:true});await text.fill('今天运动30分钟');await text.press('Meta+s')
 await expect.poll(()=>page.evaluate(async id=>(await(globalThis as Globals).creatorOS.getReviewEntry(id)).body,id)).toMatchObject({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'今天运动30分钟'}]}]})
 const resize=record.getByRole('separator');await resize.focus();await page.keyboard.press('ArrowLeft');await expect(resize).toHaveAttribute('aria-valuenow','95')
 await page.getByRole('textbox',{name:'生活记录新内容',exact:true}).fill('和家人散步');await page.getByRole('textbox',{name:'生活记录新内容',exact:true}).press('Meta+s')
 await expect(page.locator('[data-canvas-kind="life"] .review-inline-title')).toHaveValue('和家人散步')
 await transfer('[data-canvas-kind="checkin"]','drop','第二张.png')
 await expect(canvas.locator('[data-review-entry]')).toHaveCount(2)
 await expect(canvas.locator('.review-inline-title').first()).toHaveValue('第二张.png')
 await canvas.getByRole('button',{name:'下移第二张.png',exact:true}).click()
 await expect(canvas.locator('.review-inline-title').first()).toHaveValue('HRV.png')
 await page.reload();await expect(page.locator(`[data-review-entry="${id}"]`).getByRole('separator')).toHaveAttribute('aria-valuenow','95')
 await page.getByRole('button',{name:'每日记录',exact:true}).click();await expect(page.locator('.review-daily .todo-work-log')).toHaveAttribute('data-day','2026-09-27')
 await expect(page.locator('[data-canvas-kind="checkin"] [data-review-entry]')).toHaveCount(2)
 await page.getByRole('button',{name:'删除第二张.png',exact:true}).click();await page.getByRole('button',{name:'确认移入已删除',exact:true}).click()
 await expect(page.locator('[data-canvas-kind="checkin"] [data-review-entry]')).toHaveCount(1)
 await page.getByRole('button',{name:'已删除记录（1）'}).click();await page.getByRole('button',{name:'恢复',exact:true}).click();await page.getByRole('button',{name:'返回正常记录',exact:true}).click()
 await expect(page.locator('[data-canvas-kind="checkin"] [data-review-entry]')).toHaveCount(2)
})
test('invalid images and conflicts keep text drafts without orphan records',async()=>{
 const canvas=page.locator('[data-canvas-kind="life"]'),editor=page.getByRole('textbox',{name:'生活记录新内容',exact:true})
 await editor.fill('图片失败仍保留文字')
 await transfer('[data-canvas-kind="life"] .review-inline-composer','drop','bad.png',Buffer.from('<svg onload="bad()"/>'))
 await expect(canvas.getByRole('alert')).toContainText('无法读取')
 await expect(editor).toContainText('图片失败仍保留文字')
 expect(await page.evaluate(async()=>(await(globalThis as Globals).creatorOS.getPersonalReview({kind:'weekly',anchor:'2026-09-27'})).entries.length)).toBe(0)
 await page.reload();await expect(editor).toContainText('图片失败仍保留文字');await editor.press('Meta+s')
 await expect(canvas.locator('[data-review-entry]')).toHaveCount(1)
 const id=(await canvas.locator('[data-review-entry]').getAttribute('data-review-entry'))!
 await page.evaluate(async id=>{const api=(globalThis as Globals).creatorOS,e=await api.getReviewEntry(id);const draft=Object.fromEntries(Object.entries(e).filter(([key])=>!['attachments','updatedAt'].includes(key))) as Omit<typeof e,'attachments'|'updatedAt'>;await api.saveReviewEntry({...draft,title:'其他窗口的标题'})},id)
 await expect(canvas.locator('.review-inline-title')).toHaveValue('其他窗口的标题')
})
test('block drag can move life to checkin; typing conflicts keep a recoverable draft',async()=>{
 const editor=page.getByRole('textbox',{name:'生活记录新内容',exact:true});await editor.fill('生活拖拽记录');await editor.press('Meta+s')
 const life=page.locator('[data-canvas-kind="life"] [data-review-entry]');await expect(life).toHaveCount(1)
 const id=(await life.getAttribute('data-review-entry'))!
 const data=await page.evaluateHandle(id=>{const d=new DataTransfer();d.setData('application/x-review-entry',id);return d},id)
 await page.locator('[data-canvas-kind="checkin"]').dispatchEvent('drop',{dataTransfer:data});await data.dispose()
 const record=page.locator(`[data-canvas-kind="checkin"] [data-review-entry="${id}"]`);await expect(record).toBeVisible();await expect(life).toHaveCount(0)
 const body=record.getByRole('textbox',{name:`打卡记录正文${id}`,exact:true});await body.fill('我的待保存草稿')
 await page.evaluate(async id=>{const api=(globalThis as Globals).creatorOS,e=await api.getReviewEntry(id);const draft=Object.fromEntries(Object.entries(e).filter(([key])=>!['attachments','updatedAt'].includes(key))) as Omit<typeof e,'attachments'|'updatedAt'>;await api.saveReviewEntry({...draft,title:'外部更新'})},id)
 await expect(record.getByRole('alert')).toContainText('已更新');await expect(body).toContainText('我的待保存草稿')
 await page.reload();await expect(body).toContainText('我的待保存草稿');await expect(record.getByRole('alert')).toContainText('已更新')
 await record.getByRole('button',{name:'放弃草稿并加载已保存记录',exact:true}).click();await expect(body).toContainText('生活拖拽记录')
 const revision=await page.evaluate(async id=>(await(globalThis as Globals).creatorOS.getReviewEntry(id)).revision,id)
 await page.waitForTimeout(2100)
 expect(await page.evaluate(async id=>(await(globalThis as Globals).creatorOS.getReviewEntry(id)).revision,id)).toBe(revision)
})

test('filled weekly canvas visual check',async({browserName},info)=>{
 expect(browserName).toBe('chromium')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setContentSize(1500,1000))
 await page.evaluate(async()=>{const api=(globalThis as Globals).creatorOS,data=await api.getPersonalReview({kind:'weekly',anchor:'2026-09-27'});await api.savePersonalReview({...data.period,goals:[{id:crypto.randomUUID(),title:'完成视频剪辑',category:'工作',target:1,done:0},{id:crypto.randomUUID(),title:'陪家人散步',category:'生活',target:1,done:1}]});for(const [day,minutes] of [['21',360],['22',420],['23',0],['24',300]] as const)await api.setDailyWorkLogTotal(`2026-09-${day}`,minutes,await api.getDailyWorkLog(`2026-09-${day}`))})
 await page.reload();await expect(page.locator('.review-goal')).toHaveCount(2)
 const bytes=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=360;const x=c.getContext('2d')!;x.fillStyle='#eff6f3';x.fillRect(0,0,600,360);x.fillStyle='#315b4b';x.font='32px sans-serif';x.fillText('HRV · 测试截图',30,65);x.font='64px sans-serif';x.fillText('62 ms',30,160);x.font='24px sans-serif';x.fillText('2026 / 09 / 27',30,210);x.strokeStyle='#4c8a72';x.lineWidth=4;x.beginPath();x.moveTo(30,300);for(let i=0;i<12;i++)x.lineTo(30+i*48,270-(i%3)*15);x.stroke();return Array.from(Uint8Array.from(atob(c.toDataURL().split(',')[1]!),v=>v.charCodeAt(0)))})
 await transfer('[data-canvas-kind="checkin"]','drop','HRV测试.png',Buffer.from(bytes))
 await expect(page.locator('[data-canvas-kind="checkin"] .review-thumbnail img')).toBeVisible()
 for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.visualStyle='feishu'},theme);await page.locator('[data-canvas-kind="checkin"] .review-thumbnail img').evaluate(async img=>{await (img as HTMLImageElement).decode();await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))) });await page.screenshot({path:info.outputPath(`filled-${theme}.png`)});await page.locator('[data-canvas-kind="checkin"] .review-thumbnail').screenshot({path:info.outputPath(`image-${theme}.png`)})}
})
