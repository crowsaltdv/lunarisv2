// ---------- Manga: browse, search, filter by language and read ----------
// Titles, covers and chapters come from MangaDex, and rankings and scores from MyAnimeList (through Jikan), all through this site's own
// /api/manga/* routes (see manga.js). The page lists titles in the
// chosen language and order, narrows them by genre, searches by title, shows a page per title with its chapters in any language it
// has, and reads a chapter right here: the pictures load straight from MangaDex's servers.
(function(){
var mp=document.getElementById('manga'),mq=document.getElementById('mgq'),mlang=document.getElementById('mgl'),msort=document.getElementById('mgs'),
    mgenre=document.getElementById('mgg'),mcount=document.getElementById('mgcount'),mgrid=document.getElementById('mglist'),
    mnote=document.getElementById('mgnote'),mmore=document.getElementById('mgmore'),mbrowse=document.getElementById('mgbrowse'),
    mdet=document.getElementById('mgdetail'),mread=document.getElementById('mgreader');
if(!mp||!mgrid)return;
var KEY='lunaris-manga',SITE='https://mangadex.org/title/';
// the languages MangaDex has chapters in, most used first (the list in the language menu)
var LANGS=[['en','English'],['es','Spanish'],['es-la','Spanish (Latin America)'],['pt-br','Portuguese (Brazil)'],['pt','Portuguese'],['fr','French'],['de','German'],['it','Italian'],['ru','Russian'],['ja','Japanese'],['ko','Korean'],['zh','Chinese (Simplified)'],['zh-hk','Chinese (Traditional)'],['id','Indonesian'],['vi','Vietnamese'],['tr','Turkish'],['pl','Polish'],['th','Thai'],['ar','Arabic'],['uk','Ukrainian'],['nl','Dutch'],['hu','Hungarian'],['cs','Czech'],['ro','Romanian'],['bg','Bulgarian'],['fil','Filipino'],['he','Hebrew'],['hi','Hindi'],['fa','Persian'],['ms','Malay'],['sv','Swedish'],['fi','Finnish'],['da','Danish'],['no','Norwegian'],['el','Greek'],['ca','Catalan'],['lt','Lithuanian'],['sk','Slovak'],['sr','Serbian'],['bn','Bengali'],['mn','Mongolian'],['my','Burmese'],['ta','Tamil'],['ka','Georgian'],['kk','Kazakh']];
var LNAME={};LANGS.forEach(function(l){LNAME[l[0]]=l[1]});
var ORDERS={readable:1,popular:1,mal_score:1,mal_popular:1,mal_favorite:1,mal_publishing:1,latest:1,new:1,rating:1,az:1,langs:1}; // "langs" puts the titles with the most languages first
var CODE=/^[a-z]{2,3}(-[a-z]{2,4})?$/,UID=/^[0-9a-f-]{36}$/i;
var M={ready:{},showAll:false,hiddenN:0,fills:0,lang:'en',order:'readable',genre:'',saver:false,q:'',items:[],seen:{},drawn:0,page:1,pages:1,total:null,busy:false,seq:0,dseq:0,rseq:0,started:false,view:'grid',scroll:0,tscroll:0};
try{var sv=JSON.parse(localStorage.getItem(KEY)||'null');
  if(sv&&sv.v===2){if(typeof sv.lang==='string'&&(sv.lang===''||CODE.test(sv.lang)))M.lang=sv.lang;
    if(typeof sv.order==='string'&&ORDERS[sv.order])M.order=sv.order;
    if(typeof sv.genre==='string'&&(sv.genre===''||UID.test(sv.genre)))M.genre=sv.genre;
    M.saver=sv.saver===true}}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify({v:2,lang:M.lang,order:M.order,genre:M.genre,saver:M.saver}))}catch(e){}}

// ----- helpers -----
function ico(cls){var i=document.createElement('i');i.className=cls;i.setAttribute('aria-hidden','true');return i}
function txt(tag,cls,s){var e=el(tag,cls);e.textContent=s;return e}
function plural(n,w){return n.toLocaleString()+' '+w+(n===1?'':'s')}
function api(path){
  return fetch('/api/manga/'+path).then(function(r){
    return r.json().catch(function(){return{}}).then(function(j){
      if(!r.ok)throw new Error(j.error||(r.status===404?'Manga isn’t available in the running server yet. Restart the site and try again.':'Request failed ('+r.status+'). Try again in a moment.'));
      return j})
  },function(){throw new Error('Couldn’t reach the server. Check your connection.')})}
var dn=null;
function langName(c){
  if(LNAME[c])return LNAME[c];
  try{if(!dn)dn=new Intl.DisplayNames(['en'],{type:'language'});var n=dn.of(c);if(n&&n!==c)return n}catch(e){}
  return c.toUpperCase()}
