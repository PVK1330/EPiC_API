export default (sequelize, DataTypes) => {
    const LicenceApplication = sequelize.define(
        "LicenceApplication",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: "users",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            organisationId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "organisation_id",
                references: {
                    model: "organisations",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
            },
            type: {
                type: DataTypes.ENUM('New', 'Renewal'),
                allowNull: false,
                defaultValue: 'New',
            },
            status: {
                type: DataTypes.ENUM('Draft', 'Pending', 'Approved', 'Rejected', 'Under Review', 'Information Requested', 'Government Processing', 'Decision Pending', 'Licence Granted', 'Licence Rejected'),
                allowNull: false,
                defaultValue: 'Pending',
            },
            // V2 metadata: distinguishes the lightweight V1 intake (1) from the
            // normalized 8-step V2 application (2). See sponsorLicenceV2 module.
            applicationVersion: {
                type: DataTypes.SMALLINT,
                allowNull: false,
                defaultValue: 1,
                field: 'application_version',
            },
            currentStep: {
                type: DataTypes.SMALLINT,
                allowNull: true,
                defaultValue: 1,
                field: 'current_step',
            },
            submittedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'submitted_at',
            },
            // Computed fee snapshot (see services/licenceFee.service.js).
            feeSponsorSize: {
                type: DataTypes.STRING(20),
                allowNull: true,
                field: 'fee_sponsor_size',
            },
            feeBase: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                field: 'fee_base',
            },
            feeIscEstimate: {
                type: DataTypes.DECIMAL(12, 2),
                allowNull: true,
                field: 'fee_isc_estimate',
            },
            feeTotal: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                field: 'fee_total',
            },
            feeCurrency: {
                type: DataTypes.STRING(3),
                allowNull: true,
                defaultValue: 'GBP',
                field: 'fee_currency',
            },
            requestedDocuments: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            assignedcaseworkerId: {
                type: DataTypes.JSONB,
                allowNull: true,
                comment: "Array of caseworker IDs assigned to this licence application"
            },
            companyName: {
                type: DataTypes.STRING(255),
                allowNull: true, // V2 drafts capture this in licence_organisation_info; mirrored on submit
            },
            tradingName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            registrationNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            industry: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            licenceType: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            cosAllocation: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            proposedStartDate: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            reason: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            contactName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            contactEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            contactPhone: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            fundingSource: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            estimatedAnnualCost: {
                type: DataTypes.DECIMAL(15, 2),
                allowNull: true,
            },
            documents: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            adminNotes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            // Phase 1 — government processing tracking (headline fields mirrored
            // from licence_government_tracking for fast filter/sort queries).
            governmentRegistrationRef: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "government_registration_ref",
            },
            governmentSubmissionRef: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "government_submission_ref",
            },
            governmentSubmissionDate: {
                type: DataTypes.DATEONLY,
                allowNull: true,
                field: "government_submission_date",
            },
            reviewStartedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "review_started_at",
            },
            // Rejection reason stored directly for fast display without a join.
            rejectionReason: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: "rejection_reason",
            },
            // Information Request workflow timestamps.
            infoRequestedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "info_requested_at",
            },
            infoReceivedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "info_received_at",
            },
            // ── Flow v2 fields ─────────────────────────────────────────────────
            // Set when the sponsor marks payment confirmed on the UKVI portal.
            ukviPaymentConfirmedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "ukvi_payment_confirmed_at",
            },
            // Set to rejectedAt + 6 months when UKVI rejects the application.
            // Sponsor must wait until this date before reapplying on UKVI.
            rejectionCooldownUntil: {
                type: DataTypes.DATEONLY,
                allowNull: true,
                field: "rejection_cooldown_until",
            },
            // Soft-delete timestamp. Non-null means the row has been soft-deleted
            // via Sequelize paranoid mode; hard-deleted rows are gone from the DB.
            // Restored via LicenceApplication.restore() or the restore endpoint.
            deletedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "deleted_at",
            },
        },
        {
            tableName: "licence_applications",
            timestamps: true,
            createdAt: "createdAt",
            updatedAt: "updatedAt",
            // Soft deletes: destroy() sets deleted_at rather than removing the row.
            // Audit rows, stage tasks, and appendix documents are preserved because
            // their FK references the id column that still exists in the table.
            paranoid: true,
        }
    );

    return LicenceApplication;
};
