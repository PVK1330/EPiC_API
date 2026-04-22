export default (sequelize, DataTypes) => {
    const CandidateApplication = sequelize.define(
        "CandidateApplication",
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
            
            // Personal Information
            applicationType: {
                type: DataTypes.ENUM('Single', 'Family'),
                allowNull: true,
                defaultValue: 'Single',
            },
            gender: {
                type: DataTypes.ENUM('Male', 'Female', 'Prefer not to say'),
                allowNull: true,
            },
            relationshipStatus: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            address: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            contactNumber2: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            previousFullAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            previousAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            startDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            endDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            
            // Nationality & Identity
            nationality: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            birthCountry: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            placeOfBirth: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            dob: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            passportNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            issuingAuthority: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            issueDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            expiryDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            passportAvailable: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            nationalIdCardNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            nationalIdNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            idIssuingAuthorityCard: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            idIssuingAuthorityNational: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            otherNationality: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            ukLicense: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            medicalTreatment: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            ukStayDuration: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            
            // Parent Information
            parentName: {
                type: DataTypes.STRING(200),
                allowNull: true,
            },
            parentRelation: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            parentDob: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            parentNationality: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            sameNationality: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            parent2Name: {
                type: DataTypes.STRING(200),
                allowNull: true,
            },
            parent2Relation: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            parent2Dob: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            parent2Nationality: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            parent2SameNationality: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            
            // Immigration History
            illegalEntry: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            overstayed: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            breach: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            falseInfo: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            otherBreach: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedVisa: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedEntry: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedPermission: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedAsylum: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            deported: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            removed: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            requiredToLeave: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            banned: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            
            // Travel History
            visitedOther: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            countryVisited: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            visitReason: {
                type: DataTypes.STRING(200),
                allowNull: true,
            },
            entryDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            leaveDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            
            // Current Visa Information
            visaType: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            brpNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            visaEndDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            niNumber: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            sponsored: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            englishProof: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            
            // Custom fields for admin-defined questions
            customResponses: {
                type: DataTypes.JSON,
                allowNull: true,
                defaultValue: {},
            },
            
            // Application status
            status: {
                type: DataTypes.ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected'),
                allowNull: true,
                defaultValue: 'draft',
            },
            
            // Application metadata
            submittedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            reviewedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            reviewedBy: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: "users",
                    key: "id",
                },
            },
        },
        {
            tableName: "candidate_applications",
            timestamps: true,
            indexes: [
                {
                    fields: ["userId"],
                },
                {
                    fields: ["status"],
                },
                {
                    fields: ["submittedAt"],
                },
            ],
        }
    );

    return CandidateApplication;
};
