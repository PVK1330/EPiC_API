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
            type: {
                type: DataTypes.ENUM('New', 'Renewal'),
                allowNull: false,
                defaultValue: 'New',
            },
            status: {
                type: DataTypes.ENUM('Draft', 'Pending', 'Approved', 'Rejected', 'Under Review', 'Information Requested'),
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
        },
        {
            tableName: "licence_applications",
            timestamps: true,
            createdAt: "createdAt",
            updatedAt: "updatedAt",
            paranoid: false,
        }
    );

    return LicenceApplication;
};
