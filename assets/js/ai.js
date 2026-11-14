// ---------- AI: a chat page that talks to this site's /api/ai (see ai.js on the server) ----------
// A list of your chats sits on the left; each chat is kept in this browser only. You pick an AI from the list next to the message
// box. Two kinds are offered:
//   - AIs that run on a server (they appear when the site owner has added their key), answered through /api/ai/chat
//   - AIs that run inside this browser on the device's own graphics chip (WebLLM): free, unlimited and private, but they download
//     a model file the first time, so the page asks before doing that.
// The answer arrives word by word, and the Stop button cuts it off.
(function(){
var ap=document.getElementById('ai');if(!ap)return;
var box=document.getElementById('aimsgs'),form=document.getElementById('aiform'),inp=document.getElementById('aiq'),
    sendBtn=document.getElementById('aisend'),note=document.getElementById('ainote'),pick=document.getElementById('aimodel'),
    list=document.getElementById('aichats'),newBtn=document.getElementById('ainew'),newBtn2=document.getElementById('ainewm'),
    tog=document.getElementById('aitog'),back=document.getElementById('aiback');
var CKEY='orata-ai-chats',OLDKEY='orata-ai',MKEY='orata-ai-model',LKEY='orata-ai-local',MAXQ=2000,MAXCHATS=50,MAXMSGS=40,
    LIB='/vendor/webllm/web-llm-0.2.88.js',WORKER='/vendor/webllm/worker.js';
var SYSTEM='You are a friendly, concise assistant built into a website with projects, music and TV. Help with homework explanations, writing, coding, ideas and everyday questions. Keep answers short and clear unless asked for more. If a request is dangerous, hateful or sexual, say you can’t help with that and offer something else. Never ask for personal information. If asked, say you are an AI and can make mistakes.';
// the AI that runs on this device and is the main one: shown as "Lunaris AI" (the page adds the right build of the model for the
// device's graphics chip), with its download size
var LOCAL=[
  {id:'local:qwen',name:'Lunaris AI',repo:'Qwen2.5-1.5B-Instruct',size:'about 0.9 GB'}];
// chats: [{id, t: title, u: last used, m: [{role, content}]}], newest first. cur is the open chat (null = a new one, not saved until you send)
var S={chats:[],cur:null,busy:false,ctl:null,tok:0,models:[],model:'',ready:null,started:false,stick:true,picker:false};
var L={mod:null,gpu:null,f16:false,eng:null,worker:null,id:'',loading:null,loadingId:'',onProgress:null};
function ico(cls){var i=document.createElement('i');i.className=cls;i.setAttribute('aria-hidden','true');return i}
function txt(tag,cls,s){var e=el(tag,cls);e.textContent=s;return e}
function isLocal(id){return/^local:/.test(id)}
function localDef(id){return LOCAL.filter(function(m){return m.id===id})[0]}
function confirmed(id){try{return!!(JSON.parse(localStorage.getItem(LKEY)||'{}')[id])}catch(e){return false}}
function markConfirmed(id){try{var o=JSON.parse(localStorage.getItem(LKEY)||'{}');o[id]=1;localStorage.setItem(LKEY,JSON.stringify(o))}catch(e){}}

// ----- the saved chats -----
function validMsg(m){return m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string'&&m.content}
function rid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function newChat(m){return{id:rid(),t:'New chat',u:Date.now(),m:m||[]}}
function titleOf(t){t=String(t).replace(/\s+/g,' ').trim();return t.length>40?t.slice(0,38).replace(/\s+$/,'')+'…':(t||'New chat')}
function loadChats(){
  var openId='';
  try{
    var o=JSON.parse(localStorage.getItem(CKEY)||'null');
    if(o&&Array.isArray(o.chats)){
      o.chats.forEach(function(c){
        if(!c||typeof c.id!=='string'||!Array.isArray(c.m))return;
        var m=c.m.filter(validMsg).slice(-MAXMSGS);if(!m.length)return;
        S.chats.push({id:c.id.slice(0,24),t:String(c.t||'New chat').slice(0,60),u:+c.u||0,m:m})});
      S.chats.sort(function(a,b){return b.u-a.u});S.chats=S.chats.slice(0,MAXCHATS);openId=String(o.cur||'')}
  }catch(e){}
  S.cur=S.chats.filter(function(c){return c.id===openId})[0]||null;
  // the single conversation kept by the first version of this page becomes the first chat in the list
  try{
    var old=JSON.parse(localStorage.getItem(OLDKEY)||'null');
    if(Array.isArray(old)&&!S.chats.length){var om=old.filter(validMsg).slice(-MAXMSGS);if(om.length){var c1=newChat(om);c1.t=titleOf(om[0].content);S.chats.push(c1);S.cur=c1;save()}}
    localStorage.removeItem(OLDKEY)}catch(e){}}
// if the browser's storage is full, the oldest chat that isn't open is forgotten until it fits
function save(){
  var dropped=false;
  for(var tries=0;tries<30;tries++){
    try{localStorage.setItem(CKEY,JSON.stringify({v:1,cur:S.cur?S.cur.id:'',chats:S.chats}));break}
    catch(e){var i=S.chats.length-1;while(i>=0&&S.chats[i]===S.cur)i--;if(i<0)break;S.chats.splice(i,1);dropped=true}}
  if(dropped)renderChats()} // the list must show only what is really saved
function msgs(){return S.cur?S.cur.m:[]}
function touch(c){c.u=Date.now();S.chats.sort(function(a,b){return b.u-a.u});renderChats()}
function renderChats(){
  list.textContent='';
  if(!S.chats.length){list.appendChild(txt('p','aic-none','No chats yet'));return}
  S.chats.forEach(function(c){
    var row=el('div','aic'+(c===S.cur?' on':'')),b=txt('button','aic-t',c.t),x=el('button','aic-x');
    row.setAttribute('role','listitem');row._c=c;b.type=x.type='button';b.title=c.t;
    x.title='Delete chat';x.setAttribute('aria-label','Delete chat: '+c.t);x.appendChild(ico('fa-regular fa-trash-can'));
    b.addEventListener('click',function(){openChat(c)});
    x.addEventListener('click',function(e){e.stopPropagation();removeChat(c)});
    row.appendChild(b);row.appendChild(x);list.appendChild(row)})}
// leaving a chat while an answer is arriving stops that answer (what has arrived is kept in its chat)
function abortRun(){if(S.ctl)S.ctl.abort();S.busy=false;S.ctl=null;S.tok++}
function focusInput(){if(S.ready===true&&matchMedia('(hover:hover)').matches)inp.focus({preventScroll:true})}
function openChat(c){
  closeSide();
  if(S.cur===c)return;
  abortRun();S.cur=c;save();drawAll();renderChats();sync();focusInput()}
function startNew(){abortRun();S.cur=null;save();closeSide();drawAll();renderChats();sync();focusInput()}
function removeChat(c){
  var open=S.cur===c;if(open){abortRun();S.cur=null}
  S.chats=S.chats.filter(function(x){return x!==c});save();renderChats();
  if(open){drawAll();sync()}}
// on narrow screens the list of chats is a drawer
function setSide(on){ap.classList.toggle('side',on);tog.setAttribute('aria-expanded',String(on))}
function closeSide(){setSide(false)}

// ----- copying -----
function copy(text,btn){
  function ok(){if(!btn)return;var o=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=o},1400)}
  function legacy(){var a=document.createElement('textarea');a.value=text;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();try{document.execCommand('copy');ok()}catch(e){}a.remove()}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(ok,legacy);else legacy()}

// ----- a small, safe formatter for the answer (built from DOM nodes, never from HTML strings) -----
function inline(parent,text){
  var re=/(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(https?:\/\/[^\s<>"'`]+)/g,last=0,m,n;
  while((m=re.exec(text))){
    if(m.index>last)parent.appendChild(document.createTextNode(text.slice(last,m.index)));
    var tok=m[0],tail='';
    if(m[1]){n=el('code');n.textContent=tok.slice(1,-1)}
    else if(m[2]){n=el('strong');n.textContent=tok.slice(2,-2)}
    else if(m[3]){n=el('em');n.textContent=tok.slice(1,-1)}
    else{
      var t=/[.,;:!?)\]]+$/.exec(tok);if(t){tail=t[0];tok=tok.slice(0,-tail.length)}
      n=el('a');n.textContent=tok;n.href=tok;n.rel='noopener noreferrer';n.target='_blank';
      n.addEventListener('click',function(e){if(e.button||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();if(typeof openInBrowser==='function')openInBrowser(this.href)})}
    parent.appendChild(n);if(tail)parent.appendChild(document.createTextNode(tail));
    last=m.index+m[0].length}
  if(last<text.length)parent.appendChild(document.createTextNode(text.slice(last)))}
function blocks(parent,text){
  text.split(/\n{2,}/).forEach(function(b){
    b=b.replace(/\s+$/,'');if(!b.trim())return;
    var lines=b.split('\n'),h=/^#{1,4}\s+(.+)$/.exec(lines[0]),li;
    if(lines.every(function(l){return/^\s*[-*•]\s+/.test(l)})){var ul=el('ul');lines.forEach(function(l){li=el('li');inline(li,l.replace(/^\s*[-*•]\s+/,''));ul.appendChild(li)});parent.appendChild(ul);return}
    if(lines.every(function(l){return/^\s*\d+[.)]\s+/.test(l)})){var ol=el('ol');ol.start=parseInt(lines[0],10)||1;lines.forEach(function(l){li=el('li');inline(li,l.replace(/^\s*\d+[.)]\s+/,''));ol.appendChild(li)});parent.appendChild(ol);return}
    if(h&&lines.length===1){var hd=el('h4');inline(hd,h[1]);parent.appendChild(hd);return}
    var p=el('p');lines.forEach(function(l,k){if(k)p.appendChild(el('br'));inline(p,l)});parent.appendChild(p)})}
function codeBlock(lang,code){
  var w=el('div','aicode'),hd=el('div','aicode-h'),cp=txt('button','aicopy','Copy'),pre=el('pre'),c=el('code');
  cp.type='button';cp.addEventListener('click',function(){copy(code,cp)});
  hd.appendChild(txt('span','',lang||'code'));hd.appendChild(cp);c.textContent=code;pre.appendChild(c);w.appendChild(hd);w.appendChild(pre);return w}
// text with ``` fences: an unfinished fence (the answer is still arriving) is shown as code too
function render(target,text){
  target.textContent='';
  var re=/```([\w+-]*)[^\S\n]*\n?([\s\S]*?)(?:```|$)/g,last=0,m;
  while((m=re.exec(text))){
    if(m.index>last)blocks(target,text.slice(last,m.index));
    target.appendChild(codeBlock(m[1],m[2].replace(/\n$/,'')));
    last=m.index+m[0].length}
  if(last<text.length)blocks(target,text.slice(last))}

