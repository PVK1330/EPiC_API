import db from "../../models/index.js";
import { Op } from "sequelize";

const Case = db.Case;
const Document = db.Document;
const CasePayment = db.CasePayment;
const CaseTimeline = db.CaseTimeline;
const CaseCommunication = db.CaseCommunication;
const CaseNote = db.CaseNote;
const User = db.User;
const VisaType = db.VisaType;
const PetitionType = db.PetitionType;

// Reusable function to get full case data with all relationships
const fetchFullCaseData = async (id) => {
  const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
  return await Case.findOne({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'candidate',
        attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
        required: false
      },
      {
        model: User,
        as: 'sponsor',
        attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
        required: false
      },
      {
        model: db.VisaType,
        as: 'visaType',
        attributes: ['id', 'name'],
        required: false
      },
      {
        model: db.Department,
        as: 'department',
        attributes: ['id', 'name'],
        required: false
      },
      {
        model: Document,
        as: 'documents',
        include: [{ model: User, as: 'uploader', attributes: ['first_name', 'last_name'] }],
        required: false
      },
      {
        model: CasePayment,
        as: 'payments',
        include: [{ model: User, as: 'receiver', attributes: ['first_name', 'last_name'] }],
        required: false
      },
      {
        model: CaseTimeline,
        as: 'timeline',
        include: [{ model: User, as: 'performer', attributes: ['first_name', 'last_name'] }],
        required: false
      },
      {
        model: CaseCommunication,
        as: 'communications',
        include: [
          { model: User, as: 'sender', attributes: ['first_name', 'last_name'] },
          { model: User, as: 'recipient', attributes: ['first_name', 'last_name'] }
        ],
        required: false
      },
      {
        model: CaseNote,
        as: 'caseNotes',
        include: [{ model: User, as: 'author', attributes: ['first_name', 'last_name'] }],
        required: false
      },
      {
        model: db.Task,
        as: 'tasks',
        include: [{ model: User, as: 'assignee', attributes: ['first_name', 'last_name'] }],
        required: false
      }
    ]
  });
};

