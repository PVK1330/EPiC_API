export default (sequelize, DataTypes) => {
    const SponsorProfile = sequelize.define(
        "SponsorProfile",
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
            companyName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            tradingName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            registrationNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            sponsorLicenceNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            licenceRating: {
                type: DataTypes.STRING(50),
                allowNull: true,
                values: ['Gold', 'Silver', 'Bronze'],
            },
            industrySector: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            yearEstablished: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            website: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            registeredAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            tradingAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            city: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            state: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            country: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            postalCode: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            authorisingName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            authorisingPhone: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            authorisingEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            authorisingJobTitle: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: 'authorising_job_title'
            },
            keyContactName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            keyContactPhone: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            keyContactEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            keyContactDepartment: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: 'key_contact_department'
            },
            hrName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            hrEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            hrPhone: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            hrJobTitle: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: 'hr_job_title'
            },
            licenceIssueDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            licenceExpiryDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            cosAllocation: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            licenceStatus: {
                type: DataTypes.ENUM('Active', 'Suspended', 'Expired', 'Pending'),
                allowNull: true,
                defaultValue: 'Active',
            },
            riskLevel: {
                type: DataTypes.ENUM('Low', 'Medium', 'High'),
                allowNull: true,
                defaultValue: 'Low',
            },
            billingName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            billingEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            billingPhone: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            outstandingBalance: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
                defaultValue: 0,
            },
            paymentTerms: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            ownershipType: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            shareholders: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            directors: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            level1Users: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            sponsorLetter: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: 'sponsor_letter',
            },
            insuranceCertificate: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: 'insurance_certificate',
            },
            hrPolicies: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: 'hr_policies',
            },
            organisationalChart: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: 'organisational_chart',
            },
            recruitmentDocs: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: 'recruitment_docs',
            },
            activeCases: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0,
                field: 'active_cases',
            },
            sponsoredWorkers: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0,
                field: 'sponsored_workers',
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            riskPct: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 20,
                field: 'risk_pct',
            },
        },
        {
            tableName: "sponsor_profiles",
            timestamps: true,
            indexes: [
                {
                    unique: true,
                    fields: ["userId"],
                },
            ],
        }
    );

    return SponsorProfile;
};
