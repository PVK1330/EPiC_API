/** Tenant DB org mirror — no smtp_settings (platform registry only). */
export default (sequelize, DataTypes) => {
  const Organisation = sequelize.define(
    "Organisation",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      plan_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("active", "trial", "suspended"),
        defaultValue: "trial",
        allowNull: false,
      },
      primaryEmail: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          isEmail: true,
        },
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      database_name: {
        type: DataTypes.STRING(63),
        allowNull: true,
      },
      logoUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "logo_url",
      },
      faviconUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        field: "favicon_url",
      },
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "Europe/London",
      },
      date_format: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "DD/MM/YYYY",
      },
    },
    {
      tableName: "organisations",
      timestamps: true,
    },
  );

  return Organisation;
};
