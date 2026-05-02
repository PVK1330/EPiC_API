import db from "../models/index.js";
import bcrypt from "bcryptjs";

/**
 * Seed comprehensive data for Admin Reports
 * Creates:
 * - VisaTypes
 * - Users (Caseworkers, Sponsors, Candidates)
 * - Cases with visa types and assigned caseworkers
 * - CasePayments with completed status for revenue reports
 */
export default async function seedAdminReportsData() {
  try {
    const User = db.User;
    const VisaType = db.VisaType;
    const Case = db.Case;
    const CasePayment = db.CasePayment;

    // ─────────────────────────────────────────────────────────────
    // 1. CREATE VISA TYPES
    // ─────────────────────────────────────────────────────────────
    const visaTypes = await VisaType.findAll({ raw: true });
    
    if (visaTypes.length === 0) {
      await VisaType.bulkCreate([
        { name: "H-1B", sort_order: 1 },
        { name: "L-1", sort_order: 2 },
        { name: "EB-3", sort_order: 3 },
        { name: "O-1", sort_order: 4 },
        { name: "E-2", sort_order: 5 },
        { name: "EB-2", sort_order: 6 },
      ]);
    }

    // ─────────────────────────────────────────────────────────────
    // 2. CREATE CASEWORKERS (Users with role_id = 2)
    // ─────────────────────────────────────────────────────────────
    const hashPassword = async (password) => bcrypt.hash(password, 12);

    const caseworkerEmails = [
      "john.smith@elitepic.com",
      "sarah.johnson@elitepic.com",
      "michael.chen@elitepic.com",
      "emma.wilson@elitepic.com",
      "david.patel@elitepic.com",
    ];

    const caseworkerNames = [
      { first: "John", last: "Smith" },
      { first: "Sarah", last: "Johnson" },
      { first: "Michael", last: "Chen" },
      { first: "Emma", last: "Wilson" },
      { first: "David", last: "Patel" },
    ];

    const caseworkers = [];
    for (let i = 0; i < caseworkerEmails.length; i++) {
      const existingUser = await User.findOne({
        where: { email: caseworkerEmails[i] },
        raw: true,
      });

      if (!existingUser) {
        const newUser = await User.create({
          first_name: caseworkerNames[i].first,
          last_name: caseworkerNames[i].last,
          email: caseworkerEmails[i],
          country_code: "+1",
          mobile: `555-010${i}`,
          password: await hashPassword("TestPassword123!"),
          role_id: 2, // Caseworker role (changed from 3 to 2)
          is_email_verified: true,
          status: "active",
        });
        caseworkers.push(newUser.toJSON());
      } else {
        caseworkers.push(existingUser);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. CREATE SPONSORS (Users with role_id = 4)
    // ─────────────────────────────────────────────────────────────
    const sponsorEmails = [
      "sponsor1@company.com",
      "sponsor2@company.com",
      "sponsor3@company.com",
    ];

    const sponsorNames = [
      { first: "Acme", last: "Corporation" },
      { first: "Tech", last: "Industries" },
      { first: "Global", last: "Solutions" },
    ];

    const sponsors = [];
    for (let i = 0; i < sponsorEmails.length; i++) {
      const existingUser = await User.findOne({
        where: { email: sponsorEmails[i] },
        raw: true,
      });

      if (!existingUser) {
        const newUser = await User.create({
          first_name: sponsorNames[i].first,
          last_name: sponsorNames[i].last,
          email: sponsorEmails[i],
          country_code: "+1",
          mobile: `555-020${i}`,
          password: await hashPassword("SponsorPass123!"),
          role_id: 4, // Business/Sponsor role
          is_email_verified: true,
          status: "active",
        });
        sponsors.push(newUser.toJSON());
      } else {
        sponsors.push(existingUser);
      }
    }
    // ─────────────────────────────────────────────────────────────
    // 4. CREATE CANDIDATES (Users with role_id = 3)
    // ─────────────────────────────────────────────────────────────
    const candidateEmails = [
      "candidate1@email.com",
      "candidate2@email.com",
      "candidate3@email.com",
      "candidate4@email.com",
      "candidate5@email.com",
      "candidate6@email.com",
      "candidate7@email.com",
      "candidate8@email.com",
    ];

    const candidateNames = [
      { first: "Alex", last: "Kumar" },
      { first: "Maria", last: "Garcia" },
      { first: "Liu", last: "Wei" },
      { first: "Priya", last: "Sharma" },
      { first: "Omar", last: "Hassan" },
      { first: "Sofia", last: "Rodriguez" },
      { first: "James", last: "O'Brien" },
      { first: "Yuki", last: "Tanaka" },
    ];

    const candidates = [];
    for (let i = 0; i < candidateEmails.length; i++) {
      const existingUser = await User.findOne({
        where: { email: candidateEmails[i] },
        raw: true,
      });

      if (!existingUser) {
        const newUser = await User.create({
          first_name: candidateNames[i].first,
          last_name: candidateNames[i].last,
          email: candidateEmails[i],
          country_code: "+1",
          mobile: `555-030${i}`,
          password: await hashPassword("CandidatePass123!"),
          role_id: 3, // Candidate role (changed from 5 to 3)
          is_email_verified: true,
          status: "active",
        });
        candidates.push(newUser.toJSON());
      } else {
        candidates.push(existingUser);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. FETCH ALL VISA TYPES
    // ─────────────────────────────────────────────────────────────
    const allVisaTypes = await VisaType.findAll({ raw: true });

    // ─────────────────────────────────────────────────────────────
    // 6. CREATE CASES WITH ASSIGNED CASEWORKERS
    // ─────────────────────────────────────────────────────────────
    // console.log("\n📝 Creating Cases...");
    
    const casesData = [];
    const caseStatuses = ["Pending", "In Progress", "Completed", "On Hold"];
    
    for (let i = 0; i < 25; i++) {
      const candidateId = candidates[i % candidates.length].id;
      const sponsorId = sponsors[i % sponsors.length].id;
      const visaTypeId = allVisaTypes[i % allVisaTypes.length].id;
      
      // Assign 1-3 caseworkers to each case
      const numCaseworkers = Math.floor(Math.random() * 3) + 1;
      const assignedCaseworkers = [];
      for (let j = 0; j < numCaseworkers; j++) {
        const randomCaseworker = caseworkers[Math.floor(Math.random() * caseworkers.length)];
        if (!assignedCaseworkers.includes(randomCaseworker.id)) {
          assignedCaseworkers.push(randomCaseworker.id);
        }
      }
      
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + Math.floor(Math.random() * 90) + 30);
      
      const createdDate = new Date();
      createdDate.setDate(createdDate.getDate() - Math.floor(Math.random() * 30) - 1);

      casesData.push({
        caseId: `CAS-${String(1001 + i).padStart(6, "0")}`,
        candidateId,
        sponsorId,
        visaTypeId,
        priority: ["low", "medium", "high", "urgent"][Math.floor(Math.random() * 4)],
        status: caseStatuses[Math.floor(Math.random() * caseStatuses.length)],
        submitted: createdDate,
        targetSubmissionDate: targetDate,
        lcaNumber: `LCA-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
        receiptNumber: `RCP-${Math.random().toString(36).substring(2, 11).toUpperCase()}`,
        nationality: ["Indian", "Chinese", "Mexican", "Filipino", "Vietnamese"][
          Math.floor(Math.random() * 5)
        ],
        jobTitle: ["Software Engineer", "Data Scientist", "Project Manager", "UX Designer", "DevOps Engineer"][
          Math.floor(Math.random() * 5)
        ],
        department: ["Engineering", "Product", "Operations", "Sales", "Marketing"][
          Math.floor(Math.random() * 5)
        ],
        jobSalary: 100000 + Math.floor(Math.random() * 200000),
        caseNotes: "Sample case for admin reports testing",
        assignedcaseworkerId: JSON.stringify(assignedCaseworkers),
        createdAt: createdDate,
      });
    }

    // Check if cases already exist
    const existingCasesCount = await Case.count();
    if (existingCasesCount === 0) {
      await Case.bulkCreate(casesData);
    }

    // ─────────────────────────────────────────────────────────────
    // 7. CREATE CASE PAYMENTS FOR REVENUE REPORTS
    // ─────────────────────────────────────────────────────────────
    
    const allCases = await Case.findAll({ raw: true });
    const paymentData = [];
    
    // Create 40-50 completed payments
    for (let i = 0; i < 45; i++) {
      const randomCase = allCases[Math.floor(Math.random() * allCases.length)];
      const paymentDate = new Date();
      paymentDate.setDate(paymentDate.getDate() - Math.floor(Math.random() * 60));
      
      const amount = (1000 + Math.floor(Math.random() * 9000)).toFixed(2);

      paymentData.push({
        caseId: randomCase.id,
        paymentType: ["fee", "installment", "additional_charge"][Math.floor(Math.random() * 3)],
        amount,
        paymentMethod: ["bank_transfer", "credit_card", "check", "online"][
          Math.floor(Math.random() * 4)
        ],
        paymentDate: paymentDate.toISOString().split("T")[0],
        paymentStatus: "completed", // IMPORTANT: Only completed payments for revenue reports
        transactionId: `TXN-${Math.random().toString(36).substring(2, 15).toUpperCase()}`,
        invoiceNumber: `INV-${String(5000 + i).padStart(6, "0")}`,
      });
    }

    const existingPaymentsCount = await CasePayment.count({
      where: { paymentStatus: "completed" },
    });
    
    if (existingPaymentsCount === 0) {
      await CasePayment.bulkCreate(paymentData);
      
    }
  } catch (error) {
    console.error("❌ Error in seedAdminReportsData:", error);
    throw error;
  }
}
