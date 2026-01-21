# LinkedIn Scraper Codebase Diagnostic Questions

## Instructions for Cursor AI

Please analyze the entire codebase and answer each question below thoroughly. Save all answers to a new file called `search-logic-answers.md` in the root directory of this project. For each answer, include:
- The specific file(s) and line number(s) where you found the relevant code
- Code snippets where helpful
- Any concerns or potential issues you notice

---

## Section 1: Project Architecture & Tech Stack

### 1.1 Core Technology
- What is the primary technology/framework used for this scraper? (Chrome Extension, Puppeteer, Playwright, Selenium, etc.)
- What programming language(s) are used?
- List all major dependencies from package.json or equivalent manifest file

### 1.2 File Structure
- Provide a tree view of the project's file structure
- Which file(s) contain the main scraping logic?
- Which file(s) handle pagination?
- Which file(s) manage the search queue (iterating through multiple searches)?

### 1.3 Entry Points
- What is the main entry point for starting a scrape session?
- How is the scraper triggered? (user click, scheduled job, API call, etc.)
- Is there a background script, content script, or service worker architecture?

---

## Section 2: Search Queue Management

### 2.1 Search URL Handling
- How are the LinkedIn search URLs loaded into the system?
- Where is the list of searches stored/imported from? (CSV, hardcoded, API, Google Sheets?)
- How does the scraper know which search to run next?

### 2.2 Search Iteration
- Show the exact code that iterates through multiple searches
- What triggers the transition from one search (e.g., "Jeff Nash - Financial Advisor") to the next search (e.g., "Jeff Nash - Financial Consultant")?
- Is there any state persistence between searches? (localStorage, database, file, etc.)

### 2.3 Progress Tracking
- How does the scraper track which searches have been completed?
- What happens if the scraper crashes mid-session? Can it resume?
- Is there a status indicator or progress log?

---

## Section 3: Pagination Logic (CRITICAL)

### 3.1 Current Pagination Implementation
- Show the COMPLETE code block that handles pagination (moving from page 1 to page 2, etc.)
- What condition(s) determine when to click "Next" and continue to another page?
- What condition(s) determine when to STOP paginating and move to the next search?

### 3.2 Page Navigation
- How does the scraper navigate to the next page? (clicking button, modifying URL, etc.)
- What is the exact selector used to find the "Next" button?
- Is there any wait/delay logic after clicking Next?

### 3.3 End-of-Results Detection
- Is there ANY code that checks for "No results found" or empty search results?
- Is there ANY code that checks if profile cards exist on the page before scraping?
- What happens currently when the scraper lands on a page with zero results?
- Is there a maximum page limit configured?

### 3.4 Pagination Selectors
- List ALL CSS selectors or XPath expressions used for pagination elements
- List ALL CSS selectors or XPath expressions used to detect search result cards/profiles

---

## Section 4: Profile Scraping Logic

### 4.1 Profile Detection
- What selector(s) identify a profile card in search results?
- How many profiles does LinkedIn typically show per page? Is this hardcoded anywhere?
- Is there validation that profiles were actually found before proceeding?

### 4.2 Data Extraction
- What data fields are extracted from each profile? (name, title, company, profile URL, etc.)
- Show the code that extracts profile data from the DOM
- Are there any data cleaning or transformation functions?

### 4.3 Data Storage
- Where is scraped profile data stored during the scraping session?
- How is data exported/saved after scraping completes? (Google Sheets API, CSV download, database, etc.)
- Is data saved incrementally or only at the end?

---

## Section 5: Wait & Timing Logic

### 5.1 Page Load Handling
- How does the scraper wait for page content to load?
- What element(s) does it wait for before starting to scrape?
- What is the timeout duration for page loads?

### 5.2 Rate Limiting
- What delays are implemented between page navigations?
- What delays are implemented between scraping individual profiles?
- Is there any randomization in delays to appear more human-like?

### 5.3 LinkedIn-Specific Handling
- Is there any handling for LinkedIn's lazy-loading of search results?
- Is there any scrolling logic to load more results?
- Is there detection for LinkedIn's "you've reached your search limit" messages?

---

## Section 6: Error Handling

### 6.1 Current Error Handling
- What try/catch blocks exist around the pagination logic?
- What try/catch blocks exist around the scraping logic?
- What happens when an error is thrown? Does it stop everything or continue?

### 6.2 Failure Scenarios
- What happens if a page times out?
- What happens if the "Next" button is not found?
- What happens if no profile cards are found on a page?
- What happens if LinkedIn returns an error page or rate limit warning?

### 6.3 Logging
- What logging/console output exists for debugging?
- Are there any log files generated?
- What visibility does the user have into what the scraper is doing?

---

## Section 7: The Specific Bug Investigation

### 7.1 Symptoms Analysis
- Based on the code, what would happen if the scraper lands on a LinkedIn page showing "No results found"?
- Trace through the pagination logic step-by-step for this scenario
- Identify the exact line(s) of code where the bug likely occurs

### 7.2 Infinite Loop Risk
- Is there any code that could cause an infinite loop when results are empty?
- Is there a maximum iteration/page safeguard?

### 7.3 Next Search Trigger
- What EXACTLY triggers moving from one completed search to the next search in the queue?
- Could an empty results page prevent this trigger from firing?

---

## Section 8: DOM Selectors Inventory

### 8.1 Complete Selector List
Provide a complete list of ALL CSS selectors and/or XPath expressions used in the codebase, organized by purpose:

**Pagination selectors:**
- (list all)

**Profile/result card selectors:**
- (list all)

**Data extraction selectors (name, title, etc.):**
- (list all)

**Error/empty state selectors:**
- (list all, or note if none exist)

**Login/authentication selectors:**
- (list all)

**Any other LinkedIn-specific selectors:**
- (list all)

---

## Section 9: Configuration & Settings

### 9.1 Configurable Parameters
- What settings/parameters can be configured by the user?
- Where are default values defined?
- Is there a config file?

### 9.2 LinkedIn Credentials
- How does the scraper authenticate with LinkedIn? (assumes logged-in browser session, stored cookies, etc.)
- Is there session validation before starting?

---

## Section 10: Integration Points

### 10.1 External Services
- What external services/APIs does this integrate with? (Google Sheets, BigQuery, Supabase, etc.)
- How is data sent to these services?
- What authentication is used for these services?

### 10.2 Input Sources
- How does the scraper receive the list of searches to perform?
- Is there a connection to the Google Sheet mentioned in the mapping file?

---

## Section 11: Code Quality Assessment

### 11.1 Potential Issues
- Identify any code that looks fragile or likely to break
- Identify any hardcoded values that should be configurable
- Identify any missing error handling
- Identify any race conditions or timing issues

### 11.2 Recommendations Preview
- Based on your analysis, what are the top 3 changes needed to fix the empty results pagination bug?
- What other improvements would you recommend?

---

## Section 12: Reproduction Steps

### 12.1 How to Test
- What are the exact steps to run this scraper locally for testing?
- What environment setup is required?
- How can someone reproduce the "stuck on empty page" bug?

---

## Final Summary

After answering all questions above, provide:

1. **Root Cause Hypothesis**: Your best assessment of why the scraper gets stuck on empty result pages
2. **Affected Files**: List of files that need to be modified to fix this
3. **Risk Assessment**: How complex is this fix? What could break?
4. **Missing Capabilities**: What's not implemented that should be? (e.g., empty state detection, retry logic, etc.)

---

*Save this completed analysis to `search-logic-answers.md` in the project root directory.*
