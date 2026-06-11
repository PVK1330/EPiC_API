export default (sequelize, DataTypes) => {
  // Step 1 — a selected licence route for a V2 application (multi-select).
  const LicenceApplicationRoute = sequelize.define(
    "LicenceApplicationRoute",
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
      // SkilledWorker | Student | ScaleUp | GBM | GAE
      routeCode: { type: DataTypes.STRING(30), allowNull: false, field: "route_code" },
    },
    {
      tableName: "licence_application_routes",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
    }
  );

  return LicenceApplicationRoute;
};
