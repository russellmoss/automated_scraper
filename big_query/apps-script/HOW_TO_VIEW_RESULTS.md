# How to View Function Results in Apps Script

## Problem
When you run functions in Apps Script, the execution logs show "Execution started" and "Execution completed" but no output.

## Solution

### Option 1: Check Execution Logs (After Update)

I've updated the functions to use `Logger.log()` which shows up in execution logs. After you save and run again, you should see:

1. Go to **Executions** tab
2. Click on the execution
3. Click **View logs** or **Execution log**
4. You should now see detailed output

### Option 2: Use the Helper Function

I've added a helper function `runTestSheetsAccess()` that formats the output nicely:

1. In Apps Script editor, select `runTestSheetsAccess` from function dropdown
2. Click **Run** ▶️
3. Check the execution log - you'll see formatted output

### Option 3: View Return Values Directly

1. In Apps Script editor, select the function (e.g., `testSheetsAccess`)
2. Click **Run** ▶️
3. After execution completes, look at the **Return value** section (if visible)
4. Or add this at the end of your function temporarily:

```javascript
function testSheetsAccess() {
  // ... existing code ...
  
  // Add this at the end to see return value
  Logger.log('=== RETURN VALUE ===');
  Logger.log(JSON.stringify(summary, null, 2));
  
  return summary;
}
```

### Option 4: Use the Debugger

1. Set a breakpoint in your function
2. Click **Debug** (bug icon) instead of Run
3. Step through the code and inspect variables

### Option 5: Call via HTTP POST (See JSON Response)

If you call via HTTP POST, you'll get the JSON response directly:

```bash
curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
  -H "Content-Type: application/json" \
  -d '{"action": "test_sheets_access", "data": {}}'
```

This will return the full JSON response with all results.

---

## What You Should See After Update

After saving the updated code and running `testSheetsAccess()`, the execution log should show:

```
✅ Megan Bailey: 5 sheets - 12_28_25, 12_21_25, ...
✅ Patrick Kelly: 3 sheets - 12_28_25, ...
❌ Some Recruiter: Exception: You do not have permission...

=== SUMMARY ===
Total tested: 32
✅ Accessible: 29
❌ Errors: 3
```

---

## Quick Test

1. **Save** the updated `Code.gs` file
2. **Run** `runTestSheetsAccess()` (the helper function)
3. **Check** the execution log - you should see detailed output now

---

## If Logs Still Don't Show

1. Make sure you're looking at the **Execution log** (not just the execution list)
2. Click on the specific execution to see its log
3. Wait a few seconds - logs can take a moment to appear
4. Try refreshing the page

