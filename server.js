'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const COLOR_PALETTE = ['#ff5ab7','#55d6d0','#bbeb2c','#ff9560','#9278e9','#52b6f3','#f4cb50','#4fd28b','#ed75a4','#9bb8f2','#eb763c','#c38cde'];
const LABELS = ['主題','配色','小物'];
const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'catalog.json'),'utf8'));
const rooms = new Map();
const sessions = new Map();
const MAX_PEOPLE = 12;
const MAX_BYTES = 4096;
const SPIN_MS = 1250;
const COUNTDOWN_MS = 3000;
const badAttempts = new Map();
const randomId = () => crypto.randomBytes(18).toString('base64url');
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({length:6},()=>chars[crypto.randomInt(chars.length)]).join('');

function json(res, status, obj, extra={}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra }); res.end(JSON.stringify(obj)); }
function fail(res, status, message) { json(res,status,{error:message}); }
function cookies(req) { const raw=req.headers.cookie || ''; return Object.fromEntries(raw.split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x[0])); }
function session(req) { const token=cookies(req).lucky_session; const cur=token&&sessions.get(token); return cur && rooms.has(cur.roomCode) && cur.token===token ? cur : null; }
function assignCookie(res, token) { const secure=process.env.NODE_ENV==='production'?'; Secure':''; res.setHeader('Set-Cookie',`lucky_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`); }
function normalizeName(s) { return typeof s==='string' ? s.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,18) : ''; }
function validPassword(s) { return typeof s==='string'&&s.length>=4&&s.length<=40; }
function passDigest(pass, salt) { return crypto.scryptSync(pass,salt,32); }
function passwordMatches(room, pass) { if(!pass || typeof pass!=='string')return false; const val=passDigest(pass,room.salt); return crypto.timingSafeEqual(val,room.hash); }
function roomView(room, viewerId) {
  return {code:room.code,mode:room.mode,phase:room.phase,startAt:room.startAt,
    hostId:room.hostId,viewerId,locked:room.locked.map((val,i)=>val==null?null:{idx:val,option:catalog[room.mode][i][val]}),
    players:[...room.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,online:p.online,values:p.values.map((v,i)=>v==null?null:{idx:v,option:catalog[room.mode][i][v]}),pending:p.pending})),
    spinMs:SPIN_MS, maxPeople:MAX_PEOPLE,
    lastEvent:room.lastEvent||null,serverNow:Date.now()};
}
function emit(room, message, id=null){
  const payload=JSON.stringify({type:message,room:roomView(room,id||'')});
  for(const [p,member] of room.players){for(const res of member.streams){try{res.write(`event: update\ndata: ${JSON.stringify({type:message,room:roomView(room,p)})}\n\n`)}catch(e){member.streams.delete(res)}}}
}
function announce(room,type){room.lastActive=Date.now();emit(room,type);}
function memberFromRequest(req){const s=session(req);if(!s)return null;const room=rooms.get(s.roomCode);if(!room)return null;const p=room.players.get(s.playerId);return p?{s,room,p}:null;}
function prunePlayer(room,id){const p=room.players.get(id);if(!p)return;for(const stream of p.streams){try{stream.end()}catch(e){}} p.streams.clear();room.players.delete(id);sessions.delete(p.sessionToken);if(room.hostId===id){room.hostId=room.players.keys().next().value||null;}if(room.players.size===0){rooms.delete(room.code);return;}if(room.players.size<2 && (room.phase==='playing'||room.phase==='countdown')){room.phase='lobby';room.startAt=null;room.locked=[null,null,null];for(const member of room.players.values()){member.values=[null,null,null];member.pending=null;}room.lastEvent='人數不足，已返回等待室';}else{checkMatches(room);}announce(room,'player_left');}
function checkMatches(room){if(room.phase!=='playing')return;for(let s=0;s<3;s++){if(room.locked[s]!==null)continue;const players=[...room.players.values()];if(players.length<2)continue;const nums=players.map(p=>p.values[s]);if(nums.every(v=>v!==null&&v===nums[0]))room.locked[s]=nums[0];}
  if(room.locked.every(v=>v!==null)){room.phase='finished';room.lastEvent='全員成功配對！';}}
