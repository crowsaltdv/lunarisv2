// =====================================================================
// Lunaris v2: music
// The catalog (songs, charts, search, albums, playlists, artists, radio) comes from ytmusicapi
// (see ../../music.js and ../../ytmusic/service.py). A song plays by its videoId in a hidden player: there is no video on the page.
// =====================================================================
(function(){
var MU={view:'home',detail:null,stack:[],feed:null,feedErr:null,feedBusy:false,lib:{liked:[],pls:[],vol:.8,shuf:false,rep:'off'},orig:null,cur:null,queue:[],qi:-1,started:false,sq:'',stm:0,seeking:false,errs:0,auto:true,cache:{},playing:false,radioBusy:false,io:null};
function isYT(t){return t&&typeof t.id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(t.id)}
try{var _m=JSON.parse(localStorage.getItem('orata-music'));
  if(_m){
    // songs saved before the move to the new catalog can't be played any more, so only playable songs are kept
    MU.lib.liked=Array.isArray(_m.liked)?_m.liked.filter(isYT).slice(0,500):[];
    MU.lib.pls=Array.isArray(_m.pls)?_m.pls.filter(function(p){return p&&typeof p.name==='string'&&Array.isArray(p.tracks)}).map(function(p){return{id:String(p.id||('p'+Date.now().toString(36))),name:p.name.slice(0,40),tracks:p.tracks.filter(isYT)}}).slice(0,50):[];
    if(typeof _m.vol==='number')MU.lib.vol=Math.min(1,Math.max(0,_m.vol));
    MU.lib.shuf=_m.shuf===true;MU.lib.rep=['off','all','one'].indexOf(_m.rep)>=0?_m.rep:'off'}}catch(e){}
function saveLib(){try{localStorage.setItem('orata-music',JSON.stringify(MU.lib))}catch(e){}}

var mus=document.getElementById('mus'),mbody=document.getElementById('mbody'),mq=document.getElementById('mq'),engine=document.getElementById('ytbox'),
    mbPlay=document.getElementById('mbPlay'),mbSeek=document.getElementById('mbSeek'),mbCur=document.getElementById('mbCur'),mbDur=document.getElementById('mbDur'),mbVol=document.getElementById('mbVol'),
    mbLike=document.getElementById('mbLike'),mbShuf=document.getElementById('mbShuf'),mbRep=document.getElementById('mbRep'),mbQ=document.getElementById('mbQ'),mqlist=document.getElementById('mqlist'),mdlg=document.getElementById('mdlg'),mdname=document.getElementById('mdname'),mbArtist=document.getElementById('mbArtist');
mbVol.value=Math.round(MU.lib.vol*100);setFill(mbVol);

function setFill(r){r.style.setProperty('--p',(r.value/(r.max||100)*100)+'%')}
function mapi(path){
  return fetch('/api/music/'+path).then(function(r){
    return r.json().catch(function(){return{}}).then(function(j){
      if(!r.ok)throw new Error(r.status===404?'Music server not found. Start Lunaris v2 with "npm start" and open http://localhost:3030.':(j.error||'Music error ('+r.status+')'));return j})
  },function(){throw new Error('Music server not reachable. Start Lunaris v2 with "npm start" and open http://localhost:3030.')})}
function fmtT(s){s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+':'+('0'+s%60).slice(-2)}
function ico(cls){var i=document.createElement('i');i.className=cls;i.setAttribute('aria-hidden','true');return i}
function artImg(box,url,fb){box.textContent='';if(url){var im=new Image();im.alt='';im.loading='lazy';im.referrerPolicy='no-referrer';im.src=url;im.onerror=function(){box.textContent='';box.appendChild(ico(fb||'fa-solid fa-music'))};box.appendChild(im)}else box.appendChild(ico(fb||'fa-solid fa-music'))}
function isLiked(t){return MU.lib.liked.some(function(x){return x.id===t.id})}
function slim(t){return{t:'s',id:t.id,n:t.n,a:t.a,ai:t.ai,ar:t.ar,al:t.al,c:t.c,i:t.i,d:t.d,e:t.e}}
function toggleLike(t){
  if(isLiked(t))MU.lib.liked=MU.lib.liked.filter(function(x){return x.id!==t.id});else MU.lib.liked.unshift(slim(t));
  saveLib();refreshLikes();if(MU.detail&&MU.detail.type==='liked')render()}
function refreshLikes(){
  [].forEach.call(document.querySelectorAll('#music [data-lid]'),function(b){var on=MU.lib.liked.some(function(x){return x.id===b.dataset.lid});b.classList.toggle('liked',on);b.firstChild.className=(on?'fa-solid':'fa-regular')+' fa-heart'});
  var on=!!(MU.cur&&isLiked(MU.cur));mbLike.classList.toggle('liked',on);mbLike.firstChild.className=(on?'fa-solid':'fa-regular')+' fa-heart'}
function refreshPlaying(){
  [].forEach.call(mbody.querySelectorAll('[data-tid]'),function(n){n.classList.toggle('on',!!MU.cur&&MU.cur.id===n.dataset.tid)})}
function note(parent,text,retry){var n=el('div','mnote');n.textContent=text;if(retry){var b=el('button','btn');b.type='button';b.textContent='Try again';b.addEventListener('click',retry);n.appendChild(document.createElement('br'));n.appendChild(b)}parent.appendChild(n)}
function skeletonGrid(n){var g=el('div','sgrid');for(var i=0;i<n;i++)g.appendChild(el('div','sk sktile'));return g}
function skeletonRows(n){var w=el('div','skrows');w.appendChild(el('div','sk sktitle'));for(var i=0;i<n;i++)w.appendChild(el('div','sk skrow1'));return w}

// ---------- artists: every name links to a page inside Lunaris v2 ----------
function artistsOf(t){
  if(t.ar&&t.ar.length)return t.ar;
  return t.ai&&t.a?[{n:t.a,id:t.ai}]:[];}
function artistLink(name,id){
  var a=el('a','alink');a.href='#';a.textContent=name;a.title='View '+name;
  a.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openArtist(id,name)});return a}
