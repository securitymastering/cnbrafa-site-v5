(() => {
  'use strict';
  const root = document.getElementById('overlayRoot');
  const mode = (location.pathname.split('/').filter(Boolean).pop() || 'mission').toLowerCase();
  const params = new URLSearchParams(location.search);
  const limit = Math.max(1, Math.min(10, Number(params.get('limit') || (mode === 'ranking' ? 5 : 6))));
  let lastState = null;
  let initialActivityId = null;
  let alertQueue = [];
  let alertBusy = false;

  const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const pct = (current,target) => Math.max(0,Math.min(100,Math.round((Number(current)||0)/Math.max(1,Number(target)||1)*100)));
  const timeAgo = ts => {
    const diff=Math.max(0,Date.now()-Number(ts||Date.now()));
    if(diff<60000) return 'AGORA';
    if(diff<3600000) return `${Math.floor(diff/60000)}M`;
    return `${Math.floor(diff/3600000)}H`;
  };
  const compactUrl = v => { try { const u = new URL(v); return u.hostname.replace(/^www\./,''); } catch { return 'LINK APROVADO'; } };

  function shell(content, cls=''){
    return `<section class="widget ${cls}"><div class="scanlines"></div>${content}</section>`;
  }

  function render(state){
    lastState = state;
    if(mode === 'mission') renderMission(state);
    else if(mode === 'ranking') renderRanking(state);
    else if(mode === 'react') renderReact(state);
    else if(mode === 'events') renderEvents(state);
    else if(mode === 'alert') renderAlertState(state);
    else if(mode === 'live') renderLive(state);
    else renderMission(state);
  }

  function renderMission({live}){
    const progress = pct(live.goalCurrent,live.goalTarget);
    root.innerHTML = shell(`
      <div class="mission-top">
        <div><div class="eyebrow"><i></i> CNBRAFA // MISSÃO DA LIVE</div><h1>${esc(live.mission || 'Ativar a comunidade')}</h1></div>
        <div class="mission-percent">${progress}%</div>
      </div>
      <div class="progress"><span style="width:${progress}%"></span></div>
      <div class="mission-foot"><strong>${Number(live.goalCurrent||0).toLocaleString('pt-BR')} / ${Number(live.goalTarget||100).toLocaleString('pt-BR')}</strong><span class="mission-challenge">${esc(live.challenge || '')}</span></div>
    `,'mission');
  }

  function renderRanking({games}){
    const rows=[...(games||[])].sort((a,b)=>b.votes-a.votes || a.position-b.position).slice(0,limit);
    root.innerHTML=shell(`
      <div class="ranking-head"><div><div class="eyebrow"><i></i> CNBRAFA // COMUNIDADE</div><h1>Ranking de jogos</h1></div><div class="brand"><b>CNB</b><em>RAFA</em></div></div>
      <div class="rank-list">${rows.length?rows.map((g,i)=>`<div class="rank-row" style="animation-delay:${i*55}ms"><span class="rank-pos">${String(i+1).padStart(2,'0')}</span><span class="rank-game"><i>${esc(g.icon||'🎮')}</i>${esc(g.name)}</span><span class="rank-votes"><b>${Number(g.votes||0)}</b> votos</span></div>`).join(''):'<div class="muted">Aguardando votos da comunidade.</div>'}</div>
    `,'ranking');
  }

  function renderReact(state){
    const r=state.reactions?.active;
    if(!r){ root.innerHTML=shell(`<div class="eyebrow"><i></i> CNBRAFA // REACT QUEUE</div><h1>Próximo react aguardando aprovação</h1>`,'react-empty'); return; }
    root.innerHTML=shell(`
      <div class="react-icon">📺</div>
      <div><div class="eyebrow"><i></i> AGORA NO REACT</div><h1>${esc(r.nickname)}</h1><p>${esc(r.context)}</p></div>
      <div class="react-meta"><strong>${r.priority?'PRIORIDADE':'APROVADO'}</strong><small>${esc(compactUrl(r.url))}</small></div>
    `,'react');
  }

  function renderEvents({activities}){
    const rows=(activities||[]).slice(0,limit);
    root.innerHTML=shell(`<div class="eyebrow"><i></i> CNBRAFA // PULSO DA LIVE</div><h1>Eventos recentes</h1><div class="event-list">${rows.length?rows.map((a,i)=>`<div class="event" style="animation-delay:${i*45}ms"><span class="event-dot"></span><span><b>${esc(a.title)}</b><small>${esc([a.meta,a.source].filter(Boolean).join(' • '))}</small></span><time>${timeAgo(a.createdAt)}</time></div>`).join(''):'<div class="muted">Aguardando ações da comunidade.</div>'}</div>`,'events');
  }

  function isAlertable(a){
    if(params.get('all')==='1') return true;
    const source=String(a.source||'').toUpperCase();
    return source==='TWITCH' || a.type==='external';
  }
  function renderAlertState(state){
    const acts=state.activities||[];
    const maxId=acts.reduce((m,a)=>Math.max(m,Number(a.id)||0),0);
    if(initialActivityId===null){ initialActivityId=maxId; root.innerHTML='<div class="alert-stage" id="alertStage"></div>'; return; }
    const fresh=acts.filter(a=>(Number(a.id)||0)>initialActivityId && isAlertable(a)).sort((a,b)=>a.id-b.id);
    initialActivityId=Math.max(initialActivityId,maxId);
    if(fresh.length){ alertQueue.push(...fresh); playNextAlert(); }
  }
  async function playNextAlert(){
    if(alertBusy || !alertQueue.length) return;
    alertBusy=true;
    const a=alertQueue.shift();
    root.innerHTML=`<div class="alert-stage">${shell(`<div class="alert-crown">♛</div><div><div class="eyebrow"><i></i> INTERAÇÃO ATIVADA</div><b>${esc(a.title)}</b><span>${esc(a.meta||'A comunidade movimentou a live.')}</span></div><div class="alert-source">${esc(a.source||'HUB')}</div>`,'alert')}</div>`;
    const el=root.querySelector('.alert'); requestAnimationFrame(()=>el?.classList.add('show'));
    await new Promise(r=>setTimeout(r, Number(params.get('duration')||4200)));
    el?.classList.add('hide'); await new Promise(r=>setTimeout(r,450));
    alertBusy=false; playNextAlert();
  }

  function renderLive({live}){
    root.innerHTML=shell(`
      <div class="live-led"><i></i></div>
      <div><div class="eyebrow"><i></i> ${live.isLive?'AO VIVO AGORA':'CNBRAFA // STANDBY'}</div><h1>${esc(live.game||'Próxima live')}</h1><p>${esc(live.title||'Central preparada para a próxima transmissão.')}</p></div>
      <div class="live-stat"><b>${live.viewers==null?'--':Number(live.viewers).toLocaleString('pt-BR')}</b><span>viewers</span></div>
    `,`live ${live.isLive?'on':'offline'}`);
  }

  async function boot(){
    try{ const r=await fetch('/api/state',{cache:'no-store'}); if(!r.ok) throw new Error('state'); render(await r.json()); }
    catch{ root.innerHTML=shell('<div class="eyebrow">CNBRAFA // OFFLINE</div><h1>Hub indisponível</h1>','react-empty'); }
    const es=new EventSource('/api/events');
    es.addEventListener('state',ev=>{ try{render(JSON.parse(ev.data));}catch{} });
    es.onerror=()=>{};
  }
  boot();
})();
