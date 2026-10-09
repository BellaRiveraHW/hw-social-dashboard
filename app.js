const SHEET_ID = "1ZhgTDu1CzTR7NClICps8FHvMVN0Vg2nT_82bGecXM-g";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let viewMonth, viewYear;
let requests = [];
const today = new Date();
today.setHours(0,0,0,0);

function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

function addDays(date, n){
  const d = new Date(date);
  d.setDate(d.getDate()+n);
  return d;
}

function isWeekend(d){
  const day = d.getDay();
  return day === 0 || day === 6;
}

// Step backward from targetDate by n calendar days, then if it lands on a weekend,
// pull it back further to the prior Friday (so the deadline is never later than needed).
function subtractDaysAvoidWeekend(targetDate, n){
  let d = addDays(targetDate, -n);
  while(isWeekend(d)){
    d = addDays(d, -1);
  }
  return d;
}

// Add n business days (skipping Sat/Sun) to startDate
function addBusinessDays(startDate, n){
  let d = new Date(startDate);
  let count = 0;
  while(count < n){
    d = addDays(d, 1);
    if(!isWeekend(d)) count++;
  }
  return d;
}

function fmtDate(d){
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}
function fmtShort(d){
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}
function dateKey(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Month name/abbreviation lookup (handles "Nov.", "Dec", "Jan", etc. as used in free-text form responses)
const MONTH_MAP = {
  'january':0,'jan':0,
  'february':1,'feb':1,
  'march':2,'mar':2,
  'april':3,'apr':3,
  'may':4,
  'june':5,'jun':5,
  'july':6,'jul':6,
  'august':7,'aug':7,
  'september':8,'sep':8,'sept':8,
  'october':9,'oct':9,
  'november':10,'nov':10,
  'december':11,'dec':11
};
const MONTH_PATTERN_NAMES = Object.keys(MONTH_MAP).sort((a,b) => b.length - a.length);
const MONTH_REGEX_SOURCE = `(${MONTH_PATTERN_NAMES.join('|')})\\.?\\s+(\\d{1,2})(st|nd|rd|th)?`;

// Parse a free-text date string like "Monday October 12th post date" or "Nov. 23rd" into a Date for a given reference year
function extractDate(text, refYear){
  if(!text) return null;
  const re = new RegExp(MONTH_REGEX_SOURCE, 'i');
  const m = text.match(re);
  if(!m) return null;
  const monthIdx = MONTH_MAP[m[1].toLowerCase()];
  const day = parseInt(m[2],10);
  let year = refYear;
  // crude year rollover: if month is well before the submission month, assume next year
  return new Date(year, monthIdx, day);
}

function buildSLA(postDate){
  const draft1 = subtractDaysAvoidWeekend(postDate, 7);
  const sprout = subtractDaysAvoidWeekend(postDate, 2);
  // Approval window runs forward from draft1 (time to review/revise),
  // but can never land after the Sprout scheduling deadline.
  let approval = addBusinessDays(draft1, 3);
  if(approval > sprout) approval = sprout;
  return { draft1, approval, sprout, postDate };
}

async function loadData(){
  try{
    const res = await fetch(CSV_URL, {cache:"no-store"});
    if(!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    const header = rows[0];
    const dataRows = rows.slice(1).filter(r => r.some(c => c && c.trim().length));

    const idx = (name) => header.findIndex(h => h.trim() === name);
    const iTimestamp = 0;
    const iEmail = 1;
    const iProjectName2 = idx("Project Name") >= 0 ? header.lastIndexOf("Project Name") : -1;
    // There are two "Project Name" columns (old + new form); use the second occurrence
    let projectNameIdx = -1;
    header.forEach((h,i) => { if(h.trim() === "Project Name") projectNameIdx = i; });
    let briefIdx = header.findIndex(h => h.trim().startsWith("Brief description"));
    let contentTypeIdx = -1;
    header.forEach((h,i) => { if(h.trim() === "What kind of content is this for?") contentTypeIdx = i; });
    let campaignTypeIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Is this a one-time post")) campaignTypeIdx = i; });
    let campaignTimelineIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("If campaign, what is the timeframe")) campaignTimelineIdx = i; });
    let platformsIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Do you have specific social platforms")) platformsIdx = i; });
    let copyIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Design copy/verbiage")) copyIdx = i; });
    let captionIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Do you have caption copy")) captionIdx = i; });
    let linkIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Please provide the link you want this post")) linkIdx = i; });
    let tagIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Is there anyone/any company")) tagIdx = i; });
    let postDateIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Desired Post Date")) postDateIdx = i; });
    let hardDeadlineIdx = -1;
    header.forEach((h,i) => { if(h.trim() === "Is this a hard deadline?") hardDeadlineIdx = i; });
    let meetingIdx = header.findIndex(h => h.trim().startsWith("Would you like to schedule"));
    let additionalIdx = header.findIndex(h => h.trim() === "Additional Information");
    let examplesIdx = -1;
    header.forEach((h,i) => { if(h.trim().startsWith("Examples & Inspiration") || h.trim().startsWith("Please provide a link to other graphic assets")) { if(examplesIdx === -1) examplesIdx = i; } });

    requests = dataRows.map(r => {
      const timestamp = r[iTimestamp];
      const submittedDate = new Date(timestamp);
      const refYear = isNaN(submittedDate.getFullYear()) ? today.getFullYear() : submittedDate.getFullYear();

      const projectName = r[projectNameIdx] || "(untitled project)";
      const brief = r[briefIdx] || "";
      const contentType = r[contentTypeIdx] || "";
      const campaignType = r[campaignTypeIdx] || "";
      const campaignTimeline = r[campaignTimelineIdx] || "";
      const platforms = r[platformsIdx] || "";
      const copyNeeded = r[copyIdx] || "";
      const captionCopy = r[captionIdx] || "";
      const link = r[linkIdx] || "";
      const tag = r[tagIdx] || "";
      const postDateText = r[postDateIdx] || "";
      const hardDeadline = r[hardDeadlineIdx] || "";
      const meeting = r[meetingIdx] || "";
      const additional = r[additionalIdx] || "";
      const examples = r[examplesIdx] || "";
      const email = r[iEmail] || "";

      // Extract one or more post dates from campaignTimeline or postDateText
      const sourceText = campaignTimeline || postDateText;
      const allDatesFound = [];
      const reAll = new RegExp(MONTH_REGEX_SOURCE, 'gi');
      let match;
      while((match = reAll.exec(sourceText)) !== null){
        const monthIdx = MONTH_MAP[match[1].toLowerCase()];
        const day = parseInt(match[2],10);
        let year = refYear;
        // if this month is earlier than the submission month by a lot, could be next year; simple heuristic
        if(monthIdx < submittedDate.getMonth() - 2) year += 1;
        allDatesFound.push(new Date(year, monthIdx, day));
      }
      if(allDatesFound.length === 0){
        const single = extractDate(postDateText, refYear) || extractDate(campaignTimeline, refYear);
        if(single) allDatesFound.push(single);
      }

      const milestones = allDatesFound.map((pd, i) => ({
        label: allDatesFound.length > 1 ? `Post ${i+1}` : "Post",
        ...buildSLA(pd)
      }));

      return {
        projectName, brief, contentType, campaignType, campaignTimeline, platforms,
        copyNeeded, captionCopy, link, tag, postDateText, hardDeadline, meeting,
        additional, examples, email, submittedDate, milestones
      };
    }).filter(r => r.milestones.length > 0);

    render();
  } catch(err){
    document.getElementById('loadingState').style.display = 'none';
    const errBox = document.getElementById('errorState');
    errBox.style.display = 'block';
    errBox.textContent = "Could not load live data from the Google Sheet. " + err.message + " Make sure the sheet is shared as \"Anyone with the link\" can view, then reload this page.";
    document.getElementById('appContent').style.display = 'block';
  }
}

