'use strict';
/* R26 — GitHub Pages üzerinde çalışan statik, bağımsız galeri. Gizli token içermez. */
(() => {
  const $ = id => document.getElementById(id);
  const gallery = $('gallery');
  const lightbox = $('lightbox');
  const image = $('viewerImage');
  const dialog = $('deleteOverlay');
  const deleteError = $('deleteError');
  const deleteApprove = $('approveDelete');
  const imagePathPattern = /^data\/gorseller\/[a-f0-9]{64}\.jpg$/;
  let ideas = [];
  let position = -1;
  let adminToken = ''; // yalnız RAM; localStorage, cookie, GitHub repoya asla yazılmaz
  let deleting = false;
  let repoConfig = null;
  const hiddenIds = new Set();
  let toastTimeout;

  function safeImagePath(item) {
    return item && typeof item.image === 'string' && imagePathPattern.test(item.image) ? './' + item.image : null;
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
      card.setAttribute('aria-label', `Fikir ${index+1}; ${fullDate(item.added_at)}; büyüt`);
      const photo = newTag('img'); photo.src = safeImagePath(item);
      photo.loading = index < 7 ? 'eager' : 'lazy'; photo.decoding='async'; photo.alt=`Türkçeye çevrilmiş fikir ${index+1}`;
      const number = newTag('span','card-index',String(index+1).padStart(2,'0'));
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
      ideas = data.items.filter(item => item && /^[a-f0-9]{64}$/.test(item.id) && safeImagePath(item) && !remoteDeleted.has(item.id) && !hiddenIds.has(item.id))
        .sort((a,b) => parseTime(b.added_at)-parseTime(a.added_at));
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
    const item=ideas[position]; image.src=safeImagePath(item); image.alt=`Türkçe fikir ${position+1}`;
    $('viewerPosition').textContent=`${position+1} / ${ideas.length}`;
    $('viewerTime').textContent=fullDate(item.added_at);
    $('viewerTranslation').textContent=item.translation_status==='translated'?'YAPAY ZEKÂ İLE TÜRKÇE':'İNGİLİZCE METİN BULUNMADI';
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
    if(!dialog.hidden){if(e.key==='Escape'&&!deleting){e.preventDefault();hideDelete();}return;}
    if(lightbox.hidden)return;
    if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}
    if(e.key==='ArrowRight'){e.preventDefault();move(1);}
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Delete'||e.key==='Del'){e.preventDefault();askDelete();}
  });

  function askDelete() {
    if(position<0 || !ideas[position])return;
    deleteError.hidden=true;deleteError.textContent='';
    $('tokenContainer').hidden=Boolean(adminToken);
    $('githubToken').value='';
    dialog.hidden=false;
    if(adminToken) $('approveDelete').focus(); else $('githubToken').focus();
  }
  function hideDelete() {if(deleting)return;dialog.hidden=true;$('deleteBtn').focus();}
  $('deleteBtn').addEventListener('click',askDelete);
  $('cancelDelete').addEventListener('click',hideDelete);
  dialog.addEventListener('click',e=>{if(e.target===dialog)hideDelete();});

  function apiUrl(path) {
    if(!repoConfig || !/^[\w.-]+$/.test(repoConfig.owner)|| !/^[\w.-]+$/.test(repoConfig.repo) || !/^[\w.-]+$/.test(repoConfig.branch))
      throw new Error('GitHub depo ayarı eksik: config.json yüklenemedi.');
    return `https://api.github.com/repos/${encodeURIComponent(repoConfig.owner)}/${encodeURIComponent(repoConfig.repo)}/contents/${path}`;
  }
  async function ghRequest(method,path,token,body) {
    const res=await fetch(apiUrl(path)+(method==='GET'?`?ref=${encodeURIComponent(repoConfig.branch)}`:''),{
      method,headers:{'Authorization':`Bearer ${token}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'
    });
    if(!res.ok) {
      const details=await res.json().catch(()=>({}));
      const error=new Error(res.status===401?'GitHub token geçersiz.':res.status===403?'Token izni yetersiz veya GitHub erişim sınırı aşıldı.':res.status===404?'GitHub repo ya da dosya bulunamadı.':`GitHub hata ${res.status}: ${details.message||'İşlem yapılamadı'}`);
      error.status=res.status;throw error;
    }
    return await res.json();
  }
  function encodeBase64Unicode(value){return btoa(Array.from(new TextEncoder().encode(value),b=>String.fromCharCode(b)).join(''));}
  function decodeBase64Unicode(value){const bytes=Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);}
  async function removeFromRepo(item,token) {
    for(let attempt=0;attempt<4;attempt++) {
      const file=await ghRequest('GET','data/manifest.json',token);
      const content=JSON.parse(decodeBase64Unicode(file.content));
      if(!Array.isArray(content.items))throw new Error('Manifest formatı bozuk; silme durduruldu.');
      const oldDeleted=Array.isArray(content.deleted_ids)?content.deleted_ids:[];
      content.deleted_ids=Array.from(new Set([...oldDeleted,item.id]));
      content.items=content.items.filter(x=>x.id!==item.id);
      content.updated_at=new Date().toISOString();
      try {
        await ghRequest('PUT','data/manifest.json',token,{message:'Galeriden görsel silindi',content:encodeBase64Unicode(JSON.stringify(content,null,2)+'\n'),sha:file.sha,branch:repoConfig.branch});
        // Önce tombstone'u kaydetmek hayati: tarayıcı otomasyonu tekrar yayımlayamaz.
        try {
          const imageRecord=await ghRequest('GET',item.image,token);
          await ghRequest('DELETE',item.image,token,{message:'Galeriden silinen resim temizlendi',sha:imageRecord.sha,branch:repoConfig.branch});
        } catch(cleanupError) {
          // Tombstone zaten kayıtlı: görüntü sitede listelenmez. Gizli dosyayı sonraki GitHub işleminde kaldırabilir.
          console.warn('Silinmiş görselin dosyası temizlenemedi:',cleanupError);
          return 'Görsel galeriden silindi; resim dosyası GitHub’da kalmış olabilir.';
        }
        return 'Fikir kalıcı olarak galeriden silindi.';
      } catch(error) {
        if((error.status===409||error.status===422)&&attempt<3)continue;
        throw error;
      }
    }
    throw new Error('Silme sırasında sürekli dosya çakışması oldu.');
  }
  $('approveDelete').addEventListener('click',async()=>{
    if(deleting || position<0)return;
    const token=adminToken || $('githubToken').value.trim();
    if(!token){deleteError.textContent='Lütfen GitHub erişim anahtarını gir.';deleteError.hidden=false;return;}
    const current=ideas[position];deleting=true;deleteApprove.disabled=true;deleteApprove.textContent='Siliniyor…';deleteError.hidden=true;
    try {
      const result=await removeFromRepo(current,token);
      adminToken=token;
      hiddenIds.add(current.id);
      ideas=ideas.filter(x=>x.id!==current.id);
      dialog.hidden=true; deleting=false;
      if(ideas.length){position=Math.min(position,ideas.length-1);show();}else{close();}
      render();toast(result);
    } catch(err){deleteError.textContent=err.message;deleteError.hidden=false;}
    finally{deleting=false;deleteApprove.disabled=false;deleteApprove.textContent='Evet, sil';}
  });
  // Klavye ile tam erişilebilir modal: tab odağını sayfaya kaçırma.
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const controls=Array.from(dialog.querySelectorAll('input:not([hidden]),button:not([disabled])')).filter(el=>el.offsetParent!==null);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  (async()=>{
    try {const res=await fetch(`./config.json?t=${Date.now()}`,{cache:'no-store'});if(res.ok)repoConfig=await res.json();}
    catch(e){/* sadece silme için gerekli; liste görüntülenebilir */}
    await loadGallery();
  })();
  setInterval(()=>{if(dialog.hidden && lightbox.hidden)loadGallery();},60_000);
  setInterval(()=>{if(ideas.length)$('lastIdea').textContent=relativeDate(ideas[0].added_at);},30_000);
})();
