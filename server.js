'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.CNBRAFA_DB || path.join(DATA_DIR, 'cnbrafa.sqlite');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.CNBRAFA_ADMIN_PASSWORD || 'cnbrafa-admin';
const SESSION_TTL = 12 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '🎮',
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  voter_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  url TEXT NOT NULL,
  context TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  eyebrow TEXT NOT NULL DEFAULT 'SESSÃO',
  day_label TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  time_label TEXT NOT NULL DEFAULT 'TBD',
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'HUB',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_votes_game ON votes(game_id);
CREATE INDEX IF NOT EXISTS idx_reactions_status ON reactions(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
`);

const DEFAULT_LIVE = {
  mode: 'manual',
  isLive: false,
  game: 'Próximo jogo em votação',
  title: 'Central preparada para a próxima transmissão.',
  viewers: null,
  mission: 'Ativar a comunidade',
  goalCurrent: 0,
  goalTarget: 100,
  challenge: 'Desafio coletivo: usar votos, reacts e recompensas para movimentar a live.',
  communityEnergy: 0,
  communityLevel: 1,
  updatedAt: Date.now()
};

const SEED_GAMES = [
  ['resident-evil','Resident Evil','🧟','Saga, sobrevivência, puzzles e caos biológico.'],
  ['counter-strike-2','Counter-Strike 2','🎯','Competitivo, clutch e partidas com a comunidade.'],
  ['valorant','Valorant','⚡','Agentes, estratégia e rounds decisivos.'],
  ['league-of-legends','League of Legends','🌀','MOBA, calls, rank e resenha.'],
  ['dead-by-daylight','Dead by Daylight','🪝','Perseguição, sustos e escolhas sob pressão.'],
  ['phasmophobia','Phasmophobia','👻','Investigação paranormal e tensão crescente.'],
  ['backrooms','Backrooms','🚪','Coop, labirintos e terror estranho.'],
  ['elden-ring','Elden Ring','⚔️','Bosses, builds e evolução de gameplay.']
];

const SEED_SCHEDULE = [
  ['next-live','PRÓXIMA','LIVE','Próxima transmissão','O horário oficial aparece aqui assim que o criador atualizar o painel.','--:--'],
  ['terror','SESSÃO','TERROR','Noites de tensão','Resident Evil, Phasmophobia, Backrooms, DbD e outros.','TBD'],
  ['fps','SESSÃO','FPS','Clutch & comunidade','CS2, Valorant e partidas com participação do chat.','TBD'],
  ['react','SESSÃO','REACT','React & resenha','Vídeos enviados e conteúdos selecionados para a live.','TBD']
];

function now(){ return Date.now(); }
function json(value){ return JSON.stringify(value); }
function readSetting(key, fallback){
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if(!row) return structuredClone(fallback);
  try { return { ...structuredClone(fallback), ...JSON.parse(row.value) }; }
  catch { return structuredClone(fallback); }
}
function writeSetting(key, value){
  db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .run(key, json(value), now());
}

if(!db.prepare('SELECT 1 FROM settings WHERE key=?').get('live_state')) writeSetting('live_state', DEFAULT_LIVE);
const gameCount = db.prepare('SELECT COUNT(*) AS c FROM games').get().c;
if(!gameCount){
  const ins = db.prepare('INSERT INTO games(id,name,icon,description,active,position,created_at) VALUES(?,?,?,?,1,?,?)');
  SEED_GAMES.forEach((g,i)=>ins.run(g[0],g[1],g[2],g[3],i,now()));
}
const scheduleCount = db.prepare('SELECT COUNT(*) AS c FROM schedule').get().c;
if(!scheduleCount){
  const ins = db.prepare('INSERT INTO schedule(id,eyebrow,day_label,title,description,time_label,position,active,updated_at) VALUES(?,?,?,?,?,?,?,1,?)');
  SEED_SCHEDULE.forEach((s,i)=>ins.run(s[0],s[1],s[2],s[3],s[4],s[5],i,now()));
}

function getPublicState(){
  const live = readSetting('live_state', DEFAULT_LIVE);
  const games = db.prepare(`SELECT g.id,g.name,g.icon,g.description,g.active,g.position,COUNT(v.voter_id) AS votes
    FROM games g LEFT JOIN votes v ON v.game_id=g.id
    WHERE g.active=1 GROUP BY g.id ORDER BY g.position ASC,g.name ASC`).all().map(r=>({...r,active:!!r.active,votes:Number(r.votes)}));
  const queueCount = Number(db.prepare("SELECT COUNT(*) AS c FROM reactions WHERE status IN ('pending','approved')").get().c);
  const pendingCount = Number(db.prepare("SELECT COUNT(*) AS c FROM reactions WHERE status='pending'").get().c);
  const approvedReaction = db.prepare(`SELECT id,nickname,url,context,priority,created_at AS createdAt
    FROM reactions WHERE status='approved'
    ORDER BY priority DESC, created_at ASC LIMIT 1`).get();
  const schedule = db.prepare('SELECT id,eyebrow,day_label AS dayLabel,title,description,time_label AS timeLabel,position,active FROM schedule WHERE active=1 ORDER BY position ASC').all().map(r=>({...r,active:!!r.active}));
  const activities = db.prepare('SELECT id,type,title,meta,source,created_at AS createdAt FROM activities ORDER BY id DESC LIMIT 20').all();
  return {
    live,
    games,
    reactions:{
      queueCount,
      pendingCount,
      active: approvedReaction ? {...approvedReaction,priority:!!approvedReaction.priority} : null
    },
    schedule,
    activities,
    serverTime: now()
  };
}

function addActivity(type,title,meta='',source='HUB'){
  db.prepare('INSERT INTO activities(type,title,meta,source,created_at) VALUES(?,?,?,?,?)').run(type,title,meta,source,now());
  db.exec('DELETE FROM activities WHERE id NOT IN (SELECT id FROM activities ORDER BY id DESC LIMIT 100)');
}
function addEnergy(amount){
  const live = readSetting('live_state', DEFAULT_LIVE);
  let energy = Math.max(0, Number(live.communityEnergy)||0) + Math.max(0, Number(amount)||0);
  let level = Math.max(1, Number(live.communityLevel)||1);
  while(energy >= 100){ energy -= 100; level += 1; }
  live.communityEnergy = energy;
  live.communityLevel = level;
  live.updatedAt = now();
  writeSetting('live_state', live);
  return live;
}

const sessions = new Map();
function createSession(){
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token,{expires:now()+SESSION_TTL});
  return token;
}
function cleanupSessions(){ for(const [k,v] of sessions) if(v.expires < now()) sessions.delete(k); }
setInterval(cleanupSessions, 15*60*1000).unref();
function getBearer(req){ const h=req.headers.authorization||''; return h.startsWith('Bearer ')?h.slice(7):''; }
function isAdmin(req){ const token=getBearer(req), s=sessions.get(token); if(!s||s.expires<now()) return false; s.expires=now()+SESSION_TTL; return true; }
function safePasswordEqual(input){
  const a=Buffer.from(String(input||'')), b=Buffer.from(String(ADMIN_PASSWORD));
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

const sseClients = new Set();
function sendSse(res, event, payload){
  try{ res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); }catch{}
}
function broadcastState(){
  const state=getPublicState();
  for(const res of sseClients) sendSse(res,'state',state);
}
setInterval(()=>{ for(const res of sseClients){ try{res.write(': ping\n\n')}catch{} } },20000).unref();

function sendJson(res,status,payload,headers={}){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(JSON.stringify(payload));
}
function sendError(res,status,message){ sendJson(res,status,{error:message}); }
async function readBody(req){
  return await new Promise((resolve,reject)=>{
    let data='';
    req.on('data',chunk=>{ data+=chunk; if(data.length>65536){ reject(new Error('payload_too_large')); req.destroy(); } });
    req.on('end',()=>{ if(!data) return resolve({}); try{ resolve(JSON.parse(data)); }catch{ reject(new Error('invalid_json')); } });
    req.on('error',reject);
  });
}
function cleanText(v,max){ return String(v??'').trim().slice(0,max); }
function validVoterId(v){ return /^[A-Za-z0-9_-]{8,96}$/.test(String(v||'')); }

async function handleApi(req,res,url){
  if(req.method==='GET' && url.pathname==='/api/health') return sendJson(res,200,{ok:true,version:5,time:now()});
  if(req.method==='GET' && url.pathname==='/api/state') return sendJson(res,200,getPublicState());
  if(req.method==='GET' && url.pathname==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2500\n\n');
    sseClients.add(res); sendSse(res,'state',getPublicState());
    req.on('close',()=>sseClients.delete(res));
    return;
  }

  if(req.method==='GET' && url.pathname==='/api/votes'){
    const voterId=cleanText(url.searchParams.get('voterId'),96);
    if(!validVoterId(voterId)) return sendError(res,400,'Identificador de voto inválido.');
    const row=db.prepare('SELECT game_id AS gameId FROM votes WHERE voter_id=?').get(voterId);
    return sendJson(res,200,{gameId:row?.gameId||null});
  }

  if(req.method==='POST' && url.pathname==='/api/votes'){
    const b=await readBody(req);
    const voterId=cleanText(b.voterId,96), gameId=cleanText(b.gameId,80);
    if(!validVoterId(voterId)) return sendError(res,400,'Identificador de voto inválido.');
    const game=db.prepare('SELECT id,name FROM games WHERE id=? AND active=1').get(gameId);
    if(!game) return sendError(res,404,'Jogo não encontrado.');
    const old=db.prepare('SELECT game_id FROM votes WHERE voter_id=?').get(voterId);
    const changed=!old || old.game_id!==gameId;
    db.prepare(`INSERT INTO votes(voter_id,game_id,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(voter_id) DO UPDATE SET game_id=excluded.game_id,updated_at=excluded.updated_at`).run(voterId,gameId,now(),now());
    if(changed){ addEnergy(4); addActivity('vote','Voto registrado',game.name,'COMUNIDADE'); broadcastState(); }
    return sendJson(res,200,{ok:true,gameId,state:getPublicState()});
  }
  if(req.method==='DELETE' && url.pathname==='/api/votes'){
    const voterId=cleanText(url.searchParams.get('voterId'),96);
    if(!validVoterId(voterId)) return sendError(res,400,'Identificador de voto inválido.');
    db.prepare('DELETE FROM votes WHERE voter_id=?').run(voterId); broadcastState();
    return sendJson(res,200,{ok:true,state:getPublicState()});
  }

  if(req.method==='POST' && url.pathname==='/api/reactions'){
    const b=await readBody(req);
    const nickname=cleanText(b.nickname,40), link=cleanText(b.url,500), context=cleanText(b.context,280);
    if(nickname.length<2 || !context) return sendError(res,400,'Preencha nick e contexto.');
    let parsed; try{ parsed=new URL(link); }catch{ return sendError(res,400,'Link inválido.'); }
    if(!['http:','https:'].includes(parsed.protocol)) return sendError(res,400,'Use um link http(s).');
    const ts=now();
    const info=db.prepare('INSERT INTO reactions(nickname,url,context,status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(nickname,link,context,'pending',0,ts,ts);
    addEnergy(8); addActivity('react','Novo link para react',nickname,'COMUNIDADE'); broadcastState();
    const position=Number(db.prepare("SELECT COUNT(*) AS c FROM reactions WHERE status='pending'").get().c);
    return sendJson(res,201,{ok:true,id:Number(info.lastInsertRowid),position,status:'pending'});
  }

  if(req.method==='POST' && url.pathname==='/api/admin/login'){
    const b=await readBody(req);
    if(!safePasswordEqual(b.password)) return sendError(res,401,'Senha inválida.');
    const token=createSession();
    return sendJson(res,200,{ok:true,token,expiresIn:SESSION_TTL});
  }

  if(url.pathname.startsWith('/api/admin/')){
    if(!isAdmin(req)) return sendError(res,401,'Sessão administrativa ausente ou expirada.');

    if(req.method==='GET' && url.pathname==='/api/admin/overview'){
      const reactions=db.prepare('SELECT id,nickname,url,context,status,priority,created_at AS createdAt,updated_at AS updatedAt FROM reactions ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'approved\' THEN 1 WHEN \'done\' THEN 2 ELSE 3 END, priority DESC, created_at ASC LIMIT 100').all().map(r=>({...r,priority:!!r.priority}));
      const allSchedule=db.prepare('SELECT id,eyebrow,day_label AS dayLabel,title,description,time_label AS timeLabel,position,active FROM schedule ORDER BY position ASC').all().map(r=>({...r,active:!!r.active}));
      const allGames=db.prepare(`SELECT g.id,g.name,g.icon,g.description,g.active,g.position,COUNT(v.voter_id) AS votes FROM games g LEFT JOIN votes v ON v.game_id=g.id GROUP BY g.id ORDER BY g.position ASC,g.name ASC`).all().map(r=>({...r,active:!!r.active,votes:Number(r.votes)}));
      return sendJson(res,200,{...getPublicState(),reactionsList:reactions,allSchedule,allGames});
    }

    if(req.method==='PATCH' && url.pathname==='/api/admin/live'){
      const b=await readBody(req); const live=readSetting('live_state',DEFAULT_LIVE);
      if('mode' in b) live.mode=['manual','auto'].includes(b.mode)?b.mode:live.mode;
      if('isLive' in b) live.isLive=!!b.isLive;
      if('game' in b) live.game=cleanText(b.game,60)||DEFAULT_LIVE.game;
      if('title' in b) live.title=cleanText(b.title,140)||DEFAULT_LIVE.title;
      if('viewers' in b) live.viewers=b.viewers==null?null:Math.max(0,Number(b.viewers)||0);
      if('mission' in b) live.mission=cleanText(b.mission,80)||DEFAULT_LIVE.mission;
      if('goalCurrent' in b) live.goalCurrent=Math.max(0,Number(b.goalCurrent)||0);
      if('goalTarget' in b) live.goalTarget=Math.max(1,Number(b.goalTarget)||100);
      if('challenge' in b) live.challenge=cleanText(b.challenge,180)||DEFAULT_LIVE.challenge;
      live.updatedAt=now(); writeSetting('live_state',live);
      addActivity('admin','Central atualizada','Painel do criador','ADMIN'); broadcastState();
      return sendJson(res,200,{ok:true,state:getPublicState()});
    }
    if(req.method==='POST' && url.pathname==='/api/admin/live/reset'){
      writeSetting('live_state',{...DEFAULT_LIVE,updatedAt:now()}); addActivity('admin','Central restaurada','Configuração padrão','ADMIN'); broadcastState();
      return sendJson(res,200,{ok:true,state:getPublicState()});
    }
    if(req.method==='POST' && url.pathname==='/api/admin/activity'){
      const b=await readBody(req); const title=cleanText(b.title,100), meta=cleanText(b.meta,120), source=cleanText(b.source,24)||'TWITCH';
      if(!title) return sendError(res,400,'Título obrigatório.');
      if(Number(b.energy)>0) addEnergy(Math.min(50,Number(b.energy)));
      addActivity('external',title,meta,source); broadcastState();
      return sendJson(res,201,{ok:true,state:getPublicState()});
    }

    const reactionMatch=url.pathname.match(/^\/api\/admin\/reactions\/(\d+)$/);
    if(reactionMatch && req.method==='PATCH'){
      const id=Number(reactionMatch[1]), b=await readBody(req);
      const row=db.prepare('SELECT id,nickname FROM reactions WHERE id=?').get(id); if(!row) return sendError(res,404,'React não encontrado.');
      const fields=[], vals=[];
      if('status' in b){ const status=String(b.status); if(!['pending','approved','rejected','done'].includes(status)) return sendError(res,400,'Status inválido.'); fields.push('status=?'); vals.push(status); }
      if('priority' in b){ fields.push('priority=?'); vals.push(b.priority?1:0); }
      if(!fields.length) return sendError(res,400,'Nada para atualizar.');
      fields.push('updated_at=?'); vals.push(now(),id);
      db.prepare(`UPDATE reactions SET ${fields.join(',')} WHERE id=?`).run(...vals);
      addActivity('moderation','Fila de reacts atualizada',row.nickname,'ADMIN'); broadcastState();
      return sendJson(res,200,{ok:true});
    }

    const scheduleMatch=url.pathname.match(/^\/api\/admin\/schedule\/([a-z0-9-]+)$/);
    if(scheduleMatch && req.method==='PATCH'){
      const id=scheduleMatch[1], b=await readBody(req), row=db.prepare('SELECT id FROM schedule WHERE id=?').get(id); if(!row) return sendError(res,404,'Bloco de cronograma não encontrado.');
      const eyebrow=cleanText(b.eyebrow,20)||'SESSÃO', dayLabel=cleanText(b.dayLabel,24)||'LIVE', title=cleanText(b.title,80)||'Sessão CNBRAFA', description=cleanText(b.description,180), timeLabel=cleanText(b.timeLabel,20)||'TBD';
      db.prepare('UPDATE schedule SET eyebrow=?,day_label=?,title=?,description=?,time_label=?,active=?,updated_at=? WHERE id=?').run(eyebrow,dayLabel,title,description,timeLabel,b.active===false?0:1,now(),id);
      addActivity('admin','Cronograma atualizado',title,'ADMIN'); broadcastState();
      return sendJson(res,200,{ok:true});
    }

    if(req.method==='POST' && url.pathname==='/api/admin/games'){
      const b=await readBody(req), name=cleanText(b.name,60), icon=cleanText(b.icon,8)||'🎮', description=cleanText(b.description,180);
      if(name.length<2) return sendError(res,400,'Nome do jogo inválido.');
      const id=(name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'game')+'-'+crypto.randomBytes(2).toString('hex');
      const pos=Number(db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM games').get().p);
      try{ db.prepare('INSERT INTO games(id,name,icon,description,active,position,created_at) VALUES(?,?,?,?,1,?,?)').run(id,name,icon,description,pos,now()); }
      catch{ return sendError(res,409,'Já existe um jogo com esse nome.'); }
      addActivity('admin','Jogo adicionado',name,'ADMIN'); broadcastState(); return sendJson(res,201,{ok:true,id});
    }
    const gameMatch=url.pathname.match(/^\/api\/admin\/games\/([a-z0-9-]+)$/);
    if(gameMatch && req.method==='PATCH'){
      const id=gameMatch[1], b=await readBody(req), row=db.prepare('SELECT * FROM games WHERE id=?').get(id); if(!row) return sendError(res,404,'Jogo não encontrado.');
      const name='name' in b?cleanText(b.name,60):row.name, icon='icon' in b?cleanText(b.icon,8):row.icon, description='description' in b?cleanText(b.description,180):row.description, active='active' in b?(b.active?1:0):row.active;
      db.prepare('UPDATE games SET name=?,icon=?,description=?,active=? WHERE id=?').run(name,icon,description,active,id);
      addActivity('admin','Jogo atualizado',name,'ADMIN'); broadcastState(); return sendJson(res,200,{ok:true});
    }
  }

  sendError(res,404,'Endpoint não encontrado.');
}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.ico':'image/x-icon'};
function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/') pathname='/index.html';
  if(pathname==='/obs' || pathname==='/obs/') pathname='/obs.html';
  if(/^\/overlay\/(mission|ranking|react|events|alert|live)\/?$/.test(pathname)) pathname='/overlay/index.html';
  const target=path.resolve(ROOT,'.'+pathname);
  if(!target.startsWith(ROOT+path.sep)) return sendError(res,403,'Acesso negado.');
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('404'); }
    const ext=path.extname(target).toLowerCase();
    const headers={'Content-Type':MIME[ext]||'application/octet-stream'};
    if(ext==='.html'||ext==='.js'||ext==='.css') headers['Cache-Control']='no-cache'; else headers['Cache-Control']='public, max-age=86400';
    res.writeHead(200,headers); fs.createReadStream(target).pipe(res);
  });
}

const server=http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  try{
    if(url.pathname.startsWith('/api/')) await handleApi(req,res,url);
    else serveStatic(req,res,url);
  }catch(err){
    console.error(err);
    if(!res.headersSent) sendError(res,err.message==='payload_too_large'?413:400,err.message==='invalid_json'?'JSON inválido.':'Não foi possível processar a solicitação.');
    else try{res.end()}catch{}
  }
});

server.listen(PORT,HOST,()=>{
  console.log(`\nCNBRAFA V5 rodando em http://localhost:${PORT}`);
  console.log(`Banco SQLite: ${DB_PATH}`);
  console.log(`Senha admin: ${process.env.CNBRAFA_ADMIN_PASSWORD?'definida pela variável CNBRAFA_ADMIN_PASSWORD':'cnbrafa-admin (troque antes de publicar)'}\n`);
});
