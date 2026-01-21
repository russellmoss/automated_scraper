// =============================================================================
// PAGINATION FIX FOR LINKEDIN SCRAPER
// File: content/content.js
// =============================================================================
//
// INSTRUCTIONS:
// 1. Find the detectPaginationState() function (around line 808)
// 2. Replace it with the new version below
// 3. Find the startScraping() function's while loop (around line 942)
// 4. Add the empty state check at the START of the loop
// =============================================================================


// -----------------------------------------------------------------------------
// STEP 1: Add this NEW function (add near detectPaginationState)
// -----------------------------------------------------------------------------

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


// -----------------------------------------------------------------------------
// STEP 2: Replace your existing detectPaginationState() function with this
// -----------------------------------------------------------------------------

/**
 * Enhanced pagination state detection
 * Now includes empty state awareness
 */
function detectPaginationState() {
    // FIRST: Check for empty state before anything else
    const emptyCheck = detectEmptyResultsState();
    
    const nextButton = document.querySelector('button[aria-label="Next"]');
    const prevButton = document.querySelector('button[aria-label="Previous"]');
    
    // Get current page number from URL
    const urlParams = new URLSearchParams(window.location.search);
    const currentPage = parseInt(urlParams.get('page')) || 1;
    
    // Get current page from active button (fallback)
    const activePageButton = document.querySelector('button[aria-current="true"]');
    const activePageNum = activePageButton ? parseInt(activePageButton.textContent.trim()) : currentPage;
    
    const state = {
        hasNext: nextButton !== null && !nextButton.disabled,
        hasPrev: prevButton !== null && !prevButton.disabled,
        currentPage: activePageNum || currentPage,
        // NEW: Add empty state info to pagination state
        isEmpty: emptyCheck.isEmpty,
        emptyReason: emptyCheck.reason,
        profileCount: emptyCheck.profileCount
    };
    
    console.log('[CS] Pagination state:', JSON.stringify(state));
    
    return state;
}


// -----------------------------------------------------------------------------
// STEP 3: Modify your startScraping() while loop
// 
// FIND this section (around line 942-1007):
//   while (totalPages < maxPages && !stopRequested) {
//       const entriesLoaded = await waitForEntriesToLoad(1, 20000);
//       ...
//   }
//
// REPLACE the beginning of the loop with this:
// -----------------------------------------------------------------------------

/*
REPLACE YOUR WHILE LOOP START WITH THIS:

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
        
        // Send a status update
        chrome.runtime.sendMessage({
            action: 'SCRAPE_STATUS_UPDATE',
            data: {
                status: 'empty_page_detected',
                reason: emptyCheck.reason,
                pagesScraped: totalPages,
                profilesFound: allScrapedRows.length
            }
        }).catch(() => {});
        
        break; // EXIT the pagination loop, move to next search
    }
    
    // =========================================================================
    // END NEW SECTION - Continue with existing entry loading logic
    // =========================================================================
    
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
    
    // ... rest of your existing loop code (scraping, clicking next, etc.) ...
*/


// -----------------------------------------------------------------------------
// STEP 4: Also add a safety check BEFORE clicking next button
//
// FIND this section (around line 985-989):
//   if (pagination.hasNext && totalPages < maxPages) {
//       await clickNextButton();
//       ...
//   }
//
// REPLACE with:
// -----------------------------------------------------------------------------

/*
REPLACE YOUR CLICK NEXT SECTION WITH THIS:

    // Check pagination state
    const pagination = detectPaginationState();
    
    // NEW: Safety check - don't click next if page is empty
    if (pagination.isEmpty || pagination.profileCount === 0) {
        console.log('[CS] ✅ Current page is empty - stopping before clicking next');
        console.log(`[CS] Reason: ${pagination.emptyReason}`);
        break;
    }
    
    if (pagination.hasNext && totalPages < maxPages && !pagination.isEmpty) {
        console.log(`[CS] Navigating to page ${totalPages + 1}...`);
        await clickNextButton();
        
        // Wait for new page to load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // NEW: Immediately check if new page is empty
        const newPageCheck = detectEmptyResultsState();
        if (newPageCheck.isEmpty) {
            console.log('[CS] ✅ New page is empty after navigation - stopping');
            break;
        }
        
        totalPages++;
    } else {
        console.log('[CS] No more pages or reached max - ending pagination');
        break;
    }
*/


// -----------------------------------------------------------------------------
// BONUS: Add consecutive empty page tracking for extra safety
// Add this variable at the start of startScraping():
// -----------------------------------------------------------------------------

/*
ADD THIS VARIABLE AT THE START OF startScraping():

    let consecutiveEmptyPages = 0;
    const MAX_CONSECUTIVE_EMPTY = 2; // Stop after 2 empty pages in a row

THEN ADD THIS CHECK AFTER SCRAPING A PAGE (around line 965):

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
*/


// =============================================================================
// QUICK REFERENCE: The selectors that work (as of Jan 2026)
// =============================================================================

const LINKEDIN_SELECTORS = {
    // Profile detection (MOST RELIABLE - use this!)
    profileCards: '[data-chameleon-result-urn]',
    
    // Empty state detection
    emptyState: '.search-reusable-search-no-results',
    emptyStateAlt: '.artdeco-empty-state',
    emptyStateHeadline: 'h2.artdeco-empty-state__headline',
    
    // Pagination
    nextButton: 'button[aria-label="Next"]',
    prevButton: 'button[aria-label="Previous"]',
    activePage: 'button[aria-current="true"]',
    
    // Containers
    resultsContainer: '.search-results-container',
    resultsHeader: '.search-results-container h2'
};


// =============================================================================
// TESTING: Run this in console to verify the fix works
// =============================================================================

function testEmptyDetection() {
    const result = detectEmptyResultsState();
    console.log('Empty Detection Test Result:', result);
    
    if (result.isEmpty) {
        console.log('✅ PASS: Would correctly stop pagination');
    } else if (result.profileCount > 0) {
        console.log('✅ PASS: Would correctly continue scraping');
    } else {
        console.log('⚠️ UNCERTAIN: Manual review needed');
    }
    
    return result;
}

// Run: testEmptyDetection()
