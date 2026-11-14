// ---------- Watch: a catalogue of TV shows ----------
// Data comes from TMDB through this site's own /api/tv/* routes (see tv.js), so the API key never reaches the browser.
// The page lists shows, searches them, keeps a "My list" in this browser, and has a page per show with cast, episodes
// and links to the show's own site.
(function(){
var wp=document.getElementById('watch'),wl=document.getElementById('wlist'),wsent=document.getElementById('wsent'),
    wq=document.getElementById('wq'),wg=document.getElementById('wg'),ws=document.getElementById('ws'),wtype=document.getElementById('wtype'),
    wmy=document.getElementById('wmy'),wrand=document.getElementById('wrand'),wcount=document.getElementById('wcount'),
    wnote=document.getElementById('wnote'),wbrowse=document.getElementById('wbrowse'),wdet=document.getElementById('wdetail');
if(!wp||!wl)return;
var IMG='https://image.tmdb.org/t/p/',PAGE=60,KEY='orata-watch';
var W={media:'tv',sort:'popular',genre:'',q:'',mine:false,items:[],total:0,busy:false,done:false,seq:0,dseq:0,gkey:null,
        started:false,view:'grid',scroll:0,lib:[],btotal:0,bkey:'',sc:{}};
// ----- helpers -----
function ico(cls){var i=document.createElement('i');i.className=cls;i.setAttribute('aria-hidden','true');return i}
function txt(tag,cls,s){var e=el(tag,cls);e.textContent=s;return e}
function api(path){
  return fetch('/api/tv/'+path).then(function(r){
    return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||(r.status===404?'Movie support is not available in the running server yet. Restart the site and try again.':'Request failed ('+r.status+'). Try again in a moment.'));return j})
  },function(){throw new Error('Couldn’t reach the server. Check your connection.')})}
function plural(n,w){return n.toLocaleString()+' '+w+(n===1?'':'s')}
function year(p){return p?p.slice(0,4):''}
function fmtDate(d,long){
  if(!d)return '';var t=new Date(d+'T12:00:00');if(isNaN(t))return d;
  return t.toLocaleDateString(undefined,long?{weekday:'short',month:'short',day:'numeric',year:'numeric'}:{month:'short',day:'numeric',year:'numeric'})}
