# Ulash: ishga tushirish va internetga joylash

## Kompyuterda ishga tushirish

Node.js 24 yoki undan yangirog‘i kerak. Loyiha papkasida:

```powershell
node backend.js
```

Sayt `http://localhost:4173` manzilida ochiladi. Sinovlar:

```powershell
node --test
```

Mahalliy ishga tushirishda birinchi administratorni yaratish uchun serverni quyidagi buyruqlar bilan boshlang. Kalitni nusxalab oling:

```powershell
$env:ULASH_ADMIN_SETUP_KEY = [guid]::NewGuid().ToString("N")
Write-Host "Admin kaliti: $env:ULASH_ADMIN_SETUP_KEY"
node backend.js
```

Yangi PowerShell oynasida nusxalangan kalit bilan admin yarating:

```powershell
$setupKey = Read-Host "Admin kaliti"
$body = @{
  setupKey = $setupKey
  name = "Sayt administratori"
  phone = "+998901234567"
  password = "Kamida12BelgilikKuchliParol"
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri "http://localhost:4173/api/admin/setup" `
  -Method Post -ContentType "application/json" -Body $body
```

Keyin saytda shu telefon va parol bilan kiring. Admin panelidan haqiqiy hamkorni tekshirib tasdiqlamaguncha uning e’lonlari boshqalarga ko‘rinmaydi.

## Railway’ga joylash

Loyiha Node serveri, SQLite bazasi va yuklangan rasmlardan foydalanadi; shuning uchun Netlify’ga oddiy statik sayt sifatida tashlash yetmaydi. Repository’ni GitHub’ga joylab, Railway’da shu repository’dan service yarating. Root’dagi `Dockerfile` avtomatik ishlatiladi.

1. Railway service’ga **Volume** ulang va mount path’ni `/data` qiling.
2. Service variables’ga quyidagilarni kiriting:

   ```text
   HOST=0.0.0.0
   ULASH_DB_PATH=/data/ulash.sqlite
   ULASH_UPLOAD_DIR=/data/uploads
   NODE_ENV=production
   ULASH_ADMIN_SETUP_KEY=<uzun, tasodifiy va maxfiy kalit>
   ```

3. Deploy qiling va Railway Networking sozlamasidan domain yarating.
4. Birinchi adminni faqat bir marta yarating. PowerShell’da:

   ```powershell
   $setupKey = Read-Host "Admin setup kaliti"
   $body = @{
     setupKey = $setupKey
     name = "Sayt administratori"
     phone = "+998901234567"
     password = "Kamida12BelgilikKuchliParol"
   } | ConvertTo-Json -Compress

   Invoke-RestMethod -Uri "https://SAYT-DOMENINGIZ/api/admin/setup" `
     -Method Post -ContentType "application/json" -Body $body
   ```

5. Admin yaratilib bo‘lgach, `ULASH_ADMIN_SETUP_KEY` variable’ni Railway’dan olib tashlang. Keyin saytning **Kirish** oynasidan admin sifatida kiring.
6. Admin panelida hamkorni faqat tashqaridan tekshirganingizdan so‘ng tasdiqlang. Tasdiqlanmagan hamkor e’lonlari ommaga ko‘rsatilmaydi.

Oilalar **Oilamizdan kiyim ulashish** tugmasidan alohida donor akkaunti ochadi: bu akkaunt faqat bepul kiyim e’lon qiladi, biznes tekshiruvini kutmaydi va kartochkada shaxsiy ism ko‘rsatmaydi. E’lon haqida shikoyat yuborish mumkin, ammo bu mustaqil tekshiruv o‘rnini bosmaydi. Aniq uy manzili ommaga berilmaydi; band tasdiqlangandan keyin xaridor va topshiriqni olgan ko‘ngilliga ochiladi.

`/data` volume SQLite bazasi va rasmlarni deploy/restart’lardan saqlaydi. Bu pilot hajmidagi, bitta serverli yechim; hajm oshsa SQLite o‘rniga managed PostgreSQL va alohida rasm storage’ga ko‘chirish kerak bo‘ladi. Railway Dockerfile’ni repository root’dan oladi va volume’dagi ma’lumotni mount path’da saqlaydi: [Dockerfile deploy qo‘llanmasi](https://docs.railway.com/builds/dockerfiles), [Railway Volumes](https://docs.railway.com/volumes).

## Hali tashqi xizmat talab qiladigan qismlar

- Sayt band qilishni qayd qiladi, lekin karta to‘lovini qabul qilmaydi. To‘lov provayderi va savdo akkaunti ulanmagan.
- Telefon SMS tasdig‘i, parolni SMS orqali tiklash, email va push xabarlari ulanmagan; buning uchun SMS/email provayderi akkaunti va maxfiy API kalitlari kerak.
- Xarita tugmasi koordinata mavjud bo‘lsa OpenStreetMap’ni ochadi; jonli kuryer kuzatuvi, yo‘nalish va ETA yo‘q.
- Taom xavfsizligi hamkorning qayd etilgan bayonotidir, mustaqil laboratoriya tekshiruvi yoki yuridik kafolat emas. Hamkorlik shartlari ham yurist ko‘rigidan o‘tishi kerak.
- Admin tekshiruvi hujjatlarni avtomatik tasdiqlamaydi; operator tashkilotni mustaqil tekshiradi.

Haqiqiy mijozlarning manzil/telefon ma’lumotlarini kiritishdan oldin maxfiylik siyosati, zaxira nusxa, kirish huquqlari va O‘zbekiston qonunchiligi bo‘yicha tekshiruvni yakunlang.
