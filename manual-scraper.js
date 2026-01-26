// ============================================================================
// MANUAL LINKEDIN SCRAPER - Console Script
// ============================================================================
// USAGE:
// 1. Navigate to LinkedIn search results page
// 2. Open F12 Console
// 3. Paste this entire script and hit Enter
// 4. Enter the Connection Source name when prompted
// 5. Script will scrape all pages automatically
// 6. Results auto-copy to clipboard when done
//
// MANUAL CONTROLS:
// - scrapeCopy()    - Manually copy current results to clipboard
// - scrapeRecover() - Recover last backup from localStorage
// - Ctrl+C / Close tab - Auto-copies results before exit
//
// FEATURES:
// - Auto-saves every 25 profiles to localStorage backup
// - Shows progress every 5 pages
// - Handles up to 500+ profiles
// - Auto-recovery if browser crashes
// ============================================================================

(function() {
    'use strict';

    // ============= GLOBAL VARIABLES =============
    let globalResults = [];
    let globalSourceName = '';
    let globalStats = { pages: 0, profiles: 0 };
    let isScrapingActive = false;
    let stopRequested = false;

    // Configuration
    const CONFIG = {
        PAGE_LOAD_WAIT: 5000,      // INCREASED: 5s for unfocused tabs
        SCROLL_WAIT: 3000,         // INCREASED: 3s after scrolling
        RETRY_DELAY: 3000,         // INCREASED: 3s between retries
        MAX_RETRIES: 5,            // INCREASED: 5 retries instead of 3
        PROGRESS_INTERVAL: 5,      // Show progress every N pages
        AUTOSAVE_INTERVAL: 25      // Auto-save to localStorage every N profiles
    };

    // Selectors (matching content script)
    const SELECTORS = {
        NEXT_BUTTON: 'button[aria-label="Next"]',
        NAME_LINK: 'a[href*="/in/"][data-test-app-aware-link]',
        NAME_TEXT: 'span[dir="ltr"] > span[aria-hidden="true"]',
        TITLE_PRIMARY: 'div.t-14.t-black.t-normal',
        LOCATION_PRIMARY: 'div.t-14.t-normal:not(.t-black)'
    };

    // Helper: Wait function
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Helper: Focus window and wait
    async function focusAndWait(ms = 1000) {
        // Try to focus the window
        try {
            window.focus();
            // Also try to focus the document
            if (document.body) {
                document.body.focus();
            }
        } catch (e) {
            console.warn('[SCRAPER] Could not focus window:', e.message);
        }
        
        await wait(ms);
    }

    // Helper: Parse name with accreditations
    function parseNameWithAccreditations(fullName) {
        if (!fullName) return { cleanName: '', accreditations: ['', '', '', '', '', ''] };
        
        const accreds = [];
        let nameToClean = fullName.trim();
        
        // Extract from parentheses: "John Doe (CFA, MBA)"
        const parenMatches = nameToClean.match(/\(([^)]+)\)/g) || [];
        parenMatches.forEach(match => {
            const content = match.replace(/[()]/g, '');
            const parts = content.split(',').map(s => s.trim()).filter(s => s.length > 0 && s.length <= 25);
            accreds.push(...parts);
            nameToClean = nameToClean.replace(match, '').trim();
        });
        
        // Extract after commas: "John Doe, CPFA®, CRPC®"
        const commaParts = nameToClean.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        if (commaParts.length > 1) {
            for (let i = 1; i < commaParts.length && accreds.length < 6; i++) {
                const part = commaParts[i];
                if (part.length >= 2 && part.length <= 25 &&
                    /^[A-Z0-9\s®™©℠]+$/i.test(part) &&
                    !/\b(?:at |and |area|city|state|united states|metropolitan)\b/i.test(part) &&
                    !part.includes('.') &&
                    (part.length <= 10 || part.includes('®') || part.includes('™'))) {
                    accreds.push(part);
                } else {
                    break;
                }
            }
        }
        
        let clean = commaParts[0] || nameToClean;
        clean = clean.replace(/\s+/g, ' ').trim();
        
        while (accreds.length < 6) {
            accreds.push('');
        }
        
        return {
            cleanName: clean,
            accreditations: accreds.slice(0, 6)
        };
    }

    // Helper: Check if text looks like location
    function looksLikeLocation(text) {
        if (!text) return false;
        const locationPatterns = [
            /\b(?:Area|Metropolitan|County|Region)\s*$/i,
            /^[A-Z][a-z]+,\s*[A-Z]{2}$/,
            /\b(?:United States|USA|Greater|Bay Area)\b/i,
            /,\s*[A-Z]{2}$/,
            /\b(?:New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose)\b/i
        ];
        return locationPatterns.some(p => p.test(text));
    }

    // Helper: Check if text looks like title
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

    // Helper: Extract title and location from card
    function extractTitleAndLocation(card) {
        let title = '';
        let location = '';
        
        const textContainer = card.querySelector('div.mb1') || card;
        
        // Title: div with t-14, t-black, t-normal
        const titleEl = textContainer.querySelector('div.t-14.t-black.t-normal');
        if (titleEl) {
            title = titleEl.innerText?.trim() || '';
        }
        
        // Location: div with t-14, t-normal but NOT t-black
        const allDivs = textContainer.querySelectorAll('div.t-14.t-normal');
        allDivs.forEach(div => {
            if (!div.classList.contains('t-black')) {
                const text = div.innerText?.trim() || '';
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

    // Find profile cards on current page
    function findProfileCards() {
        const cards = [];
        const seenUrls = new Set();
        
        console.log('[FIND CARDS] Starting card search...');
        
        const resultItems = document.querySelectorAll('li');
        console.log('[FIND CARDS] Found', resultItems.length, 'li elements');
        
        resultItems.forEach(li => {
            const hasResultTemplate = li.querySelector('[data-view-name="search-entity-result-universal-template"]') ||
                                      li.querySelector('div.linked-area') ||
                                      li.className.includes('reusable-search');
            
            if (!hasResultTemplate) {
                const hasExpectedStructure = li.querySelector('div.mb1') && 
                                           li.querySelector('div.t-14');
                if (!hasExpectedStructure) return;
            }
            
            const profileLink = li.querySelector('a[href*="/in/"][data-test-app-aware-link]');
            if (!profileLink) return;
            
            const isInInsights = li.querySelector('.entity-result__insights')?.contains(profileLink) ||
                                profileLink.closest('.entity-result__insights') ||
                                profileLink.closest('[class*="insight"]') ||
                                profileLink.closest('[class*="mutual"]');
            if (isInInsights) return;
            
            const isInButton = profileLink.closest('button, [role="button"], .artdeco-button');
            if (isInButton) return;
            
            const url = profileLink.href?.split('?')[0] || '';
            if (!url.includes('/in/')) {
                return;
            }
            
            // ========== IMPROVED DEDUPLICATION ==========
            // Normalize URL (remove trailing slash, lowercase)
            const normalizedUrl = url.toLowerCase().replace(/\/$/, '');
            
            if (seenUrls.has(normalizedUrl)) {
                console.log('[FIND CARDS] Skipping duplicate:', normalizedUrl);
                return;
            }
            seenUrls.add(normalizedUrl);
            
            let nameText = '';
            const nameSpan = li.querySelector('span[dir="ltr"] > span[aria-hidden="true"]');
            if (nameSpan) {
                nameText = nameSpan.innerText?.trim() || '';
            }
            
            if (!nameText) {
                const img = li.querySelector('.presence-entity__image[alt], img.EntityPhoto-circle-3[alt]');
                if (img) nameText = img.alt?.trim() || '';
            }
            
            if (!nameText || nameText.length < 3) return;
            if (/^(connect|message|follow|view|see\s)/i.test(nameText)) return;
            if (/mutual|connection|degree/i.test(nameText)) return;
            
            const hasTitle = li.querySelector('div.t-14.t-black.t-normal');
            const hasLocation = li.querySelector('div.t-14.t-normal:not(.t-black)');
            
            if (!hasTitle && !hasLocation) return;
            
            cards.push({
                card: li,
                nameLink: profileLink,
                nameText: nameText
            });
        });
        
        console.log('[FIND CARDS] Found', cards.length, 'unique profile cards');
        return cards;
    }

    // Extract profile data from card
    function extractProfileData(cardInfo, sourceName) {
        const { card, nameLink, nameText } = cardInfo;
        
        if (!nameLink || !nameText || !nameText.trim()) {
            return null;
        }
        
        const { cleanName, accreditations } = parseNameWithAccreditations(nameText);
        
        if (!cleanName || !cleanName.trim()) {
            return null;
        }
        
        let url = nameLink.href?.split('?')[0] || '';
        if (!url || !url.includes('/in/')) {
            return null;
        }
        
        const { title, location } = extractTitleAndLocation(card);
        
        // Content validation - swap if misidentified
        if (title && location) {
            const titleLooksLikeLocation = looksLikeLocation(title);
            const locationLooksLikeTitle = looksLikeTitle(location);
            
            if (titleLooksLikeLocation && locationLooksLikeTitle) {
                [title, location] = [location, title];
            }
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        return [
            today,
            cleanName,
            title || '',
            location || '',
            sourceName,
            url,
            ...accreditations
        ];
    }

    // Check if page is empty
    function detectEmptyResultsState() {
        console.log('[EMPTY CHECK] ═══════ CHECKING IF PAGE EMPTY ═══════');
        console.log('[EMPTY CHECK] URL:', window.location.href);
        console.log('[EMPTY CHECK] Document focused?', document.hasFocus());
        console.log('[EMPTY CHECK] Tab visible?', !document.hidden);
        
        // Check 1: Explicit empty state elements
        const emptyStateSelectors = [
            '.search-reusable-search-no-results',
            '.artdeco-empty-state',
            'h2.artdeco-empty-state__headline'
        ];
        
        for (const selector of emptyStateSelectors) {
            const found = document.querySelector(selector);
            if (found) {
                console.log('[EMPTY CHECK] ❌ Found empty state element:', selector);
                console.log('[EMPTY CHECK] Element text:', found.textContent);
                return { isEmpty: true, reason: `Empty state element: ${selector}`, profileCount: 0 };
            }
        }
        
        // Check 2: Results header
        const resultsHeader = document.querySelector('.search-results-container h2');
        if (resultsHeader) {
            console.log('[EMPTY CHECK] Results header:', resultsHeader.textContent);
            if (resultsHeader.textContent.toLowerCase().includes('no results')) {
                console.log('[EMPTY CHECK] ❌ Header says no results');
                return { isEmpty: true, reason: 'Results header contains "no results"', profileCount: 0 };
            }
        }
        
        // Check 3: Profile elements using ALL possible selectors
        const profileSelectors = [
            '[data-chameleon-result-urn]',
            '.reusable-search__result-container',
            'li.reusable-search__result-container',
            '.entity-result',
            '[data-view-name="search-entity-result-universal-template"]'
        ];
        
        let maxProfileCount = 0;
        const selectorResults = {};
        
        for (const selector of profileSelectors) {
            const elements = document.querySelectorAll(selector);
            selectorResults[selector] = elements.length;
            if (elements.length > maxProfileCount) {
                maxProfileCount = elements.length;
            }
        }
        
        console.log('[EMPTY CHECK] Profile counts by selector:', selectorResults);
        console.log('[EMPTY CHECK] Max profile count:', maxProfileCount);
        
        // Check results container
        const resultsContainer = document.querySelector('.search-results-container');
        console.log('[EMPTY CHECK] Results container exists?', !!resultsContainer);
        
        if (maxProfileCount === 0 && resultsContainer) {
            console.log('[EMPTY CHECK] ❌ Container exists but 0 profiles');
            console.log('[EMPTY CHECK] WARNING: This might be a lazy loading issue!');
            return { isEmpty: true, reason: 'Results container present but zero profiles', profileCount: 0 };
        }
        
        if (maxProfileCount === 0 && !resultsContainer) {
            console.log('[EMPTY CHECK] ⚠️ No container - page might be loading');
            return { isEmpty: false, reason: 'Page still loading', profileCount: 0 };
        }
        
        console.log('[EMPTY CHECK] ✅ Page has content:', maxProfileCount, 'profiles');
        console.log('[EMPTY CHECK] ═══════════════════════════════════════');
        
        return { 
            isEmpty: false, 
            reason: `Found ${maxProfileCount} profiles`,
            profileCount: maxProfileCount
        };
    }

    // Check pagination state
    function detectPaginationState() {
        console.log('[PAGINATION] ═══════ CHECKING PAGINATION ═══════');
        console.log('[PAGINATION] Current URL:', window.location.href);
        
        const nextButton = document.querySelector(SELECTORS.NEXT_BUTTON);
        console.log('[PAGINATION] Next button found:', !!nextButton);
        
        if (nextButton) {
            console.log('[PAGINATION] Next button details:', {
                disabled: nextButton.disabled,
                ariaDisabled: nextButton.getAttribute('aria-disabled'),
                offsetParent: nextButton.offsetParent,
                display: window.getComputedStyle(nextButton).display,
                visibility: window.getComputedStyle(nextButton).visibility,
                innerText: nextButton.innerText
            });
        }
        
        const hasNext = nextButton !== null && !nextButton.disabled;
        const isAriaDisabled = nextButton?.getAttribute('aria-disabled') === 'true';
        const isHidden = nextButton && (
            nextButton.offsetParent === null || 
            nextButton.style.display === 'none' ||
            window.getComputedStyle(nextButton).display === 'none'
        );
        
        const actuallyHasNext = hasNext && !isAriaDisabled && !isHidden;
        
        const urlParams = new URLSearchParams(window.location.search);
        const currentPage = parseInt(urlParams.get('page')) || 1;
        
        // Check pagination container for total pages
        const paginationText = document.querySelector('.artdeco-pagination__page-state');
        const paginationInfo = paginationText ? paginationText.textContent : 'Not found';
        
        console.log('[PAGINATION] Pagination info text:', paginationInfo);
        console.log('[PAGINATION] Current page number:', currentPage);
        console.log('[PAGINATION] Has next?', actuallyHasNext);
        console.log('[PAGINATION] Reason:', {
            buttonExists: !!nextButton,
            notDisabled: hasNext,
            notAriaDisabled: !isAriaDisabled,
            notHidden: !isHidden
        });
        console.log('[PAGINATION] ═══════════════════════════════════');
        
        return {
            hasNext: actuallyHasNext,
            button: nextButton,
            currentPage: currentPage,
            paginationInfo: paginationInfo
        };
    }

    // Click next button
    async function clickNextButton() {
        const pagination = detectPaginationState();
        
        if (!pagination.hasNext || !pagination.button) {
            return false;
        }
        
        const urlBefore = window.location.href;
        const pageBefore = pagination.currentPage;
        
        console.log(`[SCRAPER] 🖱️ Clicking Next button (current page: ${pageBefore})...`);
        pagination.button.click();
        
        await wait(2000);
        
        const urlAfter = window.location.href;
        const pageAfter = new URLSearchParams(window.location.search).get('page') || '1';
        
        if (urlBefore === urlAfter) {
            await wait(3000);
            const urlAfterWait = window.location.href;
            if (urlBefore === urlAfterWait) {
                console.error(`[SCRAPER] ❌ Navigation failed`);
                return false;
            }
        }
        
        console.log(`[SCRAPER] ✅ Navigated to page ${pageAfter}`);
        return true;
    }

    // Copy to clipboard using modern API with fallback
    async function copyToClipboard(text) {
        // Method 1: Modern Clipboard API (preferred)
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                console.log('[SCRAPER] ✅ Copied using Clipboard API');
                return true;
            } catch (err) {
                console.warn('[SCRAPER] Clipboard API failed, trying fallback:', err.message);
            }
        }
        
        // Method 2: Fallback using execCommand
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-999999px';
            textarea.style.top = '-999999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);
            
            if (successful) {
                console.log('[SCRAPER] ✅ Copied using execCommand fallback');
                return true;
            } else {
                console.error('[SCRAPER] ❌ execCommand returned false');
                return false;
            }
        } catch (err) {
            console.error('[SCRAPER] ❌ Fallback copy failed:', err);
            return false;
        }
    }

    // Format rows as TSV (tab-separated values) for Google Sheets
    function formatAsTSV(rows) {
        if (rows.length === 0) return '';
        
        // Header row
        const headers = [
            'Date',
            'Name',
            'Title',
            'Location',
            'Connection Source',
            'LinkedIn URL',
            'Accreditation 1',
            'Accreditation 2',
            'Accreditation 3',
            'Accreditation 4',
            'Accreditation 5',
            'Accreditation 6'
        ];
        
        let tsv = headers.join('\t') + '\n';
        
        // Data rows
        rows.forEach(row => {
            tsv += row.join('\t') + '\n';
        });
        
        return tsv;
    }

    // ============= EMERGENCY COPY FUNCTION =============
    async function emergencyCopy() {
        if (globalResults.length === 0) {
            console.warn('[SCRAPER] No results to copy yet');
            return false;
        }
        
        const tsv = formatAsTSV(globalResults);
        const success = await copyToClipboard(tsv);
        
        if (success) {
            console.log(`[SCRAPER] 📋 Emergency copy successful: ${globalResults.length} rows`);
            // Also save to localStorage
            try {
                localStorage.setItem('linkedin_scraper_backup', JSON.stringify({
                    data: globalResults,
                    source: globalSourceName,
                    timestamp: new Date().toISOString(),
                    stats: globalStats
                }));
                console.log('[SCRAPER] 💾 Backup saved to localStorage');
            } catch (e) {
                console.warn('[SCRAPER] Could not save to localStorage:', e.message);
            }
        }
        
        return success;
    }
    
    // ============= MAKE EMERGENCY COPY GLOBALLY ACCESSIBLE =============
    window.scrapeCopy = emergencyCopy;
    
    // ============= RECOVERY FUNCTION =============
    async function recoverLastScrape() {
        try {
            const backup = localStorage.getItem('linkedin_scraper_backup');
            if (!backup) {
                console.log('[SCRAPER] No backup found in localStorage');
                return null;
            }
            
            const data = JSON.parse(backup);
            console.log('[SCRAPER] 📦 Found backup:');
            console.log(`  Source: ${data.source}`);
            console.log(`  Profiles: ${data.stats.profiles}`);
            console.log(`  Pages: ${data.stats.pages}`);
            console.log(`  Timestamp: ${data.timestamp}`);
            
            const tsv = formatAsTSV(data.data);
            if (await copyToClipboard(tsv)) {
                console.log('[SCRAPER] ✅ Backup recovered and copied to clipboard!');
                alert(`Recovered ${data.stats.profiles} profiles from backup!\n\nCopied to clipboard - paste into Google Sheets.`);
                return data;
            } else {
                console.error('[SCRAPER] ❌ Failed to copy backup to clipboard');
                return data;
            }
        } catch (e) {
            console.error('[SCRAPER] Error recovering backup:', e);
            return null;
        }
    }

    // Make globally accessible
    window.scrapeRecover = recoverLastScrape;
    
    // ============= STOP/RESUME FUNCTIONS =============
    
    // Stop scraping and copy results
    async function stopAndCopy() {
        console.log('[SCRAPER] 🛑 STOP REQUESTED - Will stop after current page');
        stopRequested = true;
        
        // Wait a moment for current page to finish
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (globalResults.length > 0) {
            console.log(`[SCRAPER] 📋 Copying ${globalResults.length} profiles...`);
            const success = await emergencyCopy();
            if (success) {
                console.log('[SCRAPER] ✅ Results copied to clipboard!');
                console.log('[SCRAPER] 📊 Stats:', globalStats);
                alert(`Stopped!\n\n${globalStats.pages} pages\n${globalStats.profiles} profiles\n\nResults copied to clipboard - paste into Google Sheets!`);
            } else {
                console.error('[SCRAPER] ❌ Copy failed - downloading file instead');
                downloadResults();
            }
        } else {
            console.warn('[SCRAPER] No results to copy yet');
            alert('No results scraped yet. Keep scraping to collect data.');
        }
    }
    
    // Download results as TSV file
    function downloadResults() {
        if (globalResults.length === 0) {
            console.warn('[SCRAPER] No results to download');
            return;
        }
        
        const tsv = formatAsTSV(globalResults);
        const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `linkedin-scrape-${globalSourceName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.tsv`;
        link.click();
        URL.revokeObjectURL(url);
        console.log('[SCRAPER] ✅ File downloaded');
    }
    
    // Show current status
    function scrapeStatus() {
        console.log('[SCRAPER] 📊 Current Status:');
        console.log(`  Active: ${isScrapingActive}`);
        console.log(`  Stop Requested: ${stopRequested}`);
        console.log(`  Pages: ${globalStats.pages}`);
        console.log(`  Profiles: ${globalStats.profiles}`);
        console.log(`  Results in memory: ${globalResults.length}`);
        
        if (globalResults.length > 0) {
            console.log('[SCRAPER] 💡 Commands:');
            console.log('    scrapeStop()     - Stop and copy to clipboard');
            console.log('    scrapeCopy()     - Copy current results');
            console.log('    scrapeDownload() - Download as file');
            console.log('    scrapeStatus()   - Show this status');
        }
        
        return {
            active: isScrapingActive,
            stopRequested: stopRequested,
            pages: globalStats.pages,
            profiles: globalStats.profiles,
            resultsCount: globalResults.length
        };
    }
    
    // Make globally accessible
    window.scrapeStop = stopAndCopy;
    window.scrapeStatus = scrapeStatus;
    window.scrapeDownload = downloadResults;
    
    // ============= AUTO-COPY ON PAGE UNLOAD =============
    window.addEventListener('beforeunload', async (e) => {
        if (isScrapingActive && globalResults.length > 0) {
            await emergencyCopy();
            e.preventDefault();
            e.returnValue = '';
            return 'Scraping in progress. Results will be copied to clipboard.';
        }
    });

    // Main scraping function
    async function scrapeAllPages() {
        console.log('[SCRAPER] 🚀 Starting manual scraper...');
        console.log('[SCRAPER] URL:', window.location.href);
        
        // ============= INITIALIZE GLOBAL STATE =============
        isScrapingActive = true;
        stopRequested = false;
        globalResults = [];
        globalStats = { pages: 0, profiles: 0 };
        
        // Prompt for source name
        const sourceName = prompt('Enter Connection Source name (or leave blank for "Manual Scrape"):') || 'Manual Scrape';
        console.log('[SCRAPER] Source name:', sourceName);
        
        // ============= SET GLOBAL SOURCE NAME =============
        globalSourceName = sourceName;
        
        // ============= SHOW TIPS =============
        console.log('[SCRAPER] ═══════════════════════════════════════');
        console.log('[SCRAPER] 💡 CONTROLS:');
        console.log('[SCRAPER]    scrapeStop()     - Stop & copy results');
        console.log('[SCRAPER]    scrapeCopy()     - Copy current progress');
        console.log('[SCRAPER]    scrapeStatus()   - Show current status');
        console.log('[SCRAPER]    scrapeDownload() - Download as file');
        console.log('[SCRAPER]    scrapeRecover()  - Recover last backup');
        console.log('[SCRAPER] ═══════════════════════════════════════');
        
        const allRows = [];
        let totalPages = 0;
        let totalProfiles = 0;
        
        try {
            while (true) {
                // ============= CHECK FOR STOP REQUEST =============
                if (stopRequested) {
                    console.log('[SCRAPER] 🛑 Stop requested - ending scrape');
                    break;
                }
                
                totalPages++;
                console.log(`[SCRAPER] ========== PAGE ${totalPages} ==========`);
                
                // Wait for page to load
                await wait(CONFIG.PAGE_LOAD_WAIT);
                
                // Scroll to trigger lazy loading
                window.scrollTo(0, document.body.scrollHeight);
                await wait(CONFIG.SCROLL_WAIT);
                
                // Additional scrolls
                for (let i = 0; i < 2; i++) {
                    window.scrollTo(0, document.body.scrollHeight);
                    await wait(1000);
                }
                
                // Find and extract profiles (do NOT check for empty first)
                const cards = findProfileCards();
                console.log(`[SCRAPER] Found ${cards.length} profile cards`);
                
                let pageProfiles = 0;
                for (const cardInfo of cards) {
                    const row = extractProfileData(cardInfo, sourceName);
                    if (row) {
                        globalResults.push(row);
                        allRows.push(row);
                        pageProfiles++;
                    }
                }
                
                totalProfiles += pageProfiles;
                globalStats.pages = totalPages;
                globalStats.profiles = totalProfiles;
                
                // ============= AUTO-SAVE EVERY N PROFILES =============
                if (totalProfiles > 0 && totalProfiles % CONFIG.AUTOSAVE_INTERVAL === 0) {
                    try {
                        localStorage.setItem('linkedin_scraper_backup', JSON.stringify({
                            data: globalResults,
                            source: sourceName,
                            timestamp: new Date().toISOString(),
                            stats: globalStats
                        }));
                        console.log(`[SCRAPER] 💾 Auto-saved ${totalProfiles} profiles to backup`);
                    } catch (e) {
                        // Silently fail
                    }
                }
                
                console.log(`[SCRAPER] Extracted ${pageProfiles} profiles (Total: ${totalProfiles})`);
                
                // ============= CHECK FOR STOP REQUEST AFTER PAGE =============
                if (stopRequested) {
                    console.log('[SCRAPER] 🛑 Stop requested - saving results');
                    break;
                }
                
                // ============= SHOW PROGRESS EVERY N PAGES =============
                if (totalPages % CONFIG.PROGRESS_INTERVAL === 0) {
                    console.log(`[SCRAPER] 📊 Progress: ${totalPages} pages, ${totalProfiles} profiles`);
                }
                
                // Check pagination BEFORE clicking
                console.log('[MAIN LOOP] Checking if we should continue...');
                const pagination = detectPaginationState();
                
                if (!pagination.hasNext) {
                    console.log('[MAIN LOOP] ❌ STOPPING - No next button');
                    console.log('[MAIN LOOP] Pagination state:', pagination);
                    console.log('[MAIN LOOP] This was page:', totalPages);
                    break;
                }
                
                console.log('[MAIN LOOP] ✅ Next button exists, clicking...');
                
                // Click next button
                const navSuccess = await clickNextButton();
                if (!navSuccess) {
                    console.log('[MAIN LOOP] ❌ STOPPING - Navigation failed');
                    console.log('[MAIN LOOP] URL before:', window.location.href);
                    break;
                }
                
                // ========== FIX: FOCUS WINDOW BEFORE LOADING ==========
                console.log('[SCRAPER] 📍 Focusing window to trigger lazy loading...');
                await focusAndWait(2000);
                
                // Wait for new page to load
                console.log('[SCRAPER] ⏳ Waiting for new page to load...');
                await wait(CONFIG.PAGE_LOAD_WAIT);
                
                // ========== FIX: AGGRESSIVE SCROLLING TO FORCE LOAD ==========
                console.log('[SCRAPER] 📜 Aggressive scrolling to load content...');
                for (let i = 0; i < 5; i++) {
                    window.scrollTo(0, 0);
                    await wait(300);
                    window.scrollTo(0, document.body.scrollHeight);
                    await wait(300);
                    window.scrollTo(0, document.body.scrollHeight / 2);
                    await wait(300);
                }
                
                // Final scroll to bottom
                window.scrollTo(0, document.body.scrollHeight);
                await wait(2000);
                
                // NOW check if the NEW page is empty (with retries for lazy loading)
                console.log('[SCRAPER] 🔍 Checking if new page has content...');
                let emptyCheck = detectEmptyResultsState();
                let retries = CONFIG.MAX_RETRIES;
                
                while (emptyCheck.isEmpty && retries > 0) {
                    console.log(`[SCRAPER] ⏳ Page appears empty, retry ${CONFIG.MAX_RETRIES - retries + 1}/${CONFIG.MAX_RETRIES}...`);
                    
                    // Focus again
                    await focusAndWait(1000);
                    
                    // Scroll again
                    window.scrollTo(0, 0);
                    await wait(500);
                    window.scrollTo(0, document.body.scrollHeight);
                    await wait(CONFIG.RETRY_DELAY);
                    
                    emptyCheck = detectEmptyResultsState();
                    retries--;
                }
                
                if (emptyCheck.isEmpty) {
                    console.log('[MAIN LOOP] ⚠️ Empty check says page is empty');
                    console.log('[MAIN LOOP] Empty check:', emptyCheck);
                    
                    // ========== SAFETY: Double-check by trying to find cards ==========
                    console.log('[MAIN LOOP] 🔍 Double-checking by searching for profile cards...');
                    await wait(2000);
                    window.scrollTo(0, document.body.scrollHeight);
                    await wait(2000);
                    
                    const doubleCheckCards = findProfileCards();
                    console.log('[MAIN LOOP] Double-check found:', doubleCheckCards.length, 'cards');
                    
                    if (doubleCheckCards.length > 0) {
                        console.log('[MAIN LOOP] ⚠️ IGNORING empty check - cards found!');
                        console.log('[MAIN LOOP] ✅ Continuing with scrape');
                        continue; // Go to next iteration, don't stop
                    }
                    
                    console.log('[MAIN LOOP] ❌ CONFIRMED: Page is actually empty');
                    console.log('[MAIN LOOP] ❌ STOPPING - New page empty');
                    console.log('[MAIN LOOP] Empty check result:', emptyCheck);
                    console.log('[MAIN LOOP] Total pages scraped:', totalPages);
                    console.log('[MAIN LOOP] URL:', window.location.href);
                    console.log(`[SCRAPER] ✅ Successfully scraped ${totalPages - 1} pages`);
                    console.log(`[SCRAPER] Last page with data was page ${totalPages - 1}`);
                    break;
                }
                
                console.log(`[SCRAPER] ✅ New page has ${emptyCheck.profileCount} profiles, continuing...`);
            }
            
            console.log(`[SCRAPER] ========== SCRAPING COMPLETE ==========`);
            console.log(`[SCRAPER] Total pages: ${totalPages}`);
            console.log(`[SCRAPER] Total profiles: ${totalProfiles}`);
            
            // ============= MARK SCRAPING AS INACTIVE =============
            isScrapingActive = false;
            
            if (allRows.length === 0) {
                console.warn('[SCRAPER] ⚠️ No profiles found!');
                alert('No profiles were found. Check if you are logged into LinkedIn and the search has results.');
                return;
            }
            
            // Format as TSV
            console.log('[SCRAPER] 📝 Formatting results as TSV...');
            const tsv = formatAsTSV(allRows);
            console.log(`[SCRAPER] TSV length: ${tsv.length} characters`);
            
            // Save to localStorage backup FIRST (before clipboard attempt)
            try {
                localStorage.setItem('linkedin_scraper_backup', JSON.stringify({
                    data: allRows,
                    source: sourceName,
                    timestamp: new Date().toISOString(),
                    stats: { pages: totalPages, profiles: totalProfiles }
                }));
                console.log('[SCRAPER] 💾 Backup saved to localStorage');
            } catch (e) {
                console.warn('[SCRAPER] Could not save to localStorage:', e.message);
            }
            
            // Copy to clipboard
            console.log('[SCRAPER] 📋 Attempting to copy to clipboard...');
            try {
                const copySuccess = await copyToClipboard(tsv);
                
                if (copySuccess) {
                    console.log('[SCRAPER] ✅ Results successfully copied to clipboard!');
                    console.log(`[SCRAPER] ${allRows.length} rows ready to paste into Google Sheets`);
                    
                    alert(`✅ Scraping Complete!\n\n📊 ${totalPages} pages\n👥 ${totalProfiles} profiles\n\n✅ Results copied to clipboard!\n\nPress Ctrl+V in Google Sheets to paste.\n\n💾 Backup saved to localStorage\n(Type scrapeRecover() to restore if needed)`);
                } else {
                    throw new Error('Copy returned false');
                }
            } catch (copyError) {
                console.error('[SCRAPER] ❌ Clipboard copy failed:', copyError);
                
                // Fallback: Download as file
                console.log('[SCRAPER] 💾 Downloading results as file instead...');
                const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `linkedin-scrape-${sourceName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.tsv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                
                console.log('[SCRAPER] ✅ File downloaded successfully');
                console.log('[SCRAPER] Results also in console below:');
                console.log(tsv);
                
                alert(`Scraping Complete!\n\n📊 ${totalPages} pages\n👥 ${totalProfiles} profiles\n\n⚠️ Clipboard copy failed\n✅ File downloaded instead!\n\nOpen the TSV file or check console for results.\n\n💾 Backup in localStorage\n(Type scrapeRecover() to copy from backup)`);
            }
            
        } catch (error) {
            console.error('[SCRAPER] ❌ Error:', error);
            
            // ============= AUTO-COPY ON ERROR =============
            isScrapingActive = false;
            
            if (globalResults.length > 0) {
                console.log(`[SCRAPER] 💾 Attempting to save ${globalResults.length} profiles before error exit...`);
                const success = await emergencyCopy();
                
                if (success) {
                    alert(`Error during scraping: ${error.message}\n\nPartial results (${globalResults.length} profiles) copied to clipboard!`);
                } else {
                    alert(`Error during scraping: ${error.message}\n\nCould not copy results. Check console.`);
                }
            } else {
                alert(`Error during scraping: ${error.message}`);
            }
        }
    }

    // Start scraping
    scrapeAllPages();

})();
