'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}

test('password room, host start, one-reel spins, shared locks and reset', {timeout:120000}, async () => {
  const p=await port();const proc=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(p)},stdio:'ignore'});
  const base=`http://127.0.0.1:${p}`;
  async function req(url,data={},cookie=''){
    const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]};
  }
  try{
    for(let i=0;i<40;i++){try{const r=await fetch(base+'/health');if(r.ok)break;}catch(e){}await wait(50)}
    const h=await req('/api/create',{name:'房主',password:'pass1234',mode:0});assert.equal(h.status,200);
    const code=h.body.room.code;assert.match(code,/^[A-Z2-9]{6}$/);
    const wrong=await req('/api/join',{name:'錯誤',code,password:'xxxx'});assert.equal(wrong.status,403);
    const guest=await req('/api/join',{name:'朋友',code,password:'pass1234'});assert.equal(guest.status,200);
    assert.notEqual(guest.body.room.players[0].color,guest.body.room.players[1].color);
    const notHost=await req('/api/start',{},guest.cookie);assert.equal(notHost.status,403);
    const start=await req('/api/start',{},h.cookie);assert.equal(start.status,200);assert.equal(start.body.room.phase,'countdown');
    const before=await req('/api/spin',{slot:0},h.cookie);assert.equal(before.status,409);
    await wait(3200);
    const me=await fetch(base+'/api/me',{headers:{cookie:h.cookie}});assert.equal((await me.json()).room.phase,'playing');
    for(let slot=0;slot<3;slot++){
      let matched=false;
      for(let i=0;i<45;i++){
        assert.equal((await req('/api/spin',{slot},h.cookie)).status,200);
        assert.equal((await req('/api/spin',{slot},guest.cookie)).status,200);
        await wait(1330);
        const res=await fetch(base+'/api/me',{headers:{cookie:h.cookie}}); const state=(await res.json()).room;
        if(state.locked[slot]){matched=true;break}
      }
      assert.equal(matched,true,'slot '+slot+' should eventually match');
    }
    const done=(await (await fetch(base+'/api/me',{headers:{cookie:guest.cookie}})).json()).room;
    assert.equal(done.phase,'finished');
    assert.ok(done.locked.every(Boolean));
    assert.equal((await req('/api/lobby',{},h.cookie)).status,200);
    assert.equal((await req('/api/leave',{},h.cookie)).status,200);
    const guestNew=(await (await fetch(base+'/api/me',{headers:{cookie:guest.cookie}})).json()).room;
    assert.equal(guestNew.viewerId,guestNew.hostId);
  }finally{proc.kill('SIGTERM')}
});