function todayStr(){var t=new Date(),m=t.getMonth()+1,d=t.getDate();return t.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(d<10?'0':'')+d}
function pic(path,size,cls){var im=new Image();im.alt='';im.referrerPolicy='no-referrer';im.decoding='async';im.loading='lazy';if(cls)im.className=cls;im.addEventListener('error',function(){im.remove()});im.src=IMG+size+path;return im}
// links to other sites open in the site's own browser (a middle-click still opens a normal new tab)
function extLink(a,url){
  a.href=url;a.rel='noopener noreferrer';a.target='_blank';
  a.addEventListener('click',function(e){if(e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(typeof openInBrowser==='function')openInBrowser(url);else window.open(url,'_blank','noopener')})}
function linkBtn(label,url,primary){var a=el('a','btn'+(primary?' pri':''));a.appendChild(document.createTextNode(label));a.appendChild(ico('fa-solid fa-arrow-up-right-from-square'));extLink(a,url);return a}
[].forEach.call(wp.querySelectorAll('a[data-ext]'),function(a){extLink(a,a.getAttribute('href'))});

// ----- My list (kept in this browser) -----
  try{var _w=JSON.parse(localStorage.getItem(KEY)||'null');if(_w&&Array.isArray(_w.list))W.lib=_w.list.filter(function(s){return s&&typeof s.id==='number'&&s.n}).slice(0,300)}catch(e){}
function saveLib(){try{localStorage.setItem(KEY,JSON.stringify({list:W.lib}))}catch(e){}}
function libIndex(id){for(var i=0;i<W.lib.length;i++)if(W.lib[i].id===id&&(W.lib[i].t||'tv')===W.media)return i;return-1}
function inLib(id){for(var i=0;i<W.lib.length;i++)if(W.lib[i].id===id&&(W.lib[i].t||'tv')===W.media)return true;return false}
function slim(s){return{t:s.t||W.media,id:s.id,n:s.n,i:s.i||null,p:s.p||null,g:(s.g||[]).slice(0,3),r:s.r==null?null:s.r}}
function toggleSave(s){
  var i=libIndex(s.id);
  if(i>=0)W.lib.splice(i,1);else W.lib.unshift(slim(s));
  saveLib();syncSaved(s.id)}
function syncSaved(id){
  var on=inLib(id),lbl=on?'Remove from My list':'Add to My list';
  [].forEach.call(wp.querySelectorAll('.wt-bm[data-id="'+id+'"]'),function(b){b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',lbl);b.title=lbl});
  [].forEach.call(wp.querySelectorAll('.wd-save[data-id="'+id+'"]'),function(b){setSaveBtn(b,on)});
  if(W.mine&&!on){ // the list is on screen: the show leaves it
    [].forEach.call(wl.querySelectorAll('.wt'),function(t){if(t._s&&t._s.id===id)t.remove()});
    W.items=W.items.filter(function(s){return s.id!==id});W.total=W.items.length;counts();notes()}}
function setSaveBtn(b,on){
  b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));
  b.textContent='';b.appendChild(ico(on?'fa-solid fa-bookmark':'fa-regular fa-bookmark'));b.appendChild(document.createTextNode(on?'On My list':'Add to My list'))}

// ----- the grid of shows -----
function metaLine(s){return[year(s.p),s.g&&s.g[0]].filter(Boolean).join(' · ')}
function tile(s,i){
  var d=el('div','wt'),cv=el('button','wt-cv'),nm=el('button','wt-n'),bm=el('button','wt-bm'),on=inLib(s.id),lbl=on?'Remove from My list':'Add to My list';
  d._s=s;d.style.setProperty('--i',Math.min(i%PAGE,14));
  cv.type=nm.type=bm.type='button';cv.setAttribute('aria-label',s.n);
  cv.appendChild(txt('span','wt-ph',s.n));
  if(s.i)cv.appendChild(pic(s.i,'w342'));
  if(typeof s.r==='number'&&s.r>0){var r=el('span','wt-r');r.appendChild(ico('fa-solid fa-star'));r.appendChild(document.createTextNode(s.r.toFixed(1)));cv.appendChild(r)}
  nm.textContent=s.n;nm.title=s.n;
  bm.dataset.id=s.id;bm.appendChild(ico('fa-solid fa-bookmark'));bm.classList.toggle('on',on);bm.setAttribute('aria-pressed',String(on));bm.setAttribute('aria-label',lbl);bm.title=lbl;
  cv.addEventListener('click',function(){openShow(s)});nm.addEventListener('click',function(){openShow(s)});
  bm.addEventListener('click',function(e){e.stopPropagation();toggleSave(s)});
  d.appendChild(cv);d.appendChild(bm);d.appendChild(nm);
  var m=metaLine(s);if(m)d.appendChild(txt('div','wt-m',m));
  return d}
function dropSkeletons(){[].forEach.call(wl.querySelectorAll('.wtsk'),function(x){x.remove()})}
function skeletons(n){var f=document.createDocumentFragment();for(var i=0;i<n;i++)f.appendChild(el('div','sk wtsk'));wl.appendChild(f)}
function counts(){
  var n=W.mine||W.q?W.items.length:W.total;
  wcount.textContent=!n?'':W.mine?plural(n,'saved '+(W.media==='movie'?'movie':'show')):W.q?plural(n,'result'):plural(n,W.media==='movie'?'movie':'show')}
// the line above the grid: empty states and errors
function setNote(msg,opts){
  opts=opts||{};wnote.textContent='';wnote.hidden=!msg;wnote.classList.toggle('big',!!opts.big);if(!msg)return;
  wnote.appendChild(txt('span','',msg));
  if(opts.retry){var b=txt('button','btn',opts.retry);b.type='button';b.addEventListener('click',opts.fn);wnote.appendChild(b)}}
function notes(){
  if(W.items.length||W.busy)return setNote('');
  if(W.mine)return setNote(W.q?'Nothing on your list matches “'+W.q+'”.':'Nothing saved yet. Press the bookmark on any show to keep it here.',{big:true});
  if(W.q)return setNote('No shows found for “'+W.q+'”. Try another spelling.',{big:true});
  setNote('No shows to show here right now.',{big:true})}
function add(items){
  dropSkeletons();
  var f=document.createDocumentFragment(),base=W.items.length;
  items.forEach(function(s,i){f.appendChild(tile(s,base+i))});
  W.items=W.items.concat(items);wl.appendChild(f);counts();notes();
  requestAnimationFrame(check)}
// keeps loading while the end of the grid is (nearly) on screen
function check(){if(!W.done&&!W.busy&&W.view==='grid'&&wsent.getBoundingClientRect().top<wp.getBoundingClientRect().bottom+700)fill()}
function params(){return'sort='+W.sort+'&genre='+encodeURIComponent(W.genre)}
function fill(){
  if(W.busy||W.done)return;
  var seq=W.seq,q=W.q;
  if(W.mine){
    W.done=true;var ql=q.toLowerCase();
    add(W.lib.filter(function(s){return!ql||s.n.toLowerCase().indexOf(ql)>=0}));W.total=W.items.length;counts();notes();return}
  W.busy=true;
  var p=q?api((W.media==='movie'?'search-movies':'search')+'?q='+encodeURIComponent(q)):api((W.media==='movie'?'movies':'shows')+'?'+params()+'&offset='+W.items.length+'&limit='+PAGE);
  p.then(function(j){
    if(seq!==W.seq)return;
    W.busy=false;var items=j.items||[];
    if(q){W.done=true;W.total=items.length}
    else{
      W.total=j.total||0;W.btotal=W.total;W.bkey=W.media+params();fillGenres(j.genres||[]);
      if(!items.length||W.items.length+items.length>=W.total)W.done=true}
    if(items.length)add(items);else{dropSkeletons();counts();notes()}
  }).catch(function(e){
    if(seq!==W.seq)return;
    W.busy=false;W.done=true;dropSkeletons();
    setNote(e.message,{big:!W.items.length,retry:'Try again',fn:function(){W.done=false;setNote('');if(!W.items.length)skeletons(18);fill()}})})}
function restart(){
  W.seq++;W.items=[];W.total=0;W.done=false;W.busy=false;wl.textContent='';setNote('');wcount.textContent='';W.gkey=null;
  if(W.view==='show')closeShow(true);
  wp.scrollTop=0;
  if(!W.mine)skeletons(18);
  fill()}

// ----- genre filter: filled in from what the server reports -----
function fillGenres(list){
  var key=list.join('|');if(key===W.gkey)return;W.gkey=key;
  var wrap=wg.parentNode;
  if(wrap&&wrap.classList.contains('dd')){wrap.parentNode.insertBefore(wg,wrap);wrap.remove();wg.classList.remove('dd-native');wg.removeAttribute('aria-hidden');wg.tabIndex=0}
  wg.textContent='';
  [['','All genres']].concat(list.map(function(g){return[g,g]})).forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];wg.appendChild(op)});
  if(list.indexOf(W.genre)<0)W.genre='';
  wg.value=W.genre;
  if(typeof makeDropdown==='function')makeDropdown(wg)}

