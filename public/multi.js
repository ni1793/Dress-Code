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
  const stage=$('.stage');
  const selectCreate=$('#choose-create'), selectJoin=$('#choose-join');
  const entry=$('#multi-entry'), roomContainer=$('#multi-room');
  const showText=(element,text)=>{element.textContent=text;};
  const safeString=s=>String(s||'');
  const user=()=> room?.players.find(x=>x.id===room.viewerId)||null;
  const isHost=()=>room && room.hostId===room.viewerId;
  const locked=s=>room?.locked[s]!=null;
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
    stage.classList.toggle('is-multi',toMulti);
    $('#solo-mode').classList.toggle('active',!toMulti);
    $('#multi-mode').classList.toggle('active',toMulti);
    $('#solo-mode').setAttribute('aria-selected',String(!toMulti));
    $('#multi-mode').setAttribute('aria-selected',String(toMulti));
    if(toMulti && room)render();
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
      try{localStorage.setItem('lucky_fit_name',name)}catch(e){}
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
    if(locked(selectedCategory)){const un=next.locked.findIndex(x=>x==null);if(un!==-1)selectedCategory=un;}
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
    const progress=$('#multi-progress');progress.replaceChildren();
    room.locked.forEach((entry,slot)=>{
      const b=createEl('button','multi-pick'+(entry?' locked':selectedCategory===slot?' selected':''));
      const label=createEl('span','category',CATEGORIES[slot]);
      const desc=createEl('span','value',entry?entry.option[1]:'點此選擇');
      b.append(label,desc);
      if(entry)b.append(createEl('span','lock','✓ 全員一致 · 已鎖定'));
      else b.addEventListener('click',()=>{selectedCategory=slot;renderGame()});
      progress.append(b);
    });
    const me=user();let cat=selectedCategory;
    if(locked(cat)){const un=room.locked.findIndex(x=>!x);if(un!==-1){cat=selectedCategory=un;}}
    $('#multi-reel-label').textContent='你這次要抽 · '+CATEGORIES[cat];
    const option=room.locked[cat]?.option || me?.values[cat]?.option || null;
    const face=$('#multi-reel-face');
    face.style.borderColor=me?.color||'#ffffff';
    if(!me?.pending || me.pending.slot!==cat){
      face.classList.remove('rolling');
      if(animation){clearInterval(animation);animation=null;animateFor=null;}
      showOption(option);
    }else if(animateFor!==cat){
      animateFor=cat;
      if(animation)clearInterval(animation);
      face.classList.add('rolling');
      let n=0;
      animation=setInterval(()=>{
        const pool=catalog[room.mode][cat];
        const choice=pool[Math.floor(Math.random()*pool.length)];
        showOption(choice);n++;
      },110);
    }
    const spin=$('#multi-spin');
    spin.disabled=room.phase!=='playing'||!!me?.pending||locked(cat);
    spin.textContent=room.phase==='finished'?'完成！':me?.pending?'抽選中…':room.phase==='countdown'?'準備開始':'SPIN';
    $('#multi-key').textContent=room.phase==='countdown'?'房主已開始倒數，GO! 之後一起按 SPIN':room.phase==='finished'?'三個欄位都已全員一致！':`一次只抽「${CATEGORIES[cat]}」；想抽別欄請點上方分類`;
    const table=$('#multi-team');table.replaceChildren();
    const head=createEl('div','multi-team-head');['成員','主題','配色','小物'].forEach(x=>head.append(createEl('span','',x)));table.append(head);
    room.players.forEach(p=>{
      const row=createEl('div','multi-team-row');
      const who=createEl('div','who');const dot=createEl('span','dot');dot.style.background=p.color;
      who.append(dot,createEl('span','',p.name+(p.id===room.viewerId?' (你)':'')));row.append(who);
      p.values.forEach((val,s)=>{
        const pending=p.pending?.slot===s;
        const text=pending?'抽選中…':val?val.option[1]:room.locked[s]?room.locked[s].option[1]:'—';
        row.append(createEl('span','outcome'+(pending?' pending':'')+(locked(s)?' matched':''),text));
      });
      table.append(row);
    });
    const win=$('#multi-winning');
    win.hidden=room.phase!=='finished';
    if(room.phase==='finished'){
      win.replaceChildren(createEl('h3','','✦ 全員配對成功！'));
      room.locked.forEach((v,s)=>win.append(createEl('p','',CATEGORIES[s]+'：'+v.option[1])));
      const b=createEl('button','multi-small-btn','複製最後穿搭 ♡');b.style.marginTop='12px';
      b.addEventListener('click',()=>{
        const content='✦ LUCKY FIT CLUB · 全員穿搭配對成功\n'+room.locked.map((v,s)=>CATEGORIES[s]+'：'+v.option[1]).join('\n')+'\n\n我們一起穿這個！♡';
        copy(content).then(()=>toast('穿搭結果已複製！')).catch(()=>toast('複製失敗，請稍後重試'));
      });win.append(b);
      const token=room.code+room.startAt;if(lastBurst!==token){lastBurst=token;win.animate([{transform:'scale(.6)',opacity:0},{transform:'scale(1.15)',opacity:1,offset:.52},{transform:'scale(1)',opacity:1}],{duration:780,easing:'ease-out'});}
    }
  }
  function showOption(option){
    const icon=$('#multi-icon');icon.replaceChildren();
    if(option&&window.LuckyFitIcon)icon.innerHTML=window.LuckyFitIcon(option[0]);
    $('#multi-item-name').textContent=option?option[1]:'尚未抽到';
    $('#multi-item-en').textContent=option?option[2]:'READY TO SPIN';
  }
  $('#multi-spin').addEventListener('click',async()=>{
    if(!room||room.phase!=='playing'||locked(selectedCategory))return;
    $('#multi-spin').disabled=true;
    try{await api('spin',{slot:selectedCategory});}catch(e){showError(e.message);$('#multi-spin').disabled=false;}
  });
  $('#multi-share').addEventListener('click',()=>{
    if(!room)return;const url=new URL(location.href);url.searchParams.set('room',room.code);
    copy(url.toString()).then(()=>toast('房間邀請連結已複製，密碼記得另外傳給朋友')).catch(()=>toast('複製失敗'));
  });
  $('#multi-leave').addEventListener('click',async()=>{
    try{await api('leave')}catch(e){}
    if(stream){stream.close();stream=null;}
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
      number.style.animation='none';void number.offsetHeight;number.style.animation='';
    }
  }
  setInterval(updateSlam,80);
  async function restore(){
    try{
      const response=await fetch('/api/me',{credentials:'same-origin',cache:'no-store'});
      if(response.ok){const data=await response.json();acceptRoom(data.room);watchEvents();}
    }catch(e){/* server may be waking up */}
  }
  try{$('#multi-name').value=localStorage.getItem('lucky_fit_name')||'';}catch(e){}
  const param=new URL(location.href).searchParams.get('room');
  if(param){setEntry('join');$('#multi-code').value=param.toUpperCase().slice(0,6);setScreen(true);}
  if(window.LuckyFitCatalog){catalog=window.LuckyFitCatalog;}else{fetch(catalogUrl,{cache:'force-cache'}).then(r=>r.json()).then(data=>{catalog=data;if(room)render();}).catch(()=>{$('#multi-error').textContent='題目載入失敗，請重新整理頁面';});}
  restore();
})();
