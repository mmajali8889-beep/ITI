// Daily report for the operational pilot (roadmap 30.4): health, new server
// errors and rate limiting, backup age, and who opened which records today,
// from the audit log. The pilot lead reviews it every day; exit code 1 means
// something needs attention.
//
//   node --env-file=<pilot.env> scripts/pilot-daily-report.mjs [YYYY-MM-DD]
//
// Env:
//   EHR_URL                    e.g. https://ehr.hospital.local
//   PILOT_HOSPITAL_CODE        e.g. HOSP-01
//   PILOT_AUDITOR_USERNAME     an account with the administrator or
//   PILOT_AUDITOR_PASSWORD_FILE  medical-records role (password in a file)
//   PILOT_UTC_OFFSET           local time zone, e.g. +03:00 (default +03:00)
//   PILOT_HOURS                pilot working hours, e.g. 07:30-15:30
//   PILOT_REPORT_DIR           where reports and the metrics state are kept
//   METRICS_TOKEN_FILE         optional: /api/health/metrics bearer token
//   BACKUP_DIR                 optional: to report the newest backup set
//   MAX_5XX / MAX_429          alert thresholds since the previous report (5 / 20)
//   PILOT_INSECURE_TLS         "1" only for a staging or training proxy with an internal CA
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

const need = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const EHR_URL = need('EHR_URL').replace(/\/+$/, '');
const HOSPITAL_CODE = need('PILOT_HOSPITAL_CODE');
const OFFSET = process.env.PILOT_UTC_OFFSET ?? '+03:00';
const [hoursFrom, hoursTo] = (process.env.PILOT_HOURS ?? '07:30-15:30').split('-');
const REPORT_DIR = need('PILOT_REPORT_DIR');
const MAX_5XX = Number(process.env.MAX_5XX ?? 5);
const MAX_429 = Number(process.env.MAX_429 ?? 20);
const INSECURE = process.env.PILOT_INSECURE_TLS === '1';

// The day being reported, in the hospital's time zone.
const offsetMinutes = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(OFFSET);
  if (!m) throw new Error('PILOT_UTC_OFFSET must look like +03:00');
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
})();
const localNow = new Date(Date.now() + offsetMinutes * 60_000);
const day = process.argv[2] ?? localNow.toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('date must be YYYY-MM-DD');
const dayStart = new Date(`${day}T00:00:00${OFFSET}`);
const localTime = (iso) => new Date(new Date(iso).getTime() + offsetMinutes * 60_000).toISOString().slice(11, 16);
const withinHours = (iso) => { const t = localTime(iso); return t >= hoursFrom && t < hoursTo; };

