const SHEET_ID = "1ZhgTDu1CzTR7NClICps8FHvMVN0Vg2nT_82bGecXM-g";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let viewMonth, viewYear;
let requests = [];
let unscheduledRequests = [];
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

// Fallback parser for relative phrases like "today", "tomorrow", "this week", "ASAP",
// used when no explicit month+day is found anywhere in the submitted text.
// Anchored to the submission date, not "today" the viewer is loading the page on,
// so a request submitted last week that said "today" still resolves to the day it was submitted.
function parseRelativeDate(text, submittedDate){
  if(!text) return null;
  const t = text.toLowerCase();
  const base = new Date(submittedDate);
  base.setHours(0,0,0,0);

  if(/\basap\b/.test(t)) return new Date(base);
  if(/\btoday\b/.test(t)) return new Date(base);
  if(/\btomorrow\b/.test(t)) return addDays(base, 1);
  if(/\bnext week\b/.test(t)) return addDays(base, 7);
  if(/\bthis week\b/.test(t)) return addDays(base, 2);

  const inDaysMatch = t.match(/in\s+(\d+)\s+days?/);
  if(inDaysMatch) return addDays(base, parseInt(inDaysMatch[1], 10));

  return null;
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

// ---- Recurring weekly posts (fixed schedule, not from the request form) ----
// dayOfWeek: 0 = Sunday ... 6 = Saturday
const RECURRING_POSTS = [
  { dayOfWeek: 1, label: "Housing Market Tracker video (Logan)", platforms: "IG, FB, X, LinkedIn, TikTok" }
];

// Project names to hide from the calendar and Request Pipeline cards, without touching the
// Google Sheet itself. Use this when a plan is being reworked and the old milestones would
// otherwise clutter the dashboard with deadlines that no longer reflect the real plan.
// Matches case-insensitively against the project name's leading text (trimmed).
const HIDDEN_FROM_DASHBOARD = [
  "Housing Economic Summit"
];

function isHiddenFromDashboard(projectName){
  const name = (projectName || "").trim().toLowerCase();
  return HIDDEN_FROM_DASHBOARD.some(h => name.startsWith(h.trim().toLowerCase()));
}

function getRecurringPostsForToday(){
  const dow = today.getDay();
  return RECURRING_POSTS.filter(p => p.dayOfWeek === dow);
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
    le