// languages in the order of the menu, then any others
function byLang(list){return list.slice().sort(function(a,b){var x=LANGS.findIndex(function(l){return l[0]===a}),y=LANGS.findIndex(function(l){return l[0]===b});return(x<0?999:x)-(y<0?999:y)})}
function pic(url,cls){
  var im=new Image();im.alt='';im.referrerPolicy='no-referrer';im.decoding='async';im.loading='lazy';if(cls)im.className=cls;
  im.addEventListener('error',function(){im.remove()});
  im.src=url;return im}
// links to other sites open in the site's own browser (a middle-click still opens a normal new tab)
function extLink(a,url){
  a.href=url;a.rel='noopener noreferrer';a.target='_blank';
  a.addEventListener('click',function(e){if(e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(typeof openInBrowser==='function')openInBrowser(url);else window.open(url,'_blank','noopener')})}
function linkBtn(label,url,primary){var a=el('a','btn'+(primary?' pri':''));a.appendChild(document.createTextNode(label));a.appendChild(ico('fa-solid fa-arrow-up-right-from-square'));extLink(a,url);return a}
[].forEach.call(mp.querySelectorAll('a[data-ext]'),function(a){extLink(a,a.getAttribute('href'))});
function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):''}
function fmtDate(d){if(!d)return '';var t=new Date(d+'T12:00:00');return isNaN(t)?d:t.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}

// ----- the grid -----
function metaLine(m){return[cap(m.status),m.year].filter(Boolean).join(' · ')}
// the language tags on a cover: the chosen language first, then the common ones
function chipList(m){
  var l=byLang(m.langs);
  if(M.lang&&l.indexOf(M.lang)>0){l.splice(l.indexOf(M.lang),1);l.unshift(M.lang)}
  return l}
function tile(m,i){
  var d=el('div','wt'),cv=el('button','wt-cv'),nm=el('button','wt-n');
  d._m=m;d.style.setProperty('--i',Math.min(i%24,14));
  cv.type=nm.type='button';cv.setAttribute('aria-label',m.title);
  cv.appendChild(txt('span','wt-ph',m.title));
  if(m.cover)cv.appendChild(pic(m.cover));
  if(m.langs.length){
    var lb=el('span','mg-l'),l=chipList(m);
    l.slice(0,4).forEach(function(c){lb.appendChild(txt('b',c===M.lang?'on':'',c.toUpperCase()))});
    if(l.length>4)lb.appendChild(txt('b','','+'+(l.length-4)));
    cv.appendChild(lb)}
  if(m.mal&&m.mal.score){var sc=el('span','wt-r');sc.appendChild(ico('fa-solid fa-star'));sc.appendChild(document.createTextNode(m.mal.score.toFixed(2)));sc.title='MyAnimeList score'+(m.mal.rank?' \u00b7 rank #'+m.mal.rank.toLocaleString():'');cv.appendChild(sc)}
  nm.textContent=m.title;nm.title=m.description?m.title+'\n\n'+m.description:m.title;
  cv.addEventListener('click',function(){openTitle(m)});nm.addEventListener('click',function(){openTitle(m)});
  d.appendChild(cv);d.appendChild(nm);
  var meta=metaLine(m);if(meta)d.appendChild(txt('div','wt-m',meta));
  var r=M.ready[m.id];if(r===0&&!M.showAll)d.hidden=true;else if(r===undefined)d.classList.add('chk');
  return d}
function dropSkeletons(){[].forEach.call(mgrid.querySelectorAll('.wtsk'),function(x){x.remove()})}
function skeletons(n){var f=document.createDocumentFragment();for(var i=0;i<n;i++)f.appendChild(el('div','sk wtsk'));mgrid.appendChild(f)}
function setNote(msg,opts){
  opts=opts||{};mnote.textContent='';mnote.hidden=!msg;mnote.classList.toggle('big',!!opts.big);if(!msg)return;
  mnote.appendChild(txt('span','',msg));
  if(opts.btn){var b=txt('button','btn',opts.btn);b.type='button';b.addEventListener('click',opts.fn);mnote.appendChild(b)}}
function more(){return M.page<M.pages}
// titles MangaDex only links to (no chapters it hosts) are hidden; this brings them back
var mshow=el('button','btn');mshow.type='button';mshow.hidden=true;mmore.parentNode.insertBefore(mshow,mmore);
mshow.addEventListener('click',function(){M.showAll=!M.showAll;settle()});
var noneNote=false;
// marks each title as readable or not, hides the ones that aren't, and keeps loading while the grid is thin
function settle(){
  var hidden=0,shown=0;
  [].forEach.call(mgrid.querySelectorAll('.wt'),function(t){
    var r=M.ready[t._m.id],hide=r===0&&!M.showAll;
    t.classList.toggle('chk',r===undefined);t.hidden=hide;
    if(r===0)hidden++;
    if(!hide)shown++});
  M.hiddenN=hidden;
  mshow.hidden=!hidden;mshow.textContent=(M.showAll?'Hide ':'Show ')+plural(hidden,'title')+' that can\u2019t be read here';
  if(shown===0&&M.items.length&&!more()&&!M.busy){setNote('None of these titles can be read here. Try another search or language.',{big:true});noneNote=true}
  else if(noneNote&&shown>0){setNote('');noneNote=false}
  if(shown<18&&more()&&!M.busy&&M.fills<8){M.fills++;load(false)}}
