# Quick Test Functions - Run Directly from Function Dropdown

## Problem
When you run `readAllSheetsFromSpreadsheet()` or `readSheetFromSpreadsheet()` directly from the function dropdown, they fail because they need a `spreadsheetId` parameter.

## Solution
I've added helper functions that you can run directly without parameters!

---

## Available Test Functions

### 1. `testReadAllSheets()`
**Purpose:** Test reading all sheets from Megan Bailey's spreadsheet

**How to Run:**
1. Select `testReadAllSheets` from function dropdown
2. Click **Run** ▶️
3. Check execution log

**What It Does:**
- Reads all sheets from Megan Bailey's spreadsheet
- Shows sheet names, row counts, headers, and format validation

**Expected Output:**
```
Reading all sheets from spreadsheet: 1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE
Found 3 sheets in "Megan Bailey - LinkedIn Connections"
  Processing sheet "12_28_25": 150 rows × 12 cols
    Headers: Date, Name, Title, Location, Connection Source, LinkedIn URL...
    Format check: {"hasDate":true,"hasName":true,...}
✅ Successfully read 3 sheets
```

---

### 2. `testReadSheet()`
**Purpose:** Test reading a specific sheet (12_28_25) from Megan Bailey's spreadsheet

**How to Run:**
1. Select `testReadSheet` from function dropdown
2. Click **Run** ▶️
3. Check execution log

**What It Does:**
- Reads the "12_28_25" sheet from Megan Bailey's spreadsheet
- Shows headers, data rows, and format validation

**Expected Output:**
```
Reading sheet from spreadsheet: 1ZgOY5yrVKWxO8cKBBKTjNx2oQNQ1vhBeVzjQYz8DvcE, sheet: "12_28_25"
Opened spreadsheet: "Megan Bailey - LinkedIn Connections"
Reading sheet: "12_28_25"
Sheet dimensions: 150 rows × 12 cols
Headers: Date, Name, Title, Location, Connection Source, LinkedIn URL, Accreditation 1, ...
Format check: {"expectedColumns":[...],"actualColumnCount":12,"matchesExpected":true}
Data rows: 150
```

---

### 3. `runTestSheetsAccess()`
**Purpose:** Run the full sheets access test with formatted output

**How to Run:**
1. Select `runTestSheetsAccess` from function dropdown
2. Click **Run** ▶️
3. Check execution log

**What It Does:**
- Tests access to all recruiter sheets from BigQuery
- Tests the 3 hardcoded test sheets
- Shows formatted summary

**Expected Output:**
```
✅ Megan Bailey (test): 3 sheets - 12_16_25, 12_25_25, 12_28_25
✅ Patrick Kelly (test): 2 sheets - 12_19_25, 12_28_25
✅ Taylor Newman (test): 8 sheets - 11_27_25, 11_29_25, ...

=== SUMMARY ===
Total tested: 3
✅ Accessible: 3
❌ Errors: 0
```

---

## Why BigQuery Returned 0 Recruiters

The `testSheetsAccess()` function queries BigQuery for recruiters with `output_sheet_id`, but it seems the recruiters table doesn't have sheet IDs stored yet.

**To Fix:**
1. The recruiters need to have their `output_sheet_id` and `output_sheet_url` populated in BigQuery
2. This can be done via:
   - Manual SQL UPDATE
   - Chrome Extension sync (when it creates recruiters)
   - Command & Control sheet sync (when implemented)

**For Now:**
- The function still tests the 3 hardcoded sheets (Megan Bailey, Patrick Kelly, Taylor Newman)
- This confirms Apps Script **can** access Google Sheets ✅

---

## Quick Test Checklist

✅ **Step 1:** Run `runTestSheetsAccess()`
- Should show 3 accessible sheets
- Confirms Apps Script has Sheets permissions

✅ **Step 2:** Run `testReadAllSheets()`
- Should read all sheets from Megan Bailey's spreadsheet
- Shows sheet structure and format

✅ **Step 3:** Run `testReadSheet()`
- Should read the "12_28_25" sheet
- Shows headers and data format

---

## Next Steps

Once you confirm these work:
1. ✅ Apps Script can read Google Sheets
2. ✅ Sheet format matches expected structure
3. ✅ Headers are consistent

You can then:
- Implement backfill functions to read historical data
- Sync recruiters from Command & Control sheet
- Add scheduled triggers for automated syncing

