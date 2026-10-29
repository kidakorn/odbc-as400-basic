# odbc-as400-basic

REST API แบบอ่านอย่างเดียว (GET + SELECT) สำหรับดึงข้อมูลจาก IBM i (AS400) ผ่าน ODBC
รูปแบบ response เหมือน IBM i Integrated Web Services (IWS) เพื่อให้ client เดิมเปลี่ยนมาใช้ได้โดยไม่ต้องแก้

- Node.js 20, 22 หรือ 24 (CommonJS, ไม่มี build step)
- Express 4 + package `odbc` (native module)
- ใช้ `.env` ชุดเดิมจากโปรเจ็ค `odbc_as400` ได้เลย (ชื่อ ค่า default และความหมายเหมือนเดิม)

## สิ่งที่ต้องมี

- IBM i Access ODBC Driver
  - Windows: ติดตั้ง IBM i Access Client Solutions แล้วเปิด **ODBC Data Source Administrator (64-bit)** ดูแท็บ Drivers ว่ามี `IBM i Access ODBC Driver` ใช้ตัว 64-bit เพราะ Node.js เป็น 64-bit
  - Linux: ติดตั้ง unixODBC, unixODBC development files, ชุด compiler C++ และ driver ของ IBM แล้วลงทะเบียนใน `odbcinst.ini` (ชื่อ section ต้องตรงกับ `DB_DRIVER`)

```bash
# Debian / Ubuntu
sudo apt install unixodbc unixodbc-dev build-essential python3
```

## เริ่มใช้งาน

```bash
npm install
npm rebuild odbc        # เฉพาะกรณีที่ npm ไม่ได้ build native module ให้
cp .env.example .env    # Windows: copy .env.example .env
```

แก้ `.env` ใส่ `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_LIBRARY` (4 ตัวนี้จำเป็น ถ้าขาดหรือผิดรูปแบบ server จะบอกทุกข้อที่ผิดแล้วปิดตัว)

```bash
npm start       # รันจริง
npm run dev     # nodemon, restart เมื่อไฟล์เปลี่ยน
npm test        # unit test ทั้งหมด ไม่ต้องมี AS400 และไม่ต้อง build odbc
```

ตอนเริ่ม server จะเปิด connection ไปที่ IBM i แล้วรัน `SELECT 1 FROM SYSIBM.SYSDUMMY1` ก่อนเปิดรับ request ถ้า DB ผิด server จะล้มตั้งแต่ตอนบูต ไม่ใช่ตอน request แรก
**ห้าม commit ไฟล์ `.env`** (มี password จริง) ให้ commit เฉพาะ `.env.example`

## ตัวแปรใน .env

| ตัวแปร | Default | ความหมาย |
|--------|---------|----------|
| `DB_HOST` | (จำเป็น) | ชื่อหรือ IP ของ IBM i |
| `DB_USER` | (จำเป็น) | user ควรมีสิทธิ์อ่านอย่างเดียว |
| `DB_PASSWORD` | (จำเป็น) | อักขระ `}` ใน password ถูก escape ให้อัตโนมัติ |
| `DB_LIBRARY` | (จำเป็น) | library เริ่มต้น 1-10 ตัว: ตัวอักษร ตัวเลข `_ # @ $` |
| `DB_DRIVER` | `IBM i Access ODBC Driver` | ต้องตรงกับชื่อ driver ใน ODBC |
| `PORT` | `3099` | |
| `NODE_ENV` | `production` | ถ้าเป็น `development` จะแสดงข้อความ error จริงและ log แบบ dev |
| `CORS_ORIGIN` | (ว่าง = ปิด CORS) | origin ที่อนุญาต คั่นด้วย comma |
| `ROW_LIMIT` | `500` | จำนวน row สูงสุดของ endpoint ที่ไม่แบ่งหน้า (1-1000) |
| `PAGE_SIZE` | `100` | จำนวน row ต่อหน้าของ endpoint ที่แบ่งหน้า (ไม่เกิน `ROW_LIMIT`) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | ช่วงเวลานับ rate limit |
| `RATE_LIMIT_MAX` | `120` | จำนวน request สูงสุดต่อ IP ต่อช่วงเวลาข้างบน |
| `DB_POOL_INITIAL` | `1` | จำนวน connection ตั้งต้นของ pool (ใช้เฉพาะโหมด `pool`) |
| `DB_POOL_MAX` | `3` | จำนวน query ที่รันพร้อมกันได้สูงสุด (ใช้ทั้งสองโหมด) |
| `DB_QUEUE_MAX` | `50` | จำนวน request ที่รอคิวได้ ถ้าเต็มตอบ 503 |
| `DB_LOGIN_TIMEOUT` | `10` | วินาที |
| `DB_QUERY_TIMEOUT` | `15` | วินาที |
| `DB_CONNECTION_MODE` | `pool` | **ใหม่** `pool` = ใช้ connection ซ้ำ (เหมือนเดิม), `per-request` = เปิดและปิด connection ทุก query |
| `CACHE_TTL_SECONDS` | `0` | **ใหม่** เก็บ response ในหน่วยความจำกี่วินาที `0` = ปิด (0-3600) |

