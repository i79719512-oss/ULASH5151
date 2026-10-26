import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||4173);
const HOST=process.env.HOST||'127.0.0.1';
const DB_PATH=resolve(process.env.ULASH_DB_PATH||ROOT+'/data/ulash.sqlite');
if(!existsSync(dirname(DB_PATH)))mkdirSync(dirname(DB_PATH),{recursive:true});
const UPLOAD_DIR=resolve(process.env.ULASH_UPLOAD_DIR||dirname(DB_PATH)+'/uploads');
if(!existsSync(UPLOAD_DIR))mkdirSync(UPLOAD_DIR,{recursive:true});
const db=new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');

let sql='CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,';
sql+='name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,';
sql+='password_salt TEXT NOT NULL,role TEXT NOT NULL,organization TEXT,area TEXT,transport T' +
  'EXT,';
sql+="created_at TEXT NOT NULL DEFAULT(datetime('now')))";
db.exec(sql);
db.exec('CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERE' +
  'NCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL)');
function ensureColumn(table,definition){
 const name=definition.trim().split(/\s+/)[0];
 const columns=db.prepare('PRAGMA table_info('+table+')').all();
 if(!columns.some(column=>column.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+definition);
}
ensureColumn('users','partner_verified INTEGER NOT NULL DEFAULT 0');
ensureColumn('users','partner_terms_accepted_at TEXT');
ensureColumn('users',"account_status TEXT NOT NULL DEFAULT 'active'");

sql='CREATE TABLE IF NOT EXISTS listings(id INTEGER PRIMARY KEY,partner_id INTEGER REFERENC' +
  'ES users(id),';
sql+='title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,deal_type TEXT NO' +
  'T NULL,';
sql+='price INTEGER NOT NULL,original_price INTEGER NOT NULL DEFAULT 0,portions_total INTEGE' +
  'R NOT NULL,';
sql+='portions_available INTEGER NOT NULL,pickup_start TEXT NOT NULL,pickup_end TEXT NOT NUL' +
  'L,';
sql+='expires_at TEXT NOT NULL,prepared_at TEXT NOT NULL,pickup_address TEXT NOT NULL,area T' +
  'EXT NOT NULL,';
sql+="allergens TEXT NOT NULL,latitude REAL,longitude REAL,status TEXT NOT NULL DEFAULT 'act" +
  "ive',";
sql+='image_path TEXT,clothing_size TEXT,clothing_condition TEXT,age_group TEXT,'+
  'weight_grams INTEGER NOT NULL DEFAULT 0,safety_confirmed_at TEXT,';
sql+="created_at TEXT NOT NULL DEFAULT(datetime('now')))";
db.exec(sql);
ensureColumn('listings','image_path TEXT');
ensureColumn('listings','clothing_size TEXT');
ensureColumn('listings','clothing_condition TEXT');
ensureColumn('listings','age_group TEXT');
ensureColumn('listings','weight_grams INTEGER NOT NULL DEFAULT 0');
ensureColumn('listings','safety_confirmed_at TEXT');

sql='CREATE TABLE IF NOT EXISTS reservations(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NU' +
  'LL,';
sql+='listing_id INTEGER REFERENCES listings(id),customer_id INTEGER REFERENCES users(id),';
sql+='quantity INTEGER NOT NULL,status TEXT NOT NULL DEFAULT "reserved",';
sql+='delivery_method TEXT NOT NULL DEFAULT "pickup",delivery_status TEXT NOT NULL DEFAULT "' +
  'not_needed",';
sql+='volunteer_id INTEGER REFERENCES users(id),delivery_address TEXT,customer_note TEXT DEF' +
  'AULT "",';
sql+="created_at TEXT NOT NULL DEFAULT(datetime('now')),collected_at TEXT)";
db.exec(sql);
sql='CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,user_id INTEGER REFERE' +
  'NCES users(id),';
sql+='title TEXT NOT NULL,body TEXT NOT NULL,reservation_id INTEGER REFERENCES reservations(' +
  'id),';
sql+="read_at TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')))";
db.exec(sql);
db.exec('CREATE INDEX IF NOT EXISTS listings_public ON listings(status,expires_at,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS listings_partner ON listings(partner_id,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS reservations_customer ON reservations(customer_id,status,cr' +
  'eated_at)');
db.exec('CREATE INDEX IF NOT EXISTS reservations_tasks ON reservations(delivery_method,delivery' +
  '_status,status)');
db.exec('CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY,reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),customer_id INTEGER NOT NULL REFERENCES users(id),partner_id INTEGER NOT NULL REFERENCES users(id),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),comment TEXT NOT NULL DEFAULT "",created_at TEXT NOT NULL DEFAULT(datetime(\'now\')))');
db.exec('CREATE INDEX IF NOT EXISTS reviews_partner ON reviews(partner_id,created_at)');
db.exec('CREATE TABLE IF NOT EXISTS listing_reports(id INTEGER PRIMARY KEY,listing_id INTEGER NOT NULL REFERENCES listings(id),reporter_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,details TEXT NOT NULL DEFAULT "",status TEXT NOT NULL DEFAULT "open",created_at TEXT NOT NULL DEFAULT(datetime(\'now\')),resolved_at TEXT,UNIQUE(listing_id,reporter_id))');
db.exec('CREATE TABLE IF NOT EXISTS karma_ledger(id INTEGER PRIMARY KEY,volunteer_id INTEGER NOT NULL REFERENCES users(id),points INTEGER NOT NULL,reason TEXT NOT NULL,reservation_id INTEGER UNIQUE REFERENCES reservations(id),claim_id INTEGER UNIQUE,created_at TEXT NOT NULL DEFAULT(datetime(\'now\')))');
db.exec('CREATE TABLE IF NOT EXISTS partner_rewards(id INTEGER PRIMARY KEY,partner_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,points_cost INTEGER NOT NULL CHECK(points_cost>0),stock INTEGER NOT NULL CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT(datetime(\'now\')))');
db.exec('CREATE TABLE IF NOT EXISTS reward_claims(id INTEGER PRIMARY KEY,reward_id INTEGER NOT NULL REFERENCES partner_rewards(id),volunteer_id INTEGER NOT NULL REFERENCES users(id),code TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT "pending",created_at TEXT NOT NULL DEFAULT(datetime(\'now\')),fulfilled_at TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS agreements(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,version TEXT NOT NULL,accepted_at TEXT NOT NULL,ip_hash TEXT NOT NULL DEFAULT "")');

const PUBLIC=new Set(['index.html','app.css','site-extra.css','simple.css','app.js','icon.svg']);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const attempts=new Map();
let lastAttemptCleanup=0;
class HttpError extends Error{constructor(status,message){super(message);this.status=status}}
function security(){
 const csp=["default-src 'self'","img-src 'self' data: https://images.unsplash.com",
 "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
 "font-src 'self' https://fonts.gstatic.com","script-src 'self'","connect-src 'self'",
 "base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join('; ');
 return {'x-content-type-options':'nosniff','x-frame-options':'DENY',
 'referrer-policy':'strict-origin-when-cross-origin','permissions-policy':'geolocation=(self)',
 'content-security-policy':csp};
}
function send(res,status,data,extra={}){
 const b=Buffer.from(JSON.stringify(data));
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
 'content-length':b.length,'cache-control':'no-store',...security(),...extra});
 res.end(b);
}
async function readBody(req){
 let size=0,parts=[];
 for await(const part of req){size+=part.length;if(size>5*1024*1024)throw new HttpError(413,'So‘rov 5 MB dan katta.');parts.push(part)}
 if(!parts.length)return{};
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}
 catch{throw new HttpError(400,'JSON so‘rovi noto‘g‘ri.')}
}
function field(value,label,max,min=1){
 const x=String(value??'').trim();
 if(x.length<min||x.length>max)throw new HttpError(400,label+': '+min+'–'+max+' belgi kiriting.');
 return x;
}
function integer(value,label,min,max){
 const x=Number(value);
 if(!Number.isInteger(x)||x<min||x>max)throw new HttpError(400,label+' qiymati noto‘g‘ri.');
 return x;
}
function asDate(value,label){
 const x=new Date(value);
 if(!Number.isFinite(x.getTime()))throw new HttpError(400,label+' sanasi noto‘g‘ri.');
 return x.toISOString();
}
function normalizePhone(value){
 let x=String(value??'').trim().replace(/[\s()-]/g,'');
 if(x.startsWith('00'))x='+'+x.slice(2);
 if(!/^\+?\d{9,15}$/.test(x))throw new HttpError(400,'Telefon raqamini to‘g‘ri kiriting.');
 return x;
}
function cookieMap(header=''){
 const result={};
 for(const part of header.split(';')){const i=part.indexOf('=');if(i>0)result[part.slice(0,i).trim()]=part.slice(i+1).trim()}
 return result;
}
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function setCookie(res,token,age){
 res.setHeader('set-cookie','ulash_session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+
  (process.env.NODE_ENV==='production'?'; Secure':''));
}
function createSession(id,res){
 const token=randomBytes(32).toString('base64url');
 db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date().toISOString());
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
 .run(tokenHash(token),id,new Date(Date.now()+14*86400000).toISOString());
 setCookie(res,token,14*86400);
}
function currentUser(req){
 const token=cookieMap(req.headers.cookie).ulash_session;
 if(!token)return null;
 return db.prepare('SELECT u.id,u.name,u.phone,u.role,u.organization,u.area,u.transport,u.partner_verified FROM sessions s JO' +
  "IN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='active'")
 .get(tokenHash(token),new Date().toISOString())||null;
}
function requireUser(req,roles=[]){
 const user=currentUser(req);
 if(!user)throw new HttpError(401,'Tizimga kiring va qayta urinib ko‘ring.');
 if(roles.length&&!roles.includes(user.role))throw new HttpError(403,'Akkaunt turi bu amal uchun mos emas.');
 return user;
}
function rateLimit(req,key,max){
 const id=(req.socket.remoteAddress||'local')+':'+key,now=Date.now();
 if(now-lastAttemptCleanup>60000){
  for(const [entry,row] of attempts)if(now-row.start>900000)attempts.delete(entry);
  lastAttemptCleanup=now;
 }
 const row=attempts.get(id)||{count:0,start:now};
 if(now-row.start>900000){row.count=0;row.start=now}
 if(++row.count>max)throw new HttpError(429,'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring.');
 attempts.set(id,row);
}
function transaction(fn){
 db.exec('BEGIN IMMEDIATE');
 try{const value=fn();db.exec('COMMIT');return value}
 catch(error){db.exec('ROLLBACK');throw error}
}
function userDto(u){
 return{id:Number(u.id),name:u.name,phone:u.phone,role:u.role,
 organization:u.organization,area:u.area,transport:u.transport,partnerVerified:Boolean(u.partner_verified)};
}
function km(a,b,c,d){
 const r=x=>x*Math.PI/180,lat=r(c-a),lon=r(d-b);
 const val=Math.sin(lat/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(lon/2)**2;
 return Math.round(6371*2*Math.atan2(Math.sqrt(val),Math.sqrt(1-val))*10)/10;
}
function listingDto(x,lat=null,lon=null,revealLocation=false){
 return{id:Number(x.id),title:x.title,description:x.description,category:x.category,
 dealType:x.deal_type,price:Number(x.price),originalPrice:Number(x.original_price),
 portionsAvailable:Number(x.portions_available),pickupStart:x.pickup_start,pickupEnd:x.pickup_end,
 expiresAt:x.expires_at,preparedAt:x.prepared_at,
 pickupAddress:revealLocation?x.pickup_address:'Band qilingach aniq manzil ochiladi.',area:x.area,
 allergens:x.allergens,imageUrl:x.image_path||null,clothingSize:x.clothing_size||'',
 clothingCondition:x.clothing_condition||'',ageGroup:x.age_group||'',weightGrams:Number(x.weight_grams||0),
 safetyConfirmed:Boolean(x.safety_confirmed_at),latitude:revealLocation?x.latitude:null,longitude:revealLocation?x.longitude:null,
 partnerId:Number(x.partner_id),partnerVerified:Boolean(x.partner_verified),partnerName:x.partner_name,
 isCommunityDonor:x.partner_role==='donor',
 distanceKm:lat!==null&&x.latitude!==null&&x.longitude!==null?km(lat,lon,x.latitude,x.longitude):null};
}
function getListings(url){
 const now=new Date().toISOString();
 const where=["l.status='active'","u.account_status='active'","(u.role='donor' OR u.partner_verified=1)","l.expires_at>?","l.pickup_end>?","l.portions_available>0"];
 const args=[now,now],q=(url.searchParams.get('q')||'').trim().slice(0,80);
 if(q){where.push('(l.title LIKE ? OR l.description LIKE ? OR l.area LIKE ? OR COALESCE(u.organization,\'\') LIKE ?)');const s='%'+q+'%';args.push(s,s,s,s)}
 const cat=url.searchParams.get('category'),deal=url.searchParams.get('deal');
 if(['meal','grocery','clothing'].includes(cat)){where.push('l.category=?');args.push(cat)}
 if(['free','discount'].includes(deal)){where.push('l.deal_type=?');args.push(deal)}
 const rows=db.prepare("SELECT l.*,CASE WHEN u.role='donor' THEN 'Mahalladan oila' ELSE u.organization END AS partner_name,u.partner_verified,u.role AS partner_role FROM listings l JOIN users u ON u.id=l.partn" +
  'er_id WHERE '+where.join(' AND ')+' ORDER BY l.pickup_end LIMIT 200').all(...args);
 const lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
 const valid=Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
 const data=rows.map(x=>listingDto(x,valid?lat:null,valid?lon:null));
 if(valid)data.sort((a,b)=>(a.distanceKm??Infinity)-(b.distanceKm??Infinity));
 return{listings:data};
}
function register(body,res){
 const name=field(body.name,'Ism',70,2),tel=normalizePhone(body.phone),pass=String(body.password||'');
 if(pass.length<10||pass.length>128)throw new HttpError(400,'Parol kamida 10 ta belgi bo‘lsin.');
 const role=['customer','partner','donor','volunteer'].includes(body.role)?body.role:'customer';
 if(role==='partner'&&body.partnerTermsAccepted!==true)throw new HttpError(400,'Hamkorlik shartlari va xavfsizlik qoidalarini tasdiqlang.');
 if(role==='donor'&&body.donorTermsAccepted!==true)throw new HttpError(400,'Kiyim ulashish qoidalarini tasdiqlang.');
 const org=role==='partner'?field(body.organization,'Tashkilot nomi',100,2):null;
 const area=role==='customer'?null:field(body.area,'Hudud',80,2);
 const transport=role==='volunteer'?field(body.transport,'Yetkazish usuli',30,2):null;
 const salt=randomBytes(16).toString('hex'),hash=scryptSync(pass,salt,64).toString('hex');
 let id;const termsAt=role==='partner'?new Date().toISOString():null;
 const donorTermsAt=role==='donor'?new Date().toISOString():null;
 try{id=Number(db.prepare('INSERT INTO users(name,phone,password_hash,password_salt,role,organization,area,transp' +
  'ort,partner_terms_accepted_at) VALUES(?,?,?,?,?,?,?,?,?)').run(name,tel,hash,salt,role,org,area,transport,termsAt).lastInsertRowid)}
 catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'Bu raqamda akkaunt bor. Tizimga kiring.');throw e}
 if(role==='partner')db.prepare('INSERT INTO agreements(user_id,kind,version,accepted_at) VALUES(?,?,?,?)')
  .run(id,'partner-terms','ulash-partner-v1',termsAt);
 if(role==='donor')db.prepare('INSERT INTO agreements(user_id,kind,version,accepted_at) VALUES(?,?,?,?)')
  .run(id,'community-clothing-terms','ulash-community-clothing-v1',donorTermsAt);
 const user=db.prepare('SELECT id,name,phone,role,organization,area,transport,partner_verified FROM users WHERE id=?').get(id);
 createSession(id,res);return userDto(user);
}
function login(body,res,req){
 rateLimit(req,'login',7);
 const tel=normalizePhone(body.phone),pass=String(body.password||''),user=db.prepare('SELECT * FROM users WHERE phone=?').get(tel);
 const salt=user?user.password_salt:'ulash-invalid-salt';
 const expected=user?Buffer.from(user.password_hash,'hex'):Buffer.alloc(64);
 const actual=scryptSync(pass.slice(0,128),salt,64);
 if(!user||!timingSafeEqual(expected,actual))throw new HttpError(401,'Telefon yoki parol noto‘g‘ri.');
 if(user.account_status==='suspended')throw new HttpError(403,'Akkaunt vaqtincha to‘xtatilgan. Admin bilan bog‘laning.');
 createSession(Number(user.id),res);return userDto(user);
}
function decodeListingImage(value){
 if(!value)return null;
 if(typeof value!=='string'||value.length>3_600_000)throw new HttpError(413,'Rasm 2.5 MB dan kichik bo‘lsin.');
 const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match)throw new HttpError(400,'Faqat JPG, PNG yoki WEBP rasm yuklang.');
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length>2_500_000)throw new HttpError(413,'Rasm 2.5 MB dan kichik bo‘lsin.');
 const ext=match[1]==='jpeg'?'jpg':match[1];
 const valid=ext==='jpg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:
  ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
  bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid)throw new HttpError(400,'Rasm fayli formati tekshiruvdan o‘tmadi.');
 const name=randomBytes(18).toString('hex')+'.'+ext;
 writeFileSync(resolve(UPLOAD_DIR,name),bytes,{flag:'wx'});
 return'/uploads/'+name;
}
function createListing(body,user){
 const title=field(body.title,'Taom nomi',100,2),description=field(body.description,'Tavsif',500,5);
 const category=['meal','grocery','clothing'].includes(body.category)?body.category:null;
 if(user.role==='donor'&&category!=='clothing')throw new HttpError(403,'Oila akkaunti faqat kiyim e’loni joylashi mumkin.');
 const deal=category==='clothing'?'free':['free','discount'].includes(body.dealType)?body.dealType:null;
 if(!category||!deal)throw new HttpError(400,'Taom va taklif turini tanlang.');
 const price=category==='clothing'?0:integer(body.price,'Narx',0,100000000),original=category==='clothing'?0:integer(body.originalPrice||0,'Odatiy narx',0,100000000);
 if(deal==='free'&&price!==0)throw new HttpError(400,'Bepul taklif narxi nol bo‘lsin.');
 if(deal==='discount'&&(price===0||original<=price))throw new HttpError(400,'Chegirma narxi odatiy narxdan past bo‘lsin.');
 const qty=integer(body.portions,'Porsiya',1,500);
 const start=asDate(body.pickupStart,'Olib ketish'),end=asDate(body.pickupEnd,'Olib ketish');
 const expires=asDate(body.expiresAt,'E’lon tugash'),prepared=asDate(body.preparedAt,'Tayyorlangan');
 const now=Date.now();
 if(new Date(start).getTime()<now-300000||new Date(end)<=new Date(start))throw new HttpError(400,'Olib ketish vaqtlari noto‘g‘ri.');
 const maxLifetime=category==='clothing'?30*86400000:72*3600000;
 if(new Date(expires)<=new Date(end)||new Date(expires).getTime()>now+maxLifetime)throw new HttpError(400,category==='clothing'?'Kiyim e’loni 30 kun ichida tugasin.':'Taom e’loni 72 soat ichida tugasin.');
 if(new Date(prepared).getTime()>now+300000)throw new HttpError(400,'Tayyorlangan vaqt kelajakda bo‘lmasin.');
 if(category!=='clothing'){
  const day=value=>{
   const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
   const part=type=>parts.find(item=>item.type===type)?.value||'';
   return part('year')+'-'+part('month')+'-'+part('day');
  };
  const today=day(now);
  if(day(prepared)!==today||day(start)!==today||day(end)!==today)
   throw new HttpError(400,'Taom shu kuni tayyorlangan va olib ketish vaqti ham shu kun ichida bo‘lishi kerak.');
 }
 const address=field(body.pickupAddress,'Manzil',180,4);
 const area=field(body.area,'Hudud',80,2);
 const allergens=category==='clothing'?'Kiyim e’loni':field(body.allergens,'Allergenlar va saqlash',240,2);
 const clothingSize=category==='clothing'?field(body.clothingSize,'O‘lcham',40,1):null;
 const clothingCondition=category==='clothing'&&['new','like-new','good','used'].includes(body.clothingCondition)?body.clothingCondition:null;
 const ageGroup=category==='clothing'&&['baby','child','adult'].includes(body.ageGroup)?body.ageGroup:null;
 if(category==='clothing'&&(!clothingCondition||!ageGroup))throw new HttpError(400,'Kiyim holati va kim uchunligini tanlang.');
 if(category!=='clothing'&&body.safetyConfirmed!==true)throw new HttpError(400,'Taom xavfsizligi va ma’lumotlar to‘g‘riligini tasdiqlang.');
 const weight=integer(body.weightGrams||0,'Vazn (gramm)',0,10000000);
 const lat=body.latitude==null||body.latitude===''?null:Number(body.latitude);
 const lon=body.longitude==null||body.longitude===''?null:Number(body.longitude);
 if((lat===null)!==(lon===null)||lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>90)||lon!==null&&(!Number.isFinite(lon)||
  Math.abs(lon)>180))throw new HttpError(400,'Koordinatalar noto‘g‘ri.');
 const imagePath=decodeListingImage(body.imageData);
 try{
 const result=db.prepare('INSERT INTO listings(partner_id,title,description,category,deal_type,price,original_pr' +
  'ice,portions_total,portions_available,pickup_start,pickup_end,expires_at,prepared_at,p' +
  'ickup_address,area,allergens,latitude,longitude,image_path,clothing_size,clothing_condition,age_group,weight_grams,safety_confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
 .run(Number(user.id),title,description,category,deal,price,original,qty,qty,start,end,expires,prepared,address,area,allergens,lat,lon,imagePath,clothingSize,clothingCondition,ageGroup,weight,category==='clothing'?null:new Date().toISOString());
 return Number(result.lastInsertRowid);
 }catch(error){if(imagePath)try{unlinkSync(resolve(UPLOAD_DIR,imagePath.split('/').pop()))}catch{};throw error}
}
function reserve(body,user){
 const id=integer(body.listingId,'E’lon',1,Number.MAX_SAFE_INTEGER),qty=integer(body.quantity,'Porsiya',1,20);
 const method=body.deliveryMethod==='volunteer'?'volunteer':'pickup';
 const address=method==='volunteer'?field(body.deliveryAddress,'Yetkazish manzili',180,6):null;
 const note=String(body.note||'').trim().slice(0,240);
 return transaction(()=>{
  const item=db.prepare('SELECT l.id,l.partner_id,l.title,l.category,l.portions_available,l.price,l.status,l.expires_at,l.pickup_end,u.account_status AS partner_status,u.role AS partner_role,u.partner_verified FROM listings l JOIN users u ON u.id=l.partner_id WHERE l.id=?').get(id);
  if(!item||item.status!=='active'||item.partner_status!=='active'||(item.partner_role!=='donor'&&!item.partner_verified)||new Date(item.expires_at)<=new Date()||new Date(item.pickup_end)<=new Date())throw new HttpError(404,'E’lon endi mavjud emas.');
  if(Number(item.portions_available)<qty)throw new HttpError(409,'Yetarli porsiya qolmagan.');
  db.prepare('UPDATE listings SET portions_available=portions_available-? WHERE id=?').run(qty,id);
  const code='UL-'+randomBytes(3).toString('hex').toUpperCase();
  const delivery=method==='volunteer'?'requested':'not_needed';
  const r=db.prepare('INSERT INTO reservations(code,listing_id,customer_id,quantity,delivery_method,delivery' +
  '_status,delivery_address,customer_note) VALUES(?,?,?,?,?,?,?,?)')
   .run(code,id,Number(user.id),qty,method,delivery,address,note);
  const rid=Number(r.lastInsertRowid);
  db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)')
   .run(Number(item.partner_id),'Yangi band',user.name+' · '+item.title+' · '+qty+(item.category==='clothing'?' dona':' porsiya'),rid);
  return{id:rid,code,listingId:id,title:item.title,quantity:qty,price:Number(item.price),deliveryMethod:method,deliveryStatus:delivery};
 });
}
function getRoute(req,res,url){
 const p=url.pathname;
 if(p==='/api/health')return send(res,200,{ok:true,database:'connected'});
 if(p==='/api/auth/me'){const u=currentUser(req);return send(res,200,{user:u?userDto(u):null})}
 if(p==='/api/listings')return send(res,200,getListings(url));
 if(p==='/api/impact'){
  const now=new Date().toISOString();
  const x=db.prepare("SELECT (SELECT COUNT(*) FROM listings l JOIN users u ON u.id=l.partner_id WHERE l.status='active' AND u.account_status='active' AND (u.role='donor' OR u.partner_verified=1) AND l.expires_at>? AND l.pickup_end>? AND l.portions_available>0) AS open," +
  "(SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE status='collected') AS saved,"+
  "(SELECT COALESCE(SUM(r.quantity*l.weight_grams),0) FROM reservations r JOIN listings l ON l.id=r.listing_id WHERE r.status='collected') AS grams,"+
  "(SELECT COUNT(*) FROM users WHERE role='partner') AS partners,"+
  "(SELECT COUNT(*) FROM users WHERE role='partner' AND partner_verified=1) AS verified").get(now,now);
  return send(res,200,{openListings:Number(x.open),rescuedPortions:Number(x.saved),rescuedGrams:Number(x.grams),partners:Number(x.partners),verifiedPartners:Number(x.verified)});
 }
 if(p==='/api/partners/top'){
  const rows=db.prepare("SELECT u.id,u.organization,u.area,u.partner_verified,"+
   "(SELECT COUNT(*) FROM reservations r JOIN listings l ON l.id=r.listing_id WHERE l.partner_id=u.id AND r.status='collected') AS rescued,"+
   "(SELECT ROUND(AVG(rating),1) FROM reviews WHERE partner_id=u.id) AS rating,"+
   "(SELECT COUNT(*) FROM reviews WHERE partner_id=u.id) AS review_count " +
   "FROM users u WHERE u.role='partner' AND u.partner_verified=1 AND u.account_status='active' ORDER BY rescued DESC,COALESCE(rating,0) DESC,u.created_at ASC LIMIT 8").all();
  return send(res,200,{partners:rows.map(x=>({...x,id:Number(x.id),rescued:Number(x.rescued),rating:x.rating===null?null:Number(x.rating),reviewCount:Number(x.review_count),verified:Boolean(x.partner_verified)}))});
 }
 if(p==='/api/my/reservations'){
  const u=requireUser(req,['customer']);
  const rows=db.prepare('SELECT r.*,l.title,l.area,l.pickup_address,l.pickup_start,l.pickup_end,l.price,l.category,l.image_path,p.organ' +
  'ization AS partner_name FROM reservations r JOIN listings l ON l.id=r.listing_id JOIN ' +
  'users p ON p.id=l.partner_id WHERE r.customer_id=? ORDER BY r.created_at DESC').all(Number(u.id));
  for(const row of rows)row.reviewSubmitted=Boolean(db.prepare('SELECT 1 AS found FROM reviews WHERE reservation_id=?').get(Number(row.id)));
  return send(res,200,{reservations:rows});
 }
 if(p==='/api/partner/dashboard'){
  const u=requireUser(req,['partner']);
  const own=db.prepare('SELECT * FROM listings WHERE partner_id=? ORDER BY created_at DESC').all(Number(u.id));
  const orders=db.prepare('SELECT r.*,l.title AS listing_title,l.area,l.category,c.name AS customer_name,c.phone AS customer' +
  '_phone FROM reservations r JOIN listings l ON l.id=r.listing_id JOIN users c ON c.id=r' +
  '.customer_id WHERE l.partner_id=? ORDER BY r.created_at DESC LIMIT 100').all(Number(u.id));
  const rewards=db.prepare('SELECT * FROM partner_rewards WHERE partner_id=? ORDER BY created_at DESC').all(Number(u.id));
  const claims=db.prepare('SELECT c.*,r.title AS reward_title,r.points_cost FROM reward_claims c JOIN partner_rewards r ON r.id=c.reward_id WHERE r.partner_id=? ORDER BY c.created_at DESC LIMIT 50').all(Number(u.id));
  const partner=db.prepare('SELECT partner_verified,partner_terms_accepted_at FROM users WHERE id=?').get(Number(u.id));
  const notes=db.prepare('SELECT id,title,body,created_at FROM notifications WHERE user_id=? ORDER BY created_at' +
  ' DESC LIMIT 30').all(Number(u.id));
  return send(res,200,{listings:own,reservations:orders,rewards,claims,partner,notifications:notes});
 }
 if(p==='/api/donor/dashboard'){
  const u=requireUser(req,['donor']);
  const listings=db.prepare('SELECT * FROM listings WHERE partner_id=? ORDER BY created_at DESC').all(Number(u.id));
  const reservations=db.prepare('SELECT r.*,l.title AS listing_title,l.area,l.category,l.pickup_start,l.pickup_end,c.name AS customer_name,c.phone AS customer_phone FROM reservations r JOIN listings l ON l.id=r.listing_id JOIN users c ON c.id=r.customer_id WHERE l.partner_id=? ORDER BY r.created_at DESC LIMIT 100').all(Number(u.id));
  const notifications=db.prepare('SELECT id,title,body,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(Number(u.id));
  return send(res,200,{listings,reservations,notifications});
 }
 if(p==='/api/volunteer/tasks'){
  const u=requireUser(req,['volunteer']);
  const tasks=db.prepare("SELECT r.id,r.code,r.quantity,r.delivery_status,CASE WHEN r.volunteer_id=?" +
  " THEN r.delivery_address ELSE NULL END AS delivery_address,r.created_at,l.titl" +
  "e AS listing_title,l.category,l.area,CASE WHEN r.volunteer_id=? THEN l.pickup_address ELSE NULL END AS pickup_address,CASE WHEN p.role='donor' THEN 'Mahalladan oila' ELSE p.organization END AS partner_name,CASE WHEN r." +
  "volunteer_id=? THEN c.name ELSE NULL END AS customer_name,CASE WHEN r.volunteer_id=? T" +
  "HEN c.phone ELSE NULL END AS customer_phone FROM reservations r JOIN listings l ON l.i" +
  "d=r.listing_id JOIN users c ON c.id=r.customer_id JOIN users p ON p.id=l.partner_id WH" +
  "ERE r.status='reserved' AND r.delivery_method='volunteer' AND (r.delivery_status='requ" +
  "ested' OR (r.volunteer_id=? AND r.delivery_status='assigned')) ORDER BY r.created_at")
   .all(Number(u.id),Number(u.id),Number(u.id),Number(u.id),Number(u.id));
  const karma=db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM karma_ledger WHERE volunteer_id=?').get(Number(u.id));
  const rewards=db.prepare('SELECT r.*,u.organization AS partner_name,u.partner_verified FROM partner_rewards r JOIN users u ON u.id=r.partner_id WHERE r.active=1 AND r.stock>0 AND u.partner_verified=1 ORDER BY r.points_cost').all();
  const claims=db.prepare('SELECT c.*,r.title AS reward_title,r.points_cost,u.organization AS partner_name FROM reward_claims c JOIN partner_rewards r ON r.id=c.reward_id JOIN users u ON u.id=r.partner_id WHERE c.volunteer_id=? ORDER BY c.created_at DESC LIMIT 30').all(Number(u.id));
  return send(res,200,{tasks,karmaPoints:Number(karma.points),rewards,claims});
 }
 if(p==='/api/admin/overview'){
  requireUser(req,['admin']);
  const partners=db.prepare("SELECT id,name,phone,organization,area,created_at FROM users WHERE role='partner' AND partner_verified=0 ORDER BY created_at").all();
  const reports=db.prepare("SELECT q.*,l.title AS listing_title,u.name AS reporter_name FROM listing_reports q JOIN listings l ON l.id=q.listing_id JOIN users u ON u.id=q.reporter_id WHERE q.status='open' ORDER BY q.created_at DESC").all();
  const listings=db.prepare("SELECT l.id,l.title,l.category,l.deal_type,l.price,l.portions_available,l.expires_at,l.created_at,l.status,l.area,l.partner_id,CASE WHEN u.role='donor' THEN 'Mahalladan oila' ELSE COALESCE(u.organization,u.name) END AS owner_name,u.role AS owner_role,u.partner_verified,u.account_status AS owner_status FROM listings l JOIN users u ON u.id=l.partner_id ORDER BY l.created_at DESC LIMIT 150").all();
  const members=db.prepare("SELECT id,name,phone,role,organization,area,account_status,partner_verified,created_at FROM users WHERE role!='admin' ORDER BY created_at DESC LIMIT 250").all();
  const reservations=db.prepare("SELECT r.id,r.code,r.quantity,r.status,r.delivery_method,r.delivery_status,r.created_at,l.title AS listing_title,c.name AS customer_name,CASE WHEN p.role='donor' THEN 'Mahalladan oila' ELSE COALESCE(p.organization,p.name) END AS owner_name FROM reservations r JOIN listings l ON l.id=r.listing_id JOIN users c ON c.id=r.customer_id JOIN users p ON p.id=l.partner_id ORDER BY r.created_at DESC LIMIT 150").all();
  const counts=db.prepare("SELECT (SELECT COUNT(*) FROM users WHERE role!='admin') users,(SELECT COUNT(*) FROM listings) listings,(SELECT COUNT(*) FROM listings WHERE status='active') activeListings,(SELECT COUNT(*) FROM reservations) reservations,(SELECT COUNT(*) FROM reservations WHERE status='collected') collected,(SELECT COUNT(*) FROM users WHERE role='partner' AND partner_verified=0) pendingPartners,(SELECT COUNT(*) FROM listing_reports WHERE status='open') openReports,(SELECT COUNT(*) FROM users WHERE account_status='suspended') suspended").get();
  return send(res,200,{pendingPartners:partners,reports,listings,members,reservations,counts});
 }
 if(p==='/api/notifications'){
  const u=requireUser(req);
  const rows=db.prepare('SELECT id,title,body,reservation_id,read_at,created_at FROM notifications WHERE user_i' +
  'd=? ORDER BY created_at DESC LIMIT 50').all(Number(u.id));
  return send(res,200,{notifications:rows});
 }
 return false;
}
async function writeRoute(req,res,url){
 const p=url.pathname;
 if(req.method==='POST'&&p==='/api/admin/setup'){
  rateLimit(req,'admin-setup',3);
  const body=await readBody(req),secret=process.env.ULASH_ADMIN_SETUP_KEY;
  if(!secret)throw new HttpError(503,'Admin sozlash kaliti serverda belgilanmagan.');
  if(db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get())throw new HttpError(409,'Admin allaqachon yaratilgan.');
  const given=Buffer.from(createHash('sha256').update(String(body.setupKey||'')).digest('hex'));
  const expected=Buffer.from(createHash('sha256').update(secret).digest('hex'));
  if(!timingSafeEqual(given,expected))throw new HttpError(403,'Sozlash kaliti noto‘g‘ri.');
  const name=field(body.name,'Ism',70,2),phone=normalizePhone(body.phone),password=String(body.password||'');
  if(password.length<12||password.length>128)throw new HttpError(400,'Admin paroli kamida 12 ta belgidan iborat bo‘lsin.');
  const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
  let id;try{id=Number(db.prepare('INSERT INTO users(name,phone,password_hash,password_salt,role) VALUES(?,?,?,?,?)').run(name,phone,hash,salt,'admin').lastInsertRowid)}
  catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'Bu telefon raqam allaqachon ro‘yxatdan o‘tgan.');throw e}
  const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);createSession(id,res);return send(res,201,{user:userDto(user)});
 }
 if(req.method==='POST'&&p==='/api/auth/register'){
  rateLimit(req,'register',10);return send(res,201,{user:register(await readBody(req),res)});
 }
 if(req.method==='POST'&&p==='/api/auth/login')return send(res,200,{user:login(await readBody(req),res,req)});
 if(req.method==='POST'&&p==='/api/auth/logout'){
  const token=cookieMap(req.headers.cookie).ulash_session;
  if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  setCookie(res,'',0);return send(res,200,{ok:true});
 }
 if(req.method==='POST'&&p==='/api/listings'){
  const u=requireUser(req,['partner','donor']);
  rateLimit(req,'create-listing',20);
  const b=await readBody(req),id=createListing(b,u);
  const row=db.prepare("SELECT l.*,CASE WHEN u.role='donor' THEN 'Mahalladan oila' ELSE u.organization END AS partner_name,u.partner_verified,u.role AS partner_role FROM listings l JOIN users u ON u.id=l.partn" +
  'er_id WHERE l.id=?').get(id);
  return send(res,201,{listing:listingDto(row,null,null,true)});
 }
 if(req.method==='POST'&&p==='/api/reservations'){
  const b=await readBody(req),u=requireUser(req,['customer']);
  return send(res,201,{reservation:reserve(b,u)});
 }
 if(req.method==='POST'&&p==='/api/reports'){
  const b=await readBody(req),u=requireUser(req),listingId=integer(b.listingId,'E’lon',1,Number.MAX_SAFE_INTEGER);
  const reason=field(b.reason,'Sabab',80,3),details=String(b.details||'').trim().slice(0,500);
  if(!db.prepare('SELECT 1 FROM listings WHERE id=?').get(listingId))throw new HttpError(404,'E’lon topilmadi.');
  try{db.prepare('INSERT INTO listing_reports(listing_id,reporter_id,reason,details) VALUES(?,?,?,?)').run(listingId,Number(u.id),reason,details)}
  catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'Bu e’lon haqida avval xabar bergansiz.');throw e}
  for(const admin of db.prepare("SELECT id FROM users WHERE role='admin'").all())
   db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(Number(admin.id),'Yangi e’lon shikoyati','E’lon #'+listingId+': '+reason);
  return send(res,201,{ok:true});
 }
 let m=p.match(/^\/api\/reservations\/(\d+)\/review$/);
 if(req.method==='POST'&&m){
  const b=await readBody(req),u=requireUser(req,['customer']),id=Number(m[1]);
  const rating=integer(b.rating,'Baho',1,5),comment=String(b.comment||'').trim().slice(0,500);
  const reservation=db.prepare('SELECT r.status,r.customer_id,l.partner_id FROM reservations r JOIN listings l ON l.id=r.listing_id WHERE r.id=?').get(id);
  if(!reservation||Number(reservation.customer_id)!==Number(u.id))throw new HttpError(404,'Band topilmadi.');
  if(reservation.status!=='collected')throw new HttpError(409,'Faqat olib ketilgan e’longa baho berish mumkin.');
  try{db.prepare('INSERT INTO reviews(reservation_id,customer_id,partner_id,rating,comment) VALUES(?,?,?,?,?)').run(id,Number(u.id),Number(reservation.partner_id),rating,comment)}
  catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'Bu bandga baho berib bo‘lgansiz.');throw e}
  return send(res,201,{ok:true});
 }
 if(req.method==='POST'&&p==='/api/rewards'){
  const b=await readBody(req),u=requireUser(req,['partner']);
  if(!u.partner_verified)throw new HttpError(403,'Mukofot joylash uchun avval hamkor tekshiruvidan o‘ting.');
  const title=field(b.title,'Mukofot nomi',90,3),description=field(b.description,'Shartlari',300,5);
  const points=integer(b.pointsCost,'Karma balli',10,100000),stock=integer(b.stock,'Miqdori',1,10000);
  const id=Number(db.prepare('INSERT INTO partner_rewards(partner_id,title,description,points_cost,stock) VALUES(?,?,?,?,?)').run(Number(u.id),title,description,points,stock).lastInsertRowid);
  return send(res,201,{id});
 }
 m=p.match(/^\/api\/rewards\/(\d+)\/redeem$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['volunteer']),id=Number(m[1]);let result;
  transaction(()=>{
   const reward=db.prepare('SELECT * FROM partner_rewards WHERE id=? AND active=1 AND stock>0').get(id);
   if(!reward)throw new HttpError(404,'Mukofot endi mavjud emas.');
   const balance=Number(db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM karma_ledger WHERE volunteer_id=?').get(Number(u.id)).points);
   if(balance<Number(reward.points_cost))throw new HttpError(409,'Karma ballingiz yetarli emas.');
   db.prepare('UPDATE partner_rewards SET stock=stock-1 WHERE id=? AND stock>0').run(id);
   const code='KAR-'+randomBytes(4).toString('hex').toUpperCase();
   const claimId=Number(db.prepare('INSERT INTO reward_claims(reward_id,volunteer_id,code) VALUES(?,?,?)').run(id,Number(u.id),code).lastInsertRowid);
   db.prepare('INSERT INTO karma_ledger(volunteer_id,points,reason,claim_id) VALUES(?,?,?,?)').run(Number(u.id),-Number(reward.points_cost),'Mukofot: '+reward.title,claimId);
   db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(Number(reward.partner_id),'Mukofot so‘rovi',u.name+' mukofotingizni band qildi. Kod: '+code);
   result={claimId,code,title:reward.title,points:Number(reward.points_cost)};
  });return send(res,201,{claim:result});
 }
 m=p.match(/^\/api\/reward-claims\/(\d+)\/complete$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['partner']),id=Number(m[1]);
  const claim=db.prepare('SELECT c.volunteer_id,c.status,r.partner_id,r.title FROM reward_claims c JOIN partner_rewards r ON r.id=c.reward_id WHERE c.id=?').get(id);
  if(!claim||Number(claim.partner_id)!==Number(u.id))throw new HttpError(404,'Mukofot talabi topilmadi.');
  if(claim.status!=='pending')throw new HttpError(409,'Mukofot avval tasdiqlangan.');
  db.prepare("UPDATE reward_claims SET status='fulfilled',fulfilled_at=datetime('now') WHERE id=?").run(id);
  db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(Number(claim.volunteer_id),'Mukofot tasdiqlandi',claim.title+' mukofotini hamkor tasdiqladi.');
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/partners\/(\d+)\/verify$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const id=Number(m[1]),user=db.prepare("SELECT id FROM users WHERE id=? AND role='partner'").get(id);
  if(!user)throw new HttpError(404,'Hamkor topilmadi.');
  db.prepare('UPDATE users SET partner_verified=1 WHERE id=?').run(id);
  db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(id,'Hamkor tasdiqlandi','Tashkilotingiz admin tomonidan tekshirildi.');
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/partners\/(\d+)\/revoke$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const id=Number(m[1]),partner=db.prepare("SELECT id,partner_verified FROM users WHERE id=? AND role='partner'").get(id);
  if(!partner)throw new HttpError(404,'Hamkor topilmadi.');
  if(!Number(partner.partner_verified))throw new HttpError(409,'Hamkor avval tasdiqlanmagan.');
  db.prepare('UPDATE users SET partner_verified=0 WHERE id=?').run(id);
  db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(id,'Hamkorlik holati o‘zgardi','Hamkorlik tasdig‘i vaqtincha olib tashlandi. Admin bilan bog‘laning.');
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/users\/(\d+)\/toggle$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const id=Number(m[1]),member=db.prepare('SELECT id,role,account_status FROM users WHERE id=?').get(id);
  if(!member||member.role==='admin')throw new HttpError(404,'Boshqariladigan foydalanuvchi topilmadi.');
  const next=member.account_status==='suspended'?'active':'suspended';
  db.prepare('UPDATE users SET account_status=? WHERE id=?').run(next,id);
  if(next==='suspended')db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  db.prepare('INSERT INTO notifications(user_id,title,body) VALUES(?,?,?)').run(id,next==='suspended'?'Akkaunt vaqtincha to‘xtatildi':'Akkaunt qayta faollashtirildi',next==='suspended'?'Savol bo‘lsa admin bilan bog‘laning.':'Akkauntingizdan yana foydalanishingiz mumkin.');
  return send(res,200,{ok:true,status:next});
 }
 m=p.match(/^\/api\/admin\/reports\/(\d+)\/resolve$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const changed=db.prepare("UPDATE listing_reports SET status='resolved',resolved_at=datetime('now') WHERE id=? AND status='open'").run(Number(m[1]));
  if(!changed.changes)throw new HttpError(404,'Ochiq shikoyat topilmadi.');return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/listings\/(\d+)\/remove$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const changed=db.prepare("UPDATE listings SET status='removed' WHERE id=? AND status!='removed'").run(Number(m[1]));
  if(!changed.changes)throw new HttpError(404,'E’lon topilmadi.');return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/listings\/(\d+)\/pause$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const id=Number(m[1]),item=db.prepare('SELECT id,status,expires_at,pickup_end,portions_available FROM listings WHERE id=?').get(id);
  if(!item)throw new HttpError(404,'E’lon topilmadi.');
  if(item.status==='removed')throw new HttpError(409,'Olib tashlangan e’lonni avval tiklang.');
  if(item.status==='active')db.prepare("UPDATE listings SET status='paused' WHERE id=?").run(id);
  else{
   if(Number(item.portions_available)<1||new Date(item.expires_at)<=new Date()||new Date(item.pickup_end)<=new Date())throw new HttpError(409,'Muddati tugagan yoki qolmagan e’lonni yoqib bo‘lmaydi.');
   db.prepare("UPDATE listings SET status='active' WHERE id=?").run(id);
  }
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/admin\/listings\/(\d+)\/restore$/);
 if(req.method==='POST'&&m){
  requireUser(req,['admin']);const id=Number(m[1]),item=db.prepare('SELECT l.id,l.status,l.expires_at,l.pickup_end,l.portions_available,u.account_status,u.role,u.partner_verified FROM listings l JOIN users u ON u.id=l.partner_id WHERE l.id=?').get(id);
  if(!item||item.status!=='removed')throw new HttpError(404,'Tiklanadigan e’lon topilmadi.');
  if(item.account_status!=='active'||(item.role==='partner'&&!item.partner_verified))throw new HttpError(409,'Avval e’lon egasini faollashtirib, hamkorni tasdiqlang.');
  if(Number(item.portions_available)<1||new Date(item.expires_at)<=new Date()||new Date(item.pickup_end)<=new Date())throw new HttpError(409,'Muddati tugagan yoki qolmagan e’lonni tiklab bo‘lmaydi.');
  db.prepare("UPDATE listings SET status='active' WHERE id=?").run(id);
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/listings\/(\d+)\/pause$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['partner','donor']);
  const r=db.prepare("UPDATE listings SET status=CASE WHEN status='active' THEN 'paused' ELSE 'active' END W" +
  "HERE id=? AND partner_id=? AND expires_at>?")
   .run(Number(m[1]),Number(u.id),new Date().toISOString());
  if(!r.changes)throw new HttpError(404,'E’lon topilmadi yoki muddati tugagan.');
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/reservations\/(\d+)\/cancel$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['customer']),id=Number(m[1]);
  transaction(()=>{
   const r=db.prepare('SELECT r.listing_id,r.quantity,r.status,r.delivery_method,r.delivery_status,l.partner_id,l.title FROM reservations r JOIN listings l ON l.id=r.listing_id WHERE r.id=? AND r.customer_id=?').get(id,Number(u.id));
   if(!r)throw new HttpError(404,'Band topilmadi.');
   if(r.status!=='reserved')throw new HttpError(409,'Bandni bekor qilib bo‘lmaydi.');
   if(r.delivery_method==='volunteer'&&r.delivery_status!=='requested')throw new HttpError(409,'Ko‘ngilli topshiriqni olgan; bekor qilish uchun hamkor bilan bog‘laning.');
   db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(id);
   db.prepare('UPDATE listings SET portions_available=MIN(portions_total,portions_available+?) WHERE ' +
  'id=?').run(Number(r.quantity),Number(r.listing_id));
   db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)')
    .run(Number(r.partner_id),'Band bekor qilindi',u.name+' · '+r.title+' · '+Number(r.quantity)+' dona/porsiya',id);
  });
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/reservations\/(\d+)\/collect$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['partner','donor']),id=Number(m[1]);
  transaction(()=>{
   const r=db.prepare('SELECT r.status,r.delivery_method,r.delivery_status,r.customer_id,l.partner_id FROM re' +
  'servations r JOIN listings l ON l.id=r.listing_id WHERE r.id=?').get(id);
   if(!r||Number(r.partner_id)!==Number(u.id))throw new HttpError(404,'Band topilmadi.');
   if(r.status!=='reserved'||r.delivery_method==='volunteer'&&r.delivery_status!=='delivered')throw new HttpError(409,
  'Yetkazishni tugatgandan keyin tasdiqlang.');
   db.prepare("UPDATE reservations SET status='collected',collected_at=datetime('now') WHERE id=?").run(id);
   db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)').run(Number(r.customer_id),'Ulashuv topshirildi',
  'Band qilingan mahsulot topshirilgani tasdiqlandi.',id);
  });
  return send(res,200,{ok:true});
 }
 m=p.match(/^\/api\/volunteer\/tasks\/(\d+)\/(claim|complete)$/);
 if(req.method==='POST'&&m){
  const u=requireUser(req,['volunteer']),id=Number(m[1]);
  if(m[2]==='claim'){
   const r=db.prepare("UPDATE reservations SET volunteer_id=?,delivery_status='assigned' WHERE id=? AND statu" +
  "s='reserved' AND delivery_method='volunteer' AND delivery_status='requested'")
    .run(Number(u.id),id);
   if(!r.changes)throw new HttpError(409,'Topshiriqni boshqa ko‘ngilli oldi.');
   const row=db.prepare('SELECT customer_id,listing_id FROM reservations WHERE id=?').get(id);
   const partner=db.prepare('SELECT partner_id FROM listings WHERE id=?').get(Number(row.listing_id));
   db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)').run(Number(row.customer_id),'Ko‘ngilli topildi',
  u.name+' yetkazishni oldi.',id);
   db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)').run(Number(partner.partner_id),
  'Yetkazish biriktirildi',u.name+' topshiriqni oldi.',id);
   return send(res,200,{ok:true});
  }
  transaction(()=>{
   const row=db.prepare("SELECT customer_id FROM reservations WHERE id=? AND volunteer_id=? AND status='reserve" +
  "d' AND delivery_status='assigned'").get(id,Number(u.id));
   if(!row)throw new HttpError(404,'Faol topshiriq topilmadi.');
   db.prepare("UPDATE reservations SET delivery_status='delivered' WHERE id=?").run(id);
   db.prepare('INSERT OR IGNORE INTO karma_ledger(volunteer_id,points,reason,reservation_id) VALUES(?,?,?,?)')
    .run(Number(u.id),10,'Yetkazishni muvaffaqiyatli yakunladi',id);
   db.prepare('INSERT INTO notifications(user_id,title,body,reservation_id) VALUES(?,?,?,?)').run(Number(row.customer_id),'Yetkazish yakunlandi',
  u.name+' topshiriqni yakunladi.',id);
  });
  return send(res,200,{ok:true});
 }
 if(req.method==='POST'&&p==='/api/notifications/read'){
  const u=requireUser(req);
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(Number(u.id));
  return send(res,200,{ok:true});
 }
 return false;
}
async function main(req,res){
 try{
  const url=new URL(req.url||'/','http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(req.method==='GET'){const out=getRoute(req,res,url);if(out!==false)return}
   if(req.method==='POST'){const out=await writeRoute(req,res,url);if(out!==false)return}
   throw new HttpError(404,'API manzili topilmadi.');
  }
  if(url.pathname.startsWith('/uploads/')){
   const name=decodeURIComponent(url.pathname.slice('/uploads/'.length));
   if(!/^[a-f0-9]{36}\.(?:jpg|png|webp)$/.test(name))throw new HttpError(404,'Rasm topilmadi.');
   const file=resolve(UPLOAD_DIR,name);
   if(!file.startsWith(UPLOAD_DIR+sep)||!existsSync(file)||!statSync(file).isFile())throw new HttpError(404,'Rasm topilmadi.');
   const data=readFileSync(file);
   res.writeHead(200,{'content-type':MIME[extname(file)],'content-length':data.length,'cache-control':'public, max-age=604800, immutable',...security()});
   res.end(data);return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD')throw new HttpError(405,'So‘rov turi qo‘llanmaydi.');
  const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  if(!PUBLIC.has(name))throw new HttpError(404,'Sahifa topilmadi.');
  const file=resolve(ROOT,name);
  if(!file.startsWith(ROOT+sep)||!statSync(file).isFile())throw new HttpError(404,'Sahifa topilmadi.');
  const data=readFileSync(file);
  res.writeHead(200,{'content-type':MIME[extname(file)]||'application/octet-stream','content-length':data.length,'cache-control':'no-cache',
  ...security()});
  res.end(req.method==='HEAD'?undefined:data);
 }catch(error){
  const status=error instanceof HttpError?error.status:500;
  if(status===500)console.error(error);
  if(!res.headersSent)send(res,status,{error:status===500?'Serverda ichki xatolik.':error.message});
  else res.destroy();
 }
}
const server=createServer((req,res)=>{void main(req,res)});
server.listen(PORT,HOST,()=>console.log('Ulash serveri: http://localhost:'+PORT));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0)}));

