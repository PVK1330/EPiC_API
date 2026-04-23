# Team Workload Monitoring - API Quick Reference

## Base URL
```
http://localhost:5000/api/workload
```

## Authentication
All endpoints require:
```
Header: Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 🔗 Endpoints

### 1. Team Workload Dashboard
```
GET /team-workload
```

**Purpose:** Get all caseworkers' metrics and team summary

**Response:**
```json
{
  "status": "success",
  "data": {
    "team_summary": {
      "total_caseworkers": 5,
      "total_active_cases": 12,
      "total_overdue_cases": 3,
      "total_pending_tasks": 18,
      "average_workload_percentage": 45,
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    "caseworkers": [
      {
        "caseworker_id": 1,
        "caseworker_name": "John Smith",
        "email": "john.smith@elitepic.com",
        "job_title": "Senior Caseworker",
        "department": "Immigration Services",
        "region": "New York",
        "active_cases": 8,
        "overdue": 2,
        "tasks_pending": 5,
        "avg_completion_time_days": 3.5,
        "workload_percentage": 60,
        "health_status": "High",
        "health_color": "#FFC107",
        "health_message": "Team is approaching maximum capacity"
      }
    ]
  }
}
```

**Status Codes:**
- `200` Success
- `401` Unauthorized (invalid token)
- `403` Forbidden (insufficient role)
- `500` Server error

---

### 2. Pending Tasks
```
GET /pending-tasks
```

**Purpose:** Get all pending and in-progress tasks with deadline tracking

**Response:**
```json
{
  "status": "success",
  "data": {
    "summary": {
      "breached": 2,
      "at_risk": 5,
      "on_track": 11,
      "total": 18
    },
    "tasks": [
      {
        "task_id": 1,
        "title": "Review visa documentation - Case CAS-010001",
        "case_code": "CAS-010001",
        "case_id": 1,
        "assigned_to": "John Smith",
        "assigned_to_id": 1,
        "assigned_email": "john.smith@elitepic.com",
        "due_date": "2024-01-10",
        "days_remaining": -5,
        "risk_status": "Breached",
        "status_color": "#DC3545",
        "priority": "high",
        "status": "in-progress",
        "created_at": "2024-01-01T08:00:00.000Z"
      }
    ]
  }
}
```

**Risk Status Meanings:**
- `Breached` - Deadline passed (RED #DC3545)
- `At Risk` - 0-15 days left (YELLOW #FFC107)
- `On Track` - >15 days left (GREEN #28A745)

---

### 3. Deadline Monitor
```
GET /deadline-monitor
```

**Purpose:** Monitor case deadlines and identify risks

**Response:**
```json
{
  "status": "success",
  "data": {
    "summary": {
      "breached": 1,
      "at_risk": 4,
      "on_track": 10,
      "total": 15
    },
    "cases": [
      {
        "case_id": 1,
        "case_code": "CAS-010001",
        "candidate_name": "John Smith",
        "caseworker_id": "1",
        "deadline": "2024-01-10",
        "days_remaining": -5,
        "risk_status": "Breached",
        "status_color": "#DC3545",
        "case_status": "In Progress",
        "priority": "high",
        "nationality": "Indian",
        "job_title": "Software Engineer"
      }
    ]
  }
}
```

---

### 4. Caseworker Performance
```
GET /caseworker/:id/performance
```

**Path Parameters:**
- `:id` - User ID of the caseworker (required)

**Example:**
```
GET /caseworker/1/performance
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "caseworker": {
      "id": 1,
      "name": "John Smith",
      "email": "john.smith@elitepic.com",
      "job_title": "Senior Caseworker",
      "department": "Immigration Services",
      "region": "New York"
    },
    "cases": {
      "active": 8,
      "completed": 2,
      "overdue": 2,
      "total": 10
    },
    "tasks": {
      "pending": 5,
      "completed": 15,
      "avg_completion_time_days": 3.5
    },
    "performance_score": 73
  }
}
```

---

## 📊 Data Models

### Caseworker Object
```javascript
{
  caseworker_id: number,
  caseworker_name: string,
  email: string,
  job_title: string,
  department: string,
  region: string,
  active_cases: number,
  overdue: number,
  tasks_pending: number,
  avg_completion_time_days: number,
  workload_percentage: number,     // 0-100
  health_status: "Healthy" | "Medium" | "High" | "Critical",
  health_color: string,             // hex color
  health_message: string
}
```

### Task Object
```javascript
{
  task_id: number,
  title: string,
  case_code: string,
  case_id: number,
  assigned_to: string,              // caseworker name
  assigned_to_id: number,           // user ID
  assigned_email: string,
  due_date: string,                 // YYYY-MM-DD
  days_remaining: number,           // negative = overdue
  risk_status: "Breached" | "At Risk" | "On Track",
  status_color: string,             // hex color
  priority: "low" | "medium" | "high",
  status: "pending" | "in-progress" | "completed",
  created_at: ISO8601DateTime
}
```

### Case Object (Deadline Monitor)
```javascript
{
  case_id: number,
  case_code: string,
  candidate_name: string,
  caseworker_id: string,            // user IDs as string
  deadline: string,                 // YYYY-MM-DD
  days_remaining: number,           // negative = overdue
  risk_status: "Breached" | "At Risk" | "On Track",
  status_color: string,             // hex color
  case_status: "Lead" | "Pending" | "In Progress" | "Completed" | "On Hold",
  priority: "low" | "medium" | "high" | "urgent",
  nationality: string,
  job_title: string
}
```

---

## 🎯 Status Codes & Errors

### Success Responses
```
200 OK
{
  "status": "success",
  "message": "...",
  "data": { ... }
}
```

### Error Responses
```
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
500 Internal Server Error

