'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const net=require('node:net');const path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function createServer(){const port=await freePort();const proc=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{env:{...process.env,PORT:String(port)},stdio:'ignore'});const base='http://127.0.0.1:'+port;
 for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await wait(35)}return {base,proc};}
async function post(base,path,data={},cookie=''){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]};}
async function get(base,cookie){return (await (await fetch(base+'/api/me',{headers:{cookie}})).json()).room;}
test('unique votes: each player spins exactly once; host cannot pick the outfit', {timeout:20000},async()=>{
 const {base,proc}=await createServer();try{
  const a=await post(base,'/api/create',{name:'房主',password:'1234',mode:0});assert.equal(a.status,200);
  const b=await post(base,'/api/join',{name:'隊友',password:'1234',code:a.body.room.code});assert.equal(b.status,200);
  assert.equal((await post(base,'/api/start',{},b.cookie)).status,403);
  assert.equal((await post(base,'/api/start',{},a.cookie)).status,200);
  assert.equal((await post(base,'/api/spin',{slot:0},a.cookie)).status,409);
  await wait(3050);
  assert.equal((await post(base,'/api/spin',{slot:1},a.cookie)).status,409);
  assert.equal((await post(base,'/api/spin',{slot:0},a.cookie)).status,200);
  assert.ok([409,429].includes((await post(base,'/api/spin',{slot:0},a.cookie)).status));
  await wait(770);let state=await get(base,a.cookie);assert.equal(state.stage,0);assert.equal(state.roundStatus,'collecting');
  assert.equal((await post(base,'/api/spin',{slot:0},b.cookie)).status,200);
  await wait(780);state=await get(base,a.cookie);assert.equal(state.roundStatus,'reveal');
  assert.equal((await post(base,'/api/spin',{slot:0},a.cookie)).status,409);
  const tied=state.roundSummary.tied;await wait(1470);state=await get(base,a.cookie);
  if(tied){assert.equal(state.stage,0);assert.equal(state.round,2);assert.ok(state.players.every(p=>p.values[0]===null));}
  else {assert.equal(state.stage,1);assert.equal(state.round,1);assert.ok(state.locked[0]);}
 }finally{proc.kill('SIGTERM')}});
