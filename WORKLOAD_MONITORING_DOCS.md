# Team Workload Monitoring System - Documentation

## Overview

A complete Team Workload Monitoring system built with Node.js, Express, Sequelize, and PostgreSQL. This system provides real-time insights into team capacity, case deadlines, and task management.

## ✨ Features

- **Team Workload Dashboard** - Monitor all caseworkers' metrics at a glance
- **Pending Tasks API** - Track all pending and in-progress tasks with deadline alerts
- **Deadline Monitor** - Identify cases at risk with deadline tracking
- **Individual Performance Metrics** - Get detailed performance data for each caseworker
- **Risk Status Calculation** - Automatic identification of breached, at-risk, and on-track items
- **Workload Health Scoring** - Overall team capacity assessment
- **Average Completion Time** - Track caseworker productivity

## 📁 Project Structure

```
src/
├── controllers/
│   └── AdminControllers/
│       └── workload.controller.js       # Main workload logic
├── routes/
│   └── workload.routes.js               # API endpoints
├── seeders/
│   └── workload.seeder.js               # Dummy data generation
├── utils/
│   └── workload.utils.js                # Utility functions
└── app.js                               # Updated with workload routes
```

## 🚀 Getting Started

### 1. Installation & Setup

The system is already integrated into your Express app. Simply restart your server:

```bash
npm run dev
# or
npm start
```

### 2. Seed Data

The workload seeder automatically runs when the server starts. It creates:
- **5 Caseworkers** with profiles
- **15 Cases** with varying statuses and deadlines
- **40 Tasks** with different priorities and statuses

**Test Credentials:**
```
Email: john.smith@elitepic.com
Password: caseworker123
```

## 📊 API Endpoints

### 1. **Team Workload API**
```
GET /api/workload/team-workload
```

**Response Example:**
```json
{
  "status": "success",
  "message": "Team workload retrieved successfully",
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
      },
      // ... more caseworkers
    ]
  }
}
```

**Query Parameters:** None

**Access:** Admin, Caseworker

---

### 2. **Pending Tasks API**
```
GET /api/workload/pending-tasks
```

**Response Example:**
```json
{
  "status": "success",
  "message": "Pending tasks retrieved successfully",
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
      },
      // ... more tasks
    ]
  }
}
```

**Query Parameters:** None

**Access:** Admin, Caseworker

---

### 3. **Deadline Monitor API**
```
GET /api/workload/deadline-monitor
```

**Response Example:**
```json
{
  "status": "success",
  "message": "Deadline monitor retrieved successfully",
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
      },
      // ... more cases
    ]
  }
}
```

**Query Parameters:** None

**Access:** Admin, Caseworker

---

### 4. **Caseworker Performance API**
```
GET /api/workload/caseworker/:id/performance
```

**Path Parameters:**
- `id` (required) - Caseworker user ID

**Response Example:**
```json
{
  "status": "success",
  "message": "Caseworker performance retrieved successfully",
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

**Access:** Admin, Caseworker

---

## 🛠️ Utility Functions

Located in `src/utils/workload.utils.js`:

### `calculateDaysRemaining(deadline)`
Returns the number of days between a deadline and today. Negative values indicate overdue items.

```javascript
const daysRemaining = calculateDaysRemaining("2024-01-10");
// Returns: -5 (5 days overdue)
```

### `calculateRiskStatus(daysRemaining)`
Returns risk status: "Breached", "At Risk", or "On Track"

```javascript
const status = calculateRiskStatus(-5);    // "Breached"
const status = calculateRiskStatus(10);    // "At Risk" (≤ 15 days)
const status = calculateRiskStatus(20);    // "On Track"
```

### `getStatusColor(riskStatus)`
Returns hex color code for status visualization

```javascript
const color = getStatusColor("Breached");  // "#DC3545" (Red)
const color = getStatusColor("At Risk");   // "#FFC107" (Yellow)
const color = getStatusColor("On Track");  // "#28A745" (Green)
```

### `calculateWorkloadPercentage(activeCases, maxCapacity)`
Calculates workload percentage. Default max capacity is 50 cases.

```javascript
const percentage = calculateWorkloadPercentage(35, 50);
// Returns: 70
```

### `calculateAvgCompletionTime(tasks)`
Calculates average days to complete tasks

```javascript
const avgDays = calculateAvgCompletionTime(completedTasks);
// Returns: 3.5 (average days)
```

### `getWorkloadHealth(workloadPercentage, overdueCount)`
Returns comprehensive health status

```javascript
const health = getWorkloadHealth(75, 2);
// Returns: {
//   status: "Critical",
//   color: "#DC3545",
//   message: "2 overdue case(s) require immediate attention"
// }
```

## 📋 Risk Status Rules

- **"Breached"** - `daysRemaining < 0` (Red #DC3545)
- **"At Risk"** - `0 ≤ daysRemaining ≤ 15` (Yellow #FFC107)
- **"On Track"** - `daysRemaining > 15` (Green #28A745)

## 🗄️ Database Associations

```
User (Caseworker)
  ├── hasMany Cases (via assignedcaseworkerId)
  └── hasMany Tasks (via assigned_to)

