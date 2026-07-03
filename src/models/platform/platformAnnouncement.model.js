export default (sequelize, DataTypes) => {
  const PlatformAnnouncement = sequelize.define(
    "PlatformAnnouncement",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // 'all' organisations, or 'selected' (org_ids populated).
      target: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "all",
      },
      org_ids: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      // How many admin recipients the broadcast reached.
      recipients: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      organisations_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      send_email: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_by_email: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "platform_announcements",
      timestamps: true,
      indexes: [{ fields: ["createdAt"] }],
    },
  );

  return PlatformAnnouncement;
};