function artistSpan(t){
  var s=el('span','alinks'),ar=artistsOf(t);
  if(!ar.length){s.textContent=t.a||'';return s}
  ar.forEach(function(a,i){if(i)s.appendChild(document.createTextNode(', '));if(a.id)s.appendChild(artistLink(a.n,a.id));else s.appendChild(document.createTextNode(a.n))});
  return s}
function openArtist(id,name){
  if(!id)return;
  if(MU.detail&&MU.detail.type==='artist'&&MU.detail.id===id)return;
  if(typeof show==='function'&&document.body.dataset.page!=='Music')show('Music');
  openDetail('artist',id,name)}

// ---------- cards, rows and sections ----------
var FB={s:'fa-solid fa-music',a:'fa-solid fa-compact-disc',p:'fa-solid fa-list-ul',r:'fa-solid fa-user'};
function playRemote(kind,id){
  mapi((kind==='a'?'album?id=':'playlist?id=')+encodeURIComponent(id)).then(function(j){MU.cache[(kind==='a'?'album':'yplaylist')+':'+id]=j;if(j.tracks&&j.tracks.length)playList(j.tracks,0)}).catch(function(){})}
function openItem(it){openDetail(it.t==='a'?'album':it.t==='p'?'yplaylist':'artist',it.id,it.n)}
function cardEl(it,list){
  var k=it.t,b=el('button','mcard'+(k==='r'?' r':'')),art=el('div','art'),n=el('b'),a=el('small');
  b.type='button';artImg(art,it.i,FB[k]);
  if(k!=='r'){var pb=el('span','plb');pb.appendChild(ico('fa-solid fa-play'));art.appendChild(pb);
    if(k!=='s')pb.addEventListener('click',function(e){e.stopPropagation();playRemote(k,it.id)})}
  n.textContent=it.n;a.textContent=k==='a'&&it.y?it.a+' · '+it.y:it.a||'';
  b.appendChild(art);b.appendChild(n);b.appendChild(a);
  if(k==='s'){b._t=it;b.dataset.tid=it.id;b._play=function(){playList(list,list.indexOf(it))};if(MU.cur&&MU.cur.id===it.id)b.classList.add('on');b.addEventListener('click',b._play)}
  else{b._it=it;b.addEventListener('click',function(){openItem(it)})}
  return b}
function folderCard(title,sub,imgUrl,fb,onclick){
  var b=el('button','mcard'),art=el('div','art'),n=el('b'),a=el('small');b.type='button';artImg(art,imgUrl,fb);
  if(!imgUrl){art.style.background='linear-gradient(135deg,rgba(var(--ac),.85),rgba(var(--mid),.5))';art.style.display='grid';art.style.placeItems='center';art.style.fontSize='46px';art.style.color='rgb(var(--onac))'}
  n.textContent=title;a.textContent=sub;b.appendChild(art);b.appendChild(n);b.appendChild(a);b.addEventListener('click',onclick);return b}
function section(title,row,arrows){
  var s=el('section','msec'),h=el('div','msh'),tt=el('span');tt.textContent=title;h.appendChild(tt);
  if(arrows){var ar=el('div','arr'),l=el('button'),r=el('button');l.type=r.type='button';l.setAttribute('aria-label','Scroll left');r.setAttribute('aria-label','Scroll right');l.appendChild(ico('fa-solid fa-chevron-left'));r.appendChild(ico('fa-solid fa-chevron-right'));
    l.addEventListener('click',function(){row.scrollBy({left:-row.clientWidth*.85,behavior:'smooth'})});r.addEventListener('click',function(){row.scrollBy({left:row.clientWidth*.85,behavior:'smooth'})});ar.appendChild(l);ar.appendChild(r);h.appendChild(ar)}
  s.appendChild(h);s.appendChild(row);return s}
