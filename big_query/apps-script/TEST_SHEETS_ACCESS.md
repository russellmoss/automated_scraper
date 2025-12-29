# Testing Google Sheets Access from Apps Script

## Overview

The Apps Script Web App now includes functions to test and read from Google Sheets. This document explains how to test access and what to expect.

## Important: Apps Script Permissions

**Apps Script does NOT use a service account.** Instead, it runs with **your Google account permissions** (the account that deployed the Apps Script).

### What This Means:
- ✅ If **you** (the deployer) have access to a sheet, Apps Script can read it
- ❌ If you don't have access, Apps Script cannot read it
- 🔐 Apps Script will prompt for authorization the first time it accesses Sheets

### To Grant Access:
1. Run one of the test functions (see below)
2. Apps Script will prompt you to authorize
3. Click "Review permissions" → "Allow"
4. The script will then have access to Sheets

---

## Test Functions Added

### 1. `testSheetsAccess()`

Tests access to all recruiter sheets from BigQuery + hardcoded test sheets.

**How to Run:**

**Option A: Via Apps Script Console**
1. Go to [script.google.com](https://script.google.com)
2. Open your Savvy Pirate Apps Script project
3. In the function dropdown, select `testSheetsAccess`
4. Click "Run" ▶️
5. Check the execution log for results

**Option B: Via HTTP POST (from Chrome Extension or curl)**
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "test_sheets_access",
    "data": {}
  }'
```

**Returns:**
```json
{
  "success": true,
  "totalTested": 32,
  "accessible": 29,
  "errors": 3,
  "results": [
    {
      "recruiter": "Megan Bailey",
      "sheetId": "1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE",
      "status": "✅ ACCESSIBLE",
      "sheetCount": 5,
      "sheetNames": ["12_28_25", "12_21_25", "12_14_25", ...],
      "headers": ["Date", "Name", "Title", "Location", "Connection Source", "LinkedIn URL", ...],
      "headerCount": 12
    },
    {
      "recruiter": "Some Recruiter",
      "sheetId": "xxx",
      "status": "❌ ERROR",
      "error": "Exception: You do not have permission to access the requested document."
    }
  ]
}
```

---

### 2. `readAllSheetsFromSpreadsheet(spreadsheetId, includeHeaders = true)`

Reads all sheets from a given spreadsheet ID.

**How to Run:**

**Option A: Via Apps Script Console**
```javascript
// In Apps Script console
const result = readAllSheetsFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');
console.log(JSON.stringify(result, null, 2));
```

**Option B: Via HTTP POST**
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "read_all_sheets",
    "data": {
      "spreadsheetId": "1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE",
      "includeHeaders": true
    }
  }'
```

**Returns:**
```json
{
  "success": true,
  "spreadsheetName": "Megan Bailey - LinkedIn Connections",
  "spreadsheetId": "1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE",
  "sheetCount": 5,
  "sheets": {
    "12_28_25": {
      "rowCount": 150,
      "columnCount": 12,
      "headers": ["Date", "Name", "Title", "Location", "Connection Source", "LinkedIn URL", "Accreditation 1", ...],
      "data": [
        ["2025-12-28", "John Doe", "Financial Advisor", "New York, NY", "Megan Bailey", "https://linkedin.com/in/john-doe", "CFP®", ...],
        ...
      ],
      "expectedFormat": {
        "hasDate": true,
        "hasName": true,
        "hasTitle": true,
        "hasLocation": true,
        "hasSource": true,
        "hasLinkedIn": true,
        "hasAccreds": true
      }
    },
    "12_21_25": { ... },
    ...
  }
}
```

---

### 3. `readSheetFromSpreadsheet(spreadsheetId, sheetName = null, includeHeaders = true)`

Reads a specific sheet tab from a spreadsheet.

**How to Run:**

**Option A: Via Apps Script Console**
```javascript
// Read first sheet
const result1 = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');

// Read specific sheet
const result2 = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', '12_28_25');
```

**Option B: Via HTTP POST**
```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "read_sheet",
    "data": {
      "spreadsheetId": "1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE",
      "sheetName": "12_28_25",
      "includeHeaders": true
    }
  }'
```

**Returns:**
```json
{
  "success": true,
  "spreadsheetId": "1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE",
  "sheetName": "12_28_25",
  "rowCount": 150,
  "columnCount": 12,
  "headers": ["Date", "Name", "Title", "Location", "Connection Source", "LinkedIn URL", ...],
  "data": [ ... ],
  "formatCheck": {
    "expectedColumns": ["Date", "Name", "Title", "Location", "Connection Source", "LinkedIn URL", ...],
    "actualColumnCount": 12,
    "matchesExpected": true
  }
}
```

