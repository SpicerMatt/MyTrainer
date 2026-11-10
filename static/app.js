const $ = selector => document.querySelector(selector);
let activities = [];
let garminActivities = [];
let chatHistory = [];
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
$('#today').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatNumber = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }) : '-';
const activityType = activity => activity.activityType?.typeKey || activity.activityType || 'unknown';
const normalizedType = type => {
  const value = String(type).toLowerCase();
  if (value.includes('run')) return 'Run';
  if (value.includes('walk') || value.includes('hike')) return 'Walk';
  if (value.includes('cycl') || value.includes('bik') || value.includes('ride')) return 'Ride';
  if (value.includes('strength') || value.includes('weight')) return 'Strength';
  return 'Other';
};

function allActivities() {
  const manual = activities.map((activity, index) => ({
    ...activity, date: activity.date, source: 'Manual', index,
  }));
  const garmin = garminActivities.map(activity => ({
    name: activity.activityName || 'Garmin activity',
    date: activity.startTimeLocal || '',
    type: normalizedType(activityType(activity)),
    minutes: number(activity.duration) / 60,
    distance: number(activity.distance) / 1000,
    source: 'Garmin',
    id: String(activity.activityId),
    averageHR: activity.averageHR,
    calories: activity.calories,
    original: activity,
  }));
  return [...manual, ...garmin];
}

function renderJournal() {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return date;
  });
  const combined = allActivities();
  const week = combined.filter(activity => days.some(day => localDate(day) === activity.date.slice(0, 10)));
  const minutes = week.reduce((sum, activity) => sum + activity.minutes, 0);
  $('#time').innerHTML = `${Math.round(minutes)} <small>min</small>`;
  $('#distance').innerHTML = `${week.reduce((sum, activity) => sum + activity.distance, 0).toFixed(1)} <small>km</small>`;
  $('#count').textContent = week.length;
  const totals = days.map(day => week.filter(activity => activity.date.slice(0, 10) === localDate(day)).reduce((sum, activity) => sum + activity.minutes, 0));
  const max = Math.max(60, ...totals);
  $('#chart').innerHTML = days.map((day, index) => `<div class="day ${localDate(day) === localDate(today) ? 'today' : ''}"><small>${totals[index] ? Math.round(totals[index]) + 'm' : ''}</small><div class="bar" style="height:${totals[index] / max * 110}px"></div><span>${day.toLocaleDateString(undefined, { weekday: 'short' })}</span></div>`).join('');
  const search = $('#activity-search').value.trim().toLowerCase();
  const list = combined
    .filter(activity => $('#filter').value === 'All activities' || activity.type === $('#filter').value)
    .filter(activity => `${activity.name} ${activity.date} ${activity.type} ${activity.source}`.toLowerCase().includes(search))
    .sort((left, right) => right.date.localeCompare(left.date));
  $('#activities').innerHTML = list.length ? list.map(activity => `<div class="activity"><div class="icon">${{ Run: '↗', Walk: '↟', Ride: '◎', Strength: '◇', Other: '✦' }[activity.type] || '✦'}</div><div class="activity-info"><strong>${escape(activity.name)}</strong><p>${escape(activity.date)} · ${escape(activity.type)} <span class="source-tag ${activity.source.toLowerCase()}">${activity.source}</span>${activity.notes ? ' · ' + escape(activity.notes) : ''}${activity.averageHR ? ` · ${escape(activity.averageHR)} bpm` : ''}</p></div><div class="metrics">${formatNumber(activity.minutes)} min<p>${formatNumber(activity.distance, 2)} km</p></div>${activity.source === 'Garmin' ? `<button class="secondary garmin-detail-button" data-id="${escape(activity.id)}" aria-label="View Garmin details for ${escape(activity.name)}">Details</button>` : `<button class="secondary delete" data-index="${activity.index}" aria-label="Delete ${escape(activity.name)}">✕</button>`}</div>`).join('') : '<div class="empty">No activities match this search. Sync Garmin or add a manual workout.</div>';
}

async function save(next) {
  const response = await fetch('/api/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not save activities.');
  activities = await (await fetch('/api/activities')).json();
  $('#message').textContent = '';
  renderJournal();
}

async function loadGarmin() {
  const response = await fetch('/api/garmin/activities');
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not load Garmin activities.');
  garminActivities = result.activities;
  renderJournal();
  if (!result.available) $('#garmin-message').textContent = 'No local Garmin export yet. Sync to download recent activities.';
}

