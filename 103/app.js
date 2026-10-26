const $=s=>document.querySelector(s);
const state={
  user:null,deal:'',category:'',query:'',coords:null,sort:'soon',
  listings:[],pendingListing:null,authMode:'login',authRole:'customer',adminData:null,adminTab:'overview',adminSearch:''
};
const roleNames={customer:'Foydalanuvchi',partner:'Hamkor',donor:'Kiyim ulashuvchi oila',volunteer:'Ko‘ngilli',admin:'Administrator'};
const categoryNames={meal:'Tayyor taom',grocery:'Mahsulot',clothing:'Kiyim'};
const photo={
  meal:'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format',
  grocery:'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format',
  clothing:'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80'
};
const fallbackPhoto='https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format';
function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function money(value){
  const n=Number(value)||0;
  return new Intl.NumberFormat('uz-UZ').format(n)+' so‘m';
}
function dateLabel(value,withTime=true){
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '—';
  return new Intl.DateTimeFormat('uz-UZ',withTime
    ?{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}
    :{day:'numeric',month:'long'}).format(d);
}
function timeLabel(value){
  const d=new Date(value);
  return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('uz-UZ',{
    hour:'2-digit',minute:'2-digit'
  }).format(d);
}
function toast(message,type='success'){
  const node=document.createElement('div');
  node.className='toast'+(type==='error'?' toast-error':'');
  node.textContent=message;
  $('#toast-region').append(node);
  setTimeout(()=>node.remove(),4300);
}
async function api(path,options={}){
  const headers={'content-type':'application/json',...(options.headers||{})};
  const response=await fetch(path,{credentials:'same-origin',...options,headers});
  let data={};
  try{data=await response.json()}catch{}
  if(!response.ok)throw new Error(data.error||'So‘rov bajarilmadi.');
  return data;
}
function setUser(user){
  state.user=user||null;
  $('#auth-open').hidden=!!state.user;
  $('#account-open').hidden=!state.user;
  $('#partner-open').textContent=state.user&&['partner','donor'].includes(state.user.role)
    ?'E’lon joylash':'Ulashish';
  $('#mobile-auth-open').hidden=!!state.user;
  $('#mobile-account-open').hidden=!state.user;
  $('#mobile-share-open').textContent=state.user&&['partner','donor'].includes(state.user.role)
    ?'E’lon joylash':'Ulashish';
  if(!state.user)$('#workspace').hidden=true;
}
function updateStats(data){
  $('#metric-saved').textContent=new Intl.NumberFormat('uz-UZ').format(data.rescuedPortions||0);
  $('#metric-listings').textContent=new Intl.NumberFormat('uz-UZ').format(data.openListings||0);
  $('#metric-partners').textContent=new Intl.NumberFormat('uz-UZ').format(data.partners||0);
  $('#metric-weight').textContent=data.rescuedGrams>=1000
    ?(data.rescuedGrams/1000).toLocaleString('uz-UZ',{maximumFractionDigits:1})+' kg'
    :new Intl.NumberFormat('uz-UZ').format(data.rescuedGrams||0)+' g';
}
function listingUrl(){
  const params=new URLSearchParams();
  if(state.query)params.set('q',state.query);
  if(state.deal)params.set('deal',state.deal);
  if(state.category)params.set('category',state.category);
  if(state.coords){
    params.set('lat',String(state.coords.lat));
    params.set('lon',String(state.coords.lon));
  }
  return '/api/listings?'+params.toString();
}
function sortListings(rows){
  const items=[...rows];
  if(state.sort==='price')items.sort((a,b)=>a.price-b.price);
  else if(state.sort==='distance'&&state.coords)
    items.sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity));
  else items.sort((a,b)=>new Date(a.pickupEnd)-new Date(b.pickupEnd));
  return items;
}
function listingCard(item){
  const id=Number(item.id),src=item.imageUrl||photo[item.category]||fallbackPhoto;
  const isClothing=item.category==='clothing';
  const price=item.price===0
    ?'<span class="price-main price-free">Bepul</span>'
    :'<span><b class="price-main">'+money(item.price)+'</b>'+
      (item.originalPrice>item.price
       ?'<span class="price-old">'+money(item.originalPrice)+'</span>':'')+'</span>';
  const distance=item.distanceKm==null?'':Number(item.distanceKm).toFixed(1)+' km';
  const pickup=dateLabel(item.pickupStart);
  const deal=item.dealType==='free'?'BEPUL':'CHEGIRMA';
  const sizeLine=isClothing
    ?'<b>'+escapeHtml(item.ageGroup==='child'?'Bolalar':item.ageGroup==='baby'?'Go‘daklar':'Kattalar')+
      ' · '+escapeHtml(item.clothingSize)+' · '+escapeHtml(item.clothingCondition||'Holati ko‘rsatilmagan')+'</b>'
    :'<b>'+escapeHtml(item.pickupAddress)+'</b>';
  const countdownEnd=new Date(item.pickupEnd).getTime();
  const mapLink=item.latitude!=null&&item.longitude!=null
    ?'<a class="map-link" href="https://www.openstreetmap.org/?mlat='+encodeURIComponent(item.latitude)+
      '&mlon='+encodeURIComponent(item.longitude)+'#map=17/'+encodeURIComponent(item.latitude)+'/'+
      encodeURIComponent(item.longitude)+'" target="_blank" rel="noopener noreferrer">Xaritada ↗</a>':'';
  return '<article class="food-card" data-testid="listing-card">'+
    '<div class="food-cover"><img data-cover src="'+escapeHtml(src)+'" alt="" loading="lazy">'+
    '<span class="deal-badge">'+deal+'</span>'+
    '<span class="stock-badge">'+Number(item.portionsAvailable)+(isClothing?' dona':' porsiya')+' qoldi</span>'+
    '<span class="countdown" data-countdown="'+countdownEnd+'">Vaqt hisoblanmoqda…</span></div>'+
    '<div class="food-content"><div class="food-meta"><span>'+
    escapeHtml(categoryNames[item.category]||'Taom')+'</span><span>'+
    escapeHtml(item.area)+(distance?' · '+distance:'')+'</span></div>'+
    '<h3 class="food-title">'+escapeHtml(item.title)+'</h3>'+
    '<div class="food-partner">'+escapeHtml(item.partnerName||'Mahalliy hamkor')+
      (item.isCommunityDonor?'<span class="community-badge">Oila ulashuvi</span>':item.partnerVerified?'<span class="verified-badge">Tasdiqlangan</span>':'<span class="unverified-badge">Tekshirilmagan</span>')+'</div>'+ 
    '<p class="food-desc">'+escapeHtml(item.description)+'</p>'+
    '<div class="food-details"><div class="food-detail"><small>OLIB KETISH</small>'+
    '<b>'+escapeHtml(pickup)+'</b></div><div class="food-detail"><small>'+(isClothing?'O‘LCHAM / HOLATI':'MANZIL')+'</small>'+ 
    sizeLine+mapLink+'</div></div>'+ 
    '<div class="food-bottom">'+price+
    '<button class="button button-green reserve-button" data-reserve="'+id+'" '+(countdownEnd<=Date.now()?'disabled':'')+'>Band qilish →</button>'+ 
    '</div><button class="report-link" data-report="'+id+'">E’lon haqida xabar berish</button></div></article>';
}
function renderListings(rows){
  const grid=$('#listing-grid'),empty=$('#empty-state');
  const items=sortListings(rows);
  grid.innerHTML=items.map(listingCard).join('');
  $('#results-label').textContent=items.length
    ?items.length+' ta e’lon topildi':'Hozircha e’lon yo‘q';
  empty.hidden=items.length>0;
  $('#loading-state').hidden=true;
  $('#error-state').hidden=true;
  startCountdowns();
}
function startCountdowns(){
  clearInterval(window.ulashCountdownTimer);
  const tick=()=>document.querySelectorAll('[data-countdown]').forEach(node=>{
    const left=Math.max(0,Number(node.dataset.countdown)-Date.now());
    if(!left){node.textContent='Vaqt tugadi';node.classList.add('countdown-ended');
      const card=node.closest('.food-card');if(card)card.querySelector('.reserve-button').disabled=true;return}
    const total=Math.floor(left/1000),days=Math.floor(total/86400),hours=Math.floor(total%86400/3600),
      minutes=Math.floor(total%3600/60),seconds=total%60;
    node.textContent='Yakunlanishiga '+(days?days+' kun ':'')+
      [hours,minutes,seconds].map(n=>String(n).padStart(2,'0')).join(':');
  });
  tick();window.ulashCountdownTimer=setInterval(tick,1000);
}
async function loadLeaderboard(){
  const target=$('#partner-leaderboard');
  try{
    const data=await api('/api/partners/top'),rows=data.partners||[];
    target.innerHTML=rows.length?rows.map((p,index)=>'<article class="leader-card">'+
      '<span class="leader-rank">'+String(index+1).padStart(2,'0')+'</span><div class="leader-main">'+
      '<h3>'+escapeHtml(p.organization||'Mahalliy hamkor')+(p.verified?'<span class="verified-badge">Tekshirilgan</span>':'<span class="unverified-badge">Tekshiruv kutilmoqda</span>')+'</h3>'+ 
      '<p>'+escapeHtml(p.area||'Hudud ko‘rsatilmagan')+'</p></div><div class="leader-stat"><b>★ '+(p.rating==null?'Yangi':Number(p.rating).toFixed(1))+'</b><small>'+Number(p.reviewCount)+' baho</small></div>'+
      '<div class="leader-stat"><b>'+Number(p.rescued)+'</b><small>olib ketilgan</small></div></article>').join(''):
      '<div class="empty-state leader-empty"><b>Reyting uchun hali ma’lumot yo‘q</b><p>Hamkorlar taom ulashib, foydalanuvchilar baho bergach reyting ko‘rinadi.</p></div>';
  }catch{target.innerHTML='<div class="empty-state leader-empty">Reytingni hozircha yuklab bo‘lmadi.</div>'}
}
async function loadListings(){
  $('#loading-state').hidden=false;
  $('#error-state').hidden=true;
  $('#empty-state').hidden=true;
  try{
    const data=await api(listingUrl());
    state.listings=data.listings||[];
    renderListings(state.listings);
  }catch(error){
    $('#loading-state').hidden=true;
    $('#error-state').hidden=false;
    $('#error-message').textContent=error.message;
  }
}
async function loadImpact(){
  try{updateStats(await api('/api/impact'))}
  catch{
    $('#metric-saved').textContent='—';
    $('#metric-listings').textContent='—';
    $('#metric-partners').textContent='—';
  }
}
function updateFilterButtons(){
  document.querySelectorAll('[data-deal]').forEach(button=>{
    button.classList.toggle('active',button.dataset.deal===state.deal);
  });
  document.querySelectorAll('[data-category]').forEach(button=>{
    button.classList.toggle('active',button.dataset.category===state.category);
  });
}
function getLocalDate(offsetMinutes){
  const d=new Date(Date.now()+offsetMinutes*60000);
  d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  return d.toISOString().slice(0,16);
}
function openAuth(mode='login',role='customer'){
  state.authMode=mode;state.authRole=role;
  renderAuth();
  const dialog=$('#auth-modal');
  if(!dialog.open)dialog.showModal();
}
function renderAuth(){
  const isRegister=state.authMode==='register';
  const content=$('#auth-content');
  content.innerHTML=
    '<div class="modal-kicker">ULASH</div>'+ 
    '<h2 class="modal-title" id="auth-title">'+
      (isRegister?'Akkaunt yarating':'Kirish')+'</h2>'+ 
    '<p class="modal-description">'+
      (isRegister?'Telefon raqamingiz va parolingizni kiriting.':
       'Telefon raqam va parolingizni kiriting.')+'</p>'+ 
    '<div class="auth-switch"><button type="button" data-auth-mode="login" class="'+
      (!isRegister?'active':'')+'">Kirish</button><button type="button" data-auth-mode="register" class="'+
      (isRegister?'active':'')+'">Ro‘yxatdan o‘tish</button></div>'+
    '<form id="auth-form"><div class="form-grid">'+
    (isRegister?'<div class="form-field full"><label for="auth-name">Ism</label>'+
      '<input id="auth-name" name="name" autocomplete="name" required minlength="2" maxlength="70"></div>':'')+
    '<div class="form-field full"><label for="auth-phone">Telefon raqam</label>'+ 
      '<input id="auth-phone" name="phone" type="tel" autocomplete="tel" placeholder="Masalan: 901234567" required></div>'+ 
    '<div class="form-field full"><label for="auth-password">Parol</label>'+
      '<input id="auth-password" name="password" type="password" autocomplete="'+
      (isRegister?'new-password':'current-password')+'" minlength="'+(isRegister?'10':'1')+
      '" maxlength="128" required></div>'+
    (isRegister?'<div class="form-field full"><label for="auth-role">Akkaunt turi</label>'+
      '<select id="auth-role" name="role"><option value="customer">Taom izlayman</option>'+
      '<option value="partner">Kafe yoki do‘konman</option>'+
      '<option value="donor">Oilamdan kiyim ulashaman</option>'+ 
      '<option value="volunteer">Ko‘ngilli yetkazuvchiman</option></select></div>'+
      '<div class="form-field full" id="organization-field"><label for="auth-organization">Tashkilot nomi</label>'+
      '<input id="auth-organization" name="organization" maxlength="100"></div>'+
      '<div class="form-field full" id="area-field"><label for="auth-area">Hudud (shahar yoki tuman)</label>'+
      '<input id="auth-area" name="area" maxlength="80" placeholder="Masalan, Yunusobod"></div>'+
      '<div class="form-field full" id="transport-field"><label for="auth-transport">Yetkazish usuli</label>'+
      '<select id="auth-transport" name="transport"><option value="Piyoda">Piyoda</option>'+
      '<option value="Velosiped">Velosiped</option><option value="Avtomobil">Avtomobil</option>'+
      '<option value="Boshqa">Boshqa</option></select></div>'+ 
      '<div class="form-field full" id="partner-terms-field"><label class="check-field"><input type="checkbox" name="partnerTermsAccepted" value="yes">'+
      '<span>Hamkorlik qoidalari va e’lon ma’lumotlarining to‘g‘riligini tasdiqlayman. Bu bayonot mustaqil yuridik tekshiruv o‘rnini bosmaydi.</span></label></div>':'')+
    (isRegister?'<div class="form-field full" id="donor-terms-field"><label class="check-field"><input type="checkbox" name="donorTermsAccepted" value="yes">'+
      '<span>Faqat bepul kiyim ulashaman; kiyim toza va tavsifdagi holatga mos. Aniq uy manzili banddan keyin ko‘rsatilishini tushundim.</span></label></div>':'')+
    '</div><p class="form-error" id="auth-error" hidden></p>'+
    '<button class="button button-dark form-submit" type="submit">'+
      (isRegister?'Akkaunt yaratish →':'Kirish →')+'</button>'+
    (isRegister?'<p class="form-legal">Telefon raqam hozircha SMS-kod bilan tasdiqlanmaydi. '+
      'Akkauntingizga kuchli parol tanlang.</p>':'')+'</form>';
  if(isRegister){
    const select=$('#auth-role');
    select.value=state.authRole;
    select.addEventListener('change',toggleRoleFields);
    toggleRoleFields();
  }
}
function toggleRoleFields(){
  const role=$('#auth-role').value;
  const org=$('#organization-field'),area=$('#area-field'),transport=$('#transport-field'),terms=$('#partner-terms-field'),donorTerms=$('#donor-terms-field');
  org.hidden=role!=='partner';
  area.hidden=role==='customer';
  transport.hidden=role!=='volunteer';
  terms.hidden=role!=='partner';
  donorTerms.hidden=role!=='donor';
  $('#auth-organization').required=role==='partner';
  $('#auth-area').required=role!=='customer';
  $('#auth-transport').required=role==='volunteer';
  $('#partner-terms-field input').required=role==='partner';
  $('#donor-terms-field input').required=role==='donor';
}
async function submitAuth(form){
  const isRegister=state.authMode==='register';
  const body=Object.fromEntries(new FormData(form).entries());
  body.partnerTermsAccepted=body.partnerTermsAccepted==='yes';
  body.donorTermsAccepted=body.donorTermsAccepted==='yes';
  const error=$('#auth-error');
  error.hidden=true;
  try{
    const data=await api(isRegister?'/api/auth/register':'/api/auth/login',{
      method:'POST',body:JSON.stringify(body)
    });
    setUser(data.user);
    $('#auth-modal').close();
    toast(isRegister?'Akkauntingiz yaratildi.':'Tizimga muvaffaqiyatli kirdingiz.');
    if(state.pendingListing&&data.user.role==='customer'){
      const id=state.pendingListing;state.pendingListing=null;openReserve(id);
    }else if(['partner','donor'].includes(data.user.role)&&isRegister){
      state.pendingListing=null;
      openListingForm();
    }else{
      state.pendingListing=null;
      await renderWorkspace(true);
    }
  }catch(e){
    error.textContent=e.message;
    error.hidden=false;
  }
}
function openAction(){
  const d=$('#action-modal');if(!d.open)d.showModal();
}
function closeAction(){
  const d=$('#action-modal');if(d.open)d.close();
}
function listingForm(){
  const isDonor=state.user?.role==='donor';
  $('#action-content').innerHTML=
    '<div class="modal-kicker">HAMKOR KABINETI</div>'+
    '<h2 class="modal-title">Yangi e’lon</h2>'+ 
    '<p class="modal-description">'+(isDonor?'Oilada kichik bo‘lib qolgan, toza kiyimni bepul ulashing.':'Ortiqcha taom yoki oilangizga kichik bo‘lib qolgan kiyimni mahallangiz bilan ulashing.')+'</p>'+ 
    '<form id="listing-form"><div class="form-grid">'+
    '<div class="form-field full"><label for="list-title">E’lon nomi</label>'+ 
      '<input id="list-title" name="title" required maxlength="100" placeholder="Masalan, sabzavotli tushlik yoki bolalar kurtkasi"></div>'+ 
    '<div class="form-field full"><label for="list-description">Qisqa tavsif</label>'+
      '<textarea id="list-description" name="description" required minlength="5" maxlength="500"></textarea></div>'+
    '<div class="form-field"><label for="list-category">Turi</label>'+
      (isDonor?'<p class="form-help">Oilaviy kiyim ulashuvi · faqat bepul</p><input id="list-category" type="hidden" name="category" value="clothing">':
      '<select id="list-category" name="category"><option value="meal">Tayyor taom</option><option value="grocery">Oziq-ovqat mahsuloti</option><option value="clothing">Kiyim</option></select>')+'</div>'+ 
    '<div class="form-field full image-upload-field"><label for="list-image">E’lon rasmi (JPG, PNG yoki WEBP, 2.5 MB gacha)</label>'+ 
      '<input id="list-image" type="file" accept="image/jpeg,image/png,image/webp">'+ 
      '<img id="image-preview" alt="Tanlangan rasm ko‘rinishi" hidden></div>'+ 
    '<div class="form-field"><label for="list-portions" id="quantity-label">Porsiya soni</label>'+ 
      '<input id="list-portions" name="portions" type="number" min="1" max="500" value="1" required></div>'+ 
    '<div class="form-field"><label for="list-weight">Bir dona/porsiya vazni (gramm, ixtiyoriy)</label>'+ 
      '<input id="list-weight" name="weightGrams" type="number" min="0" max="10000000" value="0"></div>'+ 
    '<div id="food-fields" class="form-grid full">'+ 
    '<div class="form-field"><label for="list-deal">Taklif</label><select id="list-deal" name="dealType">'+
      '<option value="free">Bepul</option><option value="discount">Chegirmali</option></select></div>'+
    '<div class="form-field"><label for="list-price">Hozirgi narx (so‘m)</label>'+
      '<input id="list-price" name="price" type="number" min="0" max="100000000" value="0" required></div>'+
    '<div class="form-field"><label for="list-original">Avvalgi narx (so‘m)</label>'+
      '<input id="list-original" name="originalPrice" type="number" min="0" max="100000000" value="0"></div>'+
    '<div class="form-field"><label for="list-prepared">Tayyorlangan vaqt</label>'+ 
      '<input id="list-prepared" name="preparedAt" type="datetime-local" required>'+ 
      '<span class="form-help">Taom shu kuni tayyorlangan va olib ketish ham shu kuni tugashi kerak.</span></div>'+ 
    '<div class="form-field full"><label for="list-allergens">Allergen va saqlash haqida</label>'+ 
      '<textarea id="list-allergens" name="allergens" maxlength="240" required placeholder="Tarkib, allergenlar, saqlash sharoiti"></textarea></div>'+ 
    '<div class="form-field full"><label class="check-field"><input id="list-safety" type="checkbox" name="safetyConfirmed" value="yes" required>'+ 
      '<span>Taom shu kuni tayyorlangan, yaroqli va allergen/saqlash ma’lumotlari to‘g‘ri ekanini tasdiqlayman. Platforma mustaqil xavfsizlik tekshiruvini o‘tkazmaydi.</span></label></div>'+ 
    '</div>'+ 
    '<div id="clothing-fields" class="form-grid full" hidden>'+ 
    '<div class="form-field"><label for="list-size">O‘lcham (masalan 98, 110, M)</label><input id="list-size" name="clothingSize" maxlength="40"></div>'+ 
    '<div class="form-field"><label for="list-condition">Holati</label><select id="list-condition" name="clothingCondition"><option value="good">Yaxshi</option><option value="like-new">Deyarli yangi</option><option value="new">Yangi</option><option value="used">Ishlatilgan</option></select></div>'+ 
    '<div class="form-field"><label for="list-age">Kim uchun?</label><select id="list-age" name="ageGroup"><option value="child">Bolalar</option><option value="baby">Go‘daklar</option><option value="adult">Kattalar</option></select></div>'+ 
    '</div>'+ 
    '<div class="form-field"><label for="list-area">Hudud</label>'+ 
      '<input id="list-area" name="area" maxlength="80" required placeholder="Tuman yoki shahar"></div>'+ 
    '<div class="form-field"><label for="list-start">Olib ketish boshlanishi</label>'+ 
      '<input id="list-start" name="pickupStart" type="datetime-local" required></div>'+
    '<div class="form-field"><label for="list-end">Olib ketish tugashi</label>'+
      '<input id="list-end" name="pickupEnd" type="datetime-local" required></div>'+
    '<div class="form-field"><label for="list-expires">E’lon tugash vaqti</label>'+
      '<input id="list-expires" name="expiresAt" type="datetime-local" required></div>'+
    '<div class="form-field full"><label for="list-address">Olib ketish manzili</label>'+
      '<input id="list-address" name="pickupAddress" maxlength="180" required placeholder="Ko‘cha, bino, mo‘ljal"></div>'+
    '<div class="form-field full"><button class="text-link" type="button" id="listing-location">⌖ Joylashuv koordinatasini qo‘shish</button>'+
      '<span class="form-help" id="listing-location-status">Masofa bo‘yicha saralash uchun ixtiyoriy.</span></div>'+
    '<input type="hidden" name="latitude"><input type="hidden" name="longitude">'+
    '</div><p class="form-error" id="listing-error" hidden></p>'+
    '<button class="button button-dark form-submit" type="submit">E’lonni joylash →</button>'+
    '<p class="form-legal">Platforma orqali to‘lov olinmaydi. Chegirma bo‘lsa, to‘lov hamkorga joyida qilinadi.</p></form>';
  $('#list-start').value=getLocalDate(120);
  $('#list-end').value=getLocalDate(240);
  $('#list-expires').value=getLocalDate(300);
  $('#list-prepared').value=getLocalDate(-60);
  const category=$('#list-category');
  const syncCategory=()=>{
    const clothing=category.value==='clothing';
    const previous=category.dataset.previous||category.value;
    $('#food-fields').hidden=clothing;$('#clothing-fields').hidden=!clothing;
    $('#food-fields').querySelectorAll('[required]').forEach(field=>field.required=!clothing);
    $('#list-size').required=clothing;$('#quantity-label').textContent=clothing?'Kiyim soni (dona)':'Porsiya soni';
    $('#list-price').disabled=clothing||$('#list-deal').value==='free';
    $('#list-deal').disabled=clothing;$('#list-deal').value=clothing?'free':$('#list-deal').value;
    $('#list-price').value=clothing?'0':$('#list-deal').value==='free'?'0':'10000';
    $('#list-original').value=clothing?'0':$('#list-deal').value==='free'?'0':'15000';
    if(clothing&&previous!=='clothing'){$('#list-start').value=getLocalDate(120);$('#list-end').value=getLocalDate(7*24*60);$('#list-expires').value=getLocalDate(7*24*60+60)}
    else if(!clothing&&previous==='clothing'){$('#list-start').value=getLocalDate(120);$('#list-end').value=getLocalDate(240);$('#list-expires').value=getLocalDate(300)}
    category.dataset.previous=category.value;
  };
  category.addEventListener('change',syncCategory);
  syncCategory();
  $('#list-image').addEventListener('change',event=>{
    const file=event.target.files?.[0],preview=$('#image-preview');
    if(!file){preview.hidden=true;return}
    if(file.size>2_500_000){event.target.value='';toast('Rasm 2.5 MB dan kichik bo‘lsin.','error');preview.hidden=true;return}
    preview.src=URL.createObjectURL(file);preview.hidden=false;
  });
  $('#list-deal').addEventListener('change',()=>{
    const free=$('#list-deal').value==='free';
    $('#list-price').disabled=free;
    $('#list-price').value=free?'0':'10000';
    $('#list-original').value=free?'0':'15000';
  });
  openAction();
}
function openListingForm(){
  if(!state.user){openAuth('register','partner');return}
  if(!['partner','donor'].includes(state.user.role)){
    toast('E’lon joylash uchun hamkor yoki kiyim ulashuvchi oila akkaunti kerak.','error');return;
  }
  listingForm();
}
function openReserve(id){
  const item=state.listings.find(x=>Number(x.id)===Number(id));
  if(!item){toast('Bu e’lon endi mavjud emas.','error');loadListings();return}
  if(!state.user){state.pendingListing=id;openAuth('login');return}
  if(state.user.role!=='customer'){
    toast('Band qilish uchun foydalanuvchi akkauntiga kiring.','error');return;
  }
  const isClothing=item.category==='clothing';
  $('#action-content').innerHTML=
    '<div class="modal-kicker">E’LONNI BAND QILISH</div>'+
    '<h2 class="modal-title">'+escapeHtml(item.title)+'</h2>'+
    '<p class="modal-description">'+escapeHtml(item.partnerName)+' · '+
      escapeHtml(item.pickupAddress)+' · '+escapeHtml(dateLabel(item.pickupStart))+'</p>'+
    '<form id="reserve-form" data-listing-id="'+Number(item.id)+'">'+
    '<div class="form-field"><label for="reserve-quantity">'+(isClothing?'Kiyim soni':'Porsiya soni')+'</label>'+ 
      '<select id="reserve-quantity" name="quantity">'+
      Array.from({length:Number(item.portionsAvailable)},(_,i)=>
        '<option value="'+(i+1)+'">'+(i+1)+(isClothing?' dona':' porsiya')+'</option>').join('')+'</select></div>'+ 
    '<div class="reserve-summary"><div><strong>'+
      (item.price===0?'Bepul':money(item.price))+'</strong><span>'+(isClothing?'Har bir kiyim uchun':'Har bir porsiya uchun')+'</span></div>'+ 
      '<div><strong>'+Number(item.portionsAvailable)+' ta</strong><span>Hozir mavjud</span></div></div>'+
    '<div class="form-field"><label for="delivery-method">Olib ketish usuli</label>'+
      '<select id="delivery-method" name="deliveryMethod"><option value="pickup">O‘zim olib ketaman</option>'+
      '<option value="volunteer">Ko‘ngilli yetkazib bersin</option></select></div>'+
    '<div class="form-field" id="delivery-address-field" hidden><label for="delivery-address">Yetkazish manzili</label>'+
      '<input id="delivery-address" name="deliveryAddress" maxlength="180" placeholder="Ko‘cha, bino, xonadon"></div>'+
    '<div class="form-field" style="margin-top:12px"><label for="reserve-note">Izoh (ixtiyoriy)</label>'+
      '<input id="reserve-note" name="note" maxlength="240" placeholder="Hamkorga eslatma"></div>'+
    '<p class="form-help" style="margin-top:12px">'+(isClothing?'Kiyim bepul ulashiladi. Holatini olib ketishda tekshiring.':'Chegirmali taklif uchun to‘lov olib ketishda bevosita hamkorga qilinadi.')+' '+ 
      'Yetkazish ko‘ngillilar mavjudligiga bog‘liq.</p>'+
    '<p class="form-error" id="reserve-error" hidden></p>'+
    '<button class="button button-dark form-submit" type="submit">Band qilishni tasdiqlash →</button></form>';
  $('#delivery-method').addEventListener('change',()=>{
    const delivery=$('#delivery-method').value==='volunteer';
    $('#delivery-address-field').hidden=!delivery;
    $('#delivery-address').required=delivery;
  });
  openAction();
}
function statusPill(status){
  const labels={
    reserved:'Band qilingan',collected:'Olib ketilgan',cancelled:'Bekor qilingan',
    requested:'Ko‘ngilli kutilmoqda',assigned:'Yetkazish biriktirildi',
    delivered:'Yetkazildi',active:'Faol',paused:'To‘xtatilgan'
  };
  const muted=['cancelled','paused'].includes(status),alert=['requested'].includes(status);
  return '<span class="status-pill '+(muted?'status-muted':alert?'status-alert':'')+'">'+
    escapeHtml(labels[status]||status)+'</span>';
}
function empty(message){
  return '<div class="account-empty">'+escapeHtml(message)+'</div>';
}
function notificationsMarkup(items){
  if(!items||!items.length)return empty('Hozircha bildirishnoma yo‘q.');
  return '<div class="notification-list">'+items.map(n=>
    '<article class="notification-item"><b>'+escapeHtml(n.title)+'</b><p>'+
    escapeHtml(n.body)+' · '+escapeHtml(dateLabel(n.created_at))+'</p></article>'
  ).join('')+'</div>';
}
function customerMarkup(data,notes){
  const rows=data.reservations||[];
  const orders=rows.length?rows.map(r=>
    '<article class="account-item"><div class="account-item-main"><h4>'+
      escapeHtml(r.title)+'</h4><p>'+escapeHtml(r.partner_name)+' · '+
      escapeHtml(r.pickup_address)+'<br>'+escapeHtml(dateLabel(r.pickup_start))+
      ' · '+Number(r.quantity)+(r.category==='clothing'?' dona':' porsiya')+' · '+money(r.price*Number(r.quantity))+ 
      (r.delivery_method==='volunteer'?'<br>'+statusPill(r.delivery_status):'')+'</p>'+ 
      '<p class="code-pill">'+escapeHtml(r.code)+'</p></div><div class="account-item-actions">'+
      statusPill(r.status)+(r.status==='reserved'
        ?'<button class="mini-button" data-action="cancel" data-id="'+Number(r.id)+'">Bekor qilish</button>':'')+
      (r.status==='collected'&&!r.reviewSubmitted?'<button class="mini-button" data-action="review" data-id="'+Number(r.id)+'">Baho berish</button>':'')+ 
    '</div></article>').join(''):empty('Hali band qilgan taomingiz yo‘q.');
  return '<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h3>Bandlarim</h3>'+
    '<a class="text-link" href="#taomlar">Taom topish →</a></div><div class="account-list">'+orders+
    '</div></section><section class="panel"><div class="panel-heading"><h3>Bildirishnomalar</h3>'+
    '<button class="mini-button" data-action="read-notifications">O‘qilgan deb belgilash</button>'+
    '</div>'+notificationsMarkup(notes)+'</section></div>';
}
function partnerMarkup(data){
  const listings=data.listings||[],reservations=data.reservations||[];
  const rewards=data.rewards||[],claims=data.claims||[];
  const rewardMarkup=rewards.length?rewards.map(r=>'<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(r.title)+'</h4><p>'+escapeHtml(r.description)+' · '+Number(r.points_cost)+' karma · '+Number(r.stock)+' dona</p></div></article>').join(''):empty('Hali mukofot taklif qilinmagan.');
  const claimMarkup=claims.length?claims.map(c=>'<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(c.reward_title)+' · '+escapeHtml(c.code)+'</h4><p>'+Number(c.points_cost)+' karma · '+escapeHtml(dateLabel(c.created_at))+'</p></div><div class="account-item-actions">'+statusPill(c.status)+(c.status==='pending'?'<button class="mini-button" data-action="complete-reward" data-id="'+Number(c.id)+'">Berildi</button>':'')+'</div></article>').join(''):empty('Mukofot so‘rovlari yo‘q.');
  const listMarkup=listings.length?listings.map(item=>
    '<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(item.title)+'</h4>'+
      '<p>'+escapeHtml(item.area)+' · '+Number(item.portions_available)+' / '+ 
      Number(item.portions_total)+(item.category==='clothing'?' dona qoldi':' porsiya qoldi')+' · '+escapeHtml(dateLabel(item.pickup_end))+'</p></div>'+ 
      '<div class="account-item-actions">'+statusPill(item.status)+
      '<button class="mini-button" data-action="pause" data-id="'+Number(item.id)+'">'+
      (item.status==='active'?'E’lonni to‘xtatish':'Qayta faollashtirish')+'</button></div></article>'
  ).join(''):empty('Hali e’lon joylanmagan.');
  const orderMarkup=reservations.length?reservations.map(r=>
    '<article class="account-item"><div class="account-item-main"><h4>'+
      escapeHtml(r.listing_title)+' · '+Number(r.quantity)+(r.category==='clothing'?' dona':' porsiya')+'</h4>'+ 
      '<p>'+escapeHtml(r.customer_name)+' · '+escapeHtml(r.customer_phone)+
      '<br>'+escapeHtml(dateLabel(r.created_at))+' · '+escapeHtml(r.code)+'</p></div>'+
      '<div class="account-item-actions">'+statusPill(r.status)+
      (r.status==='reserved'&&(r.delivery_method!=='volunteer'||r.delivery_status==='delivered')
        ?'<button class="mini-button" data-action="collect" data-id="'+Number(r.id)+'">Olib ketildi</button>':'')+
      '</div></article>'
  ).join(''):empty('Yangi bandlar shu yerda ko‘rinadi.');
  return '<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h3>E’lonlarim</h3>'+
    '<button class="button button-green" data-action="create-listing">+ E’lon joylash</button></div>'+ 
    '<p class="form-help">Hamkor holati: '+(data.partner?.partner_verified?'<span class="verified-badge">Tasdiqlangan</span>':'<span class="status-pill status-alert">Tekshiruv kutilmoqda</span> E’lonlaringiz admin tekshiruvidan so‘ng ommaga ko‘rinadi.')+'</p>'+ 
    '<div class="account-list">'+listMarkup+'</div></section><section class="panel"><h3>Bandlar</h3>'+
    '<div class="account-list">'+orderMarkup+'</div></section><section class="panel"><div class="panel-heading"><h3>Ko‘ngilli mukofotlari</h3><button class="mini-button" data-action="create-reward">Mukofot qo‘shish</button></div>'+ 
    '<div class="account-list">'+rewardMarkup+'</div><h4>Band qilingan mukofotlar</h4><div class="account-list">'+claimMarkup+'</div></section><section class="panel"><h3>Bildirishnomalar</h3>'+ 
    notificationsMarkup(data.notifications||[])+'</section></div>';
}
function donorMarkup(data){
  const listings=data.listings||[],reservations=data.reservations||[];
  const listingMarkup=listings.length?listings.map(item=>
    '<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(item.title)+'</h4>'+ 
      '<p>'+escapeHtml(item.area)+' · '+Number(item.portions_available)+' / '+Number(item.portions_total)+
      ' dona · '+escapeHtml(dateLabel(item.pickup_end))+'</p></div><div class="account-item-actions">'+statusPill(item.status)+
      '<button class="mini-button" data-action="pause" data-id="'+Number(item.id)+'">'+
      (item.status==='active'?'E’lonni to‘xtatish':'Qayta faollashtirish')+'</button></div></article>'
  ).join(''):empty('Hali kiyim e’loni joylanmagan.');
  const reservationMarkup=reservations.length?reservations.map(r=>
    '<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(r.listing_title)+' · '+Number(r.quantity)+' dona</h4>'+ 
      '<p>'+escapeHtml(r.customer_name)+' · '+escapeHtml(r.customer_phone)+'<br>'+escapeHtml(dateLabel(r.pickup_start))+
      ' · '+escapeHtml(r.code)+'</p></div><div class="account-item-actions">'+statusPill(r.status)+
      (r.delivery_method==='volunteer'&&r.status==='reserved'?statusPill(r.delivery_status):'')+
      (r.status==='reserved'&&(r.delivery_method!=='volunteer'||r.delivery_status==='delivered')?
        '<button class="mini-button" data-action="collect" data-id="'+Number(r.id)+'">Topshirilganini tasdiqlash</button>':'')+
      '</div></article>'
  ).join(''):empty('Kiyim band qilinganda bu yerda ko‘rasiz.');
  return '<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><h3>Oilamiz ulashgan kiyimlar</h3>'+ 
    '<button class="button button-green" data-action="create-listing">+ Kiyim joylash</button></div>'+ 
    '<p class="form-help">Oilaviy e’lonlar bepul. Aniq uy manzili band tasdiqlangach ko‘rsatiladi.</p>'+ 
    '<div class="account-list">'+listingMarkup+'</div></section><section class="panel"><h3>Band qilingan kiyimlar</h3>'+ 
    '<div class="account-list">'+reservationMarkup+'</div></section><section class="panel"><h3>Bildirishnomalar</h3>'+ 
    notificationsMarkup(data.notifications||[])+'</section></div>';
}
function volunteerMarkup(tasks,notes){
  const rows=tasks.tasks||[];
  const taskMarkup=rows.length?rows.map(t=>
    '<article class="account-item"><div class="account-item-main"><h4>'+
      escapeHtml(t.listing_title)+' · '+Number(t.quantity)+(t.category==='clothing'?' dona':' porsiya')+'</h4>'+ 
      '<p>'+escapeHtml(t.partner_name)+' · olib ketish: '+escapeHtml(t.pickup_address||'manzil topshiriqni qabul qilgach ko‘rinadi')+
      '<br>Yetkazish manzili: '+escapeHtml(t.delivery_address)+
      (t.customer_name?'<br>'+escapeHtml(t.customer_name)+' · '+escapeHtml(t.customer_phone):'')+
      '</p><p class="code-pill">'+escapeHtml(t.code)+'</p></div><div class="account-item-actions">'+
      statusPill(t.delivery_status)+(t.delivery_status==='requested'
        ?'<button class="mini-button" data-action="claim-task" data-id="'+Number(t.id)+'">Qabul qilish</button>'
        :'<button class="mini-button" data-action="complete-task" data-id="'+Number(t.id)+'">Yetkazdim</button>')+
    '</div></article>').join(''):empty('Hozircha yetkazish topshirig‘i yo‘q.');
  const rewards=tasks.rewards||[],claims=tasks.claims||[];
  const rewardMarkup=rewards.length?rewards.map(r=>'<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(r.title)+(r.partner_verified?' <span class="verified-badge">Tasdiqlangan hamkor</span>':'')+'</h4><p>'+escapeHtml(r.partner_name)+' · '+escapeHtml(r.description)+' · '+Number(r.points_cost)+' karma</p></div><div class="account-item-actions"><button class="mini-button" data-action="redeem" data-id="'+Number(r.id)+'">Almashtirish</button></div></article>').join(''):empty('Hozircha hamkor mukofoti yo‘q.');
  const claimList=claims.length?claims.map(c=>'<article class="account-item"><div class="account-item-main"><h4>'+escapeHtml(c.reward_title)+' · '+escapeHtml(c.partner_name)+'</h4><p class="code-pill">'+escapeHtml(c.code)+'</p></div>'+statusPill(c.status)+'</article>').join(''):empty('Sizda band qilingan mukofot yo‘q.');
  return '<div class="karma-banner"><span>✦</span><div><small>YETKAZISH ORQALI TO‘PLANGAN</small><strong>'+Number(tasks.karmaPoints||0)+' karma ball</strong></div><p>Har bir bajarilgan topshiriq uchun 10 ball. Hamkor mukofotlarini band qiling.</p></div>'+ 
    '<div class="dashboard-grid"><section class="panel"><h3>Yetkazish topshiriqlari</h3>'+ 
    '<div class="account-list">'+taskMarkup+'</div></section><section class="panel"><h3>Karma mukofotlari</h3><div class="account-list">'+rewardMarkup+'</div><h4>Bandlarim</h4><div class="account-list">'+claimList+'</div></section><section class="panel"><h3>Bildirishnomalar</h3>'+ 
    notificationsMarkup(notes)+'</section></div>';
}
function adminMarkup(data){
  state.adminData=data;
  const partners=data.pendingPartners||[],reports=data.reports||[],listings=data.listings||[],members=data.members||[],reservations=data.reservations||[];
  const counts=data.counts||{},number=value=>new Intl.NumberFormat('uz-UZ').format(Number(value)||0);
  const partnerList=partners.length?partners.map(p=>'<article class="admin-row" data-admin-row><div class="admin-row-main"><span class="admin-row-icon">↗</span><div><h4>'+escapeHtml(p.organization||p.name)+'</h4><p>'+escapeHtml(p.name)+' · '+escapeHtml(p.phone)+' · '+escapeHtml(p.area||'Hudud kiritilmagan')+'</p></div></div><div class="admin-row-actions"><span class="status-pill status-alert">Tekshiruvda</span><button class="admin-action admin-action-primary" data-action="verify-partner" data-id="'+Number(p.id)+'">Tasdiqlash</button></div></article>').join(''):empty('Tekshiruv kutilayotgan hamkor yo‘q.');
  const reportList=reports.length?reports.map(r=>'<article class="admin-row" data-admin-row><div class="admin-row-main"><span class="admin-row-icon admin-row-warn">!</span><div><h4>'+escapeHtml(r.listing_title)+' · '+escapeHtml(r.reason)+'</h4><p>'+escapeHtml(r.details||'Izoh qoldirilmagan')+' · '+escapeHtml(r.reporter_name)+'</p></div></div><div class="admin-row-actions"><button class="admin-action admin-action-danger" data-action="remove-listing" data-id="'+Number(r.listing_id)+'">E’lonni yashirish</button><button class="admin-action" data-action="resolve-report" data-id="'+Number(r.id)+'">Hal qilindi</button></div></article>').join(''):empty('Yangi shikoyatlar yo‘q.');
  const listingRows=listings.length?listings.map(item=>{
    const status=item.status==='active'?'Faol':item.status==='paused'?'Pauzada':item.status==='removed'?'Yashirilgan':item.status;
    const action=item.status==='removed'?'<button class="admin-action admin-action-primary" data-action="restore-listing" data-id="'+Number(item.id)+'">Tiklash</button>':'<button class="admin-action" data-action="toggle-admin-listing" data-id="'+Number(item.id)+'">'+(item.status==='active'?'Pauza':'Faollashtirish')+'</button><button class="admin-action admin-action-danger" data-action="remove-listing" data-id="'+Number(item.id)+'">Yashirish</button>';
    return '<article class="admin-row" data-admin-row><div class="admin-row-main"><span class="admin-row-icon">'+(item.category==='clothing'?'◇':'✳')+'</span><div><h4>'+escapeHtml(item.title)+'</h4><p>'+escapeHtml(item.owner_name)+' · '+escapeHtml(item.area)+' · '+Number(item.portions_available)+' ta qoldi · '+escapeHtml(categoryNames[item.category]||item.category)+'</p></div></div><div class="admin-row-actions"><span class="status-pill '+(item.status==='active'?'':'status-muted')+'">'+escapeHtml(status)+'</span>'+action+'</div></article>';
  }).join(''):empty('Hozircha e’lon yo‘q.');
  const memberRows=members.length?members.map(member=>{
    const role=roleNames[member.role]||member.role,active=member.account_status!=='suspended';
    return '<article class="admin-row" data-admin-row><div class="admin-row-main"><span class="admin-avatar">'+escapeHtml((member.name||'?').slice(0,1).toUpperCase())+'</span><div><h4>'+escapeHtml(member.name)+(member.role==='partner'&&member.partner_verified?' <span class="verified-badge">Tasdiqlangan</span>':'')+'</h4><p>'+escapeHtml(member.phone)+' · '+escapeHtml(role)+(member.organization?' · '+escapeHtml(member.organization):'')+(member.area?' · '+escapeHtml(member.area):'')+'</p></div></div><div class="admin-row-actions"><span class="status-pill '+(active?'':'status-alert')+'">'+(active?'Faol':'To‘xtatilgan')+'</span>'+(member.role==='partner'&&member.partner_verified?'<button class="admin-action" data-action="revoke-partner" data-id="'+Number(member.id)+'">Tasdiqni olish</button>':'')+'<button class="admin-action '+(active?'admin-action-danger':'admin-action-primary')+'" data-action="toggle-member" data-id="'+Number(member.id)+'" data-status="'+(active?'active':'suspended')+'">'+(active?'To‘xtatish':'Faollashtirish')+'</button></div></article>';
  }).join(''):empty('Foydalanuvchilar hali yo‘q.');
  const reservationRows=reservations.length?reservations.map(order=>'<article class="admin-row" data-admin-row><div class="admin-row-main"><span class="admin-row-icon admin-order-icon">#</span><div><h4>'+escapeHtml(order.listing_title)+' · '+escapeHtml(order.customer_name)+'</h4><p>'+escapeHtml(order.owner_name)+' · '+Number(order.quantity)+' ta · '+escapeHtml(order.delivery_method==='volunteer'?'Ko‘ngilli yetkazadi':'O‘zi olib ketadi')+' · '+escapeHtml(dateLabel(order.created_at))+'</p></div></div><div class="admin-row-actions"><span class="code-pill">'+escapeHtml(order.code)+'</span>'+statusPill(order.status==='collected'?'collected':order.status)+'</div></article>').join(''):empty('Hozircha bandlar yo‘q.');
  const tab=state.adminTab||'overview',urgent=Number(counts.pendingPartners||0)+Number(counts.openReports||0);
  const tabButton=(id,label,badge='')=>'<button class="admin-tab '+(tab===id?'active':'')+'" type="button" data-admin-tab="'+id+'">'+label+(badge?'<span>'+badge+'</span>':'')+'</button>';
  const exportButton=(kind,label)=>'<button class="admin-export" type="button" data-action="export-admin" data-kind="'+kind+'">↓ '+label+'</button>';
  return '<div class="admin-console"><header class="admin-hero"><div><span class="admin-overline"><i></i> ULASH · BOSHQARUV MARKAZI</span><h3>Xush kelibsiz, '+escapeHtml(state.user?.name||'administrator')+'</h3><p>Hamkorlar, e’lonlar va yordam so‘rovlarini shu yerdan boshqaring.</p></div><div class="admin-hero-mark"><span>U</span><small>ADMIN<br>CONTROL</small></div></header>'+ 
    '<div class="admin-stats"><article class="admin-stat"><span>JAMI A’ZOLAR</span><b>'+number(counts.users)+'</b><small>faol va to‘xtatilgan</small></article><article class="admin-stat"><span>E’LONLAR</span><b>'+number(counts.listings)+'</b><small>'+number(counts.activeListings)+' tasi faol</small></article><article class="admin-stat"><span>BANDLAR</span><b>'+number(counts.reservations)+'</b><small>'+number(counts.collected)+' tasi yakunlangan</small></article><article class="admin-stat admin-stat-alert"><span>KO‘RIB CHIQISH KERAK</span><b>'+number(urgent)+'</b><small>hamkorlar va shikoyatlar</small></article></div>'+ 
    '<div class="admin-workspace"><nav class="admin-tabs" aria-label="Admin bo‘limlari">'+tabButton('overview','Umumiy',urgent?number(urgent):'')+tabButton('listings','E’lonlar')+tabButton('members','A’zolar')+tabButton('reservations','Bandlar')+'</nav><div class="admin-tools"><label class="admin-search"><span>⌕</span><input class="admin-search-input" type="search" value="'+escapeHtml(state.adminSearch||'')+'" placeholder="Joriy bo‘limdan qidirish" aria-label="Admin bo‘limidan qidirish"></label><span class="admin-secure">● Ma’lumotlar faqat admin uchun</span></div>'+ 
    '<section class="admin-panel" data-admin-panel="overview" '+(tab==='overview'?'':'hidden')+'><div class="admin-section-heading"><div><span class="admin-section-kicker">USTUVOR ISHLAR</span><h4>Ko‘rib chiqish navbati</h4><p>Tasdiqlash yoki hal qilishni kutayotgan masalalar.</p></div>'+exportButton('reports','Hisobot olish')+'</div><div class="admin-grid"><article class="admin-card"><div class="admin-card-heading"><div><span class="admin-card-icon">↗</span><div><h4>Hamkorlar</h4><p>'+number(partners.length)+' ta tasdiq kutmoqda</p></div></div><span class="admin-count">'+number(partners.length)+'</span></div><div class="admin-list">'+partnerList+'</div></article><article class="admin-card"><div class="admin-card-heading"><div><span class="admin-card-icon admin-card-icon-alert">!</span><div><h4>Shikoyatlar</h4><p>'+number(reports.length)+' ta ko‘rib chiqilmagan</p></div></div><span class="admin-count admin-count-alert">'+number(reports.length)+'</span></div><div class="admin-list">'+reportList+'</div></article></div><p class="admin-filter-empty" hidden>Qidiruvga mos ish topilmadi.</p><div class="admin-quick-grid"><button type="button" data-admin-tab="listings"><span>01</span><b>E’lonlarni boshqarish</b><small>Yashirish, pauza yoki tiklash</small><i>→</i></button><button type="button" data-admin-tab="members"><span>02</span><b>A’zolarni ko‘rish</b><small>Roli va akkaunt holatini boshqarish</small><i>→</i></button><button type="button" data-admin-tab="reservations"><span>03</span><b>Bandlarni kuzatish</b><small>Oxirgi buyurtmalar va holatlar</small><i>→</i></button></div></section>'+ 
    '<section class="admin-panel" data-admin-panel="listings" '+(tab==='listings'?'':'hidden')+'><div class="admin-section-heading"><div><span class="admin-section-kicker">MODERATSIYA</span><h4>Barcha e’lonlar</h4><p>E’lonni vaqtincha pauzaga qo‘ying, yashiring yoki tiklang.</p></div>'+exportButton('listings','CSV yuklash')+'</div><div class="admin-list">'+listingRows+'</div><p class="admin-filter-empty" hidden>Qidiruvga mos e’lon topilmadi.</p></section>'+ 
    '<section class="admin-panel" data-admin-panel="members" '+(tab==='members'?'':'hidden')+'><div class="admin-section-heading"><div><span class="admin-section-kicker">HAMJAMIYAT</span><h4>A’zolar boshqaruvi</h4><p>Muammoli akkauntni vaqtincha to‘xtating yoki qayta faollashtiring.</p></div>'+exportButton('members','CSV yuklash')+'</div><div class="admin-list">'+memberRows+'</div><p class="admin-filter-empty" hidden>Qidiruvga mos a’zo topilmadi.</p></section>'+ 
    '<section class="admin-panel" data-admin-panel="reservations" '+(tab==='reservations'?'':'hidden')+'><div class="admin-section-heading"><div><span class="admin-section-kicker">XIZMAT NAZORATI</span><h4>Bandlar tarixi</h4><p>Eng so‘nggi 150 ta bandning holatini tekshiring.</p></div>'+exportButton('reservations','CSV yuklash')+'</div><div class="admin-list">'+reservationRows+'</div><p class="admin-filter-empty" hidden>Qidiruvga mos band topilmadi.</p></section></div></div>';
}
function setAdminTab(root,tab){
  if(!['overview','listings','members','reservations'].includes(tab))return;
  state.adminTab=tab;
  root.querySelectorAll('[data-admin-tab]').forEach(button=>button.classList.toggle('active',button.dataset.adminTab===tab));
  root.querySelectorAll('[data-admin-panel]').forEach(panel=>{panel.hidden=panel.dataset.adminPanel!==tab});
  applyAdminSearch(root);
}
function applyAdminSearch(root){
  if(!root)return;
  const panel=root.querySelector('[data-admin-panel="'+state.adminTab+'"]');
  if(!panel)return;
  const query=(state.adminSearch||'').trim().toLocaleLowerCase('uz-UZ');
  let shown=0;
  panel.querySelectorAll('[data-admin-row]').forEach(row=>{
    const match=!query||row.textContent.toLocaleLowerCase('uz-UZ').includes(query);
    row.hidden=!match;if(match)shown++;
  });
  const noMatch=panel.querySelector('.admin-filter-empty');
  if(noMatch)noMatch.hidden=!query||shown>0;
}
function exportAdminCsv(kind){
  const data=state.adminData||{},sets={
    reports:{name:'shikoyatlar',rows:data.reports||[],fields:[['E’lon',x=>x.listing_title],['Sabab',x=>x.reason],['Tafsilot',x=>x.details],['Xabar bergan',x=>x.reporter_name],['Sana',x=>x.created_at]]},
    listings:{name:'elonlar',rows:data.listings||[],fields:[['Nomi',x=>x.title],['Turi',x=>categoryNames[x.category]||x.category],['Hudud',x=>x.area],['Holat',x=>x.status],['Egasi',x=>x.owner_name],['Mavjud',x=>x.portions_available],['Narx',x=>x.price],['Yaroqli sana',x=>x.expires_at]]},
    members:{name:'azolar',rows:data.members||[],fields:[['Ism',x=>x.name],['Telefon',x=>x.phone],['Roli',x=>roleNames[x.role]||x.role],['Tashkilot',x=>x.organization],['Hudud',x=>x.area],['Holat',x=>x.account_status],['Ro‘yxatdan o‘tgan',x=>x.created_at]]},
    reservations:{name:'bandlar',rows:data.reservations||[],fields:[['Kod',x=>x.code],['E’lon',x=>x.listing_title],['Mijoz',x=>x.customer_name],['Egasi',x=>x.owner_name],['Miqdor',x=>x.quantity],['Band holati',x=>x.status],['Yetkazish',x=>x.delivery_status],['Sana',x=>x.created_at]]}
  };
  const set=sets[kind];if(!set)return;
  const cell=value=>{let text=String(value??'');if(/^[=+@\-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};
  const csv='\uFEFF'+[set.fields.map(field=>cell(field[0])).join(','),...set.rows.map(row=>set.fields.map(field=>cell(field[1](row))).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='ulash-'+set.name+'-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function reviewForm(id){
  $('#action-content').innerHTML='<div class="modal-kicker">FIKRINGIZ MUHIM</div><h2 class="modal-title">Ulashuv tajribasini baholang</h2><form id="review-form" data-id="'+Number(id)+'"><div class="form-field"><label for="review-rating">Baho</label><select id="review-rating" name="rating"><option value="5">★★★★★ — A’lo</option><option value="4">★★★★ — Yaxshi</option><option value="3">★★★ — O‘rtacha</option><option value="2">★★ — Yomon</option><option value="1">★ — Juda yomon</option></select></div><div class="form-field"><label for="review-comment">Izoh (ixtiyoriy)</label><textarea id="review-comment" name="comment" maxlength="500"></textarea></div><p class="form-error" id="review-error" hidden></p><button class="button button-dark form-submit">Bahoni yuborish</button></form>';openAction();
}
function reportForm(id){
  if(!state.user){toast('Shikoyat yuborish uchun tizimga kiring.','error');openAuth('login');return}
  $('#action-content').innerHTML='<div class="modal-kicker">XAVFSIZ HAMJAMIYAT</div><h2 class="modal-title">E’lon haqida xabar bering</h2><form id="report-form" data-id="'+Number(id)+'"><div class="form-field"><label for="report-reason">Sabab</label><select id="report-reason" name="reason"><option>Noto‘g‘ri yoki chalg‘ituvchi ma’lumot</option><option>Taom xavfsizligi bo‘yicha xavotir</option><option>Spam yoki noo‘rin e’lon</option><option>Boshqa</option></select></div><div class="form-field"><label for="report-details">Tafsilot</label><textarea id="report-details" name="details" maxlength="500"></textarea></div><p class="form-error" id="report-error" hidden></p><button class="button button-dark form-submit">Shikoyat yuborish</button></form>';openAction();
}
function rewardForm(){
  $('#action-content').innerHTML='<div class="modal-kicker">KO‘NGILLILARNI RAG‘BATLANTIRING</div><h2 class="modal-title">Mukofot qo‘shish</h2><form id="reward-form"><div class="form-field"><label for="reward-title">Mukofot</label><input id="reward-title" name="title" maxlength="90" required placeholder="Masalan, bepul qahva"></div><div class="form-field"><label for="reward-description">Olish shartlari</label><textarea id="reward-description" name="description" maxlength="300" required></textarea></div><div class="form-grid"><div class="form-field"><label for="reward-points">Kerakli karma ball</label><input id="reward-points" type="number" name="pointsCost" min="10" max="100000" value="50" required></div><div class="form-field"><label for="reward-stock">Miqdori</label><input id="reward-stock" type="number" name="stock" min="1" max="10000" value="1" required></div></div><p class="form-help">Mukofotni hamkorning o‘zi taqdim etadi; platforma to‘lov yoki kafolat bermaydi.</p><p class="form-error" id="reward-error" hidden></p><button class="button button-dark form-submit">Mukofotni joylash</button></form>';openAction();
}
async function renderWorkspace(scroll=false){
  if(!state.user)return;
  const section=$('#workspace'),content=$('#workspace-content');
  section.hidden=false;
  $('#user-label').textContent=state.user.name+' · '+roleNames[state.user.role];
  $('#workspace-title').textContent=state.user.role==='partner'
    ?'Hamkor kabineti':state.user.role==='donor'?'Kiyim ulashuvchi oila kabineti':state.user.role==='volunteer'?'Ko‘ngilli kabineti':state.user.role==='admin'?'Administrator paneli':'Mening bandlarim';
  content.innerHTML='<div class="loading-state"><span class="spinner"></span> Kabinet yuklanmoqda…</div>';
  try{
    let markup='';
    if(state.user.role==='partner'){
      markup=partnerMarkup(await api('/api/partner/dashboard'));
    }else if(state.user.role==='donor'){
      markup=donorMarkup(await api('/api/donor/dashboard'));
    }else if(state.user.role==='volunteer'){
      const results=await Promise.all([api('/api/volunteer/tasks'),api('/api/notifications')]);
      markup=volunteerMarkup(results[0],results[1].notifications||[]);
    }else if(state.user.role==='admin'){
      markup=adminMarkup(await api('/api/admin/overview'));
    }else{
      const results=await Promise.all([api('/api/my/reservations'),api('/api/notifications')]);
      markup=customerMarkup(results[0],results[1].notifications||[]);
    }
    content.innerHTML=markup;
    if(scroll)section.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    content.innerHTML='<div class="error-state">'+escapeHtml(e.message)+'</div>';
  }
}
async function submitListing(form){
  const data=Object.fromEntries(new FormData(form).entries());
  const error=$('#listing-error');error.hidden=true;
  try{
    const imageFile=$('#list-image').files?.[0];let imageData=null;
    if(imageFile)imageData=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Rasmni o‘qib bo‘lmadi.'));
      reader.readAsDataURL(imageFile);
    });
    const body={
      ...data,price:Number(data.price||0),originalPrice:Number(data.originalPrice||0),
      portions:Number(data.portions),weightGrams:Number(data.weightGrams||0),
      safetyConfirmed:data.safetyConfirmed==='yes',imageData,
      pickupStart:new Date(data.pickupStart).toISOString(),
      pickupEnd:new Date(data.pickupEnd).toISOString(),
      expiresAt:new Date(data.expiresAt).toISOString(),
      preparedAt:new Date(data.preparedAt).toISOString(),
      latitude:data.latitude?Number(data.latitude):null,
      longitude:data.longitude?Number(data.longitude):null
    };
    await api('/api/listings',{method:'POST',body:JSON.stringify(body)});
    closeAction();toast('E’loningiz haqiqiy ro‘yxatga qo‘shildi.');
    await Promise.all([loadListings(),loadImpact(),renderWorkspace()]);
  }catch(e){error.textContent=e.message;error.hidden=false}
}
async function submitReservation(form){
  const data=Object.fromEntries(new FormData(form).entries());
  const error=$('#reserve-error');error.hidden=true;
  try{
    const result=await api('/api/reservations',{
      method:'POST',body:JSON.stringify({
        listingId:Number(form.dataset.listingId),quantity:Number(data.quantity),
        deliveryMethod:data.deliveryMethod,deliveryAddress:data.deliveryAddress,note:data.note
      })
    });
    closeAction();
    toast('Band tasdiqlandi. Kod: '+result.reservation.code);
    await Promise.all([loadListings(),loadImpact(),renderWorkspace()]);
    $('#workspace').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){error.textContent=e.message;error.hidden=false}
}
async function submitReview(form){
  const body=Object.fromEntries(new FormData(form).entries()),error=$('#review-error');error.hidden=true;
  try{
    await api('/api/reservations/'+Number(form.dataset.id)+'/review',{method:'POST',body:JSON.stringify({rating:Number(body.rating),comment:body.comment})});
    closeAction();toast('Bahoyingiz qabul qilindi.');await Promise.all([renderWorkspace(),loadLeaderboard()]);
  }catch(e){error.textContent=e.message;error.hidden=false}
}
async function submitReport(form){
  const body=Object.fromEntries(new FormData(form).entries()),error=$('#report-error');error.hidden=true;
  try{
    await api('/api/reports',{method:'POST',body:JSON.stringify({listingId:Number(form.dataset.id),reason:body.reason,details:body.details})});
    closeAction();toast('Xabaringiz moderatorlar ko‘rib chiqishi uchun yuborildi.');
  }catch(e){error.textContent=e.message;error.hidden=false}
}
async function submitReward(form){
  const body=Object.fromEntries(new FormData(form).entries()),error=$('#reward-error');error.hidden=true;
  try{
    await api('/api/rewards',{method:'POST',body:JSON.stringify({title:body.title,description:body.description,pointsCost:Number(body.pointsCost),stock:Number(body.stock)})});
    closeAction();toast('Hamkor mukofoti joylandi.');await renderWorkspace();
  }catch(e){error.textContent=e.message;error.hidden=false}
}
async function postAction(path,message,refreshPublic=false){
  try{
    await api(path,{method:'POST',body:'{}'});
    toast(message);
    await renderWorkspace();
    if(refreshPublic)await Promise.all([loadListings(),loadImpact()]);
  }catch(e){toast(e.message,'error')}
}
function accountAction(button){
  const id=Number(button.dataset.id),action=button.dataset.action;
  if(action==='create-listing'){listingForm();return}
  if(action==='cancel'){
    if(!window.confirm('Bandni bekor qilasizmi? Porsiya yana boshqalarga ochiladi.'))return;
    postAction('/api/reservations/'+id+'/cancel','Band bekor qilindi.',true);return;
  }
  if(action==='pause'){
    postAction('/api/listings/'+id+'/pause','E’lon holati o‘zgartirildi.',true);return;
  }
  if(action==='collect'){
    if(!window.confirm('Mijoz taomni olib ketganini tasdiqlaysizmi?'))return;
    postAction('/api/reservations/'+id+'/collect','Olib ketish tasdiqlandi.',true);return;
  }
  if(action==='claim-task'){
    postAction('/api/volunteer/tasks/'+id+'/claim','Yetkazish sizga biriktirildi.');return;
  }
  if(action==='complete-task'){
    if(!window.confirm('Taomni mijozga yetkazdingizmi?'))
      return;
    postAction('/api/volunteer/tasks/'+id+'/complete','Yetkazish yakunlandi.');return;
  }
  if(action==='read-notifications'){
    postAction('/api/notifications/read','Bildirishnomalar o‘qilgan deb belgilandi.');return;
  }
  if(action==='review'){reviewForm(id);return}
  if(action==='create-reward'){rewardForm();return}
  if(action==='redeem'){
    if(!window.confirm('Karma ballaringizni ushbu hamkor mukofotiga almashtirasizmi?'))return;
    postAction('/api/rewards/'+id+'/redeem','Mukofot band qilindi. Kod kabinetda ko‘rinadi.');return;
  }
  if(action==='complete-reward'){
    if(!window.confirm('Mukofotni ko‘ngilliga topshirdingizmi?'))return;
    postAction('/api/reward-claims/'+id+'/complete','Mukofot berilgani qayd etildi.');return;
  }
  if(action==='verify-partner'){
    if(!window.confirm('Hamkor ma’lumotlarini o‘zingiz tekshirganingizni tasdiqlaysizmi?'))return;
    postAction('/api/admin/partners/'+id+'/verify','Hamkor tasdiqlandi.');return;
  }
  if(action==='revoke-partner'){
    if(!window.confirm('Hamkor tasdig‘ini vaqtincha olib tashlaysizmi? E’lonlari yashiriladi.'))return;
    postAction('/api/admin/partners/'+id+'/revoke','Hamkor tasdig‘i olib tashlandi.',true);return;
  }
  if(action==='toggle-member'){
    const suspend=button.dataset.status==='active';
    if(suspend&&!window.confirm('Akkauntni vaqtincha to‘xtatasizmi? Foydalanuvchi tizimdan chiqariladi.'))return;
    postAction('/api/admin/users/'+id+'/toggle',suspend?'Akkaunt vaqtincha to‘xtatildi.':'Akkaunt qayta faollashtirildi.');return;
  }
  if(action==='toggle-admin-listing'){
    const item=(state.adminData?.listings||[]).find(x=>Number(x.id)===id),pause=item?.status==='active';
    if(pause&&!window.confirm('E’lonni vaqtincha pauzaga qo‘yasizmi?'))return;
    postAction('/api/admin/listings/'+id+'/pause',pause?'E’lon pauzaga qo‘yildi.':'E’lon qayta faollashtirildi.',true);return;
  }
  if(action==='restore-listing'){
    if(!window.confirm('Ushbu e’lonni yana ko‘rinadigan qilasizmi?'))return;
    postAction('/api/admin/listings/'+id+'/restore','E’lon tiklandi.',true);return;
  }
  if(action==='export-admin'){
    exportAdminCsv(button.dataset.kind);return;
  }
  if(action==='resolve-report'){
    postAction('/api/admin/reports/'+id+'/resolve','Shikoyat ko‘rib chiqildi.');return;
  }
  if(action==='remove-listing'){
    if(!window.confirm('Ushbu e’lonni saytdan olib tashlaysizmi?'))return;
    postAction('/api/admin/listings/'+id+'/remove','E’lon olib tashlandi.',true);return;
  }
}
function updateRoleGate(){
  if(!state.user)return false;
  if(state.user.role!=='partner'){
    toast('Taom joylash uchun hamkor akkaunti kerak.','error');return true;
  }
  return false;
}
async function locateUser(){
  if(!navigator.geolocation){toast('Bu qurilmada joylashuv aniqlanmaydi.','error');return}
  $('#location-label').textContent='Aniqlanmoqda…';
  navigator.geolocation.getCurrentPosition(position=>{
    state.coords={lat:position.coords.latitude,lon:position.coords.longitude};
    $('#location-label').textContent='Joylashuv topildi';
    if($('#sort-select').value==='distance')state.sort='distance';
    loadListings();
    toast('Yaqin e’lonlar masofaga ko‘ra tartiblandi.');
  },()=>{
    $('#location-label').textContent='Joylashuvimni top';
    toast('Joylashuvga ruxsat berilmadi yoki aniqlanmadi.','error');
  },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
}
async function locateListing(){
  if(!navigator.geolocation){toast('Bu qurilmada joylashuv aniqlanmaydi.','error');return}
  $('#listing-location-status').textContent='Aniqlanmoqda…';
  navigator.geolocation.getCurrentPosition(position=>{
    $('input[name="latitude"]').value=position.coords.latitude;
    $('input[name="longitude"]').value=position.coords.longitude;
    $('#listing-location-status').textContent='Koordinata e’longa qo‘shildi.';
  },()=>{
    $('#listing-location-status').textContent='Joylashuv aniqlanmadi.';
    toast('Brauzer joylashuvga ruxsat bermadi.','error');
  },{timeout:10000,maximumAge:300000});
}
async function boot(){
  $('#year').textContent=new Date().getFullYear();
  $('#sort-select').value='soon';
  try{
    const result=await api('/api/auth/me');setUser(result.user);
  }catch{setUser(null)}
  await Promise.all([loadListings(),loadImpact(),loadLeaderboard()]);
  if(state.user)renderWorkspace();
}
$('#search-form').addEventListener('submit',event=>{
  event.preventDefault();state.query=$('#search-query').value.trim();loadListings();
});
$('#search-query').addEventListener('input',()=>{
  state.query=$('#search-query').value.trim();
  clearTimeout(window.ulashSearchTimer);
  window.ulashSearchTimer=setTimeout(loadListings,300);
});
document.querySelectorAll('[data-deal]').forEach(button=>button.addEventListener('click',()=>{
  state.deal=button.dataset.deal;updateFilterButtons();loadListings();
}));
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{
  state.category=state.category===button.dataset.category?'':button.dataset.category;
  updateFilterButtons();loadListings();
}));
$('#sort-select').addEventListener('change',event=>{
  state.sort=event.target.value;
  if(state.sort==='distance'&&!state.coords){
    toast('Masofani hisoblash uchun joylashuvingizni aniqlang.','error');
    state.sort='soon';event.target.value='soon';return;
  }
  renderListings(state.listings);
});
$('#location-action').addEventListener('click',locateUser);
$('#retry-load').addEventListener('click',()=>{loadListings();loadImpact()});
$('#clear-filters').addEventListener('click',()=>{
  state.query='';state.deal='';state.category='';
  $('#search-query').value='';updateFilterButtons();loadListings();
});
$('#auth-open').addEventListener('click',()=>openAuth('login'));
$('#partner-open').addEventListener('click',openListingForm);
$('#partner-join').addEventListener('click',()=>openAuth('register','partner'));
$('#donor-join').addEventListener('click',()=>openAuth('register','donor'));
$('#hero-partner').addEventListener('click',()=>openAuth('register','partner'));
$('#account-open').addEventListener('click',()=>renderWorkspace(true));
$('#menu-toggle').addEventListener('click',()=>{
  const nav=$('#mobile-nav'),open=nav.hidden;
  nav.hidden=!open;$('#menu-toggle').setAttribute('aria-expanded',String(open));
});
$('#mobile-nav').addEventListener('click',event=>{
  const action=event.target.closest('[data-mobile-action]')?.dataset.mobileAction;
  if(event.target.closest('a')||action||['mobile-auth-open','mobile-account-open','mobile-share-open'].includes(event.target.id)){
    $('#mobile-nav').hidden=true;$('#menu-toggle').setAttribute('aria-expanded','false');
  }
  if(event.target.id==='mobile-auth-open')openAuth('login');
  if(event.target.id==='mobile-account-open')renderWorkspace(true);
  if(event.target.id==='mobile-share-open')openListingForm();
});
$('#logout-button').addEventListener('click',async()=>{
  try{await api('/api/auth/logout',{method:'POST',body:'{}'})}catch{}
  setUser(null);$('#workspace-content').innerHTML='';
  toast('Tizimdan chiqdingiz.');window.scrollTo({top:0,behavior:'smooth'});
});
$('#auth-content').addEventListener('click',event=>{
  const button=event.target.closest('[data-auth-mode]');
  if(button){state.authMode=button.dataset.authMode;renderAuth()}
});
$('#auth-content').addEventListener('submit',event=>{
  if(event.target.id==='auth-form'){event.preventDefault();submitAuth(event.target)}
});
$('#action-content').addEventListener('submit',event=>{
  if(event.target.id==='listing-form'){event.preventDefault();submitListing(event.target)}
  if(event.target.id==='reserve-form'){event.preventDefault();submitReservation(event.target)}
  if(event.target.id==='review-form'){event.preventDefault();submitReview(event.target)}
  if(event.target.id==='report-form'){event.preventDefault();submitReport(event.target)}
  if(event.target.id==='reward-form'){event.preventDefault();submitReward(event.target)}
});
$('#action-content').addEventListener('click',event=>{
  if(event.target.closest('#listing-location'))locateListing();
});
$('#action-content').addEventListener('change',event=>{
  if(event.target.id==='delivery-method'){
    const delivery=event.target.value==='volunteer';
    $('#delivery-address-field').hidden=!delivery;
    $('#delivery-address').required=delivery;
  }
});
$('#workspace-content').addEventListener('click',event=>{
  const tab=event.target.closest('[data-admin-tab]');
  if(tab){setAdminTab($('#workspace-content .admin-console'),tab.dataset.adminTab);return}
  const button=event.target.closest('[data-action]');
  if(button)accountAction(button);
});
$('#workspace-content').addEventListener('input',event=>{
  if(!event.target.matches('.admin-search-input'))return;
  state.adminSearch=event.target.value;
  applyAdminSearch($('#workspace-content .admin-console'));
});
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close]');
  if(close){const d=$('#'+close.dataset.close);if(d.open)d.close();return}
  const reserve=event.target.closest('[data-reserve]');
  if(reserve)openReserve(reserve.dataset.reserve);
  const report=event.target.closest('[data-report]');
  if(report)reportForm(report.dataset.report);
});
$('#listing-grid').addEventListener('error',event=>{
  if(event.target.matches('img[data-cover]'))event.target.src=fallbackPhoto;
},true);
$('#auth-modal').addEventListener('click',event=>{
  if(event.target===$('#auth-modal'))$('#auth-modal').close();
});
$('#action-modal').addEventListener('click',event=>{
  if(event.target===$('#action-modal'))$('#action-modal').close();
});
boot();