ตัวแปรใหม่ 2 ตัวเป็น optional `.env` เก่าที่ไม่มีสองตัวนี้ใช้งานได้เหมือนเดิม

## โครงสร้างโปรเจ็ค

```
server.js                  เริ่ม server, ตรวจ DB ก่อนเปิดรับ request, ปิดตัวอย่างสุภาพ
src/
  config.js                อ่าน .env (ไฟล์เดียวที่แตะ environment จริง)
  loadConfig.js            กฎตรวจ env ทั้งหมด (ฟังก์ชัน pure, test ง่าย)
  errors.js                AppError: error ที่ข้อความปลอดภัยพอจะส่งให้ client
  cache.js                 cache แบบมีอายุ (ใช้เมื่อ CACHE_TTL_SECONDS > 0)
  app.js                   middleware: helmet, compression, cors, rate limit, log
  db/
    pool.js                ที่เดียวที่รู้เรื่อง pool กับ per-request
    sql.js                 ประกอบ SQL (pure ไม่แตะ DB)
    query.js               จำกัดจำนวน query พร้อมกัน, ส่ง SQL, ping
  routes/
    index.js               รวม route ทั้งหมด
    endpoint.js            ตรวจ definition + จัดการ request ของทุก endpoint
    health.js              GET /api/health
    mdvice.js wgpgbl.js mgpgst.js   1 ไฟล์ต่อ 1 endpoint (SQL อยู่ในไฟล์นี้)
  middleware/
    errorHandler.js        404 และ error handler
test/                      node:test ทั้งหมด
```

เส้นทางของ request: `app.js` (middleware) -> `routes/endpoint.js` (ตรวจ query string) -> `db/query.js` (SQL ผ่าน `db/sql.js`, ส่งผ่าน `db/pool.js`) -> JSON response

ไม่มีชั้น controller / service แยก เพราะ endpoint ทั้งหมดเป็น SELECT ธรรมดา ถ้าวันหนึ่งมี business logic จริง ให้แยกชั้น service ออกจาก `routes/endpoint.js` ในตอนนั้น

## เพิ่ม endpoint ใหม่

1. คัดลอก `src/routes/mdvice.js` เป็นไฟล์ใหม่ เช่น `src/routes/mytable.js`
2. แก้ค่าในไฟล์:

```js
module.exports = {
  path: '/api/web/services/MYTABLE',
  description: 'GET MY TABLE BY CODE',
  sql: 'SELECT * FROM MYTABLE WHERE CODE = :code',
  params: [{ name: 'code', required: true, maxLength: 10 }],
  // orderBy: 'CODE',    // ใส่เมื่อต้องการแบ่งหน้า (limit/offset)
  // fetchAll: true,     // ไม่จำกัดจำนวน row ใช้อย่างระวัง
};
```

3. เพิ่ม `require('./mytable')` ในรายการของ `src/routes/index.js`
4. รัน `npm test` และเรียก endpoint ด้วย curl

