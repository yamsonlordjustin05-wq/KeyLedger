"""KeyLedger local server. Python 3.9+; no pip packages required."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import sqlite3, json, re, threading, uuid, datetime, urllib.parse, os

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
DB = DATA / 'keyledger.sqlite3'
LOCK = threading.RLock()
STATUSES = {'pending','processing','completed','cancelled'}
DEFAULT_PRODUCT = 'Mann Co. Supply Crate Key'
SEED_IDS=['76561198285234595','76561199647543723','76561197993269828','76561198054685424','76561198159546017','76561199029149754','76561198226423728','76561198370873689','76561198129974418','76561198334393644']
SEED_AMOUNTS=[79,21,34,16,24,26,47,63,38,91]

def connect():
    db=sqlite3.connect(DB, timeout=10)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA busy_timeout=10000')
    return db

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

def init():
    with connect() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS orders (
          uid TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
          customer_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 1),
          price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
          status TEXT NOT NULL CHECK(status IN ('pending','processing','completed','cancelled')),
          product TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS supplies (
          id INTEGER PRIMARY KEY AUTOINCREMENT, order_uid TEXT NOT NULL,
          order_no TEXT NOT NULL, customer_id TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          supplied_at TEXT NOT NULL,
          FOREIGN KEY(order_uid) REFERENCES orders(uid) ON DELETE CASCADE)''')
        db.execute('CREATE INDEX IF NOT EXISTS idx_supplies_uid ON supplies(order_uid)')
        db.execute('''CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL,
          description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
          created_at TEXT NOT NULL)''')
        db.execute('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)''')
        db.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('selling_price_cents','325')")
        count=db.execute('SELECT COUNT(*) FROM orders').fetchone()[0]
        # Reference rows from the provided dashboard. Only seeded on a completely empty first launch.
        seeded=db.execute('PRAGMA user_version').fetchone()[0]
        if not count and not seeded:
            now=utc()
            for i,(cid,qty) in enumerate(zip(SEED_IDS,SEED_AMOUNTS),1):
                db.execute('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (f'seed-{i}',f'ORD-{i:03}',cid,qty,325,'pending',DEFAULT_PRODUCT,'Imported from provided dashboard',now,now))
            db.execute('PRAGMA user_version=1')

def global_price(db):
    return int(db.execute("SELECT value FROM settings WHERE key='selling_price_cents'").fetchone()[0])

def price_cents(value):
    from decimal import Decimal, InvalidOperation
    try:
        v=Decimal(str(value))
        if not v.is_finite() or v<0 or v>1000000 or v.as_tuple().exponent < -2:raise ValueError()
        return int(v*100)
    except (ValueError,InvalidOperation,TypeError):
        raise ValueError('Price must be a valid USD amount with at most two decimals.')

def record(db, uid):
    r=db.execute('''SELECT o.*, COALESCE(SUM(s.quantity),0) AS supplied
     FROM orders o LEFT JOIN supplies s ON s.order_uid=o.uid
     WHERE o.uid=? GROUP BY o.uid''',(uid,)).fetchone()
    if not r:return None
    return {'uid':r['uid'],'id':r['order_no'],'buyer':r['customer_id'],
      'quantity':r['quantity'],'price':r['price_cents']/100,'price_cents':r['price_cents'],
      'status':r['status'],'product':r['product'],'notes':r['notes'],
      'created':r['created_at'],'updated':r['updated_at'],
      'supplied':r['supplied'],'remaining':r['quantity']-r['supplied']}

def validate(x):
    if not isinstance(x,dict):raise ValueError('Expected an order object.')
    oid=str(x.get('id','')).strip()
    buyer=str(x.get('buyer','')).strip()
    product=str(x.get('product',DEFAULT_PRODUCT)).strip() or DEFAULT_PRODUCT
    notes=str(x.get('notes','')).strip()
    if not oid or len(oid)>60:raise ValueError('Order No. is required (max 60 characters).')
    if not buyer or len(buyer)>100:raise ValueError('Customer ID is required (max 100 characters).')
    if len(product)>120 or len(notes)>2000:raise ValueError('Product or notes are too long.')
    q=x.get('quantity')
    if isinstance(q,bool) or not str(q).isdigit() or not 1<=int(q)<=1000000:
        raise ValueError('Amount must be a whole number between 1 and 1,000,000.')
    cents=0  # authoritative global selling price is applied in the route
    status=str(x.get('status','pending'))
    if status not in STATUSES:raise ValueError('Invalid status.')
    return (oid,buyer,int(q),cents,status,product,notes)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'public'),**kw)
    def send_json(self,data,code=200):
        out=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(out)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(out)
    def body(self):
        size=int(self.headers.get('Content-Length','0'))
        if size<1 or size>1000000:raise ValueError('JSON payload missing or too large.')
        return json.loads(self.rfile.read(size))
    def route(self):
        path=urllib.parse.urlsplit(self.path).path
        with LOCK:
          with connect() as db:
            if self.command=='GET' and path=='/api/settings/price':
                return self.send_json({'price_cents':global_price(db)})
            if self.command=='PUT' and path=='/api/settings/price':
                x=self.body()
                if not isinstance(x,dict):raise ValueError('Invalid selling price.')
                cents=price_cents(x.get('price'))
                db.execute("UPDATE settings SET value=? WHERE key='selling_price_cents'",(str(cents),))
                db.execute('UPDATE orders SET price_cents=?, updated_at=?',(cents,utc()))
                return self.send_json({'price_cents':cents, 'updated_orders':db.execute('SELECT COUNT(*) FROM orders').fetchone()[0]})
            if self.command=='GET' and path=='/api/expenses':
                return self.send_json([dict(r) for r in db.execute('SELECT * FROM expenses ORDER BY id DESC')])
            if self.command=='POST' and path=='/api/expenses':
                x=self.body()
                if not isinstance(x,dict):raise ValueError('Invalid expense.')
                category=str(x.get('category','Other')).strip()[:60]
                desc=str(x.get('description','')).strip()[:200]
                from decimal import Decimal
                try:
                    amount=Decimal(str(x.get('amount','')))
                    if not amount.is_finite() or amount<0 or amount>10000000 or amount.as_tuple().exponent < -2:raise ValueError()
                    cents=int(amount*100)
                except:raise ValueError('Enter a valid nonnegative dollar amount with up to 2 decimals.')
                if not desc or not category:raise ValueError('Description and category are required.')
                cur=db.execute('INSERT INTO expenses(category,description,amount_cents,created_at) VALUES(?,?,?,?)',(category,desc,cents,utc()))
                return self.send_json({'ok':True,'id':cur.lastrowid},201)
            mexp=re.fullmatch(r'/api/expenses/(\d+)',path)
            if self.command=='DELETE' and mexp:
                db.execute('DELETE FROM expenses WHERE id=?',(int(mexp[1]),))
                return self.send_json({'ok':True})
            if self.command=='GET' and path=='/api/orders':
                ids=[r[0] for r in db.execute('SELECT uid FROM orders ORDER BY created_at DESC, order_no DESC')]
                return self.send_json([record(db,i) for i in ids])
            if self.command=='GET' and path=='/api/supplies':
                return self.send_json([dict(r) for r in db.execute('SELECT id,order_no,customer_id,quantity,supplied_at FROM supplies ORDER BY id DESC LIMIT 2000')])
            if self.command=='GET' and path=='/api/backup':
                ids=[r[0] for r in db.execute('SELECT uid FROM orders ORDER BY order_no')]
                logs=[dict(r) for r in db.execute('SELECT * FROM supplies ORDER BY id')]
                return self.send_json({'exported_at':utc(),'orders':[record(db,i) for i in ids],'supplies':logs})
            if self.command=='POST' and path=='/api/orders':
                oid,buyer,q,cents,status,product,notes=validate(self.body())
                cents=global_price(db)
                uid=str(uuid.uuid4()); now=utc()
                db.execute('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)',(uid,oid,buyer,q,cents,status,product,notes,now,now))
                return self.send_json(record(db,uid),201)
            match=re.fullmatch(r'/api/orders/([a-zA-Z0-9-]+)(/supply)?',path)
            if match:
                uid=match[1]; supply=bool(match[2]); old=record(db,uid)
                if not old:return self.send_json({'error':'Order not found.'},404)
                if self.command=='DELETE' and not supply:
                    db.execute('DELETE FROM orders WHERE uid=?',(uid,))
                    return self.send_json({'ok':True})
                if self.command=='PUT' and not supply:
                    oid,buyer,q,cents,status,product,notes=validate(self.body())
                    cents=global_price(db)
                    if q<old['supplied']:raise ValueError('Amount cannot be less than keys already supplied.')
                    if status=='completed' and q!=old['supplied']:
                        raise ValueError('Supply all remaining keys before marking completed.')
                    if status=='cancelled' and old['supplied']:
                        raise ValueError('Orders with supplied keys cannot be cancelled.')
                    if old['supplied'] and status=='pending':status='processing'
                    db.execute('''UPDATE orders SET order_no=?,customer_id=?,quantity=?,price_cents=?,status=?,product=?,notes=?,updated_at=? WHERE uid=?''',
                     (oid,buyer,q,cents,status,product,notes,utc(),uid))
                    return self.send_json(record(db,uid))
                if self.command=='POST' and supply:
                    if old['status'] in ('completed','cancelled'):raise ValueError('Cannot supply completed or cancelled orders.')
                    amount=self.body().get('quantity')
                    if isinstance(amount,bool) or not str(amount).isdigit() or not 1<=int(amount)<=old['remaining']:
                        raise ValueError(f'Supply must be between 1 and {old["remaining"]} keys.')
                    amount=int(amount); now=utc()
                    db.execute('INSERT INTO supplies(order_uid,order_no,customer_id,quantity,supplied_at) VALUES(?,?,?,?,?)',
                     (uid,old['id'],old['buyer'],amount,now))
                    status='completed' if amount==old['remaining'] else 'processing'
                    db.execute('UPDATE orders SET status=?,updated_at=? WHERE uid=?',(status,now,uid))
                    return self.send_json(record(db,uid))
            return self.send_json({'error':'API route not found.'},404)
    def do_GET(self):
        if self.path.startswith('/api/'):
            try:self.route()
            except Exception as e:self.error(e)
        elif urllib.parse.urlsplit(self.path).path=='/':
            self.path='/index.html';super().do_GET()
        else:super().do_GET()
    def do_POST(self):
        try:self.route()
        except Exception as e:self.error(e)
    def do_PUT(self):
        try:self.route()
        except Exception as e:self.error(e)
    def do_DELETE(self):
        try:self.route()
        except Exception as e:self.error(e)
    def error(self,e):
        if isinstance(e,sqlite3.IntegrityError):return self.send_json({'error':'Order number already exists or violates a database rule.'},409)
        if isinstance(e,(ValueError,json.JSONDecodeError)):return self.send_json({'error':str(e)},400)
        print('Server error:',repr(e));self.send_json({'error':'Internal server error.'},500)

if __name__ == '__main__':
    init()

    host = os.getenv('KEYLEDGER_HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '8000'))

    print(f'KeyLedger running at http://{host}:{port}')
    print(f'Database: {DB}')

    ThreadingHTTPServer((host, port), Handler).serve_forever()