// asks which of the new titles can be read, a few at a time
function vet(items){
  if(M.order==='readable'&&!M.q){items.forEach(function(m){M.ready[m.id]=1});settle();return}
  var todo=items.filter(function(m){return M.ready[m.id]===undefined}).map(function(m){return m.id}),k=0,seq=M.seq;
  if(!todo.length){settle();return}
  settle();
  (function next(){
    if(seq!==M.seq)return;
    var ids=todo.slice(k,k+8);k+=8;
    if(!ids.length)return;
    api('readable?lang='+encodeURIComponent(M.lang)+'&ids='+ids.join(',')).then(function(j){
      if(seq!==M.seq)return;
      // a title that wasn't answered for is shown, not hidden
      ids.forEach(function(id){M.ready[id]=j.ready&&typeof j.ready[id]==='number'?(j.ready[id]>0?1:0):1});
      settle();next()
    }).catch(function(){
      if(seq!==M.seq)return;
      ids.forEach(function(id){M.ready[id]=1});settle();next()})})()}
// what is on screen: the loaded titles, with the most-languages order applied here (MangaDex can't sort by it)
function visible(){return M.order==='langs'&&!M.q?M.items.slice().sort(function(a,b){return b.langs.length-a.langs.length}):M.items}
function render(){
  dropSkeletons();
  var list=visible(),f=document.createDocumentFragment(),from=M.drawn;
  if(M.order==='langs'||M.drawn>list.length){mgrid.textContent='';from=0}
  for(var i=from;i<list.length;i++)f.appendChild(tile(list[i],i));
  mgrid.appendChild(f);M.drawn=list.length;
  mcount.textContent=!M.items.length?'':M.total?plural(M.total,M.q?'result':'title')+(M.lang?' in '+langName(M.lang):''):plural(M.items.length,'title')+(more()?'+':'')+(M.lang?' in '+langName(M.lang):'');
  if(!M.items.length&&!M.busy)setNote(M.q?'No manga found for “'+M.q+'”'+(M.lang?' in '+langName(M.lang):'')+'. Try another spelling or language.':'No manga to show here right now.',{big:true,btn:M.lang?'Show all languages':'',fn:function(){setLang('')}});
  else setNote('');
  mmore.hidden=!more()||!M.items.length;mmore.disabled=M.busy;
  mmore.textContent=M.busy&&M.items.length?'Loading…':'Load more'}

// ----- loading -----
function load(reset){
  if(M.busy)return;
  var seq=M.seq,page=reset?1:M.page+1;
  M.busy=true;setNote('');
  if(!M.items.length){dropSkeletons();skeletons(18)}else render();
  var path='list?page='+page+'&lang='+encodeURIComponent(M.lang)+'&genre='+encodeURIComponent(M.genre)+'&order='+(M.order==='langs'?'popular':M.order)+(M.q?'&q='+encodeURIComponent(M.q):'');
  api(path).then(function(j){
    if(seq!==M.seq)return;
    M.busy=false;
    var fresh=(j.items||[]).filter(function(m){return!M.seen[m.id]});
    fresh.forEach(function(m){M.seen[m.id]=1;M.items.push(m)});
    M.page=page;M.pages=j.pages||1;M.total=typeof j.total==='number'?j.total:null;
    render();
    vet(fresh)
  }).catch(function(e){
    if(seq!==M.seq)return;
    M.busy=false;dropSkeletons();render();
    setNote(e.message,{big:!M.items.length,btn:'Try again',fn:function(){load(!M.items.length)}})})}
function restart(){
  M.ready={};M.showAll=false;M.hiddenN=0;mshow.hidden=true;noneNote=false;M.fills=0;M.seq++;M.items=[];M.seen={};M.drawn=0;M.page=1;M.pages=1;M.total=null;M.busy=false;mgrid.textContent='';setNote('');mcount.textContent='';mmore.hidden=true;
  if(M.view==='read')closeReader(true);
  if(M.view==='title')closeTitle(true);
  mp.scrollTop=0;load(true)}

// ----- the controls -----
function rebuild(sel,opts,value){
  var wrap=sel.parentNode;
  if(wrap&&wrap.classList.contains('dd')){wrap.parentNode.insertBefore(sel,wrap);wrap.remove();sel.classList.remove('dd-native');sel.removeAttribute('aria-hidden');sel.tabIndex=0}
  sel.textContent='';
  opts.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];sel.appendChild(op)});
  sel.value=value;
  if(typeof makeDropdown==='function')makeDropdown(sel)}
