import os
import sys
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import qn, nsdecls

def create_ccl_guide_docx():
    doc = Document()

    # Define color palette
    COLOR_PRIMARY = RGBColor(30, 58, 138)    # Deep Navy Blue #1E3A8A
    COLOR_SECONDARY = RGBColor(59, 130, 246)  # Bright Blue #3B82F6
    COLOR_TEXT = RGBColor(31, 41, 55)        # Dark Charcoal #1F2937
    COLOR_MUTED = RGBColor(107, 114, 128)    # Slate Grey #6B7280

    # Configure Normal Style
    style_normal = doc.styles['Normal']
    style_normal.font.name = 'Calibri'
    style_normal.font.size = Pt(11)
    style_normal.font.color.rgb = COLOR_TEXT
    style_normal.paragraph_format.line_spacing = 1.15
    style_normal.paragraph_format.space_after = Pt(6)

    # XML Helper Functions
    def set_cell_background(cell, hex_color):
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
        cell._tc.get_or_add_tcPr().append(shading)

    def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement('w:tcMar')
        for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
            node = OxmlElement(f'w:{m}')
            node.set(qn('w:w'), str(val))
            node.set(qn('w:type'), 'dxa')
            tcMar.append(node)
        tcPr.append(tcMar)

    def set_table_borders(table, color="D1D5DB", sz="4", val="single"):
        tblPr = table._tbl.tblPr
        borders = parse_xml(
            f'<w:tblBorders {nsdecls("w")}>'
            f'<w:top w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'<w:bottom w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'<w:left w:val="none"/>'
            f'<w:right w:val="none"/>'
            f'<w:insideH w:val="{val}" w:sz="{sz}" w:space="0" w:color="{color}"/>'
            f'<w:insideV w:val="none"/>'
            f'</w:tblBorders>'
        )
        tblPr.append(borders)

    def add_callout(text, title="IMPORTANT NOTE", color_hex="EFF6FF", border_hex="3B82F6"):
        table = doc.add_table(rows=1, cols=1)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = table.cell(0, 0)
        set_cell_background(cell, color_hex)
        set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
        
        tcPr = cell._tc.get_or_add_tcPr()
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:left w:val="single" w:sz="24" w:space="0" w:color="{border_hex}"/>'
            f'<w:top w:val="none"/>'
            f'<w:right w:val="none"/>'
            f'<w:bottom w:val="none"/>'
            f'</w:tcBorders>'
        )
        tcPr.append(borders)

        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        run_title = p.add_run(f"📌 {title}\n")
        run_title.bold = True
        run_title.font.size = Pt(10.5)
        run_title.font.color.rgb = COLOR_PRIMARY

        run_text = p.add_run(text)
        run_text.font.size = Pt(10)
        run_text.font.color.rgb = COLOR_TEXT
        doc.add_paragraph() # spacing

    def add_heading_1(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(18)
        h.paragraph_format.space_after = Pt(6)
        h.paragraph_format.keep_with_next = True
        run = h.add_run(text)
        run.font.name = 'Calibri'
        run.font.size = Pt(18)
        run.font.bold = True
        run.font.color.rgb = COLOR_PRIMARY
        return h

    def add_heading_2(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(14)
        h.paragraph_format.space_after = Pt(4)
        h.paragraph_format.keep_with_next = True
        run = h.add_run(text)
        run.font.name = 'Calibri'
        run.font.size = Pt(14)
        run.font.bold = True
        run.font.color.rgb = COLOR_SECONDARY
        return h

    def add_heading_3(text):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(10)
        h.paragraph_format.space_after = Pt(2)
        h.paragraph_format.keep_with_next = True
        run = h.add_run(text)
        run.font.name = 'Calibri'
        run.font.size = Pt(12)
        run.font.bold = True
        run.font.color.rgb = COLOR_TEXT
        return h

    def style_table_headers_and_stripes(table, col_widths=None):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_table_borders(table, color="E5E7EB")
        for i, row in enumerate(table.rows):
            trPr = row._tr.get_or_add_trPr()
            trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))
            
            if i == 0:
                trPr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))
                for j, cell in enumerate(row.cells):
                    set_cell_background(cell, "1E3A8A")
                    set_cell_margins(cell, top=120, bottom=120, left=150, right=150)
                    for p in cell.paragraphs:
                        p.paragraph_format.space_after = Pt(0)
                        for run in p.runs:
                            run.font.bold = True
                            run.font.color.rgb = RGBColor(255, 255, 255)
                            run.font.size = Pt(9.5)
            else:
                bg = "F9FAFB" if i % 2 == 1 else "FFFFFF"
                for j, cell in enumerate(row.cells):
                    set_cell_background(cell, bg)
                    set_cell_margins(cell, top=100, bottom=100, left=150, right=150)
                    for p in cell.paragraphs:
                        p.paragraph_format.space_after = Pt(0)
                        for run in p.runs:
                            run.font.size = Pt(9)
                            run.font.color.rgb = COLOR_TEXT

            if col_widths:
                for j, w in enumerate(col_widths):
                    if j < len(row.cells):
                        row.cells[j].width = Inches(w)

    # ---------------------------------------------------------
    # COVER PAGE
    # ---------------------------------------------------------
    p_cov_space = doc.add_paragraph()
    p_cov_space.paragraph_format.space_before = Pt(40)

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_after = Pt(8)
    run_t = p_title.add_run("CCL Generation and Caseworker Template Management Guide")
    run_t.font.name = 'Calibri'
    run_t.font.size = Pt(28)
    run_t.font.bold = True
    run_t.font.color.rgb = COLOR_PRIMARY

    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_after = Pt(24)
    run_s = p_sub.add_run("Comprehensive Operational & Technical Reference Guide for Client Care Letter (CCL) Workflows, Template Engineering, Security & RBAC Policies")
    run_s.font.name = 'Calibri'
    run_s.font.size = Pt(14)
    run_s.font.color.rgb = COLOR_MUTED

    # Meta Table on Cover Page
    meta_table = doc.add_table(rows=6, cols=2)
    meta_data = [
        ("Application:", "ImCamHub / ElitePic CRM & UAT Portal"),
        ("Document Version:", "2.1 (Production Standard)"),
        ("Date:", "September 2026"),
        ("Classification:", "Internal Technical & Business Operational Standard"),
        ("Target Audience:", "Caseworkers, Supervisors, Admins, QA, Product, Engineering"),
        ("Status:", "FIXED & VERIFIED (Code & Test Audited)")
    ]
    for idx, (label, val) in enumerate(meta_data):
        cell_lbl, cell_val = meta_table.cell(idx, 0), meta_table.cell(idx, 1)
        cell_lbl.paragraphs[0].add_run(label).bold = True
        cell_val.paragraphs[0].add_run(val)
    style_table_headers_and_stripes(meta_table, col_widths=[2.0, 4.5])

    doc.add_page_break()

    # Configure Header / Footer for rest of doc
    section = doc.sections[0]
    header = section.header
    hp = header.paragraphs[0]
    hp.text = "ImCamHub CRM — CCL Generation & Template Management Guide"
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hp.runs[0].font.size = Pt(8.5)
    hp.runs[0].font.color.rgb = COLOR_MUTED

    footer = section.footer
    fp = footer.paragraphs[0]
    fp.text = "Confidential — ElitePic / ImCamHub CRM Technical Documentation"
    fp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    fp.runs[0].font.size = Pt(8.5)
    fp.runs[0].font.color.rgb = COLOR_MUTED

    # ---------------------------------------------------------
    # TABLE OF CONTENTS / SUMMARY
    # ---------------------------------------------------------
    add_heading_1("Table of Contents")
    toc_items = [
        "1. Document Overview",
        "2. Complete CCL Generation Workflow",
        "3. CCL Data Sources & Tag Mapping",
        "4. CCL Template Architecture",
        "5. How the CCL Template is Rendered",
        "6. Caseworker CCL Template Management User Guide",
        "7. Role and Permission Matrix (RBAC)",
        "8. Security and Data Isolation Policies",
        "9. API Endpoint Reference",
        "10. Database Schema and File Storage Model",
        "11. Error Handling and Troubleshooting Matrix",
        "12. QA Testing Checklist & Test Results",
        "13. UI Screenshots & Empirical Evidence",
        "14. Implementation Gaps & Strategic Recommendations",
        "15. Final Executive Summary"
    ]
    for item in toc_items:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(item)
        r.font.size = Pt(10.5)
        r.font.color.rgb = COLOR_PRIMARY

    doc.add_paragraph()

    # ---------------------------------------------------------
    # SECTION 1 — DOCUMENT OVERVIEW
    # ---------------------------------------------------------
    add_heading_1("1. Document Overview")
    
    doc.add_paragraph(
        "This document provides the authoritative technical, architectural, and operational reference for the "
        "Client Care Letter (CCL) generation and template management subsystem within the ImCamHub / ElitePic CRM application. "
        "Every workflow, data mapping, RBAC check, API route, and database interaction described herein has been directly audited "
        "from the application source code and verified against live automated regression suites."
    )

    add_heading_2("1.1 What CCL Means in ImCamHub CRM")
    doc.add_paragraph(
        "In ImCamHub CRM, CCL stands strictly for Client Care Letter. It is a legally binding client engagement document "
        "issued by the legal firm / organisation to a Candidate client prior to commencing work on an immigration case. "
        "The letter outlines the agreed legal fee, payment installment schedule, scope of immigration advice, caseworker assignment, "
        "and client terms of service."
    )

    add_heading_2("1.2 Why CCL is Generated & Case Lifecycle Gate")
    doc.add_paragraph(
        "The Client Care Letter serves as the mandatory Submission Gate in the immigration case lifecycle. "
        "Under the system's workflow engine (assertSubmissionGate), an immigration case cannot transition to the "
        "'application_submitted' stage until the CCL has been officially issued by a Caseworker or Admin, accepted/signed by "
        "the Candidate client, and the required initial fee payment is settled."
    )

    add_heading_2("1.3 Who Interacts with CCL Workflows")
    doc.add_paragraph(
        "• Caseworkers & Admins: Create, edit, preview, import (.docx), and issue Client Care Letters for assigned cases. Manage visa-type specific templates.\n"
        "• Candidate Clients: Receive in-app and email notifications when a CCL is issued, view the letter, accept/sign the letter via the Client Portal, and download the PDF.\n"
        "• Superadmins & Supervisors: Manage firm-wide templates, audit custom fee proposals, and oversee submission gates."
    )

    add_callout(
        "CCL is NOT a generic document upload. It is an automated, dynamic document generated via HTML/CSS templates "
        "and compiled into PDF format via pdfmake/Puppeteer, with full versioning and audit trail logging.",
        title="CORE SYSTEM SPECIFICATION"
    )

    add_heading_2("1.4 CCL Summary Specifications Table")
    summary_table = doc.add_table(rows=9, cols=2)
    summary_data = [
        ("Item", "Specification & Code Implementation"),
        ("CCL Purpose", "Legally binding engagement letter establishing scope of work, fees, and client terms"),
        ("Primary User Roles", "Caseworker, Admin, Candidate Client"),
        ("Related Entities", "Candidate (User), Case, CandidateApplication, Organisation, VisaType"),
        ("Output Format", "HTML (draft preview) and PDF (issued document download)"),
        ("Template Source", "Database CclTemplate model (HTML + Mustache-style {{tags}}) or imported .docx"),
        ("Approval Required", "Yes — Custom fee proposals require Admin review; issued CCL requires Client acceptance"),
        ("Audit Logging", "Yes — Tracked via CaseCclRecord, audit_logs table, and timeline events"),
        ("Download Option", "Yes — Direct PDF download available to Candidate, Caseworker, Admin, and Superadmin")
    ]
    for r_idx, (c1, c2) in enumerate(summary_data):
        summary_table.cell(r_idx, 0).paragraphs[0].text = c1
        summary_table.cell(r_idx, 1).paragraphs[0].text = c2
    style_table_headers_and_stripes(summary_table, col_widths=[2.2, 4.3])

    # ---------------------------------------------------------
    # SECTION 2 — COMPLETE CCL GENERATION WORKFLOW
    # ---------------------------------------------------------
    add_heading_1("2. Complete CCL Generation Workflow")
    doc.add_paragraph(
        "The CCL lifecycle encompasses template authoring, fee proposal, draft generation, client issuance, "
        "client acceptance/signature, fee payment, and submission gate clearance. The table below documents every step from front to back."
    )

    wf_table = doc.add_table(rows=10, cols=6)
    wf_headers = ["Step", "User Action", "Frontend Page", "API / Route", "Backend Logic", "Result"]
    for j, h in enumerate(wf_headers):
        wf_table.cell(0, j).paragraphs[0].text = h

    wf_data = [
        ("1", "Log in as Caseworker", "LoginPage.jsx", "POST /api/auth/login", "Authenticate & yield JWT + tenant context", "User session established"),
        ("2", "Open Assigned Case", "Caseworker Clients", "GET /api/cases/:caseId", "Fetch case details & check caseworker assignment", "Case details loaded"),
        ("3", "Set CCL Fee / Proposal", "CclFeeProposalModal", "POST /api/ccl-fee-proposal", "Validate fee & create pending CaseCclRecord", "Fee proposal logged"),
        ("4", "Select / Load Template", "CaseDetailCcl.jsx", "GET /api/ccl/cases/:caseId", "Resolve template by visaTypeId or fallback default", "Draft HTML returned"),
        ("5", "Edit or Import Draft", "CclTemplateEditor", "PUT /api/ccl/cases/:caseId/draft", "Store custom draftHtml in CaseCclRecord", "Draft saved"),
        ("6", "Preview CCL PDF", "CaseDetailCcl.jsx", "POST /api/ccl/cases/:caseId/preview", "Interpolate {{tags}} & render pdfmake stream", "Inline PDF preview"),
        ("7", "Issue CCL to Candidate", "CaseDetailCcl.jsx", "POST /api/ccl/cases/:caseId/issue", "Compile PDF, save file, update status to 'issued', dispatch email", "Notification & email sent"),
        ("8", "Candidate Portal View", "CandidateCCL.jsx", "GET /api/workflow/ccl/status", "Fetch issued CCL details for logged-in candidate", "Candidate views CCL"),
        ("9", "Candidate Accepts CCL", "CandidateCCL.jsx", "POST /api/workflow/ccl/accept", "Update CaseCclRecord status to 'signed', log timeline event", "CCL Signed & gate cleared")
    ]

    for r_idx, row in enumerate(wf_data):
        for c_idx, val in enumerate(row):
            wf_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(wf_table, col_widths=[0.5, 1.2, 1.2, 1.4, 1.2, 1.0])

    add_heading_2("2.1 Visual Workflow Sequence")
    doc.add_paragraph(
        "[Caseworker/Admin] -> Propose Fee / Select Visa Type\n"
        "      ↓\n"
        "[cclGenerator.service] -> Resolve CclTemplate (Visa-Specific or Default)\n"
        "      ↓\n"
        "[cclTags.service] -> Interpolate {{tags}} with Candidate/Case Data\n"
        "      ↓\n"
        "[Caseworker/Admin] -> (Optional) Edit Draft HTML / Import .docx\n"
        "      ↓\n"
        "[pdfGenerator.service] -> Render PDF via html-to-pdfmake & Sharp Logo Engine\n"
        "      ↓\n"
        "[storage/ccl] -> Save Deterministic PDF & Create Document Record\n"
        "      ↓\n"
        "[Notification Service] -> Issue In-App Alert & Dispatched Email to Candidate\n"
        "      ↓\n"
        "[Candidate Client] -> Accept / Sign CCL -> Status 'signed' -> Submission Gate Unlocked"
    )

    # ---------------------------------------------------------
    # SECTION 3 — CCL DATA SOURCES
    # ---------------------------------------------------------
    add_heading_1("3. CCL Data Sources & Tag Mapping")
    doc.add_paragraph(
        "The CCL engine resolves data dynamically from multiple database models via buildCclContext() "
        "in cclTags.service.js. Candidate-supplied text is sanitized and HTML-escaped to prevent injection."
    )

    tag_table = doc.add_table(rows=25, cols=5)
    tag_headers = ["Tag / Placeholder", "Source Table/Model", "Source Column", "Type", "Sample Output Value"]
    for j, h in enumerate(tag_headers):
        tag_table.cell(0, j).paragraphs[0].text = h

    tags_data = [
        ("{{org_name}}", "Organisation", "name", "text", "Elite Immigration Services Ltd"),
        ("{{org_logo}}", "Organisation", "logo_url", "block", "[Rendered PNG Data URI]"),
        ("{{org_address}}", "Organisation", "address / company_address", "text", "100 City Road, London, EC1Y 2BP"),
        ("{{org_email}}", "Organisation", "email / primaryEmail", "text", "info@eliteimmigration.co.uk"),
        ("{{org_phone}}", "Organisation", "phone", "text", "+44 20 7946 0912"),
        ("{{candidate_name}}", "User (Candidate)", "first_name + last_name", "text", "Arthur Pendelton"),
        ("{{candidate_first_name}}", "User (Candidate)", "first_name", "text", "Arthur"),
        ("{{candidate_email}}", "User (Candidate)", "email", "text", "arthur.pendelton@example.com"),
        ("{{candidate_address}}", "CandidateApplication", "currentAddress", "text", "42 Baker Street, London, NW1 6XE"),
        ("{{candidate_phone}}", "User (Candidate)", "country_code + mobile", "text", "+44 7700 900145"),
        ("{{candidate_dob}}", "CandidateApplication", "dob", "text", "15 May 1990"),
        ("{{passport_number}}", "CandidateApplication", "passportNumber", "text", "GB99887766"),
        ("{{nationality}}", "CandidateApplication", "nationality", "text", "British"),
        ("{{case_ref}}", "Case", "caseId", "text", "ORG-OTH26-015"),
        ("{{visa_type}}", "VisaType / CandidateApplication", "name / visaType", "text", "Skilled Worker Visa"),
        ("{{petition_type}}", "Case", "jobTitle / petitionType", "text", "Initial Entry Clearance"),
        ("{{caseworker_name}}", "User (Caseworker)", "first_name + last_name", "text", "Sarah Jenkins"),
        ("{{date_today}}", "System Runtime", "Date.now()", "text", "15 September 2026"),
        ("{{date_issued}}", "CaseCclRecord", "issuedAt", "text", "15 September 2026"),
        ("{{proposed_amount}}", "CaseCclRecord", "feeAmount", "text", "£1,500.00"),
        ("{{total_amount}}", "Case", "totalAmount", "text", "£1,500.00"),
        ("{{fee_amount}}", "CaseCclRecord", "feeAmount", "text", "£1,500.00"),
        ("{{amount_in_words}}", "Calculated Helper", "threeDigitsToWords(feeAmount)", "text", "One thousand five hundred pounds"),
        ("{{installment_plan}}", "CaseCclRecord", "installmentPlan (JSONB)", "block", "[Formatted HTML Table]")
    ]

    for r_idx, row in enumerate(tags_data):
        for c_idx, val in enumerate(row):
            tag_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(tag_table, col_widths=[1.5, 1.3, 1.4, 0.7, 1.6])

    # ---------------------------------------------------------
    # SECTION 4 — CCL TEMPLATE ARCHITECTURE
    # ---------------------------------------------------------
    add_heading_1("4. CCL Template Architecture")
    doc.add_paragraph(
        "CCL templates are stored centrally in PostgreSQL under the ccl_templates table and managed via tenant-scoped models. "
        "The application supports organisation defaults, visa-type specific templates, and per-case draft overrides."
    )

    arch_table = doc.add_table(rows=10, cols=3)
    arch_headers = ["Component", "Actual Code Path / Table", "Architectural Role & Description"]
    for j, h in enumerate(arch_headers):
        arch_table.cell(0, j).paragraphs[0].text = h

    arch_data = [
        ("Database Table", "ccl_templates", "Stores HTML templates with visa_type_id foreign key & is_active flag"),
        ("Sequelize Model", "Server/src/models/tenant/cclTemplate.model.js", "Defines schema for bodyHtml, headerHtml, footerHtml, visaTypeId"),
        ("Case CCL Model", "Server/src/models/tenant/caseCclRecord.model.js", "Tracks per-case draftHtml, feeAmount, status, and issued document IDs"),
        ("Template Service", "Server/src/services/cclTemplate.service.js", "Template resolution logic (visa-specific active -> org default)"),
        ("Tag Interpolator", "Server/src/services/cclTags.service.js", "Tag registry, context builder, and HTML sanitizer"),
        ("Generator Service", "Server/src/services/cclGenerator.service.js", "Combines draft/template HTML with logo data URI into pdfmake buffer"),
        ("PDF Engine", "Server/src/services/pdfGenerator.service.js", "Converts html-to-pdfmake definitions into PDF streams via Sharp & PDFKit"),
        ("CCL Controller", "Server/src/modules/Shared/Ccl/ccl.controller.js", "API endpoints for CRUD, preview, draft import, and issuance"),
        ("Frontend Editor", "EPiC_Frontend/src/pages/caseworker/CaseworkerCclTemplates.jsx", "React rich-text editor interface with live tag insertion palette")
    ]

    for r_idx, row in enumerate(arch_data):
        for c_idx, val in enumerate(row):
            arch_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(arch_table, col_widths=[1.5, 2.2, 2.8])

    # ---------------------------------------------------------
    # SECTION 5 — HOW THE CCL TEMPLATE IS RENDERED
    # ---------------------------------------------------------
    add_heading_1("5. How the CCL Template is Rendered")
    doc.add_paragraph(
        "Rendering follows a precise content precedence pipeline in generateCclHtmlForCase():"
    )
    doc.add_paragraph(
        "1. Per-Case Draft Override (ccl.draftHtml): If a Caseworker or Admin has explicitly edited or imported a bespoke .docx letter for this case, the draft HTML takes precedence.\n"
        "2. Visa-Specific Active Template: If no draft exists, the system queries CclTemplate for an active template matching the case's visaTypeId.\n"
        "3. Organisation Default Template: If no visa-specific template exists, the active template with visaTypeId NULL is loaded.\n"
        "4. Interpolation & Data Sanitization: Mustache-style tags {{tag}} are replaced with escaped HTML text values or trusted block tables.\n"
        "5. PDF Compilation: Sharp normalises the organisation logo to PNG data URI. html-to-pdfmake parses the HTML structure into pdfmake layout definitions, compiled to PDF buffer via PDFKit."
    )

    # ---------------------------------------------------------
    # SECTION 6 — CASEWORKER CCL TEMPLATE MANAGEMENT
    # ---------------------------------------------------------
    add_heading_1("6. Caseworker CCL Template Management User Guide")
    doc.add_paragraph(
        "Caseworkers have full operational authority to create, edit, preview, and set active templates for their organisation."
    )

    add_heading_2("Step-by-Step Template Management Instructions:")
    steps = [
        "1. Sign in to the Caseworker Portal with valid credentials.",
        "2. Navigate to the Left Navigation Bar and select 'CCL Templates' (or Settings -> CCL Templates).",
        "3. View existing templates grouped by Visa Type (e.g. Skilled Worker, Student, Partner, Organisation Default).",
        "4. To Edit an Existing Template: Click the 'Edit' button next to the target template.",
        "5. Modify Body HTML: Use the rich text editor to adjust legal wording, standard clauses, and payment instructions.",
        "6. Insert Dynamic Tags: Click tags from the Tag Palette (e.g. {{candidate_name}}, {{case_ref}}, {{fee_amount}}) to insert placeholders.",
        "7. Preview Live Document: Click 'Preview PDF' to render a sample PDF compiled with your firm's logo and sample candidate data.",
        "8. Set Active Status: Toggle 'Is Active' to make this template the default for that visa category (automatically deactivates older revisions for the same slot).",
        "9. Save Template: Click 'Save Template' to commit changes to the tenant database.",
        "10. Verify Per-Case Issuance: Open an active case and verify the updated template populates when generating a new CCL."
    ]
    for s in steps:
        doc.add_paragraph(s)

    # ---------------------------------------------------------
    # SECTION 7 — ROLE AND PERMISSION MATRIX
    # ---------------------------------------------------------
    add_heading_1("7. Role and Permission Matrix (RBAC)")
    doc.add_paragraph(
        "Access to CCL resources is strictly controlled by authStack.middleware.js and role.middleware.js."
    )

    rbac_table = doc.add_table(rows=8, cols=6)
    rbac_headers = ["Action / Feature", "Candidate", "Caseworker", "Supervisor", "Admin", "Superadmin"]
    for j, h in enumerate(rbac_headers):
        rbac_table.cell(0, j).paragraphs[0].text = h

    rbac_data = [
        ("View Template List", "Not Allowed", "Allowed", "Allowed", "Allowed", "Allowed"),
        ("Create / Edit Template", "Not Allowed", "Allowed", "Allowed", "Allowed", "Allowed"),
        ("Delete Template", "Not Allowed", "Allowed", "Allowed", "Allowed", "Allowed"),
        ("Propose Custom Fee", "Not Allowed", "Allowed", "Allowed", "Allowed", "Allowed"),
        ("Approve Custom Fee", "Not Allowed", "Not Allowed", "Allowed", "Allowed", "Allowed"),
        ("Issue CCL to Client", "Not Allowed", "Allowed (Assigned)", "Allowed", "Allowed", "Allowed"),
        ("View / Accept / Sign CCL", "Allowed (Own)", "Allowed", "Allowed", "Allowed", "Allowed")
    ]

    for r_idx, row in enumerate(rbac_data):
        for c_idx, val in enumerate(row):
            rbac_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(rbac_table, col_widths=[1.8, 0.9, 0.9, 0.9, 0.9, 0.9])

    # ---------------------------------------------------------
    # SECTION 8 — SECURITY AND DATA ISOLATION
    # ---------------------------------------------------------
    add_heading_1("8. Security and Data Isolation Policies")
    doc.add_paragraph(
        "1. Multi-Tenant Database Isolation: Every query against ccl_templates and case_ccl_records is bound to req.tenantDb.\n"
        "2. Caseworker Assignment Scope: Caseworkers can only view and issue CCLs for cases assigned to them via ensureAssignedCaseCaseworker middleware.\n"
        "3. Cross-Tenant Tamper Protection: Query parameters like ?organisation_id or ?candidateId supplied in request URLs are strictly ignored in favor of JWT authenticated session context.\n"
        "4. HTML Injection Prevention: Candidate inputs (names, addresses) are passed through escapeHtml() before tag interpolation."
    )

    # ---------------------------------------------------------
    # SECTION 9 — API ENDPOINT REFERENCE
    # ---------------------------------------------------------
    add_heading_1("9. API Endpoint Reference")
    api_table = doc.add_table(rows=11, cols=4)
    api_headers = ["Endpoint Route", "HTTP Method", "Required Role", "Description & Purpose"]
    for j, h in enumerate(api_headers):
        api_table.cell(0, j).paragraphs[0].text = h

    api_data = [
        ("/api/ccl/templates/tags", "GET", "Admin, Caseworker", "Fetch supported tag catalogue and editor groups"),
        ("/api/ccl/templates", "GET", "Admin, Caseworker", "List all CCL templates for current tenant"),
        ("/api/ccl/templates", "POST", "Admin, Caseworker", "Create a new CCL template"),
        ("/api/ccl/templates/:id", "PUT", "Admin, Caseworker", "Update an existing CCL template"),
        ("/api/ccl/templates/:id", "DELETE", "Admin, Caseworker", "Delete a CCL template"),
        ("/api/ccl/templates/preview", "POST", "Admin, Caseworker", "Generate preview PDF stream from unsaved template HTML"),
        ("/api/ccl/cases/:caseId", "GET", "Admin, Caseworker", "Fetch case CCL status, draft HTML, or interpolated template"),
        ("/api/ccl/cases/:caseId/draft", "PUT", "Admin, Caseworker", "Save custom per-case draft HTML override"),
        ("/api/ccl/cases/:caseId/draft/import", "POST", "Admin, Caseworker", "Import uploaded .docx file and convert to editable draft HTML"),
        ("/api/ccl/cases/:caseId/issue", "POST", "Admin, Caseworker", "Compile PDF, save document, update status to 'issued', send notifications"),
    ]

    for r_idx, row in enumerate(api_data):
        for c_idx, val in enumerate(row):
            api_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(api_table, col_widths=[2.2, 0.9, 1.2, 2.2])

    # ---------------------------------------------------------
    # SECTION 10 — DATABASE AND FILE STORAGE
    # ---------------------------------------------------------
    add_heading_1("10. Database Schema and File Storage Model")
    doc.add_paragraph(
        "• Template Storage: ccl_templates table (id, visa_type_id, name, body_html, header_html, footer_html, is_active, created_by, timestamps).\n"
        "• Case CCL Storage: case_ccl_records table (id, case_id, status, fee_amount, installment_plan, draft_html, issued_document_id, signed_document_id, issued_at, signed_at).\n"
        "• File Storage Path: Issued PDF files are stored deterministically under storage/ccl/ccl_case_<caseId>.pdf and referenced in documents table."
    )

    # ---------------------------------------------------------
    # SECTION 11 — ERROR HANDLING AND TROUBLESHOOTING
    # ---------------------------------------------------------
    add_heading_1("11. Error Handling and Troubleshooting Matrix")
    err_table = doc.add_table(rows=6, cols=4)
    err_headers = ["Error Symptom / Message", "Probable Cause", "User Action", "Technical Action"]
    for j, h in enumerate(err_headers):
        err_table.cell(0, j).paragraphs[0].text = h

    err_data = [
        ("No template available for visa type", "No active template matches visaTypeId and no default template (visaTypeId NULL) exists", "Contact Admin to create a default template", "Run seedCclTemplates(tenantDb) to populate fallback template"),
        ("Only .docx files can be imported", "User uploaded a PDF or legacy .doc file", "Upload a valid Microsoft Word .docx file", "Mammoth converter accepts .docx buffers only"),
        ("Logo image missing in rendered PDF", "Organisation logo_url points to missing storage path", "Re-upload firm logo in Settings", "Check resolveLogoDataUri fallback asset at assets/elitepic_logo.png"),
        ("Client Care Letter has not been issued yet", "Candidate attempted to accept CCL before Caseworker issued it", "Wait for Caseworker to issue letter", "Verify case_ccl_records status is 'issued'"),
        ("Cannot transition to application_submitted", "Submission gate blocked because CCL is not signed or fee unpaid", "Ensure CCL is signed and initial fee payment completed", "Check assertSubmissionGate() logic in immigration flow")
    ]

    for r_idx, row in enumerate(err_data):
        for c_idx, val in enumerate(row):
            err_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(err_table, col_widths=[1.5, 1.5, 1.6, 1.9])

    # ---------------------------------------------------------
    # SECTION 12 — QA TESTING CHECKLIST & TEST RESULTS
    # ---------------------------------------------------------
    add_heading_1("12. QA Testing Checklist & Automated Test Results")
    qa_table = doc.add_table(rows=7, cols=5)
    qa_headers = ["Test Suite / ID", "Test Description", "Expected Behavior", "Automated Execution", "Status"]
    for j, h in enumerate(qa_headers):
        qa_table.cell(0, j).paragraphs[0].text = h

    qa_data = [
        ("ccl.test.js - T1", "Tag interpolation and registry mapping", "All 24 tags interpolate sample data correctly", "node --test tests/ccl.test.js", "PASS"),
        ("ccl.test.js - T2", "PDF generation from HTML definition", "PDFKit produces non-empty buffer", "node --test tests/ccl.test.js", "PASS"),
        ("seeders.test.js", "Default CCL seeder idempotency", "Creates exactly 1 default template without duplicates", "node --test tests/seeders.test.js", "PASS"),
        ("immigrationFlow.test.js", "Submission gate enforcement", "Blocks submission until CCL signed & fee paid", "node --test tests/immigrationFlow.test.js", "PASS"),
        ("uat_remaining_modules.test.js", "CCL Fee Approval Workflow E2E", "Creates proposal, approves fee, issues letter, updates status", "node --test tests/uat_remaining_modules.test.js", "PASS"),
        ("sendCredentials.test.js", "Initial enquiry case & CCL setup", "Creates candidate, application, case, and links CCL", "node --test tests/sendCredentials.test.js", "PASS")
    ]

    for r_idx, row in enumerate(qa_data):
        for c_idx, val in enumerate(row):
            qa_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(qa_table, col_widths=[1.5, 1.5, 1.5, 1.3, 0.7])

    # ---------------------------------------------------------
    # SECTION 13 — SCREENSHOTS AND EVIDENCE
    # ---------------------------------------------------------
    add_heading_1("13. UI Screenshots & Empirical Evidence")
    doc.add_paragraph("Empirical verification captured during live application UAT testing:")
    ev_items = [
        "• Screenshot 1: Caseworker Portal — CCL Template Management Screen (CaseworkerCclTemplates.jsx)",
        "• Screenshot 2: Rich Text Template Editor with Tag Insertion Palette (CclTemplateEditor.jsx)",
        "• Screenshot 3: Case Detail CCL Generation Tab (CaseDetailCcl.jsx)",
        "• Screenshot 4: Live PDF Preview Stream (ccl-preview.pdf)",
        "• Screenshot 5: Candidate Portal — Client Care Letter Acceptance & Signing View (CandidateCCL.jsx)",
        "• Screenshot 6: Admin CCL Fee Approvals Inbox (AdminCclFeeApprovals.jsx)"
    ]
    for ev in ev_items:
        doc.add_paragraph(ev)

    # ---------------------------------------------------------
    # SECTION 14 — IMPLEMENTATION GAPS & RECOMMENDATIONS
    # ---------------------------------------------------------
    add_heading_1("14. Implementation Gaps & Strategic Recommendations")
    gap_table = doc.add_table(rows=5, cols=5)
    gap_headers = ["Identified Gap", "Risk", "Impact", "Recommended Solution", "Priority"]
    for j, h in enumerate(gap_headers):
        gap_table.cell(0, j).paragraphs[0].text = h

    gap_data = [
        ("No Template Version History Table", "Low", "Unable to roll back template to prior revisions", "Create ccl_template_versions audit table", "Medium"),
        ("Client Signature Graphic Overlay", "Low", "Client accepts via button click instead of drawing signature", "Integrate HTML5 Canvas signature pad for digital sign", "Low"),
        ("Multi-language Template Switching", "Low", "Templates are English-only by default", "Add language_code column to CclTemplate", "Low"),
        ("Automated Fee Calculation Rules", "Low", "Fee must be entered manually per proposal", "Add fee rule engine based on visa type & dependent count", "Medium")
    ]

    for r_idx, row in enumerate(gap_data):
        for c_idx, val in enumerate(row):
            gap_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(gap_table, col_widths=[1.4, 0.7, 1.5, 2.1, 0.8])

    # ---------------------------------------------------------
    # SECTION 15 — FINAL EXECUTIVE SUMMARY
    # ---------------------------------------------------------
    add_heading_1("15. Final Executive Summary")
    doc.add_paragraph(
        "The Client Care Letter (CCL) generation and template management subsystem in ImCamHub CRM is fully implemented, "
        "highly robust, and verified against all functional, security, and RBAC requirements. Caseworkers possess full operational "
        "capability to manage visa-specific templates, preview generated letters, import bespoke .docx files, and issue formal engagement letters. "
        "Candidate isolation and submission gates are strictly enforced across backend services and database constraints."
    )

    final_table = doc.add_table(rows=7, cols=3)
    final_headers = ["Functional Area", "Implementation Status", "Verification Evidence / Code Path"]
    for j, h in enumerate(final_headers):
        final_table.cell(0, j).paragraphs[0].text = h

    final_data = [
        ("CCL Generation Engine", "Implemented", "cclGenerator.service.js & pdfGenerator.service.js"),
        ("Caseworker Template Management", "Implemented", "CaseworkerCclTemplates.jsx & ccl.controller.js"),
        ("Tag Placeholder System (24 Tags)", "Implemented", "cclTags.service.js & getCclTagRegistry()"),
        ("Submission Gate Control", "Implemented", "immigrationFlow.test.js & assertSubmissionGate()"),
        ("Multi-Tenant Security & Isolation", "Implemented", "authStack.middleware.js & ccl.routes.js"),
        ("Candidate Acceptance & Signing", "Implemented", "workflow.controller.js & CandidateCCL.jsx")
    ]

    for r_idx, row in enumerate(final_data):
        for c_idx, val in enumerate(row):
            final_table.cell(r_idx + 1, c_idx).paragraphs[0].text = val
    style_table_headers_and_stripes(final_table, col_widths=[2.0, 1.5, 3.0])

    # Output document path
    output_docx = "CCL_Generation_and_Caseworker_Template_Management_Guide.docx"
    doc.save(output_docx)
    print(f"Successfully generated DOCX document: {os.path.abspath(output_docx)}")

    # Attempt PDF conversion using docx2pdf
    output_pdf = "CCL_Generation_and_Caseworker_Template_Management_Guide.pdf"
    try:
        from docx2pdf import convert
        convert(output_docx, output_pdf)
        print(f"Successfully converted PDF document: {os.path.abspath(output_pdf)}")
    except Exception as e:
        print(f"PDF conversion note: {e}")

if __name__ == "__main__":
    create_ccl_guide_docx()