// ----- the open chat on screen -----
function msgEl(role,text){
  var d=el('div','aimsg '+(role==='user'?'ai-u':'ai-b')),b=el('div','aib');
  d.appendChild(b);d._text=text||'';
  if(text){if(role==='user')b.textContent=text;else render(b,text)}
  return d}
function scrollDown(force){if(force)S.stick=true;if(S.stick)box.scrollTop=box.scrollHeight}
box.addEventListener('scroll',function(){S.stick=box.scrollHeight-box.scrollTop-box.clientHeight<90});
function welcome(){
  var w=el('div','aiwelcome'),ic=el('span','aiico');
  ic.appendChild(ico('fa-solid fa-robot'));
  w.appendChild(ic);w.appendChild(txt('h3','','Send a message.'));return w}
function drawAll(){
  box.textContent='';
  var m=msgs();
  if(!m.length){box.appendChild(welcome());return}
  m.forEach(function(x){box.appendChild(msgEl(x.role,x.content))});
  scrollDown(true)}
function dots(){var d=el('span','aidots');for(var i=0;i<3;i++)d.appendChild(el('i'));d.setAttribute('aria-label','The AI is typing');return d}

// ----- the AIs that run in this browser (WebLLM, loaded only when one is used) -----
function gpuOk(){
  if(L.gpu!==null)return Promise.resolve(L.gpu);
  if(!navigator.gpu){L.gpu=false;return Promise.resolve(false)}
  return navigator.gpu.requestAdapter().then(function(a){L.gpu=!!a;L.f16=!!(a&&a.features&&a.features.has('shader-f16'));return L.gpu},function(){L.gpu=false;return false})}
