import db from "../models/index.js";
import bcrypt from "bcryptjs";

/**
 * Seed dummy data for Team Workload Monitoring
 * Creates:
 * - Caseworkers (User + CaseworkerProfile)
 * - Cases assigned to caseworkers
 * - Tasks assigned to caseworkers with various statuses and deadlines
 */
export default async function seedWorkloadData() {
  try {
    console.log("Starting workload data seeder...");

    // Helper function to hash passwords
    const hashPassword = async (password) => bcrypt.hash(password, 12);

    // 1. CREATE CASEWORKERS
    console.log("\n📌 Creating Caseworkers...");
    const caseworkers = [];
    const caseworkerEmails = [
      "john.smith@elitepic.com",
      "sarah.johnson@elitepic.com",
      "michael.chen@elitepic.com",
      "emma.wilson@elitepic.com",
      "david.patel@elitepic.com",
    ];

    const caseworkerData = [
      {
        name: "John Smith",
        department: "Immigration Services",
        region: "New York",
        job_title: "Senior Caseworker",
      },
      {
        name: "Sarah Johnson",
        department: "Immigration Services",
        region: "California",
        job_title: "Caseworker",
      },
      {
        name: "Michael Chen",
        department: "Visa Processing",
        region: "Texas",
        job_title: "Caseworker",
      },
      {
        name: "Emma Wilson",
        department: "Immigration Services",
        region: "Florida",
        job_title: "Junior Caseworker",
      },
      {
        name: "David Patel",
        department: "Visa Processing",
        region: "Illinois",
        job_title: "Caseworker",
      },
    ];

    for (let i = 0; i < caseworkerEmails.length; i++) {
      const [user, userCreated] = await db.User.findOrCreate({
        where: { email: caseworkerEmails[i] },
        defaults: {
          first_name: caseworkerData[i].name.split(" ")[0],
          last_name: caseworkerData[i].name.split(" ")[1],
          email: caseworkerEmails[i],
          country_code: "+1",
          mobile: `555-${1000 + i * 100}`,
          password: await hashPassword("caseworker123"),
          role_id: 2, // CASEWORKER role
          is_otp_verified: true,
          is_email_verified: true,
          status: "active",
        },
      });

      if (userCreated) {
        console.log(`✔ Caseworker created: ${caseworkerData[i].name}`);

        // Create caseworker profile
        await db.CaseworkerProfile.findOrCreate({
          where: { user_id: user.id },
          defaults: {
            user_id: user.id,
            employee_id: `EMP-${1001 + i}`,
            job_title: caseworkerData[i].job_title,
            department: caseworkerData[i].department,
            region: caseworkerData[i].region,
            timezone: "America/New_York",
            date_of_joining: new Date(2022, 0, 15),
            emergency_contact_name: `Emergency Contact ${i + 1}`,
            emergency_contact_phone: `555-999-${1000 + i}`,
          },
        });
      }

      caseworkers.push(user);
    }

    // 2. CREATE CASES
    console.log("\n📌 Creating Cases...");
    const cases = [];
    const caseStatuses = ["Lead", "Pending", "In Progress", "Completed", "On Hold"];
    const visaPriorities = ["low", "medium", "high", "urgent"];

    // Get today's date
    const today = new Date();

    // Create multiple cases for each caseworker
    for (let i = 0; i < 15; i++) {
      const assignedCaseworker = caseworkers[i % caseworkers.length];

      // Vary target submission dates
      const daysFromToday = -30 + (i * 5); // Some past, some future
      const targetSubmissionDate = new Date(today);
      targetSubmissionDate.setDate(targetSubmissionDate.getDate() + daysFromToday);

      const [caseRecord, caseCreated] = await db.Case.findOrCreate({
        where: { caseId: `CAS-${String(10001 + i).padStart(6, "0")}` },
        defaults: {
          caseId: `CAS-${String(10001 + i).padStart(6, "0")}`,
          candidateId: assignedCaseworker.id,
          priority: visaPriorities[i % 4],
          status: caseStatuses[i % 5],
          targetSubmissionDate: targetSubmissionDate,
          submitted: i % 2 === 0 ? new Date(2024, 0, 15) : null,
          nationality: ["Indian", "Chinese", "Mexican", "Filipino", "Canadian"][i % 5],
          jobTitle: [
            "Software Engineer",
            "Data Scientist",
            "Product Manager",
            "Design Manager",
            "DevOps Engineer",
          ][i % 5],
          department: [
            "Engineering",
            "Product",
            "Data",
            "Design",
            "Infrastructure",
          ][i % 5],
          assignedcaseworkerId: JSON.stringify([assignedCaseworker.id]),
          salaryOffered: 80000 + i * 5000,
          totalAmount: 50000,
          paidAmount: i % 2 === 0 ? 50000 : 25000,
        },
      });

      if (caseCreated) {
        console.log(
          `✔ Case created: ${caseRecord.caseId} (${caseRecord.status})`
        );
      }

      cases.push(caseRecord);
    }

    // 3. CREATE TASKS
    console.log("\n📌 Creating Tasks...");
    const taskStatuses = ["pending", "in-progress", "completed"];
    const taskPriorities = ["low", "medium", "high"];
    const taskTitles = [
      "Review visa documentation",
      "Schedule interview with candidate",
      "Process LCA submission",
      "Update case status",
      "Prepare petition forms",
      "Conduct background check",
      "Submit USCIS application",
      "Follow up with sponsor",
      "Organize case file",
      "Send status notification",
      "Verify employment details",
      "Obtain medical examination",
    ];

    for (let i = 0; i < 40; i++) {
      const assignedCaseworker = caseworkers[i % caseworkers.length];
      const caseRecord = cases[i % cases.length];

      // Vary due dates
      const daysUntilDue = -10 + (i % 30); // Some overdue, some future
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + daysUntilDue);

      const taskStatus = taskStatuses[Math.floor(i / 15) % 3];
      const createdDate = new Date(today);
      createdDate.setDate(
        createdDate.getDate() - (5 + (i % 20))
      );

      // If completed, set updatedAt to simulate completion
      const updatedDate =
        taskStatus === "completed"
          ? new Date(createdDate.getTime() + Math.random() * 10 * 24 * 60 * 60 * 1000)
          : createdDate;

      const [task, taskCreated] = await db.Task.findOrCreate({
        where: {
          title: `${taskTitles[i % taskTitles.length]} - Case ${caseRecord.caseId}`,
          assigned_to: assignedCaseworker.id,
          case_id: caseRecord.id,
        },
        defaults: {
          title: `${taskTitles[i % taskTitles.length]} - Case ${caseRecord.caseId}`,
          assigned_to: assignedCaseworker.id,
          case_id: caseRecord.id,
          priority: taskPriorities[i % 3],
          status: taskStatus,
          due_date: dueDate,
          created_by: caseworkers[0].id, // Admin user creating tasks
          created_at: createdDate,
          updated_at: updatedDate,
        },
      });

      if (taskCreated) {
        console.log(
          `✔ Task created: "${task.title}" - Status: ${task.status}`
        );
      }
    }

    console.log("\n✅ Workload seeder completed successfully!");
    console.log("\n📊 Summary:");
    console.log(`   - Caseworkers created: ${caseworkers.length}`);
    console.log(`   - Cases created: ${cases.length}`);
    console.log(`   - Tasks created: ~40`);
    console.log("\n🔑 Test credentials:");
    console.log("   Email: john.smith@elitepic.com");
    console.log("   Password: caseworker123");
  } catch (err) {
    console.error("❌ Workload seeder failed:", err.message);
    console.error(err);
  }
}