// Get comprehensive case details for single case page
export const getCaseDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId e.g. CAS-000001)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };

    // Get main case details with all relationships
    const caseData = await Case.findOne({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'candidate',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false
        },
        {
          model: User,
          as: 'sponsor',
          attributes: ['id', 'first_name', 'last_name', 'email', 'mobile'],
          required: false
        },
        {
          model: db.VisaType,
          as: 'visaType',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: db.PetitionType,
          as: 'petitionType',
          attributes: ['id', 'name'],
          required: false
        },
        {
          model: Document,
          as: 'documents',
          include: [
            {
              model: User,
              as: 'uploader',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            },
            {
              model: User,
              as: 'reviewer',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        },
        {
          model: CasePayment,
          as: 'payments',
          include: [
            {
              model: User,
              as: 'receiver',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['paymentDate', 'DESC']],
          required: false
        },
        {
          model: CaseTimeline,
          as: 'timeline',
          include: [
            {
              model: User,
              as: 'performer',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['actionDate', 'DESC']],
          required: false
        },
        {
          model: CaseCommunication,
          as: 'communications',
          include: [
            {
              model: User,
              as: 'sender',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            },
            {
              model: User,
              as: 'recipient',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        },
        {
          model: CaseNote,
          as: 'caseNotes',
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'first_name', 'last_name'],
              required: false
            }
          ],
          order: [['created_at', 'DESC']],
          required: false
        }
      ]
    });

    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Calculate payment summary
    const totalFee = caseData.totalAmount;
    const totalPaid = caseData.payments.reduce((sum, payment) => {
      return payment.paymentStatus === 'completed' ? sum + parseFloat(payment.amount) : sum;
    }, 0);
    const outstandingBalance = totalFee - totalPaid;

    // Calculate document summary
    const documentSummary = {
      total: caseData.documents.length,
      missing: caseData.documents.filter(doc => doc.status === 'missing').length,
      uploaded: caseData.documents.filter(doc => doc.status === 'uploaded').length,
      underReview: caseData.documents.filter(doc => doc.status === 'under_review').length,
      approved: caseData.documents.filter(doc => doc.status === 'approved').length,
      rejected: caseData.documents.filter(doc => doc.status === 'rejected').length
    };

    // Get assigned caseworkers details
    const caseworkerIds = caseData.assignedcaseworkerId || [];
    const caseworkers = await User.findAll({
      where: { id: caseworkerIds },
      attributes: ['id', 'first_name', 'last_name', 'email']
    });

    // Structure the response for frontend tabs
    const response = {
      status: "success",
      message: "Case details retrieved successfully",
      data: {
        // DB primary key (for APIs that require numeric case_id, e.g. task create)
        internalId: caseData.id,

        // Overview Tab
        overview: {
          caseId: caseData.caseId,
          status: caseData.status,
          priority: caseData.priority,
          caseStage: caseData.caseStage,
          applicationType: caseData.applicationType,
          targetSubmissionDate: caseData.targetSubmissionDate,
          biometricsDate: caseData.biometricsDate,
          submissionDate: caseData.submissionDate,
          decisionDate: caseData.decisionDate,
          created_at: caseData.created_at,
          updated_at: caseData.updated_at
        },
        
        // Candidate Information
        candidate: caseData.candidate,
        
        // Business Information
        business: {
          businessId: caseData.businessId,
          sponsor: caseData.sponsor
        },
        
        // Visa and Petition Types
        visaType: caseData.visaType,
        // petitionType: caseData.petitionType,
        
        // Assigned Caseworkers
        caseworkers: caseworkers,
        
        // Key Dates
        keyDates: {
          submitted: caseData.submitted,
          targetSubmissionDate: caseData.targetSubmissionDate,
          biometricsDate: caseData.biometricsDate,
          submissionDate: caseData.submissionDate,
          decisionDate: caseData.decisionDate
        },
        
        // Financial Information
        financial: {
          totalFee: totalFee,
          totalPaid: totalPaid,
          outstandingBalance: outstandingBalance,
          salaryOffered: caseData.salaryOffered,
          payments: caseData.payments
        },
        
        // Documents Tab
        documents: {
          summary: documentSummary,
          list: caseData.documents
        },
        
        // Timeline Tab
        timeline: caseData.timeline,
        
        // Communication Tab
        communications: caseData.communications,
        
        // Notes Tab
        notes: caseData.caseNotes.filter(note => !note.isArchived),
        
        // Additional case details
        additional: {
          lcaNumber: caseData.lcaNumber,
          receiptNumber: caseData.receiptNumber,
          jobTitle: caseData.jobTitle,
          department: caseData.department,
          notes: caseData.notes
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Get Case Details Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Update case status and stage (for Overview tab actions)
export const updateCaseStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, caseStage, priority, assignedcaseworkerId, biometricsDate, submissionDate, decisionDate } = req.body;
    
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "Case ID is required",
        data: null,
      });
    }

    // Support both numeric PK (id) and human-readable case reference (caseId e.g. CAS-000001)
    const whereClause = isNaN(id) ? { caseId: id } : { id: parseInt(id) };
    const caseData = await Case.findOne({ where: whereClause });
    if (!caseData) {
      return res.status(404).json({
        status: "error",
        message: "Case not found",
        data: null,
      });
    }

    // Update case with new values
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (caseStage !== undefined) updateData.caseStage = caseStage;
    if (priority !== undefined) updateData.priority = priority;
    if (assignedcaseworkerId !== undefined) {
      const cwIds = Array.isArray(assignedcaseworkerId) ? assignedcaseworkerId : (assignedcaseworkerId ? [assignedcaseworkerId] : []);
      updateData.assignedcaseworkerId = cwIds;
    }
    if (biometricsDate !== undefined) updateData.biometricsDate = biometricsDate;
    if (submissionDate !== undefined) updateData.submissionDate = submissionDate;
    if (decisionDate !== undefined) updateData.decisionDate = decisionDate;

    await caseData.update(updateData);

    // Add timeline entry
    await CaseTimeline.create({
      caseId: caseData.id,
      actionType: 'status_changed',
      description: `Case status/stage updated`,
      performedBy: req.user?.id,
      previousValue: JSON.stringify({
        status: caseData.status,
        caseStage: caseData.caseStage,
        priority: caseData.priority
      }),
      newValue: JSON.stringify({
        status: status || caseData.status,
        caseStage: caseStage || caseData.caseStage,
        priority: priority || caseData.priority
      })
    });

    res.status(200).json({
      status: "success",
      message: "Case status updated successfully",
      data: { case: caseData }
    });
  } catch (error) {
    console.error("Update Case Status Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      data: null,
      error: error.message,
    });
  }
};

