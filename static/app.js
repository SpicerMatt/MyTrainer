const $ = s => document.querySelector(s);
let activities = [];
const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = new Date();
$('#today').textContent = today.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay()+6)%7);
  const days = Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(d.getDate()+i);return d;});
  const week = activities.filter(a=>days.some(d=>localDate(d)===a.date));
  const minutes=week.reduce((s,a)=>s+a.minutes,0);
  $('#time').innerHTML=`${Math.round(minutes)} <small>min</small>`;
  $('#distance').innerHTML=`${week.reduce((s,a)=>s+a.distance,0).toFixed(1)} <small>km</small>`;
  $('#count').textContent=week.length;
  const totals=days.map(d=>week.filter(a=>a.date===localDate(d)).reduce((s,a)=>s+a.minutes,0));
  const max=Math.max(60,...totals);
  $('#chart').innerHTML=days.map((d,i)=>`<div class="day ${localDate(d)===localDate(today)?'today':''}"><small>${totals[i]?Math.round(totals[i])+'m':''}</small><div class="bar" style="height:${totals[i]/max*110}px"></div><span>${d.toLocaleDateString(undefined,{weekday:'short'})}</span></div>`).join('');
  const list=activities.map((a,index)=>({...a,index})).filter(a=>$('#filter').value==='All activities'||a.type===$('#filter').value).sort((a,b)=>b.date.localeCompare(a.date));
  $('#activities').innerHTML=list.length?list.map(a=>`<div class="activity"><div class="icon">${{Run:'↗',Walk:'↟',Ride:'◎',Strength:'◇',Other:'✦'}[a.type]||'✦'}</div><div class="activity-info"><strong>${escape(a.name)}</strong><p>${escape(a.date)} · ${escape(a.type)}${a.notes?' · '+escape(a.notes):''}</p></div><div class="metrics">${a.minutes} min<p>${a.distance} km</p></div><button class="secondary delete" data-index="${a.index}" aria-label="Delete ${escape(a.name)}">✕</button></div>`).join(''):'<div class="empty">Your next chapter starts here.<br><br>Log your first activity or import a JSON journal.</div>';
}
async function save(next){
  const response=await fetch('/api/activities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Could not save activities.');
  activities=await (await fetch('/api/activities')).json();$('#message').textContent='';render();
}
const report=e=>{$('#message').textContent=e.message;};
$('#add').onclick=()=>{$('#form').reset();$('#form').elements.date.value=localDate(new Date());$('#modal').showModal();};
$('#close').onclick=()=>$('#modal').close();
$('#form').onsubmit=async e=>{e.preventDefault();const a=Object.fromEntries(new FormData(e.target));a.minutes=Number(a.minutes);a.distance=Number(a.distance);const button=e.target.querySelector('[type=submit]');button.disabled=true;try{await save([...activities,a]);$('#modal').close();}catch(err){$('#modal').close();report(err);}finally{button.disabled=false;}};
$('#filter').onchange=render;
$('#activities').onclick=async e=>{const b=e.target.closest('.delete');if(b&&confirm('Delete this activity?')){try{await save(activities.filter((_,i)=>i!==Number(b.dataset.index)));}catch(err){report(err);}}};
$('#import').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5000000)throw Error('File exceeds 5 MB.');const data=JSON.parse(await file.text());if(!Array.isArray(data))throw Error('Expected a JSON array.');await save([...activities,...data]);$('#message').textContent=`Imported ${data.length} activities.`;}catch(err){report(err);}e.target.value='';};
$('#export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(activities,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mytrainer-activities.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
fetch('/api/activities').then(r=>{if(!r.ok)throw Error('Could not load activities.');return r.json();}).then(data=>{activities=data;render();}).catch(report);