// ----- controls -----
var sbTimer=0;
wq.addEventListener('input',function(){clearTimeout(sbTimer);sbTimer=setTimeout(function(){setQuery(wq.value.trim())},320)});
wq.addEventListener('keydown',function(e){if(e.key==='Enter'){clearTimeout(sbTimer);setQuery(wq.value.trim())}});
function setQuery(q){if(q===W.q)return;W.q=q;wp.classList.toggle('searching',!!q&&!W.mine);restart()}
ws.addEventListener('change',function(){W.sort=ws.value;restart()});
wtype.addEventListener('change',function(){W.media=wtype.value;W.genre='';W.q='';wq.value='';wq.placeholder=W.media==='movie'?'Search movies':'Search TV shows';wq.setAttribute('aria-label',wq.placeholder);wrand.setAttribute('aria-label',W.media==='movie'?'Random movie':'Random show');wrand.title=W.media==='movie'?'Random movie':'Random show';restart()});
wg.addEventListener('change',function(){W.genre=wg.value;restart()});
wmy.addEventListener('click',function(){
  W.mine=!W.mine;wmy.classList.toggle('on',W.mine);wmy.setAttribute('aria-pressed',String(W.mine));
  wp.classList.toggle('mine',W.mine);wp.classList.toggle('searching',!!W.q&&!W.mine);restart()});
