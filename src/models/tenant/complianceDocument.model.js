export default (sequelize, DataTypes) => {
  const ComplianceDocument = sequelize.define(
    "ComplianceDocument",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "sponsor_id",
        references: {
          model: "users",
          key: "id",
        },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: {
          model: "organisations",
          key: "id",
        },
      },
      documentType: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "document_type",
      },
      documentPath: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: "document_path",
      },
      uploadDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "upload_date",
      },
      expiryDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "expiry_date",
      },
      lastReviewedDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "last_reviewed_date",
      },
      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "reviewed_by",
        references: {
          model: "users",
          key: "id",
        },
      },
      status: {
        type: DataTypes.ENUM("valid", "expired", "missing", "under_review"),
        allowNull: false,
        defaultValue: "under_review",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "compliance_documents",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ComplianceDocument;
};