function progress(b,p){
  var pr=b.querySelector('.aiprog');
  if(!pr){b.textContent='';pr=el('div','aiprog');pr.appendChild(txt('b','',''));var bar=el('div','aibar');bar.appendChild(el('i'));pr.appendChild(bar);pr.appendChild(txt('small','',''));b.appendChild(pr)}
  var pct=Math.max(0,Math.min(100,Math.round((p&&p.progress||0)*100)));
  pr.querySelector('b').textContent='Getting the AI ready… '+pct+'%';
  pr.querySelector('i').style.width=pct+'%';
  pr.querySelector('small').textContent=/fetch/i.test(p&&p.text||'')?'Downloading to this device. This only happens the first time.':'Starting up on this device.'}
async function ensureLocal(def,onProgress){
  var lib=await(L.mod||(L.mod=import(LIB)));
  var mid=def.repo+'-'+(L.f16?'q4f16_1':'q4f32_1')+'-MLC';
  if(!lib.prebuiltAppConfig.model_list.some(function(m){return m.model_id===mid}))throw new Error('That AI isn’t available on this device.');
  L.onProgress=onProgress;
  if(L.eng&&L.id===mid)return L.eng;
  if(L.loading&&L.loadingId===mid)return L.loading;
  L.loadingId=mid;
  L.loading=(async function(){
    if(!L.eng){
      L.worker=new Worker(WORKER,{type:'module'});
      L.eng=await lib.CreateWebWorkerMLCEngine(L.worker,mid,{initProgressCallback:function(p){if(L.onProgress)L.onProgress(p)}})}
    else await L.eng.reload(mid);
    L.id=mid;return L.eng})();
  try{return await L.loading}finally{L.loading=null;L.loadingId=''}}
