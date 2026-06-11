export default (sequelize, DataTypes) => {
  // Step 6 — Key contact (1:1 with the application).
  const LicenceKeyContact = sequelize.define(
    "LicenceKeyContact",
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
      sameAsAuthorisingOfficer: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "same_as_authorising_officer" },
      title: { type: DataTypes.STRING(20), allowNull: true },
      firstName: { type: DataTypes.STRING(120), allowNull: true, field: "first_name" },
      lastName: { type: DataTypes.STRING(120), allowNull: true, field: "last_name" },
      email: { type: DataTypes.STRING(255), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      jobTitle: { type: DataTypes.STRING(150), allowNull: true, field: "job_title" },
    },
    {
      tableName: "licence_key_contact",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceKeyContact;
};