function cardRow(items,wrap){var row=el('div','mrow'+(wrap?' wrap':''));items.forEach(function(it){row.appendChild(cardEl(it,items))});return row}
function trackRow(t,i,list,opts){
  var r=el('div','mtr'),ix=el('span','ix'),art=el('div','tart'),tx=el('div'),n=el('span','tn'),a=el('span','ta'),al=el('span','al'),du=el('span','du'),acts=el('div','acts');
  r._t=t;r._play=function(){playList(list,i)};
  r.dataset.tid=t.id;r.style.setProperty('--i',Math.min(i%80,14));if(MU.cur&&MU.cur.id===t.id)r.classList.add('on');
  ix.textContent=i+1;artImg(art,t.i);n.textContent=t.n;a.appendChild(artistSpan(t));
  if(t.al&&t.c){var alk=el('a','alink');alk.href='#';alk.textContent=t.al;alk.title='Open album';alk.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openDetail('album',t.c,t.al)});al.appendChild(alk)}else al.textContent=t.al||'';
  du.textContent=t.d?fmtT(t.d/1000):'';tx.appendChild(n);tx.appendChild(a);
  var lk=el('button','mib'),ad=el('button','mib');lk.type=ad.type='button';lk.dataset.lid=t.id;lk.setAttribute('aria-label','Like');ad.setAttribute('aria-label','Add to playlist');
  lk.appendChild(ico((isLiked(t)?'fa-solid':'fa-regular')+' fa-heart'));if(isLiked(t))lk.classList.add('liked');ad.appendChild(ico('fa-solid fa-plus'));
  lk.addEventListener('click',function(e){e.stopPropagation();toggleLike(t)});ad.addEventListener('click',function(e){e.stopPropagation();var b=ad.getBoundingClientRect();plMenuAt(b.left,b.bottom,t,b.top)});
  acts.appendChild(lk);acts.appendChild(ad);
  if(opts&&opts.drop){var dx=el('button','mib');dx.type='button';dx.setAttribute('aria-label','Remove from playlist');dx.appendChild(ico('fa-solid fa-trash'));dx.addEventListener('click',function(e){e.stopPropagation();opts.drop(t)});acts.appendChild(dx)}
  r.appendChild(ix);r.appendChild(art);r.appendChild(tx);r.appendChild(al);r.appendChild(du);r.appendChild(acts);
  r.addEventListener('click',r._play);return r}
// long lists are drawn a screenful at a time as you scroll
function chunked(parent,cls,items,build,STEP){
  var box=el('div',cls),sent=el('div','msent'),n=0;
  parent.appendChild(box);parent.appendChild(sent);
  function more(){
    var end=Math.min(items.length,n+STEP);
    for(;n<end;n++)box.appendChild(build(items[n],n));
    refreshLikes();
    if(n>=items.length){if(MU.io){MU.io.disconnect();MU.io=null}sent.remove();return}
    requestAnimationFrame(function(){if(sent.isConnected&&sent.getBoundingClientRect().top<mbody.getBoundingClientRect().bottom+500)more()})}
  more();
  if(n<items.length){MU.io=new IntersectionObserver(function(es){if(es[0].isIntersecting)more()},{root:mbody,rootMargin:'600px'});MU.io.observe(sent)}}
function trackList(parent,tracks,opts){chunked(parent,'mlist',tracks,function(t,i){return trackRow(t,i,tracks,opts)},80)}
// the front page: small song tiles in a grid
function songTile(t,i,list){
  var d=el('div','sc'),cv=el('button','sc-cv'),pl=el('span','sc-pl'),eq=el('span','eq sc-eq'),nm=el('button','sc-n'),ar=el('div','sc-a');
  d._t=t;d._play=function(){playList(list,i)};d.dataset.tid=t.id;d.style.setProperty('--i',Math.min(i%72,12));
  if(MU.cur&&MU.cur.id===t.id)d.classList.add('on');
  cv.type=nm.type='button';cv.setAttribute('aria-label','Play '+t.n);artImg(cv,t.i);
  pl.appendChild(ico('fa-solid fa-play'));cv.appendChild(pl);
  for(var k=0;k<4;k++)eq.appendChild(document.createElement('i'));cv.appendChild(eq);
  nm.textContent=t.n;nm.title=t.n;ar.appendChild(artistSpan(t));
  cv.addEventListener('click',d._play);nm.addEventListener('click',d._play);
  d.appendChild(cv);d.appendChild(nm);d.appendChild(ar);return d}
function songGrid(parent,tracks){chunked(parent,'sgrid',tracks,function(t,i){return songTile(t,i,tracks)},72)}

// ---------- views ----------
function loadFeed(){
  if(MU.feed||MU.feedBusy)return;MU.feedBusy=true;
  mapi('feed').then(function(j){MU.feed=j.songs||[];MU.feedBusy=false;MU.feedErr=null;if(!MU.detail&&!MU.sq&&MU.view==='home')render()}).catch(function(e){MU.feedBusy=false;MU.feedErr=e.message;if(!MU.detail&&!MU.sq&&MU.view==='home')render()})}