// Export Case Details to CSV
export const exportCaseCSV = async (req, res) => {
  try {
    const { id } = req.params;
    const caseData = await fetchFullCaseData(id);

    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    let csv = "\uFEFF"; // BOM for Excel
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;

    // Section 1: Overview
    csv += "SECTION,FIELD,VALUE\n";
    csv += `INFO,Case ID,${esc(caseData.caseId)}\n`;
    csv += `INFO,Status,${esc(caseData.status)}\n`;
    csv += `INFO,Candidate,${esc(caseData.candidate?.first_name + " " + caseData.candidate?.last_name)}\n`;
    csv += `INFO,Sponsor,${esc(caseData.sponsor?.first_name + " " + caseData.sponsor?.last_name)}\n`;
    csv += `INFO,Department,${esc(caseData.department?.name)}\n`;
    csv += `INFO,Visa Type,${esc(caseData.visaType?.name)}\n`;
    csv += `INFO,Job Title,${esc(caseData.jobTitle)}\n`;
    csv += `INFO,Target Date,${esc(caseData.targetSubmissionDate)}\n\n`;

    // Section 2: Tasks
    csv += "SECTION,TASK NAME,PRIORITY,STATUS,ASSIGNED TO,DUE DATE\n";
    (caseData.tasks || []).forEach(t => {
      csv += `TASK,${esc(t.title)},${esc(t.priority)},${esc(t.status)},${esc(t.assignee?.first_name)},${esc(t.due_date)}\n`;
    });
    csv += "\n";

    // Section 3: Financials
    csv += "SECTION,DATE,AMOUNT,METHOD,STATUS,INVOICE,RECORDED BY\n";
    (caseData.payments || []).forEach(p => {
      csv += `PAYMENT,${esc(p.paymentDate)},${esc(p.amount)},${esc(p.paymentMethod)},${esc(p.paymentStatus)},${esc(p.invoiceNumber)},${esc(p.receiver?.first_name)}\n`;
    });
    csv += "\n";

    // Section 4: Documents
    csv += "SECTION,DOC NAME,STATUS,UPLOADED AT,UPLOADED BY\n";
    (caseData.documents || []).forEach(d => {
      csv += `DOCUMENT,${esc(d.documentName)},${esc(d.status)},${esc(d.uploadedAt)},${esc(d.uploader?.first_name)}\n`;
    });
    csv += "\n";

    // Section 5: Communication
    csv += "SECTION,SENDER,RECIPIENT,SUBJECT,DATE\n";
    (caseData.communications || []).forEach(c => {
      csv += `COMM,${esc(c.sender?.first_name)},${esc(c.recipient?.first_name || c.recipientEmail)},${esc(c.subject)},${esc(c.created_at)}\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Case_Full_Report_${caseData.caseId}.csv`);
    return res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

import PdfPrinter from 'pdfmake';

export const exportCasePDF = async (req, res) => {
  try {
    const { id } = req.params;
    const caseData = await fetchFullCaseData(id);
    if (!caseData) return res.status(404).json({ status: "error", message: "Case not found" });

    const fonts = {
      Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
      }
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      pageMargins: [40, 40, 40, 40],
      content: [
        { text: `OFFICIAL CASE REPORT: ${caseData.caseId}`, style: 'header' },
        { 
          columns: [
            { text: `Candidate: ${caseData.candidate?.first_name} ${caseData.candidate?.last_name}`, bold: true },
            { text: `Export Date: ${new Date().toLocaleDateString()}`, alignment: 'right' }
          ]
        },
        { text: `Status: ${caseData.status} | Visa: ${caseData.visaType?.name || 'N/A'}`, margin: [0, 5, 0, 20] },
        
        { text: '1. Employment & Sponsorship', style: 'sectionHeader' },
        {
          table: {
            widths: ['30%', '70%'],
            body: [
              ['Sponsor Entity', caseData.sponsor?.first_name || 'N/A'],
              ['Department', caseData.department?.name || 'N/A'],
              ['Job Title', caseData.jobTitle || 'N/A'],
              ['Salary Offered', caseData.salaryOffered || 'N/A'],
              ['Target Submission', caseData.targetSubmissionDate || 'N/A']
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '2. Tasks & Action Items', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto'],
            body: [
              [{text: 'Task', style: 'tableHeader'}, {text: 'Priority', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}, {text: 'Due', style: 'tableHeader'}],
              ...(caseData.tasks || []).map(t => [t.title, t.priority, t.status, t.due_date || 'N/A'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '3. Financial Summary', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
              [{text: 'Date', style: 'tableHeader'}, {text: 'Ref / Invoice', style: 'tableHeader'}, {text: 'Amount', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}],
              ...(caseData.payments || []).map(p => [p.paymentDate || 'N/A', p.invoiceNumber || 'N/A', p.amount, p.paymentStatus])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '4. Documentation Status', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto'],
            body: [
              [{text: 'Document Name', style: 'tableHeader'}, {text: 'Status', style: 'tableHeader'}, {text: 'Upload Date', style: 'tableHeader'}],
              ...(caseData.documents || []).map(d => [d.documentName, d.status, d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : 'N/A'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '5. Recent Activity Log', style: 'sectionHeader' },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto'],
            body: [
              [{text: 'Date', style: 'tableHeader'}, {text: 'Action', style: 'tableHeader'}, {text: 'User', style: 'tableHeader'}],
              ...(caseData.timeline || []).slice(0, 20).map(tl => [new Date(tl.actionDate).toLocaleDateString(), tl.description, tl.performer?.first_name || 'System'])
            ]
          },
          margin: [0, 0, 0, 15]
        },

        { text: '6. Internal Case Notes', style: 'sectionHeader' },
        ...(caseData.caseNotes || []).map(n => ({
          text: `[${new Date(n.created_at).toLocaleDateString()}] ${n.author?.first_name}: ${n.content}`,
          margin: [0, 2, 0, 2],
          fontSize: 9
        }))
      ],
      styles: {
        header: { fontSize: 24, bold: true, color: '#2563eb', margin: [0, 0, 0, 10] },
        sectionHeader: { fontSize: 14, bold: true, color: '#1e293b', margin: [0, 10, 0, 8], decoration: 'underline' },
        tableHeader: { bold: true, fontSize: 10, color: '#475569', fillColor: '#f8fafc' }
      },
      defaultStyle: { fontSize: 10 }
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Official_Case_Report_${caseData.caseId}.pdf`);
    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) {
    console.error("PDF Export Error:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
};
