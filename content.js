/**
 * Inseam Scanner - content.js
 * 
 * Adds an interactive dashboard and product size scanner on SHEIN pages.
 * Handles same-origin details fetching, robust size data extraction, and visual highlights.
 */

(function () {
  // Regex to extract product ID from shein URL
  const PRODUCT_ID_REGEX = /-p-(\d+)\.html/;

  // Settings state (with defaults)
  let state = {
    targetInseam: 30,
    unit: 'in',
    tolerance: 0.5,
    autoScan: false
  };

  // Keep track of scanned products in current session
  let sessionScans = {};

  // Rate-limited scanning queue to prevent rate limiting / anti-bot blocks
  class ScanQueue {
    constructor(delayMs = 1500) {
      this.queue = [];
      this.running = false;
      this.delayMs = delayMs;
    }

    add(productId, scanFn) {
      // Check if already in queue or scanned
      if (this.queue.some(item => item.productId === productId)) return;
      
      this.queue.push({ productId, scanFn });
      this.process();
    }

    async process() {
      if (this.running || this.queue.length === 0) return;
      this.running = true;

      const { productId, scanFn } = this.queue.shift();
      try {
        await scanFn();
      } catch (err) {
        console.error("Error processing queue scan for product:", productId, err);
      }

      // Rest interval between scans to protect against blocks
      setTimeout(() => {
        this.running = false;
        this.process();
      }, this.delayMs);
    }
  }

  const scanQueue = new ScanQueue(1200);

  // Initialize Extension
  async function init() {
    // Load settings from storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['settings'], (result) => {
        if (result.settings) {
          state = { ...state, ...result.settings };
        }
        createDashboard();
        startObservers();
        detectAndInjectCards();
        updateCacheIndicator();
      });
    } else {
      // Fallback if storage not available (e.g. debugging)
      createDashboard();
      startObservers();
      detectAndInjectCards();
    }
  }

  // Monitor DOM for new product listings (infinite scroll support)
  let observer = null;
  function startObservers() {
    let debounceTimer = null;
    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        detectAndInjectCards();
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Append log statements directly to the dashboard diagnostics panel
  function logToUI(message, type = 'info') {
    const logsPanel = document.getElementById('iss-logs-panel');
    if (!logsPanel) return;
    
    const logEl = document.createElement('div');
    logEl.style.marginBottom = '4px';
    if (type === 'error') {
      logEl.style.color = '#ff3b69'; // Red
    } else if (type === 'warn') {
      logEl.style.color = '#ffd000'; // Yellow
    } else if (type === 'success') {
      logEl.style.color = '#00f5a0'; // Green
    } else {
      logEl.style.color = '#00d2ff'; // Cyan
    }
    
    logEl.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsPanel.appendChild(logEl);
    logsPanel.scrollTop = logsPanel.scrollHeight;
  }

  // Inject floating control panel & FAB into page
  function createDashboard() {
    if (document.getElementById('iss-dashboard-container')) return;

    const container = document.createElement('div');
    container.id = 'iss-dashboard-container';
    
    // Injected elements markup (completely static to avoid AMO security warnings)
    container.innerHTML = `
      <div class="iss-dashboard" id="iss-dashboard-panel">
        <div class="iss-header">
          <span class="iss-header-title">
            <span class="iss-logo-dot"></span>
            Inseam Scanner
          </span>
          <button class="iss-close-btn" id="iss-close-btn" title="Close Panel">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="iss-body">
          <!-- Target Settings -->
          <div class="iss-control-group">
            <div class="iss-row">
              <span class="iss-label">Target Inseam</span>
              <div style="display: flex; gap: 6px; align-items: center;">
                <div class="iss-number-input-wrapper">
                  <input type="number" step="0.5" class="iss-number-input" id="iss-target-val">
                </div>
                <select class="iss-unit-select" id="iss-unit-select">
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                </select>
              </div>
            </div>
            
            <div class="iss-slider-container" style="margin-top: 14px;">
              <div class="iss-slider-header">
                <span>Tolerance Range</span>
                <span class="iss-slider-val" id="iss-tol-val-display"></span>
              </div>
              <input type="range" class="iss-slider" id="iss-tolerance-slider">
            </div>
          </div>
          
          <!-- Preferences -->
          <div class="iss-control-group">
            <div class="iss-row">
              <span class="iss-label">Auto-Scan on Scroll</span>
              <label class="iss-switch">
                <input type="checkbox" id="iss-auto-scan-toggle">
                <span class="iss-slider-toggle"></span>
              </label>
            </div>
          </div>
          
          <!-- Scan Stats -->
          <div>
            <div class="iss-section-title">Scan Statistics</div>
            <div class="iss-stats">
              <div class="iss-stat-card">
                <span class="iss-stat-num" id="iss-stat-total">0</span>
                <span class="iss-stat-lbl">Scanned</span>
              </div>
              <div class="iss-stat-card">
                <span class="iss-stat-num match-perfect" id="iss-stat-perfect">0</span>
                <span class="iss-stat-lbl">Matches</span>
              </div>
              <div class="iss-stat-card">
                <span class="iss-stat-num match-close" id="iss-stat-close">0</span>
                <span class="iss-stat-lbl">Close</span>
              </div>
            </div>
          </div>
          
          <!-- Product History List -->
          <div>
            <div class="iss-section-title">Scanned Products</div>
            <div class="iss-scanned-list" id="iss-scanned-list-container">
              <div style="text-align: center; color: var(--iss-text-muted); font-size: 11px; padding: 20px 0;" id="iss-empty-scanned">
                No items scanned yet
              </div>
            </div>
          </div>
          
          <!-- Diagnostics Logs -->
          <div style="margin-top: 10px; border-top: 1px solid var(--iss-border); padding-top: 10px;">
            <div class="iss-section-title" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;" id="iss-toggle-logs">
              <span>Diagnostics Console</span>
              <span id="iss-logs-arrow">▼</span>
            </div>
            <div id="iss-logs-panel" style="display: none; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; font-family: monospace; font-size: 10px; line-height: 1.4; margin-top: 6px; border: 1px solid var(--iss-border); text-align: left;">
              <div style="color: var(--iss-text-muted);">[Scanner] Diagnostics initialized. Click "Scan" on any item to view live traces.</div>
            </div>
          </div>
          
          <!-- Manual Actions -->
          <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto;">
            <button class="iss-primary-btn" id="iss-scan-all-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="m9 12 2 2 4-4"></path>
              </svg>
              Scan All Visible Items
            </button>
            
            <div style="display: flex; gap: 10px; justify-content: space-between; font-size: 10px;">
              <a href="#" style="color: var(--iss-text-muted); text-decoration: none;" id="iss-clear-cache-lnk">Clear Cache</a>
              <span style="color: var(--iss-text-muted);" id="iss-cache-count">0 items cached</span>
            </div>
          </div>
        </div>
      </div>
      
      <button class="iss-trigger-btn" id="iss-trigger-btn" title="Open Inseam Scanner">
        <svg viewBox="0 0 24 24">
          <path d="M5 3h14c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2z"></path>
          <path d="M19 8h-3"></path>
          <path d="M19 12h-5"></path>
          <path d="M19 16h-3"></path>
          <path d="M14 3v18"></path>
        </svg>
      </button>
    `;

    document.body.appendChild(container);

    // Initialize state values programmatically to avoid dynamic innerHTML assignments (AMO security guideline)
    document.getElementById('iss-target-val').value = state.targetInseam;
    document.getElementById('iss-unit-select').value = state.unit;
    document.getElementById('iss-tol-val-display').textContent = `±${state.tolerance} ${state.unit}`;
    
    const tolSlider = document.getElementById('iss-tolerance-slider');
    if (state.unit === 'cm') {
      tolSlider.min = '0.2';
      tolSlider.max = '8';
      tolSlider.step = '0.2';
    } else {
      tolSlider.min = '0.1';
      tolSlider.max = '3';
      tolSlider.step = '0.1';
    }
    tolSlider.value = state.tolerance;
    document.getElementById('iss-auto-scan-toggle').checked = state.autoScan;

    // Bind Event Listeners
    const triggerBtn = document.getElementById('iss-trigger-btn');
    const panel = document.getElementById('iss-dashboard-panel');
    const closeBtn = document.getElementById('iss-close-btn');

    triggerBtn.addEventListener('click', () => {
      const isShowing = panel.classList.toggle('show');
      triggerBtn.classList.toggle('active');
      
      // Focus target input on open
      if (isShowing) {
        document.getElementById('iss-target-val').focus();
      }
    });

    closeBtn.addEventListener('click', () => {
      panel.classList.remove('show');
      triggerBtn.classList.remove('active');
    });

    // Handle Input Events and State Syncing
    const targetInput = document.getElementById('iss-target-val');
    const unitSelect = document.getElementById('iss-unit-select');
    const toleranceSlider = document.getElementById('iss-tolerance-slider');
    const autoScanToggle = document.getElementById('iss-auto-scan-toggle');
    const tolValDisplay = document.getElementById('iss-tol-val-display');

    const saveSettings = () => {
      state.targetInseam = parseFloat(targetInput.value) || 30;
      state.unit = unitSelect.value;
      state.tolerance = parseFloat(toleranceSlider.value) || 0.5;
      state.autoScan = autoScanToggle.checked;

      tolValDisplay.textContent = `±${state.tolerance} ${state.unit}`;

      // Save to chrome storage
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ settings: state });
      }

      // Re-evaluate all session-scanned product badges in case settings changed
      updateAllActiveBadges();
    };

    targetInput.addEventListener('input', saveSettings);
    unitSelect.addEventListener('change', (e) => {
      // Automatic unit conversion for convenience when selecting unit
      const oldUnit = state.unit;
      const newUnit = e.target.value;
      let currentVal = parseFloat(targetInput.value) || 30;
      let currentTol = parseFloat(toleranceSlider.value) || 0.5;

      if (oldUnit === 'in' && newUnit === 'cm') {
        targetInput.value = (currentVal * 2.54).toFixed(1);
        toleranceSlider.min = '0.2';
        toleranceSlider.max = '8';
        toleranceSlider.step = '0.2';
        toleranceSlider.value = (currentTol * 2.54).toFixed(1);
      } else if (oldUnit === 'cm' && newUnit === 'in') {
        targetInput.value = (currentVal / 2.54).toFixed(1);
        toleranceSlider.min = '0.1';
        toleranceSlider.max = '3';
        toleranceSlider.step = '0.1';
        toleranceSlider.value = (currentTol / 2.54).toFixed(1);
      }
      saveSettings();
    });

    toleranceSlider.addEventListener('input', saveSettings);
    autoScanToggle.addEventListener('change', saveSettings);

    // Operations
    document.getElementById('iss-scan-all-btn').addEventListener('click', scanAllVisibleProducts);
    document.getElementById('iss-clear-cache-lnk').addEventListener('click', (e) => {
      e.preventDefault();
      clearCache();
    });

    // Toggle logs console
    const toggleLogs = document.getElementById('iss-toggle-logs');
    const logsPanel = document.getElementById('iss-logs-panel');
    const logsArrow = document.getElementById('iss-logs-arrow');
    if (toggleLogs && logsPanel && logsArrow) {
      toggleLogs.addEventListener('click', () => {
        const isHidden = logsPanel.style.display === 'none';
        logsPanel.style.display = isHidden ? 'block' : 'none';
        logsArrow.textContent = isHidden ? '▲' : '▼';
      });
    }
  }

  // Scan and identify products on screen, injecting scanning badges
  function detectAndInjectCards() {
    // Find all links to product detail pages
    const productLinks = document.querySelectorAll('a[href*="-p-"]');
    
    productLinks.forEach(link => {
      const href = link.getAttribute('href');
      const match = href.match(PRODUCT_ID_REGEX);
      if (!match) return;

      const productId = match[1];
      const productUrl = link.href; // absolute path

      // Locate container product card
      const card = findCardContainer(link);
      if (!card) return;

      // Make sure card has position relative to place overlay
      const cardStyle = window.getComputedStyle(card);
      if (cardStyle.position === 'static') {
        card.style.position = 'relative';
      }

      // Check if scanner element already injected
      if (card.querySelector('.iss-card-overlay')) return;

      // Extract image & title from card context (cached for dashboard view)
      const imageUrl = getCardImage(card);
      const title = getCardTitle(card);

      // Create scanner element overlay
      const overlay = document.createElement('div');
      overlay.className = 'iss-card-overlay';
      overlay.dataset.productId = productId;

      // We'll append it to image wrapper if possible (highly visual), or to card
      const imageWrapper = card.querySelector('.goods-img__link, .product-card__image-wrapper, .image-container, .img-box, .goods-img-box');
      
      overlay.innerHTML = `
        <button class="iss-card-scan-btn" title="Scan detailed sizes for this product">
          <span class="iss-spinner" style="display:none"></span>
          <span>Scan</span>
        </button>
      `;

      const scanBtn = overlay.querySelector('.iss-card-scan-btn');
      scanBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scanSingleProduct({ productId, productUrl, imageUrl, title, card });
      });

      if (imageWrapper) {
        imageWrapper.style.position = 'relative';
        imageWrapper.appendChild(overlay);
      } else {
        card.appendChild(overlay);
      }

      // If autoScan is enabled, add it to viewport intersection queue
      if (state.autoScan) {
        setupIntersectionObserver(card, { productId, productUrl, imageUrl, title });
      }
    });
  }

  // Setup viewport observer for auto scan
  function setupIntersectionObserver(card, details) {
    if (card.dataset.issObserved) return;
    card.dataset.issObserved = "true";

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Add to queue
          scanQueue.add(details.productId, () => {
            return scanSingleProduct({
              productId: details.productId,
              productUrl: details.productUrl,
              imageUrl: details.imageUrl,
              title: details.title,
              card
            }, true); // Silent auto-scan (don't force open dashboard)
          });
          io.disconnect(); // Only scan once
        }
      });
    }, { threshold: 0.1 });

    io.observe(card);
  }

  // Helpers to scrape card info
  function findCardContainer(linkElement) {
    // Try to find the closest known outer card container selector
    const closestCard = linkElement.closest([
      '.goods-item',
      '.product-card',
      '.product-list__item',
      '.j-goods-item',
      '.g-item-wrapper',
      '.goods-li',
      '[data-goods-id]',
      '.goods-item-v2',
      '.product-card-v2',
      '.product-item'
    ].join(', '));

    if (closestCard) return closestCard;

    // Fallback: traverse up to 12 levels to find a likely container
    let current = linkElement;
    for (let i = 0; i < 12; i++) {
      if (!current || current === document.body) break;
      const className = current.className || '';
      if (typeof className === 'string' && (
        className.includes('goods-item') || 
        className.includes('product-card') || 
        className.includes('product-list__item') ||
        className.includes('j-goods-item') ||
        className.includes('g-item-wrapper') ||
        className.includes('goods-li') ||
        className.includes('product-item') ||
        current.hasAttribute('data-goods-id')
      )) {
        return current;
      }
      current = current.parentElement;
    }

    // Ultimate fallback: parent element or the link itself
    return linkElement.parentElement && linkElement.parentElement !== document.body 
      ? linkElement.parentElement 
      : linkElement;
  }

  function getCardImage(card) {
    const img = card.querySelector('img');
    if (!img) return '';
    return img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('lazy-src') || '';
  }

  function getCardTitle(card) {
    const titleEl = card.querySelector('.goods-title-link, .product-card__title, .goods-name, .product-card__name, .goods-title');
    if (titleEl) return titleEl.textContent.trim();
    const link = card.querySelector('a');
    if (link && link.title) return link.title;
    const img = card.querySelector('img');
    if (img && img.alt) return img.alt;
    return 'SHEIN Pants/Jeans';
  }

  // Helper to extract 2D array of text content representing a table or grid
  function getTableData2D(tableEl) {
    if (tableEl.tagName.toLowerCase() === 'table' || tableEl.querySelector('tr')) {
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      return rows.map(row => 
        Array.from(row.querySelectorAll('th, td')).map(cell => cell.textContent.trim())
      );
    }
    
    // Otherwise check for grid/div elements with row and cell layout
    let rows = Array.from(tableEl.querySelectorAll('[class*="row"], [class*="-tr"], [class*="line"]'));
    if (rows.length === 0) {
      rows = Array.from(tableEl.children);
    }
    
    return rows.map(row => {
      let cells = Array.from(row.querySelectorAll('[class*="cell"], [class*="col"], [class*="-td"], [class*="-th"]'));
      if (cells.length === 0) {
        cells = Array.from(row.children);
      }
      return cells.map(cell => cell.textContent.trim());
    }).filter(r => r.length > 0);
  }

  // Parse inseam measurements from a DOM table or grid element
  function parseInseamFromTable(tableEl) {
    const tableData = getTableData2D(tableEl);
    if (tableData.length < 2) return null;

    const results = [];

    // Option 2: Sizes in rows, measurements in columns
    // Header row is tableData[0]
    const header = tableData[0];
    let sizeColIdx = -1;
    let inseamColIdx = -1;

    for (let c = 0; c < header.length; c++) {
      const text = header[c].toLowerCase();
      if (text.includes('tamanho') || text.includes('size') || text.includes('talla') || text.includes('taille')) {
        sizeColIdx = c;
      }
      if (isKeywordMatch(text)) {
        inseamColIdx = c;
      }
    }

    // If size column is not found but we found inseam column, default size column to 0
    if (inseamColIdx !== -1 && sizeColIdx === -1) {
      sizeColIdx = 0;
    }

    if (inseamColIdx !== -1 && sizeColIdx !== -1 && sizeColIdx !== inseamColIdx) {
      for (let r = 1; r < tableData.length; r++) {
        const row = tableData[r];
        if (row.length > Math.max(sizeColIdx, inseamColIdx)) {
          const sizeLabel = row[sizeColIdx];
          const valStr = row[inseamColIdx];
          const numVal = parseFloat(valStr.replace(/[^\d\.]/g, ''));
          if (!isNaN(numVal) && sizeLabel) {
            // Determine unit
            const isInch = detectIsInch(header[inseamColIdx], valStr, numVal);
            results.push({
              size: sizeLabel,
              inseamCm: isInch ? numVal * 2.54 : numVal,
              inseamIn: isInch ? numVal : numVal / 2.54
            });
          }
        }
      }
      if (results.length > 0) return results;
    }

    // Option 1: Sizes in columns, measurements in rows
    const possibleSizeHeader = tableData[0];
    for (let r = 1; r < tableData.length; r++) {
      const row = tableData[r];
      if (row.length > 0 && isKeywordMatch(row[0])) {
        for (let c = 1; c < row.length; c++) {
          if (c < possibleSizeHeader.length) {
            const sizeLabel = possibleSizeHeader[c];
            const valStr = row[c];
            const numVal = parseFloat(valStr.replace(/[^\d\.]/g, ''));
            if (!isNaN(numVal) && sizeLabel) {
              // Determine unit
              const isInch = detectIsInch(row[0], valStr, numVal);
              results.push({
                size: sizeLabel,
                inseamCm: isInch ? numVal * 2.54 : numVal,
                inseamIn: isInch ? numVal : numVal / 2.54
              });
            }
          }
        }
        if (results.length > 0) return results;
      }
    }

    return null;
  }

  // Create same-origin hidden iframe to execute product detail page and extract sizes
  async function scrapeProductViaIframe(productUrl, logPrefix = "") {
    return new Promise((resolve, reject) => {
      logToUI(`${logPrefix} Creating hidden iframe to load product page...`);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.top = '-10000px';
      iframe.style.left = '-10000px';
      iframe.style.width = '1200px';
      iframe.style.height = '800px';
      iframe.style.opacity = '0.001'; // rendering-enabled invisible mode
      iframe.style.pointerEvents = 'none';
      iframe.src = productUrl;

      let checkInterval = null;
      let timeoutTimer = null;

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for size chart in iframe"));
      }, 18000); // 18 seconds timeout

      // Start polling the iframe DOM
      checkInterval = setInterval(() => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) return;

          // Check for WAF blocks
          if (iframeDoc.title && (iframeDoc.title.includes("Access Denied") || iframeDoc.title.includes("Cloudflare"))) {
            cleanup();
            reject(new Error("Iframe loaded WAF block / Access Denied"));
            return;
          }

          const bodyText = iframeDoc.body?.textContent || "";
          if (bodyText.includes("page_risk_crawler_block") || iframeDoc.querySelector('[page_name="page_risk_crawler_block"]')) {
            cleanup();
            reject(new Error("Iframe was blocked by crawler protection"));
            return;
          }

          // Step 1: Check if global SSR variables are already parsed in the window context
          const win = iframe.contentWindow;
          if (win) {
            const ssrData = win.goodsDetailV3SsrData || win.goodsDetailV3SsrDataSsr || win.INITIAL_STATE__ || win.__NEXT_DATA__ || win.__PRELOADED_STATE__ || win.gbGoodsInfo;
            if (ssrData) {
              const parsed = parseInseamFromSsrData(ssrData);
              if (parsed && parsed.length > 0) {
                logToUI(`${logPrefix} Found size data in iframe window variables!`, 'success');
                cleanup();
                resolve(parsed);
                return;
              }
            }
          }

          // Step 2: Try to locate size table/dialog
          const dialogs = iframeDoc.querySelectorAll('.sui-dialog__wrapper, [role="dialog"], [class*="dialog"], [class*="modal"]');
          let table = null;

          for (const dialog of dialogs) {
            table = dialog.querySelector('table, [class*="table"], [class*="chart"]');
            if (table) break;
          }

          if (!table) {
            table = iframeDoc.querySelector('.sui-table, table, [class*="size-table"], [class*="size-chart"]');
          }

          if (table) {
            const sizes = parseInseamFromTable(table);
            if (sizes && sizes.length > 0) {
              logToUI(`${logPrefix} Extracted ${sizes.length} sizes from SUI dialog!`, 'success');
              cleanup();
              resolve(sizes);
              return;
            }
          }

          // Step 3: If table not found yet, click the size guide button
          const sizeGuideBtn = iframeDoc.querySelector(
            '.product-intro__size-guide, ' +
            '[class*="size-guide"], ' +
            '[class*="sizeguide"], ' +
            '[da-eid*="size-guide"], ' +
            '[da-eid*="size_guide"], ' +
            '[aria-label*="tamanhos" i], ' +
            '[aria-label*="size guide" i]'
          ) || Array.from(iframeDoc.querySelectorAll('div, span, a, button')).find(el => {
            const txt = el.textContent?.trim().toLowerCase();
            return txt === 'guia de tamanhos' || txt === 'size guide' || txt === 'guia de tallas' || txt === 'guide des tailles';
          });

          if (sizeGuideBtn) {
            const now = Date.now();
            if (!iframe._lastClickTime || now - iframe._lastClickTime > 1500) {
              logToUI(`${logPrefix} Size guide button visible, clicking to trigger SUI dialog...`, 'success');
              sizeGuideBtn.click();
              sizeGuideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              iframe._lastClickTime = now;
            }
          }
        } catch (err) {
          // May throw security exceptions during load/subdomain redirect, ignore and wait for next poll
        }
      }, 350);

      document.body.appendChild(iframe);
    });
  }

  // Scans a single product card
  async function scanSingleProduct(details, isAuto = false) {
    const { productId, productUrl, imageUrl, title, card } = details;

    logToUI(`Starting scan for Product ID ${productId}: ${title.substring(0, 30)}...`);

    // Check if product is already scanned in this session
    if (sessionScans[productId]) {
      logToUI(`Product ${productId} already scanned in this session. Re-applying badge.`);
      applyBadgeToCard(card, productId, sessionScans[productId]);
      return;
    }

    // Set UI loading state on card
    const overlay = card.querySelector(`.iss-card-overlay`);
    if (overlay) {
      const btn = overlay.querySelector('.iss-card-scan-btn');
      if (btn) {
        const spinner = btn.querySelector('.iss-spinner');
        if (spinner) spinner.style.display = 'inline-block';
        const txt = btn.querySelector('span:not(.iss-spinner)');
        if (txt) txt.textContent = 'Scanning...';
      }
    }

    // Try reading from cache
    const cachedData = await checkCache(productId);
    if (cachedData) {
      logToUI(`Cache HIT for Product ID ${productId}. Using cached measurements.`);
      sessionScans[productId] = cachedData;
      applyBadgeToCard(card, productId, cachedData);
      addToScannedHistory(productId, cachedData);
      updateStatistics();
      return;
    }

    logToUI(`Cache MISS for Product ID ${productId}. Starting fetch...`);

    try {
      let inseamList = null;

      // Primary Path: Use same-origin hidden iframe execution
      try {
        const localUrl = new URL(productUrl);
        localUrl.protocol = window.location.protocol;
        localUrl.host = window.location.host;

        inseamList = await scrapeProductViaIframe(localUrl.href, `[Iframe Scrape]`);
      } catch (iframeErr) {
        logToUI(`Iframe scraping failed or timed out: ${iframeErr.message}. Falling back to fetch path...`, 'warn');
        
        let htmlText = null;
        // Step 1: Attempt local same-origin fetch (which sends user cookies & has same-origin headers)
        try {
          const localUrl = new URL(productUrl);
          localUrl.protocol = window.location.protocol;
          localUrl.host = window.location.host;

          logToUI(`Step 1: Attempting same-origin fetch: ${localUrl.pathname}`);
          const response = await fetch(localUrl.href, {
            method: 'GET',
            credentials: 'same-origin'
          });

          if (response.ok) {
            htmlText = await response.text();
            logToUI(`Same-origin fetch succeeded. Status: ${response.status}. HTML size: ${Math.round(htmlText.length/1024)} KB.`, 'success');
          } else {
            throw new Error(`HTTP status ${response.status}`);
          }
        } catch (localErr) {
          logToUI(`Same-origin fetch failed: ${localErr.message}. Falling back to background...`, 'warn');

          // Step 2: Fallback to background script fetch (bypasses CORS/CSP, credentials included)
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            logToUI(`Step 2: Sending fetch message to background script...`);
            htmlText = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'fetchProduct', url: productUrl }, (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else if (!response || !response.success) {
                  reject(new Error(response ? response.error : 'No response from background script'));
                } else {
                  resolve(response.html);
                }
              });
            });
            logToUI(`Background fetch succeeded. HTML size: ${Math.round(htmlText.length/1024)} KB.`, 'success');
          } else {
            // Direct fetch fallback if chrome runtime is not available
            logToUI(`Extension environment unavailable. Attempting direct fetch...`, 'warn');
            const response = await fetch(productUrl);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            htmlText = await response.text();
            logToUI(`Direct fetch succeeded. HTML size: ${Math.round(htmlText.length/1024)} KB.`, 'success');
          }
        }

        // Extract Size Guide Measurements from HTML fallback
        inseamList = extractInseamFromHTML(htmlText);
      }

      const scanResult = {
        productId,
        productUrl,
        imageUrl,
        title,
        inseamList: inseamList || [], // Array of {size, inseamCm, inseamIn}
        scannedAt: Date.now()
      };

      // Save to cache
      await saveToCache(productId, scanResult);
      sessionScans[productId] = scanResult;

      // Render Results
      applyBadgeToCard(card, productId, scanResult);
      addToScannedHistory(productId, scanResult);
      updateStatistics();

    } catch (err) {
      console.error("Failed scanning product:", productId, err);
      logToUI(`Scan failed for product ${productId}: ${err.message}`, 'error');
      // Apply error badge on card
      if (overlay) {
        overlay.innerHTML = `
          <div class="iss-card-result-badge iss-badge-none" title="Scan failed. It could be due to a network error.">
            Error
          </div>
        `;
      }
    }
  }

  // Triggers sequential scanning of all product items visible on the current page
  function scanAllVisibleProducts() {
    const overlays = document.querySelectorAll('.iss-card-overlay');
    let addCount = 0;

    overlays.forEach(overlay => {
      const productId = overlay.dataset.productId;
      if (sessionScans[productId]) return; // Already scanned

      const card = overlay.parentElement;
      const link = card.querySelector('a[href*="-p-"]');
      if (!link) return;

      const productUrl = link.href;
      const imageUrl = getCardImage(card);
      const title = getCardTitle(card);

      addCount++;
      scanQueue.add(productId, () => {
        return scanSingleProduct({ productId, productUrl, imageUrl, title, card });
      });
    });

    if (addCount > 0) {
      // Open panel to show statistics and scanning progress
      document.getElementById('iss-dashboard-panel').classList.add('show');
      document.getElementById('iss-trigger-btn').classList.add('active');
    }
  }

  // Update card overlay with measurement results
  function applyBadgeToCard(card, productId, scanResult) {
    const overlay = card.querySelector('.iss-card-overlay');
    if (!overlay) return;

    const match = evaluateInseamMatch(scanResult.inseamList);
    
    // Create detailed tooltip text
    let tooltip = '';
    if (scanResult.inseamList.length === 0) {
      tooltip = "No inseam sizes found on product page.";
    } else {
      tooltip = `Size Breakdown:\n`;
      scanResult.inseamList.forEach(item => {
        const val = state.unit === 'in' ? `${item.inseamIn.toFixed(1)}"` : `${item.inseamCm.toFixed(0)} cm`;
        tooltip += `• ${item.size}: ${val}\n`;
      });
    }

    overlay.textContent = ''; // Clear previous scan state/button safely
    const badge = document.createElement('div');
    badge.className = `iss-card-result-badge iss-badge-${match.status}`;
    badge.title = tooltip;
    badge.textContent = match.label;
    overlay.appendChild(badge);
  }

  // Update all card badges when target inseam or units change
  function updateAllActiveBadges() {
    const overlays = document.querySelectorAll('.iss-card-overlay');
    overlays.forEach(overlay => {
      const productId = overlay.dataset.productId;
      const data = sessionScans[productId];
      if (data) {
        const card = overlay.parentElement;
        applyBadgeToCard(card, productId, data);
      }
    });

    // Refresh history cards list to match
    refreshHistoryList();
    updateStatistics();
  }

  // Compare product measurements against target settings
  function evaluateInseamMatch(inseamList) {
    if (!inseamList || inseamList.length === 0) {
      return { status: 'none', label: 'N/A' };
    }

    const target = state.targetInseam;
    const tol = state.tolerance;

    let bestDiff = Infinity;
    let bestVal = null;

    inseamList.forEach(item => {
      const val = state.unit === 'in' ? item.inseamIn : item.inseamCm;
      const diff = Math.abs(val - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestVal = val;
      }
    });

    const values = inseamList.map(item => state.unit === 'in' ? item.inseamIn : item.inseamCm);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    
    const symbol = state.unit === 'in' ? '"' : ' cm';
    let label = '';
    if (minVal === maxVal) {
      label = `${minVal.toFixed(1)}${symbol}`;
    } else {
      label = `${minVal.toFixed(1)}-${maxVal.toFixed(1)}${symbol}`;
    }

    // Colors matching thresholds
    if (bestDiff <= tol) {
      return { status: 'perfect', label };
    } else if (bestDiff <= tol + (state.unit === 'in' ? 1.5 : 3.8)) {
      return { status: 'close', label };
    } else {
      return { status: 'far', label };
    }
  }

  // Add parsed product info to dashboard history
  function addToScannedHistory(productId, scanResult) {
    const list = document.getElementById('iss-scanned-list-container');
    const emptyMsg = document.getElementById('iss-empty-scanned');
    if (emptyMsg) emptyMsg.remove();

    // Check if item already exists in UI
    const existing = document.getElementById(`iss-item-${productId}`);
    if (existing) existing.remove();

    const match = evaluateInseamMatch(scanResult.inseamList);
    
    const row = document.createElement('div');
    row.className = 'iss-scanned-item';
    row.id = `iss-item-${productId}`;
    
    const scannedInfo = document.createElement('div');
    scannedInfo.className = 'iss-scanned-info';

    const img = document.createElement('img');
    img.className = 'iss-scanned-thumb';
    img.alt = 'thumb';
    img.src = scanResult.imageUrl;

    const link = document.createElement('a');
    link.className = 'iss-scanned-title';
    link.target = '_blank';
    link.href = scanResult.productUrl;
    link.title = scanResult.title;
    link.textContent = scanResult.title;

    scannedInfo.appendChild(img);
    scannedInfo.appendChild(link);

    const valSpan = document.createElement('span');
    valSpan.className = `iss-scanned-val iss-badge-${match.status}`;
    valSpan.textContent = match.label;

    row.appendChild(scannedInfo);
    row.appendChild(valSpan);

    // Add to top of list
    list.insertBefore(row, list.firstChild);
  }

  // Re-build history list completely
  function refreshHistoryList() {
    const list = document.getElementById('iss-scanned-list-container');
    list.innerHTML = '';
    
    const items = Object.values(sessionScans).sort((a, b) => a.scannedAt - b.scannedAt);
    if (items.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; color: var(--iss-text-muted); font-size: 11px; padding: 20px 0;" id="iss-empty-scanned">
          No items scanned yet
        </div>
      `;
      return;
    }

    items.forEach(scanResult => {
      addToScannedHistory(scanResult.productId, scanResult);
    });
  }

  // Recalculate dashboard statistics
  function updateStatistics() {
    const items = Object.values(sessionScans);
    let total = items.length;
    let perfect = 0;
    let close = 0;

    items.forEach(item => {
      const match = evaluateInseamMatch(item.inseamList);
      if (match.status === 'perfect') perfect++;
      else if (match.status === 'close') close++;
    });

    document.getElementById('iss-stat-total').textContent = total;
    document.getElementById('iss-stat-perfect').textContent = perfect;
    document.getElementById('iss-stat-close').textContent = close;
  }

  // Extract a JSON object from an HTML string by matching balanced curly braces
  function extractJsonFromHtml(html, variableName) {
    const index = html.indexOf(variableName);
    if (index === -1) return null;

    // Find the first '{' after the variable name
    const startIndex = html.indexOf('{', index);
    if (startIndex === -1) return null;

    // Scan forward to find the matching closing brace
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let stringChar = null;

    for (let i = startIndex; i < html.length; i++) {
      const char = html[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (inString) {
        if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          // Found matching closing brace!
          const jsonStr = html.substring(startIndex, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            console.warn("Failed to parse extracted JSON for " + variableName, e);
            return null;
          }
        }
      }
    }
    return null;
  }

  // Multilingual keywords for "Inseam" to support shein pages loaded in different languages (e.g. Portuguese, Spanish, etc.)
  const INSEAM_KEYWORDS = [
    'inseam',
    'entrepierna',
    'entreperna',
    'costura interna',
    'costura_interna',
    'entrejambe',
    'innenbeinlänge',
    'innenbeinlaenge',
    'schrittlänge',
    'schrittlaenge',
    'interno gamba',
    'cucitura interna',
    'шаговый шов',
    'внутренний шов',
    'comprimento interior',
    'interior da calça',
    'comprimento da costura interna',
    'largo interior',
    'largo de entrepierna',
    'interior de la pierna',
    'longueur intérieure',
    'longueur interieure',
    'innenlänge',
    'innenlaenge'
  ];

  function isKeywordMatch(str) {
    if (!str || typeof str !== 'string') return false;
    const lower = str.toLowerCase();
    return INSEAM_KEYWORDS.some(keyword => lower.includes(keyword));
  }

  // Detects if unit is inch (vs cm)
  function detectIsInch(headerText, valueText, numVal) {
    const hLower = (headerText || '').toLowerCase();
    const vLower = (valueText || '').toLowerCase();

    // If explicit "cm" unit is found, it's definitely cm
    if (hLower.includes('cm') || vLower.includes('cm')) {
      return false;
    }

    // Standalone "in" or explicit "inch"/"inches"/"'"
    if (hLower.includes('inch') || vLower.includes('inch') || 
        hLower.includes('"') || vLower.includes('"') ||
        /\bin\b/i.test(hLower) || /\bin\b/i.test(vLower)) {
      return true;
    }

    // Default to range heuristic
    return numVal < 48;
  }

  // Extract JSON from script tag content starting at a specific index
  function extractJsonFromScript(scriptContent, startIndex) {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let stringChar = null;

    for (let i = startIndex; i < scriptContent.length; i++) {
      const char = scriptContent[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (inString) {
        if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          const jsonStr = scriptContent.substring(startIndex, i + 1);
          try {
            const data = JSON.parse(jsonStr);
            return { data, endIndex: i };
          } catch (e) {
            return null;
          }
        }
      }
    }
    return null;
  }

  // Scan all script tags for JSON blocks containing inseam keywords (highly future-proof)
  function extractAllJsonsFromHtml(html) {
    const jsons = [];
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    logToUI("Searching HTML script tags for size data...");
    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptContent = match[1];
      if (isKeywordMatch(scriptContent)) {
        let index = 0;
        let foundCount = 0;
        while (index < scriptContent.length) {
          const startIndex = scriptContent.indexOf('{', index);
          if (startIndex === -1) break;

          const result = extractJsonFromScript(scriptContent, startIndex);
          if (result) {
            jsons.push(result.data);
            foundCount++;
            index = result.endIndex + 1; // Move past parsed JSON
          } else {
            index = startIndex + 1;
          }
        }
        if (foundCount > 0) {
          logToUI(`Extracted ${foundCount} potential size state objects from scripts.`, 'success');
        }
      }
    }
    return jsons;
  }

  // Parse HTML string to extract size measurements
  function extractInseamFromHTML(htmlText) {
    // 1. Try extracting any embedded JSON block containing inseam keywords
    const stateObjects = extractAllJsonsFromHtml(htmlText);
    
    for (const data of stateObjects) {
      try {
        const parsed = parseInseamFromSsrData(data);
        if (parsed && parsed.length > 0) {
          logToUI(`Successfully extracted ${parsed.length} sizes from JSON state.`, 'success');
          return parsed;
        }
      } catch (e) {
        console.warn("Failed parsing state object:", e);
      }
    }

    // 2. Fallback text search using multilingual keywords
    const cleanBodyText = htmlText.replace(/<[^>]*>/g, ' '); // strip HTML tags
    logToUI("Trying raw text fallback for size measurements...", 'warn');
    
    for (const keyword of INSEAM_KEYWORDS) {
      const escapedKeyword = keyword.replace(/\s+/g, '\\s+');
      const regexes = [
        new RegExp(`${escapedKeyword}\\s*Length\\s*:\\s*([\\d\\.\\-]+)\\s*(cm|inch|in|")?`, 'i'),
        new RegExp(`${escapedKeyword}\\s*:\\s*([\\d\\.\\-]+)\\s*(cm|inch|in|")?`, 'i'),
        new RegExp(`${escapedKeyword}\\s*Length\\s*([\\d\\.\\-]+)\\s*(cm|inch|in|")?`, 'i'),
        new RegExp(`${escapedKeyword}\\s*([\\d\\.\\-]+)\\s*(cm|inch|in|")?`, 'i')
      ];
      
      for (const regex of regexes) {
        const match = cleanBodyText.match(regex);
        if (match) {
          const valStr = match[1];
          const unitStr = match[2] || '';
          
          const parts = valStr.split('-').map(v => parseFloat(v.trim()));
          const val = parts.reduce((a, b) => a + b, 0) / parts.length;

          if (!isNaN(val)) {
            let isCm = false;
            let isInch = false;

            const unitLower = unitStr.toLowerCase();
            if (unitLower === 'cm') isCm = true;
            else if (unitLower === 'inch' || unitLower === 'in' || unitLower === '"') isInch = true;
            else {
              if (val > 48) isCm = true;
              else isInch = true;
            }

            const result = [{
              size: 'All',
              inseamCm: isCm ? val : val * 2.54,
              inseamIn: isInch ? val : val / 2.54
            }];
            logToUI(`Found text match for '${keyword}': ${val} (${isCm ? 'cm' : 'in'})`, 'success');
            return result;
          }
        }
      }
    }

    logToUI("No sizing measurements found in page source.", 'error');
    return null;
  }

  // Recursive parser to navigate SHEIN product properties for inseam
  function parseInseamFromSsrData(data) {
    // 1. Check description parameters (goodsAttr list / key value attributes)
    const spec = findSpecificationsInObject(data);
    if (spec && spec.value) {
      const match = spec.value.match(/([\d\.\-]+)\s*(cm|inch|in|")?/i);
      if (match) {
        const valStr = match[1];
        const unitStr = match[2] || '';
        
        const parts = valStr.split('-').map(v => parseFloat(v.trim()));
        const val = parts.reduce((a, b) => a + b, 0) / parts.length;

        if (!isNaN(val)) {
          let isCm = false;
          let isInch = false;
          const unitLower = unitStr.toLowerCase();
          if (unitLower === 'cm') isCm = true;
          else if (unitLower === 'inch' || unitLower === 'in' || unitLower === '"') isInch = true;
          else {
            if (val > 48) isCm = true;
            else isInch = true;
          }
          return [{
            size: 'All',
            inseamCm: isCm ? val : val * 2.54,
            inseamIn: isInch ? val : val / 2.54
          }];
        }
      }
    }

    // 2. Scan size charts recursively
    const results = [];
    
    function recursiveSearch(node) {
      if (!node || typeof node !== 'object') return;

      // Structure A: Node represents a size with measures nested inside
      // e.g. { attribute_value: "S", measures: [ { name: "Inseam", value: "76 cm" } ] }
      const sizeLabel = node.attribute_value || node.size || node.size_name || node.sizeName || node.sizeCode || node.size_code || node.attr_value || node.attrValue;
      const measures = node.measures || node.attrs || node.attr_list || node.attrList || node.measurements;
      
      if (sizeLabel && Array.isArray(measures)) {
        measures.forEach(measure => {
          if (measure && typeof measure === 'object') {
            const mName = measure.name || measure.attr_name || measure.label || measure.attrName || '';
            const mVal = measure.value || measure.attr_val || measure.val || measure.amount || measure.attr_value || measure.attrValue;
            if (isKeywordMatch(mName)) {
              const numVal = parseFloat(String(mVal).replace(/[^\d\.]/g, ''));
              if (!isNaN(numVal)) {
                const isInch = detectIsInch(mName, String(mVal), numVal);
                results.push({
                  size: String(sizeLabel),
                  inseamCm: isInch ? numVal * 2.54 : numVal,
                  inseamIn: isInch ? numVal : numVal / 2.54
                });
              }
            }
          }
        });
      }

      // Structure B: Node is named "Inseam" and has a list of values for each size
      const name = node.attrName || node.name || node.title || node.label || '';
      if (isKeywordMatch(name)) {
        const list = node.attrValList || node.values || node.valList || node.list || [];
        if (Array.isArray(list)) {
          list.forEach((item, index) => {
            let val = null;
            let size = 'Size';

            if (item && typeof item === 'object') {
              val = item.val || item.value || item.attrVal || item.amount || item.attr_value || item.attrValue;
              size = item.size || item.sizeName || item.size_name || item.spec_value || item.attribute_value || `Size ${index + 1}`;
            } else if (typeof item === 'string' || typeof item === 'number') {
              val = item;
              size = `Size ${index + 1}`;
            }

            if (val !== null && val !== undefined) {
              const numVal = parseFloat(String(val).replace(/[^\d\.]/g, ''));
              if (!isNaN(numVal)) {
                const isInch = detectIsInch(name, String(val), numVal);
                results.push({
                  size: String(size),
                  inseamCm: isInch ? numVal * 2.54 : numVal,
                  inseamIn: isInch ? numVal : numVal / 2.54
                });
              }
            }
          });
        }
      }

      if (Array.isArray(node)) {
        node.forEach(child => recursiveSearch(child));
      } else {
        Object.keys(node).forEach(k => {
          if (node[k] && typeof node[k] === 'object') {
            recursiveSearch(node[k]);
          }
        });
      }
    }

    recursiveSearch(data);

    if (results.length > 0) {
      // Deduplicate results
      const seen = new Set();
      return results.filter(item => {
        const key = `${item.size}-${item.inseamIn.toFixed(2)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return null;
  }

  // Traverses nested objects looking for Specifications
  function findSpecificationsInObject(obj) {
    if (!obj || typeof obj !== 'object') return null;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === 'object') {
          const name = item.name || item.attr_name || item.label || item.attrName || '';
          const val = item.value || item.attr_value || item.val || item.attrVal || '';
          if (typeof name === 'string' && typeof val === 'string') {
            if (isKeywordMatch(name)) {
              return { name, value: val };
            }
          }
        }
        const res = findSpecificationsInObject(item);
        if (res) return res;
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (isKeywordMatch(key)) {
          if (typeof val === 'string' || typeof val === 'number') {
            return { name: key, value: String(val) };
          }
        }
        if (val && typeof val === 'object') {
          const res = findSpecificationsInObject(val);
          if (res) return res;
        }
      }
    }
    return null;
  }

  // Local Storage Cache Management
  async function checkCache(productId) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      
      const key = `iss_cache_${productId}`;
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  }

  async function saveToCache(productId, data) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      
      const key = `iss_cache_${productId}`;
      chrome.storage.local.set({ [key]: data }, () => {
        updateCacheIndicator();
        resolve();
      });
    });
  }

  function updateCacheIndicator() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(null, (allData) => {
      const cacheCount = Object.keys(allData).filter(key => key.startsWith('iss_cache_')).length;
      const indicator = document.getElementById('iss-cache-count');
      if (indicator) {
        indicator.textContent = `${cacheCount} items cached`;
      }
    });
  }

  async function clearCache() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    
    chrome.storage.local.get(null, (allData) => {
      const keysToRemove = Object.keys(allData).filter(key => key.startsWith('iss_cache_'));
      chrome.storage.local.remove(keysToRemove, () => {
        // Clear session data too
        sessionScans = {};
        
        // Reset card elements back to "Scan"
        const overlays = document.querySelectorAll('.iss-card-overlay');
        overlays.forEach(overlay => {
          const productId = overlay.dataset.productId;
          const card = overlay.parentElement;
          const link = card.querySelector('a[href*="-p-"]');
          if (!link) return;
          
          const details = {
            productId,
            productUrl: link.href,
            imageUrl: getCardImage(card),
            title: getCardTitle(card),
            card
          };

          overlay.innerHTML = `
            <button class="iss-card-scan-btn" title="Scan detailed sizes for this product">
              <span class="iss-spinner" style="display:none"></span>
              <span>Scan</span>
            </button>
          `;

          const scanBtn = overlay.querySelector('.iss-card-scan-btn');
          scanBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scanSingleProduct(details);
          });
        });

        refreshHistoryList();
        updateStatistics();
        updateCacheIndicator();
      });
    });
  }

  // Load implementation
  init();
})();