function shuffled(a){var b=a.slice(),i,j,t;for(i=b.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=b[i];b[i]=b[j];b[j]=t}return b}
function viewHome(){
  if(!MU.feed){
    if(MU.feedErr){note(mbody,MU.feedErr,function(){MU.feedErr=null;loadFeed();render()});return}
    mbody.appendChild(skeletonGrid(40));loadFeed();return}
  songGrid(mbody,MU.feed)}
function viewLibrary(){
  var row=el('div','mrow wrap');
  row.appendChild(folderCard('Liked songs',MU.lib.liked.length+' songs','','fa-solid fa-heart',function(){openDetail('liked','liked','Liked songs')}));
  MU.lib.pls.forEach(function(pl){row.appendChild(folderCard(pl.name,pl.tracks.length+' songs',pl.tracks[0]&&pl.tracks[0].i,'fa-solid fa-music',function(){openDetail('playlist',pl.id,pl.name)}))});
  var nb=folderCard('New playlist','Make your own','','fa-solid fa-plus',function(){newPlaylist(function(pl){openDetail('playlist',pl.id,pl.name)})});row.appendChild(nb);
  mbody.appendChild(section('Your library',row,false));
  if(!MU.lib.pls.length)note(mbody,'Playlists you create show up here. Use the + button on any song to add it.')}
function viewSearch(){
  var q=MU.sq,out=el('div'),key='q:'+q.toLowerCase();mbody.appendChild(out);
  function paint(j){
    out.textContent='';
    if(!j.songs.length&&!j.albums.length&&!j.artists.length&&!j.playlists.length){note(out,'No results for “'+q+'”.');return}
    if(j.artists.length)out.appendChild(section('Artists',cardRow(j.artists),true));
    if(j.songs.length){var box=el('div');trackList(box,j.songs);out.appendChild(section('Songs',box,false))}
    if(j.albums.length)out.appendChild(section('Albums',cardRow(j.albums),true));
    if(j.playlists.length)out.appendChild(section('Playlists',cardRow(j.playlists),true));
    refreshLikes();refreshPlaying()}
  if(MU.cache[key]){paint(MU.cache[key]);return}
  out.appendChild(skeletonRows(8));
  mapi('search?q='+encodeURIComponent(q)).then(function(j){if(j.songs.length||j.albums.length||j.artists.length||j.playlists.length)MU.cache[key]=j;if(MU.sq===q&&!MU.detail)paint(j)}).catch(function(e){if(MU.sq===q&&!MU.detail){out.textContent='';note(out,e.message,render)}})}
function viewDetail(){
  var d=MU.detail,key=d.type+':'+d.id,C=MU.cache[key],tracks=[],title='',sub='',cover='',fb='fa-solid fa-music',opts=null,pl=null,round=false,extra=null,albumArtist=null;
  var back=el('button','btn');back.type='button';back.appendChild(ico('fa-solid fa-chevron-left'));back.appendChild(document.createTextNode('Back'));back.style.marginBottom='18px';back.addEventListener('click',goBack);mbody.appendChild(back);
  var ep={album:'album?id=',yplaylist:'playlist?id=',artist:'artist?id='}[d.type];
  if(ep&&!C){
    mbody.appendChild(skeletonRows(8));
    mapi(ep+encodeURIComponent(d.id)).then(function(j){MU.cache[key]=j;if(MU.detail===d)render()}).catch(function(e){if(MU.detail===d){mbody.textContent='';mbody.appendChild(back);note(mbody,e.message,render)}});return}
  if(d.type==='album'||d.type==='yplaylist'){
    tracks=C.tracks;title=C.info.n;sub=(C.info.a?C.info.a+' · ':'')+(C.info.y?C.info.y+' · ':'')+tracks.length+' songs';cover=C.info.i;fb=d.type==='album'?'fa-solid fa-compact-disc':'fa-solid fa-list-ul';
    if(d.type==='album'&&C.info.ai&&C.info.a)albumArtist=C.info}
  else if(d.type==='artist'){
    tracks=C.songs;title=C.info.n;sub=[C.info.s?C.info.s+' subscribers':'',C.info.m?C.info.m+' monthly listeners':''].filter(Boolean).join(' · ')||'Artist';cover=C.info.i;fb='fa-solid fa-user';round=true;extra=C}
  else if(d.type==='liked'){tracks=MU.lib.liked;title='Liked songs';sub=tracks.length+' songs';fb='fa-solid fa-heart'}
  else{pl=MU.lib.pls.filter(function(p){return p.id===d.id})[0];if(!pl){MU.detail=null;MU.stack=[];MU.view='library';render();return}
    tracks=pl.tracks;title=pl.name;sub=tracks.length+' songs';cover=tracks[0]&&tracks[0].i;
    opts={drop:function(t){pl.tracks=pl.tracks.filter(function(x){return x.id!==t.id});saveLib();render()}}}
  var head=el('div','mhd'+(round?' r':'')),cov=el('div','cov'),info=el('div'),h=el('h2'),p=el('p'),bt=el('div','btns'),pb=el('button','btn pri'),sb=el('button','btn');
  artImg(cov,cover,fb);h.textContent=title;
  if(albumArtist){p.appendChild(artistLink(albumArtist.a,albumArtist.ai));p.appendChild(document.createTextNode(sub.slice(albumArtist.a.length)))}else p.textContent=sub;
  pb.type=sb.type='button';pb.appendChild(ico('fa-solid fa-play'));pb.appendChild(document.createTextNode('Play'));sb.appendChild(ico('fa-solid fa-shuffle'));sb.appendChild(document.createTextNode('Shuffle'));
  pb.addEventListener('click',function(){if(tracks.length)playList(tracks,0)});sb.addEventListener('click',function(){playShuffled(tracks)});
  bt.appendChild(pb);if(tracks.length>1)bt.appendChild(sb);info.appendChild(h);info.appendChild(p);info.appendChild(bt);
  if(pl){var del=el('button','btn');del.type='button';del.textContent='Delete playlist';del.addEventListener('click',function(){MU.lib.pls=MU.lib.pls.filter(function(x){return x!==pl});saveLib();MU.detail=null;MU.stack=[];MU.view='library';render()});bt.appendChild(del)}
  head.appendChild(cov);head.appendChild(info);mbody.appendChild(head);
  if(tracks.length){
    if(extra){var box=el('div');trackList(box,tracks,opts);mbody.appendChild(section('Songs',box,false))}else trackList(mbody,tracks,opts)}
  else if(!extra)note(mbody,pl?'This playlist is empty. Use the + button on any song to add it.':d.type==='liked'?'Songs you like show up here.':'Nothing here yet.');
  if(extra){
    if(extra.albums.length)mbody.appendChild(section('Albums',cardRow(extra.albums),true));
    if(extra.singles.length)mbody.appendChild(section('Singles & EPs',cardRow(extra.singles),true));
    if(extra.related&&extra.related.length)mbody.appendChild(section('Fans also like',cardRow(extra.related),true))}}