กฎสำคัญ:
- ค่าจาก client ใส่ผ่าน `:name` เท่านั้น ระบบแปลงเป็น `?` (bound parameter) ทุกครั้ง **ห้ามต่อ string เป็น SQL**
- `sql` ต้องเป็น SELECT เดียว ห้ามมี `;` และคำสั่งเปลี่ยนข้อมูล
- ทุก `:name` ต้องประกาศใน `params` และทุก param ที่ประกาศต้องถูกใช้ ถ้าไม่ครบ server จะไม่ยอมเริ่ม
- ถ้าใช้ `orderBy` อย่าเขียน ORDER BY ใน `sql` และควรเป็น column ที่มี index
- ชื่อตารางไม่ต้องใส่ library นำหน้า ใช้ `DB_LIBRARY` เป็น default

## Endpoint ที่มี

| Method | Path | Parameter | หมายเหตุ |
|--------|------|-----------|----------|
| GET | `/api/health` | ไม่มี | 200 เมื่อ DB ตอบ, 503 เมื่อไม่ตอบ |
| GET | `/api/web/services/MDVICE` | `cddevc` (จำเป็น, ไม่เกิน 10 ตัว) | ค้นตามรหัส |
| GET | `/api/web/services/WGPGBL` | ไม่มี | **ทุก row ไม่จำกัดจำนวน** (`fetchAll`) |
| GET | `/api/web/services/MGPGST` | `limit`, `offset` (ไม่บังคับ) | แบ่งหน้า เรียงตาม `CDPAKG` |

Response สำเร็จ: `{ "P_ISFOUND": "1", "rows": [ ... ] }` (ไม่พบข้อมูลก็ยังเป็น 200 พร้อม `"P_ISFOUND": "0"` และ `rows` ว่าง) endpoint ที่แบ่งหน้าเพิ่ม `limit` และ `offset`
Response ผิดพลาด: `{ "success": false, "error": "..." }`

| Status | สาเหตุ |
|--------|--------|
| 400 | parameter ขาด, ไม่รู้จัก, ซ้ำ, ยาวเกิน หรือ `limit`/`offset` ไม่ถูกต้อง |
| 404 | ไม่มี route นั้น (รับเฉพาะ GET) |
| 429 | เกิน `RATE_LIMIT_MAX` |
| 500 | error ที่ไม่คาดคิด (production ไม่ส่งรายละเอียดออกไป) |
| 503 | `/api/health` เมื่อ DB ใช้ไม่ได้ หรือคิว query เต็ม (`DB_QUEUE_MAX`) |

ตัวอย่าง (Windows PowerShell ใช้ `curl.exe` เพราะ `curl` เป็น alias ของ `Invoke-WebRequest`):

```bash
curl -i http://localhost:3099/api/health
curl -i "http://localhost:3099/api/web/services/MDVICE?cddevc=11251"
curl -i "http://localhost:3099/api/web/services/MGPGST?limit=50&offset=100"
```

## 304 กับ F5 ไม่ได้แปลว่าไม่ได้ยิง IBM i

Express คำนวณ ETag **หลังจาก** handler ทำงานเสร็จ แล้วเทียบกับ `If-None-Match` ที่เบราว์เซอร์ส่งมา ถ้าตรงจึงตอบ 304
แปลว่าตอนกด F5 แล้วเห็น 304 query ถูกรันบน IBM i ไปแล้วทุกครั้ง 304 ประหยัดแค่ขนาด response (มี test ยืนยันใน `test/app.test.js`)
ถ้าต้องการลดภาระ IBM i จริง ให้ตั้ง `CACHE_TTL_SECONDS` เป็นค่ามากกว่า 0 แล้ว response จะมี header `X-Cache: HIT` เมื่อมาจากหน่วยความจำ
ข้อแลกเปลี่ยน: ข้อมูลอาจเก่าได้ไม่เกินเวลาที่ตั้ง จึงไม่เหมาะกับข้อมูลที่ต้อง real time

## ทดสอบพฤติกรรม lock บน AS400

อาการ: หลังดึงข้อมูล เห็น job `QZDASOINIT` ถือ lock `*SHRRD` สถานะ HELD บน file `*SHRRD` เป็น shared read จึงขัดกับงานที่ขอสิทธิ์ exclusive เท่านั้น (เช่น `*EXCL`, reorganize, clear file)