// small models need tidy turns: start with the user, alternate, end with the user
function tidy(arr){
  var out=[];arr.forEach(function(m){var p=out[out.length-1];if(p&&p.role===m.role)p.content+='\n\n'+m.content;else out.push({role:m.role,content:m.content})});
  while(out.length&&out[0].role!=='user')out.shift();return out}
async function localJob(id,b,ctl,onText,history){
  var def=localDef(id);if(!def)throw new Error('That AI isn’t available.');
  var eng=await ensureLocal(def,function(p){if(!ctl.signal.aborted)progress(b,p)});
  if(ctl.signal.aborted)return;
  b.textContent='';b.appendChild(dots());
  ctl.signal.addEventListener('abort',function(){try{eng.interruptGenerate()}catch(e){}});
  var send=[{role:'system',content:SYSTEM}].concat(tidy(history.slice(-8)));
  var it=await eng.chat.completions.create({messages:send,stream:true,max_tokens:600,temperature:0.7});
  for await(var ch of it){
    var t=ch.choices&&ch.choices[0]&&ch.choices[0].delta&&ch.choices[0].delta.content;
    if(t)onText(t);
    if(ctl.signal.aborted)break}}

// ----- the AIs that run on the server -----
function hostedJob(id,ctl,onText,history){
  return fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:id,messages:history.slice(-20)}),signal:ctl.signal})
    .then(function(r){
      if(!r.ok)return r.json().catch(function(){return{}}).then(function(j){throw new Error(j.error||'The AI had a problem. Try again in a moment.')});
      var rd=r.body.getReader(),dec=new TextDecoder(),buf='',over=false;
      function line(l){
        l=l.trim();if(l.indexOf('data:')!==0)return;
        var p=l.slice(5).trim();if(p==='[DONE]'){over=true;return}
        var o;try{o=JSON.parse(p)}catch(e){return}
        if(o.e)throw new Error(o.e);
        if(o.t)onText(o.t)}
      function pump(){return rd.read().then(function(x){
        if(x.done){if(buf)line(buf);return}
        buf+=dec.decode(x.value,{stream:true});var ls=buf.split('\n');buf=ls.pop();ls.forEach(line);
        return over?undefined:pump()})}
      return pump()})}