function render(){
  if(MU.io){MU.io.disconnect();MU.io=null}
  mbody.textContent='';
  if(MU.detail)viewDetail();else if(MU.sq)viewSearch();else if(MU.view==='library')viewLibrary();else viewHome();
  refreshLikes();refreshPlaying()}
function markTabs(){[].forEach.call(document.querySelectorAll('#mnav button'),function(b){b.classList.toggle('on',b.dataset.v===MU.view)})}
function setView(v){MU.view=v;MU.detail=null;MU.stack=[];MU.sq='';mq.value='';markTabs();mbody.scrollTop=0;render()}
function openDetail(type,id,name){MU.stack.push({view:MU.view,detail:MU.detail,sq:MU.sq});MU.detail={type:type,id:id,name:name};mbody.scrollTop=0;render()}
function goBack(){var s=MU.stack.pop();if(s){MU.view=s.view;MU.detail=s.detail;MU.sq=s.sq;mq.value=s.sq}else MU.detail=null;markTabs();mbody.scrollTop=0;render()}
function doSearch(v){v=v.trim();if(v===MU.sq&&!MU.detail)return;MU.sq=v;MU.detail=null;MU.stack=[];mbody.scrollTop=0;render()}
mq.addEventListener('input',function(){clearTimeout(MU.stm);MU.stm=setTimeout(function(){doSearch(mq.value)},420)});
document.getElementById('mform').addEventListener('submit',function(e){e.preventDefault();clearTimeout(MU.stm);doSearch(mq.value)});
[].forEach.call(document.querySelectorAll('#mnav button'),function(b){b.addEventListener('click',function(){setView(b.dataset.v)})});

// ---------- playlists ----------
function newPlaylist(then){mdlg.hidden=false;mdname.value='';setTimeout(function(){mdname.focus({preventScroll:true})},30);MU.dlgThen=then}
function closeDlg(){mdlg.hidden=true;MU.dlgThen=null}
document.getElementById('mdform').addEventListener('submit',function(e){
  e.preventDefault();var name=mdname.value.trim().slice(0,40);if(!name)return;
  var pl={id:'p'+Date.now().toString(36),name:name,tracks:[]};MU.lib.pls.push(pl);saveLib();var then=MU.dlgThen;closeDlg();if(MU.view==='library'&&!MU.detail&&!MU.sq)render();if(then)then(pl)});
