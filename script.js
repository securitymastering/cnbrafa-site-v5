const fallbackGames = [
  {id:'resident-evil',name:'Resident Evil',icon:'🧟',description:'Saga, sobrevivência, puzzles e caos biológico.',votes:0},
  {id:'counter-strike-2',name:'Counter-Strike 2',icon:'🎯',description:'Competitivo, clutch e partidas com a comunidade.',votes:0},
  {id:'valorant',name:'Valorant',icon:'⚡',description:'Agentes, estratégia e rounds decisivos.',votes:0},
  {id:'league-of-legends',name:'League of Legends',icon:'🌀',description:'MOBA, calls, rank e resenha.',votes:0},
  {id:'dead-by-daylight',name:'Dead by Daylight',icon:'🪝',description:'Perseguição, sustos e escolhas sob pressão.',votes:0},
  {id:'phasmophobia',name:'Phasmophobia',icon:'👻',description:'Investigação paranormal e tensão crescente.',votes:0},
  {id:'backrooms',name:'Backrooms',icon:'🚪',description:'Coop, labirintos e terror estranho.',votes:0},
  {id:'elden-ring',name:'Elden Ring',icon:'⚔️',description:'Bosses, builds e evolução de gameplay.',votes:0}
];

const demoRewards = [
  {id:'next-game', icon:'🎮', title:'Escolher próximo jogo', cost:'1.500 pts', desc:'Destaca a votação e coloca a comunidade no centro da próxima escolha.', aliases:['escolher próximo jogo','escolher proximo jogo','próximo jogo','proximo jogo']},
  {id:'community-wheel', icon:'🎡', title:'Roleta da comunidade', cost:'1.000 pts', desc:'Dispara uma seleção aleatória de uma interação cadastrada no site.', aliases:['roleta da comunidade','roleta','girar roleta']},
  {id:'highlight-message', icon:'💬', title:'Mensagem na tela', cost:'750 pts', desc:'Mostra a mensagem do resgate como um evento visual do hub.', aliases:['mensagem na tela','mensagem em destaque','destacar mensagem']},
  {id:'red-alert', icon:'🚨', title:'Alerta vermelho', cost:'500 pts', desc:'Ativa um pulso visual neon e uma notificação temática na página.', aliases:['alerta vermelho','red alert','modo alerta']},
  {id:'react-priority', icon:'📺', title:'Prioridade no react', cost:'2.000 pts', desc:'Sinaliza um conteúdo da fila de reacts para revisão prioritária.', aliases:['prioridade no react','react prioritário','react prioritario']},
  {id:'focus-mode', icon:'♛', title:'Modo foco', cost:'900 pts', desc:'Ativa uma mensagem de foco, força e evolução no painel da comunidade.', aliases:['modo foco','foco força evolução','foco forca evolucao']}
];

const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];
const twitchStore = 'cnbrafaTwitchConfigV2';
const voterStore = 'cnbrafaVoterIdV5';
const myVoteStore = 'cnbrafaMyVoteV5';
const adminTokenStore = 'cnbrafaAdminTokenV5';

let twitchSocket = null;
let twitchUser = null;
let rewardTimer = null;
let twitchStreamData = null;
let streamPoll = null;
let syncedRewardsCache = [];
let backendOnline = false;
let hubEvents = null;
let myVote = localStorage.getItem(myVoteStore) || null;
let adminToken = sessionStorage.getItem(adminTokenStore) || '';
let adminOverview = null;

const voterId = (() => {
  let id = localStorage.getItem(voterStore);
  if(!id){ id = crypto.randomUUID ? crypto.randomUUID() : `viewer_${Date.now()}_${Math.random().toString(36).slice(2)}`; localStorage.setItem(voterStore,id); }
  return id;
})();

let hubState = {
  live:{mode:'manual',isLive:false,game:'Próximo jogo em votação',title:'Central preparada para a próxima transmissão.',viewers:null,mission:'Ativar a comunidade',goalCurrent:0,goalTarget:100,challenge:'Desafio coletivo: usar votos, reacts e recompensas para movimentar a live.',communityEnergy:0,communityLevel:1},
  games:fallbackGames,
  reactions:{queueCount:0,pendingCount:0},
  schedule:[], activities:[]
};