function setLang(c){M.lang=c;mlang.value=c;if(mlang._ddSync)mlang._ddSync();save();restart()}
var sbTimer=0;
mq.addEventListener('input',function(){clearTimeout(sbTimer);sbTimer=setTimeout(function(){setQuery(mq.value.trim())},350)});
mq.addEventListener('keydown',function(e){if(e.key==='Enter'){clearTimeout(sbTimer);setQuery(mq.value.trim())}});
function setQuery(q){if(q===M.q)return;M.q=q;mp.classList.toggle('searching',!!q);restart()}
mlang.addEventListener('change',function(){M.lang=mlang.value;save();restart()});
msort.addEventListener('change',function(){M.order=ORDERS[msort.value]?msort.value:'popular';save();if(M.order==='langs'&&!M.q)render();else restart()});
mgenre.addEventListener('change',function(){M.genre=mgenre.value;save();restart()});
mmore.addEventListener('click',function(){if(more())load(false)});
// keeps loading more when the end of the grid is reached (the button is there too, for anyone who prefers it)
mp.addEventListener('scroll',function(){
  if(M.view!=='grid'||M.busy||!more()||mmore.hidden)return;
  if(mmore.getBoundingClientRect().top<mp.getBoundingClientRect().bottom+400)load(false)},{passive:true});

// ----- a title's page -----
function factChip(label,icon,cls){var f=el('span','wd-fact'+(cls?' '+cls:''));if(icon)f.appendChild(ico(icon));f.appendChild(document.createTextNode(label));return f}
function skLine(w,h,mt){var s=el('div','sk');s.style.cssText='height:'+h+'px;width:'+w+';margin-top:'+mt+'px;border-radius:12px';return s}
function shell(m){
  mdet.textContent='';
  var root=el('div','wd'),back=el('button','back wd-back'),hero=el('div','wd-hero'),pos=el('div','wd-poster'),info=el('div','wd-info'),
      facts=el('div','wd-facts'),genres=el('div','wd-genres'),sum=el('div'),acts=el('div','wd-links'),rest=el('div','wd-rest');
  back.type='button';back.appendChild(ico('fa-solid fa-chevron-left'));back.appendChild(document.createTextNode('All manga'));
  back.addEventListener('click',function(){closeTitle()});
  if(m.cover)pos.appendChild(pic(m.cover));
  if(m.status)facts.appendChild(factChip(cap(m.status),'fa-solid fa-circle-info',m.status==='ongoing'?'live':''));
  if(m.year)facts.appendChild(factChip(String(m.year),'fa-regular fa-calendar'));
  m.tags.forEach(function(g){genres.appendChild(txt('span','wd-genre',g))});
  if(m.description)sum.appendChild(txt('p','wd-sum',m.description));
  else{sum.appendChild(skLine('min(520px,100%)',18,10));sum.appendChild(skLine('min(440px,90%)',18,8))}
  acts.appendChild(linkBtn('On MangaDex',SITE+m.id,false));
  info.appendChild(txt('h3','wd-title',m.title));info.appendChild(facts);info.appendChild(genres);info.appendChild(sum);info.appendChild(acts);
  hero.appendChild(pos);hero.appendChild(info);
  var sk=el('div','sk');sk.style.cssText='height:220px;margin-top:40px;border-radius:20px';rest.appendChild(sk);
  root.appendChild(back);root.appendChild(hero);root.appendChild(rest);mdet.appendChild(root);
  back.focus({preventScroll:true});
  return{root:root,info:info,pos:pos,facts:facts,genres:genres,sum:sum,acts:acts,rest:rest,m:m,cseq:0,read:[]}}