document.getElementById('mdcancel').addEventListener('click',closeDlg);
function closePop(){[].forEach.call(document.querySelectorAll('.plpop'),function(n){n.parentNode.removeChild(n)})}
// the "add to playlist" menu opens at a point (under the + button, or where you right-clicked)
function plMenuAt(x,y,t,above){
  closePop();var pop=el('div','plpop');
  MU.lib.pls.forEach(function(pl){var has=pl.tracks.some(function(z){return z.id===t.id}),b=el('button');b.type='button';b.appendChild(ico(has?'fa-solid fa-check':'fa-solid fa-music'));var s=el('span');s.textContent=pl.name;b.appendChild(s);
    b.addEventListener('click',function(){if(has)pl.tracks=pl.tracks.filter(function(z){return z.id!==t.id});else pl.tracks.push(slim(t));saveLib();closePop();if(MU.detail&&MU.detail.type==='playlist')render()});pop.appendChild(b)});
  if(MU.lib.pls.length)pop.appendChild(el('div','sp'));
  var nb=el('button');nb.type='button';nb.appendChild(ico('fa-solid fa-plus'));var ns=el('span');ns.textContent='New playlist…';nb.appendChild(ns);
  nb.addEventListener('click',function(){closePop();newPlaylist(function(pl){pl.tracks.push(slim(t));saveLib()})});pop.appendChild(nb);
  document.body.appendChild(pop);
  var pw=pop.offsetWidth,ph=pop.offsetHeight;pop.style.left=Math.max(8,Math.min(x,innerWidth-pw-8))+'px';pop.style.top=(y+6+ph>innerHeight?Math.max(8,(above==null?y:above)-ph-6):y+6)+'px';
  setTimeout(function(){document.addEventListener('click',closePop,{once:true})},0)}

// ---------- the player: a hidden audio engine, driven by its IFrame API ----------
var eng={player:null,ready:false,want:'',first:'',tick:0};
function loadApi(cb){
  if(window.YT&&YT.Player){cb();return}
  if(!loadApi.q){
    loadApi.q=[];
    var s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';
    s.onerror=function(){loadApi.q=null;s.remove();apiFailed('The music player could not load. Check your connection, then pick a song again.')};
    document.head.appendChild(s);
    var prev=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=function(){if(typeof prev==='function')prev();var q=loadApi.q||[];loadApi.q=[];q.forEach(function(f){f()})}}
  loadApi.q.push(cb)}
function apiFailed(msg){mbArtist.textContent=msg;MU.playing=false;playIcon()}
function engineLoad(vid){
  eng.want=vid;
  if(eng.player&&eng.ready){try{eng.player.loadVideoById(vid)}catch(e){}return}
  if(eng.player)return; // created but not ready yet: onReady loads the latest wanted song
  loadApi(function(){
    if(eng.player)return;
    // made here (not by the API) so it can carry its own referrer policy: this page sends no referrer and the player refuses to start without one
    var f=document.createElement('iframe');f.title='Audio player';f.setAttribute('referrerpolicy','strict-origin-when-cross-origin');f.setAttribute('allow','autoplay; encrypted-media');
    eng.first=eng.want;
    f.src='https://www.youtube.com/embed/'+encodeURIComponent(eng.first)+'?enablejsapi=1&autoplay=1&controls=0&disablekb=1&fs=0&playsinline=1&rel=0&iv_load_policy=3&origin='+encodeURIComponent(location.origin);
    engine.appendChild(f);
    eng.player=new YT.Player(f,{events:{onReady:onReady,onStateChange:onState,onError:onErr}})})}
function onReady(){
  eng.ready=true;try{eng.player.setVolume(Math.round(MU.lib.vol*100))}catch(e){}
  if(eng.want&&eng.want!==eng.first){try{eng.player.loadVideoById(eng.want)}catch(e){}}
  clearInterval(eng.tick);eng.tick=setInterval(tick,500)}
function onState(e){
  var S=YT.PlayerState;
  if(e.data===S.PLAYING){MU.playing=true;MU.errs=0;playIcon();tick()}
  else if(e.data===S.PAUSED){MU.playing=false;playIcon()}
  else if(e.data===S.ENDED){MU.playing=false;playIcon();nextT(1,true)}}
function onErr(){
  // removed, private or not allowed to play outside its own site
  mbArtist.textContent='This song can’t be played here. Skipping…';MU.playing=false;playIcon();
  if(MU.queue.length>1&&++MU.errs<MU.queue.length)setTimeout(function(){nextT(1)},900)}
function songLen(){var d=0;try{d=eng.ready?eng.player.getDuration():0}catch(e){}return d>0?d:((MU.cur&&MU.cur.d)?MU.cur.d/1000:0)}
function tick(){
  if(!eng.ready||MU.seeking||!MU.cur)return;
  var t=0;try{t=eng.player.getCurrentTime()}catch(e){}var d=songLen();
  mbSeek.value=d?Math.min(1000,t/d*1000):0;setFill(mbSeek);mbCur.textContent=fmtT(t);mbDur.textContent=fmtT(d)}
function playIcon(){mbPlay.firstChild.className=MU.playing?'fa-solid fa-pause':'fa-solid fa-play';mbPlay.setAttribute('aria-label',MU.playing?'Pause':'Play');if(typeof setNowPlaying==='function')setNowPlaying(MU.cur,MU.playing)}
function playable(x){return isYT(x)}
function playList(list,i){
  var t=list[i];if(!playable(t))return;
  var q=list.filter(playable);MU.errs=0;
  if(MU.lib.shuf){MU.orig=q.slice();MU.queue=[t].concat(shuffled(q.filter(function(x){return x!==t})));MU.qi=0}
  else{MU.orig=null;MU.queue=q;MU.qi=q.indexOf(t)}
  playCur()}
