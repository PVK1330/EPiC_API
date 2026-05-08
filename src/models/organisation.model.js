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
      plan: {
        type: DataTypes.ENUM("starter", "pro", "enterprise"),
        defaultValue: "starter",
        allowNull: false,
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
    },
    {
      tableName: "organisations",
      timestamps: true,
    }
  );

  Organisation.associate = (models) => {
    Organisation.hasMany(models.User, { foreignKey: "organisation_id", as: "users" });
    Organisation.hasMany(models.Case, { foreignKey: "organisation_id", as: "cases" });
    Organisation.hasMany(models.SponsorProfile, { foreignKey: "organisation_id", as: "sponsors" });
    Organisation.hasMany(models.AuditLog, { foreignKey: "organisation_id", as: "auditLogs" });
  };

  return Organisation;
};
