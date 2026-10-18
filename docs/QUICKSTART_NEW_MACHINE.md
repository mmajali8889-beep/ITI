# تشغيل UNITECH-EHR على جهاز جديد من GitHub

دليل سريع خطوة بخطوة لتشغيل النظام كاملاً بـ Docker على جهاز جديد: Medplum، والـ API، وواجهة الويب، وOrthanc للأشعة. الخطوات مأخوذة من [`DEPLOYMENT_ON_PREMISE.md`](DEPLOYMENT_ON_PREMISE.md)، وهو المرجع الكامل للأمان والنسخ الاحتياطي والمراقبة.

> **مهم:** هذا الدليل لجهاز تجربة أو تدريب أو عرض. قبل التشغيل الفعلي في المستشفى طبّق `DEPLOYMENT_ON_PREMISE.md` كاملاً: الشهادة الرسمية، والجدار الناري، والنسخ الاحتياطي، والمراقبة.

---

## 1. المتطلبات

| البرنامج | ملاحظة |
|---|---|
| **Git** | على Windows ثبّت Git for Windows، فهو يضم **Git Bash** الذي نشغّل منه السكربتات `.sh` |
| **Docker** | Docker Desktop على Windows وmacOS، أو Docker Engine مع إضافة Compose على Linux |
| **Node.js 20 أو أحدث** | لسكربتات إنشاء المستشفيات والبيانات التدريبية |
| **GitHub CLI** (`gh`) | اختياري: إذا كان المستودع خاصاً |

العتاد المقترح: ذاكرة 8 GB على الأقل (16 GB أفضل)، و20 GB مساحة فارغة.

تأكد أن كل شيء يعمل:

```bash
git --version
```

```bash
docker compose version
```

```bash
node --version
```

> **على Windows:** شغّل كل الأوامر في هذا الدليل من **Git Bash**، وقبلها نفّذ مرة في كل نافذة:
>
> ```bash
> export MSYS_NO_PATHCONV=1
> ```
>
> وأضف `-f docker-compose.yml -f docker-compose.desktop.yml` لكل أمر `docker compose`، لأن Docker Desktop لا يدعم journald. الأوامر أدناه مكتوبة بهذه الصيغة، وعلى خادم Linux يكفي `docker compose ...` وحده.

---

## 2. تنزيل المشروع من GitHub

إذا كان المستودع خاصاً، سجّل الدخول أولاً:

```bash
gh auth login
```

ثم نزّل المشروع:

```bash
git clone https://github.com/mmajali8889-beep/ITI.git unitech-ehr
```

```bash
cd unitech-ehr
```

الفرع الافتراضي هو `main`، وهو آخر نسخة مدموجة. ملف `.gitattributes` يحفظ نهايات الأسطر LF لملفات `.sh` وCaddyfile وDockerfile و`.yml`، فتعمل كما هي على Windows.

---

## 3. تشغيل Medplum (قاعدة البيانات وخادم FHIR)

```bash
cd infrastructure/production/medplum
cp .env.example .env
./generate-secrets.sh
docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d
docker compose -f docker-compose.yml -f docker-compose.desktop.yml ps
```

انتظر حتى تظهر حالة `medplum-server` بـ **healthy** (قد يستغرق ذلك دقيقة أو اثنتين في أول تشغيل).

### 3.1 إنشاء ClientApplication للـ API

1. شغّل تطبيق إدارة Medplum:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.desktop.yml --profile admin up -d medplum-app
   ```

2. افتح `http://localhost:3000` وسجّل الدخول بـ:
   - البريد: `admin@example.com`
   - كلمة المرور: محتوى الملف `infrastructure/production/medplum/secrets/admin_password`
3. **غيّر كلمة المرور فوراً.** هذا الحساب نفسه هو حساب الـ provisioning الذي يستعمله النظام لإنشاء حسابات الموظفين وحسابات بوابة المرضى، فاحفظ كلمة المرور الجديدة في مكان آمن.
4. من **Project Admin ← Clients** أنشئ ClientApplication جديداً، واحفظ:
   - **Client ID**
   - **Client Secret** (لا تضعه في أي ملف داخل git)