wrand.addEventListener('click',function(){
  function pick(total){
    if(!total)return;
    api((W.media==='movie'?'movies':'shows')+'?'+params()+'&offset='+Math.floor(Math.random()*total)+'&limit=1').then(function(j){if(j.items&&j.items[0])openShow(j.items[0])}).catch(function(e){setNote(e.message)})}
  if(W.btotal&&W.bkey===W.media+params())pick(W.btotal);
  else api((W.media==='movie'?'movies':'shows')+'?'+params()+'&limit=1').then(function(j){pick(j.total)}).catch(function(e){setNote(e.message)})});
new IntersectionObserver(function(es){if(es[0].isIntersecting)check()},{root:wp,rootMargin:'700px'}).observe(wsent);

// ----- a show's page -----
function openShow(s){
  if(W.view==='grid')W.scroll=wp.scrollTop;
  W.view='show';wp.classList.add('in-show');wbrowse.hidden=true;wdet.hidden=false;wp.scrollTop=0;
  var seq=++W.dseq,parts=shell(s);
  api((W.media==='movie'?'movie':'show')+'?id='+s.id).then(function(d){if(seq===W.dseq&&W.view==='show')fillDetail(parts,d)})
    .catch(function(e){if(seq!==W.dseq)return;parts.rest.textContent='';
      var n=el('div','wnote');n.appendChild(txt('span','',e.message));var b=txt('button','btn','Try again');b.type='button';
      b.addEventListener('click',function(){openShow(s)});n.appendChild(b);parts.rest.appendChild(n)})}
function closeShow(quiet){
  W.view='grid';W.dseq++;wp.classList.remove('in-show');wdet.hidden=true;wdet.textContent='';wbrowse.hidden=false;
  if(!quiet){wp.scrollTop=W.scroll;requestAnimationFrame(check)}}
function factChip(label,icon,cls){var f=el('span','wd-fact'+(cls?' '+cls:''));if(icon)f.appendChild(ico(icon));f.appendChild(document.createTextNode(label));return f}
function years(d){
  var a=year(d.p),b=year(d.ended);if(!a)return'';
  if(d.s==='Running')return a+'–Present';
  return b&&b!==a?a+'–'+b:a}
