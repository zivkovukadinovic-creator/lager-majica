const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
function app() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value:'',textContent:'',innerHTML:'',disabled:false,
      listeners:{},options:[],classList:{add(){},remove(){},toggle(){}},reset(){},
      addEventListener(name, fn){this.listeners[name]=fn;},
      replaceChildren(option){this.options=[option];}, add(option){this.options.push(option);}});
    return elements.get(id);
  };
  const context = vm.createContext({document:{getElementById:element},window:{},
    Option:function(text,value){this.text=text;this.value=value;},console});
  vm.runInContext(script, context);
  return {run:code=>vm.runInContext(code,context), element, context};
}
test('models: all requested aliases, decomposed accents, spaces; custom names preserved',()=>{
  const a=app();
  for(const s of ['Muska','Muška','muska','MUŠKA','  Muš ka  ','Mus\u030cka']) assert.equal(a.run(`normalizeModel(${JSON.stringify(s)})`),'Muška');
  for(const s of ['Zenska','Ženska','zenska','ŽENSKA']) assert.equal(a.run(`normalizeModel(${JSON.stringify(s)})`),'Ženska');
  for(const s of ['Djecja','Dječja','Djecija','Dječija','djecja','DJECJA']) assert.equal(a.run(`normalizeModel(${JSON.stringify(s)})`),'Dječija');
  assert.equal(a.run('normalizeModel("Basic Premium")'),'Basic Premium');
});
test('sizes: aliases, large sizes, natural order and unknown labels',()=>{
  const a=app();
  for(const [raw,expected] of [['xs','XS'],['s','S'],['m','M'],['l','L'],['xl','XL'],['XXL','2XL'],['xxxL','3XL'],['XXXXL','4XL'],['XXXXXL','5XL'],['XXXXXXL','6XL'],['7xl','7XL'],['XXXXXXXXL','8XL'],['128','128']]) assert.equal(a.run(`normalizeSize(${JSON.stringify(raw)})`),expected);
  assert.equal(a.run('JSON.stringify(["10XL","3XL","XS","XL","2XL","S","M","L","6XL"].sort(compareSizes))'),JSON.stringify(['XS','S','M','L','XL','2XL','3XL','6XL','10XL']));
});
test('loaded rows retain IDs, quantities and minima; filters collapse aliases; all filters combine',async()=>{
  const a=app();
  a.run(`currentUser={id:'fake'}; db={from(){return {select(){return {order:async()=>({data:[
    {id:1,model:'Muska',boja:'crna',velicina:'XXL',kolicina:3,minimalna_kolicina:4},
    {id:2,model:'Muška',boja:'crna',velicina:'2xl',kolicina:7,minimalna_kolicina:2},
    {id:3,model:'Zenska',boja:'bijela',velicina:'xs',kolicina:1,minimalna_kolicina:2}
  ]})}}}}}`);
  await a.run('loadShirts()');
  assert.equal(a.run('shirts.length'),3);
  assert.equal(a.run('shirts.find(x=>x.id===1).kolicina'),3);
  assert.equal(a.run('shirts.find(x=>x.id===2).minimalna_kolicina'),2);
  assert.deepEqual(a.element('filterVelicina').options.map(x=>x.value),['','XS','2XL']);
  a.element('filterModel').value='Muška'; a.element('filterBoja').value='crna'; a.element('filterVelicina').value='2XL';
  a.run('renderShirts()'); assert.match(a.element('shirtList').innerHTML,/Muška/); assert.doesNotMatch(a.element('shirtList').innerHTML,/Ženska/);
  assert.match(a.element('dopunaList').innerHTML,/XS/);
});
async function save({rows=[],edit=null}) {
  const a=app(); const calls=[];
  a.context.rows=rows; a.context.calls=calls;
  a.run(`currentUser={id:'fake'};isEditor=true;editingId=${JSON.stringify(edit)};
    db={from(){return {select(){return {data:rows}},update(payload){calls.push(['update',payload]); return {eq(){return {select(){return {data:[{id:1}]}}}}}}}},
    rpc:async(name,payload)=>{calls.push(['rpc',name,payload]);return {data:1}}};
    loadShirts=async()=>{};`);
  for(const [id,value] of Object.entries({model:'Muska',boja:'crna',velicina:'xxl',kolicina:'3',minimalna_kolicina:'5'})) a.element(id).value=value;
  await a.element('shirtForm').listeners.submit({preventDefault(){}});
  return {a,calls};
}
test('new and legacy-match writes send canonical RPC payload',async()=>{
  const {calls}=await save({});
  assert.equal(calls[0][2].p_model,'Muška'); assert.equal(calls[0][2].p_velicina,'2XL');
  const existing=await save({rows:[{id:9,model:'Muska',boja:'crna',velicina:'XXL'}]});
  assert.equal(existing.calls[0][2].p_model,'Muška'); assert.equal(existing.calls[0][2].p_velicina,'2XL');
  assert.equal(existing.calls[0][2].p_kolicina,3); assert.equal(existing.calls[0][2].p_minimalna_kolicina,5);
});
test('existing duplicate groups and edit collisions block writes without merging',async()=>{
  const rows=[{id:1,model:'Muska',boja:'crna',velicina:'XXL'},{id:2,model:'Muška',boja:'crna',velicina:'2XL'}];
  const duplicate=await save({rows}); assert.equal(duplicate.calls.length,0); assert.match(duplicate.a.element('status').textContent,/provjera/);
  const collision=await save({rows:rows.slice(0,1),edit:2}); assert.equal(collision.calls.length,0); assert.match(collision.a.element('status').textContent,/već postoji/);
  const own=await save({rows:rows.slice(0,1),edit:1}); assert.equal(own.calls[0][0],'update'); assert.equal(own.calls[0][1].velicina,'2XL');
});
test('Excel receives canonical labels and natural order without altering quantities/minima',async()=>{
  const a=app(), rows=[];
  const row=()=>({getCell(){return {};}});
  a.context.ExcelJS={Workbook:class {
    constructor(){this.xlsx={writeBuffer:async()=>new Uint8Array()};}
    addWorksheet(){return {mergeCells(){},getCell(){return {};},getRow:row,
      addRow(values){rows.push(values);return row();},rowCount:8};}
  }};
  a.context.window.ExcelJS=a.context.ExcelJS;
  a.context.Blob=class {};
  a.context.URL={createObjectURL(){return 'blob:mock';},revokeObjectURL(){}};
  a.context.setTimeout=()=>{};
  a.context.document.createElement=()=>({click(){},remove(){}});
  a.context.document.body={append(){}};
  a.run(`shirts=['XXL','xs','10xl','XL'].map((velicina,id)=>normalizeShirt({id,model:'Djecja',boja:'crna',velicina,kolicina:1,minimalna_kolicina:3}));`);
  await a.run('exportOrder()');
  assert.deepEqual(rows.map(r=>r[2]),['XS','XL','2XL','10XL']);
  assert.ok(rows.every(r=>r[0]==='Dječija' && r[3]===1 && r[4]===3));
  assert.match(a.element('status').textContent,/preuzet/);
});

