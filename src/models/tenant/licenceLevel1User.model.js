export default (sequelize, DataTypes) => {
  // Step 7 — Level 1 user nominated on the application (1:N).
  const LicenceLevel1User = sequelize.define(
    "LicenceLevel1User",
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
      firstName: { type: DataTypes.STRING(120), allowNull: true, field: "first_name" },
      lastName: { type: DataTypes.STRING(120), allowNull: true, field: "last_name" },
      email: { type: DataTypes.STRING(255), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      jobTitle: { type: DataTypes.STRING(150), allowNull: true, field: "job_title" },
      isAuthorisingOfficer: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: "is_authorising_officer" },
      // Business Profile sync provenance (null = manually entered).
      lastSyncedAt: { type: DataTypes.DATE, allowNull: true, field: "last_synced_at" },
      lastSyncedByUserId: { type: DataTypes.INTEGER, allowNull: true, field: "last_synced_by_user_id" },
    },
    {
      tableName: "licence_level1_users",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return LicenceLevel1User;
};
