'use strict';
/* R43 — Orijinal baglantisi, aninda ve toplu silme. */
(() => {
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');
  const lightbox = $('lightbox');
  const image = $('viewerImage');
  const deleteButton = $('deleteBtn');
  const imagePathPattern = /^data\/gorseller\/[a-f0-9]{64}\.jpg$/;
  let ideas = [];
  let position = -1;
  const pendingDeletes = new Set();
  let deleteQueue = Promise.resolve();
  let repoConfig = null;
  const hiddenIds = new Set();
  let toastTimeout;

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
  function render() {
    $('deleteAllBtn').disabled=ideas.length===0;
    $('itemCount').textContent = ideas.length.toLocaleString('tr-TR');
    $('headingCount').textContent = ideas.length ? String(ideas.length).padStart(2,'0') : '';
    $('lastIdea').textContent = ideas.length ? relativeDate(ideas[0].added_at) : 'Henüz yok';
    $('lastIdeaFull').textContent = ideas.length ? fullDate(ideas[0].added_at) : 'Yeni fikirler burada görünecek';
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
      base.append(meta,badge);preview.append(photo,number);card.append(preview,base,sourceRow);
      preview.addEventListener('click', () => open(ideas.findIndex(x=>x.id===item.id)));
      batch.appendChild(card);
    });
    gallery.appendChild(batch);
  }
  async function loadGallery() {
    $('syncLabel').textContent = 'Güncelleniyor…';
    try {
      const response = await fetch(`./data/manifest.json?t=${Date.now()}`, {cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('Görsel listesi bozuk');
      const remoteDeleted = new Set(Array.isArray(data.deleted_ids) ? data.deleted_ids : []);
      // R40 galerisi yayin gecisi sirasinda da ayni eski->yeni numaralari gorur.
      // Asil sayac GitHub manifestinde tutulur; silme sayaci geri almaz.
      const numbered = data.items.map(item => item && typeof item === 'object' ? {...item} : null);
      let highest = Number.isSafeInteger(data.last_number) ? data.last_number : 0;
      numbered.forEach(item => {if(item && Number.isSafeInteger(item.number) && item.number>0) highest=Math.max(highest,item.number);});
      numbered.map((item,index)=>({item,index}))
        .filter(({item})=>item && !remoteDeleted.has(item.id))
        .sort((a,b)=>parseTime(a.item.added_at)-parseTime(b.item.added_at) || b.index-a.index)
        .forEach(({item})=>{if(!Number.isSafeInteger(item.number)||item.number<1)item.number=++highest;});
      ideas = numbered.filter(item => item && /^[a-f0-9]{64}$/.test(item.id) && safeImagePath(item) && !remoteDeleted.has(item.id) && !hiddenIds.has(item.id))
        .sort((a,b) => b.number-a.number);
      $('syncLabel').textContent = 'Galeri güncel';
      render();
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
  }
  function close() {lightbox.hidden=true;lightbox.setAttribute('aria-hidden','true');position=-1;document.body.style.overflow='';image.removeAttribute('src');}
  function move(n) {if(position<0 || ideas.length<2) return;position=(position+n+ideas.length)%ideas.length;show();}
  $('prevBtn').addEventListener('click',()=>move(-1));
  $('nextBtn').addEventListener('click',()=>move(1));
  $('closeBtn').addEventListener('click',close);
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
        const unavailable = new Error('Bilgisayardaki galeri bağlantısına ulaşılamadı. Otomasyonu açık tut veya galeriyi bilgisayarda aç.');
        unavailable.localUnavailable=true;
        throw unavailable;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function verifiedManagement() {
    const status = await localRequest('/api/status', {}, 5000);
    if (!repoConfig || !['owner','repo','branch'].every(key => status[key] === repoConfig[key]))
      throw new Error('Açık otomasyon farklı bir galeriye bağlı. Kayıtlı GitHub hedefini kontrol et.');
    if (typeof status.nonce !== 'string' || status.nonce.length < 20) throw new Error('Galeri bağlantısı doğrulanamadı.');
    return status;
  }
  async function removeFromRepo(item) {
    const status=await verifiedManagement();
    const result = await localRequest('/api/delete', {
      method:'POST', keepalive:true, headers:{'Content-Type':'application/json','X-Galeri-Nonce':status.nonce}, body:JSON.stringify({id:item.id})
    });
    if (result.deleted !== true || result.id !== item.id) throw new Error('Silme sonucu doğrulanamadı. Tekrar dene.');
    return result.message || 'Fikir kalıcı olarak galeriden silindi.';
  }
  async function removeManyFromRepo(items, connection) {
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
      hiddenIds.delete(item.id);
      if(!ideas.some(x=>x.id===item.id))ideas.push(item);
    });
    ideas.sort((a,b)=>b.number-a.number);
    if(viewing){position=ideas.findIndex(x=>x.id===viewing);show();}
    render();
    const label=items.length===1?`Fikir #${items[0].number} silinemedi, geri getirildi.`:`${items.length} görsel silinemedi, geri getirildi.`;
    const message=`${label} ${error.message}`;
    toast(message,true);
    $('deleteError').textContent=message;
    $('deleteStatus').hidden=lightbox.hidden;
    $('localGalleryLink').hidden=!error.localUnavailable;
    $('localGalleryLink').href=managementUrl()+'/';
  }
  async function deleteIdea() {
    if(position<0 || !ideas[position] || pendingDeletes.has(ideas[position].id))return;
    const current=ideas[position];
    const oldPosition=position;
    pendingDeletes.add(current.id);hiddenIds.add(current.id);
    // Ag istegini beklemeden gorseli ve kartini kaldir. Gezinme serbesttir.
    ideas=ideas.filter(x=>x.id!==current.id);
    if(ideas.length){position=Math.min(oldPosition,ideas.length-1);show();}else{close();}
    render();toast(`Fikir #${current.number} kaldırıldı; silme arka planda sürüyor.`);
    // GitHub degisikliklerini sirayla yap; her kart ekrandan aninda kalkar.
    const task=deleteQueue.then(()=>removeFromRepo(current));
    deleteQueue=task.catch(()=>{});
    try {
      await task;
      if(pendingDeletes.size===1)toast('Silme işlemi tamamlandı.');
    } catch(error) {
      restoreItems([current],error);
    } finally {
      pendingDeletes.delete(current.id);
    }
  }
  async function deleteAllIdeas() {
    if(!ideas.length)return;
    // Dugmeye basildigi andaki liste. Sonradan gelen fikirler silinmez.
    const selected=ideas.slice();
    selected.forEach(i=>{pendingDeletes.add(i.id);hiddenIds.add(i.id);});
    ideas=[];close();render();
    toast(`${selected.length} görsel kaldırıldı; toplu silme arka planda sürüyor.`);
    const chunks=[];
    const connection={};
    for(let i=0;i<selected.length;i+=500)chunks.push(selected.slice(i,i+500));
    const results=await Promise.all(chunks.map(async items=>{
      const task=deleteQueue.then(()=>removeManyFromRepo(items,connection));
      deleteQueue=task.catch(()=>{});
      try {await task;return true;}
      catch(error){restoreItems(items,error);return false;}
      finally {items.forEach(i=>pendingDeletes.delete(i.id));}
    }));
    if(results.every(Boolean))toast(`${selected.length} görsel galeriden silindi.`);
  }
  deleteButton.addEventListener('click',e=>{if(e.detail>1)return;return deleteIdea();});
  $('deleteAllBtn').addEventListener('click',e=>{if(e.detail>1)return;return deleteAllIdeas();});
  (async()=>{
    try {const res=await fetch(`./config.json?t=${Date.now()}`,{cache:'no-store'});if(res.ok)repoConfig=await res.json();}
    catch(e){/* sadece silme için gerekli; liste görüntülenebilir */}
    await loadGallery();
  })();
  setInterval(()=>{if(lightbox.hidden)loadGallery();},60_000);
  setInterval(()=>{if(ideas.length)$('lastIdea').textContent=relativeDate(ideas[0].added_at);},30_000);
})();
