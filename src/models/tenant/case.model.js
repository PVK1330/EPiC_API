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
    businessId: {
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
      type: DataTypes.ENUM(
        'Lead',
        'Pending',
        'Docs Pending',
        'Drafting',
        'Submitted',
        'Decision',
        'In Progress',
        'Completed',
        'On Hold',
        'Cancelled',
        'Under Review',
        'Overdue',
        'Approved',
        'Rejected',
        'Closed'
      ),
      defaultValue: "Lead",
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
    departmentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'departments',
        key: 'id'
      }
    },

    assignedcaseworkerId: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: '"assignedcaseworkerId"',
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
    amountStatus: {
      type: DataTypes.ENUM('Not Submitted', 'Pending Approval', 'Approved', 'Rejected'),
      defaultValue: 'Not Submitted',
    },
    amountNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
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
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: "client_enquiry",
      comment: "Immigration workflow step id (see immigrationCaseProcess constants)",
    },
    workflowState: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: "Post-submission workflow: draft review, biometrics, visa portal",
    },
    workflowMeta: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      field: "workflow_meta",
      comment: "Draft review, biometric availability/slot, visa portal notes",
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Soft delete timestamp"
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
  }, {
    tableName: 'cases',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at'
  });

  return Case;
};

export default CaseModel;