function fillDetail(p,d){
  var m=p.m,t=p.info.querySelector('.wd-title');
  if(d.altTitle)t.parentNode.insertBefore(txt('div','wd-tag',d.altTitle),p.facts);
  p.facts.textContent='';
  if(d.authors.length)p.facts.appendChild(factChip(d.authors.join(', '),'fa-solid fa-pen-nib'));
  if(d.status)p.facts.appendChild(factChip(cap(d.status),'fa-solid fa-circle-info',d.status==='ongoing'?'live':''));
  if(d.year)p.facts.appendChild(factChip(String(d.year),'fa-regular fa-calendar'));
  if(d.originalLanguage)p.facts.appendChild(factChip('Original: '+langName(d.originalLanguage),'fa-solid fa-language'));
  if(d.langs.length)p.facts.appendChild(factChip(plural(d.langs.length,'language'),'fa-solid fa-globe'));
  if(d.tags.length){p.genres.textContent='';d.tags.forEach(function(g){p.genres.appendChild(txt('span','wd-genre',g))})}
  p.sum.textContent='';
  if(d.description||m.description)p.sum.appendChild(txt('p','wd-sum',d.description||m.description));
  if(d.cover&&p.pos){p.pos.textContent='';p.pos.appendChild(pic(d.cover))}
  p.rest.textContent='';
  p.d=d;
  // MyAnimeList's score, rank and details arrive a moment later (and are simply left out if Jikan isn't answering)
  if(d.mal)api('mal/'+encodeURIComponent(d.mal)).then(function(j){if(p.d===d&&M.view!=='grid')addMal(p,j)}).catch(function(){});
  if(!d.langs.length){p.rest.appendChild(txt('p','wd-none','This title has no chapters here yet.'));return}
  // the chapters are in one language at a time: the chosen one if the title has it, otherwise English, otherwise the first
  var langs=byLang(d.langs),pick=d.langs.indexOf(M.lang)>=0?M.lang:d.langs.indexOf('en')>=0?'en':langs[0];
  var head=el('div','wd-eph'),sel=document.createElement('select'),chs=el('div');
  head.appendChild(txt('h4','','Chapters'));
  var lab=el('div','mg-lang');lab.appendChild(txt('span','','Language'));lab.appendChild(sel);head.appendChild(lab);
  langs.forEach(function(c){var o=document.createElement('option');o.value=c;o.textContent=langName(c);sel.appendChild(o)});
  sel.value=pick;sel.setAttribute('aria-label','Chapter language');
  if(typeof makeDropdown==='function')makeDropdown(sel);
  p.sel=sel;
  // a language picked by hand is shown as it is; the first one is looked for (see loadChapters)
  sel.addEventListener('change',function(){loadChapters(p,chs,sel.value,null)});
  p.rest.appendChild(head);p.rest.appendChild(chs);
  p.rest.appendChild(txt('p','wcredit','Manga, covers and chapters from MangaDex. Chapters are uploaded by the groups named beside them.'));
  loadChapters(p,chs,pick,[pick])}
// Only chapters MangaDex itself hosts can be read here. When the first language has none, the title's other languages are tried
// one after another (at most 8) and the first with readable chapters is shown.
function addMal(p,j){
  var row=el('div','wd-facts mg-mal');
  if(j.score)row.appendChild(factChip(j.score.toFixed(2)+' on MyAnimeList'+(j.scoredBy?' ('+j.scoredBy.toLocaleString()+' votes)':''),'fa-solid fa-star'));
  if(j.rank)row.appendChild(factChip('Rank #'+j.rank.toLocaleString(),'fa-solid fa-ranking-star'));
  if(j.popularity)row.appendChild(factChip('Popularity #'+j.popularity.toLocaleString(),'fa-solid fa-fire'));
  if(j.members)row.appendChild(factChip(j.members.toLocaleString()+' members','fa-solid fa-users'));
  var counts=[j.volumes?plural(j.volumes,'volume'):'',j.chapters?plural(j.chapters,'chapter'):''].filter(Boolean).join(', ');
  if(counts)row.appendChild(factChip(counts,'fa-solid fa-layer-group'));
  if(j.published)row.appendChild(factChip('Published '+j.published,'fa-regular fa-calendar'));
  if(j.serializations.length)row.appendChild(factChip('Serialized in '+j.serializations.join(', '),'fa-solid fa-newspaper'));
  if(row.childNodes.length)p.facts.parentNode.insertBefore(row,p.facts.nextSibling);
  // MangaDex's description is the one shown; MyAnimeList's fills in when MangaDex has none
  if(!p.d.description&&!p.m.description&&j.synopsis){p.sum.textContent='';p.sum.appendChild(txt('p','wd-sum',j.synopsis))}}
function loadChapters(p,box,lang,tried){
  var seq=++p.cseq;
  box.textContent='';var sk=el('div','sk');sk.style.cssText='height:200px;border-radius:16px';box.appendChild(sk);
  api('chapters/'+encodeURIComponent(p.m.id)+'?lang='+encodeURIComponent(lang)).then(function(j){
    if(seq!==p.cseq||M.view==='grid')return;
    var list=j.chapters||[];
    if(!list.length&&tried){
      var rest=byLang(p.d.langs).filter(function(c){return tried.indexOf(c)<0});
      if(rest.length&&tried.length<8){
        var next=rest[0];tried.push(next);
        if(p.sel){p.sel.value=next;if(p.sel._ddSync)p.sel._ddSync()}
        loadChapters(p,box,next,tried);return}}
    box.textContent='';
    box.appendChild(chapterList(p,list,lang,j.elsewhere||0,tried&&tried.length>1&&list.length?tried[0]:'',!!(tried&&tried.length>1&&!list.length),!!j.truncated))
  }).catch(function(e){
    if(seq!==p.cseq)return;
    box.textContent='';var n=el('div','wnote');n.appendChild(txt('span','',e.message));var b=txt('button','btn','Try again');b.type='button';
    b.addEventListener('click',function(){loadChapters(p,box,lang,tried)});n.appendChild(b);box.appendChild(n)})}
