/**
 * Inseam Scanner - background.js
 * 
 * Handles background fetches to bypass page-level CSP and CORS constraints in Firefox MV3.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchProduct') {
    console.log("[Background] Fetching product details from URL:", request.url);
    fetch(request.url, {
      method: 'GET',
      credentials: 'include', // Pass cookies to avoid bot detection/login blocks
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1'
      }
    })
      .then(response => {
        console.log(`[Background] Response status for ${request.url}:`, response.status);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then(html => {
        console.log(`[Background] Response successfully fetched. Length: ${html.length} chars.`);
        sendResponse({ success: true, html: html });
      })
      .catch(err => {
        console.error("[Background] Fetch failed for url:", request.url, err);
        sendResponse({ success: false, error: err.toString() });
      });
    return true; // Keep the message channel open for async response
  }
});
