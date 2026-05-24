# Inseam Scanner

A custom Firefox MV3 extension designed to scan, parse, and highlight garment inseam sizes directly on SHEIN listing/search pages.

## Features

- **Floating Interactive Dashboard**: Set your target inseam (in inches or centimeters), tolerance range, and view real-time scan statistics.
- **In-Page Overlay Badges**: Adds scan buttons directly to product cards. Displays the matching size range on success.
- **WAF and Bot Bypass**: Employs a hidden iframe crawler simulation that runs same-origin inside your active browser session, automatically inheriting login cookies and running page scripts.
- **Programmatic Modal Scraping**: Automatically clicks the "Size Guide" ("Guia de tamanhos") button in the background and scrapes dynamic tables/grids.
- **Smart Unit Detection**: Avoids double-conversion bugs with precise word-boundary checking (e.g. distinguishing `"in"` as inches from substring matches in Portuguese words like `"comprimento"` or `"interior"`).
- **Diagnostics Panel**: Expandable real-time drawer in the dashboard to view traces, request logs, and extraction statuses.

## Installation (Firefox MV3)

1. Open Firefox and enter `about:debugging#/runtime/this-firefox` in the address bar.
2. Click **Load Temporary Add-on...**
3. Select the `manifest.json` file inside this project directory.

## How to Use

1. Go to shein.com and search for pants, jeans, or trousers.
2. Click the floating **Inseam Scanner** icon on the bottom right to configure your target inseam and tolerance.
3. Hover or view product listing cards; click **Scan** on any item to parse its size guide.
4. Alternatively, click **Scan All Visible Items** to queue all visible products.
5. Review matches instantly (color-coded as Perfect Match, Close Match, or Far Match).