function chLabel(c){return(c.chapter?'Ch. '+c.chapter:'Oneshot')+(c.title?' — '+c.title:'')}
function chMeta(c){return[c.volume?'Vol. '+c.volume:'',c.group,fmtDate(c.date),c.pages?plural(c.pages,'page'):''].filter(Boolean).join(' · ')}
// the chapters, newest first (or oldest first): the first batch shows at once, the rest on request. Every one opens in the reader.
function chapterList(p,chs,lang,elsewhere,from,scanned,truncated){
  var box=el('div'),list=el('div','mg-volumes'),oldest=false,openVolumes={};
  p.acts.textContent='';
  p.acts.appendChild(linkBtn('On MangaDex',SITE+p.m.id,false));
  if(!chs.length){
    box.appendChild(txt('p','wd-none',scanned
      ?'None of this title’s chapters can be read here. Its official releases are hosted on the publisher’s own site, and MangaDex only links to them.'
      :elsewhere?(elsewhere===1?'The 1 chapter in '+langName(lang)+' can’t be read here: it is an official release hosted on the publisher’s own site.':'The '+plural(elsewhere,'chapter')+' in '+langName(lang)+' can’t be read here: they are official releases hosted on the publisher’s own site.')
      :'No chapters in '+langName(lang)+' yet.'));
    return box}
  var collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  function cmp(a,b){if(!a)return b?1:0;if(!b)return-1;return collator.compare(a,b)}
  var ordered=chs.slice().sort(function(a,b){return cmp(a.volume,b.volume)||cmp(a.chapter,b.chapter)||cmp(a.date,b.date)});
  var ctx={d:p.d,lang:lang,read:ordered};
  // the reading buttons
  var first=ordered[0],last=ordered[ordered.length-1];
  function go(i,primary,label){
    var b=el('button','btn'+(primary?' pri':''));b.type='button';b.appendChild(ico('fa-solid fa-book-open'));b.appendChild(document.createTextNode(label));
    b.addEventListener('click',function(){openReader(ctx,i)});p.acts.insertBefore(b,p.acts.firstChild)}
  if(last!==first)go(chs.length-1,false,'Latest chapter');
  go(0,true,'Read first chapter');
  var flip=txt('button','btn','Newest first');
  flip.type='button';flip.style.marginBottom='12px';
  function draw(){
    list.textContent='';
    [].forEach.call(list.querySelectorAll('details[data-volume]'),function(d){openVolumes[d.dataset.volume]=d.open});
    var rows=ordered.map(function(c,i){return{c:c,i:i}});
    if(!oldest)rows.reverse();
    var groups=[];rows.forEach(function(r){var key=r.c.volume||'__unassigned__',g=groups[groups.length-1];if(!g||g.key!==key){g={key:key,volume:r.c.volume,rows:[]};groups.push(g)}g.rows.push(r)});
    groups.forEach(function(g,gi){
      var section=document.createElement('details');section.className='mg-volume';section.dataset.volume=g.key;
      section.open=Object.prototype.hasOwnProperty.call(openVolumes,g.key)?openVolumes[g.key]:gi===0;
      var title=g.volume?'Volume '+g.volume:'Volume not listed';
      var summary=el('summary','mg-volume-head');summary.appendChild(txt('b','',title));summary.appendChild(txt('span','',plural(g.rows.length,'chapter')));
      var body=el('div','mg-chs');section.appendChild(summary);section.appendChild(body);
      function fill(){if(body.dataset.ready)return;body.dataset.ready='1';g.rows.forEach(function(r){
        var a=el('button','mg-ch');a.type='button';a.appendChild(txt('b','',chLabel(r.c)));
        var meta=chMeta(r.c);if(meta)a.appendChild(txt('small','',meta));
        a.appendChild(ico('fa-solid fa-book-open'));a.addEventListener('click',function(){openReader(ctx,r.i)});body.appendChild(a)})}
      section.addEventListener('toggle',function(){if(section.open){openVolumes[g.key]=true;fill()}else openVolumes[g.key]=false});
      list.appendChild(section);if(section.open)fill()
    })
  }
  flip.addEventListener('click',function(){oldest=!oldest;flip.textContent=oldest?'Newest first':'Oldest first';draw()});
  var note=plural(chs.length,'chapter')+' in '+langName(lang);
  if(from)note='No chapters in '+langName(from)+' can be read here, so these are in '+langName(lang)+'. '+note;
  if(elsewhere)note+=' · '+(elsewhere===1?'1 more chapter is an official release on the publisher’s site':plural(elsewhere,'more chapter')+' are official releases on the publisher’s site');
  if(truncated)note+=' · MangaDex caps one feed at 10,000 records; some older records may not be listed.';
  var count=txt('p','wd-none',note);count.style.margin='0 0 10px';
  box.appendChild(count);box.appendChild(flip);box.appendChild(list);draw();return box}
