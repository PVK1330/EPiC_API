import { DataTypes } from "sequelize";

/**
 * Sponsor Licence Intake Document
 *
 * One row per document slot in the intake checklist for a licence application.
 * Mandatory documents are always seeded; conditional documents are seeded when
 * the corresponding condition flag is set on the intake form.
 *
 * Caseworkers verify/reject individual documents; the readiness check requires
 * all mandatory (isRequired=true) documents to be in "verified" status before
 * Government Registration is permitted.
 */
export default function defineLicenceIntakeDocument(sequelize) {
  return sequelize.define(
    "LicenceIntakeDocument",
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
        onDelete: "CASCADE",
      },

      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "organisation_id",
      },

      // ── Document identity ─────────────────────────────────────────────────
      documentKey: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: "document_key",
      },

      documentName: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: "document_name",
      },

      // "mandatory" rows are always required.
      // "conditional" rows are required only when their conditionType is active.
      category: {
        type: DataTypes.ENUM("mandatory", "conditional"),
        allowNull: false,
        defaultValue: "mandatory",
      },

      // Null for mandatory documents; one of the 6 condition keys for conditional ones.
      conditionType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: "condition_type",
      },

      // Caseworker / admin can manually override whether a conditional doc is required.
      isRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: "is_required",
      },

      sortOrder: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        field: "sort_order",
      },

      // ── Document status ───────────────────────────────────────────────────
      status: {
        type: DataTypes.ENUM("pending", "uploaded", "verified", "rejected", "information_required"),
        allowNull: false,
        defaultValue: "pending",
      },

      // ── Uploaded file metadata ────────────────────────────────────────────
      fileName: {
        type: DataTypes.STRING(500),
        field: "file_name",
      },

      filePath: {
        type: DataTypes.TEXT,
        field: "file_path",
      },

      fileMimeType: {
        type: DataTypes.STRING(100),
        field: "file_mime_type",
      },

      fileSizeBytes: {
        type: DataTypes.INTEGER,
        field: "file_size_bytes",
      },

      uploadedAt: {
        type: DataTypes.DATE,
        field: "uploaded_at",
      },

      uploadedByUserId: {
        type: DataTypes.INTEGER,
        field: "uploaded_by_user_id",
      },

      // ── Caseworker review ─────────────────────────────────────────────────
      verifiedAt: {
        type: DataTypes.DATE,
        field: "verified_at",
      },

      verifiedByUserId: {
        type: DataTypes.INTEGER,
        field: "verified_by_user_id",
      },

      rejectionReason: {
        type: DataTypes.TEXT,
        field: "rejection_reason",
      },

      caseworkerNotes: {
        type: DataTypes.TEXT,
        field: "caseworker_notes",
      },
    },
    {
      tableName: "licence_intake_documents",
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ["licence_application_id"] },
        {
          fields: ["licence_application_id", "document_key"],
          unique: true,
          name: "uq_intake_doc_application_key",
        },
        { fields: ["organisation_id"] },
        { fields: ["status"] },
      ],
    },
  );
}
