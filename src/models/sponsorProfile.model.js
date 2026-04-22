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
            },
            insuranceCertificate: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            hrPolicies: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            organisationalChart: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            recruitmentDocs: {
                type: DataTypes.STRING(500),
                allowNull: true,
            },
            activeCases: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0,
            },
            sponsoredWorkers: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0,
            },
            notes: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            riskPct: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 20,
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