5. احذف ملف كلمة المرور الأولية:

   ```bash
   rm secrets/admin_password
   ```

اترك تطبيق الإدارة يعمل الآن، وأوقفه بعد الخطوة 4.

---

## 4. إنشاء المستشفيات والأقسام

```bash
cd ../../../scripts
cp .env.example .env
```

افتح `scripts/.env` واملأ:

```
MEDPLUM_BASE_URL=http://localhost:8103/
MEDPLUM_CLIENT_ID=<Client ID من الخطوة 3.1>
MEDPLUM_CLIENT_SECRET=<Client Secret من الخطوة 3.1>
```

ثم:

```bash
npm install
node create-org.mjs
node create-test-hospitals.mjs
```

- `create-org.mjs` ينشئ المجموعة الصحية، والمستشفيين HOSP-A وHOSP-B، والأقسام والمواقع.
- `create-test-hospitals.mjs` ينشئ مستشفيات الاختبار HOSP-01 حتى HOSP-03، وهي التي تستعملها البيانات التدريبية.

أوقف تطبيق إدارة Medplum:

```bash
cd ../infrastructure/production/medplum
docker compose -f docker-compose.yml -f docker-compose.desktop.yml --profile admin stop medplum-app
```

---

## 5. تشغيل النظام (API والواجهة وOrthanc)

```bash
cd ..
cp .env.example .env
```

افتح `infrastructure/production/.env` وعدّل:

```
EHR_HOSTNAME=ehr.localhost
EHR_TLS=tls internal
HOSPITAL_CURRENCY=JOD
ENABLED_HOSPITAL_CODES=HOSP-01
MEDPLUM_BASE_URL=http://medplum-server:8103/
MEDPLUM_CLIENT_ID=<Client ID من الخطوة 3.1>
MEDPLUM_PROVISIONING_EMAIL=admin@example.com
```

- `ehr.localhost` يعمل على نفس الجهاز دون أي إعداد DNS. لتشغيله على شبكة المستشفى استعمل اسماً يعرّفه قسم IT، مثل `ehr.hospital.local`.
- إذا كان المنفذ 443 أو 80 مستعملاً، أضف `HTTPS_PORT=8443` و`HTTP_PORT=8080`، ويصبح العنوان `https://ehr.localhost:8443`.
- `ENABLED_HOSPITAL_CODES` هي المستشفيات التي تظهر في شاشة الدخول (مثلاً `HOSP-01,HOSP-A`).

أنشئ الأسرار. سيطلب السكربت **Client Secret** و**كلمة مرور provisioning** (كلمة مرور `admin@example.com` الجديدة من الخطوة 3.1):

```bash
./generate-secrets.sh
```

ثم شغّل:

```bash
docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.desktop.yml ps
```

البناء الأول يأخذ عدة دقائق. انتظر حتى تظهر حالة `api` بـ **healthy**. إذا لم تظهر، راجع السجل:

```bash
docker compose -f docker-compose.yml -f docker-compose.desktop.yml logs -f api
```

الـ API **يرفض الإقلاع** إذا كان إعداد مهم ناقصاً أو غير آمن، ويذكر في السجل كل المشاكل دفعة واحدة.

---

## 6. التحقق

```bash
curl -k https://ehr.localhost/api/health
```

النتيجة المتوقعة: `{"status":"ok", ...}` مع Medplum وOrthanc بحالة `ok`.

افتح `https://ehr.localhost` في المتصفح. مع `tls internal` سيظهر تحذير شهادة، لأن Caddy أصدر الشهادة من شهادته الجذرية الخاصة. للتخلص من التحذير ثبّت تلك الشهادة الجذرية على الجهاز:

```bash
docker compose -f docker-compose.yml -f docker-compose.desktop.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

ثم على Windows: انقر نقراً مزدوجاً على `caddy-root.crt` ← Install Certificate ← Local Machine ← "Trusted Root Certification Authorities".

---

## 7. أول الحسابات والبيانات التدريبية (اختياري، لجهاز تدريب أو عرض)

هذه الخطوة تنشئ 15 حساباً تدريبياً (`train.*`) لكل الأدوار، و8 مرضى بأسماء وهمية في HOSP-01. **لا تشغّلها أبداً على بيئة الإنتاج.**

```bash
cd ../../services/hospital-api
npm install
```

أنشئ ملفاً **خارج المستودع**، مثلاً `../../../seed.env`، فيه:

```
TRAINING_API_URL=https://ehr.localhost
TRAINING_HOSPITAL_CODE=HOSP-01
TRAINING_ACCOUNTS_FILE=../../../training-accounts.md
TRAINING_INSECURE_TLS=1
MEDPLUM_BASE_URL=http://localhost:8103/
MEDPLUM_CLIENT_ID=<Client ID>
MEDPLUM_CLIENT_SECRET=<Client Secret>
MEDPLUM_PROVISIONING_EMAIL=admin@example.com
MEDPLUM_PROVISIONING_PASSWORD=<كلمة مرور admin@example.com>
```

(إذا غيّرت `HTTPS_PORT` أضف المنفذ إلى `TRAINING_API_URL`.)

```bash
node --env-file=../../../seed.env scripts/seed-training.mjs --training-environment
```

ورقة الحسابات وكلمة المرور المشتركة تُكتب في `TRAINING_ACCOUNTS_FILE`. أعطها للمدرّبين فقط. أدلة كل دور موجودة في [`docs/training/`](training/).

### 7.1 رحلة مريض تجريبية كاملة (اختياري)

لإنشاء رحلة محمد سميح الكاملة، من الاستقبال حتى الفاتورة، كما في [دليل المستخدم](user-manual/README.md)، أضف إلى `seed.env`:

```
DEMO_ORTHANC_CONTAINER=unitech-ehr-orthanc-1
DEMO_ORTHANC_PASSWORD_FILE=../../infrastructure/production/secrets/orthanc_password
```

ثم:

```bash
node --env-file=../../../seed.env scripts/demo-journey.mjs --training-environment
```

ينتهي السكربت برمز 1 إذا لم تكتمل الرحلة 100% أو لم تُدفع الفاتورة.

> **للتشغيل الفعلي:** حسابات `train.*` للتدريب فقط. على خادم المستشفى تُنشأ حسابات الموظفين الحقيقية من شاشة **الإدارة**، وتُحذف بيانات التدريب أو يُستعمل خادم منفصل لها (القسم 9 من `DEPLOYMENT_ON_PREMISE.md`).

---

## 8. التشغيل اليومي

نفّذ هذه الأوامر من `infrastructure/production` (ولـ Medplum من `infrastructure/production/medplum`).

| المهمة | الأمر |
|---|---|
| الإيقاف | `docker compose -f docker-compose.yml -f docker-compose.desktop.yml stop` |
| التشغيل مرة أخرى | `docker compose -f docker-compose.yml -f docker-compose.desktop.yml start` |
| الحالة | `docker compose -f docker-compose.yml -f docker-compose.desktop.yml ps` |
| سجل الـ API | `docker compose -f docker-compose.yml -f docker-compose.desktop.yml logs -f api` |

شغّل Medplum قبل النظام، وأوقفه بعده.

### التحديث إلى آخر نسخة من GitHub

```bash
git pull origin main
cd infrastructure/production
docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d --build
```

البيانات محفوظة في Docker volumes، فلا يحذفها التحديث ولا إعادة البناء. **لا تستعمل** `docker compose down -v`، لأنه يحذف قاعدة البيانات.

---

## 9. مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `api` لا يصل إلى healthy | `logs api`: غالباً Client ID أو Secret خاطئ، أو Medplum لم يكتمل تشغيله بعد |
| `port is already allocated` | غيّر `HTTPS_PORT` و`HTTP_PORT` و`ORTHANC_DICOM_BIND` في `.env` |
| السكربتات `.sh` تفشل على Windows | شغّلها من Git Bash بعد `export MSYS_NO_PATHCONV=1` |
| `journald` غير مدعوم | أضف `-f docker-compose.desktop.yml` للأمر |
| المستشفى لا يظهر في شاشة الدخول | أضف رمزه إلى `ENABLED_HOSPITAL_CODES` ثم `up -d` |
| خطأ 429 عند تسجيل الدخول المتكرر | حد Medplum لتسجيل الدخول: انتظر دقيقة ثم أعد المحاولة |