function skLine(w,h,mt){var s=el('div','sk');s.style.cssText='height:'+h+'px;width:'+w+';margin-top:'+mt+'px;border-radius:12px';return s}
// the page appears at once from the little record the grid already has; fillDetail adds the rest when it arrives
function shell(s){
  wdet.textContent='';
  var root=el('div','wd'),back=el('button','back wd-back'),hero=el('div','wd-hero'),pos=el('div','wd-poster'),info=el('div','wd-info'),
      facts=el('div','wd-facts'),genres=el('div','wd-genres'),sum=el('div'),acts=el('div'),rest=el('div','wd-rest');
  back.type='button';back.appendChild(ico('fa-solid fa-chevron-left'));back.appendChild(document.createTextNode(W.media==='movie'?'All movies':'All shows'));
  back.addEventListener('click',function(){closeShow()});
  if(s.i)pos.appendChild(pic(s.i,'w342'));
  if(typeof s.r==='number'&&s.r>0)facts.appendChild(factChip(s.r.toFixed(1),'fa-solid fa-star'));
  if(s.p)facts.appendChild(factChip(year(s.p),'fa-regular fa-calendar'));
  (s.g||[]).forEach(function(g){genres.appendChild(txt('span','wd-genre',g))});
  sum.appendChild(skLine('min(520px,100%)',18,10));sum.appendChild(skLine('min(440px,90%)',18,8));
  info.appendChild(txt('h3','wd-title',s.n));info.appendChild(facts);info.appendChild(genres);info.appendChild(sum);info.appendChild(acts);
  hero.appendChild(pos);hero.appendChild(info);
  var sk=el('div','sk');sk.style.cssText='height:220px;margin-top:40px;border-radius:20px';rest.appendChild(sk);
  root.appendChild(back);root.appendChild(hero);root.appendChild(rest);wdet.appendChild(root);
  if(W.media==='movie'){
    var play=txt('button','btn pri wd-watch','Watch movie');play.type='button';play.addEventListener('click',function(){openPlayback(s.id,'movie',0,0,s.n)});acts.appendChild(play)
  }else{
    var save=el('button','btn pri wd-save');save.type='button';save.dataset.id=s.id;setSaveBtn(save,inLib(s.id));
    save.addEventListener('click',function(){toggleSave(s)});acts.appendChild(save)
  }
  back.focus({preventScroll:true});
  return{root:root,facts:facts,genres:genres,sum:sum,acts:acts,rest:rest,s:s}}
function fillDetail(p,d){
  // a faded still from the show behind the top of the page
  if(d.b){var bd=el('div','wd-bd');bd.appendChild(pic(d.b,'w780'));p.root.insertBefore(bd,p.root.firstChild)}
  // facts
  p.facts.textContent='';
  if(typeof d.r==='number'&&d.r>0)p.facts.appendChild(factChip(d.r.toFixed(1),'fa-solid fa-star'));
  if(d.s==='Running')p.facts.appendChild(factChip('Running','','live'));else if(d.s)p.facts.appendChild(factChip(d.s));
  var yr=years(d);if(yr)p.facts.appendChild(factChip(yr,'fa-regular fa-calendar'));
  if(d.rt)p.facts.appendChild(factChip(d.rt+' min','fa-regular fa-clock'));
  if(d.ch)p.facts.appendChild(factChip(d.ch.n,'fa-solid fa-tower-broadcast'));
  if(d.seasons&&d.seasons.length)p.facts.appendChild(factChip(plural(d.seasons.length,'season'),'fa-solid fa-layer-group'));
  p.genres.textContent='';(d.g||[]).forEach(function(g){p.genres.appendChild(txt('span','wd-genre',g))});
  // summary
  p.sum.textContent='';
  if(d.tag)p.sum.appendChild(txt('p','wd-tag','“'+d.tag+'”'));
  var long=(d.summary||'').length>360,sm=txt('p','wd-sum'+(long?' clamp':''),d.summary||'No description has been added yet.');
  p.sum.appendChild(sm);
  if(long){var mb=txt('button','wd-more','More');mb.type='button';mb.addEventListener('click',function(){var c=sm.classList.toggle('clamp');mb.textContent=c?'More':'Less'});p.sum.appendChild(mb)}
  if(d.next){
    var nx=el('div','wd-next');nx.appendChild(ico('fa-regular fa-calendar-plus'));
    nx.appendChild(document.createTextNode('Next: S'+d.next.s+' E'+d.next.e+(d.next.n?' “'+d.next.n+'”':'')+(d.next.d?' · '+fmtDate(d.next.d,true):'')));
    p.sum.appendChild(nx)}
  // links out: the show's own site, TMDB and IMDb
  var more=el('div','wd-grp'),ml=el('div','wd-links');
  more.appendChild(txt('small','','More about it'));
  if(d.official)ml.appendChild(linkBtn('Official site',d.official));
  if(d.url)ml.appendChild(linkBtn('TMDB',d.url));
  if(d.imdb)ml.appendChild(linkBtn('IMDb','https://www.imdb.com/title/'+d.imdb+'/'));
  more.appendChild(ml);if(ml.childNodes.length)p.acts.appendChild(more);
  // cast + episodes
  p.rest.textContent='';
  if(d.cast&&d.cast.length){
    var cs=el('section','wd-sec'),row=el('div','wd-cast');cs.appendChild(txt('h4','','Cast'));
    d.cast.forEach(function(c){
      var it=el('div','wd-c'),ph=el('div','ph');
      ph.appendChild(ico('fa-solid fa-user'));if(c.i)ph.appendChild(pic(c.i,'w185'));
      it.appendChild(ph);it.appendChild(txt('b','',c.p));if(c.c)it.appendChild(txt('small','',c.c));row.appendChild(it)});
    cs.appendChild(row);p.rest.appendChild(cs)}
  var es=el('section','wd-sec');
  if(d.seasons&&d.seasons.length)p.rest.appendChild(episodes(es,d));
  else if(W.media==='movie'){var save=el('button','btn pri wd-save');save.type='button';save.dataset.id=d.id;setSaveBtn(save,inLib(d.id));save.addEventListener('click',function(){toggleSave(p.s)});es.appendChild(txt('h4','','My list'));es.appendChild(save);p.rest.appendChild(es)}
  else{es.appendChild(txt('h4','','Episodes'));es.appendChild(txt('p','wd-none','No episodes are listed for this show yet.'));p.rest.appendChild(es)}}

