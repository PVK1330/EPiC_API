const EscalationModel = (sequelize, DataTypes) => {
  const Escalation = sequelize.define("Escalation", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    caseId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    candidate: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    severity: {
      type: DataTypes.ENUM("Critical", "High", "Medium", "Low"),
      allowNull: false,
      defaultValue: "Medium",
    },
    trigger: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    triggerType: {
      type: DataTypes.ENUM("Deadline Breach", "Missing Docs", "Stuck Case", "Payment Issue", "Other"),
      allowNull: false,
      defaultValue: "Other",
    },
    assignedAdminId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    assignedAdminName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    daysOpen: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM("Open", "In Progress", "Monitoring", "Chasing", "Resolved", "Closed"),
      allowNull: false,
      defaultValue: "Open",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    resolvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    relatedCaseId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "cases",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
  }, {
    tableName: "escalations",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return Escalation;
};

export default EscalationModel;
