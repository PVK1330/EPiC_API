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
    },
    {
      tableName: "organisations",
      timestamps: true,
    },
  );

  return Organisation;
};
