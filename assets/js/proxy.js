// =====================================================================
// Lunaris v2: how the Browser page connects to the web
//   - the search engine used for anything typed that isn't a web address
//   - the transport (Epoxy or libcurl) that carries the traffic
//   - the Wisp relay (a websocket server) the transport tunnels through
// The proxy is started here, not by the init() inside /bootstrap-init.js, because that one always uses this site's own /wisp/ and
// always uses libcurl. The steps are the same ones it takes (register the service worker, load Scramjet, build a transport and a
// controller); only the relay address and the transport come from Settings instead. The file paths still come from the config the
// server put in /bootstrap-init.js, so they follow whatever the server serves.
// =====================================================================
(function(){
var KEY='lunaris-net';
var DEFAULT_RELAY='wss://bare-server.fly.dev/wisp/';
// %s stands for what was typed
var ENGINES=[
  {id:'google',n:'Google',u:'https://www.google.com/search?q=%s'},
  {id:'duckduckgo',n:'DuckDuckGo',u:'https://duckduckgo.com/?q=%s'},
  {id:'bing',n:'Bing',u:'https://www.bing.com/search?q=%s'},
  {id:'brave',n:'Brave Search',u:'https://search.brave.com/search?q=%s'},
  {id:'yahoo',n:'Yahoo',u:'https://search.yahoo.com/search?p=%s'},
  {id:'startpage',n:'Startpage',u:'https://www.startpage.com/do/search?q=%s'},
  {id:'ecosia',n:'Ecosia',u:'https://www.ecosia.org/search?q=%s'},
  {id:'custom',n:'Custom…',u:''}];
var TRANSPORTS={
  libcurl:'libcurl.js. The default. If a site won’t load, try Epoxy.',
  epoxy:'Epoxy, a smaller client. Try it if a site won’t load with libcurl.'};

// ---------- what is saved ----------
// (this site's own /wisp/ relay is switched off on the server: it used up the host's bandwidth credit, so it isn't offered here)
var S={relay:DEFAULT_RELAY,transport:'libcurl',engine:'google',custom:''};
function engineById(id){return ENGINES.filter(function(e){return e.id===id})[0]}
function goodTemplate(t){return typeof t==='string'&&t.length<=500&&/^https?:\/\/[^\s]+$/i.test(t)&&t.indexOf('%s')>=0}
(function(){try{var v=JSON.parse(localStorage.getItem(KEY));if(!v||typeof v!=='object')return;
  // a relay saved earlier as "this site" (or this site's address) is dropped, which leaves the default
  if(typeof v.relay==='string'&&v.relay!=='self'){var r=normRelay(v.relay);if(r.url)S.relay=r.url}
  if(v.transport==='epoxy'||v.transport==='libcurl')S.transport=v.transport;
  if(engineById(v.engine))S.engine=v.engine;
  if(goodTemplate(v.custom))S.custom=v.custom;
  if(S.engine==='custom'&&!S.custom)S.engine='google'}catch(e){}})();
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}

// ---------- the config the server put in /bootstrap-init.js ----------
function paths(){
  var d={swPath:'/sw.js',scramjetBundlePath:'/scram/scramjet.js',scramjetControllerApiPath:'/controller/controller.api.js',
    scramjetUtilsBundlePath:'/scram/scramjet-utils.js',epoxyClientPath:'/clients/epoxy-client.js',libcurlClientPath:'/clients/libcurl-client.js',
    scramjetControllerInjectPath:'/controller/controller.inject.js',scramjetWasmPath:'/scram/scramjet.wasm'};
  try{var m=/init\((\{[\s\S]*\})\)/.exec(String(window.initBootstrap)),c=JSON.parse(m[1]);
    Object.keys(d).forEach(function(k){if(typeof c[k]==='string'&&c[k].charAt(0)==='/')d[k]=c[k]})}catch(e){}
  return d}
function relayUrl(){return S.relay}

// ---------- checking what was typed in Settings ----------
function normRelay(v){
  v=String(v||'').trim();
  if(!v)return{err:'Enter a Wisp relay address, like '+DEFAULT_RELAY};
  if(/\s/.test(v))return{err:'That doesn’t look like a web address.'};
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(v))v='wss://'+v;
  v=v.replace(/^http(s?):\/\//i,function(m,s){return s?'wss://':'ws://'});
  var u;try{u=new URL(v)}catch(e){return{err:'That doesn’t look like a web address.'}}
  if(u.protocol!=='ws:'&&u.protocol!=='wss:')return{err:'A Wisp relay address starts with wss:// (or ws://).'};
  if(u.username||u.password)return{err:'Leave the username and password out of the address.'};
  if(u.host===location.host&&/^\/wisp(\/|$)/.test(u.pathname))return{err:'That is this site’s own relay, which is switched off. Use another relay.'};
  if(!/^([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(u.hostname)&&!/^\[[0-9a-f:.]+\]$/i.test(u.hostname))return{err:'That doesn’t look like a web address.'};
  if(u.protocol==='ws:'&&location.protocol==='https:'&&!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))return{err:'This page is on https, so the relay has to start with wss://.'};
  u.hash='';
  if(!u.search&&u.pathname.slice(-1)!=='/')u.pathname+='/';
  return{url:u.href}}

// does something answer at this address? (a Wisp server accepts the websocket straight away)
function probe(url,ms){return new Promise(function(done){
  var t0=Date.now(),over=false,ws,tm;
  function fin(ok,why){if(over)return;over=true;clearTimeout(tm);try{ws.close()}catch(e){}done({ok:ok,ms:Date.now()-t0,why:why})}
  tm=setTimeout(function(){fin(false,'it didn’t answer in time')},ms||7000);
  try{ws=new WebSocket(url)}catch(e){over=true;clearTimeout(tm);return done({ok:false,ms:0,why:'the address was refused'})}
  ws.onopen=function(){fin(true)};
  ws.onerror=function(){fin(false,'it couldn’t be reached')};
  ws.onclose=function(){fin(false,'it closed the connection')}})}

// ---------- starting the proxy ----------
function loadScript(src){return new Promise(function(ok,no){var s=document.createElement('script');s.src=src;s.onload=function(){ok()};s.onerror=function(){no(new Error('Failed to load '+src))};document.head.appendChild(s)})}
async function registerSW(path){
  var reg=await navigator.serviceWorker.register(path,{type:'classic',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  if(reg.active)return reg.active;
  if(reg.installing)return await new Promise(function(ok){var w=reg.installing;
    if(w.state==='activated')ok();else w.addEventListener('statechange',function f(){if(w.state==='activated'){w.removeEventListener('statechange',f);ok()}})}).then(function(){return reg.active});
  if(reg.waiting)return await new Promise(function(ok){navigator.serviceWorker.addEventListener('controllerchange',function(){ok()},{once:true})}).then(function(){return navigator.serviceWorker.controller});
  throw new Error('No service worker found in registration')}
var live=false,starting=null;
function start(){
  if(starting)return starting;
  starting=(async function(){
    var url=relayUrl(),p=paths();
    // find out first whether the relay answers, so a dead one gives a clear message instead of pages that never load
    var r=await probe(url,7000);
    if(!r.ok)throw new Error('The Wisp relay ('+url+') isn’t answering: '+r.why+'. Pick another one in Settings → Browser.');
    var sw=await registerSW(p.swPath);
    await loadScript(p.scramjetBundlePath);await loadScript(p.scramjetControllerApiPath);await loadScript(p.scramjetUtilsBundlePath);
    var transport,epoxy=S.transport==='epoxy';
    try{await loadScript(epoxy?p.epoxyClientPath:p.libcurlClientPath)}
    catch(e){throw new Error('The '+(epoxy?'Epoxy':'libcurl')+' transport couldn’t be loaded from this site. Switch transport in Settings → Browser.')}
    // older builds export a class named EpoxyClient / LibcurlClient, newer ones export the class as the default
    var lib=epoxy?window.EpoxyTransport:window.LibcurlTransport;
    var Ctor=lib&&(epoxy?lib.EpoxyClient:lib.LibcurlClient)||lib&&lib.default||(typeof lib==='function'?lib:null);
    if(!Ctor)throw new Error('The '+(epoxy?'Epoxy':'libcurl')+' transport loaded but isn’t usable. Switch transport in Settings → Browser.');
    transport=new Ctor({wisp:url});
    var C=window.$scramjetController,cfg=C.config;
    cfg.injectPath=p.scramjetControllerInjectPath;cfg.wasmPath=p.scramjetWasmPath;cfg.scramjetPath=p.scramjetBundlePath;
    var ctl=new C.Controller({serviceworker:sw,transport:transport});
    live=true;return ctl})();
  starting.catch(function(){starting=null});
  return starting}

function searchUrl(q){
  var e=engineById(S.engine)||ENGINES[0],t=S.engine==='custom'?S.custom:e.u;
  return t.split('%s').join(encodeURIComponent(q))}

window.ProxySettings={start:start,searchUrl:searchUrl,relay:relayUrl,transport:function(){return S.transport},live:function(){return live},defaultRelay:DEFAULT_RELAY};

// ---------- the Settings card ----------
function $(id){return document.getElementById(id)}
function ui(){
  var seng=$('seng'),scustom=$('scustom'),seg=$('stransport'),stdesc=$('stdesc'),swisp=$('swisp'),smsg=$('smsg'),sreload=$('sreload');
  if(!seng||!scustom||!seg||!swisp||!smsg)return;
  ENGINES.forEach(function(e){var o=document.createElement('option');o.value=e.id;o.textContent=e.n;seng.appendChild(o)});
  seng.value=S.engine;makeDropdown(seng);
  function say(t,ok){smsg.textContent=t||'';smsg.classList.toggle('ok',!!ok)}
  // the relay and the transport are picked up when the proxy starts, which happens once per page load
  function applied(what){
    if(live){sreload.hidden=false;say(what+' saved. Reload the page to use it in the Browser.',true)}
    else{sreload.hidden=true;say(what+' saved.',true)}}
  function showCustom(){scustom.hidden=S.engine!=='custom';scustom.value=S.custom}
  function showTransport(){[].forEach.call(seg.querySelectorAll('button'),function(b){var on=b.dataset.t===S.transport;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))});stdesc.textContent=TRANSPORTS[S.transport]}
  showCustom();showTransport();swisp.value=relayUrl();

  seng.addEventListener('change',function(){
    S.engine=seng.value;
    if(S.engine==='custom'&&!S.custom){showCustom();scustom.focus();say('Type a search address with %s where the words go.');return}
    save();showCustom();say('Searches now use '+engineById(S.engine).n+'.',true)});
  function saveCustom(){
    var t=scustom.value.trim();
    if(!goodTemplate(t)){say('A custom search address starts with https:// and has %s where the words go, like https://example.com/search?q=%s');return}
    S.custom=t;S.engine='custom';save();seng.value='custom';if(seng._ddSync)seng._ddSync();say('Searches now use your address.',true)}
  scustom.addEventListener('change',saveCustom);
  scustom.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();saveCustom()}});

  [].forEach.call(seg.querySelectorAll('button'),function(b){b.addEventListener('click',function(){
    if(S.transport===b.dataset.t)return;
    S.transport=b.dataset.t;save();showTransport();applied(b.textContent+' as the transport')})});

  function setRelay(v){
    var r=normRelay(v);if(r.err){say(r.err);return false}
    S.relay=r.url;save();swisp.value=r.url;
    applied('The relay');return true}
  $('swsave').addEventListener('click',function(){setRelay(swisp.value)});
  swisp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();setRelay(swisp.value)}});
  $('swdef').addEventListener('click',function(){setRelay(DEFAULT_RELAY)});
  $('swtest').addEventListener('click',function(){
    var r=normRelay(swisp.value);if(r.err){say(r.err);return}
    var b=$('swtest');b.disabled=true;say('Connecting…',true);
    probe(r.url,7000).then(function(x){b.disabled=false;
      if(x.ok)say('Connected to '+r.url+' in '+x.ms+' ms.',true);else say('Couldn’t connect to '+r.url+': '+x.why+'.')})});
  sreload.addEventListener('click',function(){location.reload()})}
ui();
})();
