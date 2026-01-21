// content/content.js - LinkedIn Scraper Content Script
// Single IIFE file - no ES modules, no imports

(function() {
    'use strict';

    // Bump this when debugging “which script is actually running” in Chrome
    const SCRIPT_VERSION = '2025-01-15-linkedin-dom-update-v1';

    // ============================================================
    // CONFIG
    // ============================================================
    const CONFIG = {
        MAX_PAGES: 1000,
        MIN_WAIT_SECONDS: 15,
        MAX_WAIT_SECONDS: 40,
        SCROLL_WAIT_MS: 4000,
        LONG_PAUSE_CHANCE: 0.15,
        LONG_PAUSE_MIN_SECONDS: 45,
        LONG_PAUSE_MAX_SECONDS: 120
    };

    // ============================================================
    // SELECTORS (Updated for LinkedIn January 2025 DOM changes)
    // ============================================================
    const SELECTORS = {
        // Container - find result items
        RESULT_ITEM: 'li',  // Each result is in an <li>
        RESULT_ITEM_INNER: 'div[data-view-name="search-entity-result-universal-template"]',
        
        // Name/Profile Link
        NAME_LINK: 'a[href*="/in/"][data-test-app-aware-link]',
        NAME_TEXT: 'span[dir="ltr"] > span[aria-hidden="true"]',
        NAME_FALLBACK: 'img[alt]',  // Alt attribute of profile photo
        
        // Title - has t-black class
        TITLE_PRIMARY: 'div.t-14.t-black.t-normal',
        TITLE_FALLBACK: 'div[class*="t-14"][class*="t-black"]',
        
        // Location - has t-14 t-normal but NOT t-black
        LOCATION_PRIMARY: 'div.t-14.t-normal:not(.t-black)',
        LOCATION_FALLBACK: 'div[class*="t-14"]:not([class*="t-black"])',
        
        // Pagination
        NEXT_BUTTON: 'button[aria-label="Next"]'
    };

    // ============================================================
    // STATE
    // ============================================================
    let isScrapingActive = false;
    let stopRequested = false;
    let stopButton = null;
    let currentSourceName = '';

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================
    /**
     * Abortable wait - returns early if stopRequested becomes true.
     * This makes "Stop" responsive even during long anti-detection pauses.
     */
    async function wait(ms, checkIntervalMs = 250) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (stopRequested) return;
            const remaining = end - Date.now();
            const chunk = Math.min(checkIntervalMs, Math.max(0, remaining));
            if (chunk <= 0) break;
            await new Promise(resolve => setTimeout(resolve, chunk));
        }
    }

    function randomDelay() {
        const min = CONFIG.MIN_WAIT_SECONDS * 1000;
        const max = CONFIG.MAX_WAIT_SECONDS * 1000;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function shouldTakeLongPause() {
        return Math.random() < CONFIG.LONG_PAUSE_CHANCE;
    }

    function longPauseDelay() {
        const min = CONFIG.LONG_PAUSE_MIN_SECONDS * 1000;
        const max = CONFIG.LONG_PAUSE_MAX_SECONDS * 1000;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function cleanName(text) {
        if (!text) return '';
        // Remove parenthetical content like (CFA) or (MBA)
        return text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    }

    function parseNameWithAccreditations(fullName) {
        if (!fullName) return { cleanName: '', accreditations: ['', '', '', '', '', ''] };
        
        const accreds = [];
        let nameToClean = fullName.trim();
        
        // Step 1: Extract accreditations from parentheses: "John Doe (CFA, MBA)"
        const parenMatches = nameToClean.match(/\(([^)]+)\)/g) || [];
        parenMatches.forEach(match => {
            const content = match.replace(/[()]/g, '');
            // Split by comma if multiple accreditations in parentheses
            const parts = content.split(',').map(s => s.trim()).filter(s => s.length > 0 && s.length <= 25);
            accreds.push(...parts);
            // Remove from name
            nameToClean = nameToClean.replace(match, '').trim();
        });
        
        // Step 2: Extract accreditations after commas: "John Doe, CPFA®, CRPC®"
        // Look for pattern: comma, then short text (2-10 chars) with uppercase/special chars
        const commaParts = nameToClean.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        if (commaParts.length > 1) {
            // Check parts after the first (which should be the name)
            for (let i = 1; i < commaParts.length && accreds.length < 6; i++) {
                const part = commaParts[i];
                // Accreditation pattern: 2-25 chars, mostly uppercase/numbers, may contain ®™©℠
                // Exclude if it looks like location or sentence
                if (part.length >= 2 && part.length <= 25 &&
                    /^[A-Z0-9\s®™©℠]+$/i.test(part) &&
                    !/\b(?:at |and |area|city|state|united states|metropolitan)\b/i.test(part) &&
                    !part.includes('.') && // No periods (likely a sentence)
                    (part.length <= 10 || part.includes('®') || part.includes('™'))) { // Short or has trademark
                    accreds.push(part);
                } else {
                    // Stop if we hit something that doesn't look like an accreditation
                    break;
                }
            }
        }
        
        // Step 3: Clean the name by removing extracted accreditations
        // Remove parentheses content (already done)
        // Remove comma-separated accreditations from the end
        let clean = commaParts[0] || nameToClean; // Take first part (the name)
        clean = clean.replace(/\s+/g, ' ').trim();
        
        // Pad to 6 accreditations
        while (accreds.length < 6) {
            accreds.push('');
        }
        
        return {
            cleanName: clean,
            accreditations: accreds.slice(0, 6)
        };
    }

    function sendMessageSafe(message, callback) {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.warn('[CS] ⚠️ Extension context invalidated - cannot send message');
            if (callback) callback(null);
            return;
        }
        
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message || '';
                    
                    // Handle extension context invalidated error gracefully
                    if (errorMsg.includes('Extension context invalidated') || 
                        errorMsg.includes('message port closed') ||
                        errorMsg.includes('Receiving end does not exist')) {
                        console.warn('[CS] ⚠️ Extension context invalidated - extension may have been reloaded');
                        console.warn('[CS] This is normal when the extension is reloaded during an active scrape');
                        // Reset scraping state since extension context is gone
                        isScrapingActive = false;
                        stopRequested = false;
                        removeStopButton();
                    } else {
                        console.warn('[CS] Message error:', errorMsg);
                    }
                    if (callback) callback(null);
                } else {
                    if (callback) callback(response);
                }
            });
        } catch (error) {
            // Handle errors when trying to send message
            if (error.message?.includes('Extension context invalidated') || 
                error.message?.includes('message port closed')) {
                console.warn('[CS] ⚠️ Extension context invalidated - cannot send message');
                isScrapingActive = false;
                stopRequested = false;
                removeStopButton();
            } else {
                console.error('[CS] Error sending message:', error);
            }
            if (callback) callback(null);
        }
    }

    // ============================================================
    // LINKEDIN AUTH STATUS CHECK
    // ============================================================

    /**
     * Check if a DOM element is actually visible (ignore hidden/inert elements).
     * @param {Element|null} el
     * @returns {boolean}
     */
    function isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return false;
        return true;
    }

    /**
     * Determine LinkedIn auth status on the current tab.
     * @returns {{status: 'ok'|'signed_out'|'checkpoint', message: string, url: string}}
     */
    function checkLinkedInAuthStatus() {
        const url = window.location.href || '';

        // URL-based detection (fast + reliable)
        if (
            url.includes('/login') ||
            url.includes('/uas/login') ||
            url.includes('/authwall') ||
            url.includes('linkedin.com/m/login')
        ) {
            return { status: 'signed_out', message: 'Redirected to LinkedIn login/authwall', url };
        }

        if (
            url.includes('/checkpoint/') ||
            url.includes('/challenge/') ||
            url.includes('/security/') ||
            url.includes('/uas/consumer-email-challenge')
        ) {
            return { status: 'checkpoint', message: 'LinkedIn security checkpoint/challenge URL detected', url };
        }

        // DOM-based detection (guarded by visibility checks)
        const loginSelectors = [
            'form[action*="login"]',
            'form[action*="uas/login"]',
            'input#username',
            'input#password',
            'input[name="session_key"]',
            'input[name="session_password"]'
        ];

        for (const selector of loginSelectors) {
            const el = document.querySelector(selector);
            if (el && isElementVisible(el)) {
                return { status: 'signed_out', message: `Login UI detected (${selector})`, url };
            }
        }

        // Checkpoint / CAPTCHA UI (only if visibly present)
        const checkpointSelectors = [
            '[class*="checkpoint"]',
            '[class*="challenge"]',
            '[data-test*="challenge"]',
            '[data-test*="checkpoint"]',
            'form[action*="checkpoint"]',
            '#email-pin-challenge',
            '.checkpoint-challenge',
            '.challenge-dialog'
        ];

        for (const selector of checkpointSelectors) {
            const el = document.querySelector(selector);
            if (el && isElementVisible(el)) {
                return { status: 'checkpoint', message: `Checkpoint/challenge UI detected (${selector})`, url };
            }
        }

        const captchaSelectors = [
            '.captcha',
            '#captcha',
            '[id*="captcha"]',
            'iframe[src*="captcha"]'
        ];
        for (const selector of captchaSelectors) {
            const el = document.querySelector(selector);
            if (el && isElementVisible(el)) {
                return { status: 'checkpoint', message: `Visible CAPTCHA detected (${selector})`, url };
            }
        }

        return { status: 'ok', message: 'Authenticated', url };
    }

    // ============================================================
    // CARD FINDING
    // ============================================================
    function findProfileCards() {
        const cards = [];
        const seenUrls = new Set();
        
        // Find all <li> elements that are ACTUAL search results
        // Key: look for li elements that contain the result template
        const resultItems = document.querySelectorAll('li');
        
        resultItems.forEach(li => {
            // FILTER 1: Must have the search result template marker
            // This excludes "mutual connections", sidebar items, etc.
            const hasResultTemplate = li.querySelector('[data-view-name="search-entity-result-universal-template"]') ||
                                      li.querySelector('div.linked-area') ||
                                      li.className.includes('reusable-search');
            
            if (!hasResultTemplate) {
                // Check if it at least has the expected structure
                const hasExpectedStructure = li.querySelector('div.mb1') && 
                                             li.querySelector('div.t-14');
                if (!hasExpectedStructure) return;
            }
            
            // FILTER 2: Must contain a profile link with data-test attribute
            const profileLink = li.querySelector('a[href*="/in/"][data-test-app-aware-link]');
            if (!profileLink) return;
            
            // FILTER 3: Must NOT be inside a "mutual connections" or insights section
            const isInInsights = li.querySelector('.entity-result__insights')?.contains(profileLink) ||
                                profileLink.closest('.entity-result__insights') ||
                                profileLink.closest('[class*="insight"]') ||
                                profileLink.closest('[class*="mutual"]');
            if (isInInsights) return;
            
            // FILTER 4: The profile link should be in the main content area, not in secondary text
            const isInButton = profileLink.closest('button, [role="button"], .artdeco-button');
            if (isInButton) return;
            
            // Get URL and check for duplicates
            const url = profileLink.href?.split('?')[0] || '';
            if (!url.includes('/in/') || seenUrls.has(url)) return;
            seenUrls.add(url);
            
            // Get name from the correct location (not from img alt which might be wrong)
            let nameText = '';
            
            // Try the name span first (most reliable)
            const nameSpan = li.querySelector('span[dir="ltr"] > span[aria-hidden="true"]');
            if (nameSpan) {
                nameText = nameSpan.innerText?.trim() || '';
            }
            
            // Fallback: img alt (but only if it's the main profile image)
            if (!nameText) {
                const img = li.querySelector('.presence-entity__image[alt], img.EntityPhoto-circle-3[alt]');
                if (img) nameText = img.alt?.trim() || '';
            }
            
            // FILTER 5: Validate the name looks like a real name
            // Skip if name is empty, too short, or looks like UI text
            if (!nameText || nameText.length < 3) return;
            if (/^(connect|message|follow|view|see\s)/i.test(nameText)) return;
            if (/mutual|connection|degree/i.test(nameText)) return;
            
            // FILTER 6: Must have title or location to be a valid card
            const hasTitle = li.querySelector('div.t-14.t-black.t-normal');
            const hasLocation = li.querySelector('div.t-14.t-normal:not(.t-black)');
            
            if (!hasTitle && !hasLocation) {
                // This is likely not a proper search result card
                console.log(`[CS] Skipping "${nameText}" - no title/location divs found`);
                return;
            }
            
            cards.push({
                card: li,
                nameLink: profileLink,
                nameText: nameText
            });
        });
        
        console.log(`[CS] Found ${cards.length} valid profile cards`);
        return cards;
    }

    function findCardContainer(nameLink) {
        // Walk up to find the <li> element
        let current = nameLink;
        while (current && current.tagName !== 'LI') {
            current = current.parentElement;
        }
        return current;
    }

    // ============================================================
    // CONTENT PATTERN VALIDATION
    // ============================================================
    function looksLikeLocation(text) {
        if (!text) return false;
        
        const locationPatterns = [
            /\b(?:Area|Metropolitan|County|Region)\s*$/i,
            /^[A-Z][a-z]+,\s*[A-Z]{2}$/,  // "City, ST" format
            /\b(?:United States|USA|Greater|Bay Area)\b/i,
            /,\s*[A-Z]{2}$/,  // Ends with ", TX" etc.
            /\b(?:New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose)\b/i
        ];
        
        return locationPatterns.some(p => p.test(text));
    }

    function looksLikeTitle(text) {
        if (!text) return false;
        
        const titlePatterns = [
            /\bat\s+[A-Z]/i,
            /\s*\|\s*/,
            /\b(?:Financial|Investment|Wealth|Advisor|Manager|Director|Principal|Owner|Partner|Planner)\b/i,
            /Financial (?:Advisor|Planner|Consultant)/i,
            /Wealth (?:Manager|Advisor)/i,
            /Investment (?:Advisor|Manager)/i
        ];
        
        return titlePatterns.some(p => p.test(text));
    }

    // ============================================================
    // LAYER 0: STRUCTURE-AWARE EXTRACTION
    // ============================================================
    function findAllTextElementsInCard(card, nameLink) {
        const textElements = [];
        const nameLinkRect = nameLink.getBoundingClientRect();
        const nameText = nameLink.innerText.trim().toLowerCase();

        // Updated to look for div elements with utility classes instead of p tags
        const candidates = card.querySelectorAll('div.t-14.t-black.t-normal, div.t-14.t-normal:not(.t-black)');
        
        candidates.forEach((el) => {
            const text = el.innerText?.trim();
            
            if (!text || text.length < 3) return;
            if (text.toLowerCase() === nameText) return;
            if (nameLink.contains(el)) return;
            if (el.closest('button, [role="button"]')) return;
            
            const skipPatterns = [
                /^connect$/i, /^message$/i, /^follow$/i, /^see all/i,
                /^\d+ mutual/i, /and \d+ other mutual connections/i,
                /^view profile$/i, /^•\s*(1st|2nd|3rd)/i,
                /mutual connection/i, /other mutual/i
            ];
            if (skipPatterns.some(p => p.test(text))) return;
            
            const elRect = el.getBoundingClientRect();
            const verticalOffset = elRect.top - nameLinkRect.top;

            textElements.push({
                element: el,
                text: text,
                verticalOffset: verticalOffset
            });
        });

        textElements.sort((a, b) => a.verticalOffset - b.verticalOffset);
        const belowName = textElements.filter(el => el.verticalOffset > 5);
        
        return belowName.slice(0, 2);
    }

    function identifyTitleAndLocation(textElements, nameLink) {
        const belowName = textElements.filter(el => el.verticalOffset > 5);

        if (belowName.length === 0) {
            return { title: '', location: '' };
        }

        let titleCandidate = belowName[0]?.text || '';
        let locationCandidate = belowName[1]?.text || '';

        if (looksLikeLocation(titleCandidate) && looksLikeTitle(locationCandidate)) {
            [titleCandidate, locationCandidate] = [locationCandidate, titleCandidate];
        }

        return {
            title: titleCandidate,
            location: locationCandidate
        };
    }

    function extractByStructure(card) {
        try {
            const nameLink = card.querySelector('a[href*="/in/"]');
            if (!nameLink) return null;

            const textElements = findAllTextElementsInCard(card, nameLink);
            if (textElements.length < 2) return null;

            const result = identifyTitleAndLocation(textElements, nameLink);
            
            if (result.title || result.location) {
                return {
                    title: result.title || '',
                    location: result.location || '',
                    method: 'structure-aware'
                };
            }

            return null;
        } catch (error) {
            console.warn('[CS] Structure extraction error:', error);
            return null;
        }
    }

    // ============================================================
    // LAYER 2: DIRECT TEXT EXTRACTION (Updated for div-based structure)
    // ============================================================
    function directTextExtraction(card, nameLink) {
        // LinkedIn no longer uses <p> tags - use <div> with utility classes
        const { title, location } = extractTitleAndLocation(card);
        return { title, location };
    }
    
    // ============================================================
    // TITLE AND LOCATION EXTRACTION
    // ============================================================
    function extractTitleAndLocation(card) {
        let title = '';
        let location = '';
        
        // Find the text container (usually has class "mb1")
        const textContainer = card.querySelector('div.mb1') || card;
        
        // Title: div with t-14, t-black, t-normal
        const titleEl = textContainer.querySelector('div.t-14.t-black.t-normal');
        if (titleEl) {
            title = titleEl.innerText?.trim() || '';
        }
        
        // Location: div with t-14, t-normal but NOT t-black
        // It's usually the sibling after title
        const allDivs = textContainer.querySelectorAll('div.t-14.t-normal');
        allDivs.forEach(div => {
            if (!div.classList.contains('t-black')) {
                const text = div.innerText?.trim() || '';
                // Validate it looks like a location
                if (text && !location && looksLikeLocation(text)) {
                    location = text;
                }
            }
        });
        
        // Fallback: if no location found, get second t-14 div
        if (!location) {
            const t14Divs = textContainer.querySelectorAll('div[class*="t-14"]');
            if (t14Divs.length >= 2) {
                const secondDiv = t14Divs[1];
                if (!secondDiv.classList.contains('t-black')) {
                    location = secondDiv.innerText?.trim() || '';
                }
            }
        }
        
        return { title, location };
    }

    // ============================================================
    // DATA EXTRACTION - MULTI-LAYER APPROACH
    // ============================================================
    function extractProfileData(cardInfo, sourceName) {
        const { card, nameLink, nameText } = cardInfo;
        
        // Validate that we have a valid name and URL
        if (!nameLink || !nameText || !nameText.trim()) {
            console.warn('[CS] WARNING: Skipping card: no valid name link or name text');
            return null;
        }
        
        const { cleanName, accreditations } = parseNameWithAccreditations(nameText);
        
        // Validate clean name is not empty
        if (!cleanName || !cleanName.trim()) {
            console.warn('[CS] WARNING: Skipping card: name is empty after cleaning');
            return null;
        }
        
        // Extract URL - must be a profile URL, not search results
        let url = nameLink.href?.split('?')[0] || '';
        if (!url || !url.includes('/in/')) {
            console.warn('[CS] WARNING: Skipping card: invalid profile URL', url);
            return null;
        }
        
        let title = '';
        let location = '';
        let extractionMethod = 'none';
        
        // LAYER 0: Structure-aware extraction
        const structureResult = extractByStructure(card);
        if (structureResult && (structureResult.title || structureResult.location)) {
            title = structureResult.title;
            location = structureResult.location;
            extractionMethod = structureResult.method;
        } else {
            // LAYER 1: New div-based extraction using utility classes
            const titleAndLocation = extractTitleAndLocation(card);
            title = titleAndLocation.title;
            location = titleAndLocation.location;
            
            // Fallback to primary selectors if extractionTitleAndLocation didn't work
            if (!title) {
                const titleElPrimary = card.querySelector(SELECTORS.TITLE_PRIMARY);
                if (titleElPrimary) title = titleElPrimary.innerText?.trim() || '';
            }
            if (!location) {
                const locationElPrimary = card.querySelector(SELECTORS.LOCATION_PRIMARY);
                if (locationElPrimary) location = locationElPrimary.innerText?.trim() || '';
            }
            
            // Additional fallbacks
            if (!title) {
                const titleElFallback = card.querySelector(SELECTORS.TITLE_FALLBACK);
                if (titleElFallback) title = titleElFallback.innerText?.trim() || '';
            }
            if (!location) {
                const locationElFallback = card.querySelector(SELECTORS.LOCATION_FALLBACK);
                if (locationElFallback) location = locationElFallback.innerText?.trim() || '';
            }
            
            extractionMethod = (title || location) ? 'class-selectors' : 'none';
        }
        
        // LAYER 2: Direct text extraction fallback
        if (!title || !location) {
            const fallback = directTextExtraction(card, nameLink);
            if (!title && fallback.title) {
                title = fallback.title;
                extractionMethod = extractionMethod === 'none' ? 'direct-text' : extractionMethod + '+direct-text';
            }
            if (!location && fallback.location) {
                location = fallback.location;
                extractionMethod = extractionMethod === 'none' ? 'direct-text' : extractionMethod + '+direct-text';
            }
        }
        
        // LAYER 3: Content validation - swap if misidentified
        if (title && location) {
            const titleLooksLikeLocation = looksLikeLocation(title);
            const locationLooksLikeTitle = looksLikeTitle(location);
            
            if (titleLooksLikeLocation && locationLooksLikeTitle) {
                [title, location] = [location, title];
                extractionMethod += '+content-swap';
            }
        }
        
        if (!title && !location) {
            console.warn('[CS] WARNING: Failed to extract title and location for:', cleanName);
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        return [
            today,
            cleanName,
            title,
            location,
            sourceName,
            url,
            ...accreditations
        ];
    }

    // ============================================================
    // SCRAPING FUNCTIONS
    // ============================================================
    async function waitForEntriesToLoad(expected, timeout = 20000) {
        const startTime = Date.now();
        let lastCount = 0;
        let noChangeCount = 0;
        
        while (Date.now() - startTime < timeout) {
            if (stopRequested) return false;
            
            const cards = findProfileCards();
            const currentCount = cards.length;
            
            // If we found enough cards, return true
            if (currentCount >= expected) {
                console.log(`[CS] Found ${currentCount} profile cards (needed ${expected})`);
                return true;
            }
            
            // Track if count is changing (page is still loading)
            if (currentCount === lastCount) {
                noChangeCount++;
            } else {
                noChangeCount = 0;
                console.log(`[CS] Found ${currentCount} profile cards so far (waiting for more...)`);
            }
            
            // If count hasn't changed for several checks, page might be done loading
            // But still wait a bit more in case it's a slow-loading page (increased for Pi)
            if (noChangeCount >= 6 && currentCount > 0) {
                console.log(`[CS] Card count stable at ${currentCount} - page likely done loading`);
                return currentCount >= expected;
            }
            
            lastCount = currentCount;
            await wait(500);
        }
        
        // Final check
        const finalCards = findProfileCards();
        console.log(`[CS] Timeout reached - found ${finalCards.length} profile cards`);
        return finalCards.length >= expected;
    }

    async function scrapeCurrentPage(sourceName) {
        // Scroll to bottom to trigger lazy loading
        window.scrollTo(0, document.body.scrollHeight);
        await wait(CONFIG.SCROLL_WAIT_MS);
        
        // Additional scrolls to ensure all content loads
        for (let i = 0; i < 3; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await wait(1000);
        }
        
        // Extra wait for slower machines (like Pi) - let page settle
        await wait(2000);
        
        const cards = findProfileCards();
        console.log(`[CS] Found ${cards.length} profile cards on page`);
        
        // If no cards found, log diagnostic info
        if (cards.length === 0) {
            console.warn('[CS] WARNING: No profile cards found - checking page state...');
            console.warn(`[CS] Current URL: ${window.location.href}`);
            console.warn(`[CS] Page title: ${document.title}`);
            
            // Check if we're on a search results page
            const isSearchPage = window.location.href.includes('/search/results/people');
            console.warn(`[CS] Is search results page: ${isSearchPage}`);
            
            // Check for common LinkedIn elements
            const hasSearchContainer = document.querySelector('ul.reusable-search__entity-result-list') ||
                                      document.querySelector('div[class*="search-results"]') ||
                                      document.querySelector('ul[class*="results"]');
            console.warn(`[CS] Has search container: ${!!hasSearchContainer}`);
            
            // Check for any profile links at all
            const anyProfileLinks = document.querySelectorAll('a[href*="/in/"]');
            console.warn(`[CS] Total links with /in/: ${anyProfileLinks.length}`);
            
            // Check for loading indicators
            const loadingIndicators = document.querySelectorAll('[class*="loading"], [class*="skeleton"], [aria-busy="true"]');
            console.warn(`[CS] Loading indicators found: ${loadingIndicators.length}`);
        }
        
        const rows = [];
        const seenUrls = new Set(); // Track seen URLs to avoid duplicates
        const searchName = document.title || window.location.href; // Use page title or URL as search name
        
        for (const cardInfo of cards) {
            if (stopRequested) break;
            
            try {
                const row = extractProfileData(cardInfo, sourceName);
                
                // Skip null results (invalid cards) - these are logged in extractProfileData
                if (!row) continue;
                
                // Check for duplicates by URL (column index 5)
                const url = row[5];
                if (url && seenUrls.has(url)) {
                    console.warn('[CS] WARNING: Skipping duplicate URL:', url);
                    continue;
                }
                
                if (url) seenUrls.add(url);
                rows.push(row);
            } catch (error) {
                // Extract person name if possible for error reporting
                const personName = cardInfo?.nameText || cardInfo?.nameLink?.innerText?.trim() || 'Unknown Person';
                const errorMessage = error?.message || String(error) || 'Unknown error';
                const errorStack = error?.stack || '';
                
                console.error('[CS] Error extracting profile:', error);
                
                // Send error notification to service worker for webhook
                sendMessageSafe({
                    action: 'SCRAPE_ERROR',
                    personName: personName,
                    searchName: searchName,
                    failureType: 'parse_error',
                    error: errorMessage,
                    errorDetails: {
                        stack: errorStack,
                        url: cardInfo?.nameLink?.href || window.location.href,
                        timestamp: new Date().toISOString(),
                        sourceName: currentSourceName // Connection Source from Input Sheet
                    }
                });
            }
        }
        
        console.log(`[CS] Extracted ${rows.length} valid profiles (filtered ${cards.length - rows.length} invalid/duplicates)`);
        return rows;
    }

    // ============================================================
    // EMPTY STATE DETECTION
    // ============================================================
    /**
     * Detects if the current page is an empty results page
     * This MUST be checked BEFORE checking pagination or attempting to scrape
     * @returns {Object} { isEmpty: boolean, reason: string, profileCount: number }
     */
    function detectEmptyResultsState() {
        // Method 1: Check for empty state UI elements (most reliable on truly empty pages)
        const emptyStateSelectors = [
            '.search-reusable-search-no-results',
            '.artdeco-empty-state',
            'h2.artdeco-empty-state__headline'
        ];
        
        for (const selector of emptyStateSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`[CS] Empty state detected via selector: ${selector}`);
                return { 
                    isEmpty: true, 
                    reason: `Empty state element found: ${selector}`,
                    profileCount: 0
                };
            }
        }
        
        // Method 2: Check the results header for "No results found" text
        const resultsHeader = document.querySelector('.search-results-container h2');
        if (resultsHeader && resultsHeader.textContent.toLowerCase().includes('no results')) {
            console.log('[CS] Empty state detected via results header text');
            return { 
                isEmpty: true, 
                reason: 'Results header contains "no results"',
                profileCount: 0
            };
        }
        
        // Method 3: Count actual profile elements using the reliable data attribute
        // This is the MOST reliable method since class names are obfuscated
        const profileElements = document.querySelectorAll('[data-chameleon-result-urn]');
        const profileCount = profileElements.length;
        
        console.log(`[CS] Profile count via [data-chameleon-result-urn]: ${profileCount}`);
        
        if (profileCount === 0) {
            // Double-check by looking for the results list container
            const resultsContainer = document.querySelector('.search-results-container');
            if (resultsContainer) {
                // Container exists but no profiles - this is an empty page
                console.log('[CS] Results container exists but no profiles found');
                return { 
                    isEmpty: true, 
                    reason: 'Results container present but zero profiles',
                    profileCount: 0
                };
            }
        }
        
        return { 
            isEmpty: false, 
            reason: profileCount > 0 ? `Found ${profileCount} profiles` : 'Page state unclear',
            profileCount: profileCount
        };
    }

    function detectPaginationState() {
        // FIRST: Check for empty state before anything else
        const emptyCheck = detectEmptyResultsState();
        
        const nextButton = document.querySelector(SELECTORS.NEXT_BUTTON);
        
        // Check if button exists and is enabled
        const hasNext = nextButton !== null && !nextButton.disabled;
        
        // Additional check: if button exists but has aria-disabled="true", it's disabled
        const isAriaDisabled = nextButton?.getAttribute('aria-disabled') === 'true';
        
        // Check if button is visually hidden (LinkedIn sometimes hides it on last page)
        const isHidden = nextButton && (
            nextButton.offsetParent === null || 
            nextButton.style.display === 'none' ||
            window.getComputedStyle(nextButton).display === 'none'
        );
        
        const actuallyHasNext = hasNext && !isAriaDisabled && !isHidden;
        
        // Get current page number from URL
        const urlParams = new URLSearchParams(window.location.search);
        const currentPage = parseInt(urlParams.get('page')) || 1;
        
        // Get current page from active button (fallback)
        const activePageButton = document.querySelector('button[aria-current="true"]');
        const activePageNum = activePageButton ? parseInt(activePageButton.textContent.trim()) : currentPage;
        
        return {
            hasNext: actuallyHasNext,
            button: nextButton,
            currentPage: activePageNum || currentPage,
            // NEW: Add empty state info to pagination state
            isEmpty: emptyCheck.isEmpty,
            emptyReason: emptyCheck.reason,
            profileCount: emptyCheck.profileCount,
            details: {
                exists: nextButton !== null,
                disabled: nextButton?.disabled || false,
                ariaDisabled: isAriaDisabled,
                hidden: isHidden
            }
        };
    }

    async function clickNextButton() {
        const pagination = detectPaginationState();
        
        if (!pagination.hasNext || !pagination.button) {
            return false;
        }
        
        pagination.button.click();
        await wait(2000);
        
        return true;
    }

    // ============================================================
    // STOP BUTTON UI
    // ============================================================
    function createStopButton() {
        if (stopButton) return;
        
        stopButton = document.createElement('button');
        stopButton.id = 'savvy-pirate-stop-btn';
        stopButton.innerHTML = 'STOP Scraping';
        stopButton.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            background: #dc3545;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        
        stopButton.addEventListener('click', async () => {
            stopRequested = true;
            updateButtonStatus('Stopping...', '#ffc107');
            
            // Notify service worker to stop auto-run (for scheduled scrapes)
            // This ensures the scheduled scrape is properly aborted
            try {
                // Check if extension context is still valid
                if (!chrome.runtime?.id) {
                    console.warn('[CS] ⚠️ Extension context invalidated - cannot send STOP_AUTO_RUN');
                    return;
                }
                await chrome.runtime.sendMessage({ action: 'STOP_AUTO_RUN' });
            } catch (e) {
                const errorMsg = e?.message || String(e) || '';
                if (errorMsg.includes('Extension context invalidated') || 
                    errorMsg.includes('message port closed')) {
                    console.warn('[CS] ⚠️ Extension context invalidated - cannot send STOP_AUTO_RUN');
                } else {
                    console.warn('[CS] Failed to send STOP_AUTO_RUN message:', e);
                }
            }
            
            // Also send STOP_SCRAPING to ensure content script stops
            // (This is handled by the message listener, but sending it explicitly ensures it's processed)
        });
        
        document.body.appendChild(stopButton);
    }

    function removeStopButton() {
        if (stopButton) {
            stopButton.remove();
            stopButton = null;
        }
    }

    function updateButtonStatus(text, color) {
        if (stopButton) {
            stopButton.innerHTML = text;
            stopButton.style.background = color;
        }
    }

    // ============================================================
    // MAIN SCRAPING LOOP
    // ============================================================
    async function startScraping(sourceName, maxPagesOverride) {
        if (isScrapingActive) {
            console.warn('[CS] Scraping already active');
            return;
        }
        
        isScrapingActive = true;
        stopRequested = false;
        currentSourceName = sourceName;
        const maxPages = Number.isFinite(maxPagesOverride) ? Math.max(1, Math.min(1000, maxPagesOverride)) : CONFIG.MAX_PAGES;
        
        console.log(`[CS] 🚀 Starting scrape for source: ${sourceName}`);
        
        createStopButton();
        
        let totalProfiles = 0;
        let totalPages = 0;
        let consecutiveEmptyPages = 0;
        const MAX_CONSECUTIVE_EMPTY = 2; // Stop after 2 empty pages in a row
        
        try {
            while (totalPages < maxPages && !stopRequested) {
                // =========================================================================
                // NEW: Check for empty state FIRST, before waiting for entries
                // This prevents getting stuck on empty pagination pages
                // =========================================================================
                
                // Give the page a moment to render
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const emptyCheck = detectEmptyResultsState();
                
                if (emptyCheck.isEmpty) {
                    console.log(`[CS] ✅ EMPTY PAGE DETECTED: ${emptyCheck.reason}`);
                    console.log('[CS] Stopping pagination for this search - moving to next search');
                    break; // EXIT the pagination loop, move to next search
                }
                
                // =========================================================================
                // END NEW SECTION - Continue with existing entry loading logic
                // =========================================================================
                
                // Wait for entries to load (with timeout handling)
                const entriesLoaded = await waitForEntriesToLoad(1, 20000);
                
                if (!entriesLoaded) {
                    console.warn('[CS] WARNING: Timeout waiting for entries to load');
                    
                    // MODIFIED: Check empty state again after timeout
                    const postTimeoutCheck = detectEmptyResultsState();
                    
                    if (postTimeoutCheck.isEmpty) {
                        console.log('[CS] ✅ Empty state confirmed after timeout - stopping pagination');
                        break;
                    }
                    
                    // Only check pagination if we're NOT on an empty page
                    const pagination = detectPaginationState();
                    
                    // MODIFIED: Also check if pagination says we're on an empty page
                    if (pagination.isEmpty || pagination.profileCount === 0) {
                        console.log('[CS] ✅ No profiles found - stopping pagination');
                        break;
                    }
                    
                    if (!pagination.hasNext) {
                        console.log('[CS] OK: No next button found after timeout - assuming last page');
                        break;
                    }
                    
                    // Only continue if we have reason to believe there might be results
                    console.log('[CS] WARNING: Entries didn\'t load but page may have results - continuing cautiously');
                }
                
                // Scrape current page
                const rows = await scrapeCurrentPage(sourceName);
                
                // Track consecutive empty pages
                if (rows.length === 0) {
                    consecutiveEmptyPages++;
                    console.log(`[CS] Warning: Empty page scraped. Consecutive empty pages: ${consecutiveEmptyPages}`);
                    
                    if (consecutiveEmptyPages >= MAX_CONSECUTIVE_EMPTY) {
                        console.log(`[CS] ✅ ${MAX_CONSECUTIVE_EMPTY} consecutive empty pages - stopping pagination`);
                        break;
                    }
                } else {
                    consecutiveEmptyPages = 0; // Reset counter when we find results
                }
                
                if (rows.length > 0) {
                    totalProfiles += rows.length;
                    totalPages++;
                    
                    // Send data to background
                    sendMessageSafe({
                        action: 'DATA_SCRAPED',
                        rows: rows,
                        pageNumber: totalPages
                    });
                    
                    console.log(`[CS] OK: Page ${totalPages}: Scraped ${rows.length} profiles (Total: ${totalProfiles})`);
                } else {
                    // If we scraped 0 profiles, check if we're on the last page
                    console.warn('[CS] WARNING: No profiles found on this page');
                    const pagination = detectPaginationState();
                    
                    // NEW: Check for empty state before checking next button
                    if (pagination.isEmpty || pagination.profileCount === 0) {
                        console.log('[CS] ✅ Current page is empty - stopping pagination');
                        console.log(`[CS] Reason: ${pagination.emptyReason}`);
                        break;
                    }
                    
                    if (!pagination.hasNext) {
                        console.log('[CS] OK: No profiles and no next button - assuming last page');
                        break;
                    }
                }
                
            if (stopRequested) {
                console.log('[CS] STOP: Stop requested by user');
                break;
            }
            
            // Check pagination state
            const pagination = detectPaginationState();
            
            // NEW: Safety check - don't click next if page is empty
            if (pagination.isEmpty || pagination.profileCount === 0) {
                console.log('[CS] ✅ Current page is empty - stopping before clicking next');
                console.log(`[CS] Reason: ${pagination.emptyReason}`);
                break;
            }
            
            // Try to go to next page
            if (pagination.hasNext && totalPages < maxPages && !pagination.isEmpty) {
                console.log(`[CS] Navigating to page ${totalPages + 1}...`);
                const hasNext = await clickNextButton();
                
                if (!hasNext) {
                    console.log('[CS] OK: No more pages available');
                    break;
                }
                
                // Wait for new page to load
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // NEW: Immediately check if new page is empty
                const newPageCheck = detectEmptyResultsState();
                if (newPageCheck.isEmpty) {
                    console.log('[CS] ✅ New page is empty after navigation - stopping');
                    break;
                }
            } else {
                console.log('[CS] No more pages or reached max - ending pagination');
                break;
            }
            
            // Random delay between pages
            const delay = randomDelay();
            console.log(`[CS] Waiting ${(delay/1000).toFixed(1)}s before next page...`);
            await wait(delay);
            
            // Occasional long pause to simulate user distraction
            if (shouldTakeLongPause()) {
                const longDelay = longPauseDelay();
                console.log(`[CS] Taking a break... ${(longDelay/1000).toFixed(0)}s (simulating user distraction)`);
                await wait(longDelay);
            }
        }
        
        const wasAborted = stopRequested;
        console.log(`[CS] OK: Scraping ${wasAborted ? 'stopped' : 'complete'}: ${totalProfiles} profiles from ${totalPages} pages`);
        
        // Send completion message
        sendMessageSafe({
            action: 'SCRAPING_COMPLETE',
            totalProfiles: totalProfiles,
            totalPages: totalPages,
            aborted: wasAborted
        });
            
        } catch (error) {
            const errorMessage = error?.message || String(error) || 'Unknown error';
            const isContextInvalidated = errorMessage.includes('Extension context invalidated') ||
                                        errorMessage.includes('message port closed') ||
                                        errorMessage.includes('Receiving end does not exist');
            
            if (isContextInvalidated) {
                console.warn('[CS] ⚠️ Extension context invalidated - extension was reloaded during scrape');
                console.warn('[CS] This is normal when the extension is reloaded. Scraping will stop.');
                // Don't try to send messages if context is invalidated
            } else {
                console.error('[CS] ❌ Scraping error:', error);
                
                // Send detailed error notification (only if context is still valid)
                const searchUrl = window.location.href;
                const searchName = document.title || searchUrl;
                sendMessageSafe({
                    action: 'SCRAPE_ERROR',
                    personName: 'Scraping Process',
                    searchName: searchName,
                    failureType: error.name === 'TimeoutError' ? 'timeout_error' : 
                                error.message?.includes('selector') ? 'selector_error' :
                                error.message?.includes('network') ? 'network_error' : 'scraping_error',
                    error: errorMessage,
                    errorDetails: {
                        stack: error.stack,
                        url: searchUrl,
                        sourceName: sourceName,
                        totalProfiles,
                        totalPages,
                        timestamp: new Date().toISOString()
                    }
                });
                
                sendMessageSafe({
                    action: 'SCRAPING_COMPLETE',
                    totalProfiles: totalProfiles,
                    totalPages: totalPages,
                    error: errorMessage
                });
            }
        } finally {
            // Always reset state, even if extension context is invalidated
            isScrapingActive = false;
            removeStopButton();
            stopRequested = false;
        }
    }

    // ============================================================
    // MESSAGE LISTENER
    // ============================================================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Check if extension context is still valid
        if (!chrome.runtime?.id) {
            console.warn('[CS] ⚠️ Extension context invalidated - cannot process message');
            sendResponse({ success: false, error: 'Extension context invalidated' });
            return false;
        }
        
        const { action } = message;
        
        console.log(`[CS] 📩 Received: ${action}`);
        
        switch (action) {
            case 'START_SCRAPING':
                const sourceName = message.sourceName || 'Unknown';
                startScraping(sourceName, message.maxPages).catch(error => {
                    const errorMessage = error?.message || String(error) || 'Unknown error';
                    const isContextInvalidated = errorMessage.includes('Extension context invalidated') ||
                                                errorMessage.includes('message port closed');
                    
                    if (isContextInvalidated) {
                        console.warn('[CS] ⚠️ Extension context invalidated when starting scrape');
                        console.warn('[CS] Extension may have been reloaded. Please reload the page and try again.');
                    } else {
                        console.error('[CS] Start scraping error:', error);
                    }
                });
                sendResponse({ success: true });
                return true;
                
            case 'STOP_SCRAPING':
                stopRequested = true;
                sendResponse({ success: true });
                return true;
                
            case 'GET_STATUS':
                sendResponse({
                    success: true,
                    isScrapingActive: isScrapingActive,
                    currentSourceName: currentSourceName
                });
                return true;
                
            case 'PING':
                sendResponse({ success: true, status: 'alive' });
                return true;

            case 'CHECK_LINKEDIN_AUTH': {
                const authStatus = checkLinkedInAuthStatus();
                sendResponse(authStatus);
                return true;
            }
                
            default:
                sendResponse({ success: false, error: 'Unknown action' });
                return true;
        }
    });

    // ============================================================
    // DIAGNOSTIC FUNCTION (exposed to console for debugging)
    // ============================================================
    /**
     * Run diagnostic test on current page to see what profiles would pass filters
     * Usage: In browser console, type: window.savvyPirateDiagnostic()
     */
    function runDiagnostic() {
        console.log('🔍 Savvy Pirate Diagnostic Test');
        console.log('================================\n');
        
        const resultItems = document.querySelectorAll('li');
        let validCount = 0;
        let skippedReasons = {};
        
        resultItems.forEach(li => {
            const profileLink = li.querySelector('a[href*="/in/"][data-test-app-aware-link]');
            if (!profileLink) return;
            
            const nameSpan = li.querySelector('span[dir="ltr"] > span[aria-hidden="true"]');
            const hasTitle = li.querySelector('div.t-14.t-black.t-normal');
            const hasLocation = li.querySelector('div.t-14.t-normal:not(.t-black)');
            const isInInsights = profileLink.closest('[class*="insight"]') || profileLink.closest('[class*="mutual"]');
            const hasResultTemplate = li.querySelector('[data-view-name="search-entity-result-universal-template"]');
            const hasExpectedStructure = li.querySelector('div.mb1') && li.querySelector('div.t-14');
            
            const name = nameSpan?.innerText?.trim() || profileLink.innerText?.trim() || '(no name)';
            
            if (!hasResultTemplate && !hasExpectedStructure) {
                skippedReasons[name] = 'No result template or expected structure';
                return;
            }
            if (isInInsights) {
                skippedReasons[name] = 'In insights/mutual section';
                return;
            }
            if (!hasTitle && !hasLocation) {
                skippedReasons[name] = 'No title or location';
                return;
            }
            
            validCount++;
            const titleText = hasTitle?.innerText?.trim().substring(0, 40) || '(no title)';
            const locText = hasLocation?.innerText?.trim() || '(no location)';
            console.log(`✅ ${name}: title="${titleText}", loc="${locText}"`);
        });
        
        console.log(`\n📊 Summary:`);
        console.log(`   Valid profiles: ${validCount}`);
        console.log(`   Skipped: ${Object.keys(skippedReasons).length}`);
        if (Object.keys(skippedReasons).length > 0) {
            console.log(`\n❌ Skipped profiles:`);
            Object.entries(skippedReasons).forEach(([name, reason]) => {
                console.log(`   - ${name}: ${reason}`);
            });
        }
        
        return {
            valid: validCount,
            skipped: Object.keys(skippedReasons).length,
            skippedReasons: skippedReasons
        };
    }
    
    // Expose diagnostic function to page's window context (not content script's isolated context)
    // Inject a script into the page context to expose the function
    const script = document.createElement('script');
    script.textContent = `
        (function() {
            // Copy the diagnostic function logic into page context
            window.savvyPirateDiagnostic = function() {
                console.log('🔍 Savvy Pirate Diagnostic Test');
                console.log('================================\\n');
                
                const resultItems = document.querySelectorAll('li');
                let validCount = 0;
                let skippedReasons = {};
                
                resultItems.forEach(li => {
                    const profileLink = li.querySelector('a[href*="/in/"][data-test-app-aware-link]');
                    if (!profileLink) return;
                    
                    const nameSpan = li.querySelector('span[dir="ltr"] > span[aria-hidden="true"]');
                    const hasTitle = li.querySelector('div.t-14.t-black.t-normal');
                    const hasLocation = li.querySelector('div.t-14.t-normal:not(.t-black)');
                    const isInInsights = profileLink.closest('[class*="insight"]') || profileLink.closest('[class*="mutual"]');
                    const hasResultTemplate = li.querySelector('[data-view-name="search-entity-result-universal-template"]');
                    const hasExpectedStructure = li.querySelector('div.mb1') && li.querySelector('div.t-14');
                    
                    const name = nameSpan?.innerText?.trim() || profileLink.innerText?.trim() || '(no name)';
                    
                    if (!hasResultTemplate && !hasExpectedStructure) {
                        skippedReasons[name] = 'No result template or expected structure';
                        return;
                    }
                    if (isInInsights) {
                        skippedReasons[name] = 'In insights/mutual section';
                        return;
                    }
                    if (!hasTitle && !hasLocation) {
                        skippedReasons[name] = 'No title or location';
                        return;
                    }
                    
                    validCount++;
                    const titleText = hasTitle?.innerText?.trim().substring(0, 40) || '(no title)';
                    const locText = hasLocation?.innerText?.trim() || '(no location)';
                    console.log(\`✅ \${name}: title="\${titleText}", loc="\${locText}"\`);
                });
                
                console.log(\`\\n📊 Summary:\`);
                console.log(\`   Valid profiles: \${validCount}\`);
                console.log(\`   Skipped: \${Object.keys(skippedReasons).length}\`);
                if (Object.keys(skippedReasons).length > 0) {
                    console.log(\`\\n❌ Skipped profiles:\`);
                    Object.entries(skippedReasons).forEach(([name, reason]) => {
                        console.log(\`   - \${name}: \${reason}\`);
                    });
                }
                
                return {
                    valid: validCount,
                    skipped: Object.keys(skippedReasons).length,
                    skippedReasons: skippedReasons
                };
            };
            console.log('💡 Savvy Pirate: Run window.savvyPirateDiagnostic() in console to test filtering logic');
        })();
    `;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Remove script tag after injection

    // ============================================================
    // INITIALIZATION
    // ============================================================
    console.log(`[CS] OK: Content script loaded (${SCRIPT_VERSION})`);
    console.log(`[CS] 💡 Tip: Run window.savvyPirateDiagnostic() in console to test filtering logic`);
    
    // Auto-validate selectors on search pages
    if (window.location.href.includes('linkedin.com/search/results/people')) {
        const nameLinks = document.querySelectorAll(SELECTORS.NAME_LINK);
        console.log(`[CS] Found ${nameLinks.length} profile links on page`);
        
        if (nameLinks.length === 0) {
            console.warn('[CS] WARNING: No profile links found - page may not be loaded yet');
        }
    }
})();
