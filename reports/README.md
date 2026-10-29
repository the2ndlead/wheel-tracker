# reports/

Put your Robinhood account activity CSV exports here.

- Name them by export date, e.g. `robinhood_2026-10-21.csv`. The app lists the newest file first.
- **One sub-folder per account**, e.g. `Roth IRA/` and `Individual/`. The app turns every sub-folder that holds CSVs into an account named after the folder, loads its files, and adds an **All accounts (combined)** view.
- Keep each account's reports only in its own folder. A file that's also in another account's folder is removed from the wrong account automatically.
- You can tick several files in **Reports ▾** to merge them. Rows that appear in more than one file are counted once.
- With auto-load on (Settings ⚙), a CSV saved here while the app is running loads by itself.
- `*.csv` files are git-ignored and never committed.