async function openGarminDetail(activity) {
  const summary = activity;
  $('#garmin-detail-title').textContent = activity.activityName || 'Activity details';
  $('#garmin-detail-subtitle').textContent = `${activity.startTimeLocal || ''} · ${activityType(activity)}`;
  renderSummary(summary);
  $('#garmin-summary-json').textContent = JSON.stringify(summary, null, 2);
  $('#garmin-detail-json').textContent = 'Loading complete Garmin detail record...';
  $('#garmin-detail-highlights').innerHTML = [
    ['Distance', `${formatNumber(number(activity.distance) / 1000, 2)} km`],
    ['Duration', `${formatNumber(number(activity.duration) / 60)} min`],
    ['Heart rate', `${formatNumber(activity.averageHR, 0)} avg / ${formatNumber(activity.maxHR, 0)} max`],
    ['Calories', formatNumber(activity.calories, 0)],
  ].map(([label, value]) => `<div><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('');
  $('#garmin-detail').showModal();
  try {
    const response = await fetch(`/api/garmin/activities/${encodeURIComponent(activity.activityId)}`);
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Detailed record not found.');
    $('#garmin-detail-json').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    $('#garmin-detail-json').textContent = `Could not load detailed record: ${error.message}`;
  }
}

const summaryGroupKeys = {
  Activity: ['activityName', 'activityType', 'eventType', 'startTimeLocal', 'startTimeGMT', 'endTimeGMT', 'duration', 'elapsedDuration', 'movingDuration'],
  Effort: ['distance', 'calories', 'averageHR', 'maxHR', 'averageSpeed', 'maxSpeed', 'averageRunningCadenceInStepsPerMinute', 'maxRunningCadenceInStepsPerMinute', 'avgStrideLength', 'steps', 'aerobicTrainingEffect', 'anaerobicTrainingEffect'],
  Elevation: ['elevationGain', 'elevationLoss', 'avgElevation', 'minElevation', 'maxElevation'],
  Location: ['startLatitude', 'startLongitude', 'endLatitude', 'endLongitude'],
};

function summaryLabel(key) {
  const known = {
    activityName: 'Activity name', activityType: 'Sport', eventType: 'Event',
    startTimeLocal: 'Start time', startTimeGMT: 'Start time (GMT)', endTimeGMT: 'End time (GMT)',
    duration: 'Moving time', elapsedDuration: 'Elapsed time', movingDuration: 'Moving time',
    distance: 'Distance', averageHR: 'Average heart rate', maxHR: 'Maximum heart rate',
    averageSpeed: 'Average speed', maxSpeed: 'Maximum speed',
    averageRunningCadenceInStepsPerMinute: 'Average running cadence',
    maxRunningCadenceInStepsPerMinute: 'Maximum running cadence', avgStrideLength: 'Average stride length',
    elevationGain: 'Elevation gained', elevationLoss: 'Elevation lost', avgElevation: 'Average elevation',
    minElevation: 'Minimum elevation', maxElevation: 'Maximum elevation', aerobicTrainingEffect: 'Aerobic training effect',
    anaerobicTrainingEffect: 'Anaerobic training effect', hrTimeInZone_1: 'Heart rate zone 1',
    hrTimeInZone_2: 'Heart rate zone 2', hrTimeInZone_3: 'Heart rate zone 3',
    hrTimeInZone_4: 'Heart rate zone 4', hrTimeInZone_5: 'Heart rate zone 5',
  };
  return known[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\bDTO\b/g, '').replace(/^./, char => char.toUpperCase());
}

function summaryValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object' && !Array.isArray(value) && value.typeKey) return String(value.typeKey).replace(/_/g, ' ');
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'object') return `${Object.keys(value).length} additional fields`;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (key === 'distance') return `${formatNumber(numeric / 1000, 2)} km`;
    if (['duration', 'elapsedDuration', 'movingDuration'].includes(key) || /^hrTimeInZone_/.test(key)) return `${formatNumber(numeric / 60)} min`;
    if (['averageSpeed', 'maxSpeed'].includes(key)) return `${formatNumber(numeric * 3.6, 1)} km/h`;
    if (/Elevation|elevation/.test(key)) return `${formatNumber(numeric, 1)} m`;
    if (/HR$/.test(key)) return `${formatNumber(numeric, 0)} bpm`;
    if (/Cadence/.test(key)) return `${formatNumber(numeric, 0)} steps/min`;
    if (/Latitude|Longitude/.test(key)) return `${formatNumber(numeric, 5)}°`;
    if (key === 'avgStrideLength') return `${formatNumber(numeric, 2)} m`;
    return formatNumber(numeric, 2);
  }
  return String(value);
}

function renderSummary(summary) {
  const container = $('#garmin-summary-fields');
  container.replaceChildren();
  const assigned = new Set();
  const groups = Object.entries(summaryGroupKeys).map(([name, keys]) => {
    const entries = keys.filter(key => Object.hasOwn(summary, key)).map(key => [key, summary[key]]);
    entries.forEach(([key]) => assigned.add(key));
    return [name, entries];
  }).filter(([, entries]) => entries.length);
  const additional = Object.entries(summary).filter(([key]) => !assigned.has(key));
  if (additional.length) groups.push(['Additional details', additional]);

  for (const [name, entries] of groups) {
    const section = document.createElement('section');
    section.className = 'summary-group';
    const heading = document.createElement('h4');
    heading.textContent = name;
    const fields = document.createElement('dl');
    fields.className = 'summary-fields';
    for (const [key, value] of entries) {
      const field = document.createElement('div');
      const label = document.createElement('dt');
      label.textContent = summaryLabel(key);
      const content = document.createElement('dd');
      content.textContent = summaryValue(key, value);
      field.append(label, content);
      fields.append(field);
    }
    section.append(heading, fields);
    container.append(section);
  }
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('[data-view]').forEach(tab => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== button.dataset.view; });
  };
});

function addChatMessage(role, content, isError = false) {
  const message = document.createElement('div');
  message.className = `chat-message ${role}${isError ? ' error' : ''}`;
  const paragraph = document.createElement('p');
  paragraph.textContent = content;
  message.append(paragraph);
  $('#coach-messages').append(message);
  $('#coach-messages').scrollTop = $('#coach-messages').scrollHeight;
}

$('#coach-form').onsubmit = async event => {
  event.preventDefault();
  const input = $('#coach-input');
  const question = input.value.trim();
  if (!question) return;
  const nextHistory = [...chatHistory, { role: 'user', content: question }].slice(-12);
  addChatMessage('user', question);
  input.value = '';
  input.disabled = true;
  $('#coach-send').disabled = true;
  $('#coach-model-status').textContent = 'Thinking...';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: nextHistory }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Could not reach the local coach.');
    chatHistory = [...nextHistory, { role: 'assistant', content: result.answer }].slice(-12);
    addChatMessage('assistant', result.answer);
    $('#coach-model-status').textContent = 'Local model connected';
  } catch (error) {
    addChatMessage('assistant', error.message, true);
    $('#coach-model-status').textContent = 'Local model unavailable';
  } finally {
    input.disabled = false;
    $('#coach-send').disabled = false;
    input.focus();
  }
};
$('#coach-input').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('#coach-form').requestSubmit();
  }
};
$('#clear-chat').onclick = () => {
  chatHistory = [];
  $('#coach-messages').innerHTML = '';
  addChatMessage('assistant', 'Conversation cleared. Ask about your training patterns, consistency, or a manageable next step.');
};
fetch('/api/chat/status').then(response => response.json()).then(result => {
  $('#coach-model-status').textContent = result.available ? `Local model ready · ${result.model}` : result.setup || `Ollama not detected · ${result.model}`;
}).catch(() => { $('#coach-model-status').textContent = 'Local model status unavailable'; });

const report = error => { $('#message').textContent = error.message; };
$('#add').onclick = () => { $('#form').reset(); $('#form').elements.date.value = localDate(new Date()); $('#modal').showModal(); };
$('#close').onclick = () => $('#modal').close();
$('#form').onsubmit = async event => {
  event.preventDefault();
  const activity = Object.fromEntries(new FormData(event.target));
  activity.minutes = Number(activity.minutes);
  activity.distance = Number(activity.distance);
  const button = event.target.querySelector('[type=submit]');
  button.disabled = true;
  try { await save([...activities, activity]); $('#modal').close(); }
  catch (error) { $('#modal').close(); report(error); }
  finally { button.disabled = false; }
};
$('#filter').onchange = renderJournal;
$('#activities').onclick = async event => {
  const details = event.target.closest('.garmin-detail-button');
  if (details) {
    const activity = garminActivities.find(item => String(item.activityId) === details.dataset.id);
    if (activity) openGarminDetail(activity);
    return;
  }
  const button = event.target.closest('.delete');
  if (button && confirm('Delete this activity?')) {
    try { await save(activities.filter((_, index) => index !== Number(button.dataset.index))); }
    catch (error) { report(error); }
  }
};
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5000000) throw Error('File exceeds 5 MB.');
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw Error('Expected a JSON array.');
    await save([...activities, ...data]);
    $('#message').textContent = `Imported ${data.length} activities.`;
  } catch (error) { report(error); }
  event.target.value = '';
};
$('#export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(activities, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mytrainer-activities.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#sync-garmin').onclick = async event => {
  const button = event.currentTarget;
  button.disabled = true;
  $('#garmin-message').textContent = 'Connecting to Garmin and downloading activity details...';
  try {
    const response = await fetch('/api/garmin/sync', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Garmin sync failed.');
    $('#garmin-message').textContent = result.message || 'Garmin sync complete.';
    await loadGarmin();
  } catch (error) { $('#garmin-message').textContent = error.message; }
  finally { button.disabled = false; }
};
$('#close-garmin-detail').onclick = () => $('#garmin-detail').close();
$('#activity-search').oninput = renderJournal;

fetch('/api/activities').then(response => {
  if (!response.ok) throw Error('Could not load activities.');
  return response.json();
}).then(data => { activities = data; renderJournal(); }).catch(report);
loadGarmin().catch(error => { $('#garmin-message').textContent = error.message; });
