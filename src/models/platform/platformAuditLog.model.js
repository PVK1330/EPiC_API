export default (sequelize, DataTypes) => {
  const PlatformAuditLog = sequelize.define(
    "PlatformAuditLog",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      user: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      org: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: "Success",
        allowNull: false,
      },
    },
    {
      tableName: "platform_audit_logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PlatformAuditLog;
};