function openTitle(m){
  if(M.view==='grid')M.scroll=mp.scrollTop;
  M.view='title';mp.classList.add('in-title');mbrowse.hidden=true;mdet.hidden=false;mp.scrollTop=0;
  var seq=++M.dseq,parts=shell(m);
  api('title/'+encodeURIComponent(m.id)).then(function(d){if(seq===M.dseq&&M.view!=='grid')fillDetail(parts,d)})
    .catch(function(e){
      if(seq!==M.dseq)return;
      parts.sum.querySelectorAll('.sk').forEach(function(s){s.remove()});parts.rest.textContent='';
      var n=el('div','wnote');n.appendChild(txt('span','',e.message));var b=txt('button','btn','Try again');b.type='button';
      b.addEventListener('click',function(){openTitle(m)});n.appendChild(b);parts.rest.appendChild(n)})}
function closeTitle(quiet){
  if(M.view==='read')closeReader(true);
  M.view='grid';M.dseq++;mp.classList.remove('in-title');mdet.hidden=true;mdet.textContent='';mbrowse.hidden=false;
  if(!quiet)mp.scrollTop=M.scroll}

// ----- the reader -----
// Each picture is fetched by this page straight from MangaDex@Home when it nears the screen, which also tells how big it was and
// how long it took: those results go to MangaDex (through this site, see manga.js) as MangaDex asks readers to do.
function openReader(ctx,idx){
  if(idx<0||!ctx.read[idx])return;
  if(M.rd)M.rd.cleanup();
  if(M.view==='title')M.tscroll=mp.scrollTop;
  M.view='read';mp.classList.add('in-reader');mdet.hidden=true;mread.hidden=false;mp.scrollTop=0;
  var c=ctx.read[idx],seq=++M.rseq;
  mread.textContent='';
  var bar=el('div','mgr-bar'),back=el('button','back'),name=el('div','mgr-t'),nav=el('div','mgr-nav'),prev=el('button','btn'),next=el('button','btn'),saver=el('button','btn'+(M.saver?' pri':'')),pages=el('div','mgr-pages'),end=el('div','mgr-end');
  back.type=prev.type=next.type=saver.type='button';
  back.appendChild(ico('fa-solid fa-chevron-left'));back.appendChild(document.createTextNode('Chapters'));
  name.appendChild(txt('b','',ctx.d.title));name.appendChild(txt('small','',chLabel(c)+(c.group?' · '+c.group:'')));
  prev.appendChild(ico('fa-solid fa-chevron-left'));prev.appendChild(document.createTextNode('Previous'));prev.disabled=idx<=0;
  next.appendChild(document.createTextNode('Next'));next.appendChild(ico('fa-solid fa-chevron-right'));next.disabled=idx>=ctx.read.length-1;
  saver.appendChild(ico('fa-solid fa-gauge-high'));saver.appendChild(document.createTextNode('Data saver'));saver.setAttribute('aria-pressed',String(M.saver));saver.title='Smaller pictures that load faster';
  nav.appendChild(prev);nav.appendChild(next);nav.appendChild(saver);
  bar.appendChild(back);bar.appendChild(name);bar.appendChild(nav);
  var prev2=prev.cloneNode(true),next2=next.cloneNode(true);end.appendChild(prev2);end.appendChild(next2);
  mread.appendChild(bar);mread.appendChild(pages);mread.appendChild(end);
  function step(d){openReader(ctx,idx+d)}
  back.addEventListener('click',function(){closeReader()});
  [prev,prev2].forEach(function(b){b.addEventListener('click',function(){step(-1)})});
  [next,next2].forEach(function(b){b.addEventListener('click',function(){step(1)})});

  var hi=[],lo=[],pg=[],io=null,queue=[],qt=0;
  function src(i){return(M.saver&&lo[i])?lo[i]:(hi[i]||lo[i])}
  // the results of loading pictures, sent on in small batches
  function flush(){
    clearTimeout(qt);qt=0;if(!queue.length)return;
    var body=JSON.stringify({reports:queue.splice(0,40)});
    try{fetch('/api/manga/report',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){})}catch(e){}}
  function note(url,ok,bytes,ms){queue.push({url:url,success:ok,bytes:bytes,duration:Math.round(ms)});if(queue.length>=20)flush();else if(!qt)qt=setTimeout(flush,4000)}
  function loadPage(i,other){
    var s=pg[i];if(!s||s.busy||(s.done&&!other))return;
    s.busy=true;
    var url=other?(M.saver?hi[i]:lo[i])||src(i):src(i),t0=performance.now();
    fetch(url,{referrerPolicy:'no-referrer'}).then(function(r){if(!r.ok)throw new Error('status '+r.status);return r.blob()}).then(function(b){
      if(seq!==M.rseq)return;
      var u=URL.createObjectURL(b);if(s.url)URL.revokeObjectURL(s.url);s.url=u;
      s.im.classList.remove('bad');s.im.src=u;s.done=true;s.busy=false;note(url,true,b.size,performance.now()-t0)
    }).catch(function(){
      if(seq!==M.rseq)return;
      s.busy=false;note(url,false,0,performance.now()-t0);
      // tried once in the other quality, then offered again on a click
      if(!other&&lo[i]&&hi[i]&&(M.saver?hi[i]:lo[i])!==url){loadPage(i,true);return}
      s.done=false;s.im.classList.add('bad');s.im.alt='Page '+(i+1)+' didn’t load. Click to try again.';
      s.im.onclick=function(){s.im.onclick=null;s.im.classList.remove('bad');loadPage(i)}})}
  function cleanup(){
    M.rseq++;flush();if(io)io.disconnect();
    pg.forEach(function(s){if(s.url)URL.revokeObjectURL(s.url)});pg=[];M.rd=null}
  M.rd={ctx:ctx,idx:idx,step:step,cleanup:cleanup};
  saver.addEventListener('click',function(){
    M.saver=!M.saver;save();saver.classList.toggle('pri',M.saver);saver.setAttribute('aria-pressed',String(M.saver));
    // pictures already asked for come again in the new quality; the rest will use it when they are reached
    pg.forEach(function(s,i){if(s.done||s.busy){s.busy=false;s.done=false;loadPage(i)}})});

  var sk=el('div','sk');sk.style.cssText='height:70vh;width:min(900px,100%);margin:0 auto;border-radius:12px';pages.appendChild(sk);
  api('read/'+encodeURIComponent(c.id)).then(function(j){
    if(seq!==M.rseq||M.view!=='read')return;
    pages.textContent='';
    hi=j.images||[];lo=j.saver||[];
    var n=Math.max(hi.length,lo.length);
    if(!n){pages.appendChild(txt('p','wd-none','This chapter has no pages.'));return}
    if('IntersectionObserver' in window)io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){io.unobserve(e.target);loadPage(e.target._i)}})},{root:mp,rootMargin:'1600px 0px'});
    for(var i=0;i<n;i++){
      var im=new Image();im.alt='Page '+(i+1);im.decoding='async';im.className='mgr-p';im._i=i;
      im.addEventListener('load',function(){this.classList.add('ok')});
      pg.push({im:im,busy:false,done:false,url:null});pages.appendChild(im);
      if(io)io.observe(im);else loadPage(i)}
  }).catch(function(e){
    if(seq!==M.rseq)return;
    pages.textContent='';var n=el('div','wnote');n.appendChild(txt('span','',e.message));var b=txt('button','btn','Try again');b.type='button';
    b.addEventListener('click',function(){openReader(ctx,idx)});n.appendChild(b);pages.appendChild(n)})}