สมมติฐาน (ยังไม่ยืนยันบนระบบจริง): connection ที่อยู่ใน pool ยังเปิดอยู่ job `QZDASOINIT` ของมันจึงอยู่ต่อ และ lock ที่เกิดจากการ query ซ้ำ (pseudo closed cursor) ค้างอยู่จนกว่าจะปิด connection ข้อมูลอ้างอิงเป็นการพูดคุยของชุมชน ไม่ใช่เอกสาร IBM ดังนั้นต้องทดสอบ

ขั้นตอนทดสอบ (บันทึกผลแต่ละขั้นไว้):

1. **โหมดเดิม** ตั้ง `DB_CONNECTION_MODE=pool` และ `CACHE_TTL_SECONDS=0` แล้ว `npm start`
2. เรียก `/api/web/services/MGPGST` ในเบราว์เซอร์แล้วกด F5 ซ้ำหลายครั้ง
3. บน IBM i รัน `WRKOBJLCK OBJ(YOURLIB/MGPGST) OBJTYPE(*FILE)` ดูว่ามี job ถือ lock กี่ตัว (ได้สูงสุด `DB_POOL_MAX` ตัวในโหมดนี้)
4. กด Ctrl+C หยุด server (จะปิด pool) แล้วรันคำสั่งเดิมอีกครั้ง ถ้า lock หายไป แปลว่า connection ใน pool เป็นตัวถือ lock
5. **โหมดใหม่** ตั้ง `DB_CONNECTION_MODE=per-request` แล้ว `npm start` เรียก endpoint เดิมซ้ำหลายครั้ง แล้วรัน `WRKOBJLCK` ทันทีหลังได้ response ถ้า lock ไม่ค้าง แปลว่าการปิด connection ทุก query ช่วยได้ ให้จับเวลา response เทียบกับโหมด `pool` เพื่อดูว่าช้าลงเท่าไร (ต้อง login ใหม่ทุกครั้ง)
6. **ลดจำนวน query** ตั้ง `CACHE_TTL_SECONDS=30` กด F5 ซ้ำ ดู header `X-Cache` ใน DevTools ควรเป็น `HIT` หลังครั้งแรก และจำนวน lock ไม่เพิ่ม

ถ้าทุกโหมดยังเห็น lock ค้าง ให้ดู job ด้วย `WRKJOB` (option 14 ดู open files) แล้วปรึกษาผู้ดูแล IBM i เรื่อง cursor ที่ค้างและการตั้งค่า driver เพิ่มเติม

## แก้ปัญหา

| อาการ | สาเหตุและวิธีแก้ |
|-------|------------------|
| `Invalid configuration: ...` | ค่าใน `.env` ผิดหรือขาด อ่านข้อความทีละข้อ แก้ให้ครบ |
| `Invalid endpoint: ...` | definition ใน `src/routes/` ผิด ข้อความบอก path และข้อที่ผิด |
| `Cannot find module ... odbc.node` | native module ยังไม่ถูก build หรือ build คนละ Node.js version รัน `npm rebuild odbc` ด้วย Node.js เวอร์ชันเดียวกับที่รัน server |
| `IM002 Data source name not found` หรือ `Driver not found` | `DB_DRIVER` ไม่ตรงกับ driver ที่ลงทะเบียน Windows ให้ดูใน ODBC 64-bit, Linux ดู `odbcinst.ini` |
| Login ไม่ผ่าน / `SQL0084` | ตรวจ `DB_USER` และ `DB_PASSWORD` |
| `/api/health` ได้ 503 | ดู console หา `Health check failed` ตรวจว่า `DB_HOST` เข้าถึงได้และ firewall ไม่บล็อก |
| `npm install` ล้มด้วย `self-signed certificate in certificate chain` | proxy หรือ antivirus ดัก HTTPS ขอ root CA จาก IT แล้วตั้ง `NODE_EXTRA_CA_CERTS` ก่อน install |
| `npm.ps1 cannot be loaded` | ใช้ `npm.cmd` หรือ `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `EBUSY: resource busy or locked` ตอน npm ลบ `node_modules` | ปิด VS Code และ terminal ที่เปิดในโปรเจ็ค แล้วลองใหม่ |