// Navigation / visual shell
const menuToggle = $('#menuToggle');
const nav = $('#nav');
menuToggle.addEventListener('click', () => { nav.classList.toggle('open'); menuToggle.setAttribute('aria-expanded', nav.classList.contains('open')); });
$$('.nav a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 20));
window.addEventListener('pointermove', e => { const glow=$('#cursorGlow'); glow.style.left=`${e.clientX}px`; glow.style.top=`${e.clientY}px`; });
const io = new IntersectionObserver(entries => entries.forEach(entry => { if(entry.isIntersecting){ entry.target.classList.add('visible'); io.unobserve(entry.target); } }), {threshold:.1});
$$('.reveal').forEach(el => io.observe(el));

async function api(path, options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  const res=await fetch(path,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){ const err=new Error(data.error||`HTTP ${res.status}`); err.status=res.status; throw err; }
  return data;
}
async function adminApi(path, options={}){
  if(!adminToken) throw new Error('Faça login no painel.');
  try{ return await api(path,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${adminToken}`}}); }
  catch(err){ if(err.status===401){ adminToken=''; sessionStorage.removeItem(adminTokenStore); showAdminLogin(); } throw err; }
}

function topGames(){ return [...(hubState.games||[])].sort((a,b)=>Number(b.votes)-Number(a.votes)); }
function effectiveLiveState(){
  const live=hubState.live||{};
  return {source:'hub',isLive:!!live.isLive,game:live.game||'Próximo jogo em votação',title:live.title||'Central preparada para a próxima transmissão.',viewers:live.viewers==null?'--':live.viewers};
}
function renderCentral(){
  if(!$('#centralGame')) return;
  const live=effectiveLiveState(), ranking=topGames(), leader=ranking[0], st=hubState.live||{};
  $('#centralGame').textContent=live.game;
  $('#centralTitle').textContent=live.title;
  $('#centralViewers').textContent=typeof live.viewers==='number'?Number(live.viewers).toLocaleString('pt-BR'):live.viewers;
  $('#centralTopGame').textContent=leader?leader.name:'--';
  $('#centralReactCount').textContent=String(hubState.reactions?.queueCount||0);
  const flag=$('#centralLiveFlag'); flag.textContent=live.isLive?'AO VIVO':'STANDBY'; flag.classList.toggle('live',live.isLive);
  $('#streamStatus').textContent=live.isLive?`AO VIVO • ${String(live.game).toUpperCase()}`:'PRONTO PARA A PRÓXIMA LIVE';
  const badge=$('#centralSourceBadge');
  if(backendOnline){ badge.className='status-badge live'; badge.innerHTML='<i></i> HUB REALTIME'; $('#centralUpdatedAt').textContent='SINCRONIZADO COM O SERVIDOR'; }
  else{ badge.className='status-badge'; badge.innerHTML='<i></i> HUB OFFLINE'; $('#centralUpdatedAt').textContent='INICIE O SERVER.JS'; }
  $('#missionTitle').textContent=st.mission||'Ativar a comunidade';
  $('#missionCurrent').textContent=Number(st.goalCurrent||0).toLocaleString('pt-BR');
  $('#missionTarget').textContent=Number(st.goalTarget||100).toLocaleString('pt-BR');
  const target=Math.max(1,Number(st.goalTarget)||100), current=Math.max(0,Number(st.goalCurrent)||0), pct=Math.min(100,Math.round(current/target*100));
  $('#missionPercent').textContent=`${pct}%`; $('#missionBar').style.width=`${pct}%`;
  $('#centralChallenge').textContent=st.challenge||'Desafio coletivo da comunidade.';
  $('#communityLevel').textContent=st.communityLevel||1; $('#communityEnergy').textContent=Math.round(st.communityEnergy||0); $('#communityEnergyBar').style.width=`${Math.min(100,st.communityEnergy||0)}%`;
  const max=Math.max(1,...ranking.slice(0,4).map(x=>Number(x.votes)||0));
  $('#centralRanking').innerHTML=ranking.length?ranking.slice(0,4).map((g,i)=>`<div class="ranking-row"><i>${String(i+1).padStart(2,'0')}</i><b>${escapeHtml(g.name)}</b><div class="ranking-track"><span style="width:${Math.max(8,(Number(g.votes)||0)/max*100)}%"></span></div><small>${Number(g.votes)||0}</small></div>`).join(''):'<div class="central-empty">Sem jogos ativos.</div>';
  const rewards=syncedRewardsCache.length?syncedRewardsCache.slice(0,4).map(r=>({title:r.title,cost:`${Number(r.cost).toLocaleString('pt-BR')} pts`})) : demoRewards.slice(0,4).map(r=>({title:r.title,cost:r.cost}));
  $('#centralRewardCount').textContent=String(syncedRewardsCache.length||demoRewards.length);
  $('#centralRewards').innerHTML=rewards.map(r=>`<div class="reward-preview-item"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.cost)}</span></div>`).join('');
  $('#centralEventMode').textContent=backendOnline?'REALTIME':'OFFLINE';
  const feed=$('#centralEventFeed'), events=hubState.activities||[];
  if(!events.length) feed.innerHTML='<div class="central-empty">Aguardando a primeira ação da comunidade.</div>';
  else feed.innerHTML=events.slice(0,5).map(e=>`<div class="central-event"><i></i><div><b>${escapeHtml(e.title)}</b><span>${escapeHtml(e.meta||'CNBRAFA HUB')} • ${escapeHtml(e.source||'HUB')}</span></div></div>`).join('');
}

function renderGames(){
  const games=hubState.games?.length?hubState.games:fallbackGames;
  $('#gamesGrid').innerHTML=games.map(g=>`<article class="game-card"><div class="game-icon">${escapeHtml(g.icon||'🎮')}</div><h3>${escapeHtml(g.name)}</h3><p>${escapeHtml(g.description||'')}</p><footer><button class="vote-btn ${myVote===g.id?'voted':''}" data-game="${escapeHtml(g.id)}" ${backendOnline?'':'disabled'}>${myVote===g.id?'VOTADO ✓':'VOTAR'}</button><span class="vote-count">${Number(g.votes)||0} votos</span></footer></article>`).join('');
  $$('.vote-btn').forEach(btn=>btn.addEventListener('click',()=>voteGame(btn.dataset.game)));
  const chosen=games.find(g=>g.id===myVote);
  $('#voteMessage').textContent=chosen?`Seu voto atual: ${chosen.name}. Você pode trocar quando quiser.`:(backendOnline?'Você ainda não escolheu um jogo.':'Hub offline: rode o servidor para votar.');
}
async function syncMyVote(){
  if(!backendOnline) return;
  try{ const data=await api(`/api/votes?voterId=${encodeURIComponent(voterId)}`); myVote=data.gameId||null; if(myVote)localStorage.setItem(myVoteStore,myVote); else localStorage.removeItem(myVoteStore); renderGames(); }
  catch(err){ console.debug('vote sync',err); }
}
async function voteGame(gameId){
  if(!backendOnline){ toast('O backend da V5 precisa estar rodando.'); return; }
  try{ await api('/api/votes',{method:'POST',body:JSON.stringify({voterId,gameId})}); myVote=gameId; localStorage.setItem(myVoteStore,myVote); renderGames(); toast('Voto global registrado!'); }
  catch(err){ toast(err.message||'Não foi possível votar.'); }
}
$('#resetVotes').addEventListener('click',async()=>{
  if(!backendOnline){toast('Hub offline.');return;}
  try{ await api(`/api/votes?voterId=${encodeURIComponent(voterId)}`,{method:'DELETE'}); myVote=null; localStorage.removeItem(myVoteStore); renderGames(); toast('Seu voto foi removido.'); }
  catch(err){toast(err.message||'Não foi possível remover o voto.');}
});

function renderSchedule(){
  const box=$('#scheduleGrid'), schedule=hubState.schedule||[];
  if(!schedule.length){ box.innerHTML='<article class="schedule-card featured"><div class="day"><span>HUB</span><b>...</b></div><div class="schedule-info"><h3>Cronograma indisponível</h3><p>Inicie o backend para carregar os dados compartilhados.</p></div><div class="time">--</div></article>'; return; }
  box.innerHTML=schedule.map((s,i)=>`<article class="schedule-card ${i===0?'featured':''}"><div class="day"><span>${escapeHtml(s.eyebrow)}</span><b>${escapeHtml(s.dayLabel)}</b></div><div class="schedule-info">${i===0?'<span class="tag">ATUALIZADO NO HUB</span>':''}<h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.description)}</p></div><div class="time">${escapeHtml(s.timeLabel)}</div></article>`).join('');
}

$('#reactForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!backendOnline){ $('#reactFeedback').textContent='O backend da V5 não está conectado.'; $('#reactFeedback').className='feedback error'; return; }
  const item={nickname:$('#reactName').value.trim(),url:$('#reactUrl').value.trim(),context:$('#reactContext').value.trim()};
  try{
    const data=await api('/api/reactions',{method:'POST',body:JSON.stringify(item)});
    $('#reactFeedback').textContent=`Enviado para moderação. Posição aproximada entre pendentes: ${data.position}.`;
    $('#reactFeedback').className='feedback success'; e.target.reset(); toast('Link enviado para a fila global!');
  }catch(err){ $('#reactFeedback').textContent=err.message||'Não foi possível enviar.'; $('#reactFeedback').className='feedback error'; }
});

function applyHubState(state){
  if(!state||!state.live) return;
  hubState=state; backendOnline=true;
  renderCentral(); renderGames(); renderSchedule();
  if(adminOverview && adminToken){ adminOverview={...adminOverview,...state}; updateAdminCounters(); }
}
async function loadHub(){
  if(location.protocol==='file:'){ backendOnline=false; renderCentral(); renderGames(); renderSchedule(); toast('V5 compartilhada: abra pelo servidor local, não pelo arquivo HTML.'); return; }
  try{ const state=await api('/api/state'); applyHubState(state); await syncMyVote(); connectHubEvents(); }
  catch(err){ console.error(err); backendOnline=false; renderCentral(); renderGames(); renderSchedule(); toast('Não foi possível conectar ao backend da V5.'); }
}
function connectHubEvents(){
  if(hubEvents) hubEvents.close();
  hubEvents=new EventSource('/api/events');
  hubEvents.addEventListener('state',ev=>{ try{applyHubState(JSON.parse(ev.data));}catch(err){console.error(err);} });
  hubEvents.onopen=()=>{backendOnline=true;renderCentral();};
  hubEvents.onerror=()=>{backendOnline=false;renderCentral();};
}

// Admin / Creator panel
const creatorModal=$('#creatorModal');
$('#openCreatorPanel').addEventListener('click',async()=>{ creatorModal.classList.add('open'); creatorModal.setAttribute('aria-hidden','false'); if(adminToken) await openAdminPanel(); else showAdminLogin(); });
function closeCreatorModal(){creatorModal.classList.remove('open');creatorModal.setAttribute('aria-hidden','true')}
$('#closeCreatorPanel').addEventListener('click',closeCreatorModal); creatorModal.addEventListener('click',e=>{if(e.target===creatorModal)closeCreatorModal()});
function showAdminLogin(){ $('#adminLoginView').classList.remove('hidden'); $('#adminPanelView').classList.add('hidden'); }
function showAdminPanel(){ $('#adminLoginView').classList.add('hidden'); $('#adminPanelView').classList.remove('hidden'); }
$('#adminLoginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const feedback=$('#adminLoginFeedback'); feedback.textContent='Validando...'; feedback.className='feedback';
  try{ const data=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#adminPassword').value})}); adminToken=data.token; sessionStorage.setItem(adminTokenStore,adminToken); $('#adminPassword').value=''; feedback.textContent=''; await openAdminPanel(); toast('Painel administrativo liberado.'); }
  catch(err){ feedback.textContent=err.message||'Senha inválida.'; feedback.className='feedback error'; }
});
$('#adminLogout').addEventListener('click',()=>{adminToken='';adminOverview=null;sessionStorage.removeItem(adminTokenStore);showAdminLogin();toast('Sessão administrativa encerrada.');});
async function openAdminPanel(){
  try{ adminOverview=await adminApi('/api/admin/overview'); showAdminPanel(); fillAdminLive(); renderAdminReacts(); renderAdminSchedule(); renderAdminGames(); }
  catch(err){ toast(err.message||'Não foi possível abrir o painel.'); }
}
function fillAdminLive(){
  const s=adminOverview?.live||hubState.live||{};
  $('#creatorMode').value=s.mode||'manual'; $('#creatorLive').value=String(!!s.isLive); $('#creatorGame').value=s.game||''; $('#creatorViewers').value=s.viewers??''; $('#creatorTitle').value=s.title||''; $('#creatorMission').value=s.mission||''; $('#creatorGoalCurrent').value=s.goalCurrent??0; $('#creatorGoalTarget').value=s.goalTarget??100; $('#creatorChallenge').value=s.challenge||'';
}
function updateAdminCounters(){ if($('#adminPendingCount')) $('#adminPendingCount').textContent=`${hubState.reactions?.pendingCount||0} pendentes`; }
$('#saveCreatorPanel').addEventListener('click',async()=>{
  const payload={mode:$('#creatorMode').value,isLive:$('#creatorLive').value==='true',game:$('#creatorGame').value.trim(),viewers:$('#creatorViewers').value===''?null:Number($('#creatorViewers').value),title:$('#creatorTitle').value.trim(),mission:$('#creatorMission').value.trim(),goalCurrent:Number($('#creatorGoalCurrent').value),goalTarget:Number($('#creatorGoalTarget').value),challenge:$('#creatorChallenge').value.trim()};
  try{ await adminApi('/api/admin/live',{method:'PATCH',body:JSON.stringify(payload)}); toast('Central atualizada para todos.'); await openAdminPanel(); }
  catch(err){toast(err.message||'Não foi possível salvar.');}
});
$('#resetCreatorPanel').addEventListener('click',async()=>{ if(!confirm('Restaurar o estado padrão da Central?'))return; try{await adminApi('/api/admin/live/reset',{method:'POST',body:'{}'});toast('Central restaurada.');await openAdminPanel();}catch(err){toast(err.message);} });

function renderAdminReacts(){
  updateAdminCounters(); const box=$('#adminReactList'), rows=adminOverview?.reactionsList||[];
  if(!rows.length){box.innerHTML='<div class="sync-placeholder"><b>Fila vazia</b><span>Os novos links enviados pela comunidade aparecem aqui.</span></div>';return;}
  box.innerHTML=rows.map(r=>`<article class="admin-react-card ${r.priority?'priority':''}" data-id="${r.id}"><div class="admin-react-top"><div><span class="react-status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>${r.priority?'<span class="react-status priority-tag">PRIORIDADE</span>':''}</div><small>#${r.id}</small></div><b>${escapeHtml(r.nickname)}</b><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(shortUrl(r.url))} ↗</a><p>${escapeHtml(r.context)}</p><div class="admin-react-actions"><button class="mini-btn" data-action="approve">APROVAR</button><button class="mini-btn" data-action="priority">${r.priority?'TIRAR PRIORIDADE':'PRIORIZAR'}</button><button class="mini-btn" data-action="done">CONCLUIR</button><button class="mini-btn danger" data-action="reject">REJEITAR</button></div></article>`).join('');
  $$('.admin-react-actions button',box).forEach(btn=>btn.addEventListener('click',()=>moderateReact(btn.closest('[data-id]'),btn.dataset.action)));
}
async function moderateReact(card,action){
  const id=card.dataset.id, current=(adminOverview.reactionsList||[]).find(r=>String(r.id)===String(id)); if(!current)return;
  const payload=action==='priority'?{priority:!current.priority}:{status:action==='approve'?'approved':action==='done'?'done':'rejected'};
  try{await adminApi(`/api/admin/reactions/${id}`,{method:'PATCH',body:JSON.stringify(payload)});toast('Fila atualizada.');await openAdminPanel();}catch(err){toast(err.message);}
}
function renderAdminSchedule(){
  const box=$('#adminScheduleEditor'), rows=adminOverview?.allSchedule||[];
  box.innerHTML=rows.map(s=>`<article class="admin-schedule-row" data-id="${escapeHtml(s.id)}"><input data-field="eyebrow" value="${escapeAttr(s.eyebrow)}" maxlength="20" aria-label="Tipo"><input data-field="dayLabel" value="${escapeAttr(s.dayLabel)}" maxlength="24" aria-label="Dia"><input class="wide" data-field="title" value="${escapeAttr(s.title)}" maxlength="80" aria-label="Título"><input data-field="timeLabel" value="${escapeAttr(s.timeLabel)}" maxlength="20" aria-label="Horário"><textarea class="wide" data-field="description" maxlength="180" aria-label="Descrição">${escapeHtml(s.description)}</textarea><label class="admin-check"><input data-field="active" type="checkbox" ${s.active?'checked':''}> ativo</label></article>`).join('');
}
$('#saveSchedule').addEventListener('click',async()=>{
  const rows=$$('.admin-schedule-row');
  try{ for(const row of rows){ const val=f=>row.querySelector(`[data-field="${f}"]`); const payload={eyebrow:val('eyebrow').value,dayLabel:val('dayLabel').value,title:val('title').value,timeLabel:val('timeLabel').value,description:val('description').value,active:val('active').checked}; await adminApi(`/api/admin/schedule/${row.dataset.id}`,{method:'PATCH',body:JSON.stringify(payload)}); } toast('Cronograma salvo para todos.'); await openAdminPanel(); }
  catch(err){toast(err.message||'Erro ao salvar cronograma.');}
});
function renderAdminGames(){
  const box=$('#adminGameList'), games=adminOverview?.allGames||adminOverview?.games||[];
  box.innerHTML=games.map(g=>`<div class="admin-game-row"><span>${escapeHtml(g.icon||'🎮')}</span><b>${escapeHtml(g.name)}</b><small>${Number(g.votes)||0} votos</small><button class="mini-btn ${g.active?'':'muted'}" data-id="${escapeHtml(g.id)}" data-active="${g.active?'1':'0'}">${g.active?'ATIVO':'INATIVO'}</button></div>`).join('');
  $$('button[data-id]',box).forEach(btn=>btn.addEventListener('click',async()=>{try{await adminApi(`/api/admin/games/${btn.dataset.id}`,{method:'PATCH',body:JSON.stringify({active:btn.dataset.active!=='1'})});await openAdminPanel();toast('Jogo atualizado.');}catch(err){toast(err.message);}}));
}
$('#adminGameForm').addEventListener('submit',async e=>{
  e.preventDefault(); const payload={icon:$('#adminGameIcon').value.trim()||'🎮',name:$('#adminGameName').value.trim(),description:$('#adminGameDesc').value.trim()};
  try{await adminApi('/api/admin/games',{method:'POST',body:JSON.stringify(payload)});e.target.reset();toast('Jogo adicionado à votação.');await openAdminPanel();}catch(err){toast(err.message);}
});

