export default (sequelize, DataTypes) => {
  const MeetingIntegration = sequelize.define(
    "MeetingIntegration",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      appointment_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      provider_meeting_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      join_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      provider_calendar_event_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      sync_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
        defaultValue: 'SYNCED',
      },
      status: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'active',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "meeting_integrations",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return MeetingIntegration;
};