---

## Expected Sheet Format

All recruiter sheets should follow this format:

| Column | Index | Description |
|--------|-------|-------------|
| Date | 0 | Scrape date (YYYY-MM-DD) |
| Name | 1 | Advisor full name |
| Title | 2 | Job title |
| Location | 3 | Location (city, state) |
| Connection Source | 4 | Recruiter name |
| LinkedIn URL | 5 | Full LinkedIn profile URL |
| Accreditation 1 | 6 | First accreditation (e.g., "CFP®") |
| Accreditation 2 | 7 | Second accreditation |
| Accreditation 3 | 8 | Third accreditation |
| Accreditation 4 | 9 | Fourth accreditation |
| Accreditation 5 | 10 | Fifth accreditation |
| Accreditation 6 | 11 | Sixth accreditation |

**Minimum Required:** 6 columns (Date through LinkedIn URL)

---

## Testing Checklist

### Step 1: Test Access to All Sheets
```javascript
// In Apps Script console
const result = testSheetsAccess();
console.log(`✅ Accessible: ${result.accessible}/${result.totalTested}`);
console.log(`❌ Errors: ${result.errors}`);
```

**Expected:**
- ✅ All 29 recruiter sheets should be accessible
- ✅ If any errors, check if you have access to those sheets

### Step 2: Verify Sheet Format
```javascript
// Test one sheet
const result = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', '12_28_25');
console.log('Headers:', result.headers);
console.log('Format check:', result.formatCheck);
```

**Expected:**
- ✅ Headers should match expected format
- ✅ `formatCheck.matchesExpected` should be `true`
- ✅ `actualColumnCount` should be >= 6

### Step 3: Test Reading All Sheets from One Spreadsheet
```javascript
// Read all sheets from Megan Bailey's spreadsheet
const result = readAllSheetsFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');
console.log(`Found ${result.sheetCount} sheets`);
console.log('Sheet names:', Object.keys(result.sheets));
```

**Expected:**
- ✅ Should return all weekly tabs (e.g., "12_28_25", "12_21_25", etc.)
- ✅ Each sheet should have data rows
- ✅ Headers should be consistent across sheets

---

## Troubleshooting

### Error: "You do not have permission to access the requested document"

**Solution:**
1. Open the Google Sheet in your browser
2. Click "Share" → Add your Google account with "Viewer" or "Editor" access
3. Re-run the test

### Error: "Script function not found: testSheetsAccess"

**Solution:**
1. Make sure you've saved the updated `Code.gs` file
2. Redeploy the Apps Script Web App (even if it's the same version)
3. Wait a few seconds for the deployment to propagate

### Error: "Exception: Service Spreadsheets failed while accessing document"

**Solution:**
1. Check if the spreadsheet ID is correct
2. Verify the spreadsheet exists and is not deleted
3. Make sure you're signed in with the correct Google account

---

## Next Steps

Once you've confirmed:
1. ✅ Apps Script can access all 29 sheets
2. ✅ All sheets have the expected format
3. ✅ Headers are consistent

You can then:
- Implement `syncRecruitersFromSheets()` to read from Command & Control sheet
- Add a function to backfill historical data from sheets
- Create a scheduled trigger to sync sheets → BigQuery

---

## Quick Test Script

Copy this into Apps Script console to run all tests:

```javascript
function runAllTests() {
  console.log('=== Testing Sheets Access ===');
  const accessTest = testSheetsAccess();
  console.log(`Accessible: ${accessTest.accessible}/${accessTest.totalTested}`);
  
  if (accessTest.errors > 0) {
    console.log('\n❌ Errors:');
    accessTest.results.filter(r => r.status === '❌ ERROR').forEach(r => {
      console.log(`  - ${r.recruiter}: ${r.error}`);
    });
  }
  
  console.log('\n=== Testing Sheet Format ===');
  const testSheetId = '1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE'; // Megan Bailey
  const sheetTest = readSheetFromSpreadsheet(testSheetId);
  console.log('Headers:', sheetTest.headers);
  console.log('Format check:', sheetTest.formatCheck);
  
  console.log('\n=== Testing All Sheets Read ===');
  const allSheetsTest = readAllSheetsFromSpreadsheet(testSheetId);
  console.log(`Found ${allSheetsTest.sheetCount} sheets`);
  Object.keys(allSheetsTest.sheets).forEach(name => {
    const sheet = allSheetsTest.sheets[name];
    console.log(`  - ${name}: ${sheet.rowCount} rows, ${sheet.columnCount} cols`);
  });
}
```

