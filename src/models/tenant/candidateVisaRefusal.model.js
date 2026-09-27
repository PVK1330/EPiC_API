export default (sequelize, DataTypes) => {
  const CandidateVisaRefusal = sequelize.define(
    "CandidateVisaRefusal",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      applicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "candidate_applications",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "organisations",
          key: "id",
        },
        onDelete: "SET NULL",
      },
      refusalDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      visaType: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      referenceNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "candidate_visa_refusals",
      timestamps: true,
      indexes: [
        { fields: ["applicationId"] },
        { fields: ["userId"] },
        { fields: ["organisationId"] },
      ],
    }
  );

  return CandidateVisaRefusal;
};