{
  "status": "error",
  "message": "Error description",
  "data": null,
  "error": "Detailed error message"
}
```

---

## 🧮 Key Calculations

### Days Remaining
```
Days Remaining = deadline - today
- Negative = overdue
- 0-15 = at risk
- >15 = on track
```

### Workload Percentage
```
Workload % = (active_cases / max_capacity) * 100
Default max capacity = 50 cases
Range = 0-100%
```

### Health Status
```
IF overdue > 0:
  Status = "Critical", Color = Red

ELSE IF workload >= 80%:
  Status = "High", Color = Yellow

ELSE IF workload >= 60%:
  Status = "Medium", Color = Yellow

ELSE:
  Status = "Healthy", Color = Green
```

### Average Completion Time
```
Avg Days = Sum(completion_days) / count(completed_tasks)
Includes: tasks with status = "completed"
```

### Performance Score
```
Score = (completed_cases + completed_tasks) / total_items * 100
Range = 0-100%
```

---

## 🔐 Authorization

### Required Roles
- Admin (ID: 1)
- Caseworker (ID: 2)

### Invalid Cases
- No token → 401 Unauthorized
- Invalid token → 401 Unauthorized
- Wrong role → 403 Forbidden
- Invalid caseworker ID → 404 Not Found

---

## 📋 Common Filters (Future Enhancement)

These can be added to query parameters:

```
?caseworker_id=1
?date_from=2024-01-01
?date_to=2024-01-31
?status=Breached
?priority=high
?page=1
?limit=20
```

---

## 🧪 Example cURL Requests

### Get Team Workload
```bash
curl -X GET "http://localhost:5000/api/workload/team-workload" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Get Pending Tasks
```bash
curl -X GET "http://localhost:5000/api/workload/pending-tasks" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Get Deadline Monitor
```bash
curl -X GET "http://localhost:5000/api/workload/deadline-monitor" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Get Caseworker Performance
```bash
curl -X GET "http://localhost:5000/api/workload/caseworker/1/performance" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
``` 

---

## 🚀 Performance Tips

1. **Response Sizes**
   - Team workload: ~2-5KB per caseworker
   - Pending tasks: ~1-2KB per task
   - Deadline monitor: ~1-2KB per case

2. **Query Optimization**
   - Endpoints use efficient Sequelize queries
   - Includes relationships only when needed
   - Raw queries where appropriate

3. **Caching (Optional)**
   - Cache responses for 5-10 minutes
   - Invalidate on task/case updates
   - Use Redis for scalability

---

## 📚 Documentation References

| Document | Purpose |
|----------|---------|
| WORKLOAD_QUICK_START.md | 30-second setup guide |
| WORKLOAD_MONITORING_DOCS.md | Complete API documentation |
| IMPLEMENTATION_SUMMARY.md | What was implemented |
| FRONTEND_INTEGRATION_EXAMPLES.js | React component examples |
| API_QUICK_REFERENCE.md | This file |

---

## 🎓 Learning Resources

### Key Concepts
- Risk Status Calculation → Based on days remaining
- Health Status → Based on workload + overdue count
- Workload Percentage → Active cases vs. max capacity
- Performance Score → Completion rate metric

### Utility Functions
See `src/utils/workload.utils.js`:
- `calculateDaysRemaining()`
- `calculateRiskStatus()`
- `getStatusColor()`
- `calculateWorkloadPercentage()`
- `calculateAvgCompletionTime()`
- `getWorkloadHealth()`

---

**Last Updated:** January 2025  
**Version:** 1.0.0  
**Status:** Production Ready
