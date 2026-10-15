'use strict';
/* R49 — Kalici arsiv / gonderiler, mevcut GitHub manifestinde saklanir. */
(() => {
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');
  const lightbox = $('lightbox');
  const image = $('viewerImage');
  const deleteButton = $('deleteBtn');
  const imagePathPattern = /^data\/gorseller\/[a-f0-9]{64}\.jpg$/;
  let ideas = [];
  let allIdeas = [];
  let activeView = 'posts';
  const pendingMoves = new Map();
  let manifestOrder = new Map();
  let position = -1;
  const pendingDeletes = new Set();
  const deleteJobs = [];
  let deleteFlushTimer = null;
  let deletionProcessing = false;
  let repoConfig = null;
  const hiddenIds = new Set();
  let toastTimeout;
  // Anahtar GitHub Pages sunucusundan yayinlanan delete_auth.js icindedir.
  // DIKKAT: Statik site kaynaklarindaki bu anahtari HER ZIYARETCI okuyabilir.
  const publicDeleteToken = String(window.GALERI_DELETE_AUTH?.token || '').trim();
  let githubToken = /^github_pat_[A-Za-z0-9_]{20,255}$/.test(publicDeleteToken)
    ? publicDeleteToken : null;
  let localAuthCache = null;
  const HIDDEN_TTL = 30 * 24 * 60 * 60 * 1000;

  function deleteKey() {
    if (!repoConfig?.owner || !repoConfig?.repo || !repoConfig?.branch) return null;
    return `galeri-silinen-v46:${repoConfig.owner}/${repoConfig.repo}/${repoConfig.branch}`;
  }
  function readHiddenRecords() {
    try {
      const key=deleteKey(); if(!key)return {};
      const data=JSON.parse(localStorage.getItem(key)||'{}');
      if(!data||typeof data!=='object'||Array.isArray(data))return {};
      const now=Date.now(), records={};
      for(const [id,ts] of Object.entries(data)) if(/^[a-f0-9]{64}$/.test(id)&&Number.isFinite(ts)&&ts>now-HIDDEN_TTL&&ts<now+60_000) records[id]=ts;
      return records;
    } catch(_) {return {};}
  }
  function saveHiddenRecords(records) {
    try { const key=deleteKey();if(key)localStorage.setItem(key,JSON.stringify(records)); } catch(_) {}
  }
  function rememberHidden(id) {
    hiddenIds.add(id);
    const records=readHiddenRecords();records[id]=Date.now();saveHiddenRecords(records);
  }
  function forgetHidden(id) {
    hiddenIds.delete(id);
    const records=readHiddenRecords();delete records[id];saveHiddenRecords(records);
  }
  function hydrateHidden() {
    const records=readHiddenRecords();Object.keys(records).forEach(id=>hiddenIds.add(id));
    saveHiddenRecords(records);
  }
  function acknowledgeRemoteDeleted(deletedSet) {
    // GitHub Pages eski commit'i servis ederse silinenleri geri getirmemek icin
    // bu cihazdaki kalici silme isaretlerini 30 gun koru.
    // Manifestte silinmis olarak dogrulanan kayitlar da isaretli kalabilir.
    // Bu kayitlar sadece ID ve zaman damgasi icerir, gizli bilgi tasimaz.
    if(deletedSet.size===0)return;
  }


  function safeImagePath(item) {
    return item && typeof item.image === 'string' && imagePathPattern.test(item.image) ? (repoConfig?.image_base || './') + item.image : null;
  }
  function originalUrl(item) {
    try {
      const url = new URL(item.original_url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      const host=url.hostname.toLowerCase();
      const instagram=['instagram.com','www.instagram.com'].includes(host) && /^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
      const domains=['pinterest.com','pinterest.co.uk','pinterest.ca','pinterest.de','pinterest.fr','pinterest.it','pinterest.es','pinterest.com.au'];
      const pinterest=domains.some(d=>host===d||host.endsWith('.'+d)) && /^\/pin\/[0-9]+\/?$/.test(url.pathname);
      const shortPin=host==='pin.it' && /^\/[A-Za-z0-9]+\/?$/.test(url.pathname);
      return instagram||pinterest||shortPin ? url.origin+url.pathname : null;
    } catch (_) {return null;}
  }
  function sourceIcon() {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('aria-hidden','true');
    const line=document.createElementNS('http://www.w3.org/2000/svg','path');
    line.setAttribute('d','M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2');
    line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','1.8');line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);return svg;
  }
  function parseTime(time) { const n = Date.parse(time); return Number.isFinite(n) ? n : 0; }
  function fullDate(time) { return parseTime(time) ? new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'}).format(new Date(time)) : 'Tarih bilinmiyor'; }
  function shortDate(time) { return parseTime(time) ? new Intl.DateTimeFormat('tr-TR', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}).format(new Date(time)) : '—'; }
  function relativeDate(time) {
    const ms = Math.max(0, Date.now() - parseTime(time));
    if (!parseTime(time)) return 'Henüz yok';
    if (ms < 55_000) return 'Az önce';
    if (ms < 3_600_000) return `${Math.floor(ms/60_000)} dakika önce`;
    if (ms < 86_400_000) return `${Math.floor(ms/3_600_000)} saat önce`;
    if (ms < 7*86_400_000) return `${Math.floor(ms/86_400_000)} gün önce`;
    return shortDate(time);
  }
  function toast(message, failed=false) {
    const el = $('toast'); el.textContent = message; el.hidden = false;
    el.classList.toggle('failed',failed);
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => {el.hidden = true;}, failed?8500:4100);
  }
  function newTag(tag, cls, value) { const el = document.createElement(tag); if(cls)el.className=cls; if(value != null)el.textContent=value; return el; }
  function isArchived(item) { return Boolean(item.archived_at); }
  function refreshView() {
    ideas = allIdeas.filter(item => activeView === 'archive' ? isArchived(item) : !isArchived(item));
    if(activeView === 'archive')ideas.sort((a,b)=>parseTime(b.archived_at)-parseTime(a.archived_at) || parseTime(b.added_at)-parseTime(a.added_at));
    render();
  }
  function switchView(which) {
    if(which!=='posts'&&which!=='archive')return;
    if(activeView!==which){close();activeView=which;}
    refreshView();
  }
  function render() {
    const posts=allIdeas.filter(i=>!isArchived(i)).length;
    const archives=allIdeas.length-posts;
    $('postsCount').textContent=posts.toLocaleString('tr-TR');
    $('archiveCount').textContent=archives.toLocaleString('tr-TR');
    $('postsTab').classList.toggle('active',activeView==='posts');
    $('archiveTab').classList.toggle('active',activeView==='archive');
    $('postsTab').setAttribute('aria-selected',String(activeView==='posts'));
    $('archiveTab').setAttribute('aria-selected',String(activeView==='archive'));
    $('sectionTitle').textContent=activeView==='archive'?'Arşivler':'Fikir panosu';
    $('sectionOverline').textContent=activeView==='archive'?'KAYDETTİKLERİM':'KEŞFET';
    $('deleteAllLabel').textContent=activeView==='archive'?'Arşivdeki tüm görselleri sil':'Tüm görselleri sil';
    $('emptyTitle').textContent=activeView==='archive'?'Arşivin henüz boş.':'Henüz fikir eklenmedi.';
    $('emptyDescription').textContent=activeView==='archive'?'Beğendiğin görselleri Gönderiler bölümünden arşive ekleyebilirsin.':'Otomasyon ilk kabul edilen görseli yayımladığında burada göreceksin.';
    $('deleteAllBtn').disabled=ideas.length===0;
    $('itemCount').textContent = allIdeas.length.toLocaleString('tr-TR');
    $('headingCount').textContent = ideas.length ? String(ideas.length).padStart(2,'0') : '';
    const newest=allIdeas.filter(i=>!isArchived(i))[0];
    $('lastIdea').textContent = newest ? relativeDate(newest.added_at) : 'Henüz yok';
    $('lastIdeaFull').textContent = newest ? fullDate(newest.added_at) : 'Yeni fikirler burada görünecek';
    gallery.replaceChildren();
    $('emptyView').hidden = ideas.length > 0;
    $('errorView').hidden = true;
    const batch = document.createDocumentFragment();
    ideas.forEach((item, index) => {
      const card = newTag('article','idea-card');
      const preview = newTag('button','card-preview');preview.type='button';
      preview.setAttribute('aria-label', `Fikir ${item.number}; ${fullDate(item.added_at)}; büyüt`);
      const photo = newTag('img'); photo.src = safeImagePath(item);
      photo.loading = index < 7 ? 'eager' : 'lazy'; photo.decoding='async'; photo.alt=`Türkçeye çevrilmiş fikir ${item.number}`;
      const number = newTag('span','card-index','#' + item.number);
      const base = newTag('div','card-base');
      const meta = newTag('span','card-meta',shortDate(item.added_at));
      const badge = newTag('span',item.translation_status==='translated'?'card-badge':'card-badge neutral',item.translation_status==='translated'?'✳ TÜRKÇE':'○ METİN YOK');
      const url=originalUrl(item);
      const source=newTag(url?'a':'span',url?'source-link':'source-link unavailable');
      source.append(sourceIcon(),newTag('span',null,'Orijinal'));
      if(url){source.href=url;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label',`Fikir ${item.number}: orijinal gönderiyi aç`);}
      else{source.title='Bu görselin özgün gönderi bağlantısı kayıtlarda bulunamadı.';source.setAttribute('aria-disabled','true');}
      const sourceRow=newTag('div','card-source');sourceRow.appendChild(source);
      const archiveAction=newTag('button','card-archive-action',activeView==='archive'?'Geri al':'Arşivle');
      archiveAction.type='button';
      archiveAction.setAttribute('aria-label',activeView==='archive'?`Fikir ${item.number} gönderilere geri taşınsın`:`Fikir ${item.number} arşive alınsın`);
      archiveAction.disabled=pendingMoves.has(item.id)||pendingDeletes.has(item.id);
      archiveAction.addEventListener('click',()=>moveIdea(item,activeView!=='archive'));
      sourceRow.appendChild(archiveAction);
      base.append(meta,badge);preview.append(photo,number);card.append(preview,base,sourceRow);
      preview.addEventListener('click', () => open(ideas.findIndex(x=>x.id===item.id)));
      batch.appendChild(card);
    });
    gallery.appendChild(batch);
  }
  async function loadGallery() {
    $('syncLabel').textContent = 'Güncelleniyor…';
    try {
      // GitHub Pages dagitimi gecikebilir: yetkili cihazlarda dogrudan kaynak repo okunur.
      // Yetki yoksa herkese acik ham kaynak dene, o da erisilemezse Pages'e don.
      let data=null;
      if (githubToken && repoConfig?.owner && repoConfig?.repo) {
        try { data=(await githubManifest()).manifest; } catch (_) { /* Goruntuleme hicbir zaman token hatasiyla kilitlenmesin. */ }
      }
      if (!data && repoConfig?.owner && repoConfig?.repo && repoConfig?.branch &&
          ['owner','repo','branch'].every(k=>/^[\w.-]+$/.test(repoConfig[k]))) {
        try {
          const path=['owner','repo','branch'].map(k=>encodeURIComponent(repoConfig[k]));
          const fresh=await fetch(`https://raw.githubusercontent.com/${path[0]}/${path[1]}/${path[2]}/data/manifest.json?v=${Date.now()}`,{cache:'no-store'});
          if(fresh.ok)data=await fresh.json();
        } catch (_) { /* Ozel repo veya ag: Pages'e don. */ }
      }
      if(!data){
        const response = await fetch(`./data/manifest.json?t=${Date.now()}`, {cache:'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data=await response.json();
      }
      if (!Array.isArray(data.items)) throw new Error('Görsel listesi bozuk');
      const remoteDeleted = new Set(Array.isArray(data.deleted_ids) ? data.deleted_ids : []);
      acknowledgeRemoteDeleted(remoteDeleted);
      // R40 galerisi yayin gecisi sirasinda da ayni eski->yeni numaralari gorur.
      // Numaralar GitHub'da kayitlidir. Siralama numaradan bagimsizdir.
      const numbered = data.items.map(item => item && typeof item === 'object' ? {...item} : null);
      let highest = Number.isSafeInteger(data.last_number) ? data.last_number : 0;
      numbered.forEach(item => {if(item && Number.isSafeInteger(item.number) && item.number>0) highest=Math.max(highest,item.number);});
      numbered.map((item,index)=>({item,index}))
        .filter(({item})=>item && !remoteDeleted.has(item.id))
        .sort((a,b)=>parseTime(a.item.added_at)-parseTime(b.item.added_at) || b.index-a.index)
        .forEach(({item})=>{if(!Number.isSafeInteger(item.number)||item.number<1)item.number=++highest;});
      manifestOrder=new Map(numbered.filter(Boolean).map((item,index)=>[item.id,index]));
      // Yayinci yeni kaydi listenin basina koyar; bos numara alan da en usttedir.
      allIdeas = numbered.filter(item => item && /^[a-f0-9]{64}$/.test(item.id) && safeImagePath(item) && !remoteDeleted.has(item.id) && !hiddenIds.has(item.id));
      // Devam eden istekleri eski bir Pages onbellegi geri alamaz.
      for(const item of allIdeas)if(pendingMoves.has(item.id)){
        const move=pendingMoves.get(item.id);
        if(move.archived)item.archived_at=move.timestamp;
        else delete item.archived_at;
      }
      $('syncLabel').textContent = 'Galeri güncel';
      const oldId=ideas[position]?.id;
      refreshView();
      if(!lightbox.hidden && oldId) {
        position=ideas.findIndex(i=>i.id===oldId);
        if(position<0)close();else show();
      }
    } catch(error) {
      if (!ideas.length) { $('emptyView').hidden=true; $('errorView').hidden=false; $('errorText').textContent = `Liste okunamadı: ${error.message}. GitHub Pages ayarlarını kontrol et.`; }
      $('syncLabel').textContent = 'Bağlantı sorunu';
    }
  }
  function open(index) {
    if (index < 0 || index >= ideas.length) return;
    position=index; lightbox.hidden=false; lightbox.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden'; show(); $('closeBtn').focus();
  }
  function show() {
    if (position < 0 || position >= ideas.length) {close();return;}
    $('deleteStatus').hidden=true;$('localGalleryLink').hidden=true;
    const item=ideas[position]; image.src=safeImagePath(item); image.alt=`Türkçe fikir ${item.number}`;
    $('viewerPosition').textContent=String(item.number);
    $('viewerTotal').textContent=`${ideas.length} fikir`;
    $('viewerTime').textContent=fullDate(item.added_at);
    $('viewerTranslation').textContent=item.translation_status==='translated'?(item.translation_engine==='google_image'?'GOOGLE ÇEVİRİ İLE TÜRKÇE':'TÜRKÇE ÇEVİRİ'):'İNGİLİZCE METİN BULUNMADI';
    $('downloadLink').href=safeImagePath(item);
    $('downloadLink').download=`turkce_fikir_${item.id.slice(0,10)}.jpg`;
    $('prevBtn').disabled=ideas.length<2; $('nextBtn').disabled=ideas.length<2;
    $('archiveBtn').disabled=pendingMoves.has(item.id)||pendingDeletes.has(item.id);
    $('archiveLabel').textContent=isArchived(item)?'Geri al':'Arşive at';
    $('archiveBtn').setAttribute('aria-label',isArchived(item)?'Gönderilere geri taşı':'Arşive at');
    const source=originalUrl(item), link=$('viewerOriginal');
    link.hidden=!source;
    if(source)link.href=source;else link.removeAttribute('href');
  }
  function close() {lightbox.hidden=true;lightbox.setAttribute('aria-hidden','true');position=-1;document.body.style.overflow='';image.removeAttribute('src');}
  function move(n) {if(position<0 || ideas.length<2) return;position=(position+n+ideas.length)%ideas.length;show();}
  $('prevBtn').addEventListener('click',()=>move(-1));
  $('nextBtn').addEventListener('click',()=>move(1));
  $('closeBtn').addEventListener('click',close);
  $('postsTab').addEventListener('click',()=>switchView('posts'));
  $('archiveTab').addEventListener('click',()=>switchView('archive'));
  $('archiveBtn').addEventListener('click',()=>{if(position>=0)moveIdea(ideas[position],!isArchived(ideas[position]));});
  $('refreshBtn').addEventListener('click',loadGallery);
  $('retryBtn').addEventListener('click',loadGallery);
  $('errorRetry').addEventListener('click',loadGallery);
  lightbox.addEventListener('click',e=>{if(e.target===lightbox)close();});
  let touchStartX=null;
  lightbox.addEventListener('touchstart',e=>{if(e.touches.length===1)touchStartX=e.touches[0].clientX;},{passive:true});
  lightbox.addEventListener('touchend',e=>{if(touchStartX!=null&&e.changedTouches.length){const diff=e.changedTouches[0].clientX-touchStartX;if(Math.abs(diff)>55)move(diff<0?1:-1);}touchStartX=null;},{passive:true});
  window.addEventListener('keydown',e=>{
    if(lightbox.hidden)return;
    if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}
    if(e.key==='ArrowRight'){e.preventDefault();move(1);}
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Delete'||e.key==='Del'){e.preventDefault();if(!e.repeat)deleteIdea();}
  });

  function mobileClient() {
    // Mobil cihazda localhost bilgisayar degil telefonun kendisidir.
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
           (window.matchMedia && matchMedia('(pointer: coarse)').matches && !['localhost','127.0.0.1'].includes(location.hostname));
  }
  function githubHeaders() {
    if(!githubToken)throw new Error('GitHub yetkilendirmesi gerekli.');
    return {'Accept':'application/vnd.github+json', 'Authorization':`Bearer ${githubToken}`};
  }
  function githubUrl(path) {
    if(!repoConfig?.owner || !repoConfig?.repo || !repoConfig?.branch ||
       !/^[\w.-]+$/.test(repoConfig.owner) || !/^[\w.-]+$/.test(repoConfig.repo) || !/^[\w.-]+$/.test(repoConfig.branch))
      throw new Error('GitHub galeri yapılandırması okunamadı. Sayfayı yenile.');
    return `https://api.github.com/repos/${encodeURIComponent(repoConfig.owner)}/${encodeURIComponent(repoConfig.repo)}/contents/${path}`;
  }
  async function githubRequest(path, opts={}) {
    const response=await fetch(githubUrl(path)+(opts.query||''), {
      method:opts.method||'GET',cache:'no-store', headers:{...githubHeaders(),...(opts.body?{'Content-Type':'application/json'}:{})},
      ...(opts.body?{body:JSON.stringify(opts.body)}:{})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) {
      
      const err=new Error(response.status===401?'Sitedeki GitHub anahtarı geçersiz veya süresi dolmuş. Bilgisayarda KURULUM.bat -> 9 ile yenile.':response.status===403?'GitHub erişim izni yetersiz veya hız sınırına ulaşıldı.':response.status===404?'GitHub deposu veya dosya bulunamadı; anahtarın depo erişimini kontrol et.':`GitHub işlem hatası (HTTP ${response.status}).`);
      err.httpStatus=response.status;
      throw err;
    }
    return payload;
  }
  function utf8ToBase64(value) {
    const bytes=new TextEncoder().encode(value);
    let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(result);
  }
  function base64ToUtf8(value) {
    const raw=atob(value.replace(/\s/g,''));
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async function githubManifest() {
    const obj=await githubRequest('data/manifest.json',{query:`?ref=${encodeURIComponent(repoConfig.branch)}&t=${Date.now()}`});
    if(typeof obj.sha!=='string'||typeof obj.content!=='string')throw new Error('GitHub manifesti doğrudan okunamadı.');
    const manifest=JSON.parse(base64ToUtf8(obj.content));
    if(!Array.isArray(manifest.items)||!Array.isArray(manifest.deleted_ids))throw new Error('Galeri dosyası bozuk; silme iptal edildi.');
    return {manifest,sha:obj.sha};
  }
  async function authorizeGithub() {
    // Sitede ANAHTAR GIRIS EKRANI YOK: once bilgisayarda bir kez 9 ile kurulur.
    if (githubToken) return;
    throw new Error('Siteye doğrudan silme anahtarı yüklenmemiş. Bilgisayarda KURULUM.bat -> 9 ile kur.');
  }
  async function githubDeleteBatch(items) {
    const ids=items.map(i=>i.id), selected=new Set(ids);
    if(ids.length===0||ids.length>500||ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new Error('Geçersiz silme listesi.');
    for(let attempt=0;attempt<4;attempt++) {
      const {manifest,sha}=await githubManifest();
      const listed=new Set(manifest.items.map(i=>i?.id));
      const removed=new Set(manifest.deleted_ids);
      if(ids.some(id=>!listed.has(id)&&!removed.has(id)))throw new Error('Bazı görseller artık galeride bulunmuyor; listeyi yenile.');
      if(ids.every(id=>removed.has(id)))return {deleted:true,ids};
      manifest.deleted_ids=Array.from(new Set([...removed,...selected])).sort();
      manifest.items=manifest.items.filter(i=>!selected.has(i?.id));
      manifest.updated_at=new Date().toISOString();
      let response;
      try {
        const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
        try {
          response=await fetch(githubUrl('data/manifest.json'),{
            method:'PUT',cache:'no-store',signal:controller.signal,headers:{...githubHeaders(),'Content-Type':'application/json'},
            body:JSON.stringify({message:'Galeriden fikirler silindi (yetkili mobil istek)',branch:repoConfig.branch,
              sha,content:utf8ToBase64(JSON.stringify(manifest,null,2)+'\n')})
          });
        } finally {clearTimeout(timer);}
      } catch(error) {
        // Baglanti kopmussa istek GitHub'a ulasmis olabilir; once islenip islenmedigini dogrula.
        try {
          const checked=await githubManifest();
          if(ids.every(id=>checked.manifest.deleted_ids.includes(id))) {
            void githubCleanupImages(ids);return {deleted:true,ids};
          }
        } catch (_) {}
        if(attempt<3)continue;
        throw new Error('GitHub silme kaydi dogrulanamadi. Gorseller geri getirildi; baglantini kontrol et.');
      }
      if(response.status===409 || response.status===422)continue;
      if(!response.ok){
        if(response.status>=500 && attempt<3)continue;
        const err=await response.json().catch(()=>({}));
        throw new Error(`GitHub silme kaydı yazılamadı (HTTP ${response.status}): ${String(err.message||'').slice(0,100)}`);
      }
      // GitHub PUT 200/201: commit alinmis ve kalici kayit yapilmistir. Temizligi bekletme.
      void githubCleanupImages(ids);
      return {deleted:true,ids};
    }
    throw new Error('GitHub galeri listesi eşzamanlı değişiyor. Silmeyi tekrar dene.');
  }
  async function githubCleanupImages(ids) {
    // Yetkili API: yalniz manifest kaydi kesin silinmis kimliklerin dosyalarini temizle.
    for(const id of ids) {
      try {
        const filename=`data/gorseller/${id}.jpg`;
        const info=await githubRequest(filename,{query:`?ref=${encodeURIComponent(repoConfig.branch)}&t=${Date.now()}`});
        const res=await fetch(githubUrl(filename), {method:'DELETE',cache:'no-store',headers:{...githubHeaders(),'Content-Type':'application/json'},
          body:JSON.stringify({message:'Galeriden silinen görsel temizlendi',sha:info.sha,branch:repoConfig.branch})});
        if(!res.ok&&res.status!==404)throw new Error(`HTTP ${res.status}`);
      } catch (_) { /* Silme kaydi kalicidir. Kalan dosya sonradan temizlenebilir. */ }
    }
  }
  // Archive, orijinal JPG yolunu ve original_url degerini ASLA degistirmez.
  async function githubSetArchive(item, archived, timestamp) {
    for(let attempt=0;attempt<4;attempt++) {
      const {manifest,sha}=await githubManifest();
      const found=manifest.items.find(i=>i?.id===item.id);
      if(!found || manifest.deleted_ids.includes(item.id))throw new Error('Görsel galeride bulunamadı. Listeyi yenile.');
      if(isArchived(found)===archived)return;
      if(archived)found.archived_at=timestamp;
      else delete found.archived_at;
      manifest.updated_at=new Date().toISOString();
      let response;
      try {
        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
        try {response=await fetch(githubUrl('data/manifest.json'),{
          method:'PUT',cache:'no-store',signal:controller.signal,
          headers:{...githubHeaders(),'Content-Type':'application/json'},
          body:JSON.stringify({message:archived?'Fikir arsive alindi':'Fikir gonderilere geri alindi',branch:repoConfig.branch,
            sha,content:utf8ToBase64(JSON.stringify(manifest,null,2)+'\n')})
        });} finally {clearTimeout(timer);}
      } catch(error) {
        try {const checked=await githubManifest();
          if(isArchived(checked.manifest.items.find(i=>i?.id===item.id)||{})===archived)return;
        } catch(_) {}
        if(attempt<3)continue;
        throw new Error('Arşiv işleminin kaydı doğrulanamadı. Bağlantını kontrol et.');
      }
      if(response.status===409||response.status===422)continue;
      if(!response.ok)throw new Error(`Arşiv kaydı yazılamadı (HTTP ${response.status}).`);
      return;
    }
    throw new Error('Galeri aynı anda güncelleniyor. Tekrar dene.');
  }
  async function persistArchive(item,archived,timestamp,backend) {
    if(backend==='github')return githubSetArchive(item,archived,timestamp);
    const status=await verifiedManagement();
    const result=await localRequest('/api/archive',{
      method:'POST',headers:{'Content-Type':'application/json','X-Galeri-Nonce':status.nonce},
      body:JSON.stringify({id:item.id,archived})
    });
    if(result.updated!==true||result.id!==item.id||result.archived!==archived)
      throw new Error('Arşiv sonucu doğrulanamadı.');
  }
  async function moveIdea(item,archived) {
    if(!item || pendingMoves.has(item.id) || pendingDeletes.has(item.id))return;
    let backend;
    try {backend=await chooseDeletionBackend();}
    catch(error){toast(error.message,true);return;}
    if(pendingMoves.has(item.id)||pendingDeletes.has(item.id)||!allIdeas.some(i=>i.id===item.id))return;
    const prior=item.archived_at;
    const timestamp=new Date().toISOString();
    pendingMoves.set(item.id,{archived,timestamp});
    if(archived)item.archived_at=timestamp;else delete item.archived_at;
    if(!lightbox.hidden && ideas[position]?.id===item.id)close();
    refreshView();
    try {
      await persistArchive(item,archived,timestamp,backend);
      toast(archived?'Görsel arşive eklendi.':'Görsel gönderilere geri taşındı.');
    } catch(error) {
      const current=allIdeas.find(i=>i.id===item.id);
      if(current){if(prior)current.archived_at=prior;else delete current.archived_at;}
      toast(`Arşiv işlemi yapılamadı; görsel geri getirildi. ${error.message}`,true);
    } finally {
      pendingMoves.delete(item.id);
      refreshView();
    }
  }
  async function chooseDeletionBackend() {
    if(mobileClient()) {await authorizeGithub();return 'github';}
    return 'local';
  }

  function managementUrl() {
    const fallback = 'http://127.0.0.1:8765';
    if (['127.0.0.1','localhost'].includes(location.hostname) && location.protocol === 'http:') return location.origin;
    try {
      const url = new URL(repoConfig?.management_url || fallback);
      if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password) return url.origin;
    } catch (_) {}
    return fallback;
  }
  async function localRequest(path, options = {}, timeout = 180000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(managementUrl() + path, {...options, cache:'no-store', signal:controller.signal});
      let data;
      try {data=await response.json();}
      catch(error){
        if(error.name==='AbortError'||error.name==='TypeError')throw error;
        throw new Error('Galeri yanıtı okunamadı. Tekrar dene.');
      }
      if (!response.ok) throw new Error(data.error || 'Silme işlemi tamamlanamadı.');
      return data;
    } catch (error) {
      if (error.name === 'TypeError' || error.name === 'AbortError') {
        const unavailable = new Error('Galeri yardımcısına ulaşılamadı. KURULUM.bat içinde 8 ile otomasyonsuz silmeyi onar. Tarayıcı yerel bağlantıyı engelliyorsa galeriyi bilgisayarda aç.');
        unavailable.localUnavailable=true;
        throw unavailable;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function verifiedManagement() {
    if(localAuthCache)return localAuthCache;
    const status = await localRequest('/api/status', {}, 5000);
    if (!repoConfig || !['owner','repo','branch'].every(key => status[key] === repoConfig[key]))
      throw new Error('Açık otomasyon farklı bir galeriye bağlı. Kayıtlı GitHub hedefini kontrol et.');
    if (typeof status.nonce !== 'string' || status.nonce.length < 20) throw new Error('Galeri bağlantısı doğrulanamadı.');
    localAuthCache=status;return status;
  }
  async function removeFromRepo(item, backend='local') {
    if(backend==='github') {const result=await githubDeleteBatch([item]);return result.deleted?'Fikir GitHub galerisinden silindi.':'';}
    const status=await verifiedManagement();
    const result = await localRequest('/api/delete', {
      method:'POST', keepalive:true, headers:{'Content-Type':'application/json','X-Galeri-Nonce':status.nonce}, body:JSON.stringify({id:item.id})
    });
    if (result.deleted !== true || result.id !== item.id) throw new Error('Silme sonucu doğrulanamadı. Tekrar dene.');
    return result.message || 'Fikir kalıcı olarak galeriden silindi.';
  }
  async function removeManyFromRepo(items, connection, backend='local') {
    if(backend==='github') {await githubDeleteBatch(items);return;}
    const status=connection.status || (connection.status=await verifiedManagement());
    const ids=items.map(i=>i.id);
    const result=await localRequest('/api/delete-many', {
      method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Galeri-Nonce':status.nonce},body:JSON.stringify({ids})
    });
    const confirmed=new Set(Array.isArray(result.ids)?result.ids:[]);
    if(result.deleted!==true || confirmed.size!==ids.length || !ids.every(id=>confirmed.has(id)))
      throw new Error('Toplu silme sonucu doğrulanamadı. Tekrar dene.');
  }
  function restoreItems(items, error) {
    const viewing=ideas[position]?.id;
    items.forEach(item=>{
      forgetHidden(item.id);
      if(!allIdeas.some(x=>x.id===item.id))allIdeas.push(item);
    });
    allIdeas.sort((a,b)=>(manifestOrder.get(a.id)??Number.MAX_SAFE_INTEGER)-(manifestOrder.get(b.id)??Number.MAX_SAFE_INTEGER) || parseTime(b.added_at)-parseTime(a.added_at));
    refreshView();
    if(viewing){position=ideas.findIndex(x=>x.id===viewing);if(position>=0)show();else close();}
    const label=items.length===1?`Fikir #${items[0].number} silinemedi, geri getirildi.`:`${items.length} görsel silinemedi, geri getirildi.`;
    const message=`${label} ${error.message}`;
    toast(message,true);
    $('deleteError').textContent=message;
    $('deleteStatus').hidden=lightbox.hidden;
    $('localGalleryLink').hidden=!error.localUnavailable;
    $('localGalleryLink').href=managementUrl()+'/';
  }
  // Kisa aralikla art arda tiklanan silmeleri bir manifest commit'inde birlestir.
  // UI hemen gizler; sunucu commit basarili olmadan "kalici silindi" denmez.
  function enqueueDeletion(items, backend) {
    return new Promise((resolve,reject)=>{
      deleteJobs.push({items,backend,resolve,reject});
      if(!deleteFlushTimer && !deletionProcessing)deleteFlushTimer=setTimeout(flushDeletions,220);
    });
  }
  async function flushDeletions() {
    if(deleteFlushTimer){clearTimeout(deleteFlushTimer);deleteFlushTimer=null;}
    if(deletionProcessing)return;
    deletionProcessing=true;
    const connection={};
    try {
      while(deleteJobs.length) {
        const backend=deleteJobs[0].backend;
        const group=[];let size=0;
        while(deleteJobs.length && deleteJobs[0].backend===backend && size+deleteJobs[0].items.length<=500) {
          const job=deleteJobs.shift();group.push(job);size+=job.items.length;
        }
        if(!group.length) { // Koruma: istek basina en cok 500 kayit.
          const job=deleteJobs.shift();job.reject(new Error('Silme grubunda cok fazla gorsel var.'));continue;
        }
        const selected=group.flatMap(job=>job.items);
        try {
          await removeManyFromRepo(selected,connection,backend);
          group.forEach(job=>job.resolve());
        } catch(err) {
          group.forEach(job=>job.reject(err));
        }
      }
    } finally {
      deletionProcessing=false;
      if(deleteJobs.length && !deleteFlushTimer)deleteFlushTimer=setTimeout(flushDeletions,60);
    }
  }
  // Gizlenme/aniden uygulamadan cikma halinde bekleyen silmeleri erkene al.
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'&&deleteJobs.length)void flushDeletions();
  });

  async function deleteIdea() {
    if(position<0 || !ideas[position] || pendingDeletes.has(ideas[position].id) || pendingMoves.has(ideas[position].id))return;
    const current=ideas[position];
    let backend;
    try {backend=await chooseDeletionBackend();}
    catch(error){toast(error.message,true);return;}
    // Bir diger tik veya geri plan sonucunda ayni gorsel zaten yoksa tekrar silme.
    if(pendingDeletes.has(current.id)||!ideas.some(x=>x.id===current.id))return;
    const oldPosition=position;
    pendingDeletes.add(current.id);hiddenIds.add(current.id);
    // Ag istegini beklemeden gorseli ve kartini kaldir. Gezinme serbesttir.
    allIdeas=allIdeas.filter(x=>x.id!==current.id);
    refreshView();
    if(ideas.length){position=Math.min(oldPosition,ideas.length-1);show();}else{close();}toast(`Fikir #${current.number} kaldırıldı; silme arka planda sürüyor.`);
    // 220ms icinde gelen silmeleri tek kalici GitHub kaydina birlestir.
    try {
      await enqueueDeletion([current],backend);
      rememberHidden(current.id);
      if(pendingDeletes.size===1)toast('Silme işlemi tamamlandı.');
    } catch(error) {
      restoreItems([current],error);
    } finally {
      pendingDeletes.delete(current.id);
    }
  }
  async function deleteAllIdeas() {
    if(!ideas.length)return;
    if(activeView==='archive' && !window.confirm(`Arşivdeki ${ideas.length} görsel KALICI olarak silinsin mi? Bu işlem geri alınamaz.`))return;
    // Dugmeye basildigi andaki liste. Sonradan gelen fikirler silinmez.
    const selected=ideas.slice();
    let backend;
    try {backend=await chooseDeletionBackend();}
    catch(error){toast(error.message,true);return;}
    const available=selected.filter(i=>allIdeas.some(x=>x.id===i.id)&&!pendingDeletes.has(i.id)&&!pendingMoves.has(i.id));
    if(!available.length)return;
    available.forEach(i=>{pendingDeletes.add(i.id);hiddenIds.add(i.id);});
    allIdeas=allIdeas.filter(i=>!pendingDeletes.has(i.id));close();refreshView();
    toast(`${available.length} görsel kaldırıldı; toplu silme arka planda sürüyor.`);
    const chunks=[];
    for(let i=0;i<available.length;i+=500)chunks.push(available.slice(i,i+500));
    const results=await Promise.all(chunks.map(async items=>{
      try {await enqueueDeletion(items,backend);items.forEach(i=>rememberHidden(i.id));return true;}
      catch(error){restoreItems(items,error);return false;}
      finally {items.forEach(i=>pendingDeletes.delete(i.id));}
    }));
    if(results.every(Boolean))toast(`${available.length} görsel galeriden silindi.`);
  }
  deleteButton.addEventListener('click',e=>{if(e.detail>1)return;return deleteIdea();});
  $('deleteAllBtn').addEventListener('click',e=>{if(e.detail>1)return;return deleteAllIdeas();});
  (async()=>{
    try {const res=await fetch(`./config.json?t=${Date.now()}`,{cache:'no-store'});if(res.ok)repoConfig=await res.json();}
    catch(e){/* sadece silme için gerekli; liste görüntülenebilir */}
    hydrateHidden();
    await loadGallery();
  })();
  setInterval(()=>{if(lightbox.hidden)loadGallery();},60_000);
  setInterval(()=>{const newest=allIdeas.find(i=>!isArchived(i));if(newest)$('lastIdea').textContent=relativeDate(newest.added_at);},30_000);
})();
