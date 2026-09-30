# MY GAME LAUNCHER

منصة ألعاب HTML5 خاصة: Node.js + Express + SQLite (قاعدة بيانات حقيقية).

## 1) التشغيل محليًا
```bash
npm install
cp .env.example .env      # ثم عدّل القيم
npm run create-admin      # ينشئ حساب Admin (انظر الخطوة 2)
npm start                 # http://localhost:3000
```
يتطلب Node.js 18 أو أحدث.

## 2) إنشاء حساب Admin
1. في ملف `.env` اكتب `ADMIN_USERNAME` و`ADMIN_EMAIL` و`ADMIN_PASSWORD` (10 أحرف على الأقل).
2. شغّل `npm run create-admin`.
3. احذف `ADMIN_PASSWORD` من `.env`.
4. سجّل الدخول من الموقع ← تظهر "Admin Dashboard" في قائمة حسابك (أو افتح `/admin/`).
كلمة المرور تُخزَّن كـ bcrypt hash فقط، ولا توجد أي كلمة مرور داخل الواجهة.

## 3) إضافة أول لعبة
Admin Dashboard ← Add Game ← اكتب الاسم والوصف والتصنيف ← ارفع Thumbnail ← ارفع ملف zip للعبة أو ضع Game URL ← **PUBLISH GAME**.
تظهر اللعبة فورًا في Home وGames. زر Unpublish يخفيها دون حذفها.

## 4) رفع ألعاب HTML5
- اضغط مجلد اللعبة في ملف `.zip` بحيث يكون `index.html` في الجذر (أو داخل مجلد واحد فقط).
- استخدم مسارات نسبية داخل اللعبة (`./game.js` وليس `/game.js`).
- الحد الأقصى للحجم: `MAX_GAME_MB` (الافتراضي 100).
- تُرفض الملفات التنفيذية/الخادمية (php, exe, sh, py…) ويُحمى الاستخراج من zip-slip.
- بديل: ضع Game URL (https) لعبة مستضافة في مكان آخر.

## 5) النشر على الإنترنت
المشروع يحتاج خادم Node مع **قرص دائم** (لأن قاعدة البيانات والألعاب المرفوعة ملفات):
- **Railway / Render / Fly.io**: اربط مستودع GitHub، أمر التشغيل `npm start`، أضف Volume/Disk ووجّه `DATA_DIR` إليه (مثل `/data`)، واضبط `NODE_ENV=production`.
- **VPS**: ثبّت Node، شغّل `npm start` عبر `pm2`، وضع Nginx أو Caddy أمامه مع HTTPS.
لا تنشر على استضافة serverless (مثل Vercel) لأن الملفات لن تُحفظ.
بعد النشر نفّذ `npm run create-admin` مرة واحدة على الخادم.

## 6) متغيرات البيئة
في ملف `.env` بجذر المشروع محليًا، وفي لوحة الاستضافة (Environment Variables) عند النشر. القيم موضحة في `.env.example`. لا ترفع `.env` على GitHub.

## هيكل المشروع
```
server.js        API + الجلسات + الحماية + رفع الألعاب
db.js            جداول قاعدة البيانات
scripts/         create-admin.js
public/          الموقع (Home, Games, صفحة اللعبة, Login)
views/admin/     لوحة Admin (لا تُقدَّم إلا لـ admin من الخادم)
data/            (يُنشأ تلقائيًا) app.db, games/, thumbs/
```

## الأمان المطبّق
صلاحيات على الخادم لكل مسار Admin، bcrypt، جلسات بـ token عشوائي مُشفَّر في قاعدة البيانات وكوكي HttpOnly/SameSite، فحص Origin ضد CSRF، Rate limit على الدخول، Helmet وCSP، التحقق من نوع وحجم الملفات، وتشغيل الألعاب لا يتم إلا للمسجّلين.
ملاحظة: الألعاب المرفوعة تعمل من نفس النطاق، فارفع ألعابك أنت فقط.
