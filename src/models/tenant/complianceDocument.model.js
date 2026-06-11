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
      // Timestamp of the most recent reviewer decision (approve/reject/request-info).
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "reviewed_at",
      },
      // Reviewer-supplied decision notes / rejection reason. Distinct from the
      // sponsor-editable `notes` field above.
      reviewNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "review_notes",
      },
      // Review workflow: draft -> submitted -> under_review ->
      // approved | rejected | information_requested (which loops back to submitted).
      // Legacy values (valid/expired/missing) are retained so historical rows
      // remain valid; they are not produced by the new workflow.
      status: {
        type: DataTypes.ENUM(
          "draft",
          "submitted",
          "under_review",
          "approved",
          "rejected",
          "information_requested",
          "valid",
          "expired",
          "missing"
        ),
        allowNull: false,
        defaultValue: "submitted",
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
