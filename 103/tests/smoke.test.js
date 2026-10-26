import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('Ulash end-to-end flow: clothes, moderation, delivery, karma, rewards and reviews', async t => {
  const tempDir=await mkdtemp(join(tmpdir(),'ulash-test-'));
  assert.ok(resolve(tempDir).startsWith(resolve(tmpdir())),'Test cleanup must stay inside the OS temp directory.');
  const reservation= createServer();
  await new Promise(resolveListen=>reservation.listen(0,'127.0.0.1',resolveListen));
  const port=reservation.address().port;
  await new Promise(resolveClose=>reservation.close(resolveClose));
  const adminKey='test-'+crypto.randomUUID();
  const server=spawn(process.execPath,['backend.js'],{
    cwd:resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',
      ULASH_DB_PATH:join(tempDir,'ulash.sqlite'),ULASH_UPLOAD_DIR:join(tempDir,'uploads'),
      ULASH_ADMIN_SETUP_KEY:adminKey,NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe']
  });
  let serverOutput='';server.stdout.on('data',chunk=>serverOutput+=chunk);server.stderr.on('data',chunk=>serverOutput+=chunk);
  const base='http://127.0.0.1:'+port;
  const sessions={admin:{},partner:{},donor:{},customer:{},volunteer:{}};
  async function request(path,{session,method='GET',body,expected=200}={}){
    const response=await fetch(base+path,{method,headers:{...(session?.cookie?{cookie:session.cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const cookie=response.headers.getSetCookie?.()[0];if(cookie&&session)session.cookie=cookie.split(';')[0];
    const data=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
    assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(data)}\n${serverOutput}`);
    return{response,data};
  }
  try{
    let ready=false;
    for(let attempt=0;attempt<60;attempt++){
      if(server.exitCode!==null)throw new Error('Test server exited early. '+serverOutput);
      try{const response=await fetch(base+'/api/health');if(response.ok){ready=true;break}}catch{}
      await delay(150);
    }
    assert.ok(ready,'Backend did not start. '+serverOutput);
    const health=await request('/api/health');assert.equal(health.response.headers.get('x-frame-options'),'DENY');
    const css=await fetch(base+'/app.css');assert.equal(css.status,200);assert.ok(Number(css.headers.get('content-length'))>1000,'Restored stylesheet should be served.');
    const premiumCss=await fetch(base+'/simple.css');assert.equal(premiumCss.status,200,'Admin and premium styles should be served.');
    const head=await fetch(base+'/app.css',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');

    const admin=(await request('/api/admin/setup',{session:sessions.admin,method:'POST',expected:201,body:{
      setupKey:adminKey,name:'Test Admin',phone:'+998900000001',password:'TestAdminPassword123'
    }})).data.user;
    assert.equal(admin.role,'admin');
    await request('/api/admin/setup',{method:'POST',expected:409,body:{setupKey:adminKey,name:'Again',phone:'+998900000099',password:'TestAdminPassword123'}});

    const partner=(await request('/api/auth/register',{session:sessions.partner,method:'POST',expected:400,body:{
      name:'Test Partner',phone:'+998900000002',password:'TestPartnerPassword123',role:'partner',organization:'Test Kafe',area:'Toshkent',partnerTermsAccepted:false
    }})).data;
    assert.ok(partner.error);
    const partnerData=(await request('/api/auth/register',{session:sessions.partner,method:'POST',expected:201,body:{
      name:'Test Partner',phone:'+998900000002',password:'TestPartnerPassword123',role:'partner',organization:'Test Kafe',area:'Toshkent',partnerTermsAccepted:true
    }})).data.user;
    await request('/api/admin/overview',{session:sessions.partner,expected:403});
    await request('/api/rewards',{session:sessions.partner,method:'POST',expected:403,body:{title:'Premature reward',description:'Not verified yet.',pointsCost:10,stock:1}});

    const now=Date.now(),iso=ms=>new Date(ms).toISOString();
    const clothing=(await request('/api/listings',{session:sessions.partner,method:'POST',expected:201,body:{
      title:'Bolalar kurtkasi',description:'Yaxshi holatdagi kurtka.',category:'clothing',portions:1,
      pickupStart:iso(now+3600000),pickupEnd:iso(now+3*86400000),expiresAt:iso(now+3*86400000+3600000),
      preparedAt:iso(now),pickupAddress:'Toshkent, sinov manzili',area:'Toshkent',latitude:41.3,longitude:69.2,clothingSize:'110',
      clothingCondition:'good',ageGroup:'child',weightGrams:450,
      imageData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p3sAAAAASUVORK5CYII='
    }})).data.listing;
    assert.equal(clothing.category,'clothing');assert.equal(clothing.partnerVerified,false);
    assert.equal((await request('/api/listings?category=clothing')).data.listings.length,0,'Unverified partners must not appear publicly.');
    await request('/api/admin/partners/'+partnerData.id+'/verify',{session:sessions.admin,method:'POST',body:{}});
    const clothes=(await request('/api/listings?category=clothing')).data.listings;
    assert.equal(clothes.length,1);assert.equal(clothes[0].clothingSize,'110');assert.equal(clothes[0].partnerVerified,true);
    assert.equal(clothes[0].pickupAddress,'Band qilingach aniq manzil ochiladi.');assert.equal(clothes[0].latitude,null,'Private pickup coordinates must not be public.');
    const image=await fetch(base+clothes[0].imageUrl);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);

    await request('/api/auth/register',{session:sessions.donor,method:'POST',expected:400,body:{
      name:'Family Donor',phone:'+998900000005',password:'TestFamilyPassword123',role:'donor',area:'Chilonzor',donorTermsAccepted:false
    }});
    const donor=(await request('/api/auth/register',{session:sessions.donor,method:'POST',expected:201,body:{
      name:'Family Donor',phone:'+998900000005',password:'TestFamilyPassword123',role:'donor',area:'Chilonzor',donorTermsAccepted:true
    }})).data.user;
    assert.equal(donor.role,'donor');assert.equal(donor.organization,null);
    await request('/api/listings',{session:sessions.donor,method:'POST',expected:403,body:{title:'Taom emas',description:'Oilaviy akkaunt faqat kiyim uchun.',category:'meal'}});
    const familyClothing=(await request('/api/listings',{session:sessions.donor,method:'POST',expected:201,body:{
      title:'Qizaloq ko‘ylagi',description:'Toza va yaxshi holatdagi ko‘ylak.',category:'clothing',portions:2,
      pickupStart:iso(now+3600000),pickupEnd:iso(now+2*86400000),expiresAt:iso(now+2*86400000+3600000),preparedAt:iso(now),
      pickupAddress:'Chilonzor, xonadon manzili',area:'Chilonzor',clothingSize:'104',clothingCondition:'good',ageGroup:'child'
    }})).data.listing;
    assert.equal(familyClothing.partnerName,'Mahalladan oila');assert.equal(familyClothing.isCommunityDonor,true);
    const donorDashboard=(await request('/api/donor/dashboard',{session:sessions.donor})).data;
    assert.equal(donorDashboard.listings.length,1);
    const publicFamilyClothing=(await request('/api/listings?q=Qizaloq')).data.listings[0];
    assert.equal(publicFamilyClothing.pickupAddress,'Band qilingach aniq manzil ochiladi.');
    assert.equal(publicFamilyClothing.partnerName,'Mahalladan oila');

    const customerData=(await request('/api/auth/register',{session:sessions.customer,method:'POST',expected:201,body:{name:'Test Customer',phone:'+998900000003',password:'TestCustomerPassword123',role:'customer'}})).data.user;
    const familyReservation=(await request('/api/reservations',{session:sessions.customer,method:'POST',expected:201,body:{
      listingId:familyClothing.id,quantity:1,deliveryMethod:'pickup'
    }})).data.reservation;
    await request('/api/reservations/'+familyReservation.id+'/collect',{session:sessions.donor,method:'POST',body:{}});
    const donorAfterHandoff=(await request('/api/donor/dashboard',{session:sessions.donor})).data;
    assert.equal(donorAfterHandoff.reservations[0].status,'collected');
    await request('/api/auth/register',{session:sessions.volunteer,method:'POST',expected:201,body:{name:'Test Volunteer',phone:'+998900000004',password:'TestVolunteerPassword123',role:'volunteer',area:'Toshkent',transport:'Velosiped'}});
    const staleMeal=await request('/api/listings',{session:sessions.partner,method:'POST',expected:400,body:{
      title:'Eski tayyorlangan taom',description:'Bu taom bugun tayyorlanmagan.',category:'meal',dealType:'free',price:0,
      portions:1,pickupStart:iso(now+3600000),pickupEnd:iso(now+7200000),expiresAt:iso(now+10800000),preparedAt:iso(now-36*3600000),
      pickupAddress:'Toshkent, sinov manzili',area:'Toshkent',allergens:'Ma’lumot',safetyConfirmed:true
    }});
    assert.match(staleMeal.data.error,/shu kuni/);
    const reservation=(await request('/api/reservations',{session:sessions.customer,method:'POST',expected:201,body:{
      listingId:clothing.id,quantity:1,deliveryMethod:'volunteer',deliveryAddress:'Toshkent, mijoz manzili'
    }})).data.reservation;
    await request('/api/reservations',{session:sessions.customer,method:'POST',expected:409,body:{listingId:clothing.id,quantity:1}});
    assert.ok((await request('/api/my/reservations',{session:sessions.customer})).data.reservations.some(row=>row.pickup_address==='Toshkent, sinov manzili'));
    const tasks=(await request('/api/volunteer/tasks',{session:sessions.volunteer})).data;
    assert.equal(tasks.tasks.length,1);assert.equal(tasks.karmaPoints,0);assert.equal(tasks.tasks[0].pickup_address,null);
    await request('/api/volunteer/tasks/'+reservation.id+'/claim',{session:sessions.volunteer,method:'POST',body:{}});
    await request('/api/reservations/'+reservation.id+'/cancel',{session:sessions.customer,method:'POST',expected:409,body:{}});
    const claimedTasks=(await request('/api/volunteer/tasks',{session:sessions.volunteer})).data.tasks;
    assert.equal(claimedTasks[0].pickup_address,'Toshkent, sinov manzili');
    await request('/api/volunteer/tasks/'+reservation.id+'/complete',{session:sessions.volunteer,method:'POST',body:{}});
    assert.equal((await request('/api/volunteer/tasks',{session:sessions.volunteer})).data.karmaPoints,10);

    const reward=(await request('/api/rewards',{session:sessions.partner,method:'POST',expected:201,body:{title:'Bepul choy',description:'Kassada kodni ko‘rsating.',pointsCost:10,stock:1}})).data;
    const claim=(await request('/api/rewards/'+reward.id+'/redeem',{session:sessions.volunteer,method:'POST',expected:201,body:{}})).data.claim;
    assert.match(claim.code,/^KAR-/);
    await request('/api/reward-claims/'+claim.claimId+'/complete',{session:sessions.partner,method:'POST',body:{}});
    assert.equal((await request('/api/volunteer/tasks',{session:sessions.volunteer})).data.karmaPoints,0);

    await request('/api/reservations/'+reservation.id+'/collect',{session:sessions.partner,method:'POST',body:{}});
    await request('/api/reservations/'+reservation.id+'/review',{session:sessions.customer,method:'POST',expected:201,body:{rating:5,comment:'Juda yaxshi.'}});
    const top=(await request('/api/partners/top')).data.partners;
    assert.equal(top[0].rating,5);assert.equal(top[0].rescued,1);
    await request('/api/reports',{session:sessions.customer,method:'POST',expected:201,body:{listingId:clothing.id,reason:'Sinov xabari',details:'Test tafsiloti'}});
    const overview=(await request('/api/admin/overview',{session:sessions.admin})).data;
    assert.equal(overview.reports.length,1);assert.equal(overview.pendingPartners.length,0);
    assert.equal(overview.listings.length,2);assert.equal(overview.members.length,4);assert.equal(overview.reservations.length,2);
    assert.equal(overview.counts.openReports,1);assert.equal(overview.counts.collected,2);
    const visibleFamily=(await request('/api/listings?q=Qizaloq')).data.listings;
    assert.equal(visibleFamily.length,1);
    await request('/api/admin/listings/'+familyClothing.id+'/remove',{session:sessions.admin,method:'POST',body:{}});
    assert.equal((await request('/api/listings?q=Qizaloq')).data.listings.length,0);
    await request('/api/admin/listings/'+familyClothing.id+'/restore',{session:sessions.admin,method:'POST',body:{}});
    assert.equal((await request('/api/listings?q=Qizaloq')).data.listings.length,1);
    await request('/api/admin/listings/'+familyClothing.id+'/pause',{session:sessions.admin,method:'POST',body:{}});
    assert.equal((await request('/api/listings?q=Qizaloq')).data.listings.length,0);
    await request('/api/admin/listings/'+familyClothing.id+'/pause',{session:sessions.admin,method:'POST',body:{}});
    assert.equal((await request('/api/listings?q=Qizaloq')).data.listings.length,1);
    await request('/api/admin/partners/'+partnerData.id+'/revoke',{session:sessions.admin,method:'POST',body:{}});
    assert.equal((await request('/api/partners/top')).data.partners.length,0);
    await request('/api/admin/partners/'+partnerData.id+'/verify',{session:sessions.admin,method:'POST',body:{}});
    await request('/api/admin/users/'+customerData.id+'/toggle',{session:sessions.admin,method:'POST',body:{}});
    await request('/api/notifications',{session:sessions.customer,expected:401});
    await request('/api/auth/login',{session:sessions.customer,method:'POST',expected:403,body:{phone:'+998900000003',password:'TestCustomerPassword123'}});
    await request('/api/admin/users/'+customerData.id+'/toggle',{session:sessions.admin,method:'POST',body:{}});
    const restoredCustomer=(await request('/api/auth/login',{session:sessions.customer,method:'POST',body:{phone:'+998900000003',password:'TestCustomerPassword123'}})).data.user;
    assert.equal(restoredCustomer.role,'customer');
    const impact=(await request('/api/impact')).data;
    assert.equal(impact.rescuedPortions,2);assert.equal(impact.rescuedGrams,450);
  }finally{
    server.kill();
    await Promise.race([new Promise(resolveExit=>server.once('exit',resolveExit)),delay(2000)]);
    await rm(tempDir,{recursive:true,force:true});
  }
});