// Interaction cards
function renderInteractions(){ $('#interactionGrid').innerHTML=demoRewards.map(r=>`<article class="interaction-card" data-reward-id="${r.id}"><span class="icon">${r.icon}</span><span class="reward-cost">${r.cost}</span><h3>${r.title}</h3><p>${r.desc}</p><button class="mini-btn demo-trigger">TESTAR INTERAÇÃO</button></article>`).join(''); $$('.demo-trigger').forEach(btn=>btn.addEventListener('click',()=>{const reward=demoRewards.find(r=>r.id===btn.closest('.interaction-card').dataset.rewardId);triggerReward(reward,{user_name:'demo_viewer',user_input:'Teste de interação do site.'},'demo')})); }
renderInteractions();
$('#randomReward').addEventListener('click',()=>{const reward=demoRewards[Math.floor(Math.random()*demoRewards.length)];triggerReward(reward,{user_name:'chat_demo',user_input:'Resgate aleatório do laboratório.'},'demo')});
function triggerReward(reward,event={},source='demo'){
  if(!reward) reward={id:'custom',title:event?.reward?.title||'Resgate Twitch',icon:'♛',desc:'Evento recebido da Twitch.'};
  const user=event.user_name||event.user_login||'viewer';
  $('#rewardDisplay').textContent=reward.title; $('#rewardMeter').style.width=`${58+Math.random()*38}%`; $('#rewardHint').textContent=source==='twitch'?`Resgate recebido em tempo real de @${user}.`:`Simulação concluída por @${user}.`;
  addEventLog(reward.title,user,source,event.user_input); showRedemptionOverlay(reward.title,user); applyRewardEffect(reward,event);
}
function addEventLog(title,user,source,input=''){ const log=$('#eventLog'); $('.empty-event',log)?.remove(); const row=document.createElement('div');row.className='event-row';row.innerHTML=`<i></i><div><b>${escapeHtml(title)}</b><span>@${escapeHtml(user)} • ${source==='twitch'?'TWITCH':'DEMO'}${input?` • ${escapeHtml(input.slice(0,72))}`:''}</span></div>`;log.prepend(row);while(log.children.length>6) log.lastElementChild.remove(); }
function showRedemptionOverlay(title,user){ const el=$('#redemptionOverlay');$('#overlayReward').textContent=title;$('#overlayUser').textContent=`@${user}`;el.classList.add('show');el.setAttribute('aria-hidden','false');clearTimeout(rewardTimer);rewardTimer=setTimeout(()=>{el.classList.remove('show');el.setAttribute('aria-hidden','true')},4300); }
function applyRewardEffect(reward,event){ document.body.classList.remove('system-flash');void document.body.offsetWidth;document.body.classList.add('system-flash');setTimeout(()=>document.body.classList.remove('system-flash'),1100); if(reward.id==='next-game') setTimeout(()=>$('#jogos').scrollIntoView({behavior:'smooth',block:'start'}),650); if(reward.id==='react-priority') setTimeout(()=>$('#reacts').scrollIntoView({behavior:'smooth',block:'start'}),650); if(reward.id==='highlight-message' && event.user_input) toast(`@${event.user_name||'viewer'}: ${event.user_input.slice(0,90)}`); if(reward.id==='community-wheel') setTimeout(()=>{const pool=demoRewards.filter(r=>r.id!=='community-wheel');const pick=pool[Math.floor(Math.random()*pool.length)];toast(`Roleta: ${pick.title}`)},750); }

