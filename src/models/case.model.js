const CaseModel = (sequelize, DataTypes) => {
  const Case = sequelize.define("Case", {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    caseId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    candidate: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    candidateId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    business: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    businessId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    visaType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    petitionType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    priority: {
      type: DataTypes.ENUM("low", "medium", "high", "urgent"),
      defaultValue: "medium",
    },
    status: {
      type: DataTypes.ENUM("Approved", "Pending", "Rejected", "Review"),
      defaultValue: "Pending",
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
    caseworker: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    caseworkerId: {
      type: DataTypes.STRING,
      allowNull: true,
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
  }, {
    tableName: 'cases',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return Case;
};

export default CaseModel;
