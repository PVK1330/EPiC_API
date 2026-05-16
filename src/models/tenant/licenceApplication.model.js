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
                type: DataTypes.ENUM('Pending', 'Approved', 'Rejected', 'Under Review', 'Information Requested'),
                allowNull: false,
                defaultValue: 'Pending',
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
                allowNull: false,
            },
            tradingName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            registrationNumber: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            industry: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            licenceType: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            cosAllocation: {
                type: DataTypes.STRING(50),
                allowNull: false,
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
                allowNull: false,
            },
            contactEmail: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            contactPhone: {
                type: DataTypes.STRING(20),
                allowNull: false,
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
            paranoid: true,
        }
    );

    return LicenceApplication;
};
