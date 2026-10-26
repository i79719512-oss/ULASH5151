import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

test('Legacy SQLite data survives additive Ulash migrations', async () => {
  const tempDir=await mkdtemp(join(tmpdir(),'ulash-migration-'));
  const dbPath=join(tempDir,'ulash.sqlite');
  const legacy=new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE users(
      id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,role TEXT NOT NULL,
      organization TEXT,area TEXT,transport TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now'))
    );
    CREATE TABLE listings(
      id INTEGER PRIMARY KEY,partner_id INTEGER REFERENCES users(id),title TEXT NOT NULL,
      description TEXT NOT NULL,category TEXT NOT NULL,deal_type TEXT NOT NULL,price INTEGER NOT NULL,
      original_price INTEGER NOT NULL DEFAULT 0,portions_total INTEGER NOT NULL,portions_available INTEGER NOT NULL,
      pickup_start TEXT NOT NULL,pickup_end TEXT NOT NULL,expires_at TEXT NOT NULL,prepared_at TEXT NOT NULL,
      pickup_address TEXT NOT NULL,area TEXT NOT NULL,allergens TEXT NOT NULL,latitude REAL,longitude REAL,
      status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT(datetime('now'))
    );
  `);
  const partnerId=Number(legacy.prepare('INSERT INTO users(name,phone,password_hash,password_salt,role,organization,area) VALUES(?,?,?,?,?,?,?)')
    .run('Saqlangan hamkor','+998900000001','hash','salt','partner','Eski kafe','Toshkent').lastInsertRowid);
  const listingId=Number(legacy.prepare(`INSERT INTO listings(
    partner_id,title,description,category,deal_type,price,original_price,portions_total,portions_available,
    pickup_start,pickup_end,expires_at,prepared_at,pickup_address,area,allergens
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    partnerId,'Eski taom','Avvaldan mavjud e’lon.','meal','free',0,0,2,2,
    '2030-01-01T10:00:00.000Z','2030-01-01T11:00:00.000Z','2030-01-01T12:00:00.000Z',
    '2029-12-31T10:00:00.000Z','Eski manzil','Toshkent','Tarkib ko‘rsatilgan'
  ).lastInsertRowid);
  legacy.close();

  const portProbe=createServer();
  await new Promise(resolveListen=>portProbe.listen(0,'127.0.0.1',resolveListen));
  const port=portProbe.address().port;
  await new Promise(resolveClose=>portProbe.close(resolveClose));
  const server=spawn(process.execPath,['backend.js'],{
    cwd:resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ULASH_DB_PATH:dbPath,
      ULASH_UPLOAD_DIR:join(tempDir,'uploads'),ULASH_ADMIN_SETUP_KEY:'migration-test-key',NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe']
  });
  let output='';server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
  try{
    let ready=false;
    for(let attempt=0;attempt<60;attempt++){
      if(server.exitCode!==null)throw new Error('Migration server exited. '+output);
      try{const response=await fetch('http://127.0.0.1:'+port+'/api/health');if(response.ok){ready=true;break}}catch{}
      await delay(150);
    }
    assert.ok(ready,'Migration server did not start. '+output);
    const migrated=new DatabaseSync(dbPath,{readOnly:true});
    assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
    assert.equal(migrated.prepare('SELECT COUNT(*) AS n FROM listings').get().n,1);
    assert.equal(migrated.prepare('SELECT title FROM listings WHERE id=?').get(listingId).title,'Eski taom');
    assert.ok(migrated.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='partner_verified'));
    assert.ok(migrated.prepare('PRAGMA table_info(listings)').all().some(column=>column.name==='image_path'));
    migrated.close();
  }finally{
    server.kill();
    await Promise.race([new Promise(resolveExit=>server.once('exit',resolveExit)),delay(2000)]);
    await rm(tempDir,{recursive:true,force:true});
  }
});
