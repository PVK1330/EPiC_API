# PDF Export Debugging Guide

## Changes Made

### 1. Added NODE_ENV to .env
- Set `NODE_ENV=development` to enable detailed error messages in API responses

### 2. Enhanced Error Logging
- Added comprehensive console.log statements throughout the PDF generation process
- Each step now logs its progress with `[PDF Export]` prefix
- Errors include full stack traces

### 3. Improved Error Handling
- All database queries now have `.catch()` handlers with specific error logging
- Added checks for `req.tenantDb` existence
- PDF generation errors are caught and logged with details

### 4. Added Test Endpoint
- Created `/api/dashboard/test-pdf` endpoint to test basic PDF generation
- This helps isolate whether the issue is with PDF generation or data fetching

## Debugging Steps

### Step 1: Restart the Backend Server
The backend needs to be restarted to pick up the changes:

```bash
cd "d:\React\uk client\Elite pic multi-tenant\ElitePic_CRM_backend"
npm run dev
```

### Step 2: Test Basic PDF Generation
This endpoint is mounted under the admin dashboard routes and requires authentication.
Use curl with a valid bearer token, or test from the authenticated frontend.

```
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/dashboard/test-pdf
```

**Expected Results:**
- ✅ If this works: The PDF library is working, issue is with data fetching
- ❌ If this fails: There's a problem with the PDF library setup

### Step 3: Check Backend Console Logs
When you click "Generate Report", watch the backend console for logs:

Look for these log messages:
```
[PDF Export] Starting dashboard PDF generation...
[PDF Export] User authenticated: <userId>
[PDF Export] Fetching dashboard data...
[PDF Export] Case stats: { totalCases: X, activeCases: Y, completedCases: Z }
[PDF Export] Building PDF document definition...
[PDF Export] Generating PDF buffer...
[PDF Generator] Creating PDF printer...
[PDF Generator] Creating PDF document...
[PDF Generator] Ending PDF document...
[PDF Generator] PDF generation completed, chunks: X
[PDF Export] PDF buffer generated successfully, size: X bytes
[PDF Export] Sending PDF response...
[PDF Export] PDF sent successfully
```

### Step 4: Identify the Error
The logs will show exactly where the process fails. Common issues:

#### Error: "No tenant database found"
**Solution:** Check tenant middleware is working correctly

#### Error: "Cannot read property 'Case' of undefined"
**Solution:** Tenant database not initialized properly

#### Error: "Escalation is not defined"
**Solution:** Escalation model not registered (already handled with safeDashboardQuery)

#### Error in PDF Generator
**Solution:** Issue with pdfmake library or document definition

### Step 5: Check Frontend Error Response
With `NODE_ENV=development`, the error response now includes:
```json
{
  "status": "error",
  "message": "Failed to generate dashboard PDF",
  "data": null,
  "error": "Actual error message here",
  "stack": "Full stack trace here"
}
```

Check the browser's Network tab → Response to see the detailed error.

## Common Issues and Solutions

### Issue 1: pdfmake Font Error
**Symptom:** Error about fonts or Helvetica not found
**Solution:** The code now includes both Roboto and Helvetica font definitions

### Issue 2: Database Query Timeout
**Symptom:** Logs show data fetching but then timeout
**Solution:** Increase query timeout or optimize queries

### Issue 3: Memory Issues
**Symptom:** Process crashes or "out of memory" error
**Solution:** Limit the amount of data fetched (already limited to 10 escalations)

### Issue 4: Tenant Database Not Found
**Symptom:** Error: "No tenant database found"
**Solution:** Check authentication middleware and tenant resolution

## Testing Checklist

- [ ] Backend server restarted with new changes
- [ ] Test endpoint `/api/dashboard/test-pdf` works
- [ ] Backend console shows detailed logs
- [ ] Frontend shows detailed error in Network tab
- [ ] Identified the specific error from logs
- [ ] Applied appropriate solution

## Next Steps

1. **Restart your backend server**
2. **Try the test endpoint first**: `http://localhost:5000/api/dashboard/test-pdf`
3. **Check the backend console** for detailed logs
4. **Try the actual export**: Click "Generate Report" button
5. **Share the console logs** if the issue persists

The logs will now tell us exactly where and why the PDF generation is failing!
