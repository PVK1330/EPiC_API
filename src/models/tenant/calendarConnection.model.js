// Sequelize Model: CalendarConnection
// Created at: 2026-05-29

export default (sequelize, DataTypes) => {
  const CalendarConnection = sequelize.define(
    "CalendarConnection",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      organisation_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "organisations", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      provider_user_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      provider_account_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      access_token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      refresh_token: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      scopes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      last_sync_status: {
        type: DataTypes.STRING(50),
        defaultValue: 'DISCONNECTED',
      },
      last_successful_sync: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_failed_sync: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "calendar_connections",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return CalendarConnection;
};