// ----- episodes: one season at a time -----
function episodes(sec,d){
  var head=el('div','wd-eph'),sp=el('div','wd-seasons'),list=el('div','wd-eps'),today=todayStr();
  head.appendChild(txt('h4','','Episodes'));
  // a running show opens on the newest season that has started, a finished one on its first
  var idx=0;
  if(d.s==='Running')for(var k=d.seasons.length-1;k>=0;k--){if(d.seasons[k].d&&d.seasons[k].d<=today){idx=k;break}}
  if(d.seasons.length>1)sp.appendChild(txt('span','','Season'));
  var btns=d.seasons.map(function(se,i){
    var b=txt('button','wd-sp',String(se.n));b.type='button';b.title='Season '+se.n+' · '+plural(se.c,'episode');
    b.addEventListener('click',function(){pick(i)});sp.appendChild(b);return b});
  function pick(i){btns.forEach(function(b,j){b.setAttribute('aria-pressed',String(j===i))});showSeason(list,d.id,d.seasons[i].n,today)}
  head.appendChild(sp);if(d.seasons.length===1)sp.hidden=true;
  sec.appendChild(head);sec.appendChild(list);pick(idx);
  // centre the open season in the row of numbers (only the row scrolls, never the page)
  var cb=btns[idx];if(cb)setTimeout(function(){sp.scrollLeft+=cb.getBoundingClientRect().left-sp.getBoundingClientRect().left-(sp.clientWidth-cb.offsetWidth)/2},0);
  return sec}
