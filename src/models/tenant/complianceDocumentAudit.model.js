export default (sequelize, DataTypes) => {
  /**
   * Immutable audit trail for compliance-document status changes.
   *
   * One row is written for every transition (submit, start review, approve,
   * reject, request information, resubmit). Rows are never updated or deleted by
   * the application, so the table preserves the full review history of a
   * document. Status fields are stored as plain strings (not the document enum)
   * so historical entries remain valid even if the enum evolves.
   */
  const ComplianceDocumentAudit = sequelize.define(
    "ComplianceDocumentAudit",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      complianceDocumentId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "compliance_document_id",
        references: {
          model: "compliance_documents",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      // The user who performed the change. For reviewer actions this is the
      // Admin/Caseworker; for submit/resubmit it is the sponsor.
      reviewerId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "reviewer_id",
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
      action: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      previousStatus: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "previous_status",
      },
      newStatus: {
        type: DataTypes.STRING(50),
        allowNull: false,
        field: "new_status",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "reviewed_at",
      },
    },
    {
      tableName: "compliance_document_audits",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  return ComplianceDocumentAudit;
};
