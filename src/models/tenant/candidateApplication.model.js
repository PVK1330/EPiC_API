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
            
            // Personal Information — core identity fields mirrored from the form
            firstName: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            lastName: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            email: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            contactNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            applicationType: {
                type: DataTypes.ENUM('Single', 'Family'),
                allowNull: true,
                defaultValue: 'Single',
            },
            gender: {
                type: DataTypes.STRING(30),
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
            addressStartDate: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            housingStatus: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            landlordName: {
                type: DataTypes.STRING(200),
                allowNull: true,
            },
            landlordContactNumber: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            landlordEmail: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            landlordAddress: {
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
            previousAddresses: {
                type: DataTypes.JSONB,
                allowNull: true,
                defaultValue: [],
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
            nationalities: {
                type: DataTypes.JSONB,
                allowNull: true,
                defaultValue: [],
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
            ukLicenseNumber: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            medicalTreatment: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            medicalTreatmentHospitalClinicName: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            medicalTreatmentHospitalClinicAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            medicalTreatmentStartDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            medicalTreatmentEndDate: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            medicalTreatmentDetails: {
                type: DataTypes.TEXT,
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
            illegalEntryDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            overstayed: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            overstayedDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            breach: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            breachDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            falseInfo: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            falseInfoDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            otherBreach: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            otherBreachDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            refusedVisa: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedVisaReason: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            refusedVisaDate: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
            refusedVisaCountry: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            refusedVisaType: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            refusedVisaReference: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            refusedVisaDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            refusedEntry: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedEntryDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            refusedPermission: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedPermissionDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            refusedAsylum: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            refusedAsylumDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            deported: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            deportedDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            removed: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            removedDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            requiredToLeave: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            requiredToLeaveDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            banned: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            bannedDetails: {
                type: DataTypes.TEXT,
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
            sponsoredDetails: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            englishProof: {
                type: DataTypes.ENUM('Yes', 'No'),
                allowNull: true,
            },
            cosNumber: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            socCode: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            contractType: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },
            workLocation: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            workingHours: {
                type: DataTypes.STRING(100),
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
            
            isLocked: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
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
            organisation_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: "organisations",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "SET NULL",
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
            hooks: {
                afterUpdate: async (instance, options) => {
                    // Dynamically import to prevent circular dependency issues during model initialization
                    const { trackFieldChanges } = await import('../../services/auditTracking.service.js');
                    await trackFieldChanges(instance, options);
                }
            }
        }
    );

    return CandidateApplication;
};
