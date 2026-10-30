(()=>{
  'use strict';
  const $ = s => document.querySelector(s);
  const catalogUrl='/catalog.json';
  const CATEGORIES=['主題','配色','小物'];
  let catalog=null;
  let room=null;
  let selectedCategory=0;
  let createMode=0;
  let entryMode='create';
  let stream=null;
  let serverOffset=0;
  let animation=null;
  let animateFor=null;
  let lastBurst='';
  let temporaryMessage='';
  let countdownToken='';

  // Multiplayer reuses the solo machine's sound assets. Playback starts in
  // the actual SPIN click handler, required for mobile browser audio policies.
  const multiRollAudio=document.getElementById('slot-roll-audio');
  const multiStopAudio=document.getElementById('slot-stop-audio');
  const speakerToggle=document.getElementById('sound');
  let multiSpinAudioTimer=null;
  const multiSoundEnabled=()=>speakerToggle?.getAttribute('aria-pressed')==='true';
  function stopMultiSpinAudio(finished=false){
    if(multiSpinAudioTimer!==null){clearTimeout(multiSpinAudioTimer);multiSpinAudioTimer=null;}
    if(multiRollAudio){
      try{multiRollAudio.pause();multiRollAudio.currentTime=0;}catch(e){}
    }
    if(finished&&multiSoundEnabled()&&multiStopAudio){
      try{
        multiStopAudio.pause();multiStopAudio.currentTime=0;
        const play=multiStopAudio.play();if(play?.catch)play.catch(()=>{});
      }catch(e){}
    }
  }
  function startMultiSpinAudio(duration){
    stopMultiSpinAudio();
    if(!multiSoundEnabled()||!multiRollAudio)return;
    try{
      multiRollAudio.currentTime=0;
      const play=multiRollAudio.play();if(play?.catch)play.catch(()=>{});
    }catch(e){}
    multiSpinAudioTimer=setTimeout(()=>stopMultiSpinAudio(true),Math.max(250,Number(duration)||650));
  }
  speakerToggle?.addEventListener('click',()=>{
    if(!multiSoundEnabled())stopMultiSpinAudio();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopMultiSpinAudio();
  });
  const stage=$('.stage');
  const selectCreate=$('#choose-create'), selectJoin=$('#choose-join');
  const entry=$('#multi-entry'), roomContainer=$('#multi-room');
  const showText=(element,text)=>{element.textContent=text;};
  const safeString=s=>String(s||'');
  const user=()=> room?.players.find(x=>x.id===room.viewerId)||null;
  const isHost=()=>room && room.hostId===room.viewerId;
  const locked=s=>room?.locked[s]!=null;
  const current=()=>Math.min(2,room?.stage??0);
  const ready=()=>room && (room.phase==='playing'||room.phase==='finished');
  const toast=message=>{const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2300);};
  function copy(text){
    if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();return ok?Promise.resolve():Promise.reject(Error('copy failed'));
  }
  function showError(message){const el=room?$('#multi-room-error'):$('#multi-error');el.textContent=message;}
  function clearError(){$('#multi-error').textContent='';$('#multi-room-error').textContent='';}
  async function api(path,data){
    const resp=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(data||{})});
    let body;try{body=await resp.json()}catch(e){throw Error('伺服器回應格式不正確')}
    if(!resp.ok)throw Error(body.error||'伺服器暫時無法連線');
    return body;
  }
  function setScreen(toMulti){
    if(toMulti && window.LuckyClubSoloSpinning?.()){
      toast('單機轉盤正在轉動，停下後再切換模式 ♡');return;
    }
    const wasMulti=stage.classList.contains('is-multi');
    if(!toMulti)stopMultiSpinAudio();
    stage.classList.toggle('is-multi',toMulti);
    $('#solo-mode').classList.toggle('active',!toMulti);
    $('#multi-mode').classList.toggle('active',toMulti);
    $('#solo-mode').setAttribute('aria-selected',String(!toMulti));
    $('#multi-mode').setAttribute('aria-selected',String(toMulti));
    if(toMulti && room)render();
    if(!toMulti && wasMulti)requestAnimationFrame(()=>window.LuckyClubRestoreSoloReels?.());
  }
  $('#solo-mode').addEventListener('click',()=>setScreen(false));
  $('#multi-mode').addEventListener('click',()=>setScreen(true));
  function setEntry(mode){
    entryMode=mode;
    const join=mode==='join';
    selectCreate.classList.toggle('on',!join);
    selectJoin.classList.toggle('on',join);
    $('#room-code-block').hidden=!join;
    $('#create-mode').hidden=join;
    $('#multi-form-submit').textContent=join?'加入房間':'建立密碼房間';
    $('#multi-error').textContent='';
  }
  selectCreate.addEventListener('click',()=>setEntry('create'));
  selectJoin.addEventListener('click',()=>setEntry('join'));
  document.querySelectorAll('[data-create-mode]').forEach(button=>button.addEventListener('click',()=>{
    createMode=Number(button.dataset.createMode);
    document.querySelectorAll('[data-create-mode]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.createMode)===createMode));
  }));
  async function submitRoom(event){
    event.preventDefault();
    clearError();
    const name=$('#multi-name').value.trim();
    const password=$('#multi-password').value;
    const code=$('#multi-code').value.trim().toUpperCase();
    if(!name||password.length<4){showError('請輸入暱稱與至少 4 碼密碼');return;}
    if(entryMode==='join'&&code.length!==6){showError('請輸入 6 碼房號');return;}
    const button=$('#multi-form-submit');button.disabled=true;button.textContent='連線中…';
    try{
      const input=entryMode==='create'?{name,password,mode:createMode}:{name,password,code};
      const response=await api(entryMode,input);
      try{localStorage.setItem('lucky_club_name',name)}catch(e){}
      $('#multi-password').value='';
      acceptRoom(response.room);
      watchEvents();
      toast(entryMode==='create'?'房間已建立！':'已加入房間！');
    }catch(e){showError(e.message);}
    finally{button.disabled=false;button.textContent=entryMode==='create'?'建立密碼房間':'加入房間';}
  }
  $('#multi-form').addEventListener('submit',submitRoom);
  function acceptRoom(next){
    if(!next)return;
    room=next;
    serverOffset=(next.serverNow||Date.now())-Date.now();
    selectedCategory=Math.min(2,next.stage??0);
    entry.hidden=true;roomContainer.hidden=false;
    render();
  }
  function watchEvents(){
    if(stream){stream.close();stream=null;}
    stream=new EventSource('/api/events');
    stream.addEventListener('update',e=>{
      try{const data=JSON.parse(e.data);acceptRoom(data.room);}catch(ex){console.warn('Invalid update',ex)}
    });
    stream.onerror=()=>{if(room)$('#multi-room-error').textContent='連線暫時中斷，正在重新連線…';};
    stream.onopen=()=>{if(room)$('#multi-room-error').textContent='';};
  }
  function createEl(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
  function render(){
    if(!room)return;
    $('#multi-room-code').textContent=room.code;
    $('#multi-room-meta').textContent=(room.mode===0?'日常好穿':'怪趣挑戰')+' · '+room.players.length+'/'+room.maxPeople+' 人'+(isHost()?' · 你是房主':' · 房主：'+(room.players.find(p=>p.id===room.hostId)?.name||''));
    const phaseName={lobby:'等待開始',countdown:'倒數準備',playing:'正在配對',finished:'全員配對成功'};
    const phase=$('#multi-phase');phase.replaceChildren(createEl('span','',phaseName[room.phase]||''),createEl('em','',room.lastEvent||''));
    const list=$('#multi-players');list.replaceChildren();
    room.players.forEach(p=>{
      const chip=createEl('span','multi-person'+(p.online?'':' offline'));
      const dot=createEl('span','dot');dot.style.background=p.color;
      chip.append(dot,createEl('span','',p.name+(p.id===room.hostId?' ★':'')+(p.id===room.viewerId?' (你)':'')));
      list.append(chip);
    });
    const hostActions=$('#multi-host-actions');hostActions.replaceChildren();
    if(room.phase==='lobby'){
      if(isHost()){
        const start=createEl('button','multi-submit multi-start',room.players.length>=2?'房主開始｜3 · 2 · 1 · GO!':'等待至少一位朋友加入');
        start.disabled=room.players.length<2;
        start.addEventListener('click',async()=>{start.disabled=true;try{const r=await api('start');acceptRoom(r.room);}catch(e){showError(e.message);start.disabled=false;}});
        hostActions.append(start);
      }else hostActions.append(createEl('p','multi-notice','等房主按開始，就會一起倒數 3、2、1、GO!'));
    }
    if(room.phase==='finished'&&isHost()){
      const again=createEl('button','multi-submit multi-start','房主準備下一局');
      again.addEventListener('click',async()=>{try{await api('lobby')}catch(e){showError(e.message)}});
      hostActions.append(again);
    }
    $('#multi-play-area').hidden=room.phase==='lobby';
    if(room.phase!=='lobby')renderGame();
    updateSlam();
  }
  function itemIcon(option){const holder=createEl('span','icon');if(option && window.LuckyFitIcon){holder.innerHTML=window.LuckyFitIcon(option[0]);}return holder;}
  function renderGame(){
    if(!room||!catalog)return;
    const stage=room.stage,cat=Math.min(2,stage),me=user();selectedCategory=cat;
    const progress=$('#multi-progress');progress.replaceChildren();
    room.locked.forEach((entry,slot)=>{
      const active=slot===stage && room.phase!=='finished';
      const b=createEl('div','multi-pick'+(entry?' locked':active?' current':' upcoming'));
      b.append(createEl('span','category',CATEGORIES[slot]));
      b.append(createEl('span','value',entry?entry.option[1]:active?'第 '+room.round+' 輪':'等待前一項'));
      if(entry)b.append(createEl('span','lock','✓ 投票確定'));
      else if(active)b.append(createEl('span','lock',room.roundStatus==='reveal'?'揭曉結果':'等待全員抽完'));
      progress.append(b);
    });
    const spinsDone=room.players.filter(p=>p.done).length;
    const pending=room.players.filter(p=>p.pending).length;
    const busy=room.roundStatus==='reveal';
    const done=!!me?.done||!!me?.pending;
    const isFinish=room.phase==='finished';
    $('#multi-reel-label').textContent=isFinish?'你自己抽到的小物':`目前抽選 · ${CATEGORIES[cat]} ／第 ${room.round} 輪`;
    const face=$('#multi-reel-face');face.style.borderColor=me?.color||'#ffffff';
    const option=me?.values[cat]?.option || (isFinish ? room.locked[2]?.option : null);
    if(me?.pending&&me.pending.slot===cat &&room.phase==='playing'){
      if(animateFor!==cat){animateFor=cat;if(animation)clearInterval(animation);
        face.classList.add('rolling');animation=setInterval(()=>{
          const pool=catalog[room.mode][cat];showOption(pool[Math.floor(Math.random()*pool.length)]);
        },65);
      }
    }else{
      face.classList.remove('rolling');if(animation)clearInterval(animation);animation=null;animateFor=null;
      showOption(option);
    }
    const spin=$('#multi-spin');spin.disabled=room.phase!=='playing'||busy||done||stage>=3;
    spin.textContent=isFinish?'完成！':room.phase==='countdown'?'準備開始':busy?'正在揭曉…':me?.pending?'抽選中…':done?'等其他人…':'SPIN';
    const key=$('#multi-key');
    if(room.phase==='countdown')key.textContent='倒數結束後大家一起按 SPIN';
    else if(isFinish)key.textContent='三項已由全員投票決定。';
    else if(busy){
      const summary=room.roundSummary;
      key.textContent=summary?.tied?`第 ${room.round} 輪最高票平手！全員重抽 ${CATEGORIES[cat]}。`:`最多票：${summary?.winner?.option?.[1]||''}，接下來進入下一項。`;
    }else key.textContent=`${CATEGORIES[cat]}：${spinsDone}／${room.players.length} 人已完成${pending?'（有人正在轉盤）':''}。${done?'請等待大家抽完。':'這一輪你只能抽一次。'}`;
    // Preserve each player's actual roll. Identical values receive identical
    // match colors, while independently rolled values always stay visible.
    const matchColors=[
      {bg:'#ffe2f1',border:'#f04aa0',ink:'#842450'},
      {bg:'#d5f7f3',border:'#39bcb7',ink:'#185f64'},
      {bg:'#eff9c7',border:'#a3ca38',ink:'#475a14'},
      {bg:'#e7e0fd',border:'#ac91e9',ink:'#5a4191'},
      {bg:'#fff0d1',border:'#e5b64e',ink:'#74500c'},
      {bg:'#ffded4',border:'#ef8e67',ink:'#7a3925'}
    ];
    const matchedGroups=[0,1,2].map(slot=>{
      const count=new Map();
      room.players.forEach(player=>{
        const id=player.values[slot]?.idx;
        if(id!=null)count.set(id,(count.get(id)||0)+1);
      });
      const ids=[...count].filter(([,n])=>n>=2).map(([id])=>id).sort((a,b)=>a-b);
      return new Map(ids.map((id,i)=>[id,matchColors[i%matchColors.length]]));
    });
    const table=$('#multi-team');table.replaceChildren();
    const head=createEl('div','multi-team-head');['成員','主題','配色','小物'].forEach(x=>head.append(createEl('span','',x)));table.append(head);
    room.players.forEach(p=>{
      const row=createEl('div','multi-team-row');const who=createEl('div','who');const dot=createEl('span','dot');dot.style.background=p.color;
      who.append(dot,createEl('span','',p.name+(p.id===room.viewerId?' (你)':'')));row.append(who);
      p.values.forEach((val,s)=>{
        const spinning=p.pending?.slot===s, hidden=room.roundStatus==='collecting' && s===stage && p.id!==room.viewerId;
        const text=spinning?'轉盤中…':hidden?(p.done?'已抽完 ✓':'等待抽選'):val?val.option[1]:'—';
        const outcome=createEl('span','outcome'+(spinning?' pending':''),text);
        const group=!hidden&&!spinning&&val?matchedGroups[s].get(val.idx):null;
        if(group){
          outcome.classList.add('same-pick');
          outcome.style.setProperty('--match-bg',group.bg);
          outcome.style.setProperty('--match-border',group.border);
          outcome.style.setProperty('--match-ink',group.ink);
          outcome.title=CATEGORIES[s]+'：'+text+'（和其他玩家抽到一樣）';
        }
        if(room.locked[s] && val && !hidden){
          outcome.title=CATEGORIES[s]+'：你實際抽到 '+text+(room.locked[s].idx===val.idx?'（這項票選勝出）':'（這項的共同穿搭另由票選決定）');
        }
        row.append(outcome);
      });table.append(row);
    });
    const note=createEl('div','multi-match-note','同色底表示抽到同款；每個人的結果都會保留，最終穿搭另由票選決定。');
    table.append(note);
    // Same on-page result ticket, actions, text and image exporter as the solo game.
    const ticket=$('#multi-ticket');ticket.hidden=!isFinish;
    $('#multi-copy').disabled=!isFinish;$('#multi-save').disabled=!isFinish;
    if(isFinish){
      const vals=room.locked.map(x=>x.option);
      $('#multi-serial').textContent='ROOM '+room.code;
      $('#multi-result').textContent=vals[0][1]+' × '+vals[1][1];
      $('#multi-detail').textContent='指定小物：'+vals[2][1]+'。全員一人一票，今天一起穿這個！♡';
      const token=room.code+'|'+room.startAt;
      if(lastBurst!==token){lastBurst=token;ticket.animate([{transform:'scale(.92)',opacity:.4},{transform:'scale(1.02)',opacity:1,offset:.56},{transform:'scale(1)',opacity:1}],{duration:950,easing:'ease-out'});}
    }
  }
  function showOption(option){
    const icon=$('#multi-icon');icon.replaceChildren();
    if(option&&window.LuckyFitIcon)icon.innerHTML=window.LuckyFitIcon(option[0]);
    $('#multi-item-name').textContent=option?option[1]:'尚未抽到';
    $('#multi-item-en').textContent=option?option[2]:'READY TO SPIN';
  }
  $('#multi-spin').addEventListener('click',async()=>{
    if(!room||room.phase!=='playing'||room.roundStatus!=='collecting'||user()?.done||user()?.pending)return;
    $('#multi-spin').disabled=true;
    startMultiSpinAudio(room.spinMs);
    try{await api('spin',{slot:selectedCategory});}
    catch(e){stopMultiSpinAudio();showError(e.message);$('#multi-spin').disabled=false;}
  });
  function multiplayerResult(){return room?.phase==='finished'&&room.locked.every(Boolean)?room.locked.map(v=>v.option):null;}
  $('#multi-copy').addEventListener('click',async()=>{
    const v=multiplayerResult();if(!v)return;
    const t='🎲 好運 Dress Code 拉霸 🎲\n主題：'+v[0][1]+'\n配色：'+v[1][1]+'\n指定小物：'+v[2][1]+'\n\n我們一起穿這個！♡';
    try{await copy(t);toast('已複製！貼給朋友就可以 ♡')}catch(e){toast('複製失敗，請再試一次')}
  });
  $('#multi-save').addEventListener('click',async()=>{
    const v=multiplayerResult();if(!v || !window.LuckyClubExport)return;
    const btn=$('#multi-save');const preview=window.LuckyClubExport.openPreview();btn.disabled=true;
    try{const msg=await window.LuckyClubExport.save({theme:v[0],color:v[1],accessory:v[2],iconKeys:v.map(o=>o[0]),serial:'ROOM '+room.code},preview);toast(msg)}
    catch(e){if(preview&&!preview.closed)preview.close();console.error(e);toast('穿搭卡產生失敗，請再試一次')}
    finally{btn.disabled=false;}
  });
  $('#multi-share').addEventListener('click',()=>{
    if(!room)return;const url=new URL(location.href);url.searchParams.set('room',room.code);
    copy(url.toString()).then(()=>toast('房間邀請連結已複製，密碼記得另外傳給朋友')).catch(()=>toast('複製失敗'));
  });
  $('#multi-leave').addEventListener('click',async()=>{
    try{await api('leave')}catch(e){}
    if(stream){stream.close();stream=null;}
    stopMultiSpinAudio();
    room=null;countdownToken='';
    if(animation)clearInterval(animation);animation=null;animateFor=null;
    entry.hidden=false;roomContainer.hidden=true;
    $('#multi-password').value='';$('#multi-error').textContent='';
    toast('已離開房間');
  });
  function updateSlam(){
    const overlay=$('#slam-overlay');
    if(!room||room.phase!=='countdown'){overlay.classList.remove('on');return;}
    const start=(room.startAt||0)-3000;
    const elapsed=Date.now()+serverOffset-start;
    if(elapsed<0 || elapsed>=3000){overlay.classList.remove('on');return;}
    const step=Math.min(3,Math.max(0,Math.floor(elapsed/750)));
    const tokens=['3','2','1','GO!'];
    const token=room.code+'|'+room.startAt+'|'+step;
    overlay.classList.add('on');
    if(countdownToken!==token){
      countdownToken=token;
      const number=$('#slam-number');number.classList.remove('go');number.textContent=tokens[step];
      if(step===3)number.classList.add('go');
      number.style.animation='none';
      number.style.transform='scale(1)';
      const naturalWidth=number.getBoundingClientRect().width;
      const available=Math.max(150,window.innerWidth-32);
      number.style.setProperty('--slam-scale',String(Math.max(1,Math.min(3,available/Math.max(1,naturalWidth))).toFixed(3)));
      void number.offsetHeight;
      number.style.transform='';number.style.animation='';
    }
  }
  setInterval(updateSlam,80);
  async function restore(){
    try{
      const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
      if(response.ok){const data=await response.json();acceptRoom(data.room);watchEvents();}
    }catch(e){/* server may be waking up */}
  }
  try{$('#multi-name').value=localStorage.getItem('lucky_club_name')||'';}catch(e){}
  const param=new URL(location.href).searchParams.get('room');
  if(param){setEntry('join');$('#multi-code').value=param.toUpperCase().slice(0,6);setScreen(true);}
  if(window.LuckyFitCatalog){catalog=window.LuckyFitCatalog;}else{fetch(catalogUrl,{cache:'force-cache'}).then(r=>r.json()).then(data=>{catalog=data;if(room)render();}).catch(()=>{$('#multi-error').textContent='題目載入失敗，請重新整理頁面';});}
  restore();
})();