test('collision identity retains existing database case-insensitive color/custom-name rules',()=>{
  const a=app();
  assert.equal(a.run('sameShirt({model:" basic ",boja:" CRNA ",velicina:"xxl"},"Basic","crna","2XL")'),true);
});


test('production configuration retained and no test endpoint or signup call remains',()=>{
 assert.match(html,/https:\/\/uoonawjzquwcqnwqdjbu\.supabase\.co/);
 assert.match(html,/sb_publishable_f4hBY2VssBilS_lL_GR-wQ__bnWwrzj/);
 assert.doesNotMatch(html,/ikrzmaxakcnhmbzynieg|LQXcMYws|\.signUp\(/);
});
test('production text search combines with three filters and reset clears all four',()=>{
 const a=app();
 a.run(`shirts=[{id:1,model:'Muška',boja:'crna',velicina:'2XL',kolicina:3,minimalna_kolicina:4},{id:2,model:'Ženska',boja:'bijela',velicina:'M',kolicina:2,minimalna_kolicina:0}];`);
 a.element('search').value='xxl';a.element('filterBoja').value='crna';a.element('filterModel').value='Muška';a.element('filterVelicina').value='2XL';
 a.run('renderShirts()');assert.match(a.element('shirtList').innerHTML,/Muška/);assert.doesNotMatch(a.element('shirtList').innerHTML,/Ženska/);
 a.element('search').value='bijela';a.run('renderShirts()');assert.match(a.element('shirtList').innerHTML,/Nema pronađenih/);
 a.element('resetFilters').listeners.click();
 for(const id of ['search','filterModel','filterBoja','filterVelicina'])assert.equal(a.element(id).value,'');
 assert.match(a.element('shirtList').innerHTML,/Ženska/);
});
test('viewer form submission cannot call any write',async()=>{
 const a=app();a.context.calls=[];a.run(`currentUser={id:'viewer'};isEditor=false;db={rpc(){calls.push('rpc')},from(){calls.push('from')}};`);
 await a.element('shirtForm').listeners.submit({preventDefault(){}});
 assert.equal(a.context.calls.length,0);assert.match(a.element('status').textContent,/Nemaš pravo/);
});
test('zero quantity remains allowed by production RPC contract',async()=>{
 const a=app();a.context.calls=[];a.run(`currentUser={id:'editor'};isEditor=true;db={from(){return {select(){return {data:[]}}}},rpc:async(name,payload)=>{calls.push(payload);return {}}};loadShirts=async()=>{};`);
 for(const [id,value] of Object.entries({model:'Muška majica',boja:'bijela',velicina:'XXL',kolicina:'0',minimalna_kolicina:'0'}))a.element(id).value=value;
 await a.element('shirtForm').listeners.submit({preventDefault(){}});
 assert.equal(a.context.calls.length,1);assert.equal(a.context.calls[0].p_kolicina,0);assert.equal(a.context.calls[0].p_velicina,'2XL');
});
test('HTML escapes untrusted inventory labels',()=>{
 const a=app();a.run(`shirts=[{id:1,model:'<img src=x onerror=alert(1)>',boja:'crna',velicina:'M',kolicina:1,minimalna_kolicina:0}];renderShirts();`);
 assert.doesNotMatch(a.element('shirtList').innerHTML,/<img/);assert.match(a.element('shirtList').innerHTML,/&lt;img/);
});
test('real XLSX roundtrip preserves text cells, quantities, empty order column and size order',async()=>{
 const a=app();const ExcelJS=require('exceljs');let buffer;
 a.context.setTimeout=setTimeout;a.context.clearTimeout=clearTimeout;
 vm.runInContext(fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'),'utf8'),a.context);
 a.context.ExcelJS=a.context.window.ExcelJS;
 a.context.Blob=class{constructor(parts){buffer=parts[0]}};
 a.context.URL={createObjectURL(){return 'blob:local'},revokeObjectURL(){}};
 const nativeTimeout=setTimeout;a.context.setTimeout=(fn,ms)=>ms===60000?0:nativeTimeout(fn,ms);
 a.context.document.createElement=()=>({click(){},remove(){}});a.context.document.body={append(){}};
 a.run(`shirts=['10XL','XXL','XS'].map((velicina,id)=>normalizeShirt({id,model:'=1+1',boja:'crna',velicina,kolicina:2,minimalna_kolicina:3})); shirts.push({id:9,model:'Skip',boja:'x',velicina:'M',kolicina:0,minimalna_kolicina:0});`);
 await a.run('exportOrder()');assert.ok(buffer);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer);const sheet=wb.worksheets[0];
 assert.equal(sheet.rowCount,7);assert.deepEqual([5,6,7].map(r=>sheet.getCell(r,3).value),['XS','2XL','10XL']);
 for(const r of [5,6,7]){assert.equal(sheet.getCell(r,1).value,'=1+1');assert.equal(sheet.getCell(r,4).value,2);assert.equal(sheet.getCell(r,5).value,3);assert.equal(sheet.getCell(r,6).value,null);}
});


test('editor login fails closed for writes when migration helper is missing',async()=>{
 const a=app();a.run(`db={from(){return {select(){return {eq(){return {maybeSingle:async()=>({data:{user_id:'editor'}})}}}}}},rpc:async()=>({data:null,error:{message:'not found'}})};loadShirts=async()=>{};`);
 await a.run("applySession({user:{id:'editor',email:'editor@example.invalid'}})");
 assert.equal(a.run('isEditor'),false);assert.match(a.element('status').textContent,/migraciju/);
});