function playShuffled(tracks){var q=tracks.filter(playable);if(!q.length)return;MU.lib.shuf=true;saveLib();syncModes();playList(q,Math.floor(Math.random()*q.length))}
// shuffle: the song that is playing stays first and the rest are mixed; turning it off puts the original order back
function setShuffle(on){
  MU.lib.shuf=!!on;saveLib();syncModes();
  if(!MU.queue.length)return;
  var cur=MU.queue[MU.qi];
  if(on){MU.orig=MU.queue.slice();MU.queue=[cur].concat(shuffled(MU.queue.filter(function(x){return x!==cur})));MU.qi=0}
  else if(MU.orig){
    var have={},base,seen={};MU.queue.forEach(function(x){have[x.id]=1});
    base=MU.orig.filter(function(x){return have[x.id]});base.forEach(function(x){seen[x.id]=1});
    MU.queue=base.concat(MU.queue.filter(function(x){return!seen[x.id]}));
    MU.qi=Math.max(0,MU.queue.findIndex(function(x){return x.id===cur.id}));MU.orig=null}
  renderQueue()}
function syncModes(){
  var on=!!MU.lib.shuf;mbShuf.classList.toggle('on',on);mbShuf.setAttribute('aria-pressed',String(on));mbShuf.title='Shuffle: '+(on?'on':'off');
  var m=MU.lib.rep,lbl='Repeat: '+(m==='one'?'one song':m==='all'?'all':'off');
  mbRep.dataset.m=m;mbRep.classList.toggle('on',m!=='off');mbRep.setAttribute('aria-pressed',String(m!=='off'));mbRep.title=lbl;mbRep.setAttribute('aria-label',lbl)}
function queueAdd(t,next){
  if(!playable(t))return;
  if(!MU.queue.length){MU.queue=[t];MU.qi=0;playCur();return}
  var ex=MU.queue.findIndex(function(z){return z.id===t.id});
  if(ex===MU.qi)return;
  if(ex>=0){MU.queue.splice(ex,1);if(ex<MU.qi)MU.qi--}
  MU.queue.splice(next?MU.qi+1:MU.queue.length,0,t);renderQueue()}
function playCur(){
  var t=MU.queue[MU.qi];if(!t)return;MU.cur=t;
  artImg(document.getElementById('mbArt'),t.i);document.getElementById('mbName').textContent=t.n;mbArtist.textContent='';mbArtist.appendChild(artistSpan(t));mbLike.disabled=false;
  mbSeek.value=0;setFill(mbSeek);mbCur.textContent='0:00';mbDur.textContent=t.d?fmtT(t.d/1000):'0:00';
  MU.playing=true;playIcon();engineLoad(t.id);renderQueue();refreshLikes();refreshPlaying();
  if('mediaSession' in navigator){try{navigator.mediaSession.metadata=new MediaMetadata({title:t.n,artist:t.a,album:t.al||'',artwork:t.i?[{src:t.i,sizes:'400x400',type:'image/jpeg'}]:[]})}catch(e){}}}
// when a song ends: Repeat one plays it again; Repeat all loops the queue; otherwise, at the end of the queue, similar
// songs follow if Autoplay is on (and it stops if not). The Next button always wraps around.
function nextT(d,auto){
  if(!MU.queue.length)return;
  if(auto&&MU.lib.rep==='one'&&MU.cur){try{eng.player.seekTo(0,true);eng.player.playVideo()}catch(e){}return}
  if(d>0&&auto&&MU.qi===MU.queue.length-1&&MU.lib.rep!=='all'){
    if(MU.auto&&MU.cur){
      if(MU.radioBusy)return;MU.radioBusy=true;var from=MU.cur;
      mapi('radio?id='+encodeURIComponent(from.id)).then(function(j){
        MU.radioBusy=false;if(MU.cur!==from)return;
        var have={};MU.queue.forEach(function(x){have[x.id]=1});var add=(j.tracks||[]).filter(function(x){return playable(x)&&!have[x.id]});
        if(add.length){MU.queue=MU.queue.concat(add);MU.qi++;playCur()}else stopAtEnd()
      }).catch(function(){MU.radioBusy=false;stopAtEnd()});return}
    stopAtEnd();return}
  MU.qi=(MU.qi+d+MU.queue.length)%MU.queue.length;playCur()}
function stopAtEnd(){MU.playing=false;playIcon()}
function togglePlay(){
  if(!MU.cur||!eng.ready)return;
  try{if(MU.playing)eng.player.pauseVideo();else eng.player.playVideo()}catch(e){}}
