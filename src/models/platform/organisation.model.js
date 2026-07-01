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
        references: {
          model: "plans",
          key: "id",
        },
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
      smtp_settings: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
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
      // Org-wide display timezone (IANA id) + date format — admin-selectable,
      // applied across every panel for formatting dates/times.
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
      onboarding_steps: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: "Map of step_key → completed_at ISO string",
      },
      onboarding_completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_sandbox: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Demo/sandbox org — data is reset every 24h",
      },
    },
    {
      tableName: "organisations",
      timestamps: true,
      paranoid: true,
      deletedAt: "deleted_at",
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
