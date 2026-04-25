/**
 * AUDIT LOG INTEGRATION GUIDE
 * 
 * This file provides examples of how to integrate audit logging into your controllers.
 * Copy the patterns shown here to integrate audit logging into your existing endpoints.
 */

// ========================================================================================
// 1. IMPORT STATEMENT (Add to top of your controller)
// ========================================================================================

import { createAuditLog } from '../services/auditLog.service.js';

// ========================================================================================
// 2. CASE OPERATIONS
// ========================================================================================

/**
 * Example: Create Case with Audit Log
 * Add this inside your createCase function after successful case creation:
 */
async function exampleCreateCase(req, res) {
    try {
        // Your existing case creation logic here...
        const newCase = await db.Case.create({
            // ...case data
        });

        // LOG: Case Created
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_CREATED',
            resource_id: newCase.caseId, // or newCase.id
            status: 'SUCCESS',
            details: `Created case for candidate: ${newCase.candidateId}`,
            req,
        });

        return res.status(201).json({
            status: 'success',
            data: newCase,
        });
    } catch (error) {
        // LOG: Case Creation Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_CREATED',
            resource_id: 'UNKNOWN',
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Case creation failed',
        });
    }
}

/**
 * Example: Update Case with Audit Log
 */
async function exampleUpdateCase(req, res) {
    try {
        const caseId = req.params.id;
        
        // Your existing case update logic here...
        const updatedCase = await db.Case.update(
            { /* update data */ },
            { where: { id: caseId } }
        );

        // LOG: Case Updated
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_UPDATED',
            resource_id: caseId,
            status: 'SUCCESS',
            details: `Updated case: ${JSON.stringify(req.body)}`,
            req,
        });

        return res.status(200).json({
            status: 'success',
            data: updatedCase,
        });
    } catch (error) {
        // LOG: Case Update Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_UPDATED',
            resource_id: req.params.id,
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Case update failed',
        });
    }
}

/**
 * Example: Delete Case with Audit Log
 */
async function exampleDeleteCase(req, res) {
    try {
        const caseId = req.params.id;
        
        // Your existing case deletion logic here...
        await db.Case.destroy({ where: { id: caseId } });

        // LOG: Case Deleted
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_DELETED',
            resource_id: caseId,
            status: 'SUCCESS',
            details: `Deleted case`,
            req,
        });

        return res.status(200).json({
            status: 'success',
            message: 'Case deleted',
        });
    } catch (error) {
        // LOG: Case Deletion Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'CASE_DELETED',
            resource_id: req.params.id,
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Case deletion failed',
        });
    }
}

// ========================================================================================
// 3. PAYMENT OPERATIONS
// ========================================================================================

/**
 * Example: Process Payment with Audit Log
 */
async function exampleProcessPayment(req, res) {
    try {
        const { caseId, amount, invoiceNumber } = req.body;
        
        // Your existing payment processing logic here...
        const payment = await db.CasePayment.create({
            caseId,
            amount,
            invoiceNumber,
            // ...other payment data
        });

        // LOG: Payment Processed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'PAYMENT_PROCESSED',
            resource_id: invoiceNumber,
            status: 'SUCCESS',
            details: `Processed payment of $${amount} for case #${caseId}`,
            req,
        });

        return res.status(200).json({
            status: 'success',
            data: payment,
        });
    } catch (error) {
        // LOG: Payment Processing Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'PAYMENT_PROCESSED',
            resource_id: req.body.invoiceNumber || 'UNKNOWN',
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Payment processing failed',
        });
    }
}

// ========================================================================================
// 4. USER MANAGEMENT OPERATIONS
// ========================================================================================

/**
 * Example: Create User with Audit Log
 */