mbPlay.addEventListener('click',togglePlay);
document.getElementById('mbNext').addEventListener('click',function(){nextT(1)});
document.getElementById('mbPrev').addEventListener('click',function(){var t=0;try{t=eng.ready?eng.player.getCurrentTime():0}catch(e){}if(t>3){try{eng.player.seekTo(0,true)}catch(e){}}else nextT(-1)});
mbSeek.addEventListener('input',function(){MU.seeking=true;setFill(mbSeek);mbCur.textContent=fmtT(mbSeek.value/1000*songLen())});
mbSeek.addEventListener('change',function(){try{eng.player.seekTo(mbSeek.value/1000*songLen(),true)}catch(e){}MU.seeking=false});
mbVol.addEventListener('input',function(){MU.lib.vol=mbVol.value/100;setFill(mbVol);try{if(eng.ready)eng.player.setVolume(Math.round(mbVol.value))}catch(e){}saveLib()});
mbLike.addEventListener('click',function(){if(MU.cur)toggleLike(MU.cur)});
mbShuf.addEventListener('click',function(){setShuffle(!MU.lib.shuf)});
mbRep.addEventListener('click',function(){MU.lib.rep=MU.lib.rep==='off'?'all':MU.lib.rep==='all'?'one':'off';saveLib();syncModes()});
syncModes();
document.getElementById('mauto').addEventListener('change',function(){MU.auto=this.checked});
if('mediaSession' in navigator){try{[['play',togglePlay],['pause',togglePlay],['previoustrack',function(){nextT(-1)}],['nexttrack',function(){nextT(1)}]].forEach(function(h){navigator.mediaSession.setActionHandler(h[0],h[1])})}catch(e){}}

// ---------- up next panel ----------
function renderQueue(){
  mqlist.textContent='';
  var from=Math.max(0,MU.qi-3),to=Math.min(MU.queue.length,MU.qi+60);
  for(var i=from;i<to;i++)(function(i){
    var t=MU.queue[i],b=el('button','mqi'+(i===MU.qi?' on':'')),a=el('span','qa'),d=el('div'),n=el('b'),s=el('small');
    b.type='button';b._t=t;artImg(a,t.i);n.textContent=t.n;s.textContent=t.a;d.appendChild(n);d.appendChild(s);b.appendChild(a);b.appendChild(d);
    b._play=function(){MU.qi=i;MU.errs=0;playCur()};b.addEventListener('click',b._play);mqlist.appendChild(b)})(i);
  if(to<MU.queue.length){var m=el('div','mqmore');m.textContent='+ '+(MU.queue.length-to)+' more songs';mqlist.appendChild(m)}
  var on=mqlist.querySelector('.on');if(on&&mus.classList.contains('qopen'))on.scrollIntoView({block:'nearest'})}
function toggleQueue(force){
  var on=typeof force==='boolean'?force:!mus.classList.contains('qopen');
  mus.classList.toggle('qopen',on);mbQ.classList.toggle('on',on);mbQ.setAttribute('aria-pressed',String(on));if(on)renderQueue()}
mbQ.addEventListener('click',function(){toggleQueue()});
window.openMusic=function(){if(!MU.started){MU.started=true;render()}};
window.MU=MU;
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!mdlg.hidden){e.stopPropagation();closeDlg()}},true);

// ---------- right-click menu entries (see ui.js) ----------
function goPage(fn){if(typeof show==='function'&&document.body.dataset.page!=='Music')show('Music');fn()}
if(typeof ctxProvide==='function')ctxProvide(function(target,e){
  var row=target.closest('.mtr,.mcard,.mqi,.mnow,.sc');
  if(!row||!document.getElementById('music').contains(row))return null;
  var tr=row._t||(row.classList.contains('mnow')?MU.cur:null),items=[];
  if(tr){
    if(row._play)items.push({label:'Play',icon:'fa-solid fa-play',action:row._play});
    items.push({label:'Play next',icon:'fa-solid fa-forward-step',action:function(){queueAdd(tr,true)}});
    items.push({label:'Add to queue',icon:'fa-solid fa-list-ol',action:function(){queueAdd(tr,false)}});
    items.push({sep:true});
    items.push({label:isLiked(tr)?'Remove from liked':'Like',icon:(isLiked(tr)?'fa-solid':'fa-regular')+' fa-heart',action:function(){toggleLike(tr)}});
    items.push({label:'Add to playlist…',icon:'fa-solid fa-plus',action:function(){plMenuAt(e.clientX,e.clientY,tr)}});
    var ar=artistsOf(tr).filter(function(a){return a.id}).slice(0,3);
    if(ar.length||tr.c)items.push({sep:true});
    ar.forEach(function(a){items.push({label:'Go to '+a.n,icon:'fa-solid fa-user',action:function(){openArtist(a.id,a.n)}})});
    if(tr.c&&tr.al)items.push({label:'Go to album',icon:'fa-solid fa-compact-disc',action:function(){goPage(function(){openDetail('album',tr.c,tr.al)})}})}
  else if(row._it){
    var it=row._it;
    items.push({label:'Open',icon:'fa-solid fa-up-right-from-square',action:function(){goPage(function(){openItem(it)})}});
    if(it.t!=='r')items.push({label:'Play',icon:'fa-solid fa-play',action:function(){playRemote(it.t,it.id)}})}
  return items});
})();