// *.localhost names are loopback; Node on Windows does not resolve them itself.
function request(method, path, { cookie, body, headers = {} } = {}) {
  const url = new URL(EHR_URL + path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      rejectUnauthorized: !INSECURE,
      ...(url.hostname.endsWith('.localhost') && {
        lookup: (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)),
      }),
      headers: {
        'content-type': 'application/json', ...headers,
        ...(cookie ? { cookie } : {}),
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let data;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
        const set = [].concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('unitech_ehr_session='));
        resolve({ status: res.statusCode, data, cookie: set?.split(';')[0] });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const attention = [];
const lines = [];
const out = (s = '') => lines.push(s);

// ---- 1. Health ----------------------------------------------------------------
const health = await request('GET', '/api/health').catch((e) => ({ status: 0, data: String(e) }));
const healthy = health.status === 200;
if (!healthy) attention.push(`Application health is ${health.status || 'unreachable'}`);

// ---- 2. Errors and rate limiting since the previous report ----------------------
mkdirSync(REPORT_DIR, { recursive: true });
let metricsLine = 'not configured (set METRICS_TOKEN_FILE)';
if (process.env.METRICS_TOKEN_FILE) {
  const token = readFileSync(process.env.METRICS_TOKEN_FILE, 'utf8').trim();
  const m = await request('GET', '/api/health/metrics', { headers: { authorization: `Bearer ${token}` } });
  const value = (name) => Number(new RegExp(`^${name} (\\d+(?:\\.\\d+)?)$`, 'm').exec(String(m.data))?.[1]);
  const now = { errors: value('ehr_http_errors_total'), limited: value('ehr_http_rate_limited_total'), throttled: value('ehr_medplum_throttled_total'), uptime: value('ehr_process_uptime_seconds') };
  if (m.status !== 200 || Object.values(now).some(Number.isNaN)) {
    metricsLine = `unavailable (HTTP ${m.status})`;
    attention.push('API metrics are unavailable');
  } else {
    const stateFile = join(REPORT_DIR, '.metrics-last.json');
    const last = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : undefined;
    writeFileSync(stateFile, JSON.stringify(now));
    if (!last) {
      metricsLine = 'first reading recorded (counts start from the next report)';
    } else {
      const base = now.uptime < last.uptime ? { errors: 0, limited: 0, throttled: 0 } : last; // API restarted
      const throttled = now.throttled - base.throttled;
      const errors = now.errors - base.errors - throttled; // Medplum throttling is answered as 503
      const limited = now.limited - base.limited;
      metricsLine = `${errors} server errors (5xx), ${limited} rate-limited (429), ${throttled} Medplum throttles since the previous report`;
      if (errors > MAX_5XX) attention.push(`${errors} server errors since the previous report`);
      if (limited + throttled > MAX_429) attention.push(`${limited + throttled} rate-limited requests since the previous report`);
    }
  }
}

// ---- 3. Backup ------------------------------------------------------------------
let backupLine = 'not checked (set BACKUP_DIR)';
if (process.env.BACKUP_DIR && existsSync(process.env.BACKUP_DIR)) {
  const sets = readdirSync(process.env.BACKUP_DIR).filter((f) => /^20\d{6}T\d{6}Z$/.test(f)).sort();
  const newest = sets.at(-1);
  if (!newest || !existsSync(join(process.env.BACKUP_DIR, newest, 'SHA256SUMS'))) {
    backupLine = 'no complete backup set';
    attention.push('No complete backup set');
  } else {
    const ageHours = Math.round((Date.now() - statSync(join(process.env.BACKUP_DIR, newest, 'SHA256SUMS')).mtimeMs) / 3_600_000);
    backupLine = `${newest} (${ageHours} h old)`;
    if (ageHours > 26) attention.push(`Newest backup is ${ageHours} h old`);
  }
}

// ---- 4. Audit: today's activity --------------------------------------------------
const hospitals = (await request('GET', '/api/hospitals')).data ?? [];
const hospital = hospitals.find((h) => h.code === HOSPITAL_CODE);
if (!hospital) throw new Error(`${HOSPITAL_CODE} not found at ${EHR_URL}`);
const login = await request('POST', '/api/auth/login', {
  body: { hospitalId: hospital.id, username: need('PILOT_AUDITOR_USERNAME'), password: readFileSync(need('PILOT_AUDITOR_PASSWORD_FILE'), 'utf8').trim() },
});
if (login.status !== 201) throw new Error(`auditor sign-in failed (HTTP ${login.status})`);
const LIMIT = 500;
const audit = await request('GET', `/api/audit/events?hospitalId=${hospital.id}&limit=${LIMIT}&since=${encodeURIComponent(dayStart.toISOString())}`, { cookie: login.cookie });
await request('POST', '/api/auth/logout', { cookie: login.cookie });
if (audit.status !== 200) throw new Error(`audit log unavailable (HTTP ${audit.status})`);
const dayEnd = dayStart.getTime() + 86_400_000;
const events = audit.data.events.filter((e) => new Date(e.recorded).getTime() < dayEnd);
const truncated = audit.data.events.length >= LIMIT;
if (truncated) attention.push(`More than ${LIMIT} audit events today; this report shows only the newest ${LIMIT}`);

const staff = events.filter((e) => e.actorId);
const users = new Map();
for (const e of staff) {
  const u = users.get(e.actorId) ?? { name: e.actorName ?? e.actorId, reads: 0, writes: 0, patients: new Set(), outside: 0 };
  if (e.action === 'R') u.reads++; else u.writes++;
  if (e.patientId) u.patients.add(e.patientId);
  if (!withinHours(e.recorded)) u.outside++;
  users.set(e.actorId, u);
}
const outside = staff.filter((e) => e.patientId && !withinHours(e.recorded));
if (outside.length) attention.push(`${outside.length} record accesses outside pilot hours`);
const failedSignIns = events.filter((e) => e.route === '/api/auth/login' && e.statusCode >= 400);
const locked = failedSignIns.filter((e) => e.statusCode === 423).length;
if (locked) attention.push(`${locked} sign-ins refused because an account is locked`);
const serverErrors = events.filter((e) => e.statusCode >= 500);
const byRoute = new Map();
for (const e of events.filter((x) => x.statusCode >= 400 && x.route !== '/api/auth/login')) {
  const key = `${e.statusCode} ${e.route.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')}`;
  byRoute.set(key, (byRoute.get(key) ?? 0) + 1);
}
const patientReaders = new Map();
for (const e of staff.filter((x) => x.patientId)) {
  patientReaders.set(e.patientId, (patientReaders.get(e.patientId) ?? new Set()).add(e.actorId));
}
const widelyOpened = [...patientReaders].filter(([, readers]) => readers.size >= 5);

// ---- Report ---------------------------------------------------------------------
out(`# تقرير التجربة التشغيلية اليومي: ${day}`);
out();
out(`${HOSPITAL_CODE} (${hospital.name}) · ساعات التجربة ${hoursFrom}–${hoursTo} (${OFFSET}) · أُنشئ ${new Date().toISOString()}`);
out();
out(`**الحالة: ${attention.length ? 'تحتاج متابعة' : 'سليم'}**`);
for (const a of attention) out(`- ${a}`);
out();
out('## التشغيل');
out();
out('| | |');
out('|---|---|');
out(`| صحة النظام | ${healthy ? 'سليم (200)' : `غير سليم (${health.status})`} |`);
out(`| الأخطاء وحد الطلبات | ${metricsLine} |`);
out(`| آخر نسخة احتياطية | ${backupLine} |`);
out();
out('## النشاط (من سجل التدقيق)');
out();
out(`- الطلبات المسجّلة: ${events.length}${truncated ? ' (مقطوع عند الحد)' : ''}`);
out(`- المستخدمون: ${users.size} · المرضى الذين فُتحت ملفاتهم: ${patientReaders.size}`);
out(`- محاولات دخول فاشلة: ${failedSignIns.length} (منها حسابات مقفلة: ${locked})`);
out(`- أخطاء خادم (5xx) في السجل: ${serverErrors.length}`);
out();
out('| المستخدم | قراءة | كتابة | مرضى | خارج الساعات |');
out('|---|---|---|---|---|');
for (const u of [...users.values()].sort((a, b) => b.reads + b.writes - (a.reads + a.writes))) {
  out(`| ${u.name} | ${u.reads} | ${u.writes} | ${u.patients.size} | ${u.outside} |`);
}
out();
if (outside.length) {
  out('## فتح ملفات خارج ساعات التجربة (للمراجعة)');
  out();
  out('| الوقت | المستخدم | المريض | المسار |');
  out('|---|---|---|---|');
  for (const e of outside.slice(0, 50)) out(`| ${localTime(e.recorded)} | ${e.actorName ?? e.actorId} | ${e.patientId} | ${e.route} |`);
  out();
}
if (widelyOpened.length) {
  out('## ملفات فتحها 5 مستخدمين أو أكثر (للمراجعة)');
  out();
  for (const [patient, readers] of widelyOpened) out(`- ${patient}: ${readers.size} مستخدمين`);
  out();
}
if (byRoute.size) {
  out('## طلبات مرفوضة أو فاشلة (حسب المسار)');
  out();
  out('| الحالة والمسار | العدد |');
  out('|---|---|');
  for (const [key, n] of [...byRoute].sort((a, b) => b[1] - a[1]).slice(0, 20)) out(`| ${key} | ${n} |`);
  out();
}
out('## ملاحظات قائد التجربة');
out();
out('| # | الملاحظة أو المشكلة | الخطورة | المسؤول | الحالة |');
out('|---|---|---|---|---|');
out('| 1 | | | | |');
out();
out('راجعه: ______________ التاريخ: ________');

const file = join(REPORT_DIR, `pilot-${day}.md`);
writeFileSync(file, lines.join('\n') + '\n');
console.log(`${attention.length ? 'ATTENTION' : 'OK'}: ${events.length} audit events, ${users.size} users, ${attention.length} items to follow up. Report: ${file}`);
process.exitCode = attention.length ? 1 : 0;
