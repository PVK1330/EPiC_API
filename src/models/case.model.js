const CaseModel = (sequelize, DataTypes) => {
  const Case = sequelize.define("Case", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    caseId: {
      type: DataTypes.STRING, //CAS-000001 likewiseauto genrated 
      allowNull: true,
    },

    candidateId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    sponsorId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },

    visaTypeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'visa_types',
        key: 'id'
      }
    },
    petitionTypeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'petition_types',
        key: 'id'
      }
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "urgent"),
      defaultValue: "medium",
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: "Lead", // Initial Kanban Stage
    },
    submitted: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    targetSubmissionDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    lcaNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    receiptNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    nationality: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    jobTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    department: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    assignedcaseworkerId: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "Array of caseworker IDs assigned to this case"
    },
    salaryOffered: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    totalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    paidAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    biometricsDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Date for biometrics appointment"
    },
    submissionDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Date when case was submitted"
    },
    decisionDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Date when decision was made"
    },
    applicationType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "Type of application (e.g., H1B, L1, Green Card)"
    },
    caseStage: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "Initial",
      comment: "Current stage of the case"
    },
  }, {
    tableName: 'cases',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return Case;
};

export default CaseModel;