// Twitch configuration modal
const modal=$('#twitchModal');
$('#openTwitchSetup').addEventListener('click',openTwitchModal);$('#closeTwitchSetup').addEventListener('click',closeTwitchModal);modal.addEventListener('click',e=>{if(e.target===modal)closeTwitchModal()});
function getTwitchConfig(){return JSON.parse(localStorage.getItem(twitchStore)||'{}')}
function openTwitchModal(){const c=getTwitchConfig();$('#twitchClientId').value=c.clientId||'';$('#twitchRedirectUri').value=c.redirectUri||defaultRedirectUri();modal.classList.add('open');modal.setAttribute('aria-hidden','false')}
function closeTwitchModal(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true')}
function defaultRedirectUri(){return `${location.origin}${location.pathname}`}
$('#saveTwitchSetup').addEventListener('click',()=>{const clientId=$('#twitchClientId').value.trim();const redirectUri=$('#twitchRedirectUri').value.trim();if(!clientId||!redirectUri){toast('Preencha Client ID e Redirect URL.');return;}try{new URL(redirectUri)}catch{toast('Use uma Redirect URL válida.');return;}localStorage.setItem(twitchStore,JSON.stringify({clientId,redirectUri}));closeTwitchModal();toast('Configuração Twitch salva neste navegador.');updateTwitchControls()});

$('#connectTwitch').addEventListener('click',()=>{const c=getTwitchConfig();if(!c.clientId){openTwitchModal();toast('Configure o Client ID primeiro.');return;}const redirect=c.redirectUri||defaultRedirectUri();const state=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2);sessionStorage.setItem('cnbrafaTwitchOAuthState',state);const params=new URLSearchParams({client_id:c.clientId,redirect_uri:redirect,response_type:'token',scope:'channel:read:redemptions',state,force_verify:'true'});location.href=`https://id.twitch.tv/oauth2/authorize?${params.toString()}`});
$('#disconnectTwitch').addEventListener('click',disconnectTwitch);$('#syncRewards').addEventListener('click',syncTwitchRewards);
async function handleOAuthReturn(){
  if(!location.hash.includes('access_token=')) return;
  const p=new URLSearchParams(location.hash.slice(1));const token=p.get('access_token');const state=p.get('state');const expected=sessionStorage.getItem('cnbrafaTwitchOAuthState');
  history.replaceState(null,'',location.pathname+location.search);
  if(!token||!state||!expected||state!==expected){toast('Falha ao validar o retorno da Twitch.');return;}
  sessionStorage.setItem('cnbrafaTwitchToken',token);sessionStorage.removeItem('cnbrafaTwitchOAuthState'); await initializeTwitchSession();
}
async function initializeTwitchSession(){
  const token=sessionStorage.getItem('cnbrafaTwitchToken');const c=getTwitchConfig();if(!token||!c.clientId){updateTwitchControls();return;}
  try{ const r=await fetch('https://api.twitch.tv/helix/users',{headers:{'Authorization':`Bearer ${token}`,'Client-Id':c.clientId}});if(!r.ok) throw new Error(`Twitch users: ${r.status}`);const data=await r.json();twitchUser=data.data?.[0];if(!twitchUser) throw new Error('Usuário Twitch não encontrado.'); updateTwitchControls(true);toast(`Twitch conectada: ${twitchUser.display_name}`);await Promise.all([syncTwitchRewards(),fetchTwitchStreamState()]);connectEventSub();clearInterval(streamPoll);streamPoll=setInterval(fetchTwitchStreamState,60000); }
  catch(err){console.error(err);sessionStorage.removeItem('cnbrafaTwitchToken');updateTwitchControls(false);toast('Não foi possível validar a sessão Twitch.');}
}
function updateTwitchControls(connected=!!(sessionStorage.getItem('cnbrafaTwitchToken')&&twitchUser)){
  const c=getTwitchConfig();$('#connectTwitch').classList.toggle('hidden',connected);$('#disconnectTwitch').classList.toggle('hidden',!connected);$('#syncRewards').disabled=!connected;
  if(connected){$('#connectionBadge').className='status-badge live';$('#connectionBadge').innerHTML='<i></i> TWITCH ON';$('#twitchConnectionTitle').textContent=`Conectado como ${twitchUser?.display_name||'broadcaster'}`;$('#twitchConnectionText').textContent=adminToken?'Status e resgates podem ser sincronizados com o Hub para todos.':'Recompensas e resgates estão ativos neste navegador. Entre no Painel do Criador para publicar eventos no Hub.';}else{$('#connectionBadge').className='status-badge demo';$('#connectionBadge').innerHTML='<i></i> DEMO';$('#twitchConnectionTitle').textContent=c.clientId?'Twitch configurada — falta conectar':'Modo demonstração ativo';$('#twitchConnectionText').textContent=c.clientId?'Use “Conectar com Twitch” para autorizar o canal.':'Teste todas as interações sem precisar configurar API.';}
}
function disconnectTwitch(){sessionStorage.removeItem('cnbrafaTwitchToken');twitchUser=null;twitchStreamData=null;syncedRewardsCache=[];clearInterval(streamPoll);streamPoll=null;if(twitchSocket){twitchSocket.close();twitchSocket=null}$('#eventBadge').className='status-badge';$('#eventBadge').innerHTML='<i></i> EVENTSUB OFF';$('#syncedRewards').innerHTML='<div class="sync-placeholder"><b>Modo demo</b><span>Conecte a Twitch para sincronizar suas recompensas reais.</span></div>';updateTwitchControls(false);renderCentral();toast('Twitch desconectada desta sessão.')}
async function syncTwitchRewards(){
  const token=sessionStorage.getItem('cnbrafaTwitchToken'),c=getTwitchConfig();if(!token||!c.clientId||!twitchUser) return;
  const box=$('#syncedRewards');box.innerHTML='<div class="sync-placeholder"><b>Sincronizando...</b><span>Consultando recompensas do canal.</span></div>';
  try{const u=new URL('https://api.twitch.tv/helix/channel_points/custom_rewards');u.searchParams.set('broadcaster_id',twitchUser.id);const r=await fetch(u,{headers:{'Authorization':`Bearer ${token}`,'Client-Id':c.clientId}});if(!r.ok){if(r.status===403) throw new Error('Channel Points pode exigir canal elegível e permissões corretas.');throw new Error(`HTTP ${r.status}`)}const data=await r.json();syncedRewardsCache=data.data||[];renderSyncedRewards(syncedRewardsCache);renderCentral();}
  catch(err){console.error(err);syncedRewardsCache=[];renderCentral();box.innerHTML=`<div class="sync-placeholder"><b>Não foi possível sincronizar</b><span>${escapeHtml(err.message||'Verifique a configuração da Twitch.')}</span></div>`;toast('Falha ao sincronizar recompensas.')}
}
function renderSyncedRewards(rewards){const box=$('#syncedRewards');if(!rewards.length){box.innerHTML='<div class="sync-placeholder"><b>Nenhuma recompensa encontrada</b><span>Crie ou habilite recompensas personalizadas no canal e sincronize novamente.</span></div>';return;}box.innerHTML=rewards.map(r=>`<article class="synced-card"><b>${escapeHtml(r.title)}</b><span>${Number(r.cost).toLocaleString('pt-BR')} pts</span><small>${escapeHtml(r.prompt||'Recompensa personalizada da Twitch.')}</small></article>`).join('')}
async function fetchTwitchStreamState(){
  const token=sessionStorage.getItem('cnbrafaTwitchToken'),c=getTwitchConfig(); if(!token||!c.clientId||!twitchUser) return;
  try{ const u=new URL('https://api.twitch.tv/helix/streams');u.searchParams.set('user_id',twitchUser.id);const r=await fetch(u,{headers:{'Authorization':`Bearer ${token}`,'Client-Id':c.clientId}});if(!r.ok) throw new Error(`Streams HTTP ${r.status}`);const data=await r.json(),stream=data.data?.[0];twitchStreamData=stream?{isLive:true,game_name:stream.game_name,title:stream.title,viewer_count:stream.viewer_count,started_at:stream.started_at}:{isLive:false};
    if(adminToken && hubState.live?.mode==='auto'){ const payload=stream?{isLive:true,game:stream.game_name||'Ao vivo',title:stream.title||'CNBRAFA ao vivo',viewers:stream.viewer_count}:{isLive:false,viewers:null}; await adminApi('/api/admin/live',{method:'PATCH',body:JSON.stringify(payload)}).catch(()=>{}); }
  }catch(err){console.error('Stream state',err);}
}
function connectEventSub(){
  const token=sessionStorage.getItem('cnbrafaTwitchToken'),c=getTwitchConfig();if(!token||!c.clientId||!twitchUser) return;if(twitchSocket)twitchSocket.close();const socket=new WebSocket('wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30');twitchSocket=socket;
  socket.onopen=()=>{$('#eventBadge').className='status-badge live';$('#eventBadge').innerHTML='<i></i> EVENTSUB LINK'};
  socket.onmessage=async msg=>{try{const packet=JSON.parse(msg.data);const type=packet.metadata?.message_type;if(type==='session_welcome'){await subscribeRedemptions(packet.payload?.session?.id)}else if(type==='notification'){handleTwitchEvent(packet.payload)}else if(type==='session_reconnect'){const url=packet.payload?.session?.reconnect_url;if(url)reconnectEventSub(url)}else if(type==='revocation'){toast('A inscrição EventSub foi revogada.')}}catch(err){console.error(err)}};
  socket.onerror=()=>{$('#eventBadge').className='status-badge';$('#eventBadge').innerHTML='<i></i> EVENTSUB ERRO'}; socket.onclose=()=>{if(twitchSocket===socket){$('#eventBadge').className='status-badge';$('#eventBadge').innerHTML='<i></i> EVENTSUB OFF'}};
}
async function subscribeRedemptions(sessionId){
  const token=sessionStorage.getItem('cnbrafaTwitchToken'),c=getTwitchConfig();if(!sessionId||!token||!c.clientId||!twitchUser)return;const body={type:'channel.channel_points_custom_reward_redemption.add',version:'1',condition:{broadcaster_user_id:twitchUser.id},transport:{method:'websocket',session_id:sessionId}};const r=await fetch('https://api.twitch.tv/helix/eventsub/subscriptions',{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Client-Id':c.clientId,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){console.error('EventSub subscribe failed',r.status,await r.text());$('#eventBadge').className='status-badge';$('#eventBadge').innerHTML='<i></i> EVENTSUB ERRO';toast('Conectou à Twitch, mas o EventSub não foi ativado.');return;}$('#eventBadge').className='status-badge live';$('#eventBadge').innerHTML='<i></i> EVENTSUB ON';toast('EventSub ativo: aguardando resgates.')
}
function reconnectEventSub(url){if(!url)return;const old=twitchSocket;const next=new WebSocket(url);twitchSocket=next;next.onmessage=old.onmessage;next.onerror=old.onerror;next.onclose=old.onclose;next.onopen=()=>{try{old.close()}catch{}}}
function handleTwitchEvent(payload){const event=payload?.event;if(!event)return;const title=event.reward?.title||'Resgate Twitch';const reward=findRewardByTitle(title)||{id:'custom',title,icon:'♛',desc:'Recompensa personalizada da Twitch.'};triggerReward(reward,event,'twitch');if(adminToken){adminApi('/api/admin/activity',{method:'POST',body:JSON.stringify({title:reward.title,meta:`@${event.user_name||event.user_login||'viewer'}`,source:'TWITCH',energy:22})}).catch(()=>{});}}
function findRewardByTitle(title=''){const n=normalize(title);return demoRewards.find(r=>r.aliases.some(a=>n.includes(normalize(a))||normalize(a).includes(n)))}
function normalize(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}

// Contact composer
$('#contactForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('#contactName').value.trim(),subject=$('#contactSubject').value,msg=$('#contactMessage').value.trim(),text=`Olá, CNBRAFA!\n\nMeu nome é ${name}.\nAssunto: ${subject}\n\n${msg}`;try{await navigator.clipboard.writeText(text);$('#contactFeedback').textContent='Mensagem copiada. Agora você pode colar no canal de contato que preferir.';$('#contactFeedback').className='feedback success';toast('Mensagem copiada!')}catch{$('#contactFeedback').textContent='Seu navegador bloqueou a cópia automática. Selecione e copie a mensagem manualmente.';$('#contactFeedback').className='feedback error'}});

function shortUrl(v=''){try{const u=new URL(v);return `${u.hostname}${u.pathname}`.slice(0,60)}catch{return String(v).slice(0,60)}}
function escapeAttr(value=''){return escapeHtml(value)}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),2800)}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

// Particle field
const canvas=$('#particles'),ctx=canvas.getContext('2d');let particles=[];
function resize(){canvas.width=innerWidth*devicePixelRatio;canvas.height=innerHeight*devicePixelRatio;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);particles=Array.from({length:Math.min(68,Math.floor(innerWidth/19))},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,r:Math.random()*1.35+.2,vx:(Math.random()-.5)*.12,vy:Math.random()*.18+.04}))}
function animate(){ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='rgba(255,23,56,.42)';for(const p of particles){p.x+=p.vx;p.y+=p.vy;if(p.y>innerHeight+3){p.y=-3;p.x=Math.random()*innerWidth}ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}requestAnimationFrame(animate)}
addEventListener('resize',resize);resize();animate();

renderGames();renderCentral();renderSchedule();updateTwitchControls(false);
loadHub();
handleOAuthReturn().then(()=>{if(sessionStorage.getItem('cnbrafaTwitchToken')&&!twitchUser) initializeTwitchSession()});
