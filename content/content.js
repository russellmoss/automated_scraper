// content/content.js - LinkedIn Scraper Content Script
// Single IIFE file - no ES modules, no imports

(function() {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================
    const CONFIG = {
        MAX_PAGES: 1000,
        MIN_WAIT_SECONDS: 5,
        MAX_WAIT_SECONDS: 8,
        SCROLL_WAIT_MS: 2000
    };

    // ============================================================
    // SELECTORS (Updated based on diagnostic - January 2025)
    // ============================================================
    const SELECTORS = {
        NAME_LINK: 'a[data-view-name="search-result-lockup-title"]',
        // OLD selectors still work (acd09c55 for title, bb0216de for location)
        TITLE_PRIMARY: 'div.acd09c55 > p',  // ✅ Working
        TITLE_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p',
        TITLE_FALLBACK_2: 'div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p',
        LOCATION_PRIMARY: 'div.bb0216de > p',  // ✅ Working
        LOCATION_FALLBACK_1: 'div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p',
        LOCATION_FALLBACK_2: 'div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p',
        NEXT_BUTTON: 'button[data-testid="pagination-controls-next-button-visible"]'
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
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randomDelay() {
        const min = CONFIG.MIN_WAIT_SECONDS * 1000;
        const max = CONFIG.MAX_WAIT_SECONDS * 1000;
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
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[CS] Message error:', chrome.runtime.lastError.message);
                if (callback) callback(null);
            } else {
                if (callback) callback(response);
            }
        });
    }

    // ============================================================
    // CARD FINDING
    // ============================================================
    function findProfileCards() {
        const cards = [];
        const seenUrls = new Set(); // Track seen profile URLs to avoid duplicates
        const nameLinks = document.querySelectorAll(SELECTORS.NAME_LINK);
        
        nameLinks.forEach(nameLink => {
            // Get URL first to check for duplicates
            const url = nameLink.href?.split('?')[0] || '';
            if (!url || !url.includes('/in/')) {
                return; // Skip invalid links
            }
            
            // Skip duplicates
            if (seenUrls.has(url)) {
                return;
            }
            seenUrls.add(url);
            
            // Find card container - try multiple methods since data-view-name may not work
            let card = nameLink.closest('li.reusable-search__result-container') ||
                       nameLink.closest('div[class*="entity-result"]') ||
                       nameLink.closest('li') ||
                       findCardContainer(nameLink);
            
            // If still no card found, use parent that contains title/location
            if (!card) {
                card = findCardContainer(nameLink);
            }
            
            if (card) {
                const nameText = nameLink.innerText?.trim() || '';
                if (nameText) { // Only add if we have a name
                    cards.push({
                        card,
                        nameLink,
                        nameText
                    });
                }
            }
        });
        
        return cards;
    }

    function findCardContainer(nameLink) {
        let current = nameLink.parentElement;
        let depth = 0;
        const maxDepth = 10;
        
        while (current && depth < maxDepth) {
            // Use working selectors (acd09c55 for title, bb0216de for location)
            const hasTitle = current.querySelector('div.acd09c55 > p') ||
                             current.querySelector('div.d395caa1:not(.a7293f27) > p');
            const hasLocation = current.querySelector('div.bb0216de > p') ||
                                current.querySelector('div.d395caa1.a7293f27 > p');
            
            if (hasTitle || hasLocation) {
                return current;
            }
            
            current = current.parentElement;
            depth++;
        }
        
        // Last resort: go up 6 levels from name link
        current = nameLink;
        for (let i = 0; i < 6 && current.parentElement; i++) {
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
            /^[A-Z][a-z]+,\s*[A-Z]{2}$/,
            /\b(?:United States|USA|Greater|Bay Area)\b/i
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

        const candidates = card.querySelectorAll('p, div > p, div.d395caa1 > p');
        
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
    // LAYER 2: DIRECT P-TAG EXTRACTION
    // ============================================================
    function directPTagExtraction(card, nameLink) {
        const allPTags = Array.from(card.querySelectorAll('p'));
        
        const dataPTags = allPTags.filter(p => {
            if (p.contains(nameLink) || nameLink.contains(p)) return false;
            
            const text = p.innerText?.trim() || '';
            
            if (text.includes('mutual connection')) return false;
            if (text.includes('other mutual')) return false;
            if (/^•\s*(1st|2nd|3rd)/i.test(text)) return false;
            if (text.includes('• 1st') || text.includes('• 2nd') || text.includes('• 3rd')) return false;
            if (text.toLowerCase().includes('connect')) return false;
            if (text.toLowerCase().includes('message')) return false;
            if (text.toLowerCase().includes('follow')) return false;
            if (text.length < 3 || text.length > 200) return false;
            
            return true;
        });
        
        return {
            title: dataPTags[0]?.innerText?.trim() || '',
            location: dataPTags[1]?.innerText?.trim() || ''
        };
    }

    // ============================================================
    // DATA EXTRACTION - MULTI-LAYER APPROACH
    // ============================================================
    function extractProfileData(cardInfo, sourceName) {
        const { card, nameLink, nameText } = cardInfo;
        
        // Validate that we have a valid name and URL
        if (!nameLink || !nameText || !nameText.trim()) {
            console.warn('[CS] ⚠️ Skipping card: no valid name link or name text');
            return null;
        }
        
        const { cleanName, accreditations } = parseNameWithAccreditations(nameText);
        
        // Validate clean name is not empty
        if (!cleanName || !cleanName.trim()) {
            console.warn('[CS] ⚠️ Skipping card: name is empty after cleaning');
            return null;
        }
        
        // Extract URL - must be a profile URL, not search results
        let url = nameLink.href?.split('?')[0] || '';
        if (!url || !url.includes('/in/')) {
            console.warn('[CS] ⚠️ Skipping card: invalid profile URL', url);
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
            // LAYER 1: Class-based selectors
            const titleElPrimary = card.querySelector(SELECTORS.TITLE_PRIMARY);
            const locationElPrimary = card.querySelector(SELECTORS.LOCATION_PRIMARY);
            
            if (titleElPrimary) title = titleElPrimary.innerText?.trim() || '';
            if (locationElPrimary) location = locationElPrimary.innerText?.trim() || '';
            
            if (!title) {
                const titleElFallback1 = card.querySelector(SELECTORS.TITLE_FALLBACK_1);
                if (titleElFallback1) title = titleElFallback1.innerText?.trim() || '';
            }
            if (!location) {
                const locationElFallback1 = card.querySelector(SELECTORS.LOCATION_FALLBACK_1);
                if (locationElFallback1) location = locationElFallback1.innerText?.trim() || '';
            }
            
            if (!title) {
                const titleElOld = card.querySelector(SELECTORS.TITLE_FALLBACK_2);
                if (titleElOld) title = titleElOld.innerText?.trim() || '';
            }
            if (!location) {
                const locationElOld = card.querySelector(SELECTORS.LOCATION_FALLBACK_2);
                if (locationElOld) location = locationElOld.innerText?.trim() || '';
            }
            
            extractionMethod = (title || location) ? 'class-selectors' : 'none';
        }
        
        // LAYER 2: Direct p-tag extraction fallback
        if (!title || !location) {
            const fallback = directPTagExtraction(card, nameLink);
            if (!title && fallback.title) {
                title = fallback.title;
                extractionMethod = extractionMethod === 'none' ? 'direct-p-tag' : extractionMethod + '+direct-p-tag';
            }
            if (!location && fallback.location) {
                location = fallback.location;
                extractionMethod = extractionMethod === 'none' ? 'direct-p-tag' : extractionMethod + '+direct-p-tag';
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
            console.warn('[CS] ⚠️ Failed to extract title and location for:', cleanName);
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
    async function waitForEntriesToLoad(expected, timeout = 10000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const cards = findProfileCards();
            if (cards.length >= expected) {
                return true;
            }
            await wait(500);
        }
        return false;
    }

    async function scrapeCurrentPage(sourceName) {
        // Scroll to bottom to trigger lazy loading
        window.scrollTo(0, document.body.scrollHeight);
        await wait(CONFIG.SCROLL_WAIT_MS);
        
        const cards = findProfileCards();
        console.log(`[CS] Found ${cards.length} profile cards on page`);
        
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
                    console.warn('[CS] ⚠️ Skipping duplicate URL:', url);
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

    function detectPaginationState() {
        const nextButton = document.querySelector(SELECTORS.NEXT_BUTTON);
        return {
            hasNext: nextButton !== null && !nextButton.disabled,
            button: nextButton
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
        stopButton.innerHTML = '⏹ Stop Scraping';
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
        
        stopButton.addEventListener('click', () => {
            stopRequested = true;
            updateButtonStatus('Stopping...', '#ffc107');
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
    async function startScraping(sourceName) {
        if (isScrapingActive) {
            console.warn('[CS] Scraping already active');
            return;
        }
        
        isScrapingActive = true;
        stopRequested = false;
        currentSourceName = sourceName;
        
        console.log(`[CS] 🚀 Starting scrape for source: ${sourceName}`);
        
        createStopButton();
        
        let totalProfiles = 0;
        let totalPages = 0;
        
        try {
            while (totalPages < CONFIG.MAX_PAGES && !stopRequested) {
                // Wait for entries to load
                await waitForEntriesToLoad(1, 10000);
                
                // Scrape current page
                const rows = await scrapeCurrentPage(sourceName);
                
                if (rows.length > 0) {
                    totalProfiles += rows.length;
                    totalPages++;
                    
                    // Send data to background
                    sendMessageSafe({
                        action: 'DATA_SCRAPED',
                        rows: rows,
                        pageNumber: totalPages
                    });
                    
                    console.log(`[CS] ✅ Page ${totalPages}: Scraped ${rows.length} profiles (Total: ${totalProfiles})`);
                }
                
                if (stopRequested) {
                    console.log('[CS] ⏹ Stop requested by user');
                    break;
                }
                
                // Try to go to next page
                const hasNext = await clickNextButton();
                
                if (!hasNext) {
                    console.log('[CS] ✅ No more pages available');
                    break;
                }
                
                // Random delay between pages
                const delay = randomDelay();
                console.log(`[CS] ⏳ Waiting ${(delay/1000).toFixed(1)}s before next page...`);
                await wait(delay);
            }
            
            console.log(`[CS] ✅ Scraping complete: ${totalProfiles} profiles from ${totalPages} pages`);
            
            // Send completion message
            sendMessageSafe({
                action: 'SCRAPING_COMPLETE',
                totalProfiles: totalProfiles,
                totalPages: totalPages
            });
            
        } catch (error) {
            console.error('[CS] ❌ Scraping error:', error);
            
            // Send detailed error notification
            const searchUrl = window.location.href;
            const searchName = document.title || searchUrl;
            sendMessageSafe({
                action: 'SCRAPE_ERROR',
                personName: 'Scraping Process',
                searchName: searchName,
                failureType: error.name === 'TimeoutError' ? 'timeout_error' : 
                            error.message?.includes('selector') ? 'selector_error' :
                            error.message?.includes('network') ? 'network_error' : 'scraping_error',
                error: error.message || String(error),
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
                error: error.message
            });
        } finally {
            isScrapingActive = false;
            removeStopButton();
            stopRequested = false;
        }
    }

    // ============================================================
    // MESSAGE LISTENER
    // ============================================================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const { action } = message;
        
        console.log(`[CS] 📩 Received: ${action}`);
        
        switch (action) {
            case 'START_SCRAPING':
                const sourceName = message.sourceName || 'Unknown';
                startScraping(sourceName).catch(error => {
                    console.error('[CS] Start scraping error:', error);
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
                
            default:
                sendResponse({ success: false, error: 'Unknown action' });
                return true;
        }
    });

    // ============================================================
    // INITIALIZATION
    // ============================================================
    console.log('[CS] ✅ Content script loaded');
    
    // Auto-validate selectors on search pages
    if (window.location.href.includes('linkedin.com/search/results/people')) {
        const nameLinks = document.querySelectorAll(SELECTORS.NAME_LINK);
        console.log(`[CS] Found ${nameLinks.length} profile links on page`);
        
        if (nameLinks.length === 0) {
            console.warn('[CS] ⚠️ No profile links found - page may not be loaded yet');
        }
    }
})();