Case
  ├── belongsTo User (candidate)
  ├── belongsTo User (sponsor)
  └── hasMany Tasks

Task
  ├── belongsTo User (assignee)
  ├── belongsTo User (creator)
  └── belongsTo Case
```

## 🔐 Authentication & Authorization

All workload endpoints require:
1. **Valid JWT Token** - Passed in Authorization header
2. **User Role** - Must be Admin (1) or Caseworker (2)

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:5000/api/workload/team-workload
```

## 📈 Performance Metrics Explained

### Workload Percentage
- Calculated as: `(active_cases / max_capacity) * 100`
- Default max capacity: 50 cases per caseworker
- Range: 0-100%

### Health Status Levels
- **Healthy** - No overdue cases, <60% workload
- **Medium** - No overdue cases, 60-80% workload
- **High** - No overdue cases, ≥80% workload
- **Critical** - 1+ overdue cases

### Performance Score
- Calculated as: `(completed_cases + completed_tasks) / total_items * 100`
- Range: 0-100%
- Represents completion rate

## 🧪 Testing

### Using cURL

```bash
# Get team workload
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/team-workload

# Get pending tasks
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/pending-tasks

# Get deadline monitor
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/deadline-monitor

# Get caseworker performance
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:5000/api/workload/caseworker/1/performance
```

### Using Postman

1. Create a new Collection: "Team Workload Monitoring"
2. Set Authorization: Bearer Token
3. Add requests for each endpoint
4. Test with the seeded data

## 📊 Data Models

### Seeded Data Overview

**Caseworkers (5 total):**
- John Smith (Senior, New York)
- Sarah Johnson (Caseworker, California)
- Michael Chen (Caseworker, Texas)
- Emma Wilson (Junior, Florida)
- David Patel (Caseworker, Illinois)

**Cases (15 total):**
- Mixed statuses (Lead, Pending, In Progress, Completed, On Hold)
- Priorities: Low, Medium, High, Urgent
- Various nationalities and job titles
- Deadlines ranging from past to future

**Tasks (40 total):**
- Statuses: Pending, In-Progress, Completed
- Priorities: Low, Medium, High
- Due dates distributed across 30 days
- Associated with cases and caseworkers

## 🐛 Error Handling

All endpoints return consistent error format:

```json
{
  "status": "error",
  "message": "Error description",
  "data": null,
  "error": "Detailed error message"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Server Error

## 🔄 Seeding Process

Automatic seeding happens on server startup:
1. Seeds roles (if not exists)
2. Seeds admin user (if not exists)
3. **Seeds workload data (caseworkers, cases, tasks)**
4. Initializes field settings

To manually trigger re-seeding, restart the server.

## 📝 File Reference

| File | Purpose |
|------|---------|
| `src/controllers/AdminControllers/workload.controller.js` | API logic (4 controllers) |
| `src/routes/workload.routes.js` | Route definitions |
| `src/seeders/workload.seeder.js` | Dummy data generation |
| `src/utils/workload.utils.js` | Utility calculations |
| `src/app.js` | Express app (updated) |
| `src/server.js` | Server initialization (updated) |

## 🚧 Future Enhancements

Consider adding:
- Filters by date range, caseworker, department
- Pagination for large datasets
- Export to CSV/PDF
- Real-time notifications for breached deadlines
- Predictive analytics for workload forecasting
- Advanced reporting and analytics
- Workload balancing suggestions

## 📞 Support

For issues or questions:
1. Check API response format in documentation
2. Verify JWT token validity
3. Check user role permissions
4. Review seeded data in database
5. Check server logs for detailed errors

---

**Version:** 1.0.0  
**Last Updated:** January 2025  
**Status:** Production Ready
