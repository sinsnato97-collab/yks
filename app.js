'use strict';
/* R41 — Anahtar girmeden silme: bilgisayardaki otomasyon baglantisi. */
(() => {
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');
  const lightbox = $('lightbox');
  const image = $('viewerImage');
  const deleteButton = $('deleteBtn');
  const deleteLabel = $('deleteLabel');
  const imagePathPattern = /^data\/gorseller\/[a-f0-9]{64}\.jpg$/;
  let ideas = [];
  let position = -1;
  let deleting = false;
  let repoConfig = null;
  const hiddenIds = new Set();
  let toastTimeout;

  function safeImagePath(item) {
    return item && typeof item.image === 'string' && imagePathPattern.test(item.image) ? (repoConfig?.image_base || './') + item.image : null;
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
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => {el.hidden = true;}, 4100);
  }
  function newTag(tag, cls, value) { const el = document.createElement(tag); if(cls)el.className=cls; if(value != null)el.textContent=value; return el; }
  function render() {
    $('itemCount').textContent = ideas.length.toLocaleString('tr-TR');
    $('headingCount').textContent = ideas.length ? String(ideas.length).padStart(2,'0') : '';
    $('lastIdea').textContent = ideas.length ? relativeDate(ideas[0].added_at) : 'Henüz yok';
    $('lastIdeaFull').textContent = ideas.length ? fullDate(ideas[0].added_at) : 'Yeni fikirler burada görünecek';
    gallery.replaceChildren();
    $('emptyView').hidden = ideas.length > 0;
    $('errorView').hidden = true;
    const batch = document.createDocumentFragment();
    ideas.forEach((item, index) => {
      const card = newTag('button','idea-card'); card.type='button';
      card.setAttribute('aria-label', `Fikir ${item.number}; ${fullDate(item.added_at)}; büyüt`);
      const photo = newTag('img'); photo.src = safeImagePath(item);
      photo.loading = index < 7 ? 'eager' : 'lazy'; photo.decoding='async'; photo.alt=`Türkçeye çevrilmiş fikir ${item.number}`;
      const number = newTag('span','card-index','#' + item.number);
      const base = newTag('div','card-base');
      const meta = newTag('span','card-meta',shortDate(item.added_at));
      const badge = newTag('span',item.translation_status==='translated'?'card-badge':'card-badge neutral',item.translation_status==='translated'?'✳ TÜRKÇE':'○ METİN YOK');
      base.append(meta,badge); card.append(photo,number,base);
      card.addEventListener('click', () => open(index));
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
    if (!deleting) {$('deleteStatus').hidden=true;$('localGalleryLink').hidden=true;}
    const item=ideas[position]; image.src=safeImagePath(item); image.alt=`Türkçe fikir ${item.number}`;
    $('viewerPosition').textContent=String(item.number);
    $('viewerTotal').textContent=`${ideas.length} fikir`;
    $('viewerTime').textContent=fullDate(item.added_at);
    $('viewerTranslation').textContent=item.translation_status==='translated'?(item.translation_engine==='google_image'?'GOOGLE ÇEVİRİ İLE TÜRKÇE':'TÜRKÇE ÇEVİRİ'):'İNGİLİZCE METİN BULUNMADI';
    $('downloadLink').href=safeImagePath(item);
    $('downloadLink').download=`turkce_fikir_${item.id.slice(0,10)}.jpg`;
    $('prevBtn').disabled=deleting||ideas.length<2; $('nextBtn').disabled=deleting||ideas.length<2;
  }
  function close() {if(deleting)return;lightbox.hidden=true;lightbox.setAttribute('aria-hidden','true');position=-1;document.body.style.overflow='';image.removeAttribute('src');}
  function move(n) {if(deleting||position<0 || ideas.length<2) return;position=(position+n+ideas.length)%ideas.length;show();}
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
    if(lightbox.hidden || deleting)return;
    if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}
    if(e.key==='ArrowRight'){e.preventDefault();move(1);}
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Delete'||e.key==='Del'){e.preventDefault();deleteIdea();}
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Silme işlemi tamamlanamadı.');
      return data;
    } catch (error) {
      if (error.name === 'TypeError' || error.name === 'AbortError') {
        $('localGalleryLink').hidden = false;
        $('localGalleryLink').href = managementUrl() + '/';
        throw new Error('Bilgisayardaki galeri bağlantısına ulaşılamadı. Otomasyonu açık tut veya aşağıdan galeriyi bilgisayarda aç.');
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function removeFromRepo(item) {
    const status = await localRequest('/api/status', {}, 5000);
    if (!repoConfig || !['owner','repo','branch'].every(key => status[key] === repoConfig[key]))
      throw new Error('Açık otomasyon farklı bir galeriye bağlı. Kayıtlı GitHub hedefini kontrol et.');
    if (typeof status.nonce !== 'string' || status.nonce.length < 20) throw new Error('Galeri bağlantısı doğrulanamadı.');
    const result = await localRequest('/api/delete', {
      method:'POST', headers:{'Content-Type':'application/json','X-Galeri-Nonce':status.nonce}, body:JSON.stringify({id:item.id})
    });
    if (result.deleted !== true || result.id !== item.id) throw new Error('Silme sonucu doğrulanamadı. Tekrar dene.');
    return result.message || 'Fikir kalıcı olarak galeriden silindi.';
  }
  async function deleteIdea() {
    if(deleting || position<0 || !ideas[position])return;
    const current=ideas[position];
    const oldPosition=position;
    deleting=true;
    deleteButton.disabled=true; deleteLabel.textContent='Siliniyor…';
    $('closeBtn').disabled=true; $('prevBtn').disabled=true; $('nextBtn').disabled=true;
    $('deleteStatus').hidden=true; $('localGalleryLink').hidden=true;
    try {
      const result=await removeFromRepo(current);
      hiddenIds.add(current.id);
      ideas=ideas.filter(x=>x.id!==current.id);
      deleting=false;
      if(ideas.length){position=Math.min(oldPosition,ideas.length-1);show();}else{close();}
      render();toast(result);
    } catch(error) {
      $('deleteError').textContent=error.message;
      $('deleteStatus').hidden=false;
    } finally {
      deleting=false; deleteButton.disabled=false; deleteLabel.textContent='Sil';
      $('closeBtn').disabled=false;
      if(position>=0){$('prevBtn').disabled=ideas.length<2; $('nextBtn').disabled=ideas.length<2;}
    }
  }
  deleteButton.addEventListener('click',deleteIdea);
  (async()=>{
    try {const res=await fetch(`./config.json?t=${Date.now()}`,{cache:'no-store'});if(res.ok)repoConfig=await res.json();}
    catch(e){/* sadece silme için gerekli; liste görüntülenebilir */}
    await loadGallery();
  })();
  setInterval(()=>{if(!deleting && lightbox.hidden)loadGallery();},60_000);
  setInterval(()=>{if(ideas.length)$('lastIdea').textContent=relativeDate(ideas[0].added_at);},30_000);
})();