// ----- sending -----
function sync(){
  var empty=!inp.value.trim();
  sendBtn.classList.toggle('stop',S.busy);
  sendBtn.firstChild.className=S.busy?'fa-solid fa-stop':'fa-solid fa-arrow-up';
  sendBtn.setAttribute('aria-label',S.busy?'Stop':'Send');
  sendBtn.disabled=S.ready!==true||(!S.busy&&empty)}
function grow(){inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,150)+'px'}
function ask(text){
  text=String(text||'').trim().slice(0,MAXQ);
  if(!text||S.busy||S.ready!==true)return;
  // a chat is created (and appears in the list) when its first message is sent, and takes its title from it
  if(!S.cur){S.cur=newChat();S.chats.unshift(S.cur);if(S.chats.length>MAXCHATS)S.chats.length=MAXCHATS}
  if(!S.cur.m.length)S.cur.t=titleOf(text);
  S.cur.m.push({role:'user',content:text});touch(S.cur);save();
  inp.value='';grow();drawAll();run(S.cur)}
function run(chat){
  var model=S.model;
  // an AI that runs on this device downloads a model the first time: ask before using up the visitor's data
  if(isLocal(model)&&!confirmed(model)){
    var def=localDef(model),ask1=msgEl('assistant'),box1=el('div','aiask'),row=el('div','row');
    var go=txt('button','btn pri','Download and start'),no=txt('button','btn','Cancel');go.type=no.type='button';
    box1.appendChild(txt('p','',(def?def.name.split(' ·')[0]:'This AI')+' runs on your device, so it’s free and private. The first time, it downloads '+(def?def.size:'a model')+', and then it’s saved on this device. Download it now?'));
    go.addEventListener('click',function(){markConfirmed(model);ask1.remove();run(chat)});
    no.addEventListener('click',function(){ask1.remove()});
    row.appendChild(go);row.appendChild(no);box1.appendChild(row);ask1.firstChild.appendChild(box1);box.appendChild(ask1);scrollDown(true);return}
  var bot=msgEl('assistant'),b=bot.firstChild,acc='',pend=0,ctl=new AbortController(),tok=++S.tok;
  function live(){return S.tok===tok} // false once you have moved to another chat
  b.appendChild(dots());box.appendChild(bot);scrollDown(true);
  S.busy=true;S.ctl=ctl;sync();
  function paint(){if(pend||!live())return;pend=requestAnimationFrame(function(){pend=0;render(b,acc);scrollDown(false)})}
  function finish(){
    cancelAnimationFrame(pend);pend=0;
    if(live()){S.busy=false;S.ctl=null}
    // what arrived is kept in the chat it belongs to, even if you have moved on
    if(acc){chat.m.push({role:'assistant',content:acc.slice(0,9000)});touch(chat);save();bot._text=acc;if(live())render(b,acc)}
    else if(live())bot.remove();
    if(live()){sync();scrollDown(false)}}
  function fail(msg){
    cancelAnimationFrame(pend);pend=0;
    if(!live())return;
    S.busy=false;S.ctl=null;sync();
    b.textContent='';if(acc)render(b,acc);else bot.removeChild(b);
    var e=el('div','aierr'),rb=txt('button','btn','Try again');rb.type='button';
    rb.addEventListener('click',function(){if(S.busy)return;bot.remove();run(chat)});
    e.appendChild(txt('span','',msg));e.appendChild(rb);bot.appendChild(e);scrollDown(true)}
  function onText(t){acc+=t;paint()}
  var history=chat.m.slice();
  var job=isLocal(model)?localJob(model,b,ctl,onText,history):hostedJob(model,ctl,onText,history);
  job.then(finish,function(e){
    if(ctl.signal.aborted||(e&&e.name==='AbortError'))finish();
    else fail(isLocal(model)?'This AI couldn’t start on this device. It may need more memory, or your network may block the download. Try another AI from the list.':(e&&e.message?e.message:'The AI had a problem. Try again in a moment.'))})}