async function exampleCreateUser(req, res) {
    try {
        const { first_name, last_name, email, role_id } = req.body;
        
        // Your existing user creation logic here...
        const newUser = await db.User.create({
            first_name,
            last_name,
            email,
            role_id,
            // ...other user data
        });

        // LOG: User Created
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'USER_CREATED',
            resource_id: newUser.id,
            status: 'SUCCESS',
            details: `Created new user: ${first_name} ${last_name} (${email}) with role_id: ${role_id}`,
            req,
        });

        return res.status(201).json({
            status: 'success',
            data: newUser,
        });
    } catch (error) {
        // LOG: User Creation Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'USER_CREATED',
            resource_id: 'UNKNOWN',
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'User creation failed',
        });
    }
}

/**
 * Example: Update User with Audit Log
 */
async function exampleUpdateUser(req, res) {
    try {
        const userId = req.params.id;
        
        // Your existing user update logic here...
        await db.User.update(
            { /* update data */ },
            { where: { id: userId } }
        );

        // LOG: User Updated
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'USER_UPDATED',
            resource_id: userId,
            status: 'SUCCESS',
            details: `Updated user fields: ${Object.keys(req.body).join(', ')}`,
            req,
        });

        return res.status(200).json({
            status: 'success',
            message: 'User updated',
        });
    } catch (error) {
        // LOG: User Update Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'USER_UPDATED',
            resource_id: req.params.id,
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'User update failed',
        });
    }
}

// ========================================================================================
// 5. DOCUMENT OPERATIONS
// ========================================================================================

/**
 * Example: Upload Document with Audit Log
 */
async function exampleUploadDocument(req, res) {
    try {
        const { caseId, documentType } = req.body;
        const file = req.file;
        
        // Your existing document upload logic here...
        const document = await db.Document.create({
            caseId,
            documentType,
            fileName: file.originalname,
            filePath: file.path,
            uploadedBy: req.user.userId,
        });

        // LOG: Document Uploaded
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'DOCUMENT_UPLOADED',
            resource_id: document.id,
            status: 'SUCCESS',
            details: `Uploaded document: ${file.originalname} for case #${caseId}`,
            req,
        });

        return res.status(201).json({
            status: 'success',
            data: document,
        });
    } catch (error) {
        // LOG: Document Upload Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'DOCUMENT_UPLOADED',
            resource_id: 'UNKNOWN',
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Document upload failed',
        });
    }
}

/**
 * Example: Delete Document with Audit Log
 */
async function exampleDeleteDocument(req, res) {
    try {
        const documentId = req.params.id;
        
        // Your existing document deletion logic here...
        await db.Document.destroy({ where: { id: documentId } });

        // LOG: Document Deleted
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'DOCUMENT_DELETED',
            resource_id: documentId,
            status: 'SUCCESS',
            details: `Deleted document`,
            req,
        });

        return res.status(200).json({
            status: 'success',
            message: 'Document deleted',
        });
    } catch (error) {
        // LOG: Document Deletion Failed
        await createAuditLog({
            user_id: req.user.userId,
            user_name: req.user.email,
            action: 'DOCUMENT_DELETED',
            resource_id: req.params.id,
            status: 'FAILED',
            details: `Error: ${error.message}`,
            req,
        });

        return res.status(500).json({
            status: 'error',
            message: 'Document deletion failed',
        });
    }
}

// ========================================================================================
// 6. KEY POINTS TO REMEMBER
// ========================================================================================

/**
 * 1. Always add audit logging at the END of successful operations
 * 2. For errors, catch and log before returning error response
 * 3. Status can be: 'SUCCESS', 'FAILED', or 'PENDING'
 * 4. resource_id must match the actual resource ID (case_id, user_id, invoice_number, etc.)
 * 5. req is required to capture IP address and user-agent
 * 6. User must have req.user.userId and req.user.email from auth middleware
 * 7. The service will NOT break main API if audit logging fails
 * 8. resource_type is automatically determined from action type:
 *    - LOGIN/LOGOUT -> SYSTEM
 *    - CASE_* -> CASE
 *    - PAYMENT_* -> INVOICE
 *    - USER_* -> USER
 *    - DOCUMENT_* -> DOCUMENT
 */

export { exampleCreateCase, exampleUpdateCase, exampleDeleteCase };