function showSeason(list,id,n,today){
  var key=id+':'+n,hit=W.sc[key];
  list.dataset.n=n;list.textContent='';
  function render(eps){
    if(list.dataset.n!==String(n)||!list.isConnected)return;
    list.textContent='';
    if(!eps.length)list.appendChild(txt('p','wd-none','No episodes are listed for this season yet.'));
    eps.forEach(function(e,k){list.appendChild(epRow(e,k,today,id,n))})}
  if(hit)return render(hit);
  for(var i=0;i<3;i++){var s=el('div','sk');s.style.cssText='height:74px;border-radius:16px';list.appendChild(s)}
  api('season?id='+id+'&n='+n).then(function(j){W.sc[key]=j.eps||[];render(W.sc[key])})
    .catch(function(e){
      if(list.dataset.n!==String(n)||!list.isConnected)return;
      list.textContent='';var nt=el('div','wnote');nt.appendChild(txt('span','',e.message));
      var b=txt('button','btn','Try again');b.type='button';b.addEventListener('click',function(){showSeason(list,id,n,today)});nt.appendChild(b);list.appendChild(nt)})}
function epRow(e,k,today,id,season){
  var soon=e.d&&e.d>today,hasSum=!!e.t,r=el('div','we'+(soon?' soon':'')+(hasSum?'':' plain')),
      n=txt('span','we-n',String(e.e)),img=el('span','we-img'),b=el('span','we-b'),
      meta=[soon?'Airs '+fmtDate(e.d,true):fmtDate(e.d),e.rt?e.rt+' min':'',typeof e.r==='number'&&e.r>0?'★ '+e.r.toFixed(1):''].filter(Boolean).join(' · ');
  r.style.setProperty('--i',Math.min(k,12));
  if(hasSum){r.tabIndex=0;r.setAttribute('role','button');r.setAttribute('aria-expanded','false');r.addEventListener('click',function(){var o=r.classList.toggle('open');r.setAttribute('aria-expanded',String(o))});r.addEventListener('keydown',function(ev){if(ev.target===r&&(ev.key==='Enter'||ev.key===' ')){ev.preventDefault();r.click()}})}
  if(e.i)img.appendChild(pic(e.i,'w300'));else img.style.visibility='hidden';
  b.appendChild(txt('span','we-t',e.n||'Episode '+e.e));if(meta)b.appendChild(txt('span','we-m',meta));if(hasSum)b.appendChild(txt('span','we-s',e.t));
  var play=txt('button','we-play','Watch');play.type='button';play.setAttribute('aria-label','Watch season '+season+', episode '+e.e);
  play.addEventListener('click',function(ev){ev.stopPropagation();playEpisode(id,season,e)});
  r.appendChild(n);r.appendChild(img);r.appendChild(b);r.appendChild(play);return r}