function closeReader(quiet){
  if(M.rd)M.rd.cleanup();
  M.rseq++;M.view='title';mp.classList.remove('in-reader');mread.hidden=true;mread.textContent='';mdet.hidden=false;
  if(!quiet)mp.scrollTop=M.tscroll}
addEventListener('pagehide',function(){if(M.rd)M.rd.cleanup()});

// the arrow keys turn chapters while one is open; Escape steps back one level (and a last press goes home, as everywhere else on the site)
addEventListener('keydown',function(e){
  if(document.body.dataset.page!=='Manga'||M.view==='grid')return;
  if(document.querySelector('.dd.open,.ctx'))return;
  var t=e.target&&e.target.tagName;if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(M.view==='read')closeReader();else closeTitle()}
  else if(M.view==='read'&&M.rd&&(e.key==='ArrowRight'||e.key==='ArrowLeft')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    var d=e.key==='ArrowRight'?1:-1,i=M.rd.idx+d;
    if(i>=0&&i<M.rd.ctx.read.length){e.preventDefault();M.rd.step(d)}}},true);

// right-click on a title
if(typeof ctxProvide==='function')ctxProvide(function(t){
  var d=t.closest&&t.closest('#manga .wt');if(!d||!d._m)return;
  var m=d._m;
  return[
    {label:'Open',icon:'fa-solid fa-circle-info',action:function(){openTitle(m)}},
    {label:'Open on MangaDex',icon:'fa-solid fa-arrow-up-right-from-square',action:function(){if(typeof openInBrowser==='function')openInBrowser(SITE+m.id)}}]});

// ----- entry point (called when the page is opened) -----
window.openManga=function(){
  if(M.started)return;
  M.started=true;
  rebuild(mlang,[['','All languages']].concat(LANGS),M.lang);
  msort.value=M.order;makeDropdown(msort);
  rebuild(mgenre,[['','All genres']],M.genre);
  // the genres come from MangaDex; until they arrive the list holds just "All genres"
  api('tags').then(function(j){
    var tags=(j.tags||[]).map(function(t){return[t.id,t.name]});
    if(!tags.some(function(t){return t[0]===M.genre}))M.genre='';
    rebuild(mgenre,[['','All genres']].concat(tags),M.genre)}).catch(function(){});
  load(true)};
})();
