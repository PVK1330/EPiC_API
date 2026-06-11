export default (sequelize, DataTypes) => {
  // Step 4 — Appendix A document checklist item (1:N). The reviewer maintains
  // receivedStatus / verificationStatus (interactive reviewer UI is a follow-up).
  const LicenceAppendixDocument = sequelize.define(
    "LicenceAppendixDocument",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      documentKey: { type: DataTypes.STRING(80), allowNull: false, field: "document_key" },
      documentName: { type: DataTypes.STRING(255), allowNull: false, field: "document_name" },
      required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      filePath: { type: DataTypes.STRING(500), allowNull: true, field: "file_path" },
      // Not Received | Received
      receivedStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "Not Received", field: "received_status" },
      // Pending | Verified | Rejected
      verificationStatus: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "Pending", field: "verification_status" },
      verifiedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "verified_by",
        references: { model: "users", key: "id" },
      },
      verifiedAt: { type: DataTypes.DATE, allowNull: true, field: "verified_at" },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "licence_appendix_documents",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceAppendixDocument;
};