function submit(){if(S.busy){if(S.ctl)S.ctl.abort();return}ask(inp.value)}
form.addEventListener('submit',function(e){e.preventDefault();submit()});
inp.addEventListener('input',function(){grow();sync()});
inp.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit()}
  else if(e.key==='Escape'){e.stopPropagation();inp.blur()}}); // Escape here shouldn't also close the page
newBtn.addEventListener('click',startNew);
newBtn2.addEventListener('click',startNew);
tog.addEventListener('click',function(){setSide(!ap.classList.contains('side'))});
back.addEventListener('click',closeSide);
// Escape closes the drawer first
addEventListener('keydown',function(e){if(e.key==='Escape'&&ap.classList.contains('side')&&document.body.dataset.page==='AI'){e.preventDefault();e.stopPropagation();closeSide()}},true);
addEventListener('resize',function(){if(innerWidth>900)closeSide()});

// ----- the list of AIs -----
function buildPicker(){
  pick.textContent='';
  S.models.forEach(function(m){var o=document.createElement('option');o.value=m.id;o.textContent=m.name;pick.appendChild(o)});
  var saved='';try{saved=localStorage.getItem(MKEY)||''}catch(e){}
  S.model=S.models.some(function(m){return m.id===saved})?saved:(S.models[0]?S.models[0].id:'');
  pick.value=S.model;
  if(S.models.length&&!S.picker&&typeof makeDropdown==='function'){
    S.picker=true;makeDropdown(pick);
    pick.addEventListener('change',function(){S.model=pick.value;try{localStorage.setItem(MKEY,S.model)}catch(e){}})}}
function setup(){
  var off=S.ready===false;
  note.hidden=!off;
  note.textContent=off?'The AI isn’t switched on yet. The site owner needs to add an AI key on the server.':'';
  inp.disabled=off;inp.placeholder=off?'The AI isn’t set up yet':'Ask anything';sync()}
// Lunaris AI first (it is the main one, so it is what opens by default), then any server AIs the owner has added keys for.
// Lunaris AI is only offered when the device can run it.
function loadModels(){
  return Promise.all([
    fetch('/api/ai/models').then(function(r){return r.ok?r.json():{models:[]}}).then(function(j){return Array.isArray(j.models)?j.models:[]},function(){return[]}),
    gpuOk()
  ]).then(function(r){
    var l=[];
    if(r[1])LOCAL.forEach(function(m){l.push({id:m.id,name:m.name})});
    r[0].forEach(function(m){if(m&&typeof m.id==='string'&&typeof m.name==='string')l.push(m)});
    S.models=l;S.ready=l.length>0;buildPicker();setup()})}

// right-click: on a message copy it, on a chat open or delete it
if(typeof ctxProvide==='function'){
  ctxProvide(function(t){
    var m=t.closest&&t.closest('.aimsg');if(!m||!m._text)return;
    return[{label:'Copy message',icon:'fa-regular fa-copy',action:function(){copy(m._text)}}]});
  ctxProvide(function(t){
    var r=t.closest&&t.closest('.aic');if(!r||!r._c)return;
    return[{label:'Open chat',icon:'fa-regular fa-comment',action:function(){openChat(r._c)}},
           {label:'Delete chat',icon:'fa-regular fa-trash-can',danger:true,action:function(){removeChat(r._c)}}]})}

loadChats();renderChats();
// called when the page is opened
window.openAI=function(){
  if(!S.started){S.started=true;drawAll();setup();loadModels()}
  focusInput()};
})();
