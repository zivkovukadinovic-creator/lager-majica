'use strict';
// Always creates a disposable local PostgreSQL cluster. No connection URL is accepted.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {Client}=require('pg');
const root=path.resolve(__dirname,'..');
const native=path.join(path.dirname(path.dirname(require.resolve('@embedded-postgres/linux-x64'))),'native');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'lager-pg-local-'));
fs.chmodSync(home,0o700);
const socket=path.join(home,'socket');fs.mkdirSync(socket,{mode:0o700});
const data=path.join(home,'data');
const env={...process.env,LD_LIBRARY_PATH:path.join(native,'lib')+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')};
function command(bin,args){const r=spawnSync(path.join(native,'bin',bin),args,{env,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;}
const sql=fs.readFileSync(path.join(root,'sql/02_minimal_migration.sql'),'utf8');
const enabled=sql.replace('BEGIN;','BEGIN;\nSET LOCAL lager.migration_reviewed = \'yes\';');
const commitSql=enabled.replace(/ROLLBACK;(?=\s*-- COMMIT NAMJERNO NIJE UKLJUCEN\.\s*$)/,'COMMIT;');
const holdSql=enabled.replace(/ROLLBACK;(?=\s*-- COMMIT NAMJERNO NIJE UKLJUCEN\.\s*$)/,'');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/baseline.sql'),'utf8');
const editor='00000000-0000-4000-8000-000000000001',viewer='00000000-0000-4000-8000-000000000002';
let admin,started=false;const results=[];
async function client(){const c=new Client({host:socket,port:55432,user:'postgres',database:'postgres',connectionTimeoutMillis:3000});await c.connect();return c;}
async function one(q,params){return (await admin.query(q,params)).rows;}
async function reset(){await admin.query('ROLLBACK');await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION postgres; GRANT USAGE ON SCHEMA public TO PUBLIC;');await admin.query(fixture);await admin.query(`INSERT INTO auth.users VALUES('${editor}'),('${viewer}') ON CONFLICT DO NOTHING; INSERT INTO public.lager_urednici VALUES('${editor}');`);}
async function migrate(mode='commit'){return admin.query(mode==='commit'?commitSql:enabled);}
async function noCanonical(){assert.equal((await one("SELECT to_regprocedure('public.majice_canonical_size_v4(text)') AS fn"))[0].fn,null);}
async function failMigration(pattern){await assert.rejects(migrate(),pattern);await admin.query('ROLLBACK');await noCanonical();}
async function asRole(role,uid,action){const c=await client();try{await c.query('SET ROLE '+role);if(uid)await c.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid]);return await action(c);}finally{await c.end();}}
async function test(name,fn){try{await reset();await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,status:'FAIL',error:e.message});throw e;}}
(async()=>{
try{
 // The package's small postinstall restores native library symlinks. No downloads.
 const hydrate=path.join(path.dirname(native),'scripts/hydrate-symlinks.js');
 const h=spawnSync(process.execPath,[hydrate],{env,encoding:'utf8'});if(h.status!==0)throw Error(h.stderr);
 command('initdb',['-D',data,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=en_US.UTF-8']);
 command('pg_ctl',['-D',data,'-l',path.join(home,'postgres.log'),'-o',`-k ${socket} -p 55432 -c listen_addresses=''`,'-w','start']);started=true;
 admin=await client();
 const version=(await one("SELECT version(),datctype AS lc_ctype FROM pg_database WHERE datname=current_database()"))[0];
 console.log(JSON.stringify(version));
 await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO PUBLIC; GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;`);
 await test('original new-app payload creates a duplicate on old production structure',async()=>{
  await admin.query('BEGIN');await admin.query("SELECT public.dodaj_majice_sa_minimumom('Muška majica','bijela','2XL',3,6)");
  const r=await one("SELECT id,velicina,kolicina FROM public.majice WHERE boja='bijela' ORDER BY id");
  assert.equal(r.length,2);assert.equal(r[0].id,'30');assert.equal(r[0].velicina,'XXL');assert.equal(r[1].velicina,'2XL');await admin.query('ROLLBACK');
 });
 await test('packaged read-only preflight and post-migration queries execute locally',async()=>{
  const before=await admin.query(fs.readFileSync(path.join(root,'sql/01_readonly_checks.sql'),'utf8'));
  assert.equal(before.rows[0].invalid_rows,'0');assert.equal(before.rows[0].collision_groups,'0');assert.equal(before.rows[0].proposed_changes.length,2);
  await migrate();await admin.query(fs.readFileSync(path.join(root,'sql/03_verify.sql'),'utf8'));
 });
 await test('default guard blocks execution',async()=>{await assert.rejects(admin.query(sql),/NACRT/);await admin.query('ROLLBACK');await noCanonical();});
 await test('dry run checks every row and rolls back all canonical objects',async()=>{await migrate('dry');await noCanonical();assert.equal((await one('SELECT velicina FROM public.majice WHERE id=30'))[0].velicina,'XXL');});
 await test('minimal migration commits and preserves IDs, quantities, minima, RPC ACLs and column structure',async()=>{
  await migrate();assert.deepEqual(await one('SELECT id,velicina,kolicina,minimalna_kolicina FROM public.majice ORDER BY id'),[{id:'30',velicina:'2XL',kolicina:5,minimalna_kolicina:5},{id:'42',velicina:'2XL',kolicina:10,minimalna_kolicina:5}]);
  assert.equal((await one("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='majice' AND column_name='kolicina'"))[0].data_type,'smallint');
 });
 for(const [name,mutation,pattern] of [
  ['canonical collision',"INSERT INTO public.majice(model,boja,velicina,kolicina) VALUES('Muška majica','bijela','2XL',2)",/kolizije/],
  ['NULL quantity',"UPDATE public.majice SET kolicina=NULL WHERE id=30",/Neispravni/],
  ['blank color',"UPDATE public.majice SET boja='  ' WHERE id=30",/Neispravni/],
  ['negative quantity',"UPDATE public.majice SET kolicina=-1 WHERE id=30",/Neispravni/],
  ['unreviewed extra normalization',"INSERT INTO public.majice(model,boja,velicina,kolicina) VALUES('Muska','plava','M',2)",/Spisak/]
 ])await test('aborts without partial changes: '+name,async()=>{try{await admin.query(mutation);await failMigration(pattern);}finally{if(name.includes('default'))await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon');}});
 await test('new function ACLs normalize default grants without changing existing RPC ACLs',async()=>{
  await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon');
  try{await migrate();const acl=await one("SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.majice_canonical_size_v4(text)'::regprocedure AND a.grantee='anon'::regrole");assert.equal(acl.length,0);}finally{await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon');}
 });
 await test('old dodaj_majice aliases add to ID 30 and keep its minimum',async()=>{await migrate();await admin.query("SELECT public.dodaj_majice('Muška majica','bijela','XXL',3)");assert.deepEqual((await one('SELECT id,kolicina,minimalna_kolicina FROM public.majice WHERE id=30'))[0],{id:'30',kolicina:8,minimalna_kolicina:5});assert.equal((await one('SELECT count(*) AS n FROM public.majice'))[0].n,'2');});
 await test('minimum RPC accepts zero and replaces minimum without changing quantity',async()=>{await migrate();await admin.query("SELECT public.dodaj_majice_sa_minimumom('Muška majica','bijela','XXL',0,9)");assert.deepEqual((await one('SELECT kolicina,minimalna_kolicina FROM public.majice WHERE id=30'))[0],{kolicina:5,minimalna_kolicina:9});});
 await test('direct canonical collision is rejected without merging',async()=>{await migrate();await assert.rejects(admin.query("INSERT INTO public.majice(model,boja,velicina,kolicina) VALUES('Muška majica','bijela','XXL',1)"),e=>e.code==='23505');assert.equal((await one('SELECT kolicina FROM public.majice WHERE id=30'))[0].kolicina,5);});
 await test('editing into an occupied canonical key is rejected without merging',async()=>{
  await migrate();await assert.rejects(admin.query("UPDATE public.majice SET boja='bijela' WHERE id=42"),e=>e.code==='23505');
  assert.deepEqual((await one('SELECT id,kolicina FROM public.majice ORDER BY id')),[{id:'30',kolicina:5},{id:'42',kolicina:10}]);
 });
 await test('custom model is preserved; known aliases and large sizes canonicalize',async()=>{await migrate();for(const [raw,canonical] of [['Muska','Muška'],['Zenska','Ženska'],['Djecja','Dječija'],['Muška majica','Muška majica']])assert.equal((await admin.query('SELECT public.majice_canonical_model_v4($1) AS x',[raw])).rows[0].x,canonical);assert.equal((await one("SELECT public.majice_canonical_size_v4('XXXXXXL') AS x"))[0].x,'6XL');});
 await test('smallint overflow is atomic; widening is not needed for standardization',async()=>{await migrate();await admin.query('UPDATE public.majice SET kolicina=32767 WHERE id=30');await assert.rejects(admin.query("SELECT public.dodaj_majice('Muška majica','bijela','XXL',1)"),e=>e.code==='22003');assert.equal((await one('SELECT kolicina FROM public.majice WHERE id=30'))[0].kolicina,32767);});
 await test('two independent concurrent RPC sessions sum quantities and retain one new ID',async()=>{await migrate();const a=await client(),b=await client();try{await Promise.all([a.query("SELECT public.dodaj_majice_sa_minimumom('Muska','plava','XXL',3,6)"),b.query("SELECT public.dodaj_majice_sa_minimumom('Muška','plava','2XL',4,7)")]);const rows=await one("SELECT kolicina,minimalna_kolicina FROM public.majice WHERE model='Muška' AND boja='plava'");assert.equal(rows.length,1);assert.equal(rows[0].kolicina,7);assert.ok([6,7].includes(rows[0].minimalna_kolicina));}finally{await a.end();await b.end();}});
 await test('mixed old/new RPC concurrency preserves sum and latest minimum update',async()=>{await migrate();const a=await client(),b=await client();try{await a.query('BEGIN');await a.query("SELECT public.dodaj_majice('Muška majica','bijela','XXL',3)");let done=false;const pending=b.query("SELECT public.dodaj_majice_sa_minimumom('Muška majica','bijela','2XL',4,8)").then(()=>{done=true});await new Promise(r=>setTimeout(r,100));assert.equal(done,false);await a.query('COMMIT');await pending;assert.deepEqual((await one('SELECT kolicina,minimalna_kolicina FROM public.majice WHERE id=30'))[0],{kolicina:12,minimalna_kolicina:8});}finally{await a.query('ROLLBACK');await a.end();await b.end();}});
 await test('migration lock prevents parallel writes until rollback',async()=>{await admin.query(holdSql);const b=await client();try{await b.query("SET lock_timeout='100ms'");await assert.rejects(b.query("SELECT public.dodaj_majice('Muška majica','bijela','XXL',1)"),e=>e.code==='55P03');}finally{await b.end();await admin.query('ROLLBACK');}await noCanonical();});
 await test('RLS: viewer reads but cannot change through either RPC or direct DML',async()=>{await migrate();await asRole('authenticated',viewer,async c=>{assert.equal((await c.query('SELECT count(*) AS n FROM public.majice')).rows[0].n,'2');for(const q of ["SELECT public.dodaj_majice('Muška majica','bijela','XXL',1)","SELECT public.dodaj_majice_sa_minimumom('Muška majica','bijela','XXL',1,8)","INSERT INTO public.majice(model,boja,velicina,kolicina) VALUES('Basic','x','M',1)"])await assert.rejects(c.query(q),e=>e.code==='42501');assert.equal((await c.query('UPDATE public.majice SET kolicina=0 RETURNING id')).rowCount,0);assert.equal((await c.query('DELETE FROM public.majice RETURNING id')).rowCount,0);});assert.equal((await one('SELECT kolicina FROM public.majice WHERE id=30'))[0].kolicina,5);});
 await test('RLS: editor can add, update and delete; only own editor UUID visible',async()=>{await migrate();await asRole('authenticated',editor,async c=>{assert.equal((await c.query('SELECT user_id FROM public.lager_urednici')).rowCount,1);await c.query("SELECT public.dodaj_majice_sa_minimumom('Basic','x','M',2,3)");assert.equal((await c.query("UPDATE public.majice SET kolicina=1 WHERE model='Basic' RETURNING id")).rowCount,1);assert.equal((await c.query("DELETE FROM public.majice WHERE model='Basic' RETURNING id")).rowCount,1);});});
 await test('RLS: anon sees no inventory and has no RPC execute',async()=>{await migrate();await asRole('anon',null,async c=>{assert.equal((await c.query('SELECT * FROM public.majice')).rowCount,0);await assert.rejects(c.query("SELECT public.dodaj_majice('Basic','x','M',1)"),e=>e.code==='42501');});});
 await test('repeating migration is rejected without losing committed rows',async()=>{await migrate();await assert.rejects(migrate(),/trigger|Kanonski/i);await admin.query('ROLLBACK');assert.equal((await one('SELECT count(*) AS n FROM public.majice'))[0].n,'2');});
 fs.writeFileSync(path.join(root,'reports/database-results.json'),JSON.stringify({version,scope:'disposable Unix-socket-only local PostgreSQL; synthetic fixture; auth.uid claim stub; no Supabase connection',tests:results},null,2)+'\n');
}catch(e){console.error(e);fs.writeFileSync(path.join(root,'reports/database-results.json'),JSON.stringify({tests:results,error:e.message},null,2));process.exitCode=1;}
finally{if(admin)await admin.end().catch(()=>{});if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(home,{recursive:true,force:true});}
})();
