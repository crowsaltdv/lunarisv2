// =====================================================================
// Lunaris v2: interface extras
//   - a custom dropdown (replaces the browser's own <select> list)
//   - a custom right-click menu (other scripts add entries with ctxProvide)
// =====================================================================

// ---------- custom dropdown ----------
function makeDropdown(sel){
  var wrap=el('div','dd'),btn=el('button','dd-btn'),lab=el('span','dd-lab'),chev=el('i','fa-solid fa-chevron-down'),menu=el('div','dd-menu');
  btn.type='button';btn.setAttribute('aria-haspopup','listbox');btn.setAttribute('aria-expanded','false');
  if(sel.getAttribute('aria-label'))btn.setAttribute('aria-label',sel.getAttribute('aria-label'));
  menu.setAttribute('role','listbox');chev.setAttribute('aria-hidden','true');
  btn.appendChild(lab);btn.appendChild(chev);
  sel.parentNode.insertBefore(wrap,sel);wrap.appendChild(btn);wrap.appendChild(menu);wrap.appendChild(sel);
  sel.classList.add('dd-native');sel.tabIndex=-1;sel.setAttribute('aria-hidden','true');
  var opts=[].map.call(sel.options,function(o){
    var b=el('button','dd-opt'),s=el('span'),c=el('i','fa-solid fa-check');
    b.type='button';b.setAttribute('role','option');b.dataset.v=o.value;s.textContent=o.textContent;c.setAttribute('aria-hidden','true');b.appendChild(s);b.appendChild(c);
    b.addEventListener('click',function(){pick(o.value)});menu.appendChild(b);return b});
  function sync(){
    var cur=sel.options[sel.selectedIndex];lab.textContent=cur?cur.textContent:'';
    opts.forEach(function(b){var on=b.dataset.v===sel.value;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))})}
  function isOpen(){return wrap.classList.contains('open')}
  function open(){wrap.classList.add('open');btn.setAttribute('aria-expanded','true');var on=menu.querySelector('.on')||opts[0];if(on)on.focus({preventScroll:true})}
  function close(refocus){wrap.classList.remove('open');btn.setAttribute('aria-expanded','false');if(refocus)btn.focus({preventScroll:true})}
  function pick(v){sel.value=v;sync();close(true);sel.dispatchEvent(new Event('change',{bubbles:true}))}
  btn.addEventListener('click',function(){if(isOpen())close();else open()});
  btn.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!isOpen())open()}});
  menu.addEventListener('keydown',function(e){
    var i=opts.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();opts[Math.min(opts.length-1,i+1)].focus()}
    else if(e.key==='ArrowUp'){e.preventDefault();opts[Math.max(0,i-1)].focus()}
    else if(e.key==='Home'){e.preventDefault();opts[0].focus()}
    else if(e.key==='End'){e.preventDefault();opts[opts.length-1].focus()}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}
    else if(e.key==='Tab')close()});
  document.addEventListener('pointerdown',function(e){if(isOpen()&&!wrap.contains(e.target))close()});
  addEventListener('blur',function(){close()});
  sel._ddSync=sync;sync()}

