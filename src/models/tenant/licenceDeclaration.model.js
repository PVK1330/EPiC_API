export default (sequelize, DataTypes) => {
  // Step 8 — Declarations (1:1 with the application).
  const LicenceDeclaration = sequelize.define(
    "LicenceDeclaration",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      licenceApplicationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: "licence_application_id",
        references: { model: "licence_applications", key: "id" },
      },
      organisationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "organisation_id",
        references: { model: "organisations", key: "id" },
      },
      accuracyConfirmed: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "accuracy_confirmed" },
      dutiesUnderstood: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "duties_understood" },
      dataConsent: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "data_consent" },
      signatoryName: { type: DataTypes.STRING(255), allowNull: true, field: "signatory_name" },
      signatoryRole: { type: DataTypes.STRING(150), allowNull: true, field: "signatory_role" },
      signedDate: { type: DataTypes.DATEONLY, allowNull: true, field: "signed_date" },
    },
    {
      tableName: "licence_declarations",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceDeclaration;
};
