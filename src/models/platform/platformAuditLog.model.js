export default (sequelize, DataTypes) => {
  const PlatformAuditLog = sequelize.define(
    "PlatformAuditLog",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: 'Success',
        allowNull: false,
      },
      // Legacy fields kept for backward compat
      category: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      user: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      org: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
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