// ---------- custom right-click menu ----------
// A provider is function(target, event) returning a list of entries (or nothing). An entry is
//   {label, icon, hint, action, disabled, danger}   a button
//   {sep:true}                                      a divider
//   {nav:[{label, icon, action}, ...]}              a small grid of icon buttons
var ctxProviders=[];
function ctxProvide(fn){ctxProviders.push(fn)}
(function(){
  var menu=null;
  function icon(cls){var i=document.createElement('i');i.className=cls;i.setAttribute('aria-hidden','true');return i}
  function close(){if(!menu)return;var m=menu;menu=null;m.classList.add('out');setTimeout(function(){m.remove()},140)}
  function copyText(t){
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(function(){legacyCopy(t)});else legacyCopy(t)}
  function legacyCopy(t){var a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();try{document.execCommand('copy')}catch(e){}a.remove()}
  function build(items){
    var m=el('div','ctx');m.setAttribute('role','menu');
    items.forEach(function(it){
      if(it.sep){m.appendChild(el('div','ctx-sep'));return}
      if(it.nav){
        var g=el('div','ctx-nav');
        it.nav.forEach(function(n){var b=el('button','ctx-n'),s=el('span');b.type='button';b.title=n.label;b.setAttribute('role','menuitem');if(n.logo){var lg=el('span','om');lg.setAttribute('aria-hidden','true');b.appendChild(lg)}else b.appendChild(icon(n.icon));s.textContent=n.label;b.appendChild(s);
          b.addEventListener('click',function(){close();setTimeout(n.action,0)});g.appendChild(b)});
        m.appendChild(g);return}
      var b=el('button','ctx-i'+(it.danger?' danger':'')),l=el('span','ctx-l');
      b.type='button';b.setAttribute('role','menuitem');if(it.disabled)b.disabled=true;
      var ic=el('span','ctx-ic');if(it.icon)ic.appendChild(icon(it.icon));b.appendChild(ic);
      l.textContent=it.label;b.appendChild(l);
      if(it.hint){var h=el('kbd');h.textContent=it.hint;b.appendChild(h)}
      b.addEventListener('click',function(){close();if(it.action)setTimeout(it.action,0)});
      m.appendChild(b)});
    return m}
  function open(x,y,items){
    close();menu=build(items);document.body.appendChild(menu);
    var w=menu.offsetWidth,h=menu.offsetHeight,vw=innerWidth,vh=innerHeight;
    var left=x+w>vw-8?Math.max(8,x-w):x,top=y+h>vh-8?Math.max(8,y-h):y;
    menu.style.left=left+'px';menu.style.top=top+'px';
    menu.style.transformOrigin=(x>left?'right':'left')+' '+(y>top?'bottom':'top')}
  // ----- the menu itself -----
  document.addEventListener('contextmenu',function(e){
    if(e.shiftKey||e.pointerType==='touch')return; // Shift + right-click keeps the browser's own menu; touch long-press is left alone
    var t=e.target;if(!t||!t.closest)return;
    e.preventDefault();
    var x=e.clientX,y=e.clientY;
    if(!x&&!y){var r=t.getBoundingClientRect();x=r.left+12;y=r.top+r.height/2}
    var items=[];
    ctxProviders.forEach(function(p){var r;try{r=p(t,e)}catch(err){r=null}if(r&&r.length){if(items.length)items.push({sep:true});items=items.concat(r)}});
    if(items.length)items.push({sep:true});
    var go=function(p){return function(){show(p)}};
    items.push({nav:[
      {label:'Home',icon:'fa-solid fa-house',action:go('Home')},{label:'Projects',icon:'fa-solid fa-folder-open',action:go('Games')},{label:'Watch',icon:'fa-solid fa-tv',action:go('Watch')},{label:'Manga',icon:'fa-solid fa-book-open',action:go('Manga')},{label:'AI',icon:'fa-solid fa-robot',action:go('AI')},{label:'Music',icon:'fa-solid fa-music',action:go('Music')},{label:'Orata',logo:true,action:go('Orata')},
      {label:'Browser',icon:'fa-solid fa-compass',action:go('Browser')},{label:'Apps',icon:'fa-solid fa-table-cells-large',action:go('Apps')},{label:'Settings',icon:'fa-solid fa-gear',action:go('Settings')},{label:'Cloak',icon:'fa-solid fa-user-secret',action:go('Cloak')},{label:'Partners',icon:'fa-solid fa-user',action:go('Partners')}]});
    items.push({sep:true});
    items.push({label:'Reload',icon:'fa-solid fa-rotate-right',hint:'F5',action:function(){location.reload()}});
    items.push({label:document.fullscreenElement?'Exit fullscreen':'Fullscreen',icon:document.fullscreenElement?'fa-solid fa-compress':'fa-solid fa-expand',hint:'F11',action:function(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}});
    items.push({sep:true});
    items.push({label:'Panic',icon:'fa-solid fa-triangle-exclamation',danger:true,action:function(){panic()}});
    open(x,y,items)});
  // ----- closing and keyboard -----
  document.addEventListener('pointerdown',function(e){if(menu&&!menu.contains(e.target))close()},true);
  addEventListener('blur',close);addEventListener('resize',close);
  document.addEventListener('scroll',function(e){if(menu&&!menu.contains(e.target))close()},true);
  document.addEventListener('keydown',function(e){
    if(!menu)return;
    var bs=[].slice.call(menu.querySelectorAll('.ctx-i:not(:disabled),.ctx-n')),i=bs.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}
    else if(e.key==='ArrowDown'){e.preventDefault();(bs[i+1]||bs[0]).focus()}
    else if(e.key==='ArrowUp'){e.preventDefault();(bs[i-1]||bs[bs.length-1]).focus()}
    else if(e.key==='Tab')close()},true);

  // ----- entries for text, links, games, browser tabs and chat messages -----
  var TEXTY=/^(text|search|url|password|email|tel|number)?$/i;
  ctxProvide(function(t){
    var inp=t.closest('input,textarea');
    if(inp&&(inp.tagName==='TEXTAREA'||TEXTY.test(inp.getAttribute('type')||''))){
      var s=inp.selectionStart!=null?inp.value.substring(inp.selectionStart,inp.selectionEnd):'',can=!inp.disabled&&!inp.readOnly;
      var out=[];
      if(can)out.push({label:'Cut',icon:'fa-solid fa-scissors',hint:'Ctrl+X',disabled:!s,action:function(){inp.focus();document.execCommand('cut')}});
      out.push({label:'Copy',icon:'fa-regular fa-copy',hint:'Ctrl+C',disabled:!s,action:function(){inp.focus();if(s)copyText(s)}});
      if(can)out.push({label:'Paste',icon:'fa-regular fa-clipboard',hint:'Ctrl+V',action:function(){inp.focus();if(navigator.clipboard&&navigator.clipboard.readText)navigator.clipboard.readText().then(function(x){document.execCommand('insertText',false,x)}).catch(function(){})}});
      out.push({label:'Select all',icon:'fa-solid fa-i-cursor',hint:'Ctrl+A',action:function(){inp.focus();inp.select()}});
      return out}
    var sel=window.getSelection&&getSelection().toString();
    if(sel&&sel.trim())return[{label:'Copy',icon:'fa-regular fa-copy',hint:'Ctrl+C',action:function(){copyText(sel)}}]});
  ctxProvide(function(t){
    var a=t.closest('a[href]');
    if(!a||a.closest('.g,.dock,.set-nav,.alinks,.mtr')||!/^https?:/i.test(a.href))return null;
    var h=a.href;
    return[{label:'Open in browser',icon:'fa-solid fa-compass',action:function(){openInBrowser(h)}},
      {label:'Open in new tab',icon:'fa-solid fa-up-right-from-square',action:function(){window.open(h,'_blank','noopener')}},
      {label:'Copy link address',icon:'fa-solid fa-link',action:function(){copyText(h)}}]});
  ctxProvide(function(t){
    var a=t.closest('.g');if(!a||!a._game)return null;
    var g=a._game;
    return[{label:'Play',icon:'fa-solid fa-play',action:function(){play(g)}},
      {label:'Open in new tab',icon:'fa-solid fa-up-right-from-square',action:function(){window.open(a.href,'_blank','noopener')}},
      {label:'Copy link',icon:'fa-solid fa-link',action:function(){copyText(a.href)}}]});
  ctxProvide(function(t){
    var el2=t.closest('.tab');if(!el2)return null;
    var tb=tabs.filter(function(x){return x.el===el2})[0];if(!tb)return null;
    return[{label:'New tab',icon:'fa-solid fa-plus',action:function(){newTab()}},
      {label:'Close tab',icon:'fa-solid fa-xmark',action:function(){closeTab(tb)}},
      {label:'Close other tabs',icon:'fa-regular fa-rectangle-xmark',disabled:tabs.length<2,action:function(){tabs.slice().forEach(function(x){if(x!==tb)closeTab(x)})}}]});
  ctxProvide(function(t){
    var b=t.closest('#cmsgs .bub');if(!b)return null;
    return[{label:'Copy message',icon:'fa-regular fa-copy',action:function(){copyText(b.textContent)}}]});
})();
