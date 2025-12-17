/**
 * LinkedIn DOM Structure Diagnostic Script
 * 
 * Use this script to investigate LinkedIn's DOM structure when selectors break.
 * Run in browser console on a LinkedIn People search results page.
 * 
 * This will help identify:
 * - What p tags exist in profile cards
 * - Which selectors work/don't work
 * - Class names and structure changes
 * - Title/location extraction paths
 */

(function() {
    'use strict';
    
    console.log('🔍 LinkedIn DOM Structure Diagnostic Tool');
    console.log('==========================================\n');
    
    // Get all profile cards (try multiple methods for robustness)
    let cards = document.querySelectorAll('div[data-view-name="people-search-result"]');
    
    // Fallback: If data-view-name changed, try finding cards by LinkedIn profile links
    if (cards.length === 0) {
        console.warn('⚠️ Primary card selector failed, trying fallback method...');
        // Look for containers with LinkedIn profile links (more stable)
        const profileLinks = document.querySelectorAll('a[href*="/in/"][href*="linkedin.com"]');
        if (profileLinks.length > 0) {
            // Find parent containers that likely contain profile cards
            const potentialCards = new Set();
            profileLinks.forEach(link => {
                let parent = link.closest('div, li, article');
                if (parent) potentialCards.add(parent);
            });
            cards = Array.from(potentialCards);
            console.warn(`⚠️ Found ${cards.length} potential cards using fallback method`);
        }
    }
    
    console.log(`Found ${cards.length} profile cards\n`);
    
    if (cards.length === 0) {
        console.error('❌ No profile cards found. Possible reasons:');
        console.error('   1. Not on a LinkedIn People search results page');
        console.error('   2. LinkedIn made major structural changes');
        console.error('   3. Page hasn\'t fully loaded');
        console.error('\nTry:');
        console.error('   - Refresh the page and wait for results to load');
        console.error('   - Navigate to: https://www.linkedin.com/search/results/people/');
        return;
    }
    
    // Analyze first 3 cards for patterns
    const cardsToAnalyze = Math.min(3, cards.length);
    const results = [];
    
    for (let i = 0; i < cardsToAnalyze; i++) {
        const card = cards[i];
        const result = analyzeCard(card, i + 1);
        results.push(result);
        console.log(`\n--- Card ${i + 1} Analysis ---`);
        printCardAnalysis(result);
    }
    
    // Summary
    console.log('\n\n📊 SUMMARY');
    console.log('==========');
    console.log(`Cards analyzed: ${cardsToAnalyze}`);
    console.log(`Average p tags per card: ${(results.reduce((sum, r) => sum + r.totalPTags, 0) / results.length).toFixed(1)}`);
    console.log(`Average data p tags per card: ${(results.reduce((sum, r) => sum + r.dataPTags.length, 0) / results.length).toFixed(1)}`);
    
    // Test selectors
    console.log('\n\n🧪 SELECTOR TESTS');
    console.log('==================');
    testSelectors();
    
    // Suggest selectors
    console.log('\n\n💡 SUGGESTED SELECTORS');
    console.log('======================');
    suggestSelectors(results);
    
    /**
     * Analyze a single card
     */
    function analyzeCard(card, cardNumber) {
        // Get name link (try multiple methods)
        let nameLink = card.querySelector('a[data-view-name="search-result-lockup-title"]');
        // Fallback: find any LinkedIn profile link in the card
        if (!nameLink) {
            nameLink = card.querySelector('a[href*="/in/"][href*="linkedin.com"]');
        }
        const nameText = nameLink ? nameLink.innerText.trim() : 'NOT FOUND';
        
        // Get all p tags
        const allPTags = Array.from(card.querySelectorAll('p'));
        
        // Filter out name paragraph (try multiple methods)
        const contentPTags = allPTags.filter(p => {
            // Check for the standard name link selector
            if (p.querySelector('a[data-view-name="search-result-lockup-title"]')) return false;
            // Fallback: check for LinkedIn profile links
            if (p.querySelector('a[href*="/in/"][href*="linkedin.com"]')) return false;
            return true;
        });
        
        // Filter to get title/location candidates
        const dataPTags = contentPTags.filter(p => {
            const text = p.innerText?.trim() || '';
            return !text.includes('mutual connection') && 
                   !text.includes('other mutual') &&
                   !text.includes('• 1st') && 
                   !text.includes('• 2nd') && 
                   !text.includes('• 3rd') &&
                   !/^•\s*(1st|2nd|3rd)/i.test(text) &&
                   text.length > 3 &&
                   text.length < 200 &&
                   !text.toLowerCase().includes('connect') &&
                   !text.toLowerCase().includes('message') &&
                   !text.toLowerCase().includes('follow');
        });
        
        // Extract details for each data p tag
        const dataPTagDetails = dataPTags.map((p, index) => {
            const text = p.innerText?.trim() || '';
            const classes = Array.from(p.classList || []).join(' ');
            const parent = p.parentElement;
            const parentClasses = parent ? Array.from(parent.classList || []).join(' ') : '';
            const parentTag = parent ? parent.tagName.toLowerCase() : '';
            
            // Try to identify if it's title or location
            const isLikelyTitle = /\b(?:Financial|Investment|Wealth|Portfolio|Advisor|Manager|Consultant|Planner|Director|Principal|Owner|Partner|at |\|)/i.test(text);
            const isLikelyLocation = /(?:Area|Metropolitan|County|,\s*[A-Z]{2}$|United States|Greater|Bay Area)/i.test(text);
            
            return {
                index,
                text: text.substring(0, 100),
                fullText: text,
                classes,
                parentTag,
                parentClasses,
                isLikelyTitle,
                isLikelyLocation
            };
        });
        
        return {
            cardNumber,
            nameText,
            totalPTags: allPTags.length,
            contentPTags: contentPTags.length,
            dataPTags: dataPTagDetails,
            nameLink: nameLink ? 'FOUND' : 'NOT FOUND'
        };
    }
    
    /**
     * Print analysis for a single card
     */
    function printCardAnalysis(result) {
        console.log(`Name: ${result.nameText}`);
        console.log(`Name link: ${result.nameLink}`);
        console.log(`Total p tags: ${result.totalPTags}`);
        console.log(`Content p tags (after filtering name): ${result.contentPTags}`);
        console.log(`Data p tags (title/location candidates): ${result.dataPTags.length}`);
        
        result.dataPTags.forEach((tag, i) => {
            console.log(`\n  Tag ${i + 1}: "${tag.text}"`);
            console.log(`    Classes: ${tag.classes || '(none)'}`);
            console.log(`    Parent: <${tag.parentTag}>`);
            console.log(`    Parent classes: ${tag.parentClasses || '(none)'}`);
            console.log(`    Likely title: ${tag.isLikelyTitle ? '✅' : '❌'}`);
            console.log(`    Likely location: ${tag.isLikelyLocation ? '✅' : '❌'}`);
        });
    }
    
    /**
     * Test various selectors
     */
    function testSelectors() {
        const card = cards[0];
        if (!card) return;
        
        const selectorTests = [
            {
                name: 'Profile Card',
                selectors: [
                    'div[data-view-name="people-search-result"]'
                ]
            },
            {
                name: 'Name Link',
                selectors: [
                    'a[data-view-name="search-result-lockup-title"]'
                ]
            },
            {
                name: 'Title (Current)',
                selectors: [
                    'div[data-view-name="people-search-result"] div.d395caa1:not(.a7293f27) > p',
                    'div[data-view-name="people-search-result"] div.d395caa1:first-of-type > p',
                    'div.acd09c55 > p',
                    'p:nth-of-type(2)'
                ]
            },
            {
                name: 'Location (Current)',
                selectors: [
                    'div[data-view-name="people-search-result"] div.d395caa1.a7293f27 > p',
                    'div[data-view-name="people-search-result"] div.d395caa1:nth-of-type(2) > p',
                    'div.bb0216de > p',
                    'p:nth-of-type(3)'
                ]
            },
            {
                name: 'Next Button',
                selectors: [
                    'button[data-testid="pagination-controls-next-button-visible"]',
                    'button[aria-label="Next"]'
                ]
            }
        ];
        
        selectorTests.forEach(test => {
            console.log(`\n${test.name}:`);
            test.selectors.forEach(selector => {
                try {
                    let element;
                    if (test.name === 'Next Button') {
                        element = document.querySelector(selector);
                    } else {
                        element = card.querySelector(selector);
                    }
                    
                    if (element) {
                        const text = element.innerText?.trim().substring(0, 50) || '';
                        console.log(`  ✅ ${selector}`);
                        console.log(`     → "${text}"`);
                    } else {
                        console.log(`  ❌ ${selector}`);
                    }
                } catch (error) {
                    console.log(`  ⚠️  ${selector} (ERROR: ${error.message})`);
                }
            });
        });
    }
    
    /**
     * Suggest selectors based on analysis
     */
    function suggestSelectors(results) {
        if (results.length === 0 || results[0].dataPTags.length === 0) {
            console.log('⚠️  Cannot suggest selectors - no data found');
            return;
        }
        
        const firstCard = results[0];
        const titleTag = firstCard.dataPTags.find(t => t.isLikelyTitle) || firstCard.dataPTags[0];
        const locationTag = firstCard.dataPTags.find(t => t.isLikelyLocation) || firstCard.dataPTags[1];
        
        console.log('Based on analysis, here are potential selectors:\n');
        
        if (titleTag) {
            console.log('TITLE:');
            if (titleTag.classes) {
                const classList = titleTag.classes.split(' ').filter(c => c.length > 0);
                if (classList.length > 0) {
                    console.log(`  By class: p.${classList.slice(0, 2).join('.')}`);
                }
            }
            if (titleTag.parentClasses) {
                const parentClasses = titleTag.parentClasses.split(' ').filter(c => c.length > 0 && !c.startsWith('_'));
                if (parentClasses.length > 0) {
                    console.log(`  By parent: div.${parentClasses.slice(0, 2).join('.')} > p`);
                }
            }
            console.log(`  Direct p-tag extraction: Use first data p tag (index 0)`);
        }
        
        if (locationTag) {
            console.log('\nLOCATION:');
            if (locationTag.classes) {
                const classList = locationTag.classes.split(' ').filter(c => c.length > 0);
                if (classList.length > 0) {
                    console.log(`  By class: p.${classList.slice(0, 2).join('.')}`);
                }
            }
            if (locationTag.parentClasses) {
                const parentClasses = locationTag.parentClasses.split(' ').filter(c => c.length > 0 && !c.startsWith('_'));
                if (parentClasses.length > 0) {
                    console.log(`  By parent: div.${parentClasses.slice(0, 2).join('.')} > p`);
                }
            }
            console.log(`  Direct p-tag extraction: Use second data p tag (index 1)`);
        }
        
        // Check for distinguishing features
        if (titleTag && locationTag && titleTag.parentClasses !== locationTag.parentClasses) {
            const titleParentClasses = titleTag.parentClasses.split(' ').filter(c => c.length > 0);
            const locationParentClasses = locationTag.parentClasses.split(' ').filter(c => c.length > 0);
            
            // Find classes unique to location
            const locationOnlyClasses = locationParentClasses.filter(c => !titleParentClasses.includes(c));
            const titleOnlyClasses = titleParentClasses.filter(c => !locationParentClasses.includes(c));
            
            if (locationOnlyClasses.length > 0) {
                console.log(`\n💡 Location has unique parent class: ${locationOnlyClasses[0]}`);
                console.log(`   Try: div.${locationOnlyClasses[0]} > p`);
            }
            if (titleOnlyClasses.length > 0) {
                console.log(`💡 Title has unique parent class: ${titleOnlyClasses[0]}`);
            }
        }
    }
    
    // Return results for further inspection
    return {
        cards: Array.from(cards).slice(0, cardsToAnalyze),
        analysis: results,
        testSelectors: testSelectors
    };
})();


