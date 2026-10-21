# KeyLedger — Database-Backed Order Dashboard

This project converts your original HTML KeyLedger dashboard into a local web application with **SQLite** persistence, while retaining the blue/white layout, Inter typography, Mann Co. Supply Crate Key artwork, and USD $3.25 default.

## Requirements
- Python 3.9 or newer (check with `python --version` or `py --version`)
- Visual Studio Code
- Browser (Chrome, Edge, etc.)
- No pip install, npm install, XAMPP, or MySQL required.

## Start in VS Code
1. Extract the ZIP and open the **keyledger-vscode** folder in VS Code (File > Open Folder).
2. Open Terminal > New Terminal.
3. Run `python server.py` (on Windows, you can use `py server.py`).
4. Open **http://127.0.0.1:8000** in your browser.
5. Leave the terminal running while using the dashboard. Press Ctrl+C to stop.

**Do not open `public/index.html` with Live Server or as a file.** The API endpoints require `server.py`.

## Data and features
- Data stored in `data/keyledger.sqlite3`, auto-created on first launch.
- First launch seeds 10 example customer IDs/amounts from your supplied code (all fewer than 100 keys). This happens only once.
- Create, edit, search, filter and delete orders using the real database.
- Supply some or all remaining keys; partial supplies become `Processing`, full supplies become `Completed`.
- Supply History logs quantities and timestamps. Permanently deleting an order also deletes its supply history.
- Amount, supplied, remaining, totals and active metrics use cents for reliable two-decimal USD calculations.
- Export CSV and Backup JSON buttons. Backup JSON is a read-only export, not an automated restore.
- The dashboard is **local-only** (`127.0.0.1`), without accounts or authentication. Do not expose this development server to the public Internet.

## Backup and migration
Stop the server, then copy `data/keyledger.sqlite3` to an external safe location. To move the project to another PC, copy the project folder **including `data/keyledger.sqlite3`**. If you want a fresh database, delete the database file while the server is stopped.

## Project structure
```
keyledger-vscode/
  server.py                  Python HTTP API + SQLite
  public/
    index.html              Your dashboard layout and styling
    app.js                  Browser behavior, database API integration
    key-image.txt           Original embedded product artwork
  data/
    keyledger.sqlite3       Auto-created when launched
  README.md
```

## API
- `GET /api/orders` — list orders
- `POST /api/orders` — create
- `PUT /api/orders/{uid}` — edit
- `DELETE /api/orders/{uid}` — delete (permanent)
- `POST /api/orders/{uid}/supply` — supply quantity
- `GET /api/supplies` — supply history
- `GET /api/backup` — JSON export

Orders cannot be marked completed until their remaining quantity is zero. A partially supplied order cannot be cancelled. The default unit sale price is $3.25 USD but is editable.


## Version 2: working navigation
Home shows a live overview; Tasks and Requests show orders needing supply; Transactions and Supply Logs show database records; Recipients summarizes customer IDs; Bill Pay records expenses in SQLite; Invoicing prints order-based invoices; Accounting summarizes tracked order values and expenses. These features operate locally. Invoicing does not charge customers, Bill Pay does not actually transfer money, and Accounting does not verify payment or calculate inventory costs automatically.

**Upgrade existing installation:** Back up `data/keyledger.sqlite3`, stop the old server with Ctrl+C, then replace `server.py`, `public/index.html`, and `public/app.js` with those in this download. Keep your existing `data` folder and `public/key-image.txt`. Restart `python server.py` and refresh with Ctrl+F5.