function chooseSpin(room,slot){
  const options=catalog[room.mode][slot];
  const tally=new Map();for(const p of room.players.values()){const idx=p.values[slot];if(idx!==null)tally.set(idx,(tally.get(idx)||0)+1);}
  // Publicly disclosed "同頻加成": 65% of spins select one currently shared target.
  // This makes a many-person matching game achievable without forcing a predetermined winner.
  if(tally.size && crypto.randomInt(100)<65){const max=Math.max(...tally.values());const top=[...tally].filter(([,votes])=>votes===max).map(([key])=>key);return top[crypto.randomInt(top.length)];}
  return crypto.randomInt(options.length);
}
async function readJson(req){let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>MAX_BYTES)throw Error('資料太長');}try{return JSON.parse(data||'{}')}catch(e){throw Error('資料格式不正確')}}
function requireMember(req,res){const info=memberFromRequest(req);if(!info)fail(res,401,'請先加入房間');return info;}
async function handler(req,res){
  const pathname=new URL(req.url,'http://local.test').pathname;
  if(pathname==='/health'){json(res,200,{ok:true,roomCount:rooms.size});return;}
  if(pathname==='/api/me' && req.method==='GET'){
    const info=memberFromRequest(req);if(!info){fail(res,401,'尚未加入房間');return;}
    json(res,200,{room:roomView(info.room,info.p.id)});return;
  }
  if(pathname==='/api/events' && req.method==='GET'){
    const info=requireMember(req,res);if(!info)return;
    const {room,p}=info;
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write(`retry: 1600\nevent: update\ndata: ${JSON.stringify({type:'sync',room:roomView(room,p.id)})}\n\n`);
    p.streams.add(res);p.online=true;if(p.offlineTimer)clearTimeout(p.offlineTimer);p.offlineTimer=null;
    announce(room,'player_online');
    const keep=setInterval(()=>{try{res.write(': keep-alive\n\n')}catch(e){}},20000);
    req.on('close',()=>{clearInterval(keep);p.streams.delete(res);if(p.streams.size===0){p.online=false;announce(room,'player_offline');p.offlineTimer=setTimeout(()=>{if(!p.online && rooms.get(room.code)===room)prunePlayer(room,p.id)},90000);p.offlineTimer.unref?.();}});
    return;
  }
  if(pathname.startsWith('/api/') && req.method==='POST'){
    let body;try{body=await readJson(req)}catch(e){fail(res,400,e.message);return;}
    if(pathname==='/api/create'||pathname==='/api/join'){
      const name=normalizeName(body.name), pass=body.password;
      if(!name){fail(res,400,'請輸入暱稱');return;}
      if(!validPassword(pass)){fail(res,400,'房間密碼需為 4–40 個字元');return;}
      const prior=memberFromRequest(req);if(prior)prunePlayer(prior.room,prior.p.id);
      let room;
      if(pathname==='/api/create'){
        if(![0,1].includes(body.mode)){fail(res,400,'無效的玩法');return;}
        let code=makeCode();while(rooms.has(code))code=makeCode();
        const salt=crypto.randomBytes(18);
        room={code,mode:body.mode,phase:'lobby',startAt:null,hostId:null,locked:[null,null,null],players:new Map(),salt,hash:passDigest(pass,salt),lastActive:Date.now(),lastEvent:'房間已建立'};
        rooms.set(code,room);
      }else{
        const code=String(body.code||'').trim().toUpperCase();room=rooms.get(code);
        const addr=req.socket.remoteAddress || 'unknown';const k=addr+'|'+code;const at=badAttempts.get(k)||{n:0,until:0};
        if(at.until>Date.now()){fail(res,429,'密碼嘗試過多，請稍後再試');return;}
        if(!room||!passwordMatches(room,pass)){const n=at.n+1;badAttempts.set(k,{n,until:n>=8?Date.now()+60000:0});fail(res,403,'房號或密碼不正確');return;}
        badAttempts.delete(k);
        if(room.phase!=='lobby'){fail(res,409,'這局已開始，請等房主開下一局');return;}
        if(room.players.size>=MAX_PEOPLE){fail(res,409,'房間已滿（最多 12 人）');return;}
      }
      const taken=new Set([...room.players.values()].map(p=>p.color));
      const color=COLOR_PALETTE.find(x=>!taken.has(x))||COLOR_PALETTE[0];
      const id=randomId(), token=randomId();
      const p={id,sessionToken:token,name,color,values:[null,null,null],pending:null,online:false,streams:new Set(),offlineTimer:null,lastSpin:0};
      room.players.set(id,p);sessions.set(token,{token,roomCode:room.code,playerId:id});if(!room.hostId)room.hostId=id;
      assignCookie(res,token);json(res,200,{room:roomView(room,id)});announce(room,'player_joined');return;
    }
    const info=requireMember(req,res);if(!info)return;const {room,p}=info;
    if(pathname==='/api/start'){
      if(room.hostId!==p.id){fail(res,403,'只有房主可以開始');return;}
      if(room.phase!=='lobby' && room.phase!=='finished'){fail(res,409,'目前無法開始新局');return;}
      if(room.players.size<2){fail(res,409,'至少需要 2 人才能開始');return;}
      room.phase='countdown';room.startAt=Date.now()+COUNTDOWN_MS;room.locked=[null,null,null];room.lastEvent='房主開始了倒數！';
      for(const member of room.players.values()){member.values=[null,null,null];member.pending=null;}
      announce(room,'countdown');
      setTimeout(()=>{if(rooms.get(room.code)!==room||room.phase!=='countdown')return;room.phase='playing';room.lastEvent='GO! 大家開始抽選';announce(room,'go');},COUNTDOWN_MS).unref?.();
      json(res,200,{ok:true,room:roomView(room,p.id)});return;
    }
    if(pathname==='/api/spin'){
      const slot=Number(body.slot);
      if(room.phase!=='playing'){fail(res,409,'請等倒數結束，再按 SPIN');return;}
      if(!Number.isInteger(slot)||slot<0||slot>2){fail(res,400,'請選擇一個欄位');return;}
      if(room.locked[slot]!==null){fail(res,409,'這一欄已鎖定，換一欄吧');return;}
      if(p.pending){fail(res,409,'上一次抽選還沒完成');return;}
      if(Date.now()-p.lastSpin<500){fail(res,429,'請不要連續點太快');return;}
      p.lastSpin=Date.now();p.pending={slot,endsAt:Date.now()+SPIN_MS};room.lastEvent=p.name+' 正在抽 '+LABELS[slot];announce(room,'spinning');
      setTimeout(()=>{
        if(rooms.get(room.code)!==room || !room.players.has(p.id)||!p.pending || p.pending.slot!==slot)return;
        p.pending=null;
        if(room.phase!=='playing'||room.locked[slot]!==null)return;
        const val=chooseSpin(room,slot);p.values[slot]=val;
        room.lastEvent=p.name+' 抽到 '+catalog[room.mode][slot][val][1];checkMatches(room);
        announce(room,room.phase==='finished'?'finished':room.locked[slot]!==null?'locked':'spun');
      },SPIN_MS).unref?.();
      json(res,200,{ok:true});return;
    }
    if(pathname==='/api/leave'){
      prunePlayer(room,p.id);assignCookie(res,'');json(res,200,{ok:true});return;
    }
    if(pathname==='/api/lobby'){
      if(room.hostId!==p.id){fail(res,403,'只有房主可以重新開局');return;}
      if(room.phase!=='finished'){fail(res,409,'這一局還未完成');return;}
      room.phase='lobby';room.locked=[null,null,null];room.startAt=null;room.lastEvent='準備下一局';
      room.players.forEach(x=>{x.values=[null,null,null];x.pending=null;});announce(room,'lobby');json(res,200,{ok:true});return;
    }
    fail(res,404,'找不到功能');return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){fail(res,405,'不支援此操作');return;}
  const allowed = pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','catalog.json','multi.js','favicon.png','apple-touch-icon.png'].includes(allowed)){fail(res,404,'找不到頁面');return;}
  try{const data=fs.readFileSync(path.join(PUBLIC,allowed));const types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png'};
    res.writeHead(200,{'Content-Type':types[path.extname(allowed)]||'application/octet-stream','Cache-Control':allowed==='index.html'?'no-store':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){fail(res,404,'找不到檔案');}
}
const server=http.createServer((req,res)=>{Promise.resolve(handler(req,res)).catch(e=>{console.error('server error:',e.message);if(!res.headersSent)fail(res,500,'伺服器發生問題');else res.end();});});
setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){if(now-room.lastActive>2*60*60*1000){for(const p of room.players.values()){p.streams.forEach(r=>r.end());sessions.delete(p.sessionToken)}rooms.delete(code);}}for(const [k,v] of badAttempts){if(now-v.until>5*60*1000)badAttempts.delete(k)}},60*1000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Lucky Fit multiplayer on http://0.0.0.0:${PORT}`));
