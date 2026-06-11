export default (sequelize, DataTypes) => {
  // Step 5 — Authorising officer (1:1 with the application).
  const LicenceAuthorisingOfficer = sequelize.define(
    "LicenceAuthorisingOfficer",
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
      title: { type: DataTypes.STRING(20), allowNull: true },
      firstName: { type: DataTypes.STRING(120), allowNull: true, field: "first_name" },
      lastName: { type: DataTypes.STRING(120), allowNull: true, field: "last_name" },
      dob: { type: DataTypes.DATEONLY, allowNull: true },
      nationality: { type: DataTypes.STRING(100), allowNull: true },
      niNumber: { type: DataTypes.STRING(20), allowNull: true, field: "ni_number" },
      immigrationStatus: { type: DataTypes.STRING(100), allowNull: true, field: "immigration_status" },
      hasConvictions: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "has_convictions" },
      convictionsDetails: { type: DataTypes.TEXT, allowNull: true, field: "convictions_details" },
      email: { type: DataTypes.STRING(255), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
    },
    {
      tableName: "licence_authorising_officer",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceAuthorisingOfficer;
};