// All providers below accept TMDB IDs, so no second metadata lookup is needed.
function playEpisode(id,season,episode){openPlayback(id,'tv',season,episode.e,episode.n||('Episode '+episode.e))}
function openPlayback(id,media,season,episode,titleText){
  if(!/^\d+$/.test(String(id))||(media==='tv'&&(!/^\d+$/.test(String(season))||!/^\d+$/.test(String(episode)))))return;
  var old=wdet.querySelector('.wd-player');if(old)old.remove();
  var providers=[['vidstuck','VidStuck'],['vidy','Vidy'],['cinesrc','CineSrc'],['superembed','SuperEmbed'],['vidrift','VidRift'],['vidnest','VidNest'],['vixsrc','VixSrc']];
  function source(provider){
    if(media==='movie'){
      var moviePath='/'+encodeURIComponent(id);
      if(provider==='vidy')return'https://vidy.st/movie'+moviePath+'?color=DC2626';
      if(provider==='cinesrc')return'https://cinesrc.st/embed/movie'+moviePath+'?color=%23e50914';
      if(provider==='superembed')return'https://multiembed.mov/?video_id='+encodeURIComponent(id)+'&tmdb=1';
      if(provider==='vidrift')return'https://embed.vidrift.net/embed/movie'+moviePath+'?brand=Orata&brandColor=E50914&showTitle=1';
      if(provider==='vidnest')return'https://vidnest.fun/movie'+moviePath;
      if(provider==='vixsrc')return'https://vixsrc.to/movie'+moviePath+'?primaryColor=E50914';
      return'https://www.vidstuck.cc/embed/movie'+moviePath+'?branding=Orata&color=e50914&overlay=true'
    }
    var path='/'+encodeURIComponent(id)+'/'+encodeURIComponent(season)+'/'+encodeURIComponent(episode);
    if(provider==='vidy')return'https://vidy.st/tv'+path+'?color=DC2626&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true';
    if(provider==='cinesrc')return'https://cinesrc.st/embed/tv/'+encodeURIComponent(id)+'?s='+encodeURIComponent(season)+'&e='+encodeURIComponent(episode)+'&color=%23e50914';
    if(provider==='superembed')return'https://multiembed.mov/?video_id='+encodeURIComponent(id)+'&tmdb=1&s='+encodeURIComponent(season)+'&e='+encodeURIComponent(episode);
    if(provider==='vidrift')return'https://embed.vidrift.net/embed/tv'+path+'?brand=Orata&brandColor=E50914&showTitle=1';
    if(provider==='vidnest')return'https://vidnest.fun/tv'+path;
    if(provider==='vixsrc')return'https://vixsrc.to/tv'+path+'?primaryColor=E50914';
    return'https://www.vidstuck.cc/embed/tv'+path+'?branding=Orata&color=e50914&overlay=true'
  }
  var box=el('section','wd-player'),head=el('div','wd-player-head'),title=txt('h4','','Now watching: '+titleText),close=txt('button','btn','Close player'),frame=document.createElement('iframe'),options=el('div','wd-provider'),lab=txt('label','','Playback API'),select=document.createElement('select');
  close.type='button';close.addEventListener('click',function(){box.remove()});
  frame.title='VidStuck video player';frame.allow='autoplay *; fullscreen *; encrypted-media; picture-in-picture';frame.allowFullscreen=true;
  providers.forEach(function(p){var o=document.createElement('option');o.value=p[0];o.textContent=p[1];select.appendChild(o)});
  select.value='vidstuck';frame.src=source(select.value);select.setAttribute('aria-label','Playback API');select.id='wprovider';lab.htmlFor=select.id;
  select.addEventListener('change',function(){frame.src=source(select.value);frame.title=select.options[select.selectedIndex].text+' video player'});
  head.appendChild(title);head.appendChild(close);box.appendChild(head);box.appendChild(frame);lab.appendChild(select);options.appendChild(lab);box.appendChild(options);
  var root=wdet.querySelector('.wd');root.insertBefore(box,root.querySelector('.wd-rest'));box.scrollIntoView({behavior:'smooth',block:'start'})}

// Escape closes a show's page first (a second press goes home, as everywhere else on the site)
addEventListener('keydown',function(e){
  if(e.key!=='Escape'||document.body.dataset.page!=='Watch'||W.view!=='show')return;
  if(document.querySelector('.dd.open,.ctx'))return;
  e.preventDefault();e.stopPropagation();closeShow()},true);

// right-click on a show
if(typeof ctxProvide==='function')ctxProvide(function(t){
  var d=t.closest&&t.closest('.wt');if(!d||!d._s)return;
  var s=d._s,on=inLib(s.id);
  return[
    {label:'Open',icon:'fa-solid fa-circle-info',action:function(){openShow(s)}},
    {label:on?'Remove from My list':'Add to My list',icon:on?'fa-solid fa-bookmark':'fa-regular fa-bookmark',action:function(){toggleSave(s)}},
    {label:'Open on TMDB',icon:'fa-solid fa-arrow-up-right-from-square',action:function(){if(typeof openInBrowser==='function')openInBrowser('https://www.themoviedb.org/'+(s.t==='movie'?'movie':'tv')+'/'+s.id)}}]});

// ----- entry point (called when the page is opened) -----
window.openWatch=function(){
  if(!W.started){W.started=true;makeDropdown(ws);makeDropdown(wtype);W.sort=ws.value;skeletons(18);fill()}
  else if(W.view==='grid')requestAnimationFrame(check)};
})();
