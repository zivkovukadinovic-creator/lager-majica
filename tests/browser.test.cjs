'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),ExcelJS=require('exceljs');
const {start}=require('./support/offline-server.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {server,url}=await start();let browser;const tests=[],errors=[],external=[];
 const ok=name=>{tests.push({name,status:'PASS'});console.log('PASS '+name);};
 try{
  const executable=process.env.CHROMIUM_EXECUTABLE||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
  await context.route('**/*',route=>{const target=new URL(route.request().url());if(target.origin===url)return route.continue();external.push(target.href);return route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#authPanel').waitFor({state:'visible'});
  assert.equal(await page.locator('.brand img').evaluate(i=>i.complete&&i.naturalWidth>0),true);ok('login screen and R BIRO logo render');
  async function login(email){await page.locator('#email').fill(email);await page.locator('#password').fill('offline-fixture-only');await page.locator('#authSubmit').click();await page.locator('#app').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Podaci su učitani'));}
  await login('viewer@example.invalid');assert.equal(await page.locator('#editorPanel').isVisible(),false);assert.equal(await page.locator('button[data-action="edit"]').count(),0);ok('viewer sees inventory with no editor controls');
  await page.selectOption('#filterModel','Muška majica');await page.selectOption('#filterBoja','bijela');await page.selectOption('#filterVelicina','2XL');await page.locator('#search').fill('XXL');assert.equal(await page.locator('#shirtList tr').count(),1);assert.match(await page.locator('#shirtList').innerText(),/bijela/);ok('three filters and legacy-size text search combine');
  await page.locator('#resetFilters').click();assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#shirtList tr').count(),3);ok('reset restores all inventory rows and clears text search');
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportOrder').click();const download=await downloadPromise;
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(await download.path());const sheet=wb.worksheets[0];assert.equal(sheet.getCell('A1').value,'R BIRO doo — Spisak za narudžbu majica');assert.equal(sheet.rowCount,6);assert.equal(sheet.getCell('C5').value,'XS');assert.equal(sheet.getCell('C6').value,'2XL');assert.equal(sheet.getCell('F6').value,null);assert.equal(sheet.getCell('D6').value,5);ok('real browser XLSX download opens with correct rows, quantities and blank order column');
  await page.locator('#logoutBtn').click();await page.locator('#authPanel').waitFor({state:'visible'});await login('editor@example.invalid');assert.equal(await page.locator('#editorPanel').isVisible(),true);
  async function form(model,boja,size,qty,min){for(const [id,value] of Object.entries({model,boja,velicina:size,kolicina:qty,minimalna_kolicina:min}))await page.locator('#'+id).fill(String(value));await page.locator('#saveBtn').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('uspješno su sačuvani'));}
  await form('Muška majica','bijela','XXL',3,6);assert.deepEqual(await page.evaluate(()=>{const r=__offline.rows.find(x=>x.id===30);return [r.id,r.kolicina,r.minimalna_kolicina,__offline.rows.length]}),[30,8,6,3]);ok('editor adds canonical quantity to existing ID without duplicate');
  await page.locator('button[data-action="edit"][data-id="30"]').click();await page.locator('#kolicina').fill('4');await page.locator('#saveBtn').click();await page.waitForFunction(()=>__offline.rows.find(x=>x.id===30).kolicina===4);ok('editing sets absolute quantity');
  await form('Djecja','plava','XXL',2,5);const id=await page.evaluate(()=>__offline.rows.find(x=>x.model==='Dječija').id);assert.equal(await page.evaluate(id=>__offline.rows.find(x=>x.id===id).velicina,id),'2XL');
  page.once('dialog',d=>d.accept());await page.locator(`button[data-action="delete"][data-id="${id}"]`).click();await page.waitForFunction(id=>!__offline.rows.some(x=>x.id===id),id);ok('canonical new row and confirmed delete work');
  await page.locator('#search').fill('no-results-123');assert.match(await page.locator('#shirtList').innerText(),/Nema pronađenih/);await page.locator('#resetFilters').click();
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});await page.screenshot({path:path.join(root,'.local/desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:path.join(root,'.local/mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);ok('mobile 375px layout has no page-level horizontal overflow');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);ok('no JavaScript errors, Supabase requests, email or other external requests');
  fs.writeFileSync(path.join(root,'reports/browser-results.json'),JSON.stringify({browser:browser.version(),scope:'real Chromium with real ExcelJS; offline Supabase test double; connect-src none; loopback only',tests,externalRequests:external,pageErrors:errors},null,2)+'\n');
 }catch(e){console.error(e);fs.writeFileSync(path.join(root,'reports/browser-results.json'),JSON.stringify({tests,error:e.message,externalRequests:external,pageErrors:errors},null,2));process.exitCode=1;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})();