function statusForMilestone(m){
  if(today > m.postDate) return {label:"Past", cls:"pill-gray"};
  if(today > m.sprout) return {label:"Overdue — schedule now", cls:"pill-red"};
  if(today > m.draft1) return {label:"RUSH — past 1st draft SLA", cls:"pill-red"};
  if(today >= m.draft1) return {label:"Draft due now", cls:"pill-amber"};
  const daysOut = Math.round((m.draft1 - today)/86400000);
  return {label:`On track — draft due in ${daysOut}d`, cls:"pill-green"};
}

function render(){
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('appContent').style.display = 'block';
  document.getElementById('todayDateLabel').textContent = fmtDate(today);
  document.getElementById('todoDateLabel').textContent = "— " + today.toLocaleDateString('en-US', {weekday:'long', month:'short', day:'numeric'});

  renderTodos();

  viewMonth = today.getMonth();
  viewYear = today.getFullYear();
  renderCalendar();

  renderRequestCards();
}

function renderTodos(){
  const list = document.getElementById('dueTodayList');
  list.innerHTML = '';
  let count = 0;

  requests.forEach(req => {
    req.milestones.forEach(m => {
      const checks = [
        {date:m.draft1, label:`Write 1st draft — ${req.projectName}`, meta:`${req.platforms || 'Platforms TBD'} · posts ${fmtShort(m.postDate)}`},
        {date:m.approval, label:`Get approval — ${req.projectName}`, meta:`Approval checkpoint before Sprout scheduling`},
        {date:m.sprout, label:`Schedule in Sprout — ${req.projectName}`, meta:`Must go live by ${fmtShort(m.postDate)}`},
      ];
      checks.forEach(c => {
        if(dateKey(c.date) === dateKey(today)){
          count++;
          const li = document.createElement('li');
          li.innerHTML = `<span class="checkbox"></span><div class="todo-text"><strong>${c.label}</strong><span class="todo-meta">${c.meta}</span></div><span class="pill pill-red">Due today</span>`;
          list.appendChild(li);
        }
      });
    });
  });

  if(count === 0){
    list.innerHTML = '<li><span class="checkbox"></span><div class="todo-text"><strong>No pipeline deadlines today</strong><span class="todo-meta">Nothing from the request form is due today. Check the calendar below for what is coming up.</span></div><span class="pill pill-green">Clear</span></li>';
  }
  document.getElementById('dueTodayCount').textContent = `${count} item${count===1?'':'s'}`;
}

