# Aharon Search בתוך aharon-node-hub

**אין שינוי בקבצי ה־CRM, ב־`src/server.js`, ב־`package.json` המקורי או במסלולי ה־hub.** החיפוש הוא מודול מבודד תחת `apps/search`.

## פריסה באפליקציית Node הקיימת בלבד

1. המשך להשתמש באותה אפליקציית Node, באותו PORT ובאותם משתני הסביבה הקיימים של ה־hub.
2. התקן פעם אחת את תלויות החיפוש (ללא שינוי package.json המקורי):
   ```bash
   npm install --omit=dev
   npm install --prefix apps/search --omit=dev
   ```
   בעדכון עתידי של אפליקציה, יש לוודא שהתלויות בתיקיית `apps/search` נשארות מותקנות.
3. הגדר `SEARCH_ENABLED=1` ו־`SEARCH_ADMIN_TOKEN` עצמאי בעל 32 תווים ומעלה. ראה `apps/search/.env.example`. אל תשתמש בסיסמה או token של ה־CRM עבור החיפוש.
4. שנה **רק את Startup File ב־Hostinger** מ־`src/server.js` ל־`src/server-unified.js`, והפעל מחדש את אותה אפליקציה. אין להפעיל את שתי נקודות הכניסה במקביל.
5. פתח `https://YOUR-NODE-HUB-HOST/search/`. הממשק, API והקבצים הם מתחת `/search`, וה־WebSocket, ה־MCP והמסלולים `/v1` נותרים באותו שרת.
6. בדוק עם token: `GET /search/api/health`. `GET /health` המקורי נשאר ללא שינוי.

### CRM והדומיין crm.ivrphone.org

על פי התיעוד הקיים של ה־hub, ה־CRM פועל ב־PHP וה־hub הוא אפליקציית Node נפרדת. הפריסה לעיל אינה משנה את ה־CRM ואינה מקימה אפליקציית Node נוספת. כדי לפתוח `crm.ivrphone.org/search/` **דווקא** תחת דומיין ה־CRM, צריך להגדיר בשרת/פרוקסי ניתוב נתיב `/search/*` ל־hub הקיים; עצם הוספת הקוד למאגר אינה משנה ניתוב DNS/Hostinger או פורסת את הקוד לאתר החי.

### יכולות ומגבלות

- אותו מנוע חיפוש, UI ודוח AI מהמאגר `Aharon-Search`, עם חיבור מבודד ועם token ייעודי.
- GitHub ו־Reddit: ספקים ישירים ללא מפתח בתנאים הרלוונטיים. YouTube/X/Instagram: נדרש להגדיר credentials; ללא מפתח המקור מוצג כלא מוגדר.
- WhatsApp ומאגר MySQL כבויים כברירת מחדל, ותיקיות session/נתוני מאגר אינן בקוד הציבורי. לפני הפעלת המאגר ודא הרשאות שימוש ואבטחת גישה.
- TikTok worker ו־Social Analyzer/PhoneInfoga הם adapters מוכנים, **לא** התקנה או פריסה של תהליכי scraping נוספים. סביבת Node מנוהלת אינה מריצה אוטומטית workers ב־Python/Go.
- זהו חיבור של קוד החיפוש שכבר קיים; הוא לא טוען שגירוד לא־רשמי מכל הרשתות כבר פועל בפועל.

### חזרה לגרסה הקיימת

כבה `SEARCH_ENABLED` או החזר את Startup File ל־`src/server.js`. קוד ה־CRM וה־hub המקורי לא הוחלף.
