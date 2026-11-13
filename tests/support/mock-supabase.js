// OFFLINE TEST DOUBLE. No fetch, email, external services or real accounts.
(() => {
 const state=window.__offline={user:null,writes:0,rows:[
  {id:30,model:'Muška majica',boja:'bijela',velicina:'2XL',kolicina:5,minimalna_kolicina:5},
  {id:42,model:'Muška majica',boja:'crna',velicina:'2XL',kolicina:10,minimalna_kolicina:5},
  {id:43,model:'Muška',boja:'crna',velicina:'XS',kolicina:1,minimalna_kolicina:3}
 ]};let callback;
 const clone=x=>JSON.parse(JSON.stringify(x));
 const isEditor=()=>state.user?.id==='offline-editor';
 const model=x=>({muska:'Muška',zenska:'Ženska',djecja:'Dječija',djecija:'Dječija'}[x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s/g,'').toLowerCase()]||x);
 const size=x=>/^X{2,}L$/i.test(x)?(x.length-1)+'XL':x.toUpperCase()==='1XL'?'XL':x.toUpperCase();
 const key=x=>[model(x.model).trim().toLowerCase(),x.boja.trim().toLowerCase(),size(x.velicina)].join('|');
 class Query{
  constructor(table){this.table=table;this.action='select';this.filters=[];}
  select(){return this;}order(){return this;}eq(k,v){this.filters.push(x=>String(x[k])===String(v));return this;}
  update(payload){this.action='update';this.payload=payload;return this;}delete(){this.action='delete';return this;}
  async maybeSingle(){return {data:state.user&&isEditor()?{user_id:state.user.id}:null,error:null};}
  then(resolve,reject){return Promise.resolve().then(()=>{
   if(!state.user)return {data:[],error:null};
   let rows=state.rows.filter(x=>this.filters.every(f=>f(x)));
   if(this.action!=='select'){
    if(!isEditor())return {data:[],error:null};
    if(this.action==='update')for(const row of rows){const next={...row,...this.payload};if(state.rows.some(x=>x.id!==row.id&&key(x)===key(next)))return {error:{message:'duplicate key'}};Object.assign(row,this.payload);}
    if(this.action==='delete')state.rows=state.rows.filter(x=>!rows.includes(x));
    state.writes++;
   }
   return {data:clone(rows),error:null};
  }).then(resolve,reject);}
 }
 window.supabase={createClient(){return {
  auth:{onAuthStateChange(cb){callback=cb;setTimeout(()=>cb('INITIAL_SESSION',null),0);return {data:{subscription:{unsubscribe(){}}}};},
   async signInWithPassword({email}){state.user={id:email.startsWith('viewer')?'offline-viewer':'offline-editor',email};return {data:{session:{user:state.user}},error:null};},
   async signOut(){state.user=null;if(callback)callback('SIGNED_OUT',null);return {error:null};}},
  from(table){return new Query(table)},
  async rpc(name,p){
   if(name==='majice_canonical_size_v4')return {data:'2XL',error:null};
   if(!isEditor())return {error:{message:'permission denied'}};
   if(name!=='dodaj_majice_sa_minimumom')throw Error('Unexpected offline RPC');
   const item={model:model(p.p_model),boja:p.p_boja,velicina:size(p.p_velicina),kolicina:p.p_kolicina,minimalna_kolicina:p.p_minimalna_kolicina};
   const existing=state.rows.find(x=>key(x)===key(item));
   if(existing){existing.kolicina+=item.kolicina;existing.minimalna_kolicina=item.minimalna_kolicina;}
   else state.rows.push({...item,id:Math.max(...state.rows.map(x=>x.id))+1});
   state.writes++;return {data:null,error:null};
  }
 }}};
})();
