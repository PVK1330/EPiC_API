# Team Workload Monitoring - Quick Setup Guide

## ⚡ Quick Start (30 seconds)

1. **Server Already Updated** - Your Express app now includes workload routes
2. **Restart Server:**
   ```bash
   npm run dev
   # or
   npm start
   ```
3. **Automatic Seeding** - Dummy data (5 caseworkers, 15 cases, 40 tasks) loads automatically

## 🔗 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workload/team-workload` | GET | Team metrics dashboard |
| `/api/workload/pending-tasks` | GET | All pending/in-progress tasks |
| `/api/workload/deadline-monitor` | GET | Case deadline tracking |
| `/api/workload/caseworker/:id/performance` | GET | Individual caseworker stats |

## 🧪 Test Immediately

```bash
# 1. Get authentication token first (from your auth endpoint)
# Then use it in these requests:

# See all caseworkers' workload
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/team-workload

# See all pending tasks
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/pending-tasks

# See deadline risks
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/deadline-monitor
```

## 📊 What You Get

### Team Workload Response Includes:
- Caseworker names & departments
- Active case counts
- Overdue case alerts
- Pending task counts
- Average completion times
- Workload percentage (0-100%)
- Health status (Healthy/Medium/High/Critical)

### Response Example:
```json
{
  "team_summary": {
    "total_caseworkers": 5,
    "total_active_cases": 12,
    "total_overdue_cases": 3,
    "total_pending_tasks": 18,
    "average_workload_percentage": 45
  },
  "caseworkers": [
    {
      "caseworker_name": "John Smith",
      "active_cases": 8,
      "overdue": 2,
      "tasks_pending": 5,
      "avg_completion_time_days": 3.5,
      "workload_percentage": 60,
      "health_status": "High"
    }
  ]
}
```

## 📋 Key Features

✅ **Risk Status** - Automatic detection:
- 🔴 "Breached" (overdue)
- 🟡 "At Risk" (0-15 days left)
- 🟢 "On Track" (>15 days)

✅ **Health Scoring** - Team capacity assessment with color codes

✅ **Task Tracking** - Pending/in-progress with deadline alerts

✅ **Performance Metrics** - Completion rates and avg times

✅ **Error Handling** - Clean JSON responses

## 🔧 Architecture

**3-Layer Structure:**

```
Routes (workload.routes.js)
   ↓
Controllers (workload.controller.js) 
   ↓
Utils (workload.utils.js) + DB (Sequelize)
```

**Database Flow:**
```
User (Caseworker) 
  → hasMany Cases
  → hasMany Tasks
```

## 📁 Files Created/Updated

### New Files:
- ✨ `src/controllers/AdminControllers/workload.controller.js` (384 lines)
- ✨ `src/routes/workload.routes.js` (45 lines)
- ✨ `src/seeders/workload.seeder.js` (195 lines)
- ✨ `src/utils/workload.utils.js` (117 lines)

### Updated Files:
- 🔄 `src/app.js` - Added workload routes
- 🔄 `src/server.js` - Added workload seeder call
- 🔄 `src/routes/index.js` - Exported workload routes

## 🧑‍💼 Seeded Test Data

**5 Caseworkers created:**
```
1. John Smith      - Senior Caseworker, New York (john.smith@elitepic.com)
2. Sarah Johnson   - Caseworker, California
3. Michael Chen    - Caseworker, Texas
4. Emma Wilson     - Junior Caseworker, Florida
5. David Patel     - Caseworker, Illinois
```

**All use password:** `caseworker123`

**15 Cases** across all statuses with varying deadlines

**40 Tasks** pending, in-progress, and completed

## 🚀 Production Checklist

- [x] Clean, production-ready code
- [x] Proper error handling with try-catch
- [x] Consistent JSON responses
- [x] Sequelize associations properly used
- [x] Async/await throughout
- [x] Authentication middleware applied
- [x] Role-based access control (Admin + Caseworker)
- [x] Comprehensive documentation
- [x] Utility functions for calculations
- [x] Seed script with realistic data

## 💡 Usage Example in Frontend

```javascript
// React/Vue component example
const fetchTeamWorkload = async () => {
  const response = await fetch('/api/workload/team-workload', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  console.log(data.data.team_summary);
  // Display: total_caseworkers, total_active_cases, etc.
};

// Display pending tasks
const fetchPendingTasks = async () => {
  const response = await fetch('/api/workload/pending-tasks', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  // Tasks grouped by risk: data.data.tasks
};
```

## 🔄 API Response Pattern

All endpoints return:
```json
{
  "status": "success|error",
  "message": "Human-readable message",
  "data": { /* endpoint-specific data */ },
  "error": "Optional detailed error"
}
```

## 📞 Common Questions

**Q: Where are the endpoints?**
A: `/api/workload/team-workload`, `/api/workload/pending-tasks`, etc.

**Q: Do I need to seed data?**
A: No! It's automatic when you start the server.

**Q: How do I get a token?**
A: Use your existing auth endpoint with one of the seeded caseworker emails.

**Q: Can I modify seeded data?**
A: Yes! Edit `src/seeders/workload.seeder.js` and restart server.

**Q: What if seeding fails?**
A: Check PostgreSQL is running and database credentials in `.env` are correct.

## 📚 Full Documentation

See `WORKLOAD_MONITORING_DOCS.md` for:
- Complete API specifications
- All utility functions
- Error handling details
- Performance metrics explanations
- Future enhancement ideas

---

**Status:** ✅ Ready to Use  
**Test Now:** Restart server and hit the endpoints!