function shiftMonth(delta){
  viewMonth += delta;
  if(viewMonth < 0){ viewMonth = 11; viewYear--; }
  if(viewMonth > 11){ viewMonth = 0; viewYear++; }
  renderCalendar();
}

function renderCalendar(){
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const label = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {month:'long', year:'numeric'});
  document.getElementById('calMonthLabel').textContent = label;

  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dows.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(viewYear, viewMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();

  // build map of date -> tags
  const tagMap = {};
  function addTag(date, text, cls){
    const key = dateKey(date);
    if(!tagMap[key]) tagMap[key] = [];
    tagMap[key].push({text, cls});
  }
  requests.forEach(req => {
    req.milestones.forEach(m => {
      addTag(m.draft1, `${req.projectName.slice(0,18)}: 1st draft due`, 'tag-draft1');
      addTag(m.approval, `${req.projectName.slice(0,18)}: approval due`, 'tag-draft2');
      addTag(m.sprout, `${req.projectName.slice(0,18)}: schedule in Sprout`, 'tag-sprout');
      addTag(m.postDate, `POST: ${req.projectName.slice(0,18)}`, 'tag-post');
    });
  });

  for(let i=0;i<startOffset;i++){
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }
  for(let day=1; day<=daysInMonth; day++){
    const cellDate = new Date(viewYear, viewMonth, day);
    const cell = document.createElement('div');
    let cls = 'cal-cell';
    if(isWeekend(cellDate)) cls += ' weekend';
    if(dateKey(cellDate) === dateKey(today)) cls += ' today';
    cell.className = cls;
    const num = document.createElement('div');
    num.className = 'cal-daynum';
    num.textContent = day;
    cell.appendChild(num);
    const tags = tagMap[dateKey(cellDate)] || [];
    tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'cal-tag ' + t.cls;
      span.textContent = t.text;
      cell.appendChild(span);
    });
    grid.appendChild(cell);
  }
}

function renderRequestCards(){
  const container = document.getElementById('requestCards');
  container.innerHTML = '';
  if(requests.length === 0){
    container.innerHTML = '<p class="empty-note">No open requests found in the sheet right now.</p>';
    return;
  }
  requests.forEach(req => {
    const card = document.createElement('div');
    card.className = 'req-card';

    const overallStatus = statusForMilestone(req.milestones[0]);

    let slaChips = '';
    req.milestones.forEach(m => {
      slaChips += `
        <div class="sla-chip tag-draft1"><b>${m.label} — 1st draft due</b>${fmtDate(m.draft1)}</div>
        <div class="sla-chip tag-draft2"><b>${m.label} — Approval due</b>${fmtDate(m.approval)}</div>
        <div class="sla-chip tag-sprout"><b>${m.label} — Schedule in Sprout by</b>${fmtDate(m.sprout)}</div>
        <div class="sla-chip tag-post"><b>${m.label} — Target post date</b>${fmtDate(m.postDate)}</div>
      `;
    });

    card.innerHTML = `
      <div class="req-header">
        <div>
          <div class="req-title">${req.projectName}</div>
          <div class="req-sub">Submitted ${req.submittedDate.toLocaleDateString('en-US')} by ${req.email || 'unknown'} &middot; ${req.contentType || 'Content type n/a'} &middot; ${req.campaignType || 'n/a'}</div>
        </div>
        <span class="pill ${overallStatus.cls}">${overallStatus.label}</span>
      </div>
      <div class="sla-strip">${slaChips}</div>
      <div class="req-fields">
        <div class="field"><b>Platforms requested</b>${req.platforms || 'Not specified'}</div>
        <div class="field"><b>Hard deadline</b>${req.hardDeadline || 'Not specified'}</div>
        <div class="field"><b>Tag/collaborate</b>${req.tag || 'None'}</div>
        <div class="field"><b>Meeting requested</b>${req.meeting || 'No'}</div>
        <div class="field field-full"><b>Brief / description</b>${req.brief || 'None provided'}</div>
        <div class="field field-full"><b>Copy/verbiage needed on graphic</b>${req.copyNeeded || 'None supplied'}</div>
        <div class="field field-full"><b>Caption copy supplied</b>${req.captionCopy || 'None provided — write from brief'}</div>
        <div class="field field-full"><b>Destination link</b>${req.link ? `<a href="${req.link}" target="_blank">${req.link}</a>` : 'None provided'}</div>
        <div class="field field-full"><b>Assets/examples</b>${req.examples || 'None uploaded'}</div>
        ${req.additional ? `<div class="field field-full"><b>Additional info</b>${req.additional}</div>` : ''}
      </div>
    `;
    container.appendChild(card);
  });
}

loadData();