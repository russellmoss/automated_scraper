# Answers to Sheets Access Questions

## Question 1: Does our Apps Script have permissions to read from Google Sheets?

**Answer:** ✅ **YES, but it depends on YOUR Google account permissions.**

### How Apps Script Permissions Work:
- Apps Script runs with **your Google account permissions** (the account that deployed the script)
- It does **NOT** use a service account
- If you have access to a sheet, Apps Script can read it
- If you don't have access, Apps Script cannot read it

### To Grant Access:
1. The first time Apps Script tries to access Sheets, it will prompt you to authorize
2. Click "Review permissions" → "Allow"
3. The script will then have access to all sheets you can access

---

## Question 2: Can you show me how we currently read from sheets (if at all)?

**Answer:** ❌ **We currently do NOT read from Google Sheets.**

### Current State:
- The Apps Script only **writes to BigQuery** (receives data from Chrome Extension)
- There's a stub function `syncRecruitersFromSheets()` that's not implemented
- No `SpreadsheetApp` usage in the current code

### What We Added:
✅ **New functions added to `Code.gs`:**
1. `testSheetsAccess()` - Tests access to all recruiter sheets
2. `readAllSheetsFromSpreadsheet(spreadsheetId)` - Reads all sheets from a spreadsheet
3. `readSheetFromSpreadsheet(spreadsheetId, sheetName)` - Reads a specific sheet tab

---

## Question 3: Is there a service account, and does it have Sheets API access?

**Answer:** ❌ **No service account is used by Apps Script.**

### Apps Script Authentication:
- Uses **OAuth 2.0** with your Google account
- No service account credentials needed
- Permissions are granted interactively when first accessing Sheets

### Service Account (Separate):
- The **Chrome Extension** uses a service account for Google Sheets API
- This is separate from Apps Script
- Apps Script does not use this service account

---

## Question 4: Can you add a function to Code.gs that reads all sheets from a given spreadsheet ID and returns the data?

**Answer:** ✅ **YES - Already added!**

### Functions Added:

#### 1. `readAllSheetsFromSpreadsheet(spreadsheetId, includeHeaders = true)`

Reads all sheet tabs from a spreadsheet and returns structured data.

**Usage:**
```javascript
// In Apps Script console
const result = readAllSheetsFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');
console.log(result);
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
      "headers": ["Date", "Name", "Title", ...],
      "data": [ ... ],
      "expectedFormat": { ... }
    },
    "12_21_25": { ... }
  }
}
```

#### 2. `readSheetFromSpreadsheet(spreadsheetId, sheetName = null, includeHeaders = true)`

Reads a specific sheet tab (or first sheet if `sheetName` is null).

**Usage:**
```javascript
// Read first sheet
const result = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');

// Read specific sheet
const result = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', '12_28_25');
```

#### 3. `testSheetsAccess()`

Tests access to all recruiter sheets from BigQuery + hardcoded test sheets.

**Usage:**
```javascript
// In Apps Script console
const result = testSheetsAccess();
console.log(`✅ Accessible: ${result.accessible}/${result.totalTested}`);
```

---

## How to Test

### Step 1: Test Access to All Sheets

**In Apps Script Console:**
1. Go to [script.google.com](https://script.google.com)
2. Open your Savvy Pirate Apps Script project
3. Select `testSheetsAccess` from function dropdown
4. Click "Run" ▶️
5. Check execution log

**Expected Output:**
```
✅ Megan Bailey: 5 sheets - 12_28_25, 12_21_25, ...
✅ Patrick Kelly: 3 sheets - 12_28_25, ...
❌ Some Recruiter: Exception: You do not have permission...
```

### Step 2: Verify Sheet Format

**In Apps Script Console:**
```javascript
const result = readSheetFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE', '12_28_25');
console.log('Headers:', result.headers);
console.log('Format check:', result.formatCheck);
```

**Expected:**
- Headers: `["Date", "Name", "Title", "Location", "Connection Source", "LinkedIn URL", ...]`
- `formatCheck.matchesExpected`: `true`
- `actualColumnCount`: `>= 6`

### Step 3: Test Reading All Sheets

**In Apps Script Console:**
```javascript
const result = readAllSheetsFromSpreadsheet('1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE');
console.log(`Found ${result.sheetCount} sheets`);
Object.keys(result.sheets).forEach(name => {
  console.log(`  - ${name}: ${result.sheets[name].rowCount} rows`);
});
```

---

## Next Steps

1. ✅ **Deploy the updated Apps Script** (save and redeploy Web App)
2. ✅ **Run `testSheetsAccess()`** to verify access to all 29 sheets
3. ✅ **Check sheet formats** using `readSheetFromSpreadsheet()`
4. ✅ **If any sheets are inaccessible**, share them with your Google account
5. ✅ **Once confirmed**, you can implement backfill or sync functions

---

## Quick Reference

### HTTP POST Actions Available:

```bash
# Test access to all sheets
curl -X POST "YOUR_APPS_SCRIPT_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "test_sheets_access", "data": {}}'

# Read all sheets from a spreadsheet
curl -X POST "YOUR_APPS_SCRIPT_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "read_all_sheets", "data": {"spreadsheetId": "SHEET_ID"}}'

# Read a specific sheet
curl -X POST "YOUR_APPS_SCRIPT_URL/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "read_sheet", "data": {"spreadsheetId": "SHEET_ID", "sheetName": "12_28_25"}}'
```

---

## Summary

| Question | Answer |
|----------|--------|
| Does Apps Script have Sheets permissions? | ✅ Yes (uses your Google account permissions) |
| How do we currently read from sheets? | ❌ We don't (only write to BigQuery) |
| Is there a service account? | ❌ No (Apps Script uses OAuth 2.0) |
| Can you add a function to read sheets? | ✅ Yes (already added 3 functions) |

**Status:** ✅ **Ready to test!**

