(() => {
  const overlays=[
    {id:'mission',title:'Missão da Live',size:'760 × 190',w:760,h:190,note:'Meta, desafio e progresso em tempo real.'},
    {id:'ranking',title:'Ranking de Jogos',size:'530 × 430',w:530,h:430,note:'Top 5 global. Use ?limit=3 para um widget menor.'},
    {id:'react',title:'Próximo React',size:'980 × 200',w:980,h:200,note:'Exibe o próximo item que estiver com status Aprovado.'},
    {id:'events',title:'Pulso da Live',size:'560 × 430',w:560,h:430,note:'Feed das ações recentes. Use ?limit=4 para reduzir.'},
    {id:'alert',title:'Alertas',size:'760 × 180',w:760,h:180,note:'Resgates Twitch e atividades externas. Adicione ?all=1 para qualquer atividade.'},
    {id:'live',title:'Status da Live',size:'600 × 150',w:600,h:150,note:'Jogo, título, viewers e estado online/offline.'}
  ];
  const grid=document.getElementById('overlayGrid');
  const origin=location.origin;
  grid.innerHTML=overlays.map(o=>{
    const url=`${origin}/overlay/${o.id}`;
    return `<article class="overlay-card"><div class="card-head"><div><span class="kicker">${o.id.toUpperCase()}</span><h2>${o.title}</h2></div><span class="size">${o.size}</span></div><div class="preview"><iframe src="/overlay/${o.id}" title="Preview ${o.title}" loading="lazy"></iframe></div><div class="url-row"><input value="${url}" readonly aria-label="URL ${o.title}"><button data-copy="${url}">COPIAR URL</button></div><small class="card-note">${o.note}</small></article>`;
  }).join('');

  grid.addEventListener('click',async e=>{const btn=e.target.closest('[data-copy]');if(!btn)return;try{await navigator.clipboard.writeText(btn.dataset.copy);toast('URL copiada para o OBS.');btn.textContent='COPIADO ✓';setTimeout(()=>btn.textContent='COPIAR URL',1600)}catch{toast('Copie a URL manualmente.')}});

  const status=document.querySelector('.status'),hubStatus=document.getElementById('hubStatus');
  fetch('/api/health',{cache:'no-store'}).then(r=>r.json()).then(()=>{status.classList.add('on');hubStatus.textContent='ONLINE'}).catch(()=>hubStatus.textContent='OFFLINE');
  const es=new EventSource('/api/events');es.onopen=()=>{status.classList.add('on');hubStatus.textContent='REALTIME'};es.onerror=()=>{status.classList.remove('on');hubStatus.textContent='RECONECTANDO'};

  let adminToken='';
  document.getElementById('testForm').addEventListener('submit',async e=>{
    e.preventDefault();const feedback=document.getElementById('testFeedback'),password=document.getElementById('adminPassword').value,user=document.getElementById('testUser').value.trim()||'@viewer_teste';feedback.textContent='Enviando...';
    try{
      if(!adminToken){const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Senha inválida.');adminToken=data.token;}
      const r=await fetch('/api/admin/activity',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${adminToken}`},body:JSON.stringify({title:'ALERTA DE TESTE',meta:user,source:'TWITCH',energy:0})});const data=await r.json();if(!r.ok){adminToken='';throw new Error(data.error||'Falha no teste.');}feedback.textContent='Alerta enviado. Veja a preview de Alertas ou sua Browser Source.';toast('Alerta disparado ♛');
    }catch(err){feedback.textContent=err.message||'Não foi possível disparar o alerta.';}
  });

  function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(window.__t);window.__t=setTimeout(()=>el.classList.remove('show'),2200)}
})();
