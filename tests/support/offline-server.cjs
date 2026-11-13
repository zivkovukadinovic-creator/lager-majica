'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function start(){return new Promise(resolve=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','/__offline/supabase.js')
  .replace('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js','/__offline/exceljs.js')
  .replace('<body>','<body><p style="background:#fff0b0;padding:12px">OFFLINE TEST — sintetički lager, bez pristupa Supabase-u i bez slanja poruka</p>');
 const assets={'/':['text/html; charset=utf-8',html],'/index.html':['text/html; charset=utf-8',html],
  '/R BIRO logo.svg':['image/svg+xml',fs.readFileSync(path.join(root,'R BIRO logo.svg'))],
  '/__offline/supabase.js':['application/javascript',fs.readFileSync(path.join(__dirname,'mock-supabase.js'))],
  '/__offline/exceljs.js':['application/javascript',fs.readFileSync(require.resolve('exceljs/dist/exceljs.min.js'))]};
 const server=http.createServer((req,res)=>{
  const p=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);const item=assets[p];
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; form-action 'none'");
  res.setHeader('Cache-Control','no-store');
  if(!item){res.writeHead(404);return res.end('Not found')};res.setHeader('Content-Type',item[0]);res.end(item[1]);
 });server.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));
});}
module.exports={start};
if(require.main===module)start().then(({url})=>console.log('OFFLINE PREVIEW ONLY: '+url));